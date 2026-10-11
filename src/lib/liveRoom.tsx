// The league's live room on a game night (worker/live.ts, docs/DEVELOPMENT.md §8.3 E4). While a game is on or about
// to drop the puck, the app joins its league's room at the edge over one WebSocket: the room reads the night from the
// database for everyone and pushes each change, so the scoreboard moves within seconds of the box score and no phone
// has to keep asking. The room also knows who's watching, keeps the night's swings (every point a starter scores, every
// goal and final) and passes reactions around. A goal by one of your starters shows wherever you are in the app.
//
// Only on the product's own addresses, where the Worker runs; anywhere else (the GitHub Pages copy, a local build) the
// pages keep their own minute-by-minute reads, as before.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from './store';
import { supabase } from './supabase';
import { fmtPts, STAT_LABELS } from './format';
import { TeamBadge } from '../components/ui';
import type { Game, Team } from './types';

export type RoomSnap = { team_id: number; player_id: number; slot: string; game_id: number };
export type RoomLine = { player_id: number; game_id: number; fpts: number; stats: Record<string, number>; nhl_team: string | null; updated_at: string | null };
export type Swing = {
  id: number; at: string; kind: 'p' | 'g'; early?: boolean;
  team?: number; player?: number; game: number; d?: number; pts?: number; what?: Record<string, number>;
  score?: [number | null, number | null]; state?: string; period?: string | null; clock?: string | null;
  rx?: Record<string, string>;
};
export type Night = { games: Game[]; snaps: RoomSnap[]; pgs: RoomLine[]; at: number };
export const REACTIONS = ['🔥', '😱', '👏', '😂', '🧊'];

type Room = {
  status: 'off' | 'connecting' | 'live';
  day: string | null;
  night: Night | null;
  swings: Swing[];
  watching: number[];
  react: (swing: number, e: string) => void;
};
const OFF: Room = { status: 'off', day: null, night: null, swings: [], watching: [], react: () => {} };
const Ctx = createContext<Room>(OFF);
export const useLiveRoom = () => useContext(Ctx);

// the Worker answers on the product's addresses only
const EDGE = typeof location !== 'undefined' && /(^|\.)superpools?ai\.com$/.test(location.hostname);

// a swing in words: the big moments first (a goal, an assist, a win), then the small ones that still score
const BIG: [string, string, string][] = [['g', 'goal', 'goals'], ['a', 'assist', 'assists'], ['w', 'win', 'wins'], ['sho', 'shutout', 'shutouts'], ['gwg', 'game-winner', 'game-winners'], ['l', 'loss', 'losses'], ['otl', 'OT loss', 'OT losses']];
const SMALL = ['sog', 'hit', 'blk', 'sv', 'ga', 'pim', 'fow', 'pm', 'ppp', 'shp'];
export function swingWords(what: Record<string, number> = {}): { head: string; rest: string } {
  const big = BIG.filter(([k]) => what[k] > 0).map(([k, one, many]) => (what[k] === 1 ? one[0].toUpperCase() + one.slice(1) : `${what[k]} ${many}`));
  const small = SMALL.filter((k) => what[k]).map((k) => (k === 'pm' ? `${what[k] > 0 ? '+' : '−'}${Math.abs(what[k])} +/−` : `${what[k]} ${STAT_LABELS[k] ?? k}`));
  if (big.length) return { head: big.join(' + '), rest: small.join(' · ') };
  return { head: small.slice(0, 2).join(' · ') || 'Points', rest: small.slice(2).join(' · ') };
}

export function LiveRoomProvider({ children }: { children: ReactNode }) {
  const { session, me, league, kind, leagueDay, gamesLive, players, team } = useLeague();
  const [room, setRoom] = useState<Omit<Room, 'react'>>(OFF);
  const [alert, setAlert] = useState<Swing | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const meRef = useRef<number | null>(null);
  meRef.current = me?.id ?? null;
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    // a phone put away for a minute leaves the room; it comes back in as soon as it's looked at again
    let t: number | undefined;
    const on = () => {
      window.clearTimeout(t);
      if (document.visibilityState === 'visible') setVisible(true);
      else t = window.setTimeout(() => setVisible(false), 60_000);
    };
    document.addEventListener('visibilitychange', on);
    return () => { document.removeEventListener('visibilitychange', on); window.clearTimeout(t); };
  }, []);

  const leagueId = league?.league_id ?? null;
  const want = EDGE && !!session && !!me && leagueId != null && kind === 'fantasy' && gamesLive && visible;

  useEffect(() => {
    if (!want || leagueId == null) { setRoom(OFF); return; }
    let alive = true, tries = 0, timer: number | undefined;
    const day = leagueDay;
    const hello = async (s: WebSocket, t: 'hello' | 'auth') => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t, token }));
    };
    const connect = () => {
      if (!alive) return;
      setRoom((r) => ({ ...r, status: r.status === 'live' ? 'live' : 'connecting', day }));
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${leagueId}/${day}`);
      ws.current = s;
      s.onopen = () => hello(s, 'hello');
      s.onmessage = (ev) => {
        let m: { t: string } & Record<string, unknown>;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'night') {
          tries = 0;
          setRoom((r) => ({ ...r, status: 'live', day, night: { games: m.games as Game[], snaps: m.snaps as RoomSnap[], pgs: m.pgs as RoomLine[], at: m.at as number }, swings: m.swings as Swing[] }));
        } else if (m.t === 'tick') {
          setRoom((r) => {
            if (!r.night) return r;
            const games = new Map(r.night.games.map((g) => [g.id, g]));
            for (const g of m.games as Game[]) games.set(g.id, { ...games.get(g.id), ...g });
            const pgs = new Map(r.night.pgs.map((p) => [`${p.game_id}:${p.player_id}`, p]));
            for (const p of m.pgs as RoomLine[]) pgs.set(`${p.game_id}:${p.player_id}`, p);
            const swings = [...r.swings, ...(m.swings as Swing[])].slice(-150);
            return { ...r, night: { games: [...games.values()], snaps: (m.snaps as RoomSnap[] | undefined) ?? r.night.snaps, pgs: [...pgs.values()], at: m.at as number }, swings };
          });
          // one of your starters just scored: say so wherever you are
          const mine = (m.swings as Swing[]).filter((x) => x.kind === 'p' && x.team === meRef.current && (x.d ?? 0) > 0 && (x.what?.g || x.what?.a || x.what?.w || x.what?.sho));
          if (mine.length) setAlert(mine[mine.length - 1]);
        } else if (m.t === 'who') {
          setRoom((r) => ({ ...r, watching: m.teams as number[] }));
        } else if (m.t === 'rx') {
          setRoom((r) => ({ ...r, swings: r.swings.map((x) => (x.id === m.key ? { ...x, rx: m.rx as Record<string, string> } : x)) }));
        } else if (m.t === 'auth?') {
          hello(s, 'auth');
        } else if (m.t === 'denied') {
          // not a member of this league's room: the page keeps its own reads
          alive = false;
          setRoom(OFF);
        }
      };
      s.onclose = () => {
        if (ws.current === s) ws.current = null;
        if (!alive) return;
        // back in after a beat, a little longer each time it fails, never longer than half a minute
        const wait = Math.min(30_000, 1000 * 2 ** tries++);
        setRoom((r) => ({ ...r, status: 'connecting' }));
        timer = window.setTimeout(connect, wait);
      };
    };
    connect();
    // the site renews its sign-in about once an hour; the room gets the new one, so it can keep reading
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'TOKEN_REFRESHED' && ws.current) hello(ws.current, 'auth'); });
    // a quiet line can be dropped by a phone's network without either end noticing: a word every 25 seconds
    const ping = window.setInterval(() => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send('{"t":"ping"}'); }, 25_000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      sub.subscription.unsubscribe();
      ws.current?.close(1000);
      ws.current = null;
    };
  }, [want, leagueId, leagueDay]);

  const react = useCallback((key: number, e: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: 'react', key, e }));
  }, []);
  const value = useMemo(() => ({ ...room, react }), [room, react]);
  const clear = useCallback(() => setAlert(null), []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {alert && <GoalAlert swing={alert} name={players.get(alert.player!)?.name ?? 'Your player'} badge={team(alert.team)} onDone={clear} />}
    </Ctx.Provider>
  );
}

// the goal horn: one of your starters just scored, in a banner at the top of whatever page you're on
function GoalAlert({ swing, name, badge, onDone }: { swing: Swing; name: string; badge: Team | undefined; onDone: () => void }) {
  const navigate = useNavigate();
  useEffect(() => { const t = window.setTimeout(onDone, 7000); return () => window.clearTimeout(t); }, [swing.id, onDone]);
  const w = swingWords(swing.what);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[61] flex justify-center p-3 pt-safe">
      <button type="button" onClick={() => { onDone(); navigate('/scoreboard'); }}
        className="animate-slideup pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-goal/40 bg-[#0b1426]/90 px-3.5 py-2.5 text-left shadow-2xl shadow-black/50 backdrop-blur-xl">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-goal/25" />
          <TeamBadge team={badge} size={36} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold uppercase tracking-[.14em] text-goal">🚨 {w.head}</span>
          <span className="block break-words text-sm font-bold leading-tight text-white">{name}</span>
          {w.rest && <span className="block text-[11px] text-mute">{w.rest}</span>}
        </span>
        <span className="num shrink-0 rounded-xl bg-goal/15 px-2 py-1 font-display text-lg font-extrabold text-goal">+{fmtPts(swing.d)}</span>
      </button>
    </div>
  );
}
