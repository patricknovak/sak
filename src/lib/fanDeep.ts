// The fan zone's deeper reads (24 October 2026, Patrick: "improve the fan zone analytics and history and facts by at
// least 300%"). Everything here works from nhl-hub's `fan` and `fan-history` answers, pure and tested on its own
// (supabase/tests/fan-zone.test.mjs):
//   outlook   the season simulated to its end for all 32 clubs: playoff, division and top-seed chances, the points it
//             will take and the line it has to clear
//   truth     what the record should be: goals-based (Pythagorean) wins, and the 5-on-5 goals with league-average luck
//   splits    home and road, the division, the conference, playoff teams, back-to-backs, overtime, one-goal games, by
//             month, and the situations (leading, trailing, scoring first)
//   form      the season game by game: points pace, rolling goal difference, streaks
//   ahead     the schedule still to play: how hard it is, back-to-backs, the longest trip
//   players   pace, 5-on-5 rates, shooting luck against the career line, milestones in reach, usage
//   crease    goals saved above average and quality starts
//   tracking  the NHL's tracking read in words
//   champion  this season's numbers against last season's Cup winner's
//   deepRecs  the recommendations these reads add to the assessment's
// and the history reads: eras, the playoff record, rivals, the draft.
import { METRICS, metricValue, rankWord, type FanData, type FanGame, type FanTableRow, type FanTeam, type Recommendation, type WLO } from './fanZone.ts';

const SEASON_GAMES = 82;
const OT_SHARE = 0.23;   // about a game in four goes past regulation: each club takes an overtime loss in roughly one in nine
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const svp = (v: number) => v.toFixed(3).replace(/^0/, '');
const played = (g: FanGame) => g.state === 'OFF' || g.state === 'FINAL';

// a steady random stream, so the same numbers always simulate to the same odds
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
function normal(r: () => number) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

// ── the outlook
export interface Outlook {
  sims: number; playoffs: number; division: number; top3: number; conference: number; presidents: number;
  projected: { low: number; mid: number; high: number }; pace: number; line: number; need: number | null; needPace: number | null; left: number;
  odds: { abbrev: string; name: string; pts: number; gp: number; playoffs: number; projected: number }[];   // the club's conference, best chance first
}
// A club's true strength is its points percentage pulled toward the league's by 25 games of average hockey: ten games
// in, a hot start counts for less than half of the read. Each of the rest of the games is then a draw: a win, an overtime
// loss (one point) or a regulation loss. Top three in each division and the next two in the conference make it.
export function outlook(d: FanData, sims = 4000): Outlook | null {
  const table = d.table ?? [];
  const me = table.find((t) => t.abbrev === d.abbrev);
  if (!me || table.length < 16) return null;
  const totalGp = table.reduce((s, t) => s + t.gp, 0), totalPts = table.reduce((s, t) => s + t.pts, 0);
  const m = totalGp ? totalPts / (2 * totalGp) : 0.555;
  const K = 25;
  const teams = table.map((t) => {
    const p = (t.pts + 2 * K * m) / (2 * (t.gp + K));
    const left = Math.max(0, SEASON_GAMES - t.gp);
    return { t, p, left, sd: Math.sqrt((p * (1 - p)) / (2 * (t.gp + K))) };
  });
  const r = rng(seedOf(`${d.abbrev}:${totalGp}:${totalPts}`));
  const conf = me.conf;
  const count = new Map<string, { po: number; pts: number }>(table.map((t) => [t.abbrev, { po: 0, pts: 0 }]));
  let division = 0, top3 = 0, conference = 0, presidents = 0;
  const mine: number[] = [], lines: number[] = [];
  for (let s = 0; s < sims; s++) {
    const fin = teams.map(({ t, p, left, sd }) => {
      const q = Math.min(0.85, Math.max(0.15, p + normal(r) * sd));
      const o = OT_SHARE / 2, w = Math.max(0, q - o / 2);
      const mean = left * (2 * w + o), varg = Math.max(0.01, 4 * w + o - (2 * w + o) ** 2);
      const add = Math.round(Math.min(2 * left, Math.max(0, mean + normal(r) * Math.sqrt(left * varg))));
      return { t, pts: t.pts + add, tie: (t.rw ?? t.w) + r() };
    });
    const order = [...fin].sort((a, b) => b.pts - a.pts || b.tie - a.tie);
    if (order[0].t.abbrev === d.abbrev) presidents++;
    for (const c of new Set(table.map((t) => t.conf))) {
      const inConf = order.filter((x) => x.t.conf === c);
      const inPo = new Set<string>();
      for (const dv of new Set(inConf.map((x) => x.t.div))) inConf.filter((x) => x.t.div === dv).slice(0, 3).forEach((x) => inPo.add(x.t.abbrev));
      const wild = inConf.filter((x) => !inPo.has(x.t.abbrev)).slice(0, 2);
      wild.forEach((x) => inPo.add(x.t.abbrev));
      for (const a of inPo) count.get(a)!.po++;
      if (c === conf) {
        lines.push(wild[1]?.pts ?? wild[0]?.pts ?? 0);
        if (inConf[0].t.abbrev === d.abbrev) conference++;
        const myDiv = inConf.filter((x) => x.t.div === me.div);
        const at = myDiv.findIndex((x) => x.t.abbrev === d.abbrev);
        if (at === 0) division++;
        if (at >= 0 && at < 3) top3++;
      }
    }
    for (const x of fin) count.get(x.t.abbrev)!.pts += x.pts;
    mine.push(fin.find((x) => x.t.abbrev === d.abbrev)!.pts);
  }
  mine.sort((a, b) => a - b); lines.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const line = q(lines, 0.5), left = Math.max(0, SEASON_GAMES - me.gp);
  const need = Math.max(0, line - me.pts);
  return {
    sims, playoffs: count.get(d.abbrev)!.po / sims, division: division / sims, top3: top3 / sims, conference: conference / sims, presidents: presidents / sims,
    projected: { low: q(mine, 0.1), mid: q(mine, 0.5), high: q(mine, 0.9) }, pace: me.gp ? (me.pts / me.gp) * SEASON_GAMES : 0, line, left,
    need: left ? need : null, needPace: left ? need / (2 * left) : null,
    odds: table.filter((t) => t.conf === conf).map((t) => ({ abbrev: t.abbrev, name: t.name, pts: t.pts, gp: t.gp, playoffs: count.get(t.abbrev)!.po / sims, projected: Math.round(count.get(t.abbrev)!.pts / sims) }))
      .sort((a, b) => b.playoffs - a.playoffs || b.pts - a.pts),
  };
}

// ── what the record should be
export interface Truth {
  pythagWins: number; wins: number; luckWins: number;
  adj: { gf: number; ga: number; actualGd: number; adjGd: number; sh5: number; sv5: number; lgSh5: number; lgSv5: number } | null;
  read: string;
}
// Goals scored and allowed predict wins better than wins predict themselves: a club's expected win share is GF^2 over
// GF^2 + GA^2. The 5-on-5 goals are re-scored at the league's average shooting and save percentages to strip the bounces.
export function truth(d: FanData): Truth | null {
  const t = d.league.find((x) => x.abbrev === d.abbrev);
  if (!t || !t.gp) return null;
  const gf = Math.round(t.gf * t.gp), ga = Math.round(t.ga * t.gp);
  const x = gf ** 2 / (gf ** 2 + ga ** 2 || 1);
  const pythagWins = x * t.gp;
  const avg = (k: 'sh5' | 'sv5') => { const v = d.league.map((y) => y[k]).filter((v): v is number => v != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lgSh5 = avg('sh5'), lgSv5 = avg('sv5');
  const adj = t.g5v5f != null && t.g5v5a != null && t.sh5 && t.sv5 && lgSh5 && lgSv5 && t.sv5 < 1
    ? { gf: t.g5v5f * (lgSh5 / t.sh5), ga: t.g5v5a * ((1 - lgSv5) / (1 - t.sv5)), actualGd: t.g5v5f - t.g5v5a, adjGd: 0, sh5: t.sh5, sv5: t.sv5, lgSh5, lgSv5 } : null;
  if (adj) adj.adjGd = adj.gf - adj.ga;
  const luckWins = t.w - pythagWins;
  const read = `Their goals (${gf} for, ${ga} against) are worth ${pythagWins.toFixed(1)} wins; they have ${t.w}. `
    + (Math.abs(luckWins) < 1 ? 'The record is what the goals have earned. ' : luckWins > 0 ? `That's ${luckWins.toFixed(1)} more than the goals explain: close games have gone their way. ` : `That's ${(-luckWins).toFixed(1)} fewer than the goals explain: the close ones have got away. `)
    + (adj ? `At 5-on-5 they are ${adj.actualGd >= 0 ? '+' : ''}${adj.actualGd}; with the league's average shooting (${pct1(lgSh5!)}) and goaltending (${svp(lgSv5!)}) instead of their own (${pct1(t.sh5!)}, ${svp(t.sv5!)}), it would be ${adj.adjGd >= 0 ? '+' : ''}${adj.adjGd.toFixed(1)}.` : '');
  return { pythagWins, wins: t.w, luckWins, adj, read };
}

// ── splits
export interface Split { label: string; w: number; l: number; otl: number; gp: number; pct: number; note?: string }
const rec = (label: string, games: { won: boolean; ot: boolean }[], note?: string): Split => {
  const w = games.filter((g) => g.won).length, otl = games.filter((g) => !g.won && g.ot).length, l = games.length - w - otl;
  return { label, w, l, otl, gp: games.length, pct: games.length ? (2 * w + otl) / (2 * games.length) : 0, note };
};
const wlo = (label: string, r: WLO | undefined, note?: string): Split | null => (r && r[0] + r[1] + r[2] ? { label, w: r[0], l: r[1], otl: r[2], gp: r[0] + r[1] + r[2], pct: (2 * r[0] + r[2]) / (2 * (r[0] + r[1] + r[2])), note } : null);
export interface Splits { venue: Split[]; opponents: Split[]; schedule: Split[]; situations: Split[]; months: Split[]; periods: { label: string; gf: number; ga: number }[] }
export function splits(d: FanData): Splits {
  const games = (d.schedule ?? []).filter(played);
  const table = new Map((d.table ?? []).map((t) => [t.abbrev, t]));
  const me = table.get(d.abbrev);
  const res = games.map((g, i) => {
    const home = g.home === d.abbrev, opp = home ? g.away : g.home, us = (home ? g.hs : g.as) ?? 0, them = (home ? g.as : g.hs) ?? 0;
    const prev = games[i - 1];
    const b2b = !!prev && (new Date(`${g.date}T12:00:00Z`).getTime() - new Date(`${prev.date}T12:00:00Z`).getTime()) <= 86_400_000;
    return { g, home, opp, won: us > them, ot: !!g.outcome && g.outcome !== 'REG', margin: Math.abs(us - them), b2b, month: g.date.slice(0, 7) };
  });
  // the clubs in a playoff place right now: top three in each division, then the two best of the rest in each conference
  const inNow = new Set<string>();
  for (const c of new Set((d.table ?? []).map((t) => t.conf))) {
    const conf = (d.table ?? []).filter((t) => t.conf === c).sort((a, b) => b.ptsPct - a.ptsPct || b.pts - a.pts);
    for (const dv of new Set(conf.map((t) => t.div))) conf.filter((t) => t.div === dv).slice(0, 3).forEach((t) => inNow.add(t.abbrev));
    conf.filter((t) => !inNow.has(t.abbrev)).slice(0, 2).forEach((t) => inNow.add(t.abbrev));
  }
  const t = d.league.find((x) => x.abbrev === d.abbrev);
  const months = [...new Set(res.map((x) => x.month))].map((mo) => rec(new Date(`${mo}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' }), res.filter((x) => x.month === mo)));
  return {
    venue: [rec('At home', res.filter((x) => x.home)), rec('On the road', res.filter((x) => !x.home))].filter((s) => s.gp),
    opponents: [
      me ? rec(`In the ${me.div === 'P' ? 'Pacific' : me.div === 'C' ? 'Central' : me.div === 'A' ? 'Atlantic' : me.div === 'M' ? 'Metropolitan' : 'division'}`, res.filter((x) => table.get(x.opp)?.div === me.div)) : null,
      me ? rec('Rest of the conference', res.filter((x) => table.get(x.opp)?.conf === me.conf && table.get(x.opp)?.div !== me.div)) : null,
      me ? rec('Other conference', res.filter((x) => table.get(x.opp) && table.get(x.opp)!.conf !== me.conf)) : null,
      rec('Against playoff teams', res.filter((x) => inNow.has(x.opp)), 'clubs in a playoff place today'),
      rec('Against the rest', res.filter((x) => !inNow.has(x.opp))),
    ].filter((s): s is Split => !!s && s.gp > 0),
    schedule: [
      rec('Second night of a back-to-back', res.filter((x) => x.b2b)), rec('With a day or more of rest', res.filter((x) => !x.b2b)),
      rec('Past regulation', res.filter((x) => x.ot), 'overtime and shootouts'), rec('One-goal games', res.filter((x) => x.margin === 1 || x.ot)),
      rec('Decided by three or more', res.filter((x) => x.margin >= 3 && !x.ot)),
    ].filter((s) => s.gp > 0),
    situations: t ? [
      wlo('Leading after one', t.lead1), wlo('Leading after two', t.lead2), wlo('Trailing after one', t.trail1), wlo('Trailing after two', t.trail2),
      wlo('Scoring first', t.first), wlo('Giving up the first goal', t.chase), wlo('Outshooting the other team', t.outshoot), wlo('Outshot', t.outshot),
    ].filter((s): s is Split => !!s) : [],
    months,
    periods: t && t.p1gf != null ? [
      { label: '1st', gf: t.p1gf ?? 0, ga: t.p1ga ?? 0 }, { label: '2nd', gf: t.p2gf ?? 0, ga: t.p2ga ?? 0 }, { label: '3rd', gf: t.p3gf ?? 0, ga: t.p3ga ?? 0 },
      ...((t.otgf ?? 0) + (t.otga ?? 0) ? [{ label: 'OT', gf: t.otgf ?? 0, ga: t.otga ?? 0 }] : []),
    ] : [],
  };
}

// ── form: the season game by game
export interface FormGame { n: number; id: number; date: string; opp: string; home: boolean; us: number; them: number; won: boolean; ot: boolean; pts: number; total: number; roll: number }
export interface Form { games: FormGame[]; longestWin: number; longestPoint: number; longestLoss: number; best: { from: string; to: string; pts: number; of: number } | null; trend: number | null }
export function form(d: FanData): Form {
  const games = (d.schedule ?? []).filter(played);
  let total = 0;
  const out: FormGame[] = games.map((g, i) => {
    const home = g.home === d.abbrev, us = (home ? g.hs : g.as) ?? 0, them = (home ? g.as : g.hs) ?? 0, won = us > them, ot = !!g.outcome && g.outcome !== 'REG';
    const pts = won ? 2 : ot ? 1 : 0;
    total += pts;
    return { n: i + 1, id: g.id, date: g.date, opp: home ? g.away : g.home, home, us, them, won, ot, pts, total, roll: 0 };
  });
  // the goal difference over the last five, game by game
  out.forEach((g, i) => { const w = out.slice(Math.max(0, i - 4), i + 1); g.roll = w.reduce((s, x) => s + x.us - x.them, 0); });
  const run = (f: (g: FormGame) => boolean) => { let best = 0, cur = 0; for (const g of out) { cur = f(g) ? cur + 1 : 0; best = Math.max(best, cur); } return best; };
  // the best ten-game stretch
  let best: Form['best'] = null;
  const span = Math.min(10, out.length);
  for (let i = 0; span >= 5 && i + span <= out.length; i++) {
    const w = out.slice(i, i + span), pts = w.reduce((s, x) => s + x.pts, 0);
    if (!best || pts > best.pts) best = { from: w[0].date, to: w[w.length - 1].date, pts, of: span * 2 };
  }
  const recent = out.slice(-10), early = out.slice(0, Math.max(0, out.length - 10));
  const rate = (w: FormGame[]) => (w.length ? w.reduce((s, x) => s + x.pts, 0) / (2 * w.length) : null);
  const trend = early.length >= 5 && recent.length >= 5 ? rate(recent)! - rate(early)! : null;
  return { games: out, longestWin: run((g) => g.won), longestPoint: run((g) => g.pts > 0), longestLoss: run((g) => g.pts === 0), best, trend };
}

// ── the schedule still to play
export interface Ahead { left: number; home: number; road: number; b2b: number; oppPct: number | null; leaguePct: number; next10Pct: number | null; hardest: string | null; trip: { games: number; from: string; to: string } | null; playoffOpp: number }
export function ahead(d: FanData): Ahead | null {
  const rest = (d.schedule ?? []).filter((g) => !played(g));
  if (!rest.length) return null;
  const table = new Map((d.table ?? []).map((t) => [t.abbrev, t]));
  const totalGp = (d.table ?? []).reduce((s, t) => s + t.gp, 0), leaguePct = totalGp ? (d.table ?? []).reduce((s, t) => s + t.pts, 0) / (2 * totalGp) : 0.555;
  const opp = (g: FanGame) => (g.home === d.abbrev ? g.away : g.home);
  const strength = (g: FanGame) => { const t = table.get(opp(g)); return t && t.gp ? (t.pts + 2 * 10 * leaguePct) / (2 * (t.gp + 10)) : null; };
  const avg = (gs: FanGame[]) => { const v = gs.map(strength).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  let b2b = 0;
  const all = d.schedule ?? [];
  for (const g of rest) {
    const i = all.findIndex((x) => x.id === g.id), prev = all[i - 1];
    if (prev && new Date(`${g.date}T12:00:00Z`).getTime() - new Date(`${prev.date}T12:00:00Z`).getTime() <= 86_400_000) b2b++;
  }
  let trip: Ahead['trip'] = null, cur: FanGame[] = [];
  for (const g of rest) {
    if (g.away === d.abbrev) { cur.push(g); if (!trip || cur.length > trip.games) trip = { games: cur.length, from: cur[0].date, to: g.date }; } else cur = [];
  }
  const counts = new Map<string, number>();
  rest.forEach((g) => counts.set(opp(g), (counts.get(opp(g)) ?? 0) + 1));
  const hardest = [...counts.keys()].map((a) => ({ a, p: table.get(a)?.ptsPct ?? 0 })).sort((x, y) => y.p - x.p)[0]?.a ?? null;
  const ranked = (d.table ?? []).slice().sort((a, b) => b.ptsPct - a.ptsPct).slice(0, 16).map((t) => t.abbrev);
  return {
    left: rest.length, home: rest.filter((g) => g.home === d.abbrev).length, road: rest.filter((g) => g.away === d.abbrev).length, b2b,
    oppPct: avg(rest), leaguePct, next10Pct: avg(rest.slice(0, 10)), hardest, trip: trip && trip.games >= 3 ? trip : null,
    playoffOpp: rest.filter((g) => ranked.includes(opp(g))).length,
  };
}

// ── players
export interface PlayerRead {
  id: number; name: string; pos: string; gp: number; g: number; a: number; pts: number; headshot: string | null;
  paceG: number; paceP: number; toi: number; evToi: number | null; ppToi: number | null; shToi: number | null; ppShare: number | null;
  p60: number | null; sat: number | null; satRel: number | null; zs: number | null; onPdo: number | null; sh: number | null; careerSh: number | null;
  luck: 'hot' | 'cold' | null; luckNote: string | null; hits: number | null; blocks: number | null; take: number | null; give: number | null;
}
export interface Milestone { id: number; name: string; what: string; at: number; now: number; need: number; games: number | null; headshot: string | null }
export function players(d: FanData): { rows: PlayerRead[]; milestones: Milestone[]; usageLeaders: { ev: PlayerRead | null; pp: PlayerRead | null; sh: PlayerRead | null } } {
  const use = new Map((d.usage ?? []).map((u) => [u.id, u]));
  const left = Math.max(0, SEASON_GAMES - (d.standing?.gp ?? 0));
  const ppTeam = (d.usage ?? []).reduce((s, u) => s + (u.pp ?? 0), 0) / 5;   // five skaters on the ice: the team's power-play time a game
  const rows: PlayerRead[] = d.skaters.filter((p) => p.gp > 0).map((p) => {
    const u = use.get(p.id);
    const careerSh = u?.career && u.career.sog >= 150 ? u.career.g / u.career.sog : null;
    const sh = p.sog ? p.g / p.sog : null;
    // a shooter a long way from his career line, on enough shots to matter, tends to drift back to it
    let luck: PlayerRead['luck'] = null, luckNote: string | null = null;
    if (careerSh != null && sh != null && p.sog >= 15) {
      const diff = sh - careerSh, expG = p.sog * careerSh;
      if (diff >= 0.06 && p.g - expG >= 2) { luck = 'hot'; luckNote = `Scoring on ${pct0(sh)} of his shots against ${pct0(careerSh)} over his career: about ${(p.g - expG).toFixed(0)} goals ahead of his usual finish.`; }
      else if (diff <= -0.05 && expG - p.g >= 1.5) { luck = 'cold'; luckNote = `Scoring on ${pct0(sh)} of his shots against ${pct0(careerSh)} over his career: about ${(expG - p.g).toFixed(0)} goals owed if the shots keep coming.`; }
    }
    if (!luck && u?.pdo != null && (u.toi5 ?? 0) >= 600 && p.gp >= 5) {
      if (u.pdo >= 1.06) { luck = 'hot'; luckNote = `With him on the ice at 5-on-5 his club shoots and saves at a ${(u.pdo * 1000).toFixed(0)} clip, well above the 1000 it drifts back toward.`; }
      else if (u.pdo <= 0.94) { luck = 'cold'; luckNote = `With him on the ice at 5-on-5 his club shoots and saves at a ${(u.pdo * 1000).toFixed(0)} clip: the bounces owe him.`; }
    }
    return {
      id: p.id, name: p.name, pos: p.pos, gp: p.gp, g: p.g, a: p.a, pts: p.pts, headshot: p.headshot,
      paceG: (p.g / p.gp) * SEASON_GAMES, paceP: (p.pts / p.gp) * SEASON_GAMES, toi: p.toi, evToi: u?.ev ?? null, ppToi: u?.pp ?? null, shToi: u?.sh ?? null,
      ppShare: ppTeam > 0 && u?.pp != null ? Math.min(1, u.pp / ppTeam) : null,
      p60: u?.p60 ?? null, sat: u?.sat ?? null, satRel: u?.satRel ?? null, zs: u?.zs ?? null, onPdo: u?.pdo ?? null, sh, careerSh, luck, luckNote,
      hits: u?.hits ?? null, blocks: u?.blocks ?? null, take: u?.take ?? null, give: u?.give ?? null,
    };
  });
  // the round numbers each player can reach this season at his pace
  const milestones: Milestone[] = [];
  for (const p of d.skaters) {
    const c = use.get(p.id)?.career;
    if (!c || !p.gp) continue;
    const step = (n: number, big: number, small: number) => (n >= big ? small * 2 : small);
    for (const [what, now, rate, steps] of [
      ['goals', c.g, p.g / p.gp, 50], ['assists', c.a, p.a / p.gp, step(c.a, 300, 50)],
      ['points', c.pts, p.pts / p.gp, 100], ['games', c.gp, 1, 100],
    ] as [string, number, number, number][]) {
      if (now < (what === 'games' ? 400 : 50)) continue;
      const at = Math.floor(now / steps) * steps + steps;
      const need = at - now;
      const games = rate > 0 ? Math.ceil(need / rate) : null;
      if (games != null && games <= left) milestones.push({ id: p.id, name: p.name, what, at, now, need, games, headshot: p.headshot });
    }
  }
  milestones.sort((a, b) => (a.games ?? 99) - (b.games ?? 99));
  const top = (k: 'evToi' | 'ppToi' | 'shToi') => rows.filter((r) => r[k] != null).sort((a, b) => (b[k] ?? 0) - (a[k] ?? 0))[0] ?? null;
  return { rows, milestones: milestones.slice(0, 12), usageLeaders: { ev: top('evToi'), pp: top('ppToi'), sh: top('shToi') } };
}

// ── the crease
export interface CreaseRead { id: number; name: string; headshot: string | null; gp: number; gs: number; svp: number; gsaa: number | null; qsPct: number | null; evSvp: number | null; ppSvp: number | null; career: { svp: number | null; w: number; so: number; gp: number } | null; read: string }
// Goals saved above average: the goals an average goalie would have allowed on the same shots, less the goals he allowed.
// A quality start (the league's own measure) is a start at or above the league's save percentage, or 88.5% on a light night.
export function crease(d: FanData): CreaseRead[] {
  const lgSa = d.league.reduce((t, x) => t + x.sa * x.gp, 0), lgGa = d.league.reduce((t, x) => t + x.ga * x.gp, 0);
  const lgSvp = lgSa ? 1 - lgGa / lgSa : 0.9;
  const extra = new Map((d.crease ?? []).map((c) => [c.id, c]));
  return d.goalies.filter((g) => g.gp > 0).sort((a, b) => b.gs - a.gs).map((g) => {
    const c = extra.get(g.id);
    const sa = c?.sa ?? g.sa ?? null, ga = c?.ga ?? (sa != null ? Math.round(sa * (1 - g.svp)) : null);
    const gsaa = sa != null && ga != null ? sa * (1 - lgSvp) - ga : null;
    const read = gsaa == null ? '' : `${gsaa >= 0 ? `${gsaa.toFixed(1)} goals saved` : `${(-gsaa).toFixed(1)} goals allowed`} beyond what an average goalie would have on his ${sa} shots${c?.qsPct != null ? `; quality starts in ${pct0(c.qsPct)} of his games (about 53% is average)` : ''}.`;
    return { id: g.id, name: g.name, headshot: g.headshot, gp: g.gp, gs: g.gs, svp: g.svp, gsaa, qsPct: c?.qsPct ?? null, evSvp: c?.evSvp ?? null, ppSvp: c?.ppSvp ?? null, career: c?.career ?? null, read };
  });
}

// ── the tracking read
export interface TrackLine { label: string; value: string; rank: number | null; note: string; tone: 'good' | 'bad' | 'plain' }
export function trackingRead(d: FanData): TrackLine[] {
  const t = d.tracking;
  if (!t) return [];
  const tone = (rank: number | null, low = false): TrackLine['tone'] => (rank == null ? 'plain' : (low ? rank > 21 : rank <= 11) ? 'good' : (low ? rank <= 11 : rank > 21) ? 'bad' : 'plain');
  const out: TrackLine[] = [];
  if (t.bursts20?.value != null) out.push({ label: 'Speed bursts over 20 mph', value: String(t.bursts20.value), rank: t.bursts20.rank, tone: tone(t.bursts20.rank), note: `${t.bursts22?.value ?? '–'} over 22 mph (${t.bursts22?.rank ? rankWord(t.bursts22.rank) : '–'}). League average ${t.bursts20.avg ?? '–'}.` });
  if (t.speedMax?.value != null) out.push({ label: 'Top skating speed', value: `${t.speedMax.value.toFixed(1)} mph`, rank: t.speedMax.rank, tone: tone(t.speedMax.rank), note: t.fastest ? `${t.fastest}. League average ${t.speedMax.avg?.toFixed(1)} mph.` : '' });
  if (t.shotMax?.value != null) out.push({ label: 'Hardest shot', value: `${t.shotMax.value.toFixed(1)} mph`, rank: t.shotMax.rank, tone: tone(t.shotMax.rank), note: `${t.hardest ? `${t.hardest}. ` : ''}${t.shots90?.value ?? 0} attempts over 90 mph (${t.shots90?.rank ? rankWord(t.shots90.rank) : '–'}).` });
  if (t.distance?.value != null) out.push({ label: 'Distance skated', value: `${t.distance.value.toFixed(0)} mi`, rank: t.distance.rank, tone: 'plain', note: `League average ${t.distance.avg?.toFixed(0)} miles. More isn’t always better: chasing the puck is skating too.` });
  if (t.zones) {
    if (t.zones.oz != null) out.push({ label: 'Time in the attacking zone', value: pct1(t.zones.oz), rank: t.zones.ozRank, tone: tone(t.zones.ozRank), note: `League average ${t.zones.ozAvg != null ? pct1(t.zones.ozAvg) : '–'}; at even strength ${t.zones.ozEv != null ? pct1(t.zones.ozEv) : '–'} (${t.zones.ozEvRank ? rankWord(t.zones.ozEvRank) : '–'}).` });
    if (t.zones.dz != null) out.push({ label: 'Time in their own zone', value: pct1(t.zones.dz), rank: t.zones.dzRank, tone: tone(t.zones.dzRank, true), note: `League average ${t.zones.dzAvg != null ? pct1(t.zones.dzAvg) : '–'}. Lower is better.` });
  }
  const R = (w: string) => t.ranges.find((r) => r.where === w);
  const hi = R('high'), all = R('all');
  if (hi?.shots != null && all?.shots) out.push({ label: 'Shots from the slot and crease', value: `${hi.shots} (${pct0(hi.shots / all.shots)})`, rank: hi.shotsRank, tone: tone(hi.shotsRank), note: `The high-danger area. They score on ${hi.pct != null ? pct1(hi.pct) : '–'} there (${hi.pctRank ? rankWord(hi.pctRank) : '–'}; league ${hi.pctAvg != null ? pct1(hi.pctAvg) : '–'}).` });
  const mid = R('mid'), long = R('long');
  if (mid?.shots != null) out.push({ label: 'Mid-range shots', value: String(mid.shots), rank: mid.shotsRank, tone: 'plain', note: `Scoring on ${mid.pct != null ? pct1(mid.pct) : '–'} (${mid.pctRank ? rankWord(mid.pctRank) : '–'}).` });
  if (long?.shots != null) out.push({ label: 'Long shots', value: String(long.shots), rank: long.shotsRank, tone: 'plain', note: `From the point and beyond; scoring on ${long.pct != null ? pct1(long.pct) : '–'}.` });
  return out;
}

// ── against last season's champion
export interface ChampLine { label: string; us: number; them: number; fmt: (v: number) => string; better: boolean }
export function champion(d: FanData): { abbrev: string; lines: ChampLine[]; matched: number } | null {
  const c = d.champion, them = c ? d.leaguePrev.find((t) => t.abbrev === c) : null, us = d.league.find((t) => t.abbrev === d.abbrev);
  if (!c || !them || !us) return null;
  const keys = ['ptsPct', 'gd', 'gf', 'ga', 'sat', 'sf', 'sa', 'pp', 'pk', 'sv5', 'fo'] as const;
  const lines = keys.map((k) => METRICS.find((m) => m.key === k)!).map((m) => {
    const a = metricValue(us, m), b = metricValue(them, m);
    return a == null || b == null ? null : { label: m.label, us: a, them: b, fmt: m.fmt, better: m.low ? a <= b : a >= b };
  }).filter((x): x is ChampLine => !!x);
  return { abbrev: c, lines, matched: lines.filter((l) => l.better).length };
}

// ── the division at a glance
export function division(d: FanData): (FanTableRow & { team: FanTeam | null })[] {
  const me = (d.table ?? []).find((t) => t.abbrev === d.abbrev);
  if (!me) return [];
  return (d.table ?? []).filter((t) => t.div === me.div).sort((a, b) => b.pts - a.pts || b.ptsPct - a.ptsPct).map((t) => ({ ...t, team: d.league.find((x) => x.abbrev === t.abbrev) ?? null }));
}

// ── the recommendations the deeper reads add
export function deepRecs(d: FanData, o: { out: Outlook | null; tr: Truth | null; pl: ReturnType<typeof players>; cr: CreaseRead[]; ah: Ahead | null; sp: Splits }): Recommendation[] {
  const recs: Recommendation[] = [];
  const t = d.league.find((x) => x.abbrev === d.abbrev);
  if (!t) return recs;
  const gp = t.gp;
  const sample = gp < 20 ? ` Only ${gp} games in, so treat it as a lean, not a verdict.` : '';
  const rankOf = (k: string) => { const m = METRICS.find((x) => x.key === k)!; const vals = d.league.map((x) => metricValue(x, m)).filter((v): v is number => v != null); const v = metricValue(t, m); if (v == null || vals.length < 16) return null; return { v, rank: 1 + vals.filter((x) => (m.low ? x < v : x > v)).length, of: vals.length, fmt: m.fmt }; };
  const bottom = (r: { rank: number; of: number } | null) => !!r && r.rank > r.of - Math.round(r.of / 3);
  const topR = (r: { rank: number; of: number } | null) => !!r && r.rank <= Math.round(r.of / 3);
  const p1 = rankOf('p1'), p3 = rankOf('p3'), hold = rankOf('lead2Hold'), pen = rankOf('penDiff'), opp = rankOf('ppOpp'), foD = rankOf('foD'), comeback = rankOf('comeback');
  if (p1 && bottom(p1)) recs.push({ area: 'Starts', priority: 'medium', title: 'Win the first period', why: `They are ${p1.fmt(p1.v)} a game in first periods (${rankWord(p1.rank)}): ${t.p1gf} scored, ${t.p1ga} allowed. Chasing from the first intermission costs them: sharper starts, simpler first shifts, the top line out early.${sample}` });
  if (p3 && bottom(p3)) recs.push({ area: 'Finishing', priority: 'medium', title: 'Close out third periods', why: `In third periods they are ${p3.fmt(p3.v)} a game (${rankWord(p3.rank)}). Conditioning, shortening the bench to the players who are going, and fewer risky plays at the blue lines.${sample}` });
  if (hold && bottom(hold) && (t.lead2?.[0] ?? 0) + (t.lead2?.[1] ?? 0) + (t.lead2?.[2] ?? 0) >= 3) recs.push({ area: 'Game management', priority: 'high', title: 'Hold the lead after two', why: `They have won ${hold.fmt(hold.v)} of the games they led after 40 minutes (${rankWord(hold.rank)}); most clubs win nine in ten. Points thrown away in the third are the cheapest to get back.` });
  if (comeback && topR(comeback) && (t.trail2?.[0] ?? 0) + (t.trail2?.[1] ?? 0) + (t.trail2?.[2] ?? 0) >= 4) recs.push({ area: 'Character', priority: 'watch', title: 'The comeback habit is real, but costly', why: `They have won ${comeback.fmt(comeback.v)} of games they trailed after two (${rankWord(comeback.rank)}). It speaks to the skill up front; it also means too many nights start from behind.` });
  if (pen && bottom(pen)) recs.push({ area: 'Discipline', priority: 'medium', title: 'Stay out of the box', why: `They take ${t.taken60?.toFixed(2)} penalties an hour and draw ${t.drawn60?.toFixed(2)} (${rankWord(pen.rank)} on the difference). Every extra kill is two minutes of the best players on the bench.` });
  if (opp && topR(opp) && (rankOf('pp')?.rank ?? 32) <= 10) recs.push({ area: 'Power play', priority: 'watch', title: 'Keep drawing penalties', why: `${opp.fmt(opp.v)} power plays a game (${rankWord(opp.rank)}) for a power play that scores. Speed through the neutral zone and net-front work are winning them chances: keep the puck carriers attacking.` });
  if (foD && bottom(foD)) recs.push({ area: 'Faceoffs', priority: 'watch', title: 'Win the draws in your own end', why: `They win ${foD.fmt(foD.v)} of defensive-zone draws (${rankWord(foD.rank)}). A lost draw there starts the other team's shift with the puck: send out the best centre on it, or a second centre to take the faceoff if the first is tossed.` });
  if (o.tr && o.tr.luckWins >= 1.5) recs.push({ area: 'The record', priority: 'watch', title: 'The record is ahead of the goals', why: o.tr.read });
  if (o.tr && o.tr.luckWins <= -1.5) recs.push({ area: 'The record', priority: 'watch', title: 'The goals say better days are coming', why: o.tr.read });
  if (o.tr?.adj && o.tr.adj.adjGd < 0 && o.tr.adj.actualGd > 0) recs.push({ area: '5-on-5 play', priority: 'high', title: 'The 5-on-5 edge is bounces', why: `They are +${o.tr.adj.actualGd} at 5-on-5, but at league-average shooting and goaltending they'd be ${o.tr.adj.adjGd.toFixed(1)}. The even-strength play has to improve before the bounces stop.` });
  const tr = d.tracking;
  const hi = tr?.ranges.find((r) => r.where === 'high');
  if (hi?.shotsRank != null && hi.shotsRank > 21) recs.push({ area: 'Shot quality', priority: 'medium', title: 'Get to the slot', why: `${hi.shots} shots from the slot and crease (${rankWord(hi.shotsRank)} in the league, by the NHL's tracking). The goals live there: a net-front presence on every power play, and cut to the middle off the rush.` });
  if (tr?.zones?.dzRank != null && tr.zones.dzRank <= 6) recs.push({ area: 'Breakouts', priority: 'medium', title: 'Spend less time defending', why: `They spend ${pct1(tr.zones.dz ?? 0)} of the game in their own zone (${rankWord(33 - tr.zones.dzRank)} least of the 32). Cleaner exits: the first pass to the middle, wingers low and available, a defenceman who can skate it out.` });
  if (tr?.bursts20?.rank != null && tr.bursts20.rank <= 5) recs.push({ area: 'Identity', priority: 'watch', title: 'Play to the speed', why: `By the NHL's tracking they are ${rankWord(tr.bursts20.rank)} in bursts over 20 mph${tr.speedMax?.rank ? ` and ${rankWord(tr.speedMax.rank)} in top speed` : ''}. Stretch the ice, attack in transition and make opponents turn and skate.` });
  const starter = o.cr[0];
  if (starter?.gsaa != null && starter.gsaa <= -3 && starter.gs >= 5) recs.push({ area: 'Goaltending', priority: 'high', title: `${starter.name.split(' ').slice(-1)[0]} is costing goals`, why: `${starter.name} has allowed ${(-starter.gsaa).toFixed(1)} more goals than an average goalie would on his shots${starter.qsPct != null ? `, with quality starts in ${pct0(starter.qsPct)} of his games` : ''}. Ride whoever is stopping the puck, and look at the market if it lasts.` });
  const backup = o.cr[1];
  if (starter && backup && backup.gsaa != null && starter.gsaa != null && backup.gs >= 3 && backup.gsaa - starter.gsaa >= 3) recs.push({ area: 'Goaltending', priority: 'medium', title: `More starts for ${backup.name.split(' ').slice(-1)[0]}`, why: `${backup.name} is ${backup.gsaa >= 0 ? '+' : ''}${backup.gsaa.toFixed(1)} goals against an average goalie in ${backup.gs} starts; ${starter.name} is ${starter.gsaa >= 0 ? '+' : ''}${starter.gsaa.toFixed(1)} in ${starter.gs}.` });
  const hot = o.pl.rows.filter((p) => p.luck === 'hot' && p.careerSh != null).sort((a, b) => b.pts - a.pts)[0];
  if (hot) recs.push({ area: 'Regression watch', priority: 'watch', title: `Don't bank on ${hot.name}'s finishing`, why: `${hot.luckNote} Expect the goal rate to drift back toward his usual finish, and the scoring to need more than one line.` });
  const cold = o.pl.rows.filter((p) => p.luck === 'cold' && p.careerSh != null).sort((a, b) => b.toi - a.toi)[0];
  if (cold) recs.push({ area: 'Patience', priority: 'watch', title: `Be patient with ${cold.name}`, why: `${cold.luckNote} The process is there; the goals usually follow.` });
  const b2b = o.sp.schedule.find((s) => s.label.startsWith('Second night'));
  if (b2b && b2b.gp >= 3 && b2b.pct < 0.4) recs.push({ area: 'Rest', priority: 'medium', title: 'Plan the back-to-backs', why: `They are ${b2b.w}-${b2b.l}-${b2b.otl} on the second night of back-to-backs.${o.ah?.b2b ? ` ${o.ah.b2b} more are on the schedule.` : ''} The backup in goal and a lighter morning on those days.` });
  if (o.out && o.out.playoffs < 0.5 && o.out.needPace != null && o.out.left > 10) recs.push({ area: 'The race', priority: 'high', title: 'The pace has to change', why: `The simulations put the playoff line near ${o.out.line} points: ${o.out.need} more from ${o.out.left} games, a ${o.out.needPace.toFixed(3).replace(/^0/, '')} points pace against their ${(t.ptsPct).toFixed(3).replace(/^0/, '')} so far. That is a ${pct0(o.out.playoffs)} chance as things stand.` });
  if (o.ah && o.ah.oppPct != null && o.ah.next10Pct != null && o.ah.next10Pct - o.ah.leaguePct >= 0.04) recs.push({ area: 'The schedule', priority: 'watch', title: 'A hard stretch is coming', why: `The next ten opponents take ${pct1(o.ah.next10Pct)} of their points on average, against ${pct1(o.ah.leaguePct)} for the league.${o.ah.trip ? ` The longest road trip left is ${o.ah.trip.games} games.` : ''}` });
  return recs;
}

// ── history reads (fan-history)
export interface HistSeason { season: number; gp: number; w: number; l: number; t: number; otl: number; pts: number; gf: number; ga: number; div: string; divRank: number; confRank: number; leagueRank: number; team: string; po?: { round: number; of: number; title: string; won: boolean } }
export interface HistSkater { id: number; name: string; pos: string; gp: number; g: number; a: number; pts: number; season: number | null }
export interface HistGoalie { id: number; name: string; gp: number; w: number; so: number; svp: number | null; gaa: number | null; season: number | null }
export interface HistVs { opp: string | null; name: string; franchise?: number; gp: number; w: number; l: number; t: number; otl: number; gf: number; ga: number; last: number }
export interface HistPick { id: number | null; name: string; year: number; round: number; overall: number; pos: string; from: string; league: string; career: { gp: number; pts?: number; g?: number; w?: number; goalie?: boolean } | null }
export interface HistTotals { gp: number; w: number; l: number; t: number; otl: number; pts: number; gf: number; ga: number; ptsPct: number | null; cups: number | null; playoffSeasons: number | null; seriesW: number | null; seriesL: number | null; so: number | null; first: number }
export interface FanHistory {
  abbrev: string; franchise: number; first: number | null; seasons: HistSeason[]; totals: { regular: HistTotals | null; playoffs: HistTotals | null };
  captains: string[]; coaches: string[]; gms: string[]; retired: string[]; vs: HistVs[]; vsPlayoffs: HistVs[];
  leaders: Record<'points' | 'goals' | 'assists' | 'games' | 'poPoints' | 'poGoals', HistSkater[]> & Record<'wins' | 'shutouts' | 'poWins', HistGoalie[]>;
  best: Record<'points' | 'goals' | 'assists', HistSkater[]> & Record<'wins' | 'svp', HistGoalie[]>;
  firsts: HistPick[]; steals: HistPick[]; awards: { season: number; trophy: string; trophyId: number; name: string; id: number | null; status: string }[]; at: string; stale?: boolean;
}
export const seasonName = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6, 8)}`;
const ROUND_WORD: Record<number, string> = { 1: 'first round', 2: 'second round', 3: 'conference final', 4: 'Final' };
// a season still being played: the last one, short of a full schedule and with no spring yet
export const inProgress = (s: HistSeason, all: HistSeason[]) => !s.po && s === all[all.length - 1] && s.gp < 70;
export const springOf = (s: HistSeason, all?: HistSeason[]) => (all && inProgress(s, all) ? 'Season in progress' : !s.po ? 'Missed the playoffs' : s.po.won && s.po.round >= (s.po.of || 4) ? 'Won the Stanley Cup' : `Lost in the ${ROUND_WORD[s.po.round] ?? s.po.title}`);
export interface Era { from: number; to: number; name: string; seasons: number; ptsPct: number; cups: number; finals: number; playoffs: number; best: HistSeason }
// the franchise's story in eras, cut where its fortunes turned: each era its record, its springs and its best season
const ERA_CUTS: Record<string, [number, string][]> = {
  EDM: [[1979, 'Arrival'], [1983, 'The dynasty'], [1990, 'After the dynasty'], [1996, 'The scrappy years'], [2005, 'The 2006 run'], [2006, 'The decade of darkness'], [2015, 'The McDavid era']],
};
export function eras(h: FanHistory): Era[] {
  const cuts = ERA_CUTS[h.abbrev] ?? (() => { const y0 = Math.floor(Number(String(h.seasons[0]?.season ?? 1990).slice(0, 4)) / 10) * 10; const out: [number, string][] = []; for (let y = y0; y <= 2030; y += 10) out.push([y, `The ${y}s`]); return out; })();
  const year = (s: HistSeason) => Number(String(s.season).slice(0, 4));
  return cuts.map(([from, name], i) => {
    const to = (cuts[i + 1]?.[0] ?? 9999) - 1;
    const ss = h.seasons.filter((s) => year(s) >= from && year(s) <= to && !inProgress(s, h.seasons));
    if (!ss.length) return null;
    const pts = ss.reduce((a, s) => a + s.pts, 0), gp = ss.reduce((a, s) => a + s.gp, 0);
    return { from: year(ss[0]), to: year(ss[ss.length - 1]) + 1, name, seasons: ss.length, ptsPct: gp ? pts / (2 * gp) : 0,
      cups: ss.filter((s) => s.po?.won && s.po.round >= 4).length, finals: ss.filter((s) => s.po && s.po.round >= 4).length, playoffs: ss.filter((s) => s.po).length,
      best: [...ss].sort((a, b) => b.pts / (2 * b.gp) - a.pts / (2 * a.gp))[0] };
  }).filter((e): e is Era => !!e);
}
// the numbers a fan quotes: computed from the record books, so they stay true
export function historyFacts(h: FanHistory): string[] {
  const out: string[] = [];
  const S = h.seasons.filter((s) => !inProgress(s, h.seasons));
  if (!S.length) return out;
  const best = [...S].sort((a, b) => b.pts - a.pts)[0], most = [...S].sort((a, b) => b.gf - a.gf)[0], fewestGa = [...S].filter((s) => s.gp >= 70).sort((a, b) => a.ga / a.gp - b.ga / b.gp)[0];
  const worst = [...S].filter((s) => s.gp >= 70).sort((a, b) => a.pts / a.gp - b.pts / b.gp)[0];
  out.push(`Best regular season by points: ${best.pts} in ${seasonName(best.season)} (${best.w}-${best.l}-${best.t || best.otl}).`);
  out.push(`Most goals in a season: ${most.gf} in ${seasonName(most.season)}, ${(most.gf / most.gp).toFixed(2)} a game.`);
  if (fewestGa) out.push(`Stingiest season: ${(fewestGa.ga / fewestGa.gp).toFixed(2)} goals against a game in ${seasonName(fewestGa.season)}.`);
  if (worst) out.push(`The low point: ${worst.pts} points in ${seasonName(worst.season)}.`);
  const firstPlace = S.filter((s) => s.leagueRank === 1).map((s) => seasonName(s.season));
  if (firstPlace.length) out.push(`Finished first in the whole league ${firstPlace.length} time${firstPlace.length === 1 ? '' : 's'}: ${firstPlace.join(', ')}.`);
  const divTitles = S.filter((s) => s.divRank === 1).length;
  if (divTitles) out.push(`${divTitles} division title${divTitles === 1 ? '' : 's'} in ${S.length} seasons.`);
  // the longest playoff run and drought
  let streak = 0, bestStreak = 0, bestEnd = 0, drought = 0, worstDrought = 0, droughtEnd = 0;
  for (const s of S) {
    if (s.po) { streak++; drought = 0; if (streak > bestStreak) { bestStreak = streak; bestEnd = s.season; } }
    else { drought++; streak = 0; if (drought > worstDrought) { worstDrought = drought; droughtEnd = s.season; } }
  }
  if (bestStreak >= 3) out.push(`The longest run of playoff springs: ${bestStreak} straight, ending ${seasonName(bestEnd)}.`);
  if (worstDrought >= 3) out.push(`The longest drought: ${worstDrought} seasons without the playoffs, through ${seasonName(droughtEnd)}.`);
  const finals = S.filter((s) => s.po && s.po.round >= 4);
  if (finals.length) out.push(`${finals.length} trips to the Stanley Cup Final: ${finals.map((s) => `${String(s.season).slice(4)}${s.po!.won ? ' 🏆' : ''}`).join(', ')}.`);
  const tr = h.totals.regular, po = h.totals.playoffs;
  if (tr) out.push(`All-time in the regular season: ${tr.w.toLocaleString()} wins, ${tr.l.toLocaleString()} losses${tr.t ? `, ${tr.t} ties` : ''}${tr.otl ? `, ${tr.otl} overtime losses` : ''} and ${tr.gf.toLocaleString()} goals in ${tr.gp.toLocaleString()} games.`);
  if (po?.seriesW != null) out.push(`In the playoffs: ${po.w}-${po.l} in games and ${po.seriesW}-${po.seriesL} in series, a ${Math.round((po.seriesW / ((po.seriesW + (po.seriesL ?? 0)) || 1)) * 100)}% series win rate.`);
  const vs = [...h.vs].filter((v) => v.gp >= 40);
  const fav = vs.sort((a, b) => (b.w - b.l) / b.gp - (a.w - a.l) / a.gp)[0], nem = vs.sort((a, b) => (a.w - a.l) / a.gp - (b.w - b.l) / b.gp)[0];
  const wlt = (v: HistVs) => `${v.w}-${v.l}${v.t + v.otl ? `-${v.t + v.otl}` : ''}`;
  if (fav) out.push(`Favourite opponent: the ${fav.name}, ${wlt(fav)} all-time.`);
  if (nem && nem !== fav) out.push(`Toughest opponent: the ${nem.name}, ${wlt(nem)} all-time.`);
  const most1 = [...h.vs].sort((a, b) => b.gp - a.gp)[0];
  if (most1) out.push(`Most-played opponent: the ${most1.name}, ${most1.gp} regular-season games.`);
  const top = h.leaders.points?.[0];
  if (top) out.push(`${top.name} leads the franchise with ${top.pts} points in ${top.gp} games, ${(top.pts / top.gp).toFixed(2)} a game.`);
  const g1 = h.firsts.filter((p) => p.overall === 1);
  if (g1.length) out.push(`First overall picks: ${g1.sort((a, b) => a.year - b.year).map((p) => `${p.name} (${p.year})`).join(', ')}.`);
  const steal = h.steals[0];
  if (steal?.career) out.push(`The best pick after the first round: ${steal.name}, ${ordinal(steal.overall)} overall in ${steal.year}, ${steal.career.goalie ? `${steal.career.w} career wins` : `${steal.career.pts} career points`}.`);
  const oneTwo = [...new Set(h.awards.filter((a) => a.trophyId === 16 && a.status === 'WINNER').map((a) => a.season))].filter((s) => h.awards.some((a) => a.trophyId === 16 && a.season === s && a.status !== 'WINNER' && /RUNNER/.test(a.status)));
  if (oneTwo.length) out.push(`Teammates finished first and second in the scoring race ${oneTwo.length} time${oneTwo.length === 1 ? '' : 's'}: ${oneTwo.sort().map((s) => seasonName(s)).join(', ')}.`);
  const harts = h.awards.filter((a) => a.trophyId === 8 && a.status === 'WINNER').length;
  if (harts) out.push(`${harts} Hart Trophies as the league's most valuable player.`);
  const ross = h.awards.filter((a) => a.trophyId === 16 && a.status === 'WINNER').length;
  if (ross) out.push(`${ross} Art Ross Trophies as the league's top scorer.`);
  return out;
}
const ordinal = (n: number) => rankWord(n);
// the clubs met most in the playoffs, with the regular-season record beside it
export function rivals(h: FanHistory) {
  return h.vsPlayoffs.filter((v) => v.gp >= 5).map((v) => ({ ...v, reg: h.vs.find((x) => x.name === v.name) ?? null })).sort((a, b) => b.gp - a.gp).slice(0, 8);
}
// trophies grouped: each trophy its winners, newest first
export function trophyCase(h: FanHistory) {
  const by = new Map<string, { trophy: string; trophyId: number; wins: { season: number; name: string; id: number | null }[]; nominations: number }>();
  for (const a of h.awards) {
    const e = by.get(a.trophy) ?? { trophy: a.trophy, trophyId: a.trophyId, wins: [], nominations: 0 };
    if (a.status === 'WINNER') e.wins.push({ season: a.season, name: a.name, id: a.id }); else e.nominations++;
    by.set(a.trophy, e);
  }
  // the league's own: the player awards first, the club's (conference titles, the Presidents' Trophy) after
  const team = new Set([5, 14, 19]);
  return [...by.values()].filter((e) => e.wins.length).sort((a, b) => Number(team.has(a.trophyId)) - Number(team.has(b.trophyId)) || b.wins.length - a.wins.length);
}
// a first-round pick's verdict, by what his career became
export function pickVerdict(p: HistPick, year: number): 'star' | 'regular' | 'some' | 'bust' | 'pending' {
  const since = year - p.year;
  if (since < 4) return 'pending';
  const c = p.career;
  if (!c) return since < 7 ? 'pending' : 'bust';
  if (c.goalie) return c.gp >= 400 ? 'star' : c.gp >= 150 ? 'regular' : c.gp >= 30 ? 'some' : since < 7 ? 'pending' : 'bust';
  // a young player already holding a job counts as a regular; one still in the minors isn't a miss yet
  return (c.pts ?? 0) >= 500 || c.gp >= 900 ? 'star' : c.gp >= 300 || (since < 8 && c.gp >= 150) ? 'regular' : c.gp >= 50 ? 'some' : since < 6 ? 'pending' : 'bust';
}
