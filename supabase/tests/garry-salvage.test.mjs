// Garry's salvage (18 October 2026): a post whose rewrite still carries a number the facts don't hold keeps the
// sentences that pass, when most of it survives.
import assert from 'node:assert/strict';
import { salvage } from '../functions/garry/salvage.ts';

// the check: any number other than the ones the facts hold
const known = new Set(['33', '3', '19', '55', '16', '4', '7', '2']);
const check = (b) => { const bad = (b.match(/\d+/g) ?? []).filter((n) => !known.has(n)); return bad.length ? `it says ${bad.join(', ')}` : null; };

const column = 'Patrick vaulted Jason with a 33.3-point night. Jason managed only 19.55 and Bennett sat for 7.2.\n\n'
  + 'Terry leads by 16.4 with his 24th straight win of the week. The race is tight at the top.\n\nDarin is still last.';
const out = salvage(column, check);
assert.ok(out, 'one bad sentence is dropped, the column stays');
assert.ok(!out.includes('24th') && out.includes('Patrick vaulted') && out.includes('The race is tight') && out.includes('Darin is still last'));
assert.equal(check(out), null, 'what is left passes');
assert.ok(out.includes('\n\n'), 'paragraphs are kept');
// most of it wrong: nothing to salvage
assert.equal(salvage('Terry has 24. Jason has 35 and 88. Fine.', check), null);
// nothing wrong at all is returned whole
assert.equal(salvage('Patrick scored 33.3.', check), 'Patrick scored 33.3.');
// a line wholly wrong goes, its neighbours stay
assert.equal(salvage('Patrick scored 33.3 points last night, a good one.\nTerry has 99.\nJason had 19.55 and Bennett 7.2 on the bench.', check),
  'Patrick scored 33.3 points last night, a good one.\nJason had 19.55 and Bennett 7.2 on the bench.');
assert.equal(salvage('', check), null);
console.log("garry salvage: a stray number costs a sentence, not the column ok");

// a climb the table didn't see: only the GMs rank_changes moves up may be said to climb, pass or take first
import { movesCheck } from '../functions/garry/moves.ts';
const sak = [['Patrick', 'The Hip Czechs'], ['Terry', '#What No Way'], ['Jason', 'Jays'], ['Craig', 'Ravens'], ['Trystan', 'Eagle Palace'],
  ['Panagiotis', 'Connor McPanos'], ['Todd', 'Hughes Your Daddy'], ['Darin', 'Hatrick Swayze']].map(([gm, team]) => ({ gm, team }));
const moves = movesCheck(['Patrick up 1 spot, 3rd to 2nd', 'Jason down 1 spot, 2nd to 3rd', 'Craig up 1 spot, 5th to 4th', 'Panagiotis down 1 spot, 4th to 5th'], sak);
// 18 October's dry run: Terry didn't move
assert.match(moves('Terry torched the room for 39.5 and jumped Jason and Patrick in one night to take the top spot.') ?? '', /Terry moved up/);
// the same morning's true lines pass
assert.equal(moves('Patrick vaulted Jason for second with a 33.3-point night while Jason’s Oilers stack managed only 19.55. Craig slipped past Panagiotis into fourth on a 29.75-point night.'), null);
assert.equal(moves('Patrick passed Jason for 2nd while Craig slid past Panagiotis into 4th, so the middle four are now separated by just 12.3.'), null);
assert.equal(moves('Terry’s 39.45 paces the room and leaves him 16.4 clear of Patrick.'), null);
assert.equal(moves('Patrick left Sam Bennett’s 7.2 on the bench for Aho’s minus-0.8, and Panagiotis sat Verhaeghe’s hat-trick 7.6.'), null);
assert.equal(moves('Darin stays last with 220.9, 39.5 back of Todd. Two games tonight and everyone starts at least one.'), null);
// a team's name counts as its GM, and "took" needs where to
assert.match(moves('#What No Way took the top spot overnight.') ?? '', /Terry moved up/);
assert.equal(moves('Terry took a beating from the goalie gods.'), null);
assert.equal(moves('The Hip Czechs climbed into second.'), null);
// with no moves at all, any climb is wrong
assert.match(movesCheck([], sak)('Craig jumped into fourth.') ?? '', /Craig/);
console.log('garry moves: a climb the table did not see is caught ok');
