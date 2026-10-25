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
import { METRICS, metricValue, rankWord, type ClubMoves, type FanData, type FanGame, type FanTableRow, type FanTeam, type GLine, type Injury, type MoveGoalie, type Recommendation, type SkLine, type WLO } from './fanZone.ts';

const SEASON_GAMES = 82;
const OT_SHARE = 0.23;   // about a game in four goes past regulation: each club takes an overtime loss in roughly one in nine
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const svp = (v: number) => v.toFixed(3).replace(/^0/, '');
const played = (g: FanGame) => g.state === 'OFF' || g.state === 'FINAL';

// a steady random stream, so the same numbers always simulate to the same odds
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
export function normal(r: () => number) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

// ── the outlook
export interface Outlook {
  sims: number; playoffs: number; division: number; top3: number; conference: number; presidents: number;
  projected: { low: number; mid: number; high: number }; pace: number; line: number; need: number | null; needPace: number | null; left: number;
  odds: { abbrev: string; name: string; pts: number; gp: number; playoffs: number; projected: number; cup: number }[];   // the club's conference, best chance first
  all: Record<string, number>;   // every club's playoff chance: who is buying and who is selling
  // since 25 October 2026: where they land and what the spring holds
  seeds: { label: string; chance: number }[];                  // first in the division, second, third, the wild cards, out
  firstRound: { abbrev: string; name: string; chance: number }[];   // the most likely first-round opponents, share of every season
  rounds: { r1: number; r2: number; conf: number; final: number; cup: number };   // the chance of winning each round
  cups: Record<string, number>;   // every club's chance of the Cup
  moved: MovePrice | null;        // the roster's moves and injuries priced into this club's strength (null: no moves data)
}
// ── the moves priced (25 October 2026, Patrick: a trade or an injury has to move the outlook the day it happens, the
// Hellebuyck trade to New Jersey first). The record only knows the games already played; the games ahead belong to the
// roster as it stands. So each club's strength is adjusted, in goals a game, for the crease it will dress (every goalie's
// save percentage over this season and the last three, pulled toward the league's by 2,000 shots, weighted by the share
// of starts he will take: 65/35 between the two best, less whatever an injury costs him) against the crease that played
// its games so far, and for the skaters who arrived, left or are out: about a sixth of a point a game of involvement in
// a goal is a goal (a goal is worth about 2.7 points, and the next man up replaces half of what is missing). Six goals
// are a win, a win two points. Every club gets the same treatment, so the odds stay fair between them.
const GOALS_PER_WIN = 6;
const GOALS_PER_POINT = 0.185;   // 0.5 / 2.7: half of a missing point's share of a goal
const SHOTS_TO_TRUST = 2000;
export interface MoveItem { kind: 'arrival' | 'gone' | 'hurt' | 'goalie'; id: number; name: string; pos: string; headshot: string | null; text: string; goals: number; back: string | null }
export interface CreasePlan { before: { svp: number; who: { id: number; name: string; share: number }[] }; after: { svp: number; who: { id: number; name: string; share: number; talent: number; arrived: boolean }[] }; goals: number }
export interface MovePrice { abbrev: string; goals: number; pts: number; left: number; crease: CreasePlan | null; items: MoveItem[] }
const isG = (l: SkLine | GLine | null | undefined): l is GLine => !!l && 'sa' in l;
// the share of the games left a man misses: his return date, or the usual length of the list he is on
export function missShare(h: Injury | null, left: number, now: Date) {
  if (!h || left <= 0) return 0;
  let games: number;
  if (h.back) games = Math.max(0, (new Date(`${h.back}T12:00:00Z`).getTime() - now.getTime()) / 86_400_000) / 2;
  else games = /LT/.test(h.list ?? '') ? 15 : /NR/.test(h.list ?? '') ? 15 : /^IR/.test(h.list ?? '') ? 8 : /day/i.test(h.status) ? 2 : 4;
  return Math.min(1, games / left);
}
export function priceMoves(d: FanData, abbrev = d.abbrev, now = new Date()): MovePrice | null {
  const m: ClubMoves | undefined = d.moves?.clubs?.[abbrev];
  if (!m) return null;
  const lg = d.moves!.lgSvp;
  const row = d.league.find((t) => t.abbrev === abbrev);
  const saPerGame = row?.sa ?? 29;
  const left = Math.max(0, SEASON_GAMES - m.gp);
  const items: MoveItem[] = [];
  // ── the crease
  const talent = (g: MoveGoalie) => {
    const rows = [g.season, g.prior].filter((x): x is GLine => !!x && x.sa > 0 && x.svp != null);
    const sa = rows.reduce((t, x) => t + x.sa, 0), saves = rows.reduce((t, x) => t + x.sa * x.svp!, 0);
    return (saves + SHOTS_TO_TRUST * lg) / (sa + SHOTS_TO_TRUST);
  };
  const played = [...m.goalies.filter((g) => (g.us?.gs ?? 0) > 0).map((g) => ({ g, us: g.us! })), ...m.gone.filter((x) => x.pos === 'G' && isG(x.us) && x.us.gs > 0).map((x) => ({ g: { ...x, season: isG(x.season) ? x.season : null, us: x.us as GLine, teams: [], from: null, prior: null, hurt: null } as MoveGoalie, us: x.us as GLine }))];
  const starts = played.reduce((t, x) => t + x.us.gs, 0);
  let crease: CreasePlan | null = null;
  if (starts > 0 && m.goalies.length) {
    const before = played.map(({ g, us }) => ({ id: g.id, name: g.name, share: us.gs / starts, talent: talent(g) }));
    const beforeSvp = before.reduce((t, x) => t + x.share * x.talent, 0);
    // the two best take 65 and 35: the better goalie first (a point of save percentage is worth ten starts a season)
    const score = (g: MoveGoalie) => talent(g) * 1000 + ((g.season?.gs ?? 0) + (g.prior?.gs ?? 0) / 3) / 10;
    const ranked = [...m.goalies].sort((a, b) => score(b) - score(a));
    const base = ranked.map((g, i) => (ranked.length === 1 ? 1 : i === 0 ? 0.65 : i === 1 ? 0.35 : 0) * (1 - missShare(g.hurt, left, now)));
    let total = base.reduce((t, x) => t + x, 0);
    // the starts an injury leaves open go to the next man on the roster, else to a replacement a touch below the league
    const spare = 1 - total;
    const third = ranked[2] && base[2] === 0 ? 2 : -1;
    if (spare > 0 && third >= 0) { base[third] += spare * (1 - missShare(ranked[third].hurt, left, now)); total = base.reduce((t, x) => t + x, 0); }
    const after = ranked.map((g, i) => ({ id: g.id, name: g.name, share: base[i], talent: talent(g), arrived: !(g.us?.gs ?? 0) })).filter((x) => x.share > 0.001);
    const afterSvp = after.reduce((t, x) => t + x.share * x.talent, 0) + Math.max(0, 1 - total) * (lg - 0.008);
    const goals = (afterSvp - beforeSvp) * saPerGame;
    crease = { before: { svp: beforeSvp, who: before.map(({ id, name, share }) => ({ id, name, share })) }, after: { svp: afterSvp, who: after }, goals };
    for (const g of m.goalies) {
      const arrived = !(g.us?.gs ?? 0) && (g.from || (g.season && g.season.gs > 0) || g.prior);
      const a = after.find((x) => x.id === g.id);
      if (arrived && g.from) {
        const body = g.prior && g.prior.sa ? `${pctStr(g.prior.svp ?? 0)} over his last three seasons on ${g.prior.sa.toLocaleString()} shots (the league ${pctStr(lg)})` : g.season && g.season.sa ? `${pctStr(g.season.svp ?? 0)} on ${g.season.sa} shots this season` : 'no NHL record to go on';
        items.push({ kind: 'goalie', id: g.id, name: g.name, pos: 'G', headshot: g.headshot, back: g.hurt?.back ?? null,
          text: `Arrives from ${g.from}: ${body}. The model gives him ${Math.round((a?.share ?? 0) * 100)}% of the starts from here${g.hurt ? `; ${g.hurt.status.toLowerCase()}${g.hurt.back ? ` until about ${fmtDay(g.hurt.back)}` : ''}` : ''}.`, goals: 0 });
      } else if (g.hurt && (g.us?.gs ?? 0) > 0) {
        const miss = missShare(g.hurt, left, now);
        items.push({ kind: 'hurt', id: g.id, name: g.name, pos: 'G', headshot: g.headshot, back: g.hurt.back, goals: 0,
          text: `${g.hurt.status}${g.hurt.part ? ` (${g.hurt.part.toLowerCase()})` : ''}${g.hurt.back ? `, back around ${fmtDay(g.hurt.back)}` : ''}: ${Math.round(miss * 100)}% of the games left without him in the crease.` });
      }
    }
    for (const x of m.gone.filter((x) => x.pos === 'G' && isG(x.us))) {
      const us = x.us as GLine;
      items.push({ kind: 'gone', id: x.id, name: x.name, pos: 'G', headshot: x.headshot, back: null, goals: 0, text: `${x.to ? `To ${x.to}` : 'Off the roster'}: ${us.gs} start${us.gs === 1 ? '' : 's'}${us.svp != null ? `, ${pctStr(us.svp)}` : ''} for the club this season.` });
    }
    // the crease's swing is one line, on the man who caused it
    const first = items.find((x) => x.kind === 'goalie') ?? items.find((x) => x.pos === 'G');
    if (first) first.goals = goals;
    else if (Math.abs(goals) >= 0.02) items.push({ kind: 'goalie', id: 0, name: 'The crease', pos: 'G', headshot: null, back: null, goals, text: `From ${pctStr(beforeSvp)} expected so far to ${pctStr(afterSvp)} with the goalies on the roster now.` });
  }
  // ── the skaters
  const ppg = (l: SkLine | GLine | null, prev: SkLine | GLine | null) => (l && !isG(l) && l.gp >= 3 ? l.pts / l.gp : prev && !isG(prev) && prev.gp >= 20 ? prev.pts / prev.gp : null);
  let attack = 0;
  for (const p of m.arrivals) {
    const rate = ppg(p.season, p.prev);
    if (rate == null) continue;
    // the games he has already played for the club are in the record; only the rest is new
    const fresh = m.gp ? Math.max(0, 1 - (p.us?.gp ?? 0) / m.gp) : 1;
    const miss = missShare(p.hurt, left, now);
    const goals = rate * GOALS_PER_POINT * fresh * (1 - miss);
    attack += goals;
    const line = p.season && !isG(p.season) ? `${p.season.pts} point${p.season.pts === 1 ? '' : 's'} in ${p.season.gp} game${p.season.gp === 1 ? '' : 's'} this season` : '';
    items.push({ kind: 'arrival', id: p.id, name: p.name, pos: p.pos, headshot: p.headshot, back: p.hurt?.back ?? null, goals, text: `Arrives from ${p.from}: ${line}${p.us?.gp ? `, ${p.us.gp} of them for the club` : ''}.${p.hurt ? ` ${p.hurt.status}${p.hurt.back ? `, back around ${fmtDay(p.hurt.back)}` : ''}.` : ''}` });
  }
  for (const x of m.gone.filter((x) => x.pos !== 'G')) {
    const us = x.us as SkLine | null;
    const rate = ppg(us, null);
    if (rate == null) continue;
    const goals = -rate * GOALS_PER_POINT;
    attack += goals;
    items.push({ kind: 'gone', id: x.id, name: x.name, pos: x.pos, headshot: x.headshot, back: null, goals, text: `${x.to ? `To ${x.to}` : 'Off the roster'}: ${us!.pts} point${us!.pts === 1 ? '' : 's'} in ${us!.gp} games for the club.` });
  }
  for (const h of m.hurt.filter((h) => h.pos !== 'G')) {
    const rate = ppg(h.season, h.prev);
    const miss = missShare(h, left, now);
    const goals = rate == null ? 0 : -rate * GOALS_PER_POINT * miss;
    attack += goals;
    const line = h.season && !isG(h.season) && h.season.gp >= 3 ? `${(h.season.pts / h.season.gp).toFixed(2)} points a game this season` : h.prev && !isG(h.prev) && h.prev.gp >= 20 ? `${(h.prev.pts / h.prev.gp).toFixed(2)} points a game last season` : 'no scoring line to price';
    items.push({ kind: 'hurt', id: h.id, name: h.name, pos: h.pos, headshot: h.headshot, back: h.back, goals, text: `${h.status}${h.part ? ` (${h.part.toLowerCase()})` : ''}${h.back ? `, back around ${fmtDay(h.back)}` : h.list ? `, ${h.list}` : ''}: ${line}; ${Math.round(miss * 100)}% of the games left.` });
  }
  const goals = (crease?.goals ?? 0) + attack;
  // the biggest swings first, the arrivals and the crease ahead of a day-to-day knock
  items.sort((a, b) => Math.abs(b.goals) - Math.abs(a.goals) || (a.kind === 'hurt' ? 1 : 0) - (b.kind === 'hurt' ? 1 : 0));
  return { abbrev, goals, pts: (goals * left * 2) / GOALS_PER_WIN, left, crease, items };
}
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const pctStr = (v: number) => v.toFixed(3).replace(/^0/, '');

// A club's true strength is its points percentage pulled toward the league's by 25 games of average hockey: ten games
// in, a hot start counts for less than half of the read. Each of the rest of the games is then a draw: a win, an overtime
// loss (one point) or a regulation loss. Top three in each division and the next two in the conference make it.
export function outlook(d: FanData, sims = 4000, o: { moves?: boolean; now?: Date } = {}): Outlook | null {
  const table = d.table ?? [];
  const me = table.find((t) => t.abbrev === d.abbrev);
  if (!me || table.length < 16) return null;
  // the roster as it stands, priced in goals a game for every club (a goal is a sixth of a win, a win two points)
  const priced = o.moves === false || !d.moves ? null : new Map(table.map((t) => [t.abbrev, priceMoves(d, t.abbrev, o.now ?? new Date())]));
  const lift = (abbrev: string) => (priced?.get(abbrev)?.goals ?? 0) / GOALS_PER_WIN;
  const totalGp = table.reduce((s, t) => s + t.gp, 0), totalPts = table.reduce((s, t) => s + t.pts, 0);
  const m = totalGp ? totalPts / (2 * totalGp) : 0.555;
  const K = 25;
  const teams = table.map((t) => {
    const p = Math.min(0.9, Math.max(0.1, (t.pts + 2 * K * m) / (2 * (t.gp + K)) + lift(t.abbrev)));
    const left = Math.max(0, SEASON_GAMES - t.gp);
    return { t, p, left, sd: Math.sqrt((p * (1 - p)) / (2 * (t.gp + K))) };
  });
  const r = rng(seedOf(`${d.abbrev}:${totalGp}:${totalPts}`));
  const conf = me.conf;
  const count = new Map<string, { po: number; pts: number; cup: number }>(table.map((t) => [t.abbrev, { po: 0, pts: 0, cup: 0 }]));
  let division = 0, top3 = 0, conference = 0, presidents = 0;
  const mine: number[] = [], lines: number[] = [];
  const seedCount = [0, 0, 0, 0, 0, 0];   // 1st, 2nd, 3rd in the division, wild card 1, wild card 2, out
  const opp = new Map<string, number>();
  const won = { r1: 0, r2: 0, conf: 0, final: 0, cup: 0 };
  // a best-of-seven between two clubs of true strengths qa and qb: each game by the log5 rule, four wins first
  const series = (qa: number, qb: number) => {
    const p = (qa * (1 - qb)) / (qa * (1 - qb) + qb * (1 - qa) || 1);
    let win = 0;
    for (let k = 0; k <= 3; k++) win += [1, 4, 10, 20][k] * p ** 4 * (1 - p) ** k;
    return r() < win;
  };
  type Fin = { t: FanTableRow; pts: number; tie: number; q: number };
  for (let s = 0; s < sims; s++) {
    const fin: Fin[] = teams.map(({ t, p, left, sd }) => {
      const q = Math.min(0.85, Math.max(0.15, p + normal(r) * sd));
      const o = OT_SHARE / 2, w = Math.max(0, q - o / 2);
      const mean = left * (2 * w + o), varg = Math.max(0.01, 4 * w + o - (2 * w + o) ** 2);
      const add = Math.round(Math.min(2 * left, Math.max(0, mean + normal(r) * Math.sqrt(left * varg))));
      return { t, pts: t.pts + add, tie: (t.rw ?? t.w) + r(), q };
    });
    const order = [...fin].sort((a, b) => b.pts - a.pts || b.tie - a.tie);
    if (order[0].t.abbrev === d.abbrev) presidents++;
    const champs: Fin[] = [];
    let mySeed = 5;
    for (const c of new Set(table.map((t) => t.conf))) {
      const inConf = order.filter((x) => x.t.conf === c);
      const inPo = new Set<string>();
      const byDiv = new Map<string, Fin[]>();
      for (const dv of new Set(inConf.map((x) => x.t.div))) {
        const top = inConf.filter((x) => x.t.div === dv).slice(0, 3);
        byDiv.set(dv, top);
        top.forEach((x) => inPo.add(x.t.abbrev));
      }
      const wild = inConf.filter((x) => !inPo.has(x.t.abbrev)).slice(0, 2);
      wild.forEach((x) => inPo.add(x.t.abbrev));
      for (const a of inPo) count.get(a)!.po++;
      if (c === conf) {
        lines.push(wild[1]?.pts ?? wild[0]?.pts ?? 0);
        if (inConf[0].t.abbrev === d.abbrev) conference++;
        const myDiv = byDiv.get(me.div) ?? [];
        const at = myDiv.findIndex((x) => x.t.abbrev === d.abbrev);
        if (at === 0) division++;
        if (at >= 0 && at < 3) top3++;
        mySeed = at >= 0 ? at : wild[0]?.t.abbrev === d.abbrev ? 3 : wild[1]?.t.abbrev === d.abbrev ? 4 : 5;
      }
      // the bracket: the better division winner meets the second wild card, the other the first; second plays third in
      // each division; the two sides meet in the conference final
      const divs = [...byDiv.values()].filter((x) => x.length === 3);
      if (divs.length === 2 && wild.length === 2) {
        const [w1, w2] = divs[0][0].pts > divs[1][0].pts || (divs[0][0].pts === divs[1][0].pts && divs[0][0].tie > divs[1][0].tie) ? [divs[0], divs[1]] : [divs[1], divs[0]];
        const pairs: [Fin, Fin][] = [[w1[0], wild[1]], [w1[1], w1[2]], [w2[0], wild[0]], [w2[1], w2[2]]];
        const mineIn = pairs.find(([a, b]) => a.t.abbrev === d.abbrev || b.t.abbrev === d.abbrev);
        if (mineIn) { const o = mineIn[0].t.abbrev === d.abbrev ? mineIn[1] : mineIn[0]; opp.set(o.t.abbrev, (opp.get(o.t.abbrev) ?? 0) + 1); }
        const play = (a: Fin, b: Fin) => (series(a.q, b.q) ? a : b);
        const r1 = pairs.map(([a, b]) => play(a, b));
        if (r1.some((x) => x.t.abbrev === d.abbrev)) won.r1++;
        const r2 = [play(r1[0], r1[1]), play(r1[2], r1[3])];
        if (r2.some((x) => x.t.abbrev === d.abbrev)) won.r2++;
        const cf = play(r2[0], r2[1]);
        if (cf.t.abbrev === d.abbrev) won.conf++;
        champs.push(cf);
      }
    }
    seedCount[mySeed]++;
    if (champs.length === 2) {
      const cup = series(champs[0].q, champs[1].q) ? champs[0] : champs[1];
      count.get(cup.t.abbrev)!.cup++;
      if (cup.t.abbrev === d.abbrev) won.cup++;
      if (champs.some((x) => x.t.abbrev === d.abbrev)) won.final++;
    }
    for (const x of fin) count.get(x.t.abbrev)!.pts += x.pts;
    mine.push(fin.find((x) => x.t.abbrev === d.abbrev)!.pts);
  }
  mine.sort((a, b) => a - b); lines.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const line = q(lines, 0.5), left = Math.max(0, SEASON_GAMES - me.gp);
  const need = Math.max(0, line - me.pts);
  const names = new Map(table.map((t) => [t.abbrev, t.name]));
  return {
    sims, playoffs: count.get(d.abbrev)!.po / sims, division: division / sims, top3: top3 / sims, conference: conference / sims, presidents: presidents / sims,
    projected: { low: q(mine, 0.1), mid: q(mine, 0.5), high: q(mine, 0.9) }, pace: me.gp ? (me.pts / me.gp) * SEASON_GAMES : 0, line, left,
    need: left ? need : null, needPace: left ? need / (2 * left) : null,
    odds: table.filter((t) => t.conf === conf).map((t) => ({ abbrev: t.abbrev, name: t.name, pts: t.pts, gp: t.gp, playoffs: count.get(t.abbrev)!.po / sims, projected: Math.round(count.get(t.abbrev)!.pts / sims), cup: count.get(t.abbrev)!.cup / sims }))
      .sort((a, b) => b.playoffs - a.playoffs || b.pts - a.pts),
    all: Object.fromEntries(table.map((t) => [t.abbrev, count.get(t.abbrev)!.po / sims])),
    seeds: ['1st in the division', '2nd in the division', '3rd in the division', 'First wild card', 'Second wild card', 'Out'].map((label, i) => ({ label, chance: seedCount[i] / sims })),
    firstRound: [...opp.entries()].map(([abbrev, n]) => ({ abbrev, name: names.get(abbrev) ?? abbrev, chance: n / sims })).sort((a, b) => b.chance - a.chance).slice(0, 6),
    rounds: { r1: won.r1 / sims, r2: won.r2 / sims, conf: won.conf / sims, final: won.final / sims, cup: won.cup / sims },
    cups: Object.fromEntries(table.map((t) => [t.abbrev, count.get(t.abbrev)!.cup / sims])),
    moved: priced?.get(d.abbrev) ?? null,
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
