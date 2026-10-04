// The head-to-head win chance's forecast from tonight (_shared/forecast.ts): once tonight's games are on, the slots
// the started players hold are taken, so a bench player in a late game only fills a slot that's still open.
import assert from 'node:assert/strict';
import { forecastFromTonight, forecastTeam } from '../functions/_shared/forecast.ts';

const day = '2026-11-03', next = '2026-11-04';
const caps = { C: 2, LW: 2, RW: 2, D: 4, Util: 1, G: 2 };
const g = (id, pos, club) => ({ id, pos, elig: [pos], nhl_team: club, injury_status: null, proj: pos === 'G' ? 200 : 160, proj_gp: pos === 'G' ? 58 : 82 });
// a third goalie, on the bench, in a late game tonight and one tomorrow
const roster = [g(1, 'G', 'TOR'), g(2, 'G', 'MTL'), g(3, 'G', 'VAN')];
const games = [{ id: 2026020101, date: day, home: 'VAN', away: 'SEA' }, { id: 2026020102, date: next, home: 'VAN', away: 'EDM' }];

const all = forecastTeam(9, roster, games, caps, day, 0, next).ros;
// both goalie slots held by the two already playing: tonight's late goalie adds nothing, tomorrow's game counts
const held = forecastFromTonight(9, roster, games, caps, day, next, { G: 2 });
const tomorrow = forecastTeam(9, roster, games, caps, next, 0, next).ros;
assert.ok(tomorrow > 0 && all > tomorrow, 'the late game is worth something with a slot open');
assert.equal(held, tomorrow, 'a goalie slot already played can\'t be filled again');
// one slot still open: he fills it
assert.equal(forecastFromTonight(9, roster, games, caps, day, next, { G: 1 }), all);
// the stretch ends tonight: nothing after it
assert.equal(forecastFromTonight(9, roster, games, caps, day, day, { G: 2 }), 0);
console.log('forecast tests passed');
