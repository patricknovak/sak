// What the market expected from a match before kick-off (migration 178): each side's chance with the bookmaker's margin
// taken out, read from the shared fixtures, for any page that shows matches to pick. Chances only: never a price to bet.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface MarketOdds { home: number; away: number; draw: number | null; line: number | null; total: number | null }

export function useMarket(ids: number[]) {
  const [map, setMap] = useState<Map<number, MarketOdds>>(new Map());
  const key = [...ids].sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!ids.length) { setMap(new Map()); return; }
    let live = true;
    supabase.from('fixtures').select('id,detail').in('id', ids).then(({ data }) => {
      if (!live) return;
      const m = new Map<number, MarketOdds>();
      for (const r of (data ?? []) as { id: number; detail: { odds?: MarketOdds } | null }[]) if (r.detail?.odds) m.set(r.id, r.detail.odds);
      setMap(m);
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}

export const chance = (x: number | null | undefined) => (x == null ? null : `${Math.round(x * 100)}%`);
