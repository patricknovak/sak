// The Performance page's arithmetic, shared by its stretch view and the weekly review: the rows its two reads return
// (performance_days, performance_players, lineup_efficiency), one team's totals over a stretch, a category's value from
// summed box-score stats, and the rotisserie points a stretch earns team against team, as category_standings counts
// the season.
import { categoryOf } from './categories';

export type Day = { team_id: number; date: string; game_type: number; points: number; bench: number; goalie_points: number; starters: number; benched: number; stats: Record<string, number>; bench_stats: Record<string, number> };
export type PP = { team_id: number; player_id: number; started: number; benched: number; points: number; bench: number; stats: Record<string, number> };
// a team's night against the best lineup it could have played from the same players (lineup_efficiency)
export type Eff = { team_id: number; date: string; game_type: number; points: number; best: number };

export const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
export const num = (o: Record<string, number> | null | undefined, k: string) => Number(o?.[k] ?? 0);
export const fmtCat = (k: string, v: number) => {
  if (!Number.isFinite(v)) return '–';
  const rate = categoryOf(k)?.rate;
  if (rate === 'pct') return v.toFixed(3).replace(/^0/, '');
  if (rate === 'avg') return v.toFixed(2);
  return k === 'pm' && v > 0 ? `+${v}` : String(Math.round(v * 10) / 10);
};
// a category's value from summed box-score stats: a rate from its totals (no starts behind it: no value)
export const catVal = (o: Record<string, number> | null | undefined, k: string): number =>
  k === 'gaa' ? (num(o, 'gs') ? num(o, 'ga') / num(o, 'gs') : NaN)
  : k === 'svp' ? (num(o, 'sa') ? num(o, 'sv') / num(o, 'sa') : NaN)
  : k === 'pts' && o?.pts == null ? num(o, 'g') + num(o, 'a') : num(o, k);
export const GOALIE_KEYS = new Set([...['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'], 'sa', 'gaa', 'svp']);
export const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

// one team's totals over a range
export interface Agg { team_id: number; points: number; bench: number; goalie: number; days: number; starters: number; cats: Record<string, number>; daily: number[]; dates: string[] }
export function aggregate(rows: Day[], teamIds: number[]): Agg[] {
  return teamIds.map((id) => {
    const mine = rows.filter((r) => r.team_id === id).sort((a, b) => a.date.localeCompare(b.date));
    const cats: Record<string, number> = {};
    for (const r of mine) for (const [k, v] of Object.entries(r.stats)) cats[k] = (cats[k] ?? 0) + Number(v);
    return {
      team_id: id, points: mine.reduce((n, r) => n + r.points, 0), bench: mine.reduce((n, r) => n + r.bench, 0), goalie: mine.reduce((n, r) => n + r.goalie_points, 0),
      days: mine.length, starters: mine.reduce((n, r) => n + r.starters, 0), cats, daily: mine.map((r) => r.points), dates: mine.map((r) => r.date),
    };
  });
}
// rank of a value among a list, 1 = best; low numbers win for the categories that hurt
export const rankOf = (v: number, all: number[], lowerIsBetter = false) => all.filter((x) => (lowerIsBetter ? x < v : x > v)).length + 1;

// rotisserie points over a stretch: in each category first earns as many as there are teams, last one, ties share
// (a rate with nothing behind it is last), as category_standings counts the season
export function rotoTable(aggs: Agg[], cats: string[], isLow: (k: string) => boolean) {
  const out = new Map<number, { total: number; place: Record<string, number> }>(aggs.map((a) => [a.team_id, { total: 0, place: {} }]));
  const n = aggs.length;
  for (const k of cats) {
    const vals = aggs.map((a) => ({ id: a.team_id, v: catVal(a.cats, k) }));
    const better = (x: number, y: number) => (!Number.isFinite(y) ? Number.isFinite(x) : Number.isFinite(x) && (isLow(k) ? x < y : x > y));
    for (const me of vals) {
      const ahead = vals.filter((o) => better(o.v, me.v)).length;
      const tied = vals.filter((o) => o.v === me.v || (!Number.isFinite(o.v) && !Number.isFinite(me.v))).length;
      const e = out.get(me.id)!;
      e.total += n + 1 - (ahead + 1 + (tied - 1) / 2);
      e.place[k] = ahead + 1;
    }
  }
  return out;
}
