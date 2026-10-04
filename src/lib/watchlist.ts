// A GM's watch list (migration 140): players they've starred to keep an eye on, anyone in the league, free agent or not.
// Loaded once per team and shared by every star on screen, so starring a player on his card lights him up on the Players
// page at once. When another team drops a player on it, the GM hears about it (a 'watch' notification).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useLeague } from './store';

let cache: { team: number; ids: Set<number>; loaded: boolean } | null = null;
// what the GM changed before the list finished loading (player → starred): a load that lands after a tap mustn't undo
// it, even when the tap has already been saved
const overlay = new Map<number, boolean>();
// taps still on their way to the server: a second tap on the same player waits for the first
const inflight = new Set<number>();
// bumped after a failed load, so the pages already open try again (after a pause, not in a loop)
let attempt = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const EMPTY = new Set<number>();

export function useWatchlist() {
  const { me } = useLeague();
  const team = me && me.role !== 'spectator' ? me.id : null;
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const tries = attempt;
  useEffect(() => {
    if (!team || cache?.team === team) return;
    cache = { team, ids: new Set(), loaded: false };
    overlay.clear(); inflight.clear();
    const mine = cache;
    supabase.from('watchlist').select('player_id').eq('team_id', team).then(({ data, error }) => {
      if (cache !== mine) return;
      if (error) { cache = null; setTimeout(() => { attempt += 1; emit(); }, 5000); return; }
      const ids = new Set(((data ?? []) as { player_id: number }[]).map((r) => r.player_id));
      for (const [id, on] of overlay) { if (on) ids.add(id); else ids.delete(id); }
      overlay.clear();
      mine.ids = ids; mine.loaded = true;
      emit();
    });
  }, [team, tries]);
  const ids = team && cache?.team === team ? cache.ids : EMPTY;
  // star or unstar: the screen changes at once and goes back if the server says no
  const toggle = useCallback(async (id: number) => {
    if (!team || cache?.team !== team) throw new Error('Your watch list is still loading. Try again in a moment.');
    if (inflight.has(id)) throw new Error('One moment: the last tap is still saving.');
    const c = cache, was = c.ids.has(id);
    const flip = (on: boolean) => { const n = new Set(c.ids); if (on) n.add(id); else n.delete(id); c.ids = n; emit(); };
    inflight.add(id);
    if (!c.loaded) overlay.set(id, !was);
    flip(!was);
    try {
      const { error } = was
        ? await supabase.from('watchlist').delete().eq('team_id', team).eq('player_id', id)
        : await supabase.from('watchlist').insert({ team_id: team, player_id: id });
      // already there (starred on another phone): that's what was wanted
      if (error && error.code !== '23505') {
        if (cache === c) { overlay.delete(id); flip(was); }
        throw error;
      }
      return !was;
    } finally { if (cache === c) inflight.delete(id); }
  }, [team]);
  return { on: !!team, loaded: !!team && cache?.team === team && cache.loaded, ids, toggle };
}
