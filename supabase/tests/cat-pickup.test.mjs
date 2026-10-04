// The category pickup model (src/lib/catpickup.ts): per-game rates, the pool's scales, a team's needs, and a move's
// effect on each category.
import assert from 'node:assert/strict';
import { perGame, buildModel, contribution, scorePerGame, categoryDelta, pointsScale } from '../../src/lib/catpickup.ts';

const ok = (what) => console.log('ok:', what);
const near = (a, b, what, eps = 1e-6) => { assert.ok(Math.abs(a - b) < eps, `${what}: ${a} vs ${b}`); };

// last season's pace alone, then half and half with this season's at 30 games
const sk = { id: 1, pos: 'C', proj: 100, proj_gp: 80, last_stats: { gp: 80, g: 40, hit: 80 } };
near(perGame(sk, undefined, ['g', 'hit']).g, 0.5, 'pace from last season');
near(perGame(sk, { gp: 30, totals: { g: 30, hit: 0 } }, ['g', 'hit']).g, 0.75, 'half and half at 30 games');
assert.equal(perGame({ ...sk, last_stats: null }, undefined, ['g']), null);
assert.deepEqual(Object.keys(perGame(sk, undefined, ['g', 'w', 'svp'])), ['g'], 'a skater carries only skater categories');
ok('per-game rates');

// a goalie's save percentage counts as saves above the average goalie's share of his shots; goals against the other way
const avg = { svp: 0.9, gaa: 3 };
near(contribution('svp', { sv: 28, sa: 30 }, avg), 1, 'saves above average');
near(contribution('gaa', { ga: 2, gs: 1 }, avg), 1, 'goals against under average');
near(contribution('gaa', { ga: 4, gs: 1 }, avg), -1, 'goals against over average');
ok('rate categories');

// weights: last place leans 1.5, first 0.5; an even table weighs every category the same
const pool = [sk, { id: 2, pos: 'C', proj: 90, proj_gp: 80, last_stats: { gp: 80, g: 10, hit: 240 } }, { id: 3, pos: 'D', proj: 50, proj_gp: 80, last_stats: { gp: 80, g: 5, hit: 120 } }];
const m = buildModel(['g', 'hit'], pool, new Map(), { pts: { g: 8, hit: 1 }, teams: 8 });
near(m.weight.g, 0.5, 'first in goals'); near(m.weight.hit, 1.5, 'last in hits');
const even = buildModel(['g', 'hit'], pool, new Map(), { pts: { g: 4.5, hit: 4.5 }, teams: 8 });
assert.deepEqual(even.weight, { g: 1, hit: 1 }, 'an even table');
ok('team needs');

// a team last in hits prefers the hitter to the scorer
const rate = (p) => perGame(p, undefined, m.cats);
assert.ok(scorePerGame(m, rate(pool[1]), pool[1]) > scorePerGame(m, rate(pool[0]), pool[0]), 'the hitter, for a team short of hits');
ok('scores lean to needs');

// the move's effect: starts after less before, times the rates
const rates = new Map(pool.map((p) => [p.id, rate(p)]));
const pos = new Map(pool.map((p) => [p.id, p.pos]));
const d = categoryDelta(m, rates, pos, new Map([[1, { starts: 10 }]]), new Map([[2, { starts: 10 }]]));
near(d.g, 10 * (10 / 80) - 10 * 0.5, 'goals given up'); near(d.hit, 10 * 3 - 10 * 1, 'hits gained');
ok('category effect of a move');
// the trade engine's points scale: the typical rostered player is worth his points, the rest by their categories
{
  const ps = [
    { id: 11, pos: 'C', proj: 160, proj_gp: 80, last_stats: { gp: 80, g: 30, hit: 40 } },
    { id: 12, pos: 'D', proj: 80, proj_gp: 80, last_stats: { gp: 80, g: 5, hit: 250 } },
    { id: 13, pos: 'LW', proj: 120, proj_gp: 80, last_stats: { gp: 80, g: 20, hit: 100 } },
  ];
  const mm = buildModel(['g', 'hit'], ps, new Map());
  const rr = new Map(ps.map((p) => [p.id, perGame(p, undefined, mm.cats)]));
  const ppg = (p) => p.proj / 80;
  const val = pointsScale(mm, rr, ps, ppg, new Set([11, 12, 13]));
  const ratio = ps.map((p) => ppg(p) / scorePerGame(mm, rr.get(p.id), p)).sort((a, b) => a - b)[1];
  near(val(ps[2]), scorePerGame(mm, rr.get(13), ps[2]) * ratio, 'scaled by the median rostered ratio');
  assert.ok(val(ps[1]) > ppg(ps[1]), 'a big hitter is worth more than his points in a hits league');
  assert.equal(pointsScale(mm, new Map([[11, { g: -1, hit: -1 }]]), [ps[0]], ppg, new Set())({ ...ps[0] }), 0, 'below nothing is nothing');
  ok('points scale for the trade engine');
}
console.log('category pickup tests passed');
