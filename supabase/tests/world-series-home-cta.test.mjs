// World Series home CTA: date gate and remaining-games check.
import assert from 'node:assert/strict';
import {
  WS_COMP,
  WS_HOME_CTA_UNTIL,
  worldSeriesHomeCtaOpen,
} from '../../src/lib/worldSeriesHome.ts';

const base = {
  competition: WS_COMP,
  name: 'MLB Postseason 2026',
  sport: 'mlb',
  kinds: ['series'],
  pack: null,
  open_label: 'WS',
  open_round: 4,
  final_label: 'World Series',
  final_round: 4,
  final_starts: '2026-10-23T00:00:00Z',
  next_lock: null,
  stage: 'World Series',
  sheets: [],
  grids: [],
};

{
  const mid = Date.parse('2026-10-26T18:00:00Z');
  assert.equal(worldSeriesHomeCtaOpen(mid, null), false);
  assert.equal(worldSeriesHomeCtaOpen(mid, { ...base, competition: 'nfl' }), false);
  assert.equal(worldSeriesHomeCtaOpen(mid, { ...base, next_lock: '2026-10-27T00:00:00Z' }), true);
  assert.equal(worldSeriesHomeCtaOpen(mid, {
    ...base,
    sheets: [{ id: 1, kickoff: '2026-10-28T00:00:00Z', game_no: 4, label: 'WS', home: 'A', away: 'B' }],
  }), true);
  assert.equal(worldSeriesHomeCtaOpen(mid, base), false, 'no remaining games');
}

{
  const after = WS_HOME_CTA_UNTIL + 1000;
  assert.equal(worldSeriesHomeCtaOpen(after, { ...base, next_lock: '2026-11-10T00:00:00Z' }), false, 'past Nov 7');
}

console.log('world-series-home-cta tests passed');
