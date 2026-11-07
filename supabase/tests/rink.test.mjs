// Rink Duel's table and the computer (src/lib/rink): the puck stays on the table, goals are called at the mouth only,
// the shot reader is right, and each level of the computer stops more shots than the one below it.
import assert from 'node:assert/strict';
import { H, MID, PUCK_R, W, GOAL_X0, GOAL_X1, newTable, faceoff, step, predictX } from '../../src/lib/rink/physics.ts';
import { LEVELS, newBrain, think } from '../../src/lib/rink/ai.ts';

// a seeded Math.random, so the run is the same every time
let seed = 42;
Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// 1. a thousand random shots with nobody home: the puck never leaves the ice except through a mouth
for (let i = 0; i < 1000; i++) {
  const t = newTable();
  t.pads[0].y = t.pads[0].ty = H + 500; t.pads[1].y = t.pads[1].ty = -500;   // paddles out of the way
  t.pads[0].x = t.pads[1].x = -999; t.pads[0].tx = t.pads[1].tx = -999;
  t.puck = { x: PUCK_R + Math.random() * (W - 2 * PUCK_R), y: 200 + Math.random() * (H - 400), vx: (Math.random() - 0.5) * 6000, vy: (Math.random() - 0.5) * 6000 };
  for (let f = 0; f < 600; f++) {
    const ev = step(t, 1 / 60, { hits: [false, false] });
    const g = ev.find((e) => e.kind === 'goal');
    if (g) { assert.ok(t.puck.x > GOAL_X0 && t.puck.x < GOAL_X1, `goal outside the mouth at x=${t.puck.x}`); break; }
    assert.ok(t.puck.x >= PUCK_R - 0.5 && t.puck.x <= W - PUCK_R + 0.5, `puck off the side at ${t.puck.x}`);
    assert.ok(t.puck.y > -PUCK_R * 2 && t.puck.y < H + PUCK_R * 2, `puck off the end at ${t.puck.y}`);
  }
}

// 2. the shot reader agrees with the table
{
  const t = newTable();
  t.pads[0].x = t.pads[1].x = t.pads[0].tx = t.pads[1].tx = -999;
  t.puck = { x: 300, y: 1300, vx: 900, vy: -2200 };
  const guess = predictX(t.puck, 200);
  assert.ok(guess, 'it reads a shot coming up the ice');
  let crossed = null;
  for (let f = 0; f < 600 && !crossed; f++) { step(t, 1 / 240, { hits: [false, false], goals: false }); if (t.puck.y <= 200) crossed = t.puck.x; }
  assert.ok(crossed != null && Math.abs(crossed - guess.x) < 30, `predicted ${guess.x}, crossed at ${crossed}`);
}

// 3. the computer in goal: hard shots from the player's end, how many does each level keep out
const saves = LEVELS.map((L) => {
  let kept = 0;
  for (let i = 0; i < 300; i++) {
    const t = newTable();
    faceoff(t, 0);
    t.pads[0].x = t.pads[0].tx = -999;
    const b = newBrain(L);
    b.next = Math.random() * L.eyes;   // the shot comes at some moment between its reads
    const aimX = GOAL_X0 + Math.random() * (GOAL_X1 - GOAL_X0);
    const from = { x: 150 + Math.random() * 700, y: MID + 200 + Math.random() * 500 };
    const sp = 1800 + Math.random() * 1400;
    const d = Math.hypot(aimX - from.x, 0 - from.y);
    t.puck = { ...from, vx: ((aimX - from.x) / d) * sp, vy: (-from.y / d) * sp };
    let goal = false, now = 0;
    for (let f = 0; f < 240; f++) {
      now += 1 / 60;
      think(b, t, now);
      const ev = step(t, 1 / 60, { hits: [false, true] });
      if (ev.some((e) => e.kind === 'goal' && e.into === 1)) { goal = true; break; }
    }
    if (!goal) kept++;
  }
  return kept / 300;
});
console.log('rink: saves by level', LEVELS.map((l, i) => `${l.key} ${(saves[i] * 100).toFixed(0)}%`).join(', '));
for (let i = 1; i < saves.length; i++) assert.ok(saves[i] >= saves[i - 1] - 0.03, `${LEVELS[i].key} should stop at least as many as ${LEVELS[i - 1].key}`);
assert.ok(saves[0] < 0.85, 'the beer league keeper lets some in');
assert.ok(saves[3] > 0.5, 'the legend stops most');
console.log('rink tests passed');

// 4. the standings: totals, own goals, the rating and the trend, from kept games
{
  const { rinkStats } = await import('../../src/lib/rink/stats.ts');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const g = (id, home, away, level, hg, ag, ho, ao, daysAgo) => ({ id, match_id: 'm' + id, home, away, level, home_goals: hg, away_goals: ag,
    home_own: ho, away_own: ao, home_best: 120, away_best: 100, rally: id, secs: 120, played_at: new Date(now - daysAgo * 86400000).toISOString() });
  const rows = [g(1, 1, 2, null, 7, 3, 0, 1, 30), g(2, 2, 1, null, 7, 5, 2, 0, 20), g(3, 1, null, 'legend', 7, 6, 0, 0, 3), g(4, 1, 2, null, 8, 0, 0, 3, 1)];
  const { players, records } = rinkStats(rows, now);
  const p1 = players.find((p) => p.team === 1), p2 = players.find((p) => p.team === 2);
  assert.equal(p1.all.gp, 4); assert.equal(p1.all.w, 3); assert.equal(p1.all.gf, 7 + 5 + 7 + 8); assert.equal(p1.all.ga, 3 + 7 + 6 + 0);
  assert.equal(p2.all.own, 1 + 2 + 3, 'own goals add up from both ends of the table');
  assert.equal(p1.duels.gp, 3); assert.equal(p1.cpu.gp, 1); assert.equal(p1.byLevel.legend.w, 1);
  assert.equal(p1.vs.get(2).w, 2); assert.equal(p2.vs.get(1).w, 1);
  assert.equal(p1.rank, 1, 'the better record ranks first');
  assert.ok(p1.rating > 1000 && p2.rating < 1000);
  assert.equal(p1.recent.gp, 2); assert.equal(p1.trend, 'up');
  assert.deepEqual(p1.form, ['W', 'W', 'L', 'W']);
  assert.equal(p1.shutouts, 1); assert.equal(p1.hot, 1);
  assert.equal(records.games, 4); assert.equal(records.duels, 3); assert.equal(records.ownGoals.team, 2);
  assert.equal(records.rout.gf - records.rout.ga, 8);
  console.log('rink standings passed');
}
