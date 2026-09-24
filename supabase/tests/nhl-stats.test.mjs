// node --experimental-strip-types supabase/tests/nhl-stats.test.mjs [gameId]
// Checks the stat extraction against a real finished NHL game.
import assert from 'node:assert/strict';
import { gameStats, NHL } from '../functions/_shared/nhl.ts';

const id = process.argv[2] || '2025020500';
const [box, landing, pbp] = await Promise.all([
  fetch(`${NHL}/gamecenter/${id}/boxscore`).then((r) => r.json()),
  fetch(`${NHL}/gamecenter/${id}/landing`).then((r) => r.json()),
  fetch(`${NHL}/gamecenter/${id}/play-by-play`).then((r) => r.json()),
]);
const lines = gameStats(box, landing, pbp);
const skaters = lines.filter((l) => 'g' in l.stats);
const goalies = lines.filter((l) => 'sv' in l.stats);

const goals = (team) => skaters.filter((l) => l.nhl_team === team).reduce((t, l) => t + l.stats.g, 0);
const shootout = landing.summary.scoring.some((p) => p.periodDescriptor.periodType === 'SO');
if (!shootout) {
  assert.equal(goals(box.homeTeam.abbrev), box.homeTeam.score, 'home goals add up');
  assert.equal(goals(box.awayTeam.abbrev), box.awayTeam.score, 'away goals add up');
  assert.equal(skaters.filter((l) => l.stats.gwg).length, 1, 'exactly one GWG');
}
assert.equal(goalies.filter((g) => g.stats.gs).length, 2, 'two starting goalies');
assert.equal(goalies.filter((g) => g.stats.w).length, 1, 'one winning goalie');
const ppGoals = landing.summary.scoring.flatMap((p) => p.goals).filter((g) => g.strength === 'pp').length;
assert.ok(skaters.reduce((t, l) => t + l.stats.ppp, 0) >= ppGoals, 'PPP at least PP goals');
assert.equal(skaters.reduce((t, l) => t + l.stats.ppg, 0), ppGoals, 'PPG matches PP goals');
const faceoffs = pbp.plays.filter((p) => p.typeDescKey === 'faceoff').length;
assert.equal(skaters.reduce((t, l) => t + l.stats.fow, 0), faceoffs, 'one faceoff win per faceoff');
for (const l of skaters) assert.equal(l.stats.pts, l.stats.g + l.stats.a);
console.log(`ok: game ${id}, ${skaters.length} skaters, ${goalies.length} goalies, GWG`,
  skaters.find((l) => l.stats.gwg)?.player_id, 'PP goals', ppGoals, 'faceoffs', faceoffs);
