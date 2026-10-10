// node --experimental-strip-types supabase/tests/lineup.test.mjs
import { optimize, weekEndOf } from '../functions/_shared/lineup.ts';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const P = (id, pos, elig, proj, team, inj = null) => ({ id, pos, elig, proj, nhl_team: team, injury_status: inj });
const today = '2026-10-14';
const ctx = (extra = {}) => ({ today, weekEnd: weekEndOf(today), now: Date.parse('2026-10-14T15:00:00Z'),
  games: [
    { home: 'EDM', away: 'CGY', date: today, start_utc: '2026-10-15T01:00:00Z', state: 'FUT' },
    { home: 'TOR', away: 'MTL', date: today, start_utc: '2026-10-14T23:00:00Z', state: 'FUT' },
    { home: 'BOS', away: 'NYR', date: '2026-10-15', start_utc: '2026-10-15T23:00:00Z', state: 'FUT' },
    { home: 'BOS', away: 'PHI', date: '2026-10-17', start_utc: '2026-10-17T23:00:00Z', state: 'FUT' },
  ], season: new Map(), caps: { C: 1, LW: 1, RW: 0, D: 0, Util: 0, G: 0, IR: 1, BN: 5 }, ...extra });
// a C/LW must go to LW so the pure C can start: greedy-by-value would put the C/LW at C
const players = new Map([
  [1, P(1, 'C', ['C', 'LW'], 200, 'EDM')], [2, P(2, 'C', ['C'], 150, 'TOR')], [3, P(3, 'LW', ['LW'], 90, 'MTL')],
  [4, P(4, 'LW', ['LW'], 300, 'BOS')], [5, P(5, 'C', ['C'], 250, 'CGY', 'Out')],
]);
const rows = [1, 2, 3, 4, 5].map((id) => ({ player_id: id, slot: 'BN' }));
let plan = optimize(rows, players, 'day', 'proj', ctx());
assert(plan.slots.get(1) === 'LW' && plan.slots.get(2) === 'C', 'day: C/LW slides to LW so both play tonight');
assert(plan.slots.get(4) === 'BN', 'day: Boston winger has no game today, sits');
assert(plan.slots.get(5) === 'BN', 'IR is the GM\'s call: the optimizer never moves anyone onto it');
plan = optimize(rows, players, 'week', 'proj', ctx());
assert(plan.slots.get(4) === 'LW', 'week: Boston winger (2 games left) starts over one-game wingers');
plan = optimize(rows, players, 'season', 'proj', ctx());
assert(plan.slots.get(4) === 'LW' && plan.slots.get(1) === 'C', 'season: best season values start regardless of schedule');
plan = optimize(rows.map((r) => (r.player_id === 2 ? { ...r, pin: 'bench' } : r.player_id === 3 ? { ...r, pin: 'start' } : r)), players, 'day', 'proj', ctx());
assert(plan.slots.get(3) === 'LW' && plan.slots.get(2) === 'BN' && plan.slots.get(1) === 'C', 'pins: forced start and forced bench respected');
// a started game locks that player where he is
plan = optimize(rows.map((r) => (r.player_id === 3 ? { ...r, slot: 'LW' } : r)), players, 'day', 'proj', ctx({ now: Date.parse('2026-10-14T23:30:00Z') }));
assert(plan.slots.get(3) === 'LW' && plan.slots.get(2) === 'BN', 'locked Montreal winger keeps LW; Toronto centre locked on bench');
// October 2026 (Panagiotis): four scoreless games must not make a player who plays worth less than a starter with
// no game. Kyrou (projected 1.7 a game, 0 points in 4) plays tonight; Eichel (hot, 22.7 in 5) doesn't.
{
  const ps = new Map([[10, P(10, 'RW', ['RW'], 135, 'EDM')], [11, P(11, 'C', ['C'], 200, 'BOS')], [12, P(12, 'D', ['D'], 110, 'BOS')], [13, P(13, 'D', ['D'], 100, 'TOR')]]);
  const season = new Map([[10, { gp: 4, fpts: 0, gp14: 4, fpts14: 0 }], [11, { gp: 5, fpts: 22.7, gp14: 5, fpts14: 22.7 }]]);
  const caps = { C: 0, LW: 0, RW: 0, D: 1, Util: 1, G: 0, IR: 0, BN: 5 };
  const r = [{ player_id: 10, slot: 'BN' }, { player_id: 11, slot: 'Util' }, { player_id: 12, slot: 'D', pin: 'start' }, { player_id: 13, slot: 'BN' }];
  for (const basis of ['form', 'season', 'proj', 'ros']) {
    const x = optimize(r, ps, 'day', basis, ctx({ season, caps }));
    assert(x.slots.get(10) === 'Util' && x.slots.get(11) === 'BN', `${basis}: a cold player with a game starts over a hot one without`);
    assert(x.slots.get(13) === 'D' && x.slots.get(12) === 'BN', `${basis}: a pin to start counts only on a night he plays`);
  }
  // the pin still wins when he plays
  const x = optimize(r.map((y) => (y.player_id === 12 ? { ...y, pin: 'start' } : y)), new Map([...ps, [12, P(12, 'D', ['D'], 110, 'MTL')]]), 'day', 'proj', ctx({ season, caps }));
  assert(x.slots.get(12) === 'D', 'a pinned player who plays keeps his start');
}
assert(weekEndOf('2026-10-14') === '2026-10-18' && weekEndOf('2026-10-18') === '2026-10-18', 'week ends Sunday');
console.log('lineup optimizer tests passed');
