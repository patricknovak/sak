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
import { useDraftRoom } from './draftRoom';

interface Store {
  ready: boolean;
  session: Session | null;
  me: Team | null;
  league: League | null;
  host: HostLeague | null;      // the league this address belongs to (league by host), if any
  hostElsewhere: boolean;       // signed in on a league's address the GM isn't in: the page shows their own league
  brand: Brand;                // names, wordmark, trophies for the league on screen (SaK defaults)
  sport: SportConfig;          // the sport the league plays (sports row, migration 135; the NHL until it loads)
  kind: 'fantasy' | 'predict'; // a fantasy league, or a prediction pool (questions only, migration 145)
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
  draftRoom: boolean;           // the draft room at the edge is live: the clock and the picks come from it
  refresh: (what?: Table[]) => Promise<void>;
  serverOffset: number;        // ms to add to Date.now() to match the database clock
  leagueDay: string;           // today for the league: last night until its final game ends
  gamesLive: boolean;          // a game is on, or drops the puck within half an hour: what live polls key on
  // tonight's fantasy points, player by player, for the league day: read once each time a box score moves (stats_gen by
  // realtime, migration 248) and shared by every page, so every page shows the same number at the same moment
  dayPoints: Map<number, DayPoint>;
  pointsDay: string;           // the day dayPoints holds (the league day when it was read)
}

export interface DayPoint { fpts: number; stats: Record<string, number>; game_id: number; nhl_team: string | null; updated_at: string | null }

type Table = 'league' | 'teams' | 'rosters' | 'picks' | 'draft' | 'standings' | 'season' | 'windows' | 'games' | 'notifications' | 'players' | 'gameday' | 'points';

const Ctx = createContext<Store | null>(null);

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [league, setLeague] = useState<League | null>(null);
  const [brand, setBrand] = useState<Brand>(SAK_BRAND);
  const [kind, setKind] = useState<'fantasy' | 'predict'>('fantasy');
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
  const [dayPoints, setDayPoints] = useState<{ day: string; pts: Map<number, DayPoint> }>({ day: '', pts: new Map() });
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
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const loaders: Record<Table, () => Promise<void>> = useMemo(() => ({
    league: async () => {
      const { data } = await supabase.from('league').select('*').single();
      if (data) setLeague(data as League);
      const { data: lg } = await supabase.from('leagues').select('brand,short_name,sport,kind').eq('id', (data as League | null)?.league_id ?? 1).maybeSingle();
      setBrand(brandOf(lg?.brand as Partial<Brand> | null, lg?.short_name as string | null));
      setKind(lg?.kind === 'predict' ? 'predict' : 'fantasy');
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
      const rows = await selectAll<Player>('league_players', 'id,name,first,last_name,pos,elig,nhl_team,num,headshot,last_fp,proj,proj_gp,rank,status,last_stats,injury_note,injury_status,injury_date,injury_return,injury_part,injury_list', 1000, ['id']);
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
    points: async () => {
      const day = etToday();
      // a prediction pool has no lineups: nothing on its pages reads fantasy points
      if (kindRef.current !== 'fantasy') { setDayPoints({ day, pts: new Map() }); return; }
      const rows = await selectAll<{ player_id: number; game_id: number; nhl_team: string | null; fpts: number; stats: Record<string, number>; updated_at: string | null }>('league_games', 'player_id,game_id,nhl_team,fpts,stats,updated_at', 1000, ['player_id', 'game_id'], (q) => q.eq('date', day));
      setDayPoints({ day, pts: new Map(rows.map((r) => [r.player_id, { fpts: Number(r.fpts), stats: r.stats ?? {}, game_id: r.game_id, nhl_team: r.nhl_team, updated_at: r.updated_at }])) });
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
        // a game's score and clock (the clock job writes them every 20 seconds while a game is on, migration 247): the
        // row is applied as it comes, so every page moves together without reading the slate again
        if (table === 'games' && payload.new && 'id' in payload.new) {
          const row = payload.new as unknown as Game;
          const known = gamesRef.current.some((g) => g.id === row.id);
          if (known) { setGames((all) => all.map((g) => (g.id === row.id ? { ...g, ...row } : g))); return; }
        }
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
    // the box scores moved (stats_gen, migration 248): tonight's points and the standings read once, for every page
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stats_gen' }, () => { bump('points', 3000); bump('standings', 3000); });
    ch.subscribe();
    // live scoring: while a game is on (or about to drop the puck) standings refresh every minute and season stats
    // every 5; with nothing on, the numbers can't move, so every 5 and every 30. Game starts and finals arrive by
    // realtime on `games`, which flips the pace without waiting for a tick.
    let tick = 0;
    const i1 = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      tick++;
      const live = gamesRef.current.some((g) => !settled(g.state) && Date.parse(g.start_utc) - 30 * 60_000 <= Date.now());
      // scores, clocks and points arrive by realtime as they move; this is the backstop for a dropped connection
      if (tick % 5 === 0) refresh(live ? ['standings', 'games', 'points'] : ['standings', 'games']);
      if (live ? tick % 5 === 0 : tick % 30 === 0) refresh(['season', 'windows', 'gameday']);
    }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'standings', 'notifications', 'gameday', 'games', 'points']); };
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

  const draftLive = draft?.status === 'live' || draft?.status === 'paused' || (draft?.status === 'scheduled' && draft.order_set);
  // the draft room at the edge (lib/draftRoom): it keeps the pick clock and pushes every pick the moment it's made.
  // Its word is taken for the draft and the picks it carries, so the board moves the moment a pick is made.
  const roomOverall = useRef<number | null>(null);
  const draftRoom = useDraftRoom(!!session && !!me && draftLive, league?.league_id ?? null, (st, made) => {
    setDraft(st);
    if (made.length) {
      const by = new Map(made.map((p) => [p.id, p]));
      setPicks((all) => all.map((p) => (by.has(p.id) ? { ...p, ...by.get(p.id)! } : p)));
    }
    // the pick on the clock moved (a pick, or an undo): the whole board and the rosters read again behind it
    if (st.current_overall !== roomOverall.current) { roomOverall.current = st.current_overall; refresh(['picks', 'rosters']); }
  });
  // safety net for flaky phone connections: poll the draft while it's live, unless the draft room is doing it for us
  useEffect(() => {
    if (!session || !draftLive || draftRoom) return;
    const i = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(['draft', 'picks', 'rosters', 'league']);
    }, 4000);
    return () => clearInterval(i);
  }, [uid, draftLive, draftRoom, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // the league day turned over (last night's final game ended, or the morning came): tonight's points start again
  useEffect(() => { if (loaded && dayPoints.day && dayPoints.day !== leagueDay) refresh(['points']); }, [leagueDay, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // the same test the minute tick uses; games arrive by realtime as they start and end, and refresh every 5 minutes
  const gamesLive = useMemo(() => games.some((g) => !settled(g.state) && Date.parse(g.start_utc) - 30 * 60_000 <= Date.now()), [games]); // eslint-disable-line react-hooks/exhaustive-deps
  const gamesByTeam = useCallback((nhl: string | null | undefined, date = etToday()) =>
    nhl ? games.find((g) => g.date === date && (g.home === nhl || g.away === nhl)) : undefined, [games, leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const gameStatus = useCallback((id: number, date?: string) => statuses.get(`${id}|${date ?? etToday()}`), [statuses, leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const value: Store = {
    ready: authReady && hostReady && (!session || loaded), host, hostElsewhere: !!host && !!league && league.league_id !== host.id && tabLeague() !== league.league_id, session, me, league, brand, sport, kind, teams, spectators, can, team, players, rosters, owner, picks, draft,
    standings, playoffs, cup, season, windows, games, gamesLive, gamesByTeam, notifications, gameStatus, freshNews, online, draftRoom, refresh, serverOffset, leagueDay,
    dayPoints: dayPoints.pts, pointsDay: dayPoints.day,
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
