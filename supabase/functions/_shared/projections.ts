// The SAK projection model. Pure TypeScript (no Deno or DOM APIs) so it runs in the nhl-sync edge function and
// can be checked anywhere.
//
// For every player with NHL games in the last three seasons it projects a full stat line for the coming season:
//   • rates per game from the last three seasons, weighted 5 / 3 / 2 (newest first) by games played, and pulled
//     toward a replacement-level prior for the position so a 20-game sample can't look like a star
//   • goals = projected shots × a shooting % regressed toward the position's norm (so last year's 20% shooter
//     is expected to cool off, and the unlucky one to bounce back)
//   • an age curve: young players improve, veterans decline
//   • games played from how often he actually dressed, then docked for a current injury
//   • goalies: projected starts from their share of the crease, per-start wins, shots and save % regressed to
//     the league
// It also returns a range (a bad year / a great year), the factors behind the number in plain English, and
// each of the last three seasons under the league's scoring.

export type Scoring = { skater: Record<string, number>; goalie: Record<string, number> };

export interface SkaterSeason {
  season: number; gp: number; g: number; a: number; pm: number; pim: number; ppg: number; ppp: number; shp: number;
  gwg: number; sog: number; hit: number; blk: number; fow: number; fol: number; toi: number; pptoi: number; team: string;
}
export interface GoalieSeason { season: number; gp: number; gs: number; w: number; l: number; otl: number; ga: number; sa: number; sv: number; sho: number; team: string }
export interface ProjPlayer { id: number; pos: string; birth: string | null; nhl_team: string | null; injury_status: string | null }

export interface Factor { tone: 'good' | 'bad' | 'info'; text: string }
export interface ProjMeta {
  lo: number; hi: number;               // range as multiples of the projection (a bad year / a great year)
  age: number | null; fpg: number;      // projected fantasy points per game
  trend: 'up' | 'down' | 'flat' | null;
  factors: Factor[];
  hist: { s: string; gp: number; fp: number }[];  // last three seasons, newest first, under current scoring
  model: string;
}
export interface Projection { id: number; stats: Record<string, number>; gp: number; meta: ProjMeta }

const WEIGHTS = [5, 3, 2];
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6, 8)}`;
export const fpOf = (stats: Record<string, number>, w: Record<string, number>) =>
  Object.entries(w).reduce((t, [k, v]) => t + v * (stats[k] ?? 0), 0);

// age on October 1 of the season being projected
export function ageAt(birth: string | null, seasonStartYear: number) {
  if (!birth) return null;
  const b = new Date(birth + 'T12:00:00Z'), ref = new Date(Date.UTC(seasonStartYear, 9, 1));
  let a = ref.getUTCFullYear() - b.getUTCFullYear();
  if (ref.getUTCMonth() < b.getUTCMonth() || (ref.getUTCMonth() === b.getUTCMonth() && ref.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
// multiplier on scoring rates by age (skaters peak about 25-28; goalies a little later and flatter)
export function ageFactor(age: number | null, goalie: boolean) {
  if (age == null) return 1;
  if (goalie) return age <= 24 ? 1.02 : age <= 31 ? 1 : age <= 33 ? 0.98 : age <= 35 ? 0.96 : 0.93;
  const t: Record<number, number> = { 18: 1.1, 19: 1.1, 20: 1.09, 21: 1.08, 22: 1.06, 23: 1.04, 24: 1.025, 25: 1.01, 26: 1, 27: 1, 28: 1, 29: 0.99, 30: 0.98, 31: 0.965, 32: 0.95, 33: 0.935, 34: 0.92, 35: 0.9 };
  return age < 18 ? 1.1 : age > 35 ? 0.88 : t[age] ?? 1;
}

type Group = 'F' | 'D' | 'G';
const groupOf = (pos: string): Group => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');
const SK_KEYS = ['a', 'pm', 'pim', 'ppg', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'fow', 'fol'] as const;

interface Priors { rate: Record<string, number>; sh: number; gwgPerG: number }

// replacement-level per-game rates for a position group: 75% of the average regular (40+ games last season)
export function skaterPriors(rows: SkaterSeason[], latest: number, group: Group, byId: Map<number, ProjPlayer>, idOf: Map<SkaterSeason, number>): Priors {
  const reg = rows.filter((r) => r.season === latest && r.gp >= 40 && groupOf(byId.get(idOf.get(r)!)?.pos ?? 'C') === group);
  const gp = reg.reduce((t, r) => t + r.gp, 0) || 1;
  const sum = (k: keyof SkaterSeason) => reg.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const rate: Record<string, number> = {};
  for (const k of SK_KEYS) rate[k] = (sum(k) / gp) * (k === 'pm' ? 0 : 0.75);
  const sog = sum('sog'), g = sum('g');
  return { rate, sh: sog ? g / sog : group === 'D' ? 0.05 : 0.105, gwgPerG: g ? sum('gwg') / g : 0.16 };
}

function injuryGames(status: string | null) {
  if (!status) return 0;
  if (/^(ir-lt|ltir|long)/i.test(status)) return 40;
  if (/^(ir|injured reserve|out)/i.test(status)) return 12;
  if (/suspen/i.test(status)) return 5;
  if (/day/i.test(status)) return 2;
  return 0;
}

// how far to trust the number: wider for small samples, old players and goalies
function range(effGames: number, age: number | null, goalie: boolean) {
  let u = 0.1 + 0.9 / Math.sqrt(effGames + 10);
  if (age != null && age >= 32) u += 0.03;
  if (goalie) u += 0.06;
  return { lo: r2(Math.max(0.3, 1 - 1.15 * u)), hi: r2(1 + u) };
}

function trendOf(hist: { gp: number; fp: number }[]): ProjMeta['trend'] {
  const [a, b, c] = hist;
  if (!a || !b || a.gp < 30 || b.gp < 30) return null;
  const pa = a.fp / a.gp, pb = b.fp / b.gp;
  const prior = c && c.gp >= 30 ? (pb * 2 + c.fp / c.gp) / 3 : pb;
  if (pa > prior * 1.12) return 'up';
  if (pa < prior * 0.88) return 'down';
  return 'flat';
}

export function projectSkater(p: ProjPlayer, seasons: SkaterSeason[], pri: Priors, scoring: Scoring, latest: number, startYear: number): Projection | null {
  const rows = [...seasons].filter((s) => s.season <= latest && s.season >= latest - 20002).sort((a, b) => b.season - a.season);
  if (!rows.length || rows.every((r) => !r.gp)) return null;
  const w = (s: SkaterSeason) => WEIGHTS[Math.round((latest - s.season) / 10001)] ?? 0;
  const wgp = rows.reduce((t, s) => t + w(s) * s.gp, 0);
  const K = 25;
  const age = ageAt(p.birth, startYear);
  const af = ageFactor(age, false);
  const phys = 1 + (af - 1) * 0.4;
  const rate = (k: keyof SkaterSeason) => (rows.reduce((t, s) => t + w(s) * Number(s[k] ?? 0), 0) + K * (pri.rate[k as string] ?? 0)) / (wgp + K);

  // shots and shooting %: goals regress through shooting luck, not straight off last season's goal total
  const wsog = rows.reduce((t, s) => t + w(s) * s.sog, 0), wg = rows.reduce((t, s) => t + w(s) * s.g, 0);
  const SHK = 150;
  const sh = (wg + SHK * pri.sh) / (wsog + SHK);
  const sogPg = rate('sog') * af;
  const per: Record<string, number> = {
    sog: sogPg, g: sogPg * sh, a: rate('a') * af, ppp: rate('ppp') * af, shp: rate('shp') * af,
    pm: rate('pm') * 0.5, pim: rate('pim'), hit: rate('hit') * phys, blk: rate('blk') * phys, fow: rate('fow'), fol: rate('fol'),
  };
  per.ppg = Math.min(per.g, rate('ppg') * af);
  per.gwg = per.g * pri.gwgPerG;
  per.pts = per.g + per.a;

  // games: how often he dressed over the seasons he was in the league, pulled toward 90%, less a current injury
  // a veteran who sat out all of last season (injury, contract) counts it at half weight against his games
  const missedLast = rows[0].season !== latest;
  const wAvail = rows.reduce((t, s) => t + w(s) * 82, 0) + (missedLast ? 2.5 * 82 : 0);
  const avail = Math.min(1, wgp / wAvail);
  const inj = injuryGames(p.injury_status);
  const gp = Math.max(8, Math.min(82, Math.round(82 * (0.35 * 0.9 + 0.65 * avail)) - inj));

  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(per)) stats[k] = r1(v * gp);
  stats.gp = gp;

  const hist = rows.slice(0, 3).map((s) => ({ s: seasonLabel(s.season), gp: s.gp, fp: r1(fpOf(s as unknown as Record<string, number>, scoring.skater)) }));
  const fp = fpOf(stats, scoring.skater);
  const factors: Factor[] = [];
  const last = rows[0];
  if (last.season === latest && last.sog >= 80) {
    const lastSh = last.g / last.sog;
    const diff = Math.round((lastSh - sh) * last.sog * (gp / Math.max(1, last.gp)));
    if (lastSh - sh >= 0.03 && diff >= 3) factors.push({ tone: 'bad', text: `Shot ${(lastSh * 100).toFixed(1)}% last season against a norm of ${(sh * 100).toFixed(1)}%: expect about ${diff} fewer goals.` });
    else if (sh - lastSh >= 0.03 && -diff >= 3) factors.push({ tone: 'good', text: `Shot just ${(lastSh * 100).toFixed(1)}% last season against a norm of ${(sh * 100).toFixed(1)}%: expect about ${-diff} more goals.` });
  }
  if (age != null && af >= 1.04) factors.push({ tone: 'good', text: `Age ${age}: still climbing, about +${Math.round((af - 1) * 100)}% built in.` });
  if (age != null && af <= 0.965) factors.push({ tone: 'bad', text: `Age ${age}: decline built in, about −${Math.round((1 - af) * 100)}%.` });
  if (missedLast) factors.push({ tone: 'bad', text: `Didn't play last season: projected for ${gp} games on his return, and a wide range.` });
  if (inj >= 5) factors.push({ tone: 'bad', text: `${p.injury_status}: about ${inj} games docked.` });
  else if (!missedLast && avail < 0.8 && rows.length >= 2) factors.push({ tone: 'bad', text: `Dressed for ${Math.round(avail * 100)}% of games over the last ${rows.length} seasons: projected for ${gp}.` });
  if (last.season === latest && last.pptoi >= 150 && last.gp >= 30) factors.push({ tone: 'good', text: `Power-play regular: ${Math.floor(last.pptoi / 60)}:${String(Math.round(last.pptoi % 60)).padStart(2, '0')} a night on the man advantage.` });
  if (last.season === latest && p.nhl_team && last.team && !last.team.split(',').includes(p.nhl_team)) factors.push({ tone: 'info', text: `New team: ${last.team.split(',').pop()} to ${p.nhl_team}. Role may change.` });
  const trend = missedLast ? null : trendOf(hist);
  if (trend === 'up') factors.push({ tone: 'good', text: 'Trending up: his best points-per-game pace of the last three seasons.' });
  if (trend === 'down') factors.push({ tone: 'bad', text: 'Trending down: his scoring pace dropped last season.' });
  const eff = wgp / 5;
  if (eff < 40) factors.push({ tone: 'info', text: 'Small NHL sample: a wide range either way.' });

  return {
    id: p.id, stats, gp,
    meta: { ...range(missedLast ? eff / 2 : eff, age, false), age, fpg: r2(fp / gp), trend, factors: factors.slice(0, 5), hist, model: 'sak-1' },
  };
}

export interface GoaliePriors { svp: number; saPerGs: number; wPerGs: number; lPerGs: number; otlPerGs: number; shoPerGs: number }
export function goaliePriors(rows: GoalieSeason[], latest: number): GoaliePriors {
  const reg = rows.filter((r) => r.season === latest && r.gs >= 20);
  const s = (k: keyof GoalieSeason) => reg.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const gs = s('gs') || 1;
  return { svp: s('sa') ? s('sv') / s('sa') : 0.9, saPerGs: s('sa') / gs || 27, wPerGs: s('w') / gs || 0.47, lPerGs: s('l') / gs || 0.4, otlPerGs: s('otl') / gs || 0.12, shoPerGs: s('sho') / gs || 0.05 };
}

export function projectGoalie(p: ProjPlayer, seasons: GoalieSeason[], pri: GoaliePriors, scoring: Scoring, latest: number, startYear: number): Projection | null {
  const rows = [...seasons].filter((s) => s.season <= latest && s.season >= latest - 20002).sort((a, b) => b.season - a.season);
  if (!rows.length || rows.every((r) => !r.gp)) return null;
  const w = (s: GoalieSeason) => WEIGHTS[Math.round((latest - s.season) / 10001)] ?? 0;
  const sum = (k: keyof GoalieSeason) => rows.reduce((t, s) => t + w(s) * Number(s[k] ?? 0), 0);
  const wgs = sum('gs'), wsa = sum('sa');
  const age = ageAt(p.birth, startYear);
  const af = ageFactor(age, true);
  // the crease changes hands fast: starts lean hardest on last season
  const sw = (s: GoalieSeason) => [7, 2, 1][Math.round((latest - s.season) / 10001)] ?? 0;
  const startShare = Math.min(0.8, rows.reduce((t, s) => t + sw(s) * s.gs, 0) / rows.reduce((t, s) => t + sw(s) * 82, 0));
  const inj = injuryGames(p.injury_status);
  const gs = Math.max(4, Math.min(64, Math.round(82 * (0.15 * 0.42 + 0.85 * startShare)) - Math.round(inj * 0.7)));

  const SVK = 1500;
  // save % regressed to the league, shaded down a little for goalies past 32
  const svp = Math.min(0.935, (sum('sv') + SVK * pri.svp) / (wsa + SVK) - (age != null && age > 32 ? 0.0015 * (age - 32) : 0));
  const reg = (k: keyof GoalieSeason, prior: number, K: number) => (sum(k) + K * prior) / (wgs + K);
  const saPg = reg('sa', pri.saPerGs, 20);
  const wPg = reg('w', pri.wPerGs, 25) * (af < 1 ? af : 1);
  const otlPg = reg('otl', pri.otlPerGs, 25);
  const lPg = Math.max(0, 1 - wPg - otlPg);
  const shoPg = reg('sho', pri.shoPerGs, 40);
  const sa = saPg * gs, sv = sa * svp;
  const stats: Record<string, number> = { gs, gp: gs, w: r1(wPg * gs), l: r1(lPg * gs), otl: r1(otlPg * gs), sa: r1(sa), sv: r1(sv), ga: r1(sa - sv), sho: r1(shoPg * gs), svp: Math.round(svp * 1000) / 1000 };
  const hist = rows.slice(0, 3).map((s) => ({ s: seasonLabel(s.season), gp: s.gp, fp: r1(fpOf(s as unknown as Record<string, number>, scoring.goalie)) }));
  const fp = fpOf(stats, scoring.goalie);
  const factors: Factor[] = [];
  factors.push({ tone: startShare >= 0.6 ? 'good' : startShare < 0.4 ? 'bad' : 'info', text: `Projected ${gs} starts: ${startShare >= 0.6 ? 'a true number one' : startShare < 0.4 ? 'a backup’s workload' : 'a split crease'}.` });
  const last = rows[0];
  if (last.season === latest && last.sa >= 600) {
    const lsv = last.sv / last.sa;
    if (lsv - svp >= 0.008) factors.push({ tone: 'bad', text: `Stopped ${lsv.toFixed(3).replace(/^0/, '')} last season: some cooling expected (${svp.toFixed(3).replace(/^0/, '')}).` });
    if (svp - lsv >= 0.008) factors.push({ tone: 'good', text: `Only ${lsv.toFixed(3).replace(/^0/, '')} last season: a bounce back to about ${svp.toFixed(3).replace(/^0/, '')} is likely.` });
  }
  if (age != null && age >= 34) factors.push({ tone: 'bad', text: `Age ${age}: goalies this age lose starts fast.` });
  if (inj >= 5) factors.push({ tone: 'bad', text: `${p.injury_status}: a few starts docked.` });
  if (last.season === latest && p.nhl_team && last.team && !last.team.split(',').includes(p.nhl_team)) factors.push({ tone: 'info', text: `New team: ${last.team.split(',').pop()} to ${p.nhl_team}. Workload may change.` });
  const trend = trendOf(hist);
  return {
    id: p.id, stats, gp: gs,
    meta: { ...range(wgs / 5, age, true), age, fpg: r2(fp / Math.max(1, gs)), trend, factors: factors.slice(0, 5), hist, model: 'sak-1' },
  };
}

// run the whole pool
export function projectAll(players: ProjPlayer[], skaters: Map<number, SkaterSeason[]>, goalies: Map<number, GoalieSeason[]>, scoring: Scoring, latest: number): Projection[] {
  const startYear = Math.floor(latest / 10000);   // 20252026 -> the 2026-27 season starts in 2026
  const byId = new Map(players.map((p) => [p.id, p]));
  const idOf = new Map<SkaterSeason, number>();
  const allSk: SkaterSeason[] = [];
  for (const [id, rows] of skaters) for (const r of rows) { idOf.set(r, id); allSk.push(r); }
  const pri = { F: skaterPriors(allSk, latest, 'F', byId, idOf), D: skaterPriors(allSk, latest, 'D', byId, idOf) };
  const gpri = goaliePriors([...goalies.values()].flat(), latest);
  const out: Projection[] = [];
  for (const p of players) {
    const pr = p.pos === 'G'
      ? projectGoalie(p, goalies.get(p.id) ?? [], gpri, scoring, latest, startYear + 1)
      : projectSkater(p, skaters.get(p.id) ?? [], groupOf(p.pos) === 'D' ? pri.D : pri.F, scoring, latest, startYear + 1);
    if (pr) out.push(pr);
  }
  return out;
}
