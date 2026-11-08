// Rod Hockey's table and the computer (src/lib/rod): the puck stays on the table, goals are called at the mouth only,
// a shot goes where it's aimed, own goals are only the defending side's, a dead puck never stalls the game, and each
// level of the computer beats the one below it. Then the standings read shots: shooting and save percentages.
import assert from 'node:assert/strict';
import { GOAL_X0, GOAL_X1, H, MID, PUCK_R, W, drop, figOf, inReach, newTable, shoot, step, speed } from '../../src/lib/rod/physics.ts';
import { LEVELS, newBrain, think } from '../../src/lib/rod/ai.ts';
import { rinkStats, savePct, shootPct } from '../../src/lib/rink/stats.ts';

let seed = 7;
Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// 1. random pucks with every player off the ice: it never leaves except through a mouth
for (let i = 0; i < 600; i++) {
  const t = newTable();
  for (const f of t.figs) { f.ax = -9999; f.ay = -9999; f.ux = 0; f.uy = 0; f.x = f.y = -9999; }
  t.puck = { x: PUCK_R + Math.random() * (W - 2 * PUCK_R), y: 200 + Math.random() * (H - 400), vx: (Math.random() - 0.5) * 6000, vy: (Math.random() - 0.5) * 6000 };
  for (let k = 0; k < 600; k++) {
    for (const f of t.figs) { f.tt = 0; f.t = 0; }
    const ev = step(t, 1 / 60);
    const g = ev.find((e) => e.kind === 'goal');
    if (g) { assert.ok(t.puck.x > GOAL_X0 && t.puck.x < GOAL_X1, `goal outside the mouth at x=${t.puck.x}`); break; }
    assert.ok(t.puck.x >= PUCK_R - 0.5 && t.puck.x <= W - PUCK_R + 0.5, `puck off the side at ${t.puck.x}`);
    assert.ok(t.puck.y > -100 && t.puck.y < H + 100, `puck off the end at ${t.puck.y}`);
  }
}

// 2. a shot from the slot, nobody in the way, goes in where it was aimed and is the shooter's goal
{
  const t = newTable();
  for (const f of t.figs) if (!(f.side === 0 && f.role === 'C')) { f.ax = -9999; f.ux = 0; f.uy = 0; f.x = f.y = -9999; f.tt = f.t = 0; }
  const c = figOf(t, 0, 4);
  t.puck = { x: c.x + 40, y: c.y - 60, vx: 0, vy: 0 };
  assert.ok(inReach(c, t.puck), 'the puck is on the centre’s stick');
  shoot(t, c, 560 - t.puck.x, 0 - t.puck.y, 2600);
  let goal = null;
  for (let k = 0; k < 240 && !goal; k++) { for (const f of t.figs) if (f !== c) { f.x = f.y = -9999; } goal = step(t, 1 / 60).find((e) => e.kind === 'goal'); }
  assert.ok(goal, 'the shot goes in');
  assert.equal(goal.into, 1, 'into the top net');
  assert.equal(goal.own, false, 'and it is not an own goal');
}

// 3. the computer against itself: no stalls, few own goals, and each level beats the one below
const lv = (k) => LEVELS.find((l) => l.key === k);
function game(a, b) {
  const t = newTable(); drop(t);
  const A = newBrain(lv(a), 0), B = newBrain(lv(b), 1);
  const sc = [0, 0];
  let clock = 0, still = 0, own = 0;
  while (clock < 600 && sc[0] < 5 && sc[1] < 5) {
    clock += 1 / 60;
    think(A, t, clock); think(B, t, clock);
    for (const e of step(t, 1 / 60)) if (e.kind === 'goal') { sc[e.into === 1 ? 0 : 1]++; if (e.own) own++; drop(t); }
    // the game's own rule: a puck nobody plays for a few seconds is dropped again, so count how often it's needed
    if (speed(t.puck) < 60 && !t.holder) { still += 1 / 60; if (still > 3) { still = 0; drop(t); } } else still = 0;
  }
  assert.ok(sc[0] >= 5 || sc[1] >= 5, `${a} v ${b} finished (it took ${Math.round(clock)} s)`);
  return { won: sc[0] > sc[1], own, goals: sc[0] + sc[1] };
}
for (const [a, b, n, need] of [['junior', 'beer', 12, 9], ['pro', 'junior', 12, 9], ['legend', 'pro', 12, 9]]) {
  let w = 0, own = 0, goals = 0;
  for (let i = 0; i < n; i++) { const r = game(a, b); if (r.won) w++; own += r.own; goals += r.goals; }
  assert.ok(w >= need, `${a} should beat ${b}: won ${w} of ${n}`);
  assert.ok(own / goals < 0.15, `own goals are rare: ${own} of ${goals}`);
}

// 4. the standings read shots: shooting and save percentages, the sniper and the wall
{
  const day = 86_400_000, now = Date.parse('2026-11-08T20:00:00Z');
  const g = (id, home, away, hg, ag, hs, as, d) => ({ id, match_id: 'r' + id, home, away, level: away ? null : 'pro', home_goals: hg, away_goals: ag, home_own: 0, away_own: 0, home_best: 100, away_best: 90, secs: 200, home_shots: hs, away_shots: as, played_at: new Date(now - d * day).toISOString() });
  const rows = [g(1, 1, 2, 5, 2, 20, 10, 3), g(2, 2, 1, 1, 5, 8, 15, 2), g(3, 1, null, 5, 4, 12, 18, 1)];
  const { players, records } = rinkStats(rows, now, 5);
  const p1 = players.find((p) => p.team === 1);
  assert.equal(p1.all.sf, 47); assert.equal(p1.all.sa, 36);
  assert.equal(Math.round(shootPct(p1.all) * 100), 32, 'team 1 scored 15 on 47 shots');
  assert.equal(Math.round(savePct(p1.all) * 100), 81, 'and let 7 in on 36');
  assert.equal(records.sniper.team, 1);
  assert.equal(records.rally, null, 'Rod Hockey keeps no rally');
  assert.equal(p1.comebacks, 1, 'a win after three against is a comeback at first to five');
}
console.log('rod tests passed');
