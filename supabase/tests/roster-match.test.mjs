// rosterMatch: another site's players matched to ours by name (imports' rosters, migration 256). A name matches whole
// without accents or punctuation; a shortened first name matches by last name, first initial and club; a name two of
// ours share goes to the one on the club named; a name we don't have stays unmatched rather than guessed.
import assert from 'node:assert/strict';
import { normName, playerMatcher } from '../../src/lib/rosterMatch.ts';

const p = (id, name, nhl_team) => [id, { id, name, nhl_team, first: null, last_name: null, pos: 'C', elig: ['C'], num: null, headshot: null, last_fp: 0, proj: 0, rank: null, status: 'active', last_stats: null, injury_note: null, injury_status: null, injury_date: null }];
const players = new Map([
  p(1, 'Connor McDavid', 'EDM'), p(2, 'Leon Draisaitl', 'EDM'), p(3, 'Alexander Nylander', 'CBJ'), p(4, 'Sebastian Aho', 'CAR'), p(5, 'Sebastian Aho', 'NYI'),
  p(6, 'Jean-Gabriel Pageau', 'NYI'), p(7, 'Tomáš Hertl', 'VGK'), p(8, 'Zach Hyman', 'EDM'), p(9, 'Zach Werenski', 'CBJ'),
]);
const match = playerMatcher(players);

assert.equal(normName('Tomáš Hertl'), 'tomas hertl');
assert.equal(normName('Jean-Gabriel  Pageau'), 'jean gabriel pageau');

// whole names, however the other site spells them
assert.equal(match('Connor McDavid', 'EDM'), 1);
assert.equal(match('Tomas Hertl', 'VGK'), 7, 'accents fall away');
assert.equal(match('Jean Gabriel Pageau', 'NYI'), 6, 'hyphens fall away');
assert.equal(match('connor mcdavid', null), 1, 'no club needed when the name is ours whole');

// a shortened first name: last name, first initial and club
assert.equal(match('Alex Nylander', 'CBJ'), 3);
assert.equal(match('Alex Nylander', 'EDM'), null, 'the club has to agree for a short match');

// two of ours share a name: the club decides, and without a club the first stands
assert.equal(match('Sebastian Aho', 'NYI'), 5);
assert.equal(match('Sebastian Aho', 'CAR'), 4);
assert.equal(match('Sebastian Aho', null), 4);

// two of ours share a last name and an initial on different clubs: the club keeps them apart
assert.equal(match('Z. Hyman', 'EDM'), 8);
assert.equal(match('Z. Werenski', 'CBJ'), 9);

// unknown stays unknown
assert.equal(match('Zed Prospect', 'TOR'), null);
assert.equal(match('', null), null);

console.log('roster match tests passed');
