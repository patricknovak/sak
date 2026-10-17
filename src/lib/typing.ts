// "Terry is typing…" (16 October 2026): one realtime broadcast topic per league, shared by every chat on the page, that
// carries only who is typing and where. Nothing is stored; a ping lasts a few seconds. Private lines (the voice's, a
// DM) never ping.
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Ping = { team: number; channel: string; at: number };
let ch: RealtimeChannel | null = null;
let topicLeague: number | null = null;
let refs = 0;
const listeners = new Set<(p: Ping) => void>();

function join(league: number) {
  if (ch && topicLeague === league) { refs++; return; }
  if (ch) { supabase.removeChannel(ch); ch = null; }
  topicLeague = league; refs = 1;
  ch = supabase.channel(`typing:${league}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => { const p = payload as Ping; listeners.forEach((f) => f({ ...p, at: Date.now() })); });
  ch.subscribe();
}
function leave() {
  refs = Math.max(0, refs - 1);
  if (!refs && ch) { supabase.removeChannel(ch); ch = null; topicLeague = null; }
}

let last = 0;
export function pingTyping(team: number, channel: string) {
  if (!ch || channel.startsWith('dm:') || channel.startsWith('garry:')) return;
  const now = Date.now();
  if (now - last < 2500) return;
  last = now;
  ch.send({ type: 'broadcast', event: 'typing', payload: { team, channel } }).catch(() => {});
}

// who is typing in the channels a chat shows, the last few seconds
export function useTyping(league: number | null, shows: (channel: string) => boolean): number[] {
  const [pings, setPings] = useState<Map<number, number>>(new Map());
  const test = useRef(shows);
  test.current = shows;
  useEffect(() => {
    if (league == null) return;
    join(league);
    const on = (p: Ping) => { if (test.current(p.channel)) setPings((m) => new Map(m).set(p.team, p.at)); };
    listeners.add(on);
    const tick = setInterval(() => setPings((m) => { const n = new Map([...m].filter(([, at]) => Date.now() - at < 5000)); return n.size === m.size ? m : n; }), 1000);
    return () => { listeners.delete(on); clearInterval(tick); leave(); };
  }, [league]);
  return [...pings.keys()];
}
