// The Stanley Cup playoffs (migration 191): the NHL's bracket and series schedules become the rows sport_ingest()
// writes. The samples follow the NHL's /v1/playoff-bracket and /v1/schedule/playoff-series shapes (2026's series A).
import assert from 'node:assert/strict';
import { nhlPeriods, nhlPlayoffPayload, nhlState } from '../functions/_shared/nhlPlayoffs.ts';

// every NHL game state lands in one of ours; a postponed or cancelled schedule wins over the game state
assert.equal(nhlState({ gameState: 'FUT', gameScheduleState: 'OK' }), 'scheduled');
assert.equal(nhlState({ gameState: 'PRE' }), 'scheduled');
assert.equal(nhlState({ gameState: 'LIVE' }), 'live');
assert.equal(nhlState({ gameState: 'CRIT' }), 'live');
assert.equal(nhlState({ gameState: 'OFF' }), 'final');
assert.equal(nhlState({ gameState: 'FINAL' }), 'final');
assert.equal(nhlState({ gameState: 'FUT', gameScheduleState: 'PPD' }), 'postponed');

const team = (id, abbrev, name) => ({ id, abbrev, name: { default: name }, darkLogo: `https://assets.nhle.com/logos/nhl/svg/${abbrev}_dark.svg` });
const bracket = { series: [
  { seriesLetter: 'A', playoffRound: 1, seriesTitle: '1st Round', seriesAbbrev: 'R1', topSeedTeam: team(7, 'BUF', 'Buffalo Sabres'), bottomSeedTeam: team(6, 'BOS', 'Boston Bruins') },
  // a later round before its clubs are known: the NHL leaves the slots out
  { seriesLetter: 'I', playoffRound: 2, seriesTitle: '2nd Round', seriesAbbrev: 'R2' },
] };
const game = (id, n, home, away, hs, as, state, start) => ({ id, gameNumber: n, startTimeUTC: start, gameState: state, gameScheduleState: 'OK',
  homeTeam: { id: home, score: hs }, awayTeam: { id: away, score: as }, venue: { default: 'KeyBank Center' }, periodDescriptor: { number: 3, periodType: 'REG' } });
const games = { A: { length: 7, games: [game(2025030112, 2, 7, 6, 2, 3, 'OFF', '2026-04-21T23:00:00Z'), game(2025030111, 1, 7, 6, 4, 3, 'OFF', '2026-04-19T23:30:00Z'),
  game(2025030113, 3, 6, 7, null, null, 'FUT', '2026-04-24T00:00:00Z')] } };
const p = nhlPlayoffPayload('20252026', bracket, games);

assert.deepEqual(p.clubs.map((c) => c.short).sort(), ['BOS', 'BUF']);
assert.equal(p.clubs.find((c) => c.short === 'BUF').name, 'Buffalo Sabres');
const [a, i] = p.series;
// keyed by season and letter, the letter's place in the alphabet its order in the round
assert.equal(a.ext_id, '20252026:A'); assert.equal(a.sort, 1); assert.equal(i.sort, 9);
assert.equal(a.high, '7'); assert.equal(a.low, '6'); assert.equal(a.best_of, 7); assert.equal(a.tbd, false);
// the series starts with its first game, whatever order the schedule lists them in
assert.equal(a.starts_at, '2026-04-19T23:30:00Z');
assert.equal(i.high, null); assert.equal(i.tbd, true); assert.equal(i.starts_at, null);
assert.deepEqual(p.fixtures.map((f) => [f.game_no, f.state, f.home, f.home_score]), [[1, 'final', '7', 4], [2, 'final', '7', 2], [3, 'scheduled', '6', null]]);
// a game's date is the league's Eastern day: midnight UTC on the 24th is 8 pm on the 23rd in Toronto
assert.equal(p.fixtures[0].date, '2026-04-19');
assert.equal(p.fixtures[2].date, '2026-04-23');
// the score by period from a real Cup Final game (2025030411, VGK 5 at CAR 4): 2-1, 1-2 and 1-2 by period
const land = {"id": 2025030411, "gameState": "OFF", "periodDescriptor": {"number": 3, "periodType": "REG"}, "summary": {"scoring": [
  {"periodDescriptor": {"number": 1, "periodType": "REG"}, "goals": [{"homeScore": 1, "awayScore": 0}, {"homeScore": 2, "awayScore": 0}, {"homeScore": 2, "awayScore": 1}]},
  {"periodDescriptor": {"number": 2, "periodType": "REG"}, "goals": [{"homeScore": 2, "awayScore": 2}, {"homeScore": 2, "awayScore": 3}, {"homeScore": 3, "awayScore": 3}]},
  {"periodDescriptor": {"number": 3, "periodType": "REG"}, "goals": [{"homeScore": 3, "awayScore": 4}, {"homeScore": 4, "awayScore": 4}, {"homeScore": 4, "awayScore": 5}]}]}};
assert.deepEqual(nhlPeriods(land), [{ n: 1, home: 2, away: 1 }, { n: 2, home: 1, away: 2 }, { n: 3, home: 1, away: 2 }]);
// a scoreless period is 0-0, overtime is a fourth period, a shootout isn't one
assert.deepEqual(nhlPeriods({ periodDescriptor: { number: 4, periodType: 'OT' }, summary: { scoring: [
  { periodDescriptor: { number: 2, periodType: 'REG' }, goals: [{ homeScore: 1, awayScore: 0 }] },
  { periodDescriptor: { number: 4, periodType: 'OT' }, goals: [{ homeScore: 1, awayScore: 1 }] }] } }),
  [{ n: 1, home: 0, away: 0 }, { n: 2, home: 1, away: 0 }, { n: 3, home: 0, away: 0 }, { n: 4, home: 0, away: 1 }]);
assert.deepEqual(nhlPeriods({ periodDescriptor: { number: 5, periodType: 'SO' }, summary: { scoring: [{ periodDescriptor: { number: 5, periodType: 'SO' }, goals: [{ homeScore: 3, awayScore: 2 }] }] } }).length, 4);
// a game's periods ride with its fixture when given
const withP = nhlPlayoffPayload('20252026', bracket, games, { [p.fixtures[0].ext_id]: [{ n: 1, home: 1, away: 0 }] });
assert.deepEqual(withP.fixtures[0].periods, [{ n: 1, home: 1, away: 0 }]);
assert.equal(withP.fixtures[1].periods, undefined);
console.log('nhl playoffs ok');
