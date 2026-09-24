import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, selectAll, realtimeChannel, supabase } from './supabase';
import type {
  DraftPick, DraftState, Game, League, Notification, Player, PlayerSeason, Roster, Standing, Team,
} from './types';
import { etToday } from './format';

interface Store {
  ready: boolean;
  session: Session | null;
  me: Team | null;
  league: League | null;
  teams: Team[];
  team: (id: number | null | undefined) => Team | undefined;
  players: Map<number, Player>;
  rosters: Roster[];
  owner: Map<number, Roster>;
  picks: DraftPick[];
  draft: DraftState | null;
  standings: Standing[];
  season: Map<number, PlayerSeason>;
  games: Game[];               // today + upcoming week
  gamesByTeam: (nhl: string | null | undefined, date?: string) => Game | undefined;
  notifications: Notification[];
  online: Set<number>;
  refresh: (what?: Table[]) => Promise<void>;
  serverOffset: number;        // ms to add to Date.now() to match the database clock
}

type Table = 'league' | 'teams' | 'rosters' | 'picks' | 'draft' | 'standings' | 'season' | 'games' | 'notifications' | 'players';

const Ctx = createContext<Store | null>(null);

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Map<number, Player>>(new Map());
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [season, setSeason] = useState<Map<number, PlayerSeason>>(new Map());
  const [games, setGames] = useState<Game[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const me = useMemo(() => teams.find((t) => t.user_id === session?.user.id) ?? null, [teams, session]);
  // you're always online to yourself, even before presence syncs
  useEffect(() => { if (me) setOnline((o) => (o.has(me.id) ? o : new Set([...o, me.id]))); }, [me?.id]);
  const meRef = useRef(me);
  meRef.current = me;

  const loaders: Record<Table, () => Promise<void>> = useMemo(() => ({
    league: async () => { const { data } = await supabase.from('league').select('*').single(); if (data) setLeague(data as League); },
    teams: async () => { const { data } = await supabase.from('teams').select('*').order('id'); if (data) setTeams(data as Team[]); },
    players: async () => {
      const rows = await selectAll<Player>('players', 'id,name,first,last_name,pos,elig,nhl_team,num,headshot,last_fp,proj,rank,status,last_stats,injury_note,injury_status,injury_date');
      setPlayers(new Map(rows.map((p) => [p.id, p])));
    },
    rosters: async () => setRosters(await selectAll<Roster>('rosters')),
    picks: async () => setPicks(await selectAll<DraftPick>('draft_picks')),
    draft: async () => { const { data } = await supabase.from('draft_state').select('*').single(); if (data) setDraft(data as DraftState); },
    standings: async () => { const { data } = await supabase.from('standings').select('*'); if (data) setStandings(data as Standing[]); },
    season: async () => {
      const rows = await selectAll<PlayerSeason>('player_season');
      setSeason(new Map(rows.map((r) => [r.player_id, r])));
    },
    games: async () => {
      const today = etToday();
      const end = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from('games').select('*').gte('date', today).lte('date', end).order('start_utc');
      if (data) setGames(data as Game[]);
    },
    notifications: async () => {
      const { data } = await supabase.from('notifications').select('*').order('id', { ascending: false }).limit(50);
      if (data) setNotifications(data as Notification[]);
    },
  }), []);

  const refresh = useCallback(async (what?: Table[]) => {
    const keys = what ?? (Object.keys(loaders) as Table[]);
    await Promise.all(keys.map((k) => loaders[k]().catch((e) => console.warn('load', k, e))));
  }, [loaders]);

  // initial load once signed in
  useEffect(() => {
    if (!session) { setLoaded(false); return; }
    let alive = true;
    refresh().then(() => alive && setLoaded(true));
    // measure clock skew against the database so every phone shows the same pick clock
    const t0 = Date.now();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/team_directory?select=id&limit=1`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then((r) => {
        const d = r.headers.get('date');
        if (d) setServerOffset(new Date(d).getTime() + 500 - (t0 + Date.now()) / 2);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [session, refresh]);

  // realtime: refetch the affected table (debounced) whenever the database changes
  useEffect(() => {
    if (!session) return;
    const timers = new Map<Table, number>();
    const bump = (t: Table, delay = 250) => {
      clearTimeout(timers.get(t));
      timers.set(t, window.setTimeout(() => loaders[t](), delay));
    };
    const map: Record<string, Table[]> = {
      league: ['league'], teams: ['teams'], rosters: ['rosters', 'standings'], draft_picks: ['picks'],
      draft_state: ['draft'], games: ['games'], notifications: ['notifications'], transactions: ['standings'],
    };
    const ch = realtimeChannel('league-db');
    for (const table of Object.keys(map)) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        // draft state is latency-sensitive: apply it directly
        if (table === 'draft_state' && payload.new && 'status' in payload.new) { setDraft(payload.new as DraftState); return; }
        map[table].forEach((t) => bump(t, table === 'games' ? 2000 : 250));
      });
    }
    ch.subscribe();
    // live scoring: standings refresh every minute, season stats every 5
    const i1 = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(['standings', 'games']); }, 60_000);
    const i2 = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(['season']); }, 300_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'standings', 'notifications']); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(i1); clearInterval(i2);
      document.removeEventListener('visibilitychange', onVis);
      timers.forEach((t) => clearTimeout(t));
    };
  }, [session, loaders, refresh]);

  // presence: who's online right now
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel('online', { config: { presence: { key: String(me.id) } } });
    ch.on('presence', { event: 'sync' }, () => {
      setOnline(new Set([me.id, ...Object.keys(ch.presenceState()).map(Number)]));
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track({ at: Date.now() });
    });
    supabase.rpc('touch_seen');
    return () => { supabase.removeChannel(ch); };
  }, [me?.id]);

  // safety net for flaky phone connections: poll the draft while it's live
  const draftLive = draft?.status === 'live' || draft?.status === 'paused' || (draft?.status === 'scheduled' && draft.order_set);
  useEffect(() => {
    if (!session || !draftLive) return;
    const i = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'league']);
    }, 4000);
    return () => clearInterval(i);
  }, [session, draftLive, refresh]);

  const owner = useMemo(() => new Map(rosters.map((r) => [r.player_id, r])), [rosters]);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const team = useCallback((id: number | null | undefined) => (id == null ? undefined : teamMap.get(id)), [teamMap]);
  const gamesByTeam = useCallback((nhl: string | null | undefined, date = etToday()) =>
    nhl ? games.find((g) => g.date === date && (g.home === nhl || g.away === nhl)) : undefined, [games]);

  const value: Store = {
    ready: authReady && (!session || loaded), session, me, league, teams, team, players, rosters, owner, picks, draft,
    standings, season, games, gamesByTeam, notifications, online, refresh, serverOffset,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeague() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLeague outside provider');
  return v;
}

// ticking clock (server-corrected)
export function useNow(ms = 1000) {
  const { serverOffset } = useLeague();
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now() + serverOffset), ms);
    return () => clearInterval(i);
  }, [ms, serverOffset]);
  return now;
}
