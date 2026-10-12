// packWhen: the create page's "first call closes …" must follow the pack's real next_close calendar day,
// the same way questions say "Closes Wed, Oct 14" — not a raw 24-hour floor that called Wed "tomorrow" on Monday.
import assert from 'node:assert/strict';
import { packWhen } from '../../src/lib/packs.ts';

const pack = (next_close, last_close = next_close) => ({
  slug: 'love-is-blind-s11', name: 'Love Is Blind', questions: 8, color: '#fb7185', icon: '💌', blurb: null,
  next_close, last_close,
});

// premiere closes Wed 14 Oct 2026 07:00 UTC (3 am ET)
const close = '2026-10-14T07:00:00Z';

{
  // Monday evening ET: two Eastern calendar days out → the weekday date, not "tomorrow"
  const mon = new Date('2026-10-12T21:00:00-04:00').getTime();
  const w = packWhen(pack(close), mon);
  assert.equal(w.text, 'the first call closes Wed, Oct 14');
  assert.equal(w.soon, true);
}

{
  // Tuesday ET → tomorrow
  const tue = new Date('2026-10-13T15:00:00-04:00').getTime();
  const w = packWhen(pack(close), tue);
  assert.equal(w.text, 'the first call closes tomorrow');
}

{
  // Wednesday ET before the 3am drop → today
  const wed = new Date('2026-10-14T01:00:00-04:00').getTime();
  const w = packWhen(pack(close), wed);
  assert.equal(w.text, 'the first call closes today');
}

{
  // more than a fortnight out → last month
  const early = new Date('2026-09-01T12:00:00-04:00').getTime();
  const w = packWhen(pack('2026-11-04T08:00:00Z', '2026-11-11T08:00:00Z'), early);
  assert.match(w.text, /runs to November/i);
  assert.equal(w.soon, false);
}

console.log('packWhen calendar-day tests passed');
