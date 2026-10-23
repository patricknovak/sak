// Lounges (migration 333): one chat per sports league or show, shared by everyone in Super Pools whose pools follow it.
// A post carries the pool it came from (from_league), so the room can be narrowed to the caller's own pool; a stranger
// sees only a first name and an initial. Read straight from lounge_messages (row-level security keeps each member to
// the rooms of their pools) and kept live through realtime: a new post arrives as an insert, a removed one as a delete.
import { useCallback, useEffect, useState } from 'react';
import { rpc, supabase } from './supabase';

export interface Lounge {
  key: string;
  name: string;
  emoji: string;
  here: boolean;
  pools: { id: number; name: string }[] | null;
  today: number;
  last_at: string | null;
}
export interface LoungeMessage { id: number; lounge: string; from_league: number; author: string; body: string; created_at: string }

const PAGE = 60;

// the rooms of the caller's pools, the ones the pool open now is in first
export function useLounges() {
  const [lounges, setLounges] = useState<Lounge[] | null>(null);
  const load = useCallback(() => rpc<Lounge[]>('my_lounges').then((l) => setLounges(l ?? []), () => setLounges([])), []);
  useEffect(() => { load(); }, [load]);
  return { lounges, reload: load };
}

// the posts this device wrote, so it can offer to take them down (who wrote a post isn't in the shared row)
const MINE = 'sp-lounge-mine';
export const myPosts = (): Set<number> => {
  try { return new Set(JSON.parse(localStorage.getItem(MINE) ?? '[]') as number[]); } catch { return new Set(); }
};
const rememberMine = (id: number) => {
  try { localStorage.setItem(MINE, JSON.stringify([...myPosts(), id].slice(-300))); } catch { /* nothing to remember with */ }
};

// one room's posts, oldest first, live
export function useLoungeFeed(key: string | null) {
  const [msgs, setMsgs] = useState<LoungeMessage[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!key) return;
    setFailed(false);
    const { data, error } = await supabase.from('lounge_messages').select('*').eq('lounge', key).order('id', { ascending: false }).limit(PAGE);
    if (error) { setFailed(true); setMsgs((m) => m ?? []); return; }
    const rows = (data ?? []) as LoungeMessage[];
    setMsgs(rows.reverse());
    setMore(rows.length === PAGE);
  }, [key]);
  useEffect(() => {
    setMsgs(null);
    if (!key) return;
    load();
    const ch = supabase.channel(`lounge:${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lounge_messages', filter: `lounge=eq.${key}` }, (p) => {
        const m = p.new as LoungeMessage;
        setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
      })
      // a delete carries only the id, whichever room it was in
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lounge_messages' }, (p) => {
        const id = (p.old as { id?: number }).id;
        if (id != null) setMsgs((cur) => cur?.filter((x) => x.id !== id) ?? cur);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [key, load]);
  const earlier = useCallback(async () => {
    if (!key || !msgs?.length) return;
    const { data } = await supabase.from('lounge_messages').select('*').eq('lounge', key).lt('id', msgs[0].id).order('id', { ascending: false }).limit(PAGE);
    const rows = ((data ?? []) as LoungeMessage[]).reverse();
    setMsgs((cur) => [...rows, ...(cur ?? [])]);
    setMore(rows.length === PAGE);
  }, [key, msgs]);
  const post = useCallback(async (body: string) => {
    const id = await rpc<number>('lounge_post', { p_lounge: key, p_body: body });
    rememberMine(id);
    return id;
  }, [key]);
  const remove = useCallback(async (id: number) => {
    await rpc('lounge_remove', { p_id: id });
    setMsgs((cur) => cur?.filter((x) => x.id !== id) ?? cur);
  }, []);
  const report = useCallback((id: number) => rpc<string>('lounge_report', { p_id: id }), []);
  return { msgs, more, failed, reload: load, earlier, post, remove, report };
}
