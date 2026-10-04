// A GM's watch list (migration 140): players they've starred to keep an eye on, anyone in the league, free agent or not.
// Loaded once per team and shared by every star on screen, so starring a player on his card lights him up on the Players
// page at once. When another team drops a player on it, the GM hears about it (a 'watch' notification).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useLeague } from './store';

let cache: { team: number; ids: Set<number>; loaded: boolean } | null = null;
// stars on their way to the server (player → starred), so a load that lands after a tap doesn't undo it, and a second tap
// on the same player waits for the first
const pending = new Map<number, boolean>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const EMPTY = new Set<number>();

export function useWatchlist() {
  const { me } = useLeague();
  const team = me && me.role !== 'spectator' ? me.id : null;
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  useEffect(() => {
    if (!team || cache?.team === team) return;
    cache = { team, ids: new Set(), loaded: false };
    pending.clear();
    supabase.from('watchlist').select('player_id').eq('team_id', team).then(({ data, error }) => {
      if (cache?.team !== team) return;
      // a failed load is tried again the next time a page asks
      if (error) { cache = null; emit(); return; }
      const ids = new Set(((data ?? []) as { player_id: number }[]).map((r) => r.player_id));
      for (const [id, on] of pending) { if (on) ids.add(id); else ids.delete(id); }
      cache.ids = ids; cache.loaded = true;
      emit();
    });
  }, [team]);
  const ids = team && cache?.team === team ? cache.ids : EMPTY;
  // star or unstar: the screen changes at once and goes back if the server says no
  const toggle = useCallback(async (id: number) => {
    if (!team || cache?.team !== team || pending.has(id)) return false;
    const c = cache, was = c.ids.has(id);
    const flip = (on: boolean) => { const n = new Set(c.ids); if (on) n.add(id); else n.delete(id); c.ids = n; emit(); };
    pending.set(id, !was);
    flip(!was);
    try {
      const { error } = was
        ? await supabase.from('watchlist').delete().eq('team_id', team).eq('player_id', id)
        : await supabase.from('watchlist').insert({ team_id: team, player_id: id });
      // already there (starred on another phone): that's what was wanted
      if (error && error.code !== '23505') { if (cache === c) flip(was); throw error; }
      return !was;
    } finally { if (cache === c) pending.delete(id); }
  }, [team]);
  return { on: !!team, loaded: !!team && cache?.team === team && cache.loaded, ids, toggle };
}
