// The league's draft room (worker/draft.ts, docs/DEVELOPMENT.md §8.3 E4). While the draft is on, the app joins its
// league's room at the edge over one WebSocket. The room keeps the pick clock: it asks for the pick the moment a clock
// runs out, and passes every pick to every phone the moment it is made. The store (lib/store) takes the room's word for
// the draft and stops asking the database every four seconds while the room is live. A pick, pause, resume or undo
// made from this phone is told to the room straight away, so everyone else sees it in a blink.
//
// Only on the product's own addresses, where the Worker runs; anywhere else the store keeps its realtime and its poll.
import { useEffect, useRef, useState } from 'react';
import { onRpc, supabase } from './supabase';
import type { DraftPick, DraftState } from './types';

const EDGE = typeof location !== 'undefined' && /(^|\.)superpools?ai\.com$/.test(location.hostname);
// the calls that move the draft
const MOVES = /^(draft_|commish_set_pick_owner$)/;

export type RoomPick = Pick<DraftPick, 'id' | 'overall' | 'round' | 'team_id' | 'player_id' | 'picked_at' | 'auto'>;

export function useDraftRoom(on: boolean, league: number | null, onDraft: (state: DraftState, picks: RoomPick[]) => void): boolean {
  const [live, setLive] = useState(false);
  const cb = useRef(onDraft);
  cb.current = onDraft;
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    // a phone put away for a minute leaves the room; it comes straight back when it's looked at again
    let t: number | undefined;
    const vis = () => {
      window.clearTimeout(t);
      if (document.visibilityState === 'visible') setVisible(true);
      else t = window.setTimeout(() => setVisible(false), 60_000);
    };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!EDGE || !on || league == null || !visible) { setLive(false); return; }
    let alive = true, tries = 0, timer: number | undefined, ws: WebSocket | null = null;
    const say = async (s: WebSocket, t: 'hello' | 'auth') => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ t, token }));
    };
    const connect = () => {
      if (!alive) return;
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${league}/draft`);
      ws = s;
      s.onopen = () => say(s, 'hello');
      s.onmessage = (ev) => {
        let m: { t: string; state?: DraftState | null; picks?: RoomPick[] };
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'draft') { tries = 0; setLive(true); if (m.state) cb.current(m.state, m.picks ?? []); }
        else if (m.t === 'auth?') say(s, 'auth');
        else if (m.t === 'denied') { alive = false; setLive(false); }
      };
      s.onclose = () => {
        if (ws === s) ws = null;
        setLive(false);
        if (!alive) return;
        timer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
      };
    };
    connect();
    const off = onRpc((fn) => { if (MOVES.test(fn) && ws?.readyState === WebSocket.OPEN) ws.send('{"t":"moved"}'); });
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'TOKEN_REFRESHED' && ws) say(ws, 'auth'); });
    const ping = window.setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}'); }, 25_000);
    return () => {
      alive = false;
      off();
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(ping);
      ws?.close(1000);
    };
  }, [on, league, visible]);
  return live;
}
