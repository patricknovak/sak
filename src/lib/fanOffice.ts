// The fan zone's front office (25 October 2026, Patrick: "improve the goalie analysis significantly, and the moves and
// decisions the GM and coaching should make, and what fundamental changes should be considered"). It reads nhl-hub's
// `fan-office` answer beside the `fan` one, pure and tested on its own (supabase/tests/fan-zone.test.mjs):
//   crease        each goalie in depth: goals saved against an average goalie and against the shots' danger, the
//                 high-danger, mid and long save percentages, 5-on-5 and close-game play, quality and bad starts, how
//                 steady he is, rest and workload, five seasons against the league, his rank among the league's goalies
//   blame         the goals against split three ways: how many shots, how dangerous, and the goaltending
//   goaliePlan    who starts, the split, the back-to-backs
//   goalieMarket  the goalies worth a call, sellers first, with what each would add
//   targets       for each need the numbers name, the league's skaters who fill it, sellers first
//   coaching      the lines, the power play, the kill, the draws, the pairs, the ice time
//   questions     the bigger questions: the window, the stars, the crease, the system, special teams, the blue line, the
//                 pipeline, the identity
import { rankWord, type Assessment, type FanData, type Recommendation } from './fanZone.ts';
import type { Ahead, FanHistory, Outlook } from './fanDeep.ts';

// ── the payload
export interface EdgeStat { value: number | null; pct: number | null; avg: number | null }
export interface ShotRange { where: string; sa: number | null; ga: number | null; svp: number | null; pct: number | null; saPct: number | null; lgSvp: number | null; lgSa: number | null; lgGa: number | null }
export interface OfficeGoalie {
  id: number; edge: Record<string, EdgeStat> | null; five: Record<string, EdgeStat> | null; ranges: ShotRange[];
  areas: { area: string; sa: number | null; ga: number | null; svp: number | null; pct: number | null }[];
  games: { id: number; date: string; opp: string; home: boolean; start: boolean; dec: string | null; sa: number; ga: number; svp: number | null; toi: string }[];
}
export interface LeagueGoalie { id: number; name: string; team: string | null; gp: number; gs: number; w: number; sa: number; ga: number; svp: number | null; toi: number; qs: number | null; qsPct: number | null; evSvp: number | null; ppSvp: number | null; born: string | null; catches: string | null }
export interface GoalieSeason { id: number; name: string; season: number; team: string | null; gp: number; gs: number; sa: number; ga: number; svp: number | null; qsPct: number | null }
export interface OfficeSkater {
  id: number; name: string; team: string | null; pos: string; shoots: string; born: string | null; gp: number; g: number; a: number; pts: number; toi: number | null;
  p60: number | null; toi5?: number | null; sat: number | null; satRel: number | null; zs?: number | null; ppToi: number | null; shToi: number | null; ppP60: number | null; ppPts: number | null; pkGa60: number | null;
  fo: number | null; foN: number | null; foD: number | null; p60b?: number | null; satRelB?: number | null;
  // the kill and the power play over two seasons, steadied toward the league by an hour of average play
  pkHours?: number; pkAdj?: number; ppHours?: number; ppAdj?: number;
  prev: { gp: number; pts: number; g: number; toi: number | null; p60: number | null; toi5: number | null; satRel: number | null } | null;
}
export interface LinePlayer { id: number; name: string; num: number; pos: string; toi: number }
export interface FanOffice {
  abbrev: string; season: number; prevSeason: number; goalies: OfficeGoalie[]; leagueGoalies: LeagueGoalie[]; seasons: GoalieSeason[]; lgSvp: Record<string, number>;
  club: OfficeSkater[]; targets: Record<'scorers' | 'puckD' | 'killers' | 'pp' | 'faceoffs' | 'drivers', OfficeSkater[]>;
  lines: { game: { id: number; date: string; opp: string }; forwards: (LinePlayer | null)[][]; defense: LinePlayer[][]; goalies: LinePlayer[] } | null;
  at: string; stale?: boolean;
}

const GOALS_PER_WIN = 6;   // about six goals is a win in today's NHL, so a goalie's goals saved converts to the standings
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const sv = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(3).replace(/^0/, ''));
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const ageOn = (born: string | null | undefined, at: Date) => {
  if (!born) return null;
  const b = new Date(`${born}T12:00:00Z`);
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  if (at.getUTCMonth() < b.getUTCMonth() || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate())) a--;
  return a;
};
const sd = (xs: number[]) => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const svOf = (rows: { sa: number; ga: number }[]) => { const sa = rows.reduce((t, r) => t + r.sa, 0); return sa ? { gs: rows.length, svp: 1 - rows.reduce((t, r) => t + r.ga, 0) / sa, sa } : null; };

// ── the crease
export interface GoalieRead {
  id: number; name: string; headshot: string | null; age: number | null; gp: number; gs: number; w: number; l: number; otl: number; svp: number; gaa: number; sa: number; ga: number;
  lgSvp: number; gsaa: number; xga: number | null; gsax: number | null; winsAdded: number | null; avgQ: number | null;   // avgQ: goals an average goalie allows on these shots at the league's average danger
  danger: { where: 'high' | 'mid' | 'long'; label: string; sa: number; ga: number; svp: number | null; lg: number | null; pct: number | null; share: number; lgShare: number | null }[];
  sv5: EdgeStat | null; close5: EdgeStat | null; sa60: EdgeStat | null; evSvp: number | null; ppSvp: number | null; qsPct: number | null; above900: EdgeStat | null; support: EdgeStat | null;
  starts: { id: number; date: string; opp: string; home: boolean; dec: string | null; sa: number; ga: number; svp: number | null }[];
  bad: number; steals: number; spread: number | null; last5: number | null;
  rest: { b2b: ReturnType<typeof svOf>; rested: ReturnType<typeof svOf> }; volume: { heavy: ReturnType<typeof svOf>; light: ReturnType<typeof svOf> };
  seasons: { season: number; gp: number; svp: number | null; lg: number | null; delta: number | null; team: string | null }[]; careerDelta: number | null;
  ranks: { svp: number | null; gsaa: number | null; qs: number | null; ev: number | null; of: number };
  weakAreas: string[]; verdict: { label: string; tone: 'good' | 'ok' | 'bad'; text: string };
}
export function crease(d: FanData, o: FanOffice | null, now = new Date()): GoalieRead[] {
  if (!o) return [];
  const season = String(o.season);
  const lg = o.lgSvp[season] ?? (() => { const L = o.leagueGoalies; const sa = L.reduce((t, g) => t + g.sa, 0); return sa ? 1 - L.reduce((t, g) => t + g.ga, 0) / sa : 0.9; })();
  const L = new Map(o.leagueGoalies.map((g) => [g.id, g]));
  const born = new Map(d.roster.map((p) => [p.id, p.born]));
  const teamDays = new Set((d.schedule ?? []).map((g) => g.date));
  // league ranks among goalies with a real sample this season
  const qualified = o.leagueGoalies.filter((g) => g.gp >= Math.max(3, Math.min(10, Math.round((d.standing?.gp ?? 10) / 3))));
  const rankBy = (id: number, f: (g: LeagueGoalie) => number | null) => {
    const vals = qualified.map((g) => ({ id: g.id, v: f(g) })).filter((x): x is { id: number; v: number } => x.v != null);
    const me = vals.find((x) => x.id === id); return me ? 1 + vals.filter((x) => x.v > me.v).length : null;
  };
  return o.goalies.map((g): GoalieRead | null => {
    const s = d.goalies.find((x) => x.id === g.id), lgRow = L.get(g.id);
    if (!s || !s.gp) return null;
    const sa = lgRow?.sa ?? s.sa ?? 0, ga = lgRow?.ga ?? Math.round(sa * (1 - s.svp));
    const gsaa = sa * (1 - lg) - ga;
    // expected goals against from where the shots came from: each range's shots at the league's save percentage there
    const R = (w: string) => g.ranges.find((r) => r.where === w);
    const parts = (['high', 'mid', 'long'] as const).map((w) => R(w)).filter((r): r is ShotRange => !!r && r.sa != null && r.lgSvp != null);
    const xga = parts.length === 3 ? parts.reduce((t, r) => t + r.sa! * (1 - r.lgSvp!), 0) : null;
    const rangeGa = parts.reduce((t, r) => t + (r.ga ?? 0), 0);
    const gsax = xga != null ? xga - rangeGa : null;
    const all = R('all');
    // the same number of placed shots at the league's average mix of danger: each range's share of a typical goalie's
    // shots, at that range's league save percentage
    const lgMix = parts.length === 3 && parts.every((r) => r.lgSa != null) ? parts.reduce((t, r) => t + r.lgSa! * (1 - r.lgSvp!), 0) / parts.reduce((t, r) => t + r.lgSa!, 0) : null;
    const avgQ = xga != null && lgMix != null ? parts.reduce((t, r) => t + r.sa!, 0) * lgMix : null;
    const lgAllSa = all?.lgSa ?? null;
    const danger = (['high', 'mid', 'long'] as const).map((w) => {
      const r = R(w);
      return { where: w, label: w === 'high' ? 'Slot and crease' : w === 'mid' ? 'Mid-range' : 'Long range', sa: r?.sa ?? 0, ga: r?.ga ?? 0, svp: r?.svp ?? null, lg: r?.lgSvp ?? null, pct: r?.pct ?? null,
        share: all?.sa ? (r?.sa ?? 0) / all.sa : 0, lgShare: r?.lgSa != null && lgAllSa ? r.lgSa / lgAllSa : null };
    });
    const starts = g.games.filter((x) => x.start).map((x) => ({ id: x.id, date: x.date, opp: x.opp, home: x.home, dec: x.dec, sa: x.sa, ga: x.ga, svp: x.svp }));
    const svs = starts.map((x) => x.svp).filter((v): v is number => v != null);
    const last5 = svOf(starts.slice(-5))?.svp ?? null;
    const prevDay = (date: string) => new Date(new Date(`${date}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const b2b = starts.filter((x) => teamDays.has(prevDay(x.date))), rested = starts.filter((x) => !teamDays.has(prevDay(x.date)));
    // five seasons against the league's save percentage that season
    const seasons = o.seasons.filter((x) => x.id === g.id).sort((a, b) => a.season - b.season).map((x) => {
      const l = o.lgSvp[String(x.season)] ?? null;
      return { season: x.season, gp: x.gp, svp: x.svp, lg: l, delta: x.svp != null && l != null ? x.svp - l : null, team: x.team };
    });
    // the seasons before this one, the latest counting most: a goalie is who he has been lately
    const wsum = o.seasons.filter((x) => x.id === g.id && x.svp != null && o.lgSvp[String(x.season)] != null && x.season !== o.season)
      .map((x) => ({ x, w: x.sa * 0.65 ** Math.round((o.season - x.season) / 10001 - 1) }));
    const shots = wsum.reduce((t, r) => t + r.w, 0);
    const careerDelta = shots ? wsum.reduce((t, r) => t + r.w * (r.x.svp! - o.lgSvp[String(r.x.season)]), 0) / shots : null;
    const weakAreas = g.areas.filter((a) => (a.sa ?? 0) >= 5 && a.pct != null && a.pct < 0.25).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).map((a) => a.area);
    const value = gsax ?? gsaa;
    const per60 = s.gp ? value / s.gp : 0;
    const hd = danger[0];
    const verdict = s.gs < 4 ? { label: 'Too few starts', tone: 'ok' as const, text: `${s.gs} start${s.gs === 1 ? '' : 's'}: not enough to judge on this season alone${careerDelta != null ? `; over his recent seasons he has been ${Math.abs(careerDelta * 1000).toFixed(0)} points of save percentage ${careerDelta >= 0 ? 'above' : 'below'} the league` : ''}.` }
      : per60 >= 0.3 ? { label: 'Stealing games', tone: 'good' as const, text: `Saving about ${per60.toFixed(2)} goals a game more than the shots he faces would suggest.` }
      : per60 >= 0 ? { label: 'Holding his own', tone: 'ok' as const, text: 'About what an average goalie would give on the same shots.' }
      : per60 > -0.3 ? { label: 'Leaking a little', tone: 'ok' as const, text: `About ${(-per60).toFixed(2)} goals a game more than the shots he faces would suggest.` }
      : { label: 'Costing games', tone: 'bad' as const, text: `About ${(-per60).toFixed(2)} goals a game more than an average goalie would allow on the same shots${hd.pct != null && hd.pct < 0.3 ? ', most of them from the slot and crease' : ''}.` };
    return {
      id: g.id, name: s.name, headshot: s.headshot, age: ageOn(born.get(g.id) ?? lgRow?.born, now), gp: s.gp, gs: s.gs, w: s.w, l: s.l, otl: s.otl, svp: s.svp, gaa: s.gaa, sa, ga,
      lgSvp: lg, gsaa, xga, gsax, winsAdded: (gsax ?? gsaa) / GOALS_PER_WIN, avgQ, danger,
      sv5: g.five?.savePctg ?? null, close5: g.five?.savePctgClose ?? null, sa60: g.five?.shotsPer60 ?? null, evSvp: lgRow?.evSvp ?? null, ppSvp: lgRow?.ppSvp ?? null,
      qsPct: lgRow?.qsPct ?? null, above900: g.edge?.gamesAbove900 ?? null, support: g.edge?.goalSupportAvg ?? null,
      starts, bad: svs.filter((v) => v < 0.85).length, steals: starts.filter((x) => x.svp != null && x.svp >= 0.93 && x.sa >= 28).length, spread: sd(svs), last5,
      rest: { b2b: svOf(b2b), rested: svOf(rested) }, volume: { heavy: svOf(starts.filter((x) => x.sa >= 30)), light: svOf(starts.filter((x) => x.sa < 30)) },
      seasons, careerDelta,
      ranks: { svp: rankBy(g.id, (x) => x.svp), gsaa: rankBy(g.id, (x) => (x.sa ? x.sa * (1 - lg) - x.ga : null)), qs: rankBy(g.id, (x) => x.qsPct), ev: rankBy(g.id, (x) => x.evSvp), of: qualified.length },
      weakAreas, verdict,
    };
  }).filter((x): x is GoalieRead => !!x).sort((a, b) => b.gs - a.gs);
}

// ── who's to blame for the goals against: the shots' number, their danger, and the goaltending
export interface Blame { ga: number; baseline: number; volume: number; quality: number; goalie: number; read: string; lgSa60: number; sa60: number; hdShare: number | null; lgHdShare: number | null }
export function blame(o: FanOffice | null, reads: GoalieRead[]): Blame | null {
  if (!o || !reads.length) return null;
  const L = o.leagueGoalies, lgToi = L.reduce((t, g) => t + g.toi, 0);
  if (!lgToi) return null;
  const lgSa60 = (L.reduce((t, g) => t + g.sa, 0) / lgToi) * 3600, lgSv = reads[0].lgSvp;
  const mine = o.leagueGoalies.filter((g) => reads.some((r) => r.id === g.id));
  const toi = mine.reduce((t, g) => t + g.toi, 0), sa = reads.reduce((t, r) => t + r.sa, 0), ga = reads.reduce((t, r) => t + r.ga, 0);
  if (!toi || !sa || reads.some((r) => r.xga == null)) return null;
  // the danger and the goaltending are read from the shots the tracking placed (nearly all of them)
  const xga = reads.reduce((t, r) => t + (r.xga ?? 0), 0);
  const placedGa = reads.reduce((t, r) => t + r.danger.reduce((u, x) => u + x.ga, 0), 0);
  const baseline = (toi / 3600) * lgSa60 * (1 - lgSv);
  const avgQ = reads.reduce((t, r) => t + (r.avgQ ?? r.danger.reduce((u, x) => u + x.sa, 0) * (1 - lgSv)), 0);
  const volume = (sa - (toi / 3600) * lgSa60) * (1 - lgSv), quality = xga - avgQ, goalie = placedGa - xga;
  const hd = reads.reduce((t, r) => t + r.danger[0].sa, 0);
  const lgHdShare = reads[0].danger[0].lgShare;
  const parts = [['the number of shots', volume], ['how dangerous they are', quality], ['the goaltending', goalie]] as const;
  const worst = [...parts].sort((a, b) => b[1] - a[1])[0];
  const read = `${ga} goals against where a club giving up an average number of average shots to an average goalie would allow about ${baseline.toFixed(0)}. `
    + `By part: ${parts.map(([k, v]) => `${k} ${signed(v)}`).join(', ')}. `
    + (worst[1] > 1.5 ? `The biggest share is ${worst[0]}.` : 'No one part stands out.');
  return { ga, baseline, volume, quality, goalie, read, lgSa60, sa60: (sa / toi) * 3600, hdShare: sa ? hd / sa : null, lgHdShare };
}

// ── the plan in goal
export interface GoaliePlan { starter: GoalieRead; backup: GoalieRead | null; split: number; text: string; b2bLeft: number }
export function goaliePlan(reads: GoalieRead[], ah: Ahead | null): GoaliePlan | null {
  const pool = reads.filter((r) => r.gs >= 1);
  if (!pool.length) return null;
  // this season's goals saved against the shots' danger, steadied by his last seasons against the league
  const score = (r: GoalieRead) => ((r.gsax ?? r.gsaa) / Math.max(1, r.gp)) * Math.min(1, r.gs / 15) + (r.careerDelta ?? 0) * 27 * (1 - Math.min(1, r.gs / 15));
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const starter = ranked[0], backup = ranked[1] ?? null;
  const gap = backup ? score(starter) - score(backup) : 1;
  const split = !backup ? 1 : gap > 0.3 ? 0.7 : gap > 0.12 ? 0.62 : 0.55;
  const b2bLeft = ah?.b2b ?? 0;
  const text = !backup ? `${starter.name} is the only goalie with starts.`
    : `${starter.name} should carry about ${pct0(split)} of the starts from here, on ${starter.gs >= 15 ? 'this season\'s play' : 'this season and his recent seasons together'}${split <= 0.55 ? ', a near-even share: neither has earned the crease outright' : ''}. ${backup.name} takes the second night of back-to-backs${b2bLeft ? ` (${b2bLeft} left)` : ''} and the softer road games. ${starter.gs > 0 && starter.rest.b2b && starter.rest.b2b.gs >= 2 && starter.rest.rested && starter.rest.b2b.svp < starter.rest.rested.svp - 0.02 ? `${starter.name} has stopped ${sv(starter.rest.b2b.svp)} on no rest against ${sv(starter.rest.rested.svp)} rested: keep him off them. ` : ''}`;
  return { starter, backup, split, text: text.trim(), b2bLeft };
}

// ── the goalie market
export interface MarketGoalie { id: number; name: string; team: string; age: number | null; delta: number; gp: number; svp: number | null; qsPct: number | null; seller: boolean; odds: number | null; addWins: number; note: string }
export function goalieMarket(d: FanData, o: FanOffice | null, reads: GoalieRead[], odds: Record<string, number> | null, now = new Date()): MarketGoalie[] {
  if (!o) return [];
  const mine = new Set(reads.map((r) => r.id));
  const ourDelta = reads[0] ? (reads[0].gsax ?? reads[0].gsaa) / Math.max(1, reads[0].sa) : 0;
  const prev = String(o.prevSeason), cur = String(o.season);
  const out: MarketGoalie[] = [];
  for (const g of o.leagueGoalies) {
    if (mine.has(g.id) || !g.team || g.team === d.abbrev) continue;
    const last = o.seasons.find((x) => x.id === g.id && String(x.season) === prev);
    const rows = [last && last.svp != null && o.lgSvp[prev] != null ? { sa: last.sa, d: last.svp - o.lgSvp[prev] } : null, g.svp != null && o.lgSvp[cur] != null && g.sa ? { sa: g.sa, d: g.svp - o.lgSvp[cur] } : null].filter((x): x is { sa: number; d: number } => !!x);
    const shots = rows.reduce((t, r) => t + r.sa, 0);
    // a real body of work: twenty starts' worth of shots across the two seasons
    if (shots < 500) continue;
    const delta = rows.reduce((t, r) => t + r.sa * r.d, 0) / shots;
    const o2 = odds?.[g.team] ?? null;
    const addWins = ((delta - ourDelta) * 27 * 45) / GOALS_PER_WIN;   // over 45 starts of 27 shots
    out.push({ id: g.id, name: g.name, team: g.team, age: ageOn(g.born, now), delta, gp: g.gp + (last?.gp ?? 0), svp: g.svp, qsPct: g.qsPct, seller: o2 != null && o2 < 0.35, odds: o2, addWins,
      note: `${sv(g.svp)} this season; ${last?.svp != null ? `${sv(last.svp)} last season in ${last.gp} games` : 'little last season'}. ${delta >= 0 ? 'Above' : 'Below'} the league by ${Math.abs(delta * 1000).toFixed(0)} points of save percentage.` });
  }
  return out.filter((g) => g.addWins > 0.5).sort((a, b) => Number(b.seller) - Number(a.seller) || b.addWins - a.addWins).slice(0, 8);
}

// ── skaters worth a call, for the needs the numbers name
export interface Need { key: keyof FanOffice['targets']; title: string; why: string; stat: (s: OfficeSkater) => string; players: (OfficeSkater & { age: number | null; seller: boolean; odds: number | null })[] }
export function targets(d: FanData, a: Assessment, o: FanOffice | null, odds: Record<string, number> | null, now = new Date()): Need[] {
  if (!o) return [];
  const by = (k: string) => a.ranks.find((r) => r.key === k);
  const bottom = (k: string) => { const r = by(k); return !!r && r.rank > r.of - Math.round(r.of / 3); };
  const half = (k: string) => { const r = by(k); return !!r && r.rank > r.of / 2; };
  const rhD = d.roster.filter((p) => p.pos === 'D' && p.shoots === 'R').length;
  const needs: Omit<Need, 'players'>[] = [];
  const r = (k: string) => by(k);
  if (bottom('pk')) needs.push({ key: 'killers', title: 'A penalty killer', why: `The kill is ${r('pk')!.fmt(r('pk')!.value)} (${rankWord(r('pk')!.rank)}). These players kill real minutes with few power-play goals against while they are out there.`, stat: (s) => `${((s.shToi ?? 0) / 60).toFixed(1)} min a game on the kill · ${s.pkAdj?.toFixed(1)} PP goals against /60 over two seasons` });
  if (a.stars && a.stars.share >= 0.38 || half('g5f')) needs.push({ key: 'scorers', title: 'Scoring beyond the top two', why: a.stars ? `${a.stars.names.join(' and ')} have ${pct0(a.stars.share)} of the points. These forwards score at 5-on-5, this season and last blended.` : 'Even-strength scoring is below the league\'s middle.', stat: (s) => `${(s.p60b ?? s.p60 ?? 0).toFixed(2)} 5-on-5 points /60 · ${s.pts} pts in ${s.gp}` });
  if (half('sat') || half('shotDiff')) needs.push({ key: 'drivers', title: 'Players who tilt the ice', why: `The club takes ${r('sat') ? r('sat')!.fmt(r('sat')!.value) : 'under half'} of 5-on-5 shot attempts. With these players on the ice their clubs get more of the puck than without them.`, stat: (s) => `${signed(((s.satRelB ?? s.satRel ?? 0) * 100), 1)} shot share relative · ${s.pts} pts` });
  if ((a.dShare != null && a.dShare < 0.18) || rhD < 3) needs.push({ key: 'puckD', title: rhD < 3 ? 'A right-shot defenceman who moves the puck' : 'A defenceman who moves the puck', why: `${rhD} right-shot defencemen on the roster${a.dShare != null ? `, and the blue line has ${pct0(a.dShare)} of the points` : ''}.`, stat: (s) => `${s.shoots === 'R' ? 'Shoots right · ' : ''}${(s.p60b ?? s.p60 ?? 0).toFixed(2)} 5-on-5 pts /60 · ${signed(((s.satRelB ?? s.satRel ?? 0) * 100), 1)} rel` });
  if (half('pp')) needs.push({ key: 'pp', title: 'Power-play help', why: `The power play is ${r('pp')!.fmt(r('pp')!.value)} (${rankWord(r('pp')!.rank)}).`, stat: (s) => `${s.ppAdj?.toFixed(1)} PP points /60 over two seasons · ${s.ppPts} this season` });
  if (bottom('fo') || bottom('foD')) needs.push({ key: 'faceoffs', title: 'A centre who wins draws', why: `They win ${r('fo')!.fmt(r('fo')!.value)} of faceoffs (${rankWord(r('fo')!.rank)}).`, stat: (s) => `${pct1(s.fo ?? 0)} on ${s.foN} draws` });
  return needs.map((n) => {
    const list = (o.targets[n.key] ?? []).map((s) => ({ ...s, age: ageOn(s.born, now), odds: s.team ? odds?.[s.team] ?? null : null, seller: !!s.team && (odds?.[s.team] ?? 1) < 0.35 }))
      .filter((s) => (n.key !== 'puckD' || rhD >= 3 || s.shoots === 'R'));
    // a seller's veteran is a deadline call; a club's young core and its stars aren't on the market
    const gettable = list.filter((s) => (s.prev?.pts ?? 0) < 75 && (s.age ?? 30) >= (s.seller ? 25 : 28));
    const ranked = [...gettable.filter((s) => s.seller), ...gettable.filter((s) => !s.seller)].slice(0, 5);
    return { ...n, players: ranked };
  }).filter((n) => n.players.length);
}

// ── decisions for the coaches
export interface Decision { area: string; title: string; why: string }
export function coaching(d: FanData, o: FanOffice | null, plan: GoaliePlan | null): { game: { id: number; date: string; opp: string } | null; lines: { label: string; players: (LinePlayer & { p60: number | null; rel: number | null })[]; p60: number | null; rel: number | null }[]; pairs: { players: (LinePlayer & { shoots: string | null; rel: number | null })[]; offSide: boolean }[]; decisions: Decision[] } {
  const out: Decision[] = [];
  const club = new Map((o?.club ?? []).map((s) => [s.id, s]));
  const shoots = new Map(d.roster.map((p) => [p.id, p.shoots]));
  // a rate steadied with last season's while this one is young
  const p60 = (id: number) => { const s = club.get(id); if (!s) return null; const w = (s.toi5 ?? 0) * s.gp, wp = (s.prev?.toi5 ?? 0) * (s.prev?.gp ?? 0); return s.p60 == null ? s.prev?.p60 ?? null : s.prev?.p60 == null || !wp ? s.p60 : (s.p60 * w + s.prev.p60 * wp) / (w + wp); };
  const rel = (id: number) => club.get(id)?.satRel ?? null;
  const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lines = (o?.lines?.forwards ?? []).map((l, i) => {
    const players = l.filter((p): p is LinePlayer => !!p).map((p) => ({ ...p, p60: p60(p.id), rel: rel(p.id) }));
    return { label: `Line ${i + 1}`, players, p60: avg(players.map((p) => p.p60)), rel: avg(players.map((p) => p.rel)) };
  });
  const pairs = (o?.lines?.defense ?? []).map((pr) => {
    const players = pr.map((p) => ({ ...p, shoots: shoots.get(p.id) ?? null, rel: rel(p.id) }));
    return { players, offSide: players.length === 2 && players[1].shoots === 'L' && players[0].shoots === 'L' };
  });
  // promote: the best rate in the bottom six against the weakest in the top six
  const top6 = lines.slice(0, 2).flatMap((l) => l.players), bottom6 = lines.slice(2).flatMap((l) => l.players);
  const weakTop = top6.filter((p) => p.p60 != null).sort((a, b) => a.p60! - b.p60!)[0];
  const bestBottom = bottom6.filter((p) => p.p60 != null && (p.rel ?? 0) >= -0.02).sort((a, b) => b.p60! - a.p60!)[0];
  if (weakTop && bestBottom && bestBottom.p60! - weakTop.p60! >= 0.5) {
    const where = lines.findIndex((l) => l.players.some((p) => p.id === weakTop.id)) + 1;
    out.push({ area: 'Lines', title: `Try ${bestBottom.name} on line ${where}`, why: `${bestBottom.name} scores ${bestBottom.p60!.toFixed(2)} points per 60 at 5-on-5 from the bottom six; ${weakTop.name} scores ${weakTop.p60!.toFixed(2)} on line ${where}. Swap them for a few games and see if the line drives more.` });
  }
  // ice time: heavy minutes with the puck going the wrong way and little scoring, or the reverse
  const skaters = [...club.values()].filter((s) => s.gp >= Math.min(5, d.standing?.gp ?? 5) && s.toi5 != null);
  const heavy = skaters.filter((s) => s.pos !== 'D').sort((a, b) => (b.toi ?? 0) - (a.toi ?? 0)).slice(0, 6);
  const sink = heavy.filter((s) => (s.satRel ?? 0) <= -0.05 && (p60(s.id) ?? 9) < 1.6).sort((a, b) => (a.satRel ?? 0) - (b.satRel ?? 0))[0];
  if (sink) out.push({ area: 'Ice time', title: `Fewer minutes for ${sink.name}`, why: `Among the six forwards with the most ice time, but the club's shot share is ${Math.abs((sink.satRel ?? 0) * 100).toFixed(1)} points lower with him on the ice and he scores ${(p60(sink.id) ?? 0).toFixed(2)} per 60 at 5-on-5.` });
  const riser = skaters.filter((s) => s.pos !== 'D' && !heavy.includes(s) && (s.satRel ?? 0) >= 0.04 && (p60(s.id) ?? 0) >= 1.8).sort((a, b) => (p60(b.id) ?? 0) - (p60(a.id) ?? 0))[0];
  if (riser) out.push({ area: 'Ice time', title: `More minutes for ${riser.name}`, why: `${(p60(riser.id) ?? 0).toFixed(2)} points per 60 at 5-on-5 and the shot share ${signed((riser.satRel ?? 0) * 100)} better with him on, in ${((riser.toi ?? 0) / 60).toFixed(1)} minutes a game.` });
  // the power play's first unit: the five with the most time, against who scores on it
  const ppUsers = [...club.values()].filter((s) => (s.ppHours ?? 0) >= 0.5 && s.ppAdj != null).map((s) => ({ ...s, ppP60: s.ppAdj! }));
  const unit1 = [...ppUsers].sort((a, b) => (b.ppToi ?? 0) - (a.ppToi ?? 0)).slice(0, 5);
  const outside = ppUsers.filter((s) => !unit1.includes(s)).sort((a, b) => (b.ppP60 ?? 0) - (a.ppP60 ?? 0))[0];
  const weakest = [...unit1].sort((a, b) => (a.ppP60 ?? 0) - (b.ppP60 ?? 0))[0];
  if (outside && weakest && (outside.ppP60 ?? 0) - (weakest.ppP60 ?? 0) >= 2) out.push({ area: 'Power play', title: `A look for ${outside.name} on the first unit`, why: `${(outside.ppP60 ?? 0).toFixed(1)} power-play points per 60 over this season and last, against ${weakest.name}'s ${(weakest.ppP60 ?? 0).toFixed(1)} with more of the first-unit time.` });
  // the kill: lean on whoever keeps the puck out
  // the top two scorers' minutes are worth more elsewhere: they aren't the answer on the kill
  const stars = new Set([...d.skaters].sort((a, b) => b.pts - a.pts).slice(0, 2).map((p) => p.id));
  const killers = [...club.values()].filter((s) => (s.shToi ?? 0) >= 60 && (s.pkHours ?? 0) >= 0.5 && s.pkAdj != null && !stars.has(s.id));
  if (killers.length >= 4) {
    const best = [...killers].sort((a, b) => a.pkAdj! - b.pkAdj!)[0], worst = [...killers].sort((a, b) => b.pkAdj! - a.pkAdj!)[0];
    if (worst.pkAdj! - best.pkAdj! >= 2) out.push({ area: 'Penalty kill', title: `More of ${best.name} on the kill, less of ${worst.name}`, why: `Over this season and last, ${best.pkAdj!.toFixed(1)} power-play goals against per 60 with ${best.name} killing and ${worst.pkAdj!.toFixed(1)} with ${worst.name}.` });
  }
  // the draws that matter
  // the draws that matter most are in their own end: the best there takes them, late and on the kill
  const centres = [...club.values()].filter((s) => (s.foN ?? 0) >= 40 && s.fo != null);
  const dz = (s: OfficeSkater) => s.foD ?? s.fo ?? 0;
  const ranked = [...centres].sort((a, b) => dz(b) - dz(a));
  if (ranked.length >= 2 && dz(ranked[0]) - dz(ranked[ranked.length - 1]) >= 0.06 && dz(ranked[0]) >= 0.5) out.push({ area: 'Faceoffs', title: `${ranked[0].name} takes the big draws`, why: `${ranked[0].foD != null ? `${pct1(ranked[0].foD)} in his own end, ` : ''}${pct1(ranked[0].fo ?? 0)} on ${ranked[0].foN} draws in all. Send him out for defensive-zone faceoffs late in games and on the kill.` });
  // the pairs: a left shot on the right side
  const off = pairs.findIndex((p) => p.offSide);
  if (off >= 0) out.push({ area: 'Defence pairs', title: `A right shot for pair ${off + 1}`, why: `${pairs[off].players.map((p) => p.name).join(' and ')} both shoot left, so one plays his off side: harder breakouts on the right wall.` });
  if (plan) out.push({ area: 'Goaltending', title: `${plan.starter.name} starts${plan.backup ? `, ${plan.backup.name} on the second nights` : ''}`, why: plan.text });
  return { game: o?.lines?.game ?? null, lines, pairs, decisions: out };
}

// ── the bigger questions
export interface Question { area: string; verdict: 'Keep' | 'Adjust' | 'Rethink'; title: string; evidence: string[]; action: string }
export function questions(d: FanData, a: Assessment, o: FanOffice | null, reads: GoalieRead[], b: Blame | null, out: Outlook | null, h: FanHistory | null, now = new Date()): Question[] {
  const qs: Question[] = [];
  const by = (k: string) => a.ranks.find((r) => r.key === k);
  const third = (r: ReturnType<typeof by>) => (r ? (r.rank <= Math.round(r.of / 3) ? 'top' : r.rank > r.of - Math.round(r.of / 3) ? 'bottom' : 'middle') : null);
  const age = new Map(d.roster.map((p) => [p.id, ageOn(p.born, now)]));
  // the window: the age of the players carrying the minutes
  const regulars = [...d.skaters].filter((s) => s.gp >= Math.min(3, d.standing?.gp ?? 3)).sort((x, y) => y.toi - x.toi);
  const core = [...regulars.filter((s) => s.pos !== 'D').slice(0, 9), ...regulars.filter((s) => s.pos === 'D').slice(0, 4)];
  const w = core.reduce((t, s) => t + s.toi, 0);
  const coreAge = w ? core.reduce((t, s) => t + s.toi * (age.get(s.id) ?? 27), 0) / w : null;
  const stars = [...d.skaters].sort((x, y) => y.pts - x.pts).slice(0, 2).map((s) => ({ name: s.name, age: age.get(s.id) ?? null }));
  if (coreAge != null) {
    const old = coreAge >= 29, young = coreAge <= 26;
    qs.push({ area: 'The window', verdict: old ? 'Adjust' : 'Keep', title: old ? 'The window is now' : young ? 'A young core with time' : 'In the window',
      evidence: [`The top nine forwards and top four defencemen, weighted by ice time, average ${coreAge.toFixed(1)} years old.`, stars.length ? `The two leading scorers: ${stars.map((s) => `${s.name}${s.age ? ` (${s.age})` : ''}`).join(' and ')}.` : '', out ? `Playoff chances ${pct0(out.playoffs)}.` : ''].filter(Boolean),
      action: old ? 'Spend futures for players who help this spring and next, and plan now for the core turning 31 and 32: the next wave has to be in the lineup within two seasons.' : young ? 'Let the young core play through mistakes; add veterans around them rather than trading their development away.' : 'Add at the margins without giving up the players under 25.' });
  }
  // the stars, and whether the last game had them on one line
  const starIds = [...d.skaters].sort((x, y) => y.pts - x.pts).slice(0, 2).map((p) => p.id);
  const at = (o?.lines?.forwards ?? []).findIndex((l) => starIds.every((id) => l.some((p) => p?.id === id)));
  const together = at >= 0 ? at : null;
  if (a.stars) qs.push({ area: 'The stars', verdict: a.stars.share >= 0.45 ? 'Rethink' : a.stars.share >= 0.38 ? 'Adjust' : 'Keep', title: a.stars.share >= 0.45 ? 'Too much rides on two players' : a.stars.share >= 0.38 ? 'Lean on the stars, but build a second wave' : 'Scoring comes from everywhere',
    evidence: [`${a.stars.names.join(' and ')}: ${pct0(a.stars.share)} of the points, ${pct0(a.stars.goalsShare)} of the goals.`, a.depth ? `The forwards after the top six score ${a.depth.ppg.toFixed(2)} points a game.` : '',
      together != null ? `Last game they played together on line ${together + 1}.` : ''].filter(Boolean),
    action: a.stars.share >= 0.38 ? 'Split the stars across two lines at even strength more often, so each has a line built for him, and spend the next asset on a second-line scorer rather than depth.' : 'Keep the balance: it is what holds up when the playoffs check the top line.' });
  // the crease
  const team = reads.reduce((t, r) => t + (r.gsax ?? r.gsaa), 0);
  const sv5 = by('sv5');
  const prevSv5 = sv5?.prevRank != null && sv5.prevRank > sv5.of - Math.round(sv5.of / 3);
  if (reads.length) qs.push({ area: 'The crease', verdict: team <= -4 || (third(sv5) === 'bottom' && prevSv5) ? 'Rethink' : team < 0 ? 'Adjust' : 'Keep',
    title: team <= -4 || (third(sv5) === 'bottom' && prevSv5) ? 'Goaltending is a structural hole' : team < 0 ? 'Goaltending is costing a little' : 'The crease is not the problem',
    evidence: [`The goalies are ${signed(team)} goals against the danger of the shots they faced, worth ${signed(team / GOALS_PER_WIN, 1)} wins.`, sv5 ? `5-on-5 save percentage ${sv5.fmt(sv5.value)}, ${rankWord(sv5.rank)}${sv5.prevRank ? `; ${rankWord(sv5.prevRank)} last season` : ''}.` : '', b ? `Of the goals against beyond average: shots ${signed(b.volume)}, their danger ${signed(b.quality)}, goaltending ${signed(b.goalie)}.` : ''].filter(Boolean),
    action: team <= -4 || (third(sv5) === 'bottom' && prevSv5) ? 'Make a starting goalie the first priority of the next move, ahead of any skater: nothing else changes the standings as much per dollar.' : team < 0 ? 'Ride the hot hand and give the structure in front a cleaner slot before shopping for a goalie.' : 'Leave the crease alone and spend elsewhere.' });
  // how they play
  const sat = by('sat');
  if (sat) {
    const bad = third(sat) === 'bottom' || (sat.value < 0.48 && (sat.prevRank ?? 0) > sat.of / 2);
    qs.push({ area: 'The system', verdict: bad ? 'Rethink' : sat.value < 0.5 ? 'Adjust' : 'Keep', title: bad ? 'The 5-on-5 game needs a different plan' : sat.value < 0.5 ? 'Tighten the even-strength game' : 'The even-strength game works',
      evidence: [`5-on-5 shot share ${sat.fmt(sat.value)}, ${rankWord(sat.rank)}${sat.prevRank ? ` (${rankWord(sat.prevRank)} last season)` : ''}.`, b && b.hdShare != null && b.lgHdShare != null ? `${pct0(b.hdShare)} of shots against come from the slot and crease (league ${pct0(b.lgHdShare)}).` : '', d.tracking?.bursts20?.rank ? `${rankWord(d.tracking.bursts20.rank)} in speed bursts; ${by('sf') ? `${rankWord(by('sf')!.rank)} in shots for` : ''}.` : ''].filter(Boolean),
      action: bad ? 'Change how they defend and break out, not just who plays: a more aggressive neutral-zone forecheck to win pucks back, and defencemen who carry it out rather than chip it.' : sat.value < 0.5 ? 'Small changes: quicker support on breakouts and more shots from the point through traffic.' : 'Keep the structure; add skill on top.' });
  }
  // special teams
  const pk = by('pk'), pp = by('pp');
  if (pk && third(pk) === 'bottom') qs.push({ area: 'The kill', verdict: (pk.prevRank ?? 0) > pk.of - Math.round(pk.of / 3) ? 'Rethink' : 'Adjust', title: (pk.prevRank ?? 0) > pk.of - Math.round(pk.of / 3) ? 'Two bad seasons on the kill: it is personnel' : 'Fix the kill before it costs the season',
    evidence: [`${pk.fmt(pk.value)} killed, ${rankWord(pk.rank)}${pk.prevRank ? `; ${rankWord(pk.prevRank)} last season` : ''}.`], action: 'Change the system (more pressure up top, fewer passive boxes) and bring in a forward whose job is the kill.' });
  if (pp && pk && third(pp) === 'top' && third(pk) === 'bottom') qs.push({ area: 'Special teams', verdict: 'Adjust', title: 'The power play is hiding the kill', evidence: [`Power play ${pp.fmt(pp.value)} (${rankWord(pp.rank)}), kill ${pk.fmt(pk.value)} (${rankWord(pk.rank)}).`], action: 'Move a power-play regular who can defend onto the kill, and stop leaning on the power play to cover for it: referees call less in the playoffs.' });
  // the blue line
  const rhD = d.roster.filter((p) => p.pos === 'D' && p.shoots === 'R').length;
  const dRel = (o?.club ?? []).filter((s) => s.pos === 'D' && s.satRel != null && s.gp >= 3);
  const dAvg = dRel.length ? dRel.reduce((t, s) => t + (s.satRel ?? 0), 0) / dRel.length : null;
  if (a.dShare != null) qs.push({ area: 'The blue line', verdict: a.dShare < 0.15 || rhD < 2 ? 'Rethink' : a.dShare < 0.2 || rhD < 3 ? 'Adjust' : 'Keep', title: a.dShare < 0.15 ? 'The defence doesn\'t create' : rhD < 3 ? 'Short on right shots' : 'A balanced blue line',
    evidence: [`Defencemen have ${pct0(a.dShare)} of the points.`, `${rhD} right-shot defencemen on the roster.`, dAvg != null ? `The defence's average shot-share relative: ${signed(dAvg * 100)} points.` : ''].filter(Boolean),
    action: a.dShare < 0.2 || rhD < 3 ? 'The next defenceman should shoot right and move the puck: it fixes the breakouts and the second power-play unit at once.' : 'Keep the pairs together; depth here is a strength.' });
  // the pipeline
  const young = d.skaters.filter((s) => s.gp >= Math.min(3, d.standing?.gp ?? 3) && (age.get(s.id) ?? 30) <= 23).length;
  const recent = (h?.firsts ?? []).filter((p) => now.getFullYear() - p.year >= 4 && now.getFullYear() - p.year <= 12);
  const hits = recent.filter((p) => (p.career?.gp ?? 0) >= 200).length;
  qs.push({ area: 'The pipeline', verdict: young <= 1 && d.prospects.length < 8 ? 'Rethink' : young <= 2 ? 'Adjust' : 'Keep', title: young <= 1 ? 'Too few young players coming through' : 'The next wave',
    evidence: [`${young} regulars aged 23 or under; ${d.prospects.length} prospects in the system.`, recent.length ? `First-round picks from the last decade who became regulars (200+ games): ${hits} of ${recent.length}.` : ''].filter(Boolean),
    action: young <= 2 ? 'Stop trading first-round picks for rentals unless the return is a core player, and give the best prospect a real role rather than a fourth-line audition.' : 'Keep developing: the young players are already in the lineup.' });
  // the identity
  const speed = d.tracking?.bursts20?.rank, sf = by('sf'), hd = d.tracking?.ranges.find((r) => r.where === 'high');
  if (speed != null && sf) qs.push({ area: 'The identity', verdict: speed <= 8 && sf.rank > 20 ? 'Adjust' : 'Keep', title: speed <= 8 && sf.rank > 20 ? 'A fast team that doesn\'t shoot' : 'Play to who they are',
    evidence: [`${rankWord(speed)} in speed bursts over 20 mph, ${rankWord(sf.rank)} in shots for a game.`, hd?.shotsRank ? `${rankWord(hd.shotsRank)} in shots from the slot and crease, ${hd.pctRank ? rankWord(hd.pctRank) : '–'} in finishing there.` : ''].filter(Boolean),
    action: speed <= 8 && sf.rank > 20 ? 'Turn the speed into volume: shoot off the rush, drive the middle lane, and send the second forward to the net instead of looking for the perfect pass.' : 'Keep building around the skating.' });
  const order = { Rethink: 0, Adjust: 1, Keep: 2 };
  return qs.sort((x, y) => order[x.verdict] - order[y.verdict]);
}

// the goalie calls for the verdict's list
export function goalieRecs(plan: GoaliePlan | null, market: MarketGoalie[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const s = plan?.starter;
  if (s && s.gsax != null && s.gs >= 5 && s.gsax <= -3) recs.push({ area: 'Goaltending', priority: 'high', title: `Shop for a goalie: ${s.name} is ${signed(s.gsax)} against the shots' danger`, why: `${s.verdict.text}${market[0] ? ` The best upgrade from a seller: ${market[0].name} (${market[0].team}), worth about ${market[0].addWins.toFixed(1)} wins over the rest of the season.` : ''}` });
  const hd = s?.danger[0];
  if (s && hd && hd.pct != null && hd.pct < 0.25 && hd.sa >= 20) recs.push({ area: 'Goaltending', priority: 'medium', title: 'Close the slot in front of the goalie', why: `${s.name} stops ${sv(hd.svp)} from the slot and crease (league ${sv(hd.lg)}). Box out at the net and take away the back-door pass before blaming the goalie alone.` });
  // a starter who swings between great and awful nights: the bad ones decide games
  if (s && s.gs >= 6 && s.spread != null && s.spread >= 0.06 && s.bad >= 2) recs.push({ area: 'Goaltending', priority: 'watch', title: `Steady ${s.name}'s bad nights`, why: `${s.bad} of his ${s.gs} starts finished under .850, and night to night his save percentage swings by ${(s.spread * 1000).toFixed(0)} points. The goalie coach's work is the floor, not the ceiling.` });
  return recs;
}
