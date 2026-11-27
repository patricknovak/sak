// The byte ranges the marketing site's films are served in (worker/range.ts, used by worker/landing.ts): the ranges a
// phone's player asks for, the ones a server may ignore, and the ones it must refuse.
import assert from 'node:assert/strict';
import { rangeOf } from '../../worker/range.ts';

const size = 1000;
// Safari's first question before it plays anything
assert.deepEqual(rangeOf('bytes=0-1', size), { start: 0, end: 1 });
assert.deepEqual(rangeOf('bytes=0-', size), { start: 0, end: 999 }, 'an open end runs to the last byte');
assert.deepEqual(rangeOf('bytes=200-299', size), { start: 200, end: 299 });
assert.deepEqual(rangeOf('bytes=900-5000', size), { start: 900, end: 999 }, 'an end past the file is clamped');
assert.deepEqual(rangeOf('bytes=-100', size), { start: 900, end: 999 }, 'a suffix is the last n bytes');
assert.deepEqual(rangeOf('bytes=-5000', size), { start: 0, end: 999 }, 'a suffix longer than the file is the file');
assert.deepEqual(rangeOf(' bytes=999-999 ', size), { start: 999, end: 999 });

// refused: nothing of the file is in the range
assert.equal(rangeOf('bytes=1000-', size), 'unsatisfiable');
assert.equal(rangeOf('bytes=5000-6000', size), 'unsatisfiable');
assert.equal(rangeOf('bytes=-0', size), 'unsatisfiable');

// ignored: the whole file goes back with a 200
for (const h of [null, '', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b', 'bytes=1.5-3']) {
  assert.equal(rangeOf(h, size), null, `ignored: ${h}`);
}
assert.equal(rangeOf('bytes=0-1', 0), null, 'an empty file has no ranges');
assert.equal(rangeOf('bytes=0-1', NaN), null);

console.log('range tests passed');
