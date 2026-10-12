// A prediction pool's live room for the day (worker/pool.ts, docs/DEVELOPMENT.md §8.3 E4). While a member has the
// pool's home open, the app joins the pool's room at the edge: the room reads the pool's table and today's games on its
// events once for everyone and pushes what moves (a game starting, a score, a final, a member climbing the table), and
// who's watching. Only on the product's own addresses, where the Worker runs; elsewhere the page keeps its own reads.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLeague } from './store';
import { supabase } from './supabase';
import { etToday } from './format';

export type PoolFixture = { id: number; competition: string; kickoff: string; home_club: number | null; away_club: number | null; home_abbr?: string; away_abbr?: string; state: string; minute: string | null; home_score: number | null; away_score: number | null };
export type PoolClub = { id: number; short: string | null; name: string; color: string | null };
export type PoolTable = { key: string; title: string; kind: string; rows: { team_id: number; rank: number; score: number }[] } | null;
export type PoolSwing = {
  id: number; at: string; kind: 'g' | 't';
  fixture?: number; score?: [number | null, number | null]; state?: string; minute?: string | null;
  team?: number; from?: number; to?: number; title?: string;
};
// cheer: the side you picked just scored (your pick'em pick, your last-one-standing club), for the banner
export type Cheer = { id: number; fixture: number; side: 'H' | 'A' };
export type PoolRoom = { live: boolean; watching: number[]; fixtures: PoolFixture[]; clubs: Map<number, PoolClub>; table: PoolTable; swings: PoolSwing[]; cheer?: Cheer | null; clearCheer?: () => void };
const EMPTY: PoolRoom = { live: false, watching: [], fixtures: [], clubs: new Map(), table: null, swings: [] };
const EDGE = typeof location !== 'undefined' && /(^|\.)superpools?ai\.com$/.test(location.hostname);

// onTable: the table moved (a member climbed or fell), so the page can read its own board again
export function usePoolRoom(onTable?: () => void): PoolRoom {
  const { session, me, league, kind } = useLeague();
  const [room, setRoom] = useState<PoolRoom>(EMPTY);
  const [cheer, setCheer] = useState<Cheer | null>(null);
  // the side of each of today's games the member is on: a pick'em pick (home or away), a last-one-standing club
  const picks = useRef<Map<number, 'H' | 'A'>>(new Map());
  const scores = useRef<Map<number, [number, number]>>(new Map());
  const cb = useRef(onTable);
  cb.current = onTable;
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    let t: number | undefined;
    const vis = () => { window.clearTimeout(t); if (document.visibilityState === 'visible') setVisible(true); else t = window.setTimeout(() => setVisible(false), 60_000); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); window.clearTimeout(t); };
  }, []);
  const lid = league?.league_id ?? null;
  const on = EDGE && !!session && !!me && lid != null && kind === 'predict' && visible;

  useEffect(() => {
    if (!on || lid == null) { setRoom(EMPTY); return; }
    let alive = true, tries = 0, timer: number | undefined, ws: WebSocket | null = null;
    const say = async (s: WebSocket, t: 'hello' | 'auth') => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t, token: data.session.access_token }));
    };
    const clubs = (list: PoolClub[] | undefined, prev: Map<number, PoolClub>) => (list?.length ? new Map(list.map((c) => [c.id, c])) : prev);
    const connect = () => {
      if (!alive) return;
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${lid}/pool/${etToday()}`);
      ws = s;
      s.onopen = () => say(s, 'hello');
      s.onmessage = (ev) => {
        let m: { t: string } & Record<string, unknown>;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pool') {
          tries = 0;
          for (const f of m.fixtures as PoolFixture[]) scores.current.set(f.id, [f.home_score ?? 0, f.away_score ?? 0]);
          setRoom((r) => ({ ...r, live: true, fixtures: m.fixtures as PoolFixture[], table: m.table as PoolTable, clubs: clubs(m.clubs as PoolClub[], r.clubs), swings: m.swings as PoolSwing[] }));
        } else if (m.t === 'tick') {
          // a score for the side you're on: say so (the room's scores, against the last ones it sent)
          for (const f of m.fixtures as PoolFixture[]) {
            const was = scores.current.get(f.id), side = picks.current.get(f.id);
            if (was && side && (side === 'H' ? (f.home_score ?? 0) > was[0] : (f.away_score ?? 0) > was[1])) setCheer({ id: Date.now(), fixture: f.id, side });
            scores.current.set(f.id, [f.home_score ?? 0, f.away_score ?? 0]);
          }
          setRoom((r) => {
            const fx = new Map(r.fixtures.map((f) => [f.id, f]));
            for (const f of m.fixtures as PoolFixture[]) fx.set(f.id, f);
            return { ...r, fixtures: (m.all as PoolFixture[] | undefined) ?? [...fx.values()], table: (m.table as PoolTable | undefined) ?? r.table, clubs: clubs(m.clubs as PoolClub[], r.clubs), swings: [...r.swings, ...(m.swings as PoolSwing[])].slice(-120) };
          });
          if (m.table) cb.current?.();
        } else if (m.t === 'who') setRoom((r) => ({ ...r, watching: m.teams as number[] }));
        else if (m.t === 'auth?') say(s, 'auth');
        else if (m.t === 'denied') { alive = false; setRoom(EMPTY); }
      };
      s.onclose = () => {
        if (ws === s) ws = null;
        setRoom((r) => ({ ...r, live: false }));
        if (alive) timer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
      };
    };
    connect();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === 'TOKEN_REFRESHED' && ws) say(ws, 'auth'); });
    const ping = window.setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}'); }, 25_000);
    return () => { alive = false; sub.subscription.unsubscribe(); window.clearTimeout(timer); window.clearInterval(ping); ws?.close(1000); };
  }, [on, lid]);

  // the member's own picks on today's games, read when the day's games are known (picks are theirs to read any time)
  const ids = room.fixtures.filter((f) => !f.home_abbr).map((f) => f.id).sort().join(',');
  useEffect(() => {
    if (!room.live || !me || !ids) return;
    let alive = true;
    supabase.from('pool_picks').select('thing,pick').eq('team_id', me.id).order('id', { ascending: false }).limit(500).then(({ data }) => {
      if (!alive) return;
      const today = new Map(room.fixtures.map((f) => [f.id, f]));
      const m = new Map<number, 'H' | 'A'>();
      for (const r of (data ?? []) as { thing: string; pick: { pick?: string; fixture?: number; club?: number } }[]) {
        if (r.thing.startsWith('f:') && (r.pick?.pick === 'H' || r.pick?.pick === 'A')) m.set(Number(r.thing.slice(2)), r.pick.pick);
        else if (r.thing.startsWith('gw:') && r.pick?.fixture && today.has(r.pick.fixture)) m.set(r.pick.fixture, today.get(r.pick.fixture)!.home_club === r.pick.club ? 'H' : 'A');
      }
      picks.current = m;
    });
    return () => { alive = false; };
  }, [room.live, ids, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearCheer = useCallback(() => setCheer(null), []);
  return { ...room, cheer, clearCheer };
}
