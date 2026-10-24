// The fan zone's analysis (src/lib/fanZone.ts) on the real Oilers numbers saved from nhl-hub's `fan` task: ranks among
// the 32, strengths and weaknesses at the ends, a grade, the luck read, the development verdicts and recommendations
// that quote their evidence.
import assert from 'node:assert/strict';
import { assess, rankIn, METRICS } from '../../src/lib/fanZone.ts';

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
console.log('fan zone: the assessment reads the numbers ok');
