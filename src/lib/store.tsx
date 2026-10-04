import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, selectAll, realtimeChannel, supabase } from './supabase';
import type {
  DraftPick, DraftState, Game, League, Notification, Player, PlayerSeason, PlayerStatus, PlayerWindow, Roster, Standing, Team,
} from './types';
import { etCalendarToday, etToday, setLeagueDayHold } from './format';
import { applyBrandColors, brandOf, SAK_BRAND, type Brand } from './brand';
import { calledOff, isFinal, NHL, type SportConfig } from './sport';
import { hostLeague, tabLeague, type HostLeague } from './host';

interface Store {
  ready: boolean;
  session: Session | null;
  me: Team | null;
  league: League | null;
  host: HostLeague | null;      // the league this address belongs to (league by host), if any
  hostElsewhere: boolean;       // signed in on a league's address the GM isn't in: the page shows their own league
  brand: Brand;                // names, wordmark, trophies for the league on screen (SaK defaults)
  sport: SportConfig;          // the sport the league plays (sports row, migration 135; the NHL until it loads)
  teams: Team[];               // GMs only
  spectators: Team[];          // spectator passes (chat, bets, no roster)
  can: (what: string) => boolean;
  team: (id: number | null | undefined) => Team | undefined;
  players: Map<number, Player>;
  rosters: Roster[];
  owner: Map<number, Roster>;
  picks: DraftPick[];
  draft: DraftState | null;
  standings: Standing[];
  playoffs: Standing[];         // NHL-playoff games only, a separate table and prize pot
  cup: Standing[];              // the SAK Cup: the whole year, regular season plus playoffs
  season: Map<number, PlayerSeason>;
  windows: Map<number, Record<string, PlayerWindow>>;   // per-player stats by timeframe (season / 30 / 14 / 7 days)
  games: Game[];               // today + upcoming week
  gamesByTeam: (nhl: string | null | undefined, date?: string) => Game | undefined;
  notifications: Notification[];
  gameStatus: (id: number, date?: string) => PlayerStatus | undefined;   // will he play? (today, or a given day)
  freshNews: Map<number, number>;   // players with headlines, trades, injury or lineup news in the last 48 hours
  online: Set<number>;
  refresh: (what?: Table[]) => Promise<void>;
  serverOffset: number;        // ms to add to Date.now() to match the database clock
  leagueDay: string;           // today for the league: last night until its final game ends
}

type Table = 'league' | 'teams' | 'rosters' | 'picks' | 'draft' | 'standings' | 'season' | 'windows' | 'games' | 'notifications' | 'players' | 'gameday';

const Ctx = createContext<Store | null>(null);

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [league, setLeague] = useState<League | null>(null);
  const [brand, setBrand] = useState<Brand>(SAK_BRAND);
  const [sport, setSport] = useState<SportConfig>(NHL);
  // a game that can't change the numbers any more: over, postponed or cancelled (read from loaders and timers)
  const sportRef = useRef(sport);
  sportRef.current = sport;
  const settled = (state: string) => isFinal(sportRef.current, state) || calledOff(sportRef.current, state);
  // league by host: which league this address is, worked out once before anything loads, so the sign-in page wears its
  // brand and every request names it
  const [host, setHost] = useState<HostLeague | null>(null);
  const [hostReady, setHostReady] = useState(!configured);
  useEffect(() => {
    if (!configured) return;
    hostLeague().then((l) => { setHost(l); if (l) setBrand(brandOf(l.brand, l.short_name)); setHostReady(true); });
  }, []);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const teams = useMemo(() => allTeams.filter((t) => t.role !== 'spectator'), [allTeams]);      // the eight GMs
  const spectators = useMemo(() => allTeams.filter((t) => t.role === 'spectator'), [allTeams]);
  const [players, setPlayers] = useState<Map<number, Player>>(new Map());
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [playoffs, setPlayoffs] = useState<Standing[]>([]);
  const [cup, setCup] = useState<Standing[]>([]);
  const [season, setSeason] = useState<Map<number, PlayerSeason>>(new Map());
  const [windows, setWindows] = useState<Map<number, Record<string, PlayerWindow>>>(new Map());
  const [games, setGames] = useState<Game[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [statuses, setStatuses] = useState<Map<string, PlayerStatus>>(new Map());
  const [freshNews, setFreshNews] = useState<Map<number, number>>(new Map());
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const me = useMemo(() => allTeams.find((t) => t.user_id === session?.user.id) ?? null, [allTeams, session]);
  // GMs can do everything; a spectator only what the commissioner left switched on
  const can = useCallback((what: string) => !me || me.role !== 'spectator' || (me.perms?.active !== false && me.perms?.[what] !== false), [me]);
  // you're always online to yourself, even before presence syncs
  useEffect(() => { if (me) setOnline((o) => (o.has(me.id) ? o : new Set([...o, me.id]))); }, [me?.id]);
  // the league's colour themes the page (SaK's gold is the default the stylesheet already draws)
  useEffect(() => { applyBrandColors(brand.colors.gold); }, [brand.colors.gold]);
  const meRef = useRef(me);
  meRef.current = me;
  const gamesRef = useRef<Game[]>([]);
  gamesRef.current = games;

  const loaders: Record<Table, () => Promise<void>> = useMemo(() => ({
    league: async () => {
      const { data } = await supabase.from('league').select('*').single();
      if (data) setLeague(data as League);
      const { data: lg } = await supabase.from('leagues').select('brand,short_name,sport').eq('id', (data as League | null)?.league_id ?? 1).maybeSingle();
      setBrand(brandOf(lg?.brand as Partial<Brand> | null, lg?.short_name as string | null));
      // hockey is compiled in; another sport's description comes from its row
      const code = (lg?.sport as string | null) ?? 'nhl';
      if (code === 'nhl') setSport(NHL);
      else {
        const { data: sp } = await supabase.from('sports').select('config').eq('id', code).maybeSingle();
        // words merge key by key: a row that names only some of them keeps hockey's for the rest
        const cfg = sp?.config as Partial<SportConfig> | null;
        setSport(cfg ? { ...NHL, ...cfg, words: { ...NHL.words, ...(cfg.words ?? {}) } } : NHL);
      }
    },
    teams: async () => { const { data } = await supabase.from('teams').select('*').order('id'); if (data) setAllTeams(data as Team[]); },
    players: async () => {
      const rows = await selectAll<Player>('league_players', 'id,name,first,last_name,pos,elig,nhl_team,num,headshot,last_fp,proj,proj_gp,rank,status,last_stats,injury_note,injury_status,injury_date', 1000, ['id']);
      setPlayers(new Map(rows.map((p) => [p.id, p])));
    },
    rosters: async () => setRosters(await selectAll<Roster>('rosters')),
    picks: async () => setPicks(await selectAll<DraftPick>('draft_picks')),
    draft: async () => { const { data } = await supabase.from('draft_state').select('*').single(); if (data) setDraft(data as DraftState); },
    standings: async () => {
      const [{ data }, { data: po }, { data: cp }] = await Promise.all([supabase.from('standings').select('*'), supabase.from('playoff_standings').select('*'), supabase.from('sak_cup_standings').select('*')]);
      if (data) setStandings(data as Standing[]);
      if (po) setPlayoffs((po as Standing[]).map((r) => ({ ...r, moves: 0 })));
      if (cp) setCup((cp as Standing[]).map((r) => ({ ...r, moves: 0 })));
    },
    season: async () => {
      const rows = await selectAll<PlayerSeason>('player_season');
      setSeason(new Map(rows.map((r) => [r.player_id, r])));
    },
    windows: async () => {
      const rows = await selectAll<PlayerWindow>('player_windows', '*', 1000, ['player_id', 'win']);
      const m = new Map<number, Record<string, PlayerWindow>>();
      for (const r of rows) { const w = m.get(r.player_id) ?? {}; w[r.win] = r; m.set(r.player_id, w); }
      setWindows(m);
    },
    games: async () => {
      // from yesterday: last night's games may still be going after midnight
      const today = new Date(new Date(etCalendarToday() + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from('games').select('*').gte('date', today).lte('date', end).order('start_utc');
      if (data) {
        // set the league-day hold before anything renders with these games (a late game from last night still on)
        const going = (data as Game[]).some((g) => g.date === today && new Date(g.start_utc).getTime() <= Date.now() && !settled(g.state));
        setLeagueDayHold(going ? today : null);
        setGames(data as Game[]);
      }
    },
    notifications: async () => {
      const { data } = await supabase.from('notifications').select('*').order('id', { ascending: false }).limit(50);
      if (data) setNotifications(data as Notification[]);
    },
    gameday: async () => {
      const today = etToday();
      const since = new Date(Date.now() - 48 * 3600000).toISOString();
      const [{ data: st }, { data: nw }, { data: ev }] = await Promise.all([
        supabase.from('player_status').select('*').gte('date', today),
        supabase.from('news').select('player_ids').gte('published', since),
        supabase.from('player_events').select('player_id').gte('at', since),
      ]);
      if (st) setStatuses(new Map((st as PlayerStatus[]).map((s) => [`${s.player_id}|${s.date}`, s])));
      const fresh = new Map<number, number>();
      for (const n of (nw ?? []) as { player_ids: number[] }[]) for (const id of n.player_ids ?? []) fresh.set(id, (fresh.get(id) ?? 0) + 1);
      for (const e of (ev ?? []) as { player_id: number }[]) fresh.set(e.player_id, (fresh.get(e.player_id) ?? 0) + 1);
      setFreshNews(fresh);
    },
  }), []);

  const refresh = useCallback(async (what?: Table[]) => {
    const keys = what ?? (Object.keys(loaders) as Table[]);
    await Promise.all(keys.map((k) => loaders[k]().catch((e) => console.warn('load', k, e))));
  }, [loaders]);

  // initial load once signed in. Keyed on who is signed in, not the session object: Supabase hands out a new session
  // on every token refresh and when the app comes back to the foreground, and reloading everything then would
  // rebuild every screen under the GM
  const uid = session?.user.id ?? null;
  useEffect(() => {
    if (!session || !hostReady) { setLoaded(false); return; }
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
  }, [uid, hostReady, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // realtime: refetch the affected table (debounced) whenever the database changes. A league's own tables are heard
  // for this league only (inserts and updates carry league_id, so the filter holds them back at the server); deletes
  // can't be filtered by Realtime, so they are still heard from every league and only cost a refetch.
  const rtLeague = league?.league_id ?? null;
  useEffect(() => {
    if (!session) return;
    const timers = new Map<Table, number>();
    const bump = (t: Table, delay = 250) => {
      clearTimeout(timers.get(t));
      timers.set(t, window.setTimeout(() => loaders[t](), delay));
    };
    const map: Record<string, Table[]> = {
      // the rules row lives in league_rules (the `league` the site reads is a view of the caller's row), so its changes arrive under that name
      league: ['league'], league_rules: ['league'], teams: ['teams'], rosters: ['rosters', 'standings'], draft_picks: ['picks'],
      draft_state: ['draft'], games: ['games'], notifications: ['notifications'], transactions: ['standings'], player_status: ['gameday'],
    };
    const perLeague = new Set(['league_rules', 'teams', 'rosters', 'draft_picks', 'draft_state', 'notifications', 'transactions']);
    const ch = realtimeChannel('league-db');
    for (const table of Object.keys(map)) {
      const on = (payload: { new: Record<string, unknown> | null }) => {
        // draft state is latency-sensitive: apply it directly
        if (table === 'draft_state' && payload.new && 'status' in payload.new) { setDraft(payload.new as unknown as DraftState); return; }
        map[table].forEach((t) => bump(t, table === 'games' ? 2000 : 250));
      };
      if (rtLeague != null && perLeague.has(table)) {
        const filter = `league_id=eq.${rtLeague}`;
        ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, on);
        ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, on);
        ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, on);
      } else {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, on);
      }
    }
    ch.subscribe();
    // live scoring: while a game is on (or about to drop the puck) standings refresh every minute and season stats
    // every 5; with nothing on, the numbers can't move, so every 5 and every 30. Game starts and finals arrive by
    // realtime on `games`, which flips the pace without waiting for a tick.
    let tick = 0;
    const i1 = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      tick++;
      const live = gamesRef.current.some((g) => !settled(g.state) && Date.parse(g.start_utc) - 30 * 60_000 <= Date.now());
      if (live || tick % 5 === 0) refresh(['standings', 'games']);
      if (live ? tick % 5 === 0 : tick % 30 === 0) refresh(['season', 'windows', 'gameday']);
    }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'standings', 'notifications', 'gameday']); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(i1);
      document.removeEventListener('visibilitychange', onVis);
      timers.forEach((t) => clearTimeout(t));
    };
  }, [uid, loaders, refresh, rtLeague]); // eslint-disable-line react-hooks/exhaustive-deps

  // presence: who's online right now, GMs and spectators alike. Everyone in a league shares its 'online:<league>'
  // topic, so wait for any previous copy (a quick sign-out/in) to finish leaving before joining again.
  const presenceLeague = league?.league_id ?? 1;
  useEffect(() => {
    if (!me) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      try {
        await Promise.all(supabase.getChannels().filter((c) => c.topic.startsWith('realtime:online')).map((c) => supabase.removeChannel(c)));
        if (cancelled) return;
        const c = supabase.channel(`online:${presenceLeague}`, { config: { presence: { key: String(me.id) } } });
        ch = c;
        c.on('presence', { event: 'sync' }, () => {
          setOnline(new Set([me.id, ...Object.keys(c.presenceState()).map(Number)]));
        }).subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await c.track({ at: Date.now() });
        });
      } catch (e) { console.warn('presence unavailable', e); }
    })();
    supabase.rpc('touch_seen').then(() => {}, () => {});
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, [me?.id, presenceLeague]);

  // safety net for flaky phone connections: poll the draft while it's live
  const draftLive = draft?.status === 'live' || draft?.status === 'paused' || (draft?.status === 'scheduled' && draft.order_set);
  useEffect(() => {
    if (!session || !draftLive) return;
    const i = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'league']);
    }, 4000);
    return () => clearInterval(i);
  }, [uid, draftLive, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const owner = useMemo(() => new Map(rosters.map((r) => [r.player_id, r])), [rosters]);
  const teamMap = useMemo(() => new Map(allTeams.map((t) => [t.id, t])), [allTeams]);
  const team = useCallback((id: number | null | undefined) => (id == null ? undefined : teamMap.get(id)), [teamMap]);
  // hold the league day on yesterday while any of yesterday's games is still being played (checked each minute)
  const [leagueDay, setLeagueDay] = useState(etToday());
  useEffect(() => {
    const check = () => {
      const cal = etCalendarToday();
      const y = new Date(new Date(cal + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      const going = games.some((g) => g.date === y && new Date(g.start_utc).getTime() <= Date.now() && !settled(g.state));
      setLeagueDayHold(going ? y : null);
      setLeagueDay(etToday());
    };
    check();
    const i = window.setInterval(check, 60_000);
    return () => window.clearInterval(i);
  }, [games]);
  const gamesByTeam = useCallback((nhl: string | null | undefined, date = etToday()) =>
    nhl ? games.find((g) => g.date === date && (g.home === nhl || g.away === nhl)) : undefined, [games, leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const gameStatus = useCallback((id: number, date?: string) => statuses.get(`${id}|${date ?? etToday()}`), [statuses, leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const value: Store = {
    ready: authReady && hostReady && (!session || loaded), host, hostElsewhere: !!host && !!league && league.league_id !== host.id && !tabLeague(), session, me, league, brand, sport, teams, spectators, can, team, players, rosters, owner, picks, draft,
    standings, playoffs, cup, season, windows, games, gamesByTeam, notifications, gameStatus, freshNews, online, refresh, serverOffset, leagueDay,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// the sport the league on screen plays
export function useSport() { return useLeague().sport; }

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
