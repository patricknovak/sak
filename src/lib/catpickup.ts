// What a player is worth to a category league's lineup, night by night, for the pickup advisor. A points league asks
// "how many points does he add"; a category league asks "what does he do for the categories I'm losing". So:
//
// * Each stat a category needs, per game: last season's pace, trusted less as this season's games pile up (half and
//   half at 30 games, as the points projection does).
// * Each category's contribution per game: a counting stat as it is (hits are hits); a rate (save percentage, goals
//   against per start) as what the player does to it against the league's average goalie: saves above that average's
//   share of his shots, goals against under it.
// * On one scale: each category divided by how much it varies across the draftable pool (the top 250 skaters or 50
//   goalies by projection, as category_values() picks them), so ten hits and a goal weigh what they're worth.
// * Weighted to the team's needs: a category the team trails in counts up to three times one it leads.
// Pure functions; the advisor runs them through the same night-by-night lineup forecast as the points version.

export interface CatDef { key: string; low?: boolean; num?: string; den?: string }
export interface CatPlayer { id: number; pos: string; proj: number; proj_gp?: number | null; last_stats: Record<string, number> | null }
export interface CatSeasonLine { gp: number; totals: Record<string, number | null | undefined> }

const GOALIE = new Set(['w', 'sho', 'sv', 'gaa', 'svp']);
export const isGoalieCat = (k: string) => GOALIE.has(k);
const RATES: Record<string, { num: string; den: string; low: boolean }> = { gaa: { num: 'ga', den: 'gs', low: true }, svp: { num: 'sv', den: 'sa', low: false } };
const group = (p: { pos: string }) => (p.pos === 'G' ? 'G' : 'S');
const catsFor = (cats: string[], p: { pos: string }) => cats.filter((k) => isGoalieCat(k) === (p.pos === 'G'));
const statKeys = (k: string) => (RATES[k] ? [RATES[k].num, RATES[k].den] : [k]);

// each stat the categories need, per game played; null for a player with no record to go on
export function perGame(p: CatPlayer, s: CatSeasonLine | undefined, cats: string[]): Record<string, number> | null {
  const last = p.last_stats, lastGp = Number(last?.gp ?? 0), gp = s?.gp ?? 0;
  if (lastGp < 1 && gp < 1) return null;
  const w = gp / (gp + 30);
  const out: Record<string, number> = {};
  for (const k of catsFor(cats, p).flatMap(statKeys)) {
    const base = lastGp >= 1 ? Number(last?.[k] ?? 0) / lastGp : null;
    const now = gp >= 1 ? Number(s?.totals?.[k] ?? 0) / gp : null;
    out[k] = base == null ? now! : now == null ? base : (1 - w) * base + w * now;
  }
  return out;
}

export interface CatModel {
  cats: string[];
  avg: Record<string, number>;        // the pool's rate for save percentage and goals against per start
  scale: Record<string, number>;      // how much each category's per-game contribution varies across the pool
  weight: Record<string, number>;     // the team's need in each category (1 = even)
}

// a category's contribution per game played, before scaling
export function contribution(k: string, r: Record<string, number>, avg: Record<string, number>) {
  const rate = RATES[k];
  if (!rate) return r[k] ?? 0;
  const above = (r[rate.num] ?? 0) - (avg[k] ?? 0) * (r[rate.den] ?? 0);
  return rate.low ? -above : above;
}

const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

// the scales from the draftable pool, the weights from the team's place in each category (rotisserie points, first
// = as many as there are teams): last place weighs 1.5, first 0.5, even 1 until the table separates
export function buildModel(cats: string[], players: CatPlayer[], season: Map<number, CatSeasonLine>, need?: { pts: Record<string, number>; teams: number }): CatModel {
  const known = players.filter((p) => Number(p.last_stats?.gp ?? 0) >= 10);
  const pool = (['S', 'G'] as const).flatMap((g) => known.filter((p) => group(p) === g).sort((a, b) => b.proj - a.proj).slice(0, g === 'S' ? 250 : 50));
  const rates = new Map(pool.map((p) => [p.id, perGame(p, season.get(p.id), cats)]));
  const avg: Record<string, number> = {};
  for (const [k, def] of Object.entries(RATES)) {
    if (!cats.includes(k)) continue;
    const gs = pool.filter((p) => p.pos === 'G');
    const num = gs.reduce((t, p) => t + Number(p.last_stats?.[def.num] ?? 0), 0), den = gs.reduce((t, p) => t + Number(p.last_stats?.[def.den] ?? 0), 0);
    avg[k] = den > 0 ? num / den : 0;
  }
  const scale: Record<string, number> = {};
  for (const k of cats) {
    const xs = pool.filter((p) => isGoalieCat(k) === (p.pos === 'G')).map((p) => rates.get(p.id)).filter((r): r is Record<string, number> => !!r).map((r) => contribution(k, r, avg));
    scale[k] = sd(xs) || 1;
  }
  const weight: Record<string, number> = {};
  const spread = need ? new Set(cats.map((k) => need.pts[k])).size > 1 : false;
  for (const k of cats) weight[k] = need && spread && need.teams > 1 && need.pts[k] != null ? 0.5 + (need.teams - need.pts[k]) / (need.teams - 1) : 1;
  return { cats, avg, scale, weight };
}

// one number per game for the lineup forecast: the player's weighted, scaled contributions summed
export function scorePerGame(m: CatModel, r: Record<string, number> | null, p: { pos: string }) {
  if (!r) return 0;
  return catsFor(m.cats, p).reduce((t, k) => t + (m.weight[k] * contribution(k, r, m.avg)) / m.scale[k], 0);
}

// the move's effect on each category over the stretch: every rostered player's expected starts after the move less
// before it, times what he does per game. Counting stats in their own units; a rate as its scaled contribution, since
// what a goalie does to a team's save percentage depends on the rest of its goalies.
export function categoryDelta(m: CatModel, rates: Map<number, Record<string, number> | null>, pos: Map<number, string>, before: Map<number, { starts: number }>, after: Map<number, { starts: number }>) {
  const out: Record<string, number> = {};
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(id)?.starts ?? 0) - (before.get(id)?.starts ?? 0), r = rates.get(id), p = pos.get(id);
    if (!d || !r || !p) continue;
    for (const k of catsFor(m.cats, { pos: p })) out[k] = (out[k] ?? 0) + d * (RATES[k] ? contribution(k, r, m.avg) / m.scale[k] : r[k] ?? 0);
  }
  return out;
}

// A category league's per-game value on a points scale, for the engines that weigh players in points (the trade
// evaluator, its schedule lineup): the player's category score (the team's needs left out: a trade has two teams),
// scaled per group so the typical rostered skater, and the typical rostered goalie, is worth what his points say.
// A player the categories rate below nothing is worth nothing.
export function pointsScale(m: CatModel, rates: Map<number, Record<string, number> | null>, players: CatPlayer[], pointsPerGame: (p: CatPlayer) => number, rostered: Set<number>) {
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 1; };
  const scale: Record<string, number> = {};
  for (const g of ['S', 'G']) {
    const ratios = players.filter((p) => rostered.has(p.id) && group(p) === g).map((p) => {
      const s = scorePerGame(m, rates.get(p.id) ?? null, p), pts = pointsPerGame(p);
      return s > 0 && pts > 0 ? pts / s : null;
    }).filter((x): x is number => x != null);
    scale[g] = ratios.length ? median(ratios) : 1;
  }
  return (p: CatPlayer) => Math.max(0, scorePerGame(m, rates.get(p.id) ?? null, p)) * scale[group(p)];
}
