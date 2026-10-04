// node --experimental-strip-types supabase/tests/injury.test.mjs
// The injury report as nhl-sync stores it: the timeline (expected return, body part, list) and a readable note,
// from entries shaped like ESPN's (October 2026). No network.
import assert from 'node:assert/strict';
import { readInjury } from '../functions/_shared/nhl.ts';

// a bare entry: the comments are only codes, so there is no note and no write-up
const bare = readInjury({ status: 'Injured Reserve', shortComment: 'ir', longComment: 'ir', date: '2026-09-30T15:57Z',
  type: { abbreviation: 'IR' }, details: { fantasyStatus: { abbreviation: 'IR' }, type: 'Lower Body', returnDate: '2026-10-07' } });
assert.deepEqual(bare, { injury_status: 'Injured Reserve', injury_note: null, injury_date: '2026-09-30T15:57Z', injury_return: '2026-10-07',
  injury_part: 'Lower Body', injury_list: 'IR', injury_detail: null });

// a full entry: side and surgery read into the part, long-term IR kept, the write-up kept beside the short note
const full = readInjury({ status: 'Injured Reserve', shortComment: 'Barkov (knee) was placed on long-term injured reserve Monday.',
  longComment: 'Barkov tore his ACL in training camp. He is expected to miss most of the season.', date: '2026-09-29T00:00Z',
  details: { fantasyStatus: { abbreviation: 'IR-LT' }, type: 'Knee', side: 'Left', detail: 'Surgery', returnDate: '2026-10-27' } });
assert.equal(full.injury_part, 'Knee, left, surgery');
assert.equal(full.injury_list, 'IR-LT');
assert.equal(full.injury_return, '2026-10-27');
assert.equal(full.injury_note, 'Barkov (knee) was placed on long-term injured reserve Monday.');
assert.match(full.injury_detail, /tore his ACL/);

// only a write-up: its first sentence becomes the note; "Not Specified" and "Undisclosed" say nothing
const writeup = readInjury({ status: 'Day-To-Day', shortComment: 'day-to-day', longComment: 'Hyman will miss at least six games. He is skating on his own.',
  details: { fantasyStatus: { abbreviation: 'Day-To-Day' }, type: 'Undisclosed', detail: 'Not Specified', side: 'Not Specified', returnDate: 'soon' } });
assert.equal(writeup.injury_note, 'Hyman will miss at least six games.');
assert.equal(writeup.injury_part, null);
assert.equal(writeup.injury_return, null, 'a return date that is not a date is dropped');

// a suspension has a return date but no body part
const susp = readInjury({ status: 'Suspension', shortComment: 'out', details: { type: 'Suspension', returnDate: '2026-10-13', fantasyStatus: { abbreviation: 'OUT' } } });
assert.equal(susp.injury_part, null);
assert.equal(susp.injury_return, '2026-10-13');

// an entry with no details at all still reads
const none = readInjury({ status: 'Out', type: { abbreviation: 'O' } });
assert.equal(none.injury_list, 'O');
assert.equal(none.injury_return, null);
console.log('injury report tests passed');
