// The fans' voice (migration 337): the kinds of post, the topics and the calls the site offers (src/lib/fanLists.ts)
// are the ones the database takes (fan_posts' check, _fan_topic_ok, _fan_call_ok), and every bigger question the
// analysis asks (src/lib/fanOffice.ts questions()) has a call of its own. A list that changes in one place and not the
// other would offer fans an answer the database refuses, or leave a question without the fans' verdict.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CLUB_CALLS, KINDS, NHL_CALLS, QUESTION_CALLS, TOPICS, VERDICTS } from '../../src/lib/fanLists.ts';

const sql = readFileSync(new URL('../migrations/20261005000337_fan_voice.sql', import.meta.url), 'utf8');
const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

assert.deepEqual(KINDS.map((k) => k.key), quoted(sql.match(/kind text not null check \(kind in \(([^)]*)\)\)/)[1]), 'the kinds of post');
assert.deepEqual(TOPICS.map((t) => t[0]), quoted(sql.match(/function public\._fan_topic_ok[\s\S]*?array\[([\s\S]*?)\]/)[1]), 'the topics');

// comments out, and the empty strings ('') out so the quotes pair up
const body = sql.match(/function public\._fan_call_ok[\s\S]*?\$\$([\s\S]*?)\$\$/)[1].replace(/--[^\n]*/g, '').replace(/''/g, '');
const fixed = {};
for (const m of body.matchAll(/when p_topic (?:= '([^']+)'|in \(([^)]*)\))\s*then p_choice in \(([^)]*)\)/g)) {
  for (const t of m[1] ? [m[1]] : quoted(m[2])) fixed[t] = quoted(m[3]);
}
for (const d of CLUB_CALLS.filter((x) => x.kind === 'choice')) assert.deepEqual(d.choices.map((c) => c[0]), fixed[d.key], `the answers to ${d.key}`);
for (const k of Object.values(QUESTION_CALLS)) assert.deepEqual(VERDICTS.map((v) => v[0]), fixed[k], `the verdicts on ${k}`);
const named = new Set(quoted(body));
for (const d of [...CLUB_CALLS, ...NHL_CALLS]) assert.ok(named.has(d.key), `the database knows the call ${d.key}`);
assert.deepEqual([...new Set(quoted(body).filter((x) => x.startsWith('q-')))].sort(), Object.values(QUESTION_CALLS).sort(), 'the bigger questions');

// every bigger question the analysis asks has the fans' verdict beside it
const office = readFileSync(new URL('../../src/lib/fanOffice.ts', import.meta.url), 'utf8');
const areas = [...office.matchAll(/qs\.push\(\{ area: '([^']+)'/g)].map((m) => m[1]);
assert.ok(areas.length >= 9, 'the analysis asks its bigger questions');
for (const a of areas) assert.ok(QUESTION_CALLS[a], `the fans can answer "${a}"`);

console.log('fan voice: the site and the database agree');
