// The site's compiled NHL description (src/lib/sport.ts) is the same as the database's `sports` row (migration 135),
// so a page reading it before the row loads and a page reading the row agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NHL, stateOf, groupOf, isLive, isFinal, hasStarted, calledOff, notStarted, extraTime, periodShort } from '../../src/lib/sport.ts';
import { STARTING, slotOk } from '../functions/_shared/lineup.ts';

const sql = fs.readFileSync(new URL('../migrations/20261005000135_sports.sql', import.meta.url), 'utf8');
const row = JSON.parse(sql.match(/\$sport\$([\s\S]*?)\$sport\$/)[1]);
// words added to the row later (migration 144: Garry's voice in the sport's words)
const words = fs.readFileSync(new URL('../migrations/20261005000144_sport_voice_words.sql', import.meta.url), 'utf8');
row.words = { ...row.words, ...JSON.parse(words.match(/\$words\$([\s\S]*?)\$words\$/)[1]) };
assert.deepEqual(NHL, row, 'src/lib/sport.ts and the sports row for the NHL differ');
console.log('ok: the compiled NHL matches the sports row');

assert.equal(stateOf(NHL, 'OFF'), 'final'); assert.equal(stateOf(NHL, 'CRIT'), 'live'); assert.equal(stateOf(NHL, 'PPD'), 'postponed');
assert.equal(stateOf(NHL, 'FUT'), 'scheduled');
assert.equal(groupOf(NHL, 'G'), 'G'); assert.equal(groupOf(NHL, 'LW'), 'S');
// every slot accepts only known positions, and every stat names a known group
const pos = new Set(NHL.positions.map((p) => p.key)), groups = new Set(NHL.groups.map((g) => g.key));
for (const s of NHL.slots) for (const a of s.accepts) assert.ok(pos.has(a), `slot ${s.key} accepts unknown ${a}`);
for (const s of NHL.stats) assert.ok(groups.has(s.group), `stat ${s.key} in unknown group ${s.group}`);
console.log('ok: states, groups, slots and stats are consistent');
// the slots are the lineup engine's, in its order, and accept exactly whom slotOk accepts
assert.deepEqual(NHL.slots.map((s) => s.key), STARTING, 'slots differ from the engine\'s starting slots');
for (const s of NHL.slots) for (const p of NHL.positions) {
  assert.equal(s.accepts.includes(p.key), slotOk({ pos: p.key, elig: [p.key] }, s.key), `slot ${s.key} and position ${p.key} disagree with slotOk`);
}
console.log('ok: the slots agree with the lineup engine');
// the game-state helpers say exactly what the pages' hockey lists said, an unknown state included (it counts as under way)
for (const st of ['FUT', 'PRE', 'LIVE', 'CRIT', 'OFF', 'FINAL', 'PPD', 'CNCL', 'WHAT']) {
  assert.equal(isLive(NHL, st), ['LIVE', 'CRIT'].includes(st), `live ${st}`);
  assert.equal(isFinal(NHL, st), ['OFF', 'FINAL'].includes(st), `final ${st}`);
  assert.equal(hasStarted(NHL, st), ['LIVE', 'CRIT', 'OFF', 'FINAL'].includes(st), `started ${st}`);
  assert.equal(calledOff(NHL, st), ['PPD', 'CNCL'].includes(st), `called off ${st}`);
  assert.equal(notStarted(NHL, st), ['FUT', 'PRE'].includes(st), `not started ${st}`);
}
assert.equal(periodShort(NHL, '2'), '2nd'); assert.equal(periodShort(NHL, 'OT'), 'OT'); assert.equal(periodShort(NHL, 'SO'), 'SO');
assert.equal(periodShort(NHL, null), ''); assert.equal(periodShort(NHL, '5'), '5');
assert.ok(extraTime('OT') && extraTime('SO') && !extraTime('3') && !extraTime(null) && !extraTime(''));
console.log('ok: game states and periods read as the pages read them');
console.log('sport tests passed');
