// The fans' voice (migrations 337 and 338): the kinds of post, each sport's topics and the calls the site offers
// (src/lib/fanLists.ts) are the ones the database takes (fan_posts' check, _fan_topic_ok, _fan_call_ok), and every bigger
// question the analysis asks (src/lib/fanOffice.ts and src/lib/fanSport.ts questions()) has a call of its own. A list
// that changes in one place and not the other would offer fans an answer the database refuses, or leave a question
// without the fans' verdict.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CLUB_CALLS_BY_SPORT, KINDS, LEAGUE_CALLS_BY_SPORT, QUESTION_CALLS, TOPICS_BY_SPORT, VERDICTS } from '../../src/lib/fanLists.ts';

const sql337 = readFileSync(new URL('../migrations/20261005000337_fan_voice.sql', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../migrations/20261005000338_fan_leagues.sql', import.meta.url), 'utf8');
const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const SPORTS = Object.keys(CLUB_CALLS_BY_SPORT);

assert.deepEqual(KINDS.map((k) => k.key), quoted(sql337.match(/kind text not null check \(kind in \(([^)]*)\)\)/)[1]), 'the kinds of post');
assert.deepEqual(quoted(sql.match(/sport text not null check \(sport in \(([^)]*)\)\)/)[1]).sort(), [...SPORTS].sort(), 'the sports');

// each sport's topics
const topicFn = sql.match(/function public\._fan_topic_ok[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
const topics = {};
for (const m of topicFn.matchAll(/when '(\w+)' then p_topic = any \(array\[([\s\S]*?)\]\)/g)) topics[m[1]] = quoted(m[2]);
assert.deepEqual(Object.keys(topics).sort(), [...SPORTS].sort(), 'a list of topics for every sport');
for (const s of SPORTS) assert.deepEqual(TOPICS_BY_SPORT[s].map((t) => t[0]), topics[s], `the ${s} topics`);

// the calls: comments out, and the empty strings ('') out so the quotes pair up
const body = sql.match(/function public\._fan_call_ok[\s\S]*?\$\$([\s\S]*?)\$\$/)[1].replace(/--[^\n]*/g, '').replace(/''/g, '');
// which sports a clause is for: one ('s = '), all but one ('s <> '), a few ('s in'), or every sport
const sportsOf = (cond) => {
  let m;
  if ((m = /s = '(\w+)'/.exec(cond))) return [m[1]];
  if ((m = /s <> '(\w+)'/.exec(cond))) return SPORTS.filter((x) => x !== m[1]);
  if ((m = /s in \(([^)]*)\)/.exec(cond))) return quoted(m[1]);
  return SPORTS;
};
// the questions a part of the check takes, by sport, and the fixed answers of those that have them
function accepted(part) {
  const keys = Object.fromEntries(SPORTS.map((s) => [s, new Set()]));
  const fixed = Object.fromEntries(SPORTS.map((s) => [s, {}]));
  for (const m of part.matchAll(/when ((?:s (?:= '\w+'|<> '\w+'|in \([^)]*\)) and )?)p_topic (?:= '([^']+)'|in \(([^)]*)\)) then (p_choice in \(([^)]*)\))?/g)) {
    for (const s of sportsOf(m[1])) for (const t of m[2] ? [m[2]] : quoted(m[3])) {
      keys[s].add(t);
      if (m[4]) fixed[s][t] = quoted(m[5]);
    }
  }
  return { keys, fixed };
}
const [, wholePart, clubPart] = body.match(/if whole then([\s\S]*?)end if;([\s\S]*)$/);
const club = accepted(clubPart), whole = accepted(wholePart);
for (const s of SPORTS) {
  assert.deepEqual([...club.keys[s]].sort(), CLUB_CALLS_BY_SPORT[s].map((d) => d.key).sort(), `the ${s} calls on a club`);
  assert.deepEqual([...whole.keys[s]].sort(), LEAGUE_CALLS_BY_SPORT[s].map((d) => d.key).sort(), `the ${s} calls on the league`);
  for (const d of CLUB_CALLS_BY_SPORT[s].filter((x) => x.kind === 'choice')) assert.deepEqual(d.choices.map((c) => c[0]), club.fixed[s][d.key], `the ${s} answers to ${d.key}`);
  for (const d of CLUB_CALLS_BY_SPORT[s].filter((x) => x.kind !== 'choice')) assert.equal(club.fixed[s][d.key], undefined, `${s} ${d.key} names a player or a club`);
}

// the bigger questions, every sport: keep, adjust or rethink
const q = body.match(/if p_topic in \(([^)]*)\) then\s*return p_choice in \(([^)]*)\)/);
assert.deepEqual(quoted(q[1]).sort(), Object.values(QUESTION_CALLS).sort(), 'the bigger questions');
assert.deepEqual(quoted(q[2]), VERDICTS.map((v) => v[0]), 'the verdicts');

// every bigger question the analysis asks has the fans' verdict beside it
for (const [file, least] of [['fanOffice.ts', 9], ['fanSport.ts', 6]]) {
  const src = readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8');
  const areas = [...src.matchAll(/qs\.push\(\{ area: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(areas.length >= least, `${file} asks its bigger questions`);
  for (const a of areas) assert.ok(QUESTION_CALLS[a], `the fans can answer "${a}" (${file})`);
}

console.log('fan voice: the site and the database agree, in every sport');
