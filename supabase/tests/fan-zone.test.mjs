// The fan zone's analysis (src/lib/fanZone.ts) on the real Oilers numbers saved from nhl-hub's `fan` task: ranks among
// the 32, strengths and weaknesses at the ends, a grade, the luck read, the development verdicts and recommendations
// that quote their evidence.
import assert from 'node:assert/strict';
import { assess, rankIn, METRICS } from '../../src/lib/fanZone.ts';
import { outlook, truth, splits, form, ahead, players, crease, champion, deepRecs, eras, historyFacts, pickVerdict, springOf, inProgress } from '../../src/lib/fanDeep.ts';

const t = (abbrev, o) => ({ abbrev, name: abbrev, gp: 10, w: 5, l: 4, otl: 1, pts: 11, ptsPct: 0.55, gf: 3, ga: 3, pp: 0.2, pk: 0.8, sf: 28, sa: 28, fo: 0.5,
  sat: 0.5, satAhead: 0.45, satBehind: 0.55, sv5: 0.91, sh5: 0.09, pdo: 1, gfPct: 0.5, give60: 10, take60: 5, hits60: 20, blocks60: 14, ...o });
const league = Array.from({ length: 31 }, (_, i) => t(`T${i}`, { gf: 2.5 + i * 0.03, pk: 0.75 + i * 0.003, sat: 0.47 + i * 0.002, ptsPct: 0.4 + i * 0.01 }));
league.push(t('EDM', { gf: 4.6, ga: 3.2, pk: 0.62, pp: 0.35, sat: 0.47, sv5: 0.899, sh5: 0.152, pdo: 1.05, ptsPct: 0.85, satAhead: 0.40 }));
const sk = (id, name, pos, gp, g, a, toi) => ({ id, name, pos, gp, g, a, pts: g + a, pm: 0, pim: 0, ppg: 0, sog: 20, pct: 0.1, toi, fo: 0, headshot: null });
const skaters = [sk(1, 'Connor McDavid', 'C', 10, 8, 14, 1380), sk(2, 'Leon Draisaitl', 'C', 10, 7, 10, 1300), sk(3, 'Young Gun', 'L', 10, 4, 4, 1100), sk(4, 'Old Hand', 'R', 10, 0, 1, 700),
  sk(5, 'D One', 'D', 10, 1, 3, 1400), ...Array.from({ length: 8 }, (_, i) => sk(10 + i, `Depth ${i}`, 'L', 10, 0, 1, 800))];
const skatersPrev = [sk(1, 'Connor McDavid', 'C', 82, 48, 90, 1379), sk(3, 'Young Gun', 'L', 60, 6, 6, 900), sk(4, 'Old Hand', 'R', 80, 15, 20, 1000)];
const data = { abbrev: 'EDM', name: 'Edmonton Oilers', season: 20262027, prevSeason: 20252026, standing: { gp: 10, w: 8, l: 1, otl: 1, pts: 17, ptsPct: 0.85, gd: 15, div: 'Pacific', divRank: 1, confRank: 1, leagueRank: 2, wildRank: 0, streak: 'W3', l10: '8-1-1', home: '3-1-1', road: '5-0-0' },
  league, leaguePrev: [], skaters, goalies: [{ id: 30, name: 'Tristan Jarry', gp: 10, gs: 10, w: 8, l: 1, otl: 1, gaa: 3.1, svp: 0.88, so: 0, headshot: null }], skatersPrev, goaliesPrev: [],
  roster: [{ id: 3, name: 'Young Gun', num: 9, pos: 'L', shoots: 'L', ht: 185, wt: 85, born: '2004-03-01', city: 'X', country: 'CAN', headshot: null }], prospects: [], recent: [], upcoming: [], playoffs: [], news: [], at: '' };

const gf = rankIn(league, 'EDM', METRICS.find((m) => m.key === 'gf'));
assert.equal(gf.rank, 1, 'the most goals ranks first');
assert.equal(rankIn(league, 'EDM', METRICS.find((m) => m.key === 'pk')).rank, 32, 'the worst kill ranks last');

const a = assess(data, new Date('2026-10-24T12:00:00Z'));
assert.ok(a.strengths.some((r) => r.key === 'gf') && a.weaknesses.some((r) => r.key === 'pk'), 'goals a strength, the kill a weakness');
assert.ok(!a.strengths.some((r) => r.key === 'ptsPct'), 'the record itself is not a strength, the reasons for it are');
assert.equal(a.luck.tone, 'hot', 'a 1050 PDO reads as running hot');
assert.equal(a.recs[0].priority, 'high');
assert.ok(a.recs.some((r) => r.area === 'Penalty kill' && /62\.0% killed ranks 32nd of 32/.test(r.why)), 'the kill recommendation quotes its rank');
assert.ok(a.recs.some((r) => r.area === 'Depth scoring'), 'two stars with most of the points ask for depth');
assert.ok(a.recs.some((r) => r.area === 'Workload'), 'a goalie with every start gets the workload note');
assert.ok(a.early && /10 games in/.test(a.summary) && /2nd in the league \(8-1-1\)/.test(a.summary), 'an early sample says so, and the rank is the standings');
const dev = new Map(a.development.map((p) => [p.name, p]));
assert.equal(dev.get('Young Gun').verdict, 'rising', 'more points and more ice time');
assert.equal(dev.get('Old Hand').verdict, 'fading', 'fewer points and less ice time');
assert.equal(dev.get('Leon Draisaitl').verdict, 'new', 'no line last season to compare');
assert.equal(a.youngCore[0].name, 'Young Gun', 'the young core is 24 and under');
assert.match(a.grade, /^[A-F][+-]?$/);

// ── the deeper reads (24 October 2026)
assert.equal(rankIn(league, 'EDM', METRICS.find((m) => m.key === 'gd')).rank, 1, 'a worked-out measure (goal difference) ranks like a stored one');
assert.ok(METRICS.length >= 40, 'the club is measured at least forty ways');

// a table of 32: two conferences, two divisions each, eight clubs a division; Edmonton on top of the Pacific
const DIV = { E: ['A', 'M'], W: ['C', 'P'] };
const table = [];
let k = 0;
for (const conf of ['E', 'W']) for (const div of DIV[conf]) for (let i = 0; i < 8; i++) {
  const ab = div === 'P' && i === 0 ? 'EDM' : `X${k}`; k++;
  const pts = ab === 'EDM' ? 17 : 6 + (k * 7) % 12;
  table.push({ abbrev: ab, name: ab, conf, div, divName: div, gp: 10, w: Math.floor(pts / 2), l: 10 - Math.floor(pts / 2), otl: pts % 2, pts, ptsPct: pts / 20, gd: 0, rw: Math.floor(pts / 2), l10: '', streak: null });
}
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
const game = (n, home, opp, us, them, outcome = 'REG') => ({ id: n, date: day(n), start: '', state: 'OFF', type: 2, home: home ? 'EDM' : opp, away: home ? opp : 'EDM', hs: home ? us : them, as: home ? them : us, outcome });
const schedule = [game(0, true, 'X25', 4, 1), game(1, false, 'X26', 3, 2), game(2, true, 'X1', 2, 3, 'OT'), game(4, true, 'X27', 5, 2), game(5, false, 'X28', 1, 4),
  game(7, true, 'X29', 3, 1), game(8, false, 'X30', 4, 3), game(10, true, 'X2', 6, 2), game(11, false, 'X31', 2, 1), game(13, true, 'X3', 3, 0),
  ...Array.from({ length: 72 }, (_, i) => ({ id: 100 + i, date: day(15 + i * 2), start: '', state: 'FUT', type: 2, home: i % 2 ? 'EDM' : 'X25', away: i % 2 ? 'X26' : 'EDM', hs: null, as: null, outcome: null }))];
league.find((x) => x.abbrev === 'EDM').g5v5f = 27; league.find((x) => x.abbrev === 'EDM').g5v5a = 21;
const deep = { ...data, table, schedule, champion: 'T3', leaguePrev: [t('T3', { ptsPct: 0.69, gf: 3.5, ga: 2.9, sat: 0.59 })],
  usage: [{ id: 1, ev: 1000, pp: 230, sh: 0, sat: 0.59, satRel: 0.1, zs: 0.6, pdo: 1.05, toi5: 900, p60: 4, career: { gp: 804, g: 417, a: 834, pts: 1251, sog: 2738, pct: 0.15, gwg: 76 } }],
  crease: [{ id: 30, qs: 5, qsPct: 0.5, sa: 280, ga: 34, evSvp: 0.89 }] };
deep.skaters[0].sog = 25;   // McDavid: 8 goals on 25 shots against a 15% career
const out = outlook(deep, 1500);
assert.ok(out.playoffs > 0.6 && out.playoffs <= 1, 'the best record in its division is a likely playoff club');
const sumOdds = out.odds.reduce((s, x) => s + x.playoffs, 0);
assert.ok(Math.abs(sumOdds - 8) < 0.01, 'eight playoff places in a conference, every simulation');
assert.ok(out.projected.low <= out.projected.mid && out.projected.mid <= out.projected.high && out.projected.mid > 17, 'a range of finishes around the middle one');
assert.deepEqual(outlook(deep, 1500), out, 'the same numbers simulate to the same odds');
const tr = truth(deep);
assert.ok(Math.abs(tr.pythagWins - 10 * (46 ** 2 / (46 ** 2 + 32 ** 2))) < 0.01, 'Pythagorean wins from goals for and against');
assert.ok(tr.adj.adjGd < tr.adj.actualGd, 'shooting 15% at 5-on-5 flatters the goal difference');
const sp = splits(deep);
const b2b = sp.schedule.find((s) => s.label.startsWith('Second night'));
assert.equal(b2b.gp, 5, 'five games on the night after another (days 1, 2, 5, 8, 11)');
assert.equal(sp.venue.find((s) => s.label === 'At home').w, 5, 'five home wins');
assert.equal(sp.schedule.find((s) => s.label === 'Past regulation').otl, 1, 'the overtime loss is a point');
const fm = form(deep);
assert.equal(fm.games.length, 10); assert.equal(fm.games[9].total, 17, 'cumulative points follow the results');
assert.equal(fm.longestWin, 5, 'the longest run of wins'); assert.equal(fm.longestPoint, 5);
const ah = ahead(deep);
assert.equal(ah.left, 72); assert.equal(ah.home + ah.road, 72);
const pl = players(deep);
const mc = pl.rows.find((p) => p.name === 'Connor McDavid');
assert.equal(mc.luck, 'hot', '32% shooting against a 15% career runs hot');
assert.ok(pl.milestones.some((m) => m.name === 'Connor McDavid' && m.what === 'assists' && m.at === 900), 'the next round number in reach');
const cr = crease(deep);
assert.ok(cr[0].gsaa != null && cr[0].qsPct === 0.5, 'goals saved above average from shots and goals against');
const ch = champion(deep);
assert.equal(ch.abbrev, 'T3'); assert.ok(ch.lines.find((l) => l.label === 'Points %').better, 'a .850 club beats a .690 champion on points');
const dr = deepRecs(deep, { out, tr, pl, cr, ah, sp });
assert.ok(dr.some((r) => r.area === 'Regression watch' && /McDavid/.test(r.title)), 'the hot finisher gets the regression note');
assert.ok(dr.every((r) => r.why.length > 40), 'every call says why');

// ── the record books
const S = (y, pts, po, gp = 80) => ({ season: Number(`${y}${y + 1}`), gp, w: Math.floor(pts / 2), l: gp - Math.floor(pts / 2), t: 0, otl: 0, pts, gf: 300, ga: 250, div: 'Smythe', divRank: 1, confRank: 1, leagueRank: 1, team: 'EDM', ...(po ? { po } : {}) });
const hist = { abbrev: 'EDM', franchise: 25, first: 19791980, totals: { regular: null, playoffs: null }, captains: [], coaches: [], gms: [], retired: [], vs: [], vsPlayoffs: [],
  leaders: { points: [{ id: 1, name: 'Wayne Gretzky', pos: 'C', gp: 696, g: 583, a: 1086, pts: 1669, season: null }], goals: [], assists: [], games: [], poPoints: [], poGoals: [], wins: [], shutouts: [], poWins: [] },
  best: { points: [], goals: [], assists: [], wins: [], svp: [] }, firsts: [{ id: 2, name: 'Connor McDavid', year: 2015, round: 1, overall: 1, pos: 'C', from: 'Erie', league: 'OHL', career: { gp: 804, pts: 1251 } }], steals: [],
  awards: [{ season: 20222023, trophy: 'Art Ross Trophy', trophyId: 16, name: 'Connor McDavid', id: 2, status: 'WINNER' }, { season: 20222023, trophy: 'Art Ross Trophy', trophyId: 16, name: 'Leon Draisaitl', id: 3, status: 'RUNNER_UP' }],
  seasons: [S(1983, 119, { round: 4, of: 4, title: 'Stanley Cup Final', won: true }), S(1984, 109, { round: 4, of: 4, title: 'Stanley Cup Final', won: true }), S(1992, 60, null), S(2015, 70, null), S(2022, 109, { round: 2, of: 4, title: '2nd Round', won: false }), S(2026, 17, null, 10)], at: '' };
assert.equal(springOf(hist.seasons[0], hist.seasons), 'Won the Stanley Cup');
assert.equal(springOf(hist.seasons[4], hist.seasons), 'Lost in the second round');
assert.ok(inProgress(hist.seasons[5], hist.seasons) && springOf(hist.seasons[5], hist.seasons) === 'Season in progress', 'this season is not a missed spring');
const er = eras(hist);
assert.equal(er.find((e) => e.name === 'The dynasty').cups, 2);
assert.equal(er.find((e) => e.name === 'The McDavid era').best.season, 20222023, 'the season in progress is never an era\'s best');
const hf = historyFacts(hist);
assert.ok(hf.some((f) => /Best regular season by points: 119 in 1983-84/.test(f)));
assert.ok(hf.some((f) => /first and second in the scoring race 1 time: 2022-23/.test(f)), 'teammates one-two, counted from the trophies');
assert.equal(pickVerdict(hist.firsts[0], 2026), 'star');
assert.equal(pickVerdict({ ...hist.firsts[0], year: 2021, career: { gp: 2, pts: 0 } }, 2026), 'pending', 'five years on, still developing');
assert.equal(pickVerdict({ ...hist.firsts[0], year: 2012, career: { gp: 350, pts: 136 } }, 2026), 'regular');
console.log('fan zone: the assessment reads the numbers ok');
