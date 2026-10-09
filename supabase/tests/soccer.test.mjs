// Soccer (migration 148): the sport row is consistent with itself, and API-Football's answers become the neutral rows
// soccer_ingest() writes. The sample items follow API-Football v3's documented shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afClub, afFixture, espnPlayoffPayload, espnTournamentPayload, gameweekOf } from '../functions/_shared/soccer.ts';

const sql = fs.readFileSync(new URL('../migrations/20261005000148_soccer.sql', import.meta.url), 'utf8');
const row = JSON.parse(sql.match(/\$sport\$([\s\S]*?)\$sport\$/)[1]);
const pos = new Set(row.positions.map((p) => p.key)), groups = new Set(row.groups.map((g) => g.key));
for (const p of row.positions) assert.ok(groups.has(p.group), `position ${p.key} in unknown group`);
for (const s of row.slots) for (const a of s.accepts) assert.ok(pos.has(a), `slot ${s.key} accepts unknown ${a}`);
for (const s of row.stats) assert.ok(groups.has(s.group), `stat ${s.key} in unknown group ${s.group}`);
assert.deepEqual(Object.keys(row.states).sort(), ['cancelled', 'final', 'live', 'postponed', 'scheduled']);
const all = Object.values(row.states).flat();
assert.equal(new Set(all).size, all.length, 'a status is in two states');
// every status API-Football documents has a state
for (const s of ['TBD', 'NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO', 'LIVE']) {
  assert.ok(all.includes(s), `status ${s} has no state`);
}
// the words every sport carries (the NHL's keys)
const nhl = fs.readFileSync(new URL('../migrations/20261005000135_sports.sql', import.meta.url), 'utf8');
const nhlWords = Object.keys(JSON.parse(nhl.match(/\$sport\$([\s\S]*?)\$sport\$/)[1]).words);
for (const w of [...nhlWords, 'game', 'rec', 'room', 'voice']) assert.ok(row.words[w], `soccer has no word for ${w}`);
console.log('ok: the soccer sport row is consistent');

assert.equal(gameweekOf('Regular Season - 8'), 8);
assert.equal(gameweekOf('Regular Season - 38'), 38);
assert.equal(gameweekOf('Round of 16'), null);
assert.equal(gameweekOf(null), null);

const sample = (short, goals, fulltime, extra = {}) => ({
  fixture: { id: 1208021, date: '2026-10-17T14:00:00+00:00', timestamp: 1792245600, venue: { name: 'Emirates Stadium', city: 'London' },
    status: { long: 'x', short, elapsed: short === 'NS' ? null : 90 } },
  league: { id: 39, season: 2026, round: 'Regular Season - 8' },
  teams: { home: { id: 42, name: 'Arsenal', logo: 'a.png' }, away: { id: 49, name: 'Chelsea', logo: 'c.png' } },
  goals, score: { halftime: { home: 1, away: 0 }, fulltime, extratime: { home: null, away: null }, penalty: { home: null, away: null }, ...extra },
});
const ns = afFixture(sample('NS', { home: null, away: null }, { home: null, away: null }));
assert.equal(ns.ext_id, '1208021'); assert.equal(ns.gameweek, 8); assert.equal(ns.kickoff, '2026-10-17T14:00:00.000Z');
assert.equal(ns.home, '42'); assert.equal(ns.away_club.name, 'Chelsea'); assert.equal(ns.home_score, null); assert.equal(ns.home_ft, null);
assert.equal(ns.venue, 'Emirates Stadium, London');
const live = afFixture(sample('2H', { home: 1, away: 1 }, { home: null, away: null }));
assert.equal(live.status, '2H'); assert.equal(live.home_score, 1); assert.equal(live.home_ft, null, 'no ninety-minute score while the match is on');
const ft = afFixture(sample('FT', { home: 2, away: 1 }, { home: 2, away: 1 }));
assert.deepEqual([ft.home_score, ft.away_score, ft.home_ft, ft.away_ft], [2, 1, 2, 1]);
// a cup tie: level after ninety, won in extra time; the result question reads the ninety-minute draw
const aet = afFixture(sample('AET', { home: 2, away: 1 }, { home: 1, away: 1 }, { extratime: { home: 1, away: 0 } }));
assert.deepEqual([aet.home_score, aet.home_ft, aet.away_ft], [2, 1, 1]);
const pen = afFixture(sample('PEN', { home: 1, away: 1 }, { home: 1, away: 1 }, { penalty: { home: 4, away: 3 } }));
assert.deepEqual([pen.home_pens, pen.away_pens], [4, 3]);
assert.deepEqual(afClub({ team: { id: 42, name: 'Arsenal', code: 'ARS', logo: 'a.png' } }), { ext_id: '42', name: 'Arsenal', short: 'ARS', logo: 'a.png' });
console.log('ok: API-Football fixtures and clubs parse into neutral rows');

// the NFL's playoffs (migration 187): a game is a best-of-1 series, and its score by quarter rides along for squares
const side = (homeAway, id, abbr, score, q) => ({ homeAway, score: String(score), team: { id, abbreviation: abbr, displayName: abbr }, linescores: q.map((value) => ({ value })) });
const sb = espnPlayoffPayload([{ label: 'Super Bowl' }], [{ events: [{ id: '401', date: '2026-02-08T23:30Z', status: { type: { state: 'post', name: 'STATUS_FINAL', completed: true } },
  competitions: [{ notes: [{ headline: 'Super Bowl LX' }], competitors: [side('home', '21', 'PHI', 27, [7, 10, 0, 10]), side('away', '12', 'KC', 24, [3, 7, 7, 7])] }] }] }]);
assert.equal(sb.series.length, 1); assert.equal(sb.series[0].best_of, 1); assert.equal(sb.series[0].short, 'SB');
assert.deepEqual(sb.fixtures[0].periods, [{ n: 1, home: 7, away: 3 }, { n: 2, home: 10, away: 7 }, { n: 3, home: 0, away: 7 }, { n: 4, home: 10, away: 7 }]);
assert.equal(sb.fixtures[0].state, 'final');
console.log('ok: the NFL playoffs carry their quarters');

// March Madness (migration 201): 63 slots from the start, each game in the slot its seeds lead to, the regions in Final
// Four order as the competition names them, the First Four left out
const team = (homeAway, id, abbr, seed, score) => ({ homeAway, score: String(score), curatedRank: { current: seed }, team: { id, abbreviation: abbr, displayName: abbr } });
const mm = (id, date, headline, a, b) => ({ id, date, status: { type: { state: 'post', name: 'STATUS_FINAL', completed: true } },
  competitions: [{ notes: [{ headline: `NCAA Men's Basketball Championship - ${headline}` }], competitors: [a, b] }] });
const t = espnTournamentPayload('2027', [{ events: [
  mm('1', '2027-03-16T23:00Z', 'West Region - First Four', team('home', '90', 'FF1', 11, 70), team('away', '91', 'FF2', 11, 60)),
  mm('2', '2027-03-18T16:00Z', 'East Region - 1st Round', team('home', '10', 'EA5', 5, 77), team('away', '11', 'EA12', 12, 70)),
  mm('3', '2027-03-18T19:00Z', 'South Region - 1st Round', team('home', '20', 'SO1', 1, 90), team('away', '21', 'SO16', 16, 50)),
  mm('4', '2027-03-20T19:00Z', 'South Region - 2nd Round', team('home', '20', 'SO1', 1, 80), team('away', '22', 'SO8', 8, 71)),
] }], ['South', 'East', 'West', 'Midwest']);
assert.equal(t.series.length, 63, 'every slot, from the start');
assert.deepEqual(t.regions, ['South', 'East', 'West', 'Midwest']);
const slot = (k) => t.series.find((x) => x.ext_id === k);
assert.equal(slot('2027:R1:East:2').high, '10', 'a 5 v 12 is the third game of its region');
assert.equal(slot('2027:R1:East:2').low, '11');
assert.equal(slot('2027:R1:East:2').sort, 8 + 3, 'East second in Final Four order: after South\'s eight');
assert.equal(slot('2027:R2:South:0').high, '20', 'the 1 v 8 winner meets in the region\'s first second-round slot');
assert.equal(slot('2027:R5:N:0').tbd, true, 'the Final Four waits for its teams');
assert.equal(t.fixtures.length, 3, 'the First Four is left out');
assert.ok(!t.fixtures.some((f) => f.home === '90'));
console.log('ok: March Madness slots by seed and region');
