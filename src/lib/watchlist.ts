// A GM's watch list (migration 140): players they've starred to keep an eye on, anyone in the league, free agent or not.
// Loaded once per team and shared by every star on screen, so starring a player on his card lights him up on the Players
// page at once. When another team drops a player on it, the GM hears about it (a 'watch' notification).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useLeague } from './store';

let cache: { team: number; ids: Set<number> } | null = null;
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
    cache = { team, ids: new Set() };
    supabase.from('watchlist').select('player_id').eq('team_id', team).then(({ data }) => {
      if (cache?.team !== team) return;
      cache.ids = new Set(((data ?? []) as { player_id: number }[]).map((r) => r.player_id));
      emit();
    });
  }, [team]);
  const ids = team && cache?.team === team ? cache.ids : EMPTY;
  // star or unstar: the screen changes at once and goes back if the server says no
  const toggle = useCallback(async (id: number) => {
    if (!team || cache?.team !== team) return false;
    const c = cache, was = c.ids.has(id);
    const flip = (on: boolean) => { const n = new Set(c.ids); if (on) n.add(id); else n.delete(id); c.ids = n; emit(); };
    flip(!was);
    const { error } = was
      ? await supabase.from('watchlist').delete().eq('team_id', team).eq('player_id', id)
      : await supabase.from('watchlist').insert({ team_id: team, player_id: id });
    if (error) { flip(was); throw error; }
    return !was;
  }, [team]);
  return { on: !!team, ids, toggle };
}
