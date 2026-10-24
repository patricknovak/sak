// A club's fan zone (24 October 2026, Patrick: "the most incredible fan page of the Oilers ... a deep assessment of the
// team, their strengths and weaknesses and what management and coaching should consider based on deep statistical
// analysis"). nhl-hub's `fan` task brings the numbers (the club's season and last season, every club's team numbers, the
// roster, prospects, schedule, playoff runs and news); this file reads them: where the club ranks among the 32 on each
// measure, what is real and what is luck, who is growing and who is fading, and what the numbers say to do about it.
// Pure, so it is tested on its own (supabase/tests/fan-zone.test.mjs).

export interface FanTeam {
  abbrev: string; name: string; gp: number; w: number; l: number; otl: number; pts: number; ptsPct: number;
  gf: number; ga: number; pp: number; pk: number; sf: number; sa: number; fo: number;
  sat: number | null; satAhead: number | null; satBehind: number | null; sv5: number | null; sh5: number | null; pdo: number | null; gfPct: number | null;
  give60: number | null; take60: number | null; hits60: number | null; blocks60: number | null;
}
export interface FanSkater { id: number; name: string; pos: string; gp: number; g: number; a: number; pts: number; pm: number; pim: number; ppg: number; sog: number; pct: number; toi: number; fo: number; headshot: string | null }
export interface FanGoalie { id: number; name: string; gp: number; gs: number; w: number; l: number; otl: number; gaa: number; svp: number; so: number; headshot: string | null }
export interface FanPerson { id: number; name: string; num: number | null; pos: string; shoots: string; ht: number; wt: number; born: string; city: string; country: string; headshot: string | null }
export interface FanGame { id: number; date: string; start: string; state: string; home: string; away: string; hs: number | null; as: number | null; outcome: string | null }
export interface FanRun { season: number; rounds: { round: number; opp: string; w: number; l: number }[] }
export interface FanNews { id: string; source: string; headline: string; summary: string; date: string; url: string; image: string | null; video?: boolean }
export interface FanStanding { gp: number; w: number; l: number; otl: number; pts: number; ptsPct: number; gd: number; div: string; divRank: number; confRank: number; leagueRank: number; wildRank: number; streak: string | null; l10: string; home: string; road: string }
export interface FanData {
  abbrev: string; name: string; season: number; prevSeason: number; standing: FanStanding | null;
  league: FanTeam[]; leaguePrev: FanTeam[]; skaters: FanSkater[]; goalies: FanGoalie[]; skatersPrev: FanSkater[]; goaliesPrev: FanGoalie[];
  roster: FanPerson[]; prospects: FanPerson[]; recent: FanGame[]; upcoming: FanGame[]; playoffs: FanRun[]; news: FanNews[]; at: string; stale?: boolean;
}

// the measures a club is ranked on, best first: higher is better unless `low`
export type MetricKey = 'ptsPct' | 'gf' | 'ga' | 'pp' | 'pk' | 'sf' | 'sa' | 'sat' | 'sv5' | 'sh5' | 'fo' | 'give60' | 'take60' | 'satAhead';
export interface Metric { key: MetricKey; label: string; low?: boolean; fmt: (v: number) => string; what: string }
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const dec2 = (v: number) => v.toFixed(2);
const dec1 = (v: number) => v.toFixed(1);
const svp = (v: number) => v.toFixed(3).replace(/^0/, '');
export const METRICS: Metric[] = [
  { key: 'ptsPct', label: 'Points %', fmt: (v) => v.toFixed(3).replace(/^0/, ''), what: 'share of the points available that they have taken' },
  { key: 'gf', label: 'Goals for a game', fmt: dec2, what: 'goals scored per game, all situations' },
  { key: 'ga', label: 'Goals against a game', low: true, fmt: dec2, what: 'goals allowed per game, all situations' },
  { key: 'pp', label: 'Power play', fmt: pct1, what: 'power-play goals per opportunity' },
  { key: 'pk', label: 'Penalty kill', fmt: pct1, what: 'opponents’ power plays killed' },
  { key: 'sat', label: '5-on-5 shot share', fmt: pct1, what: 'share of all 5-on-5 shot attempts that are theirs (Corsi): who has the puck' },
  { key: 'sf', label: 'Shots for a game', fmt: dec1, what: 'shots on goal per game' },
  { key: 'sa', label: 'Shots against a game', low: true, fmt: dec1, what: 'shots on goal allowed per game' },
  { key: 'sv5', label: '5-on-5 save %', fmt: svp, what: 'saves on 5-on-5 shots: the goaltending' },
  { key: 'sh5', label: '5-on-5 shooting %', fmt: pct1, what: 'goals per 5-on-5 shot: finishing, and luck' },
  { key: 'fo', label: 'Faceoffs', fmt: pct1, what: 'draws won' },
  { key: 'satAhead', label: 'Shot share with the lead', fmt: pct1, what: '5-on-5 shot share while ahead: do they keep pushing or sit back' },
  { key: 'give60', label: 'Giveaways an hour', low: true, fmt: dec1, what: 'pucks given away per 60 minutes' },
  { key: 'take60', label: 'Takeaways an hour', fmt: dec1, what: 'pucks taken away per 60 minutes' },
];

export interface Ranked { key: MetricKey; label: string; value: number; rank: number; of: number; avg: number; best: number; worst: number; prevRank: number | null; prevValue: number | null; fmt: (v: number) => string; what: string; low: boolean }

// where a club stands among those with a number for it (1 is best)
export function rankIn(league: FanTeam[], abbrev: string, m: Metric) {
  const rows = league.filter((t) => t[m.key] != null && t.gp > 0) as (FanTeam & Record<MetricKey, number>)[];
  const me = rows.find((t) => t.abbrev === abbrev);
  if (!me) return null;
  const v = me[m.key];
  const sorted = [...rows].sort((a, b) => (m.low ? a[m.key] - b[m.key] : b[m.key] - a[m.key]));
  const vals = rows.map((t) => t[m.key]);
  return { value: v, rank: 1 + sorted.filter((t) => (m.low ? t[m.key] < v : t[m.key] > v)).length, of: rows.length, avg: vals.reduce((a, b) => a + b, 0) / vals.length, best: m.low ? Math.min(...vals) : Math.max(...vals), worst: m.low ? Math.max(...vals) : Math.min(...vals) };
}

export function rankAll(d: FanData): Ranked[] {
  const out: Ranked[] = [];
  for (const m of METRICS) {
    const now = rankIn(d.league, d.abbrev, m);
    if (!now) continue;
    const prev = rankIn(d.leaguePrev, d.abbrev, m);
    out.push({ key: m.key, label: m.label, ...now, prevRank: prev?.rank ?? null, prevValue: prev?.value ?? null, fmt: m.fmt, what: m.what, low: !!m.low });
  }
  return out;
}

export const ageOn = (born: string | null | undefined, at: Date) => {
  if (!born) return null;
  const b = new Date(`${born}T12:00:00Z`);
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  if (at.getUTCMonth() < b.getUTCMonth() || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate())) a--;
  return a;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export interface Development {
  id: number; name: string; pos: string; age: number | null; headshot: string | null; gp: number; pts: number; ppg: number;
  prevGp: number | null; prevPpg: number | null; delta: number | null; toi: number; prevToi: number | null; toiDelta: number | null;
  verdict: 'rising' | 'fading' | 'steady' | 'new';
}
export interface Recommendation { area: string; title: string; why: string; priority: 'high' | 'medium' | 'watch' }
export interface Assessment {
  ranks: Ranked[]; strengths: Ranked[]; weaknesses: Ranked[]; grade: string; score: number; early: boolean;
  luck: { pdo: number | null; sh5Rank: number | null; sv5Rank: number | null; read: string; tone: 'hot' | 'cold' | 'fair' } | null;
  stars: { names: string[]; share: number; goalsShare: number } | null; depth: { ppg: number; players: number } | null;
  dShare: number | null; goalies: { id: number; name: string; gp: number; gs: number; svp: number; leagueSvp: number; share: number; headshot: string | null }[];
  development: Development[]; youngCore: Development[]; recs: Recommendation[]; summary: string;
}

const rankWord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
export { rankWord };

export function assess(d: FanData, now = new Date()): Assessment {
  const ranks = rankAll(d);
  const by = (k: MetricKey) => ranks.find((r) => r.key === k) ?? null;
  const gp = d.standing?.gp ?? d.league.find((t) => t.abbrev === d.abbrev)?.gp ?? 0;
  const early = gp < 20;
  // the top and bottom thirds of the league: 1st to 11th, 22nd to 32nd
  const top = (r: Ranked) => r.rank <= Math.round(r.of / 3);
  const bottom = (r: Ranked) => r.rank > r.of - Math.round(r.of / 3);
  // the style numbers (hits, giveaways, takeaways) describe more than they grade: they join the lists only at the ends
  const graded: MetricKey[] = ['ptsPct', 'gf', 'ga', 'pp', 'pk', 'sat', 'sf', 'sa', 'sv5', 'fo', 'satAhead', 'give60'];
  const strengths = ranks.filter((r) => graded.includes(r.key) && r.key !== 'ptsPct' && top(r)).sort((a, b) => a.rank - b.rank);
  const weaknesses = ranks.filter((r) => graded.includes(r.key) && r.key !== 'ptsPct' && bottom(r)).sort((a, b) => b.rank - a.rank);

  // one grade from the measures that win games, each by where it stands among the 32 (0 last, 1 first)
  const W: Partial<Record<MetricKey, number>> = { ptsPct: 3, sat: 2, gf: 1.5, ga: 1.5, pp: 1, pk: 1, sv5: 1 };
  let sw = 0, st = 0;
  for (const [k, w] of Object.entries(W) as [MetricKey, number][]) { const r = by(k); if (!r) continue; st += w * (1 - (r.rank - 1) / Math.max(1, r.of - 1)); sw += w; }
  const score = sw ? st / sw : 0.5;
  const grade = score >= 0.9 ? 'A+' : score >= 0.8 ? 'A' : score >= 0.72 ? 'A-' : score >= 0.65 ? 'B+' : score >= 0.58 ? 'B' : score >= 0.5 ? 'B-' : score >= 0.43 ? 'C+' : score >= 0.36 ? 'C' : score >= 0.28 ? 'C-' : score >= 0.2 ? 'D' : 'F';

  // luck: shooting plus save percentage at 5-on-5 drifts back toward 1.000 over a season
  const me = d.league.find((t) => t.abbrev === d.abbrev);
  const pdo = me?.pdo ?? null;
  const luck = pdo == null ? null : {
    pdo, sh5Rank: by('sh5')?.rank ?? null, sv5Rank: by('sv5')?.rank ?? null,
    tone: (pdo >= 1.02 ? 'hot' : pdo <= 0.98 ? 'cold' : 'fair') as 'hot' | 'cold' | 'fair',
    read: pdo >= 1.02 ? `At 5-on-5 they shoot ${pct1(me!.sh5 ?? 0)} and stop ${svp(me!.sv5 ?? 0)}: a combined ${(pdo * 1000).toFixed(0)} that almost no team holds over a season. Some of the record is bounces, and it tends to drift back toward 1000.`
      : pdo <= 0.98 ? `At 5-on-5 they shoot ${pct1(me!.sh5 ?? 0)} and stop ${svp(me!.sv5 ?? 0)}: a combined ${(pdo * 1000).toFixed(0)}, well under the 1000 most teams settle near. The results should improve even if nothing else changes.`
      : `Their 5-on-5 shooting and save percentages add to ${(pdo * 1000).toFixed(0)}, close to the 1000 most teams settle near: the record is about what the play has earned.`,
  };

  // stars and depth: how much of the scoring runs through the top two
  const sk = [...d.skaters].filter((p) => p.gp > 0).sort((a, b) => b.pts - a.pts);
  const teamPts = sk.reduce((t, p) => t + p.pts, 0), teamG = sk.reduce((t, p) => t + p.g, 0);
  const stars = sk.length >= 2 && teamPts > 0 ? { names: sk.slice(0, 2).map((p) => p.name), share: (sk[0].pts + sk[1].pts) / teamPts, goalsShare: teamG ? (sk[0].g + sk[1].g) / teamG : 0 } : null;
  const fwd = sk.filter((p) => p.pos !== 'D');
  const depthRows = fwd.slice(6, 12).filter((p) => p.gp >= Math.min(3, gp));
  const depth = depthRows.length ? { ppg: depthRows.reduce((t, p) => t + p.pts, 0) / depthRows.reduce((t, p) => t + p.gp, 0), players: depthRows.length } : null;
  const dPts = sk.filter((p) => p.pos === 'D').reduce((t, p) => t + p.pts, 0);
  const dShare = teamPts ? dPts / teamPts : null;

  // the crease: each goalie's save percentage against the league's
  const lgSa = d.league.reduce((t, x) => t + x.sa * x.gp, 0), lgGa = d.league.reduce((t, x) => t + x.ga * x.gp, 0);
  const leagueSvp = lgSa ? 1 - lgGa / lgSa : 0.9;
  const starts = d.goalies.reduce((t, g) => t + (g.gs ?? 0), 0);
  const goalies = d.goalies.filter((g) => g.gp > 0).sort((a, b) => b.gs - a.gs)
    .map((g) => ({ id: g.id, name: g.name, gp: g.gp, gs: g.gs, svp: g.svp, leagueSvp, share: starts ? g.gs / starts : 0, headshot: g.headshot }));

  // development: this season's points a game against last season's, and the ice time the coaches give him
  const ages = new Map(d.roster.map((p) => [p.id, ageOn(p.born, now)]));
  const prev = new Map(d.skatersPrev.map((p) => [p.id, p]));
  const development: Development[] = sk.filter((p) => p.gp >= Math.min(3, gp)).map((p) => {
    const q = prev.get(p.id);
    const prevPpg = q && q.gp >= 10 ? q.pts / q.gp : null;
    const ppg = p.pts / p.gp;
    const delta = prevPpg == null ? null : ppg - prevPpg;
    const toiDelta = q && q.gp >= 10 ? p.toi - q.toi : null;
    // the early weeks swing: a riser needs both more scoring and more of the coaches' trust, or a big jump in either
    const verdict: Development['verdict'] = prevPpg == null ? 'new'
      : (delta! >= 0.15 && (toiDelta ?? 0) >= -30) || ((toiDelta ?? 0) >= 90 && delta! >= -0.1) ? 'rising'
      : (delta! <= -0.15 && (toiDelta ?? 0) <= 30) || ((toiDelta ?? 0) <= -90 && delta! <= 0.1) ? 'fading' : 'steady';
    return { id: p.id, name: p.name, pos: p.pos, age: ages.get(p.id) ?? null, headshot: p.headshot, gp: p.gp, pts: p.pts, ppg, prevGp: q?.gp ?? null, prevPpg, delta, toi: p.toi, prevToi: q && q.gp >= 10 ? q.toi : null, toiDelta, verdict };
  });
  const youngCore = development.filter((p) => p.age != null && p.age <= 24).sort((a, b) => b.ppg - a.ppg);

  // what the numbers say to do, most pressing first
  const recs: Recommendation[] = [];
  const r = by;
  const pk = r('pk'), pp = r('pp'), ga = r('ga'), sa = r('sa'), sv5 = r('sv5'), sat = r('sat'), fo = r('fo'), ahead = r('satAhead'), give = r('give60'), gf = r('gf');
  const sample = early ? ` Only ${gp} games in, so treat it as a lean, not a verdict.` : '';
  if (pk && bottom(pk)) recs.push({ area: 'Penalty kill', priority: 'high', title: 'Fix the penalty kill', why: `${pk.fmt(pk.value)} killed ranks ${rankWord(pk.rank)} of ${pk.of} (league average ${pk.fmt(pk.avg)}). Every point of PK is worth goals: tighten the box, pressure the flanks, and give the kill to the players winning their draws and blocking shots.${sample}` });
  if (sv5 && bottom(sv5) && ga && ga.rank > ga.of / 2) recs.push({ area: 'Goaltending', priority: 'high', title: 'Shore up the crease', why: `The 5-on-5 save percentage of ${sv5.fmt(sv5.value)} ranks ${rankWord(sv5.rank)}, and they allow ${ga.fmt(ga.value)} goals a game (${rankWord(ga.rank)}). If the shots against are ordinary, the gap is in net: ride the hotter goalie and look at the market for a proven starter.${sample}` });
  if (sa && bottom(sa)) recs.push({ area: 'Defending', priority: 'high', title: 'Give up fewer shots', why: `${sa.fmt(sa.value)} shots against a game ranks ${rankWord(sa.rank)}. That points at structure more than goaltending: quicker breakouts, tighter gaps in the neutral zone, and forwards back on time.` });
  if (sat && sat.value < 0.48) recs.push({ area: '5-on-5 play', priority: sat.value < 0.46 ? 'high' : 'medium', title: 'Win more of the puck at 5-on-5', why: `They take ${sat.fmt(sat.value)} of 5-on-5 shot attempts, ${rankWord(sat.rank)} in the league. Teams that win the Cup almost always control more than half: more possession time for the depth lines and fewer dump-ins against.${luck?.tone === 'hot' ? ' With the luck running hot, this is the number to watch when the bounces even out.' : ''}` });
  const sf = r('sf'), sh5 = r('sh5');
  if (sf && bottom(sf)) recs.push({ area: 'Shot volume', priority: sh5 && top(sh5) ? 'high' : 'medium', title: 'Get more pucks to the net', why: `${sf.fmt(sf.value)} shots a game ranks ${rankWord(sf.rank)}.${sh5 && top(sh5) ? ` They score on ${sh5.fmt(sh5.value)} of their 5-on-5 shots (${rankWord(sh5.rank)}), a finishing rate that rarely lasts: when it cools, the goals go with it unless the shots climb.` : ''} Shoot from the point through traffic, and get a second body to the net for rebounds.` });
  if (stars && stars.share >= 0.38) recs.push({ area: 'Depth scoring', priority: stars.share >= 0.45 ? 'high' : 'medium', title: 'Find scoring beyond the top two', why: `${stars.names.join(' and ')} have ${Math.round(stars.share * 100)}% of the team's points and ${Math.round(stars.goalsShare * 100)}% of its goals.${depth ? ` The forwards after the top six score ${depth.ppg.toFixed(2)} points a game.` : ''} When the stars are checked, as they will be in the playoffs, the depth has to finish: a scoring winger for the third line, or more power-play time for the second unit.` });
  if (ahead && ahead.value < 0.42) recs.push({ area: 'Game management', priority: 'medium', title: 'Keep pushing with the lead', why: `With the lead they take only ${ahead.fmt(ahead.value)} of 5-on-5 shot attempts (${rankWord(ahead.rank)}). Sitting back invites pressure: keep the forecheck on, and use the defencemen who can move the puck out.` });
  if (fo && bottom(fo)) recs.push({ area: 'Faceoffs', priority: 'watch', title: 'Win more draws', why: `${fo.fmt(fo.value)} on faceoffs ranks ${rankWord(fo.rank)}. It matters most on the kill and late in games: a right-shot centre who wins draws is a cheap fix.` });
  if (give && bottom(give)) recs.push({ area: 'Puck management', priority: 'watch', title: 'Cut the giveaways', why: `${give.fmt(give.value)} giveaways an hour ranks ${rankWord(give.rank)}. Simpler exits and fewer stretch passes through the middle.` });
  if (luck?.tone === 'hot' && !recs.some((x) => x.area === '5-on-5 play')) recs.push({ area: 'Luck', priority: 'watch', title: 'Don’t let the hot start hide the work', why: luck.read });
  if (luck?.tone === 'cold') recs.push({ area: 'Patience', priority: 'watch', title: 'Stay the course', why: luck.read });
  const starter = goalies[0];
  if (starter && starter.share >= 0.85 && starter.gs >= 10) recs.push({ area: 'Workload', priority: 'medium', title: 'Manage the starter’s workload', why: `${starter.name} has started ${Math.round(starter.share * 100)}% of the games. A starter is fresher in April with 55 to 60 starts: plan the back-to-backs for the backup.` });
  if (pp && top(pp)) recs.push({ area: 'Power play', priority: 'watch', title: 'Lean on the power play', why: `${pp.fmt(pp.value)} on the power play ranks ${rankWord(pp.rank)}. Drawing penalties is a weapon for this team: speed through the neutral zone and net-front work earn more chances.` });
  if (dShare != null && dShare < 0.15 && teamPts >= 20) recs.push({ area: 'Blue line', priority: 'watch', title: 'More offence from the back end', why: `The defencemen have ${Math.round(dShare * 100)}% of the team's points. A defenceman who joins the rush and moves the puck first would take pressure off the forwards.` });
  if (gf && bottom(gf) && !recs.some((x) => x.area === 'Depth scoring')) recs.push({ area: 'Scoring', priority: 'high', title: 'Find more goals', why: `${gf.fmt(gf.value)} goals a game ranks ${rankWord(gf.rank)}. More shots from the slot and more traffic at the net.` });
  const order = { high: 0, medium: 1, watch: 2 };
  recs.sort((a, b) => order[a.priority] - order[b.priority]);

  const ptsPct = by('ptsPct');
  const summary = !ptsPct ? `${d.name}: the season is about to start.`
    : `${d.name} are ${d.standing ? `${rankWord(d.standing.leagueRank)} in the league (${d.standing.w}-${d.standing.l}-${d.standing.otl})` : `${rankWord(ptsPct.rank)} of ${ptsPct.of} by points percentage`}${strengths.length ? `, built on ${strengths.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}${weaknesses.length ? `, held back by ${weaknesses.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}.${luck?.tone === 'hot' ? ' Some of it is bounces.' : luck?.tone === 'cold' ? ' The bounces owe them.' : ''}${early ? ` ${gp} games in: early, and the numbers will move.` : ''}`;
  return { ranks, strengths, weaknesses, grade, score, early, luck, stars, depth, dShare, goalies, development, youngCore, recs, summary };
}

export const fmtToi = (s: number | null) => (s == null ? '–' : mmss(s));
