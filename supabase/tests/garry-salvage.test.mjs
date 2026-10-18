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
