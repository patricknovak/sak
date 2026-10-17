// The trade builder's roster count (src/lib/tradeCount.ts) against the database's (_trade_active_after): a hurt player
// coming in from another team's IR takes an IR slot the deal leaves open, so the builder asks for no drop the
// database would refuse. The cases are the 17 October offer between two full rosters (24 active, 2 on IR, 2 IR slots).
import assert from 'node:assert/strict';
import { activeAfter } from '../../src/lib/tradeCount.ts';

const P = (id, injury_status = null) => ({ id, injury_status });
const mine = Array.from({ length: 26 }, (_, i) => P(i + 1, i >= 24 ? 'Injured Reserve' : null));
const ir = new Set([25, 26]);
const irAny = new Set([25, 26, 102, 104]);
const deal = (out, inn) => activeAfter({ before: mine, after: [...mine.filter((p) => !out.includes(p.id)), ...inn], ir, irCap: 2, irAny });

// two active and one from IR out, one healthy and one hurt in: the hurt one takes the IR slot left open (live: 23)
assert.equal(deal([1, 2, 26], [P(101), P(102, 'Injured Reserve')]), 23);
// a third player in: still 24, no drop (the old count said 25 and asked for one)
assert.equal(deal([1, 2, 26], [P(101), P(102, 'Injured Reserve'), P(103)]), 24);
// no IR slot opened: the hurt one counts
assert.equal(deal([1, 2], [P(101), P(102, 'Injured Reserve'), P(103)]), 25);
// a suspension can't go on IR
assert.equal(deal([1, 26], [P(104, 'Suspended')]), 24);
// a hurt player not on anyone's IR counts like anyone else
assert.equal(deal([1, 26], [P(105, 'Day-To-Day')]), 24);
// nothing changes hands
assert.equal(deal([], []), 24);
console.log('trade count: the database\'s roster count ok');
