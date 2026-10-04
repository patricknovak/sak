// Soccer (migration 148): the sport row is consistent with itself, and API-Football's answers become the neutral rows
// soccer_ingest() writes. The sample items follow API-Football v3's documented shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afClub, afFixture, gameweekOf } from '../functions/_shared/soccer.ts';

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
