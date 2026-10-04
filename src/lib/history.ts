import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useLeague } from './store';

// A league's past, from its own rows in the database (migration 89: league_seasons, season_results, league_all_time,
// league_trophies, league_timeline, league_rule_text). SaK's was loaded from the old src/data/history.ts; a new
// league starts with none, and imports add theirs. Every page reads the same copy, fetched once per league.

export interface SeasonRow { team: string; gm: string; points: number; prize?: number; peter?: boolean; note?: string; teamId?: number | null }
export interface Season { season: string; note?: string; peterPenalty?: number; rows: SeasonRow[] }
export interface AllTimeRow { teamId: number; franchise: string; points: number; credit: boolean }
export interface History {
  loaded: boolean;
  seasons: Season[];                          // newest first, each season's rows in finishing order
  allTime: AllTimeRow[];                      // most points first
  baseCount: number;                          // franchises on the official all-time table the league started from
  baseThrough: string | null;                 // the last season that table covers
  trophies: { name: string; since: string; emoji: string; desc: string }[];
  timeline: { when: string; what: string }[];
  rules: { title: string; items: string[] }[];
  franchiseOf: (gm: string) => number | undefined;   // the franchise (team id) a GM's past rows belong to
}

const EMPTY: History = { loaded: false, seasons: [], allTime: [], baseCount: 0, baseThrough: null, trophies: [], timeline: [], rules: [], franchiseOf: () => undefined };
const cache = new Map<number, Promise<History>>();

const num = (v: unknown) => (v == null ? undefined : Number(v));

async function load(): Promise<History> {
  const [s, r, a, b, t, tl, rt] = await Promise.all([
    supabase.from('league_seasons').select('season,note,penalty,sort').order('sort', { ascending: false }),
    supabase.from('season_results').select('season,place,team_name,gm_name,team_id,points,prize,last_place,note').order('season', { ascending: false }).order('place'),
    supabase.from('league_all_time').select('franchise,team_id,points,credit'),
    supabase.from('league_all_time_base').select('franchise,through_season'),
    supabase.from('league_trophies').select('name,since,emoji,description,sort').order('sort'),
    supabase.from('league_timeline').select('when_label,what,sort').order('sort'),
    supabase.from('league_rule_text').select('title,items,sort').order('sort'),
  ]);
  const err = [s, r, a, b, t, tl, rt].find((x) => x.error)?.error;
  if (err) throw err;
  const rows = r.data ?? [];
  const seasons: Season[] = (s.data ?? []).map((x) => ({
    season: x.season, note: x.note ?? undefined, peterPenalty: num(x.penalty),
    rows: rows.filter((y) => y.season === x.season).map((y) => ({
      team: y.team_name, gm: y.gm_name, points: Number(y.points), prize: num(y.prize), peter: y.last_place || undefined,
      note: y.note ?? undefined, teamId: y.team_id,
    })),
  }));
  // a GM's franchise is the team id on their rows (newest first, so a GM who moved franchises reads as today's)
  const fr = new Map<string, number>();
  for (const y of rows) if (y.team_id != null && !fr.has(y.gm_name)) fr.set(y.gm_name, y.team_id);
  const base = b.data ?? [];
  return {
    loaded: true,
    seasons,
    allTime: (a.data ?? []).map((x) => ({ teamId: x.team_id, franchise: x.franchise, points: Number(x.points), credit: !!x.credit })).sort((x, y) => y.points - x.points),
    baseCount: base.length,
    baseThrough: base.reduce<string | null>((m, x) => (m == null || x.through_season > m ? x.through_season : m), null),
    trophies: (t.data ?? []).map((x) => ({ name: x.name, since: x.since ?? '', emoji: x.emoji ?? '🏆', desc: x.description ?? '' })),
    timeline: (tl.data ?? []).map((x) => ({ when: x.when_label, what: x.what })),
    rules: (rt.data ?? []).map((x) => ({ title: x.title, items: x.items ?? [] })),
    franchiseOf: (gm: string) => fr.get(gm),
  };
}

// the caller's league's history; empty (loaded: false) until it arrives
export function useHistory(): History {
  const { league } = useLeague();
  const lid = league?.league_id;
  const [h, setH] = useState<History>(EMPTY);
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((x) => x + 1);
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  useEffect(() => {
    if (!lid) return;
    let alive = true;
    if (!cache.has(lid)) cache.set(lid, load().catch((e) => { cache.delete(lid); throw e; }));
    cache.get(lid)!.then((x) => { if (alive) setH(x); }, () => {});
    return () => { alive = false; };
  }, [lid, v]);
  return h;
}

// after the commissioner writes the league's past: every page reading it fetches it again
const CHANGED = 'sak-history-changed';
export function historyChanged(lid: number | undefined) {
  if (lid) cache.delete(lid);
  window.dispatchEvent(new Event(CHANGED));
}
