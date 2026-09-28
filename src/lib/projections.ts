// Loaders for the heavier projection data, fetched only on the pages that need it and cached for the visit:
// every player's projected stat line, range and factors, and the rest of the season's NHL schedule.
import { useEffect, useState } from 'react';
import { selectAll } from './supabase';
import type { Game, ProjDetail } from './types';
import { etToday } from './format';

let detailCache: Promise<Map<number, ProjDetail>> | null = null;
let detailAt = 0;
export function loadProjDetails() {
  if (!detailCache || Date.now() - detailAt > 30 * 60_000) {
    detailAt = Date.now();
    detailCache = selectAll<ProjDetail>('players', 'id,proj_stats,proj_gp,proj_meta', 1000, ['id'])
      .then((rows) => new Map(rows.filter((r) => r.proj_stats || r.proj_meta).map((r) => [r.id, r])))
      .catch((e) => { detailCache = null; throw e; });
  }
  return detailCache;
}
export function useProjDetails() {
  const [m, setM] = useState<Map<number, ProjDetail> | null>(null);
  useEffect(() => { let on = true; loadProjDetails().then((x) => on && setM(x)).catch(() => on && setM(new Map())); return () => { on = false; }; }, []);
  return m;
}

let gamesCache: Promise<Game[]> | null = null;
let gamesAt = 0;
export function loadSeasonGames() {
  if (!gamesCache || Date.now() - gamesAt > 30 * 60_000) {
    gamesAt = Date.now();
    const today = etToday();
    gamesCache = selectAll<Game>('games', 'id,date,start_utc,home,away,state,home_score,away_score,period,clock', 1000, ['id'])
      .then((rows) => rows.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.start_utc.localeCompare(b.start_utc)))
      .catch((e) => { gamesCache = null; throw e; });
  }
  return gamesCache;
}
export function useSeasonGames() {
  const [g, setG] = useState<Game[] | null>(null);
  useEffect(() => { let on = true; loadSeasonGames().then((x) => on && setG(x)).catch(() => on && setG([])); return () => { on = false; }; }, []);
  return g;
}

// the stats worth projecting, by position group
export const PROJ_SK = ['g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'gwg'];
export const PROJ_G = ['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho', 'svp'];
export const toneCls = { good: 'text-emerald-300', bad: 'text-red-300', info: 'text-sky-200' } as const;
export const toneIcon = { good: '▲', bad: '▼', info: '•' } as const;
