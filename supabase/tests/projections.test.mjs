// The projection model counts this season's games (24 October 2026): a hot start lifts a projection, a cold one
// lowers it, a rookie is projected from his first games, and a goalie's share of the crease reads this season's starts
// out of his club's games so far.
import assert from 'node:assert/strict';
import { projectAll } from '../functions/_shared/projections.ts';

const scoring = { skater: { g: 2, a: 1, sog: 0.2 }, goalie: { w: 3, sv: 0.2, ga: -1, sho: 3 } };
const latest = 20252026, current = 20262027;
const sk = (season, gp, g, a, sog, team = 'TOR') => ({ season, gp, g, a, pm: 0, pim: 0, ppg: 0, ppp: 0, shp: 0, gwg: 0, sog, hit: 0, blk: 0, fow: 0, fol: 0, toi: 1100, pptoi: 0, team });
const history = [sk(20252026, 82, 30, 40, 250), sk(20242025, 82, 28, 38, 240), sk(20232024, 80, 26, 36, 230)];
const player = { id: 1, pos: 'C', birth: '1999-01-01', nhl_team: 'TOR', injury_status: null };
// a teammate who has dressed for all ten of the club's games
const mate = { id: 9, pos: 'D', birth: '1998-01-01', nhl_team: 'TOR', injury_status: null };
const mateRows = [sk(20252026, 82, 5, 20, 120), sk(current, 10, 1, 3, 15)];
const run = (rows) => projectAll([player, mate], new Map([[1, rows], [9, mateRows]]), new Map(), scoring, latest).find((x) => x.id === 1);

const base = run(history);
const hot = run([sk(current, 10, 10, 10, 45), ...history]);
const cold = run([sk(current, 10, 0, 2, 20), ...history]);
assert.ok(hot.meta.fpg > base.meta.fpg * 1.05, `a hot start lifts the projection (${base.meta.fpg} -> ${hot.meta.fpg})`);
assert.ok(cold.meta.fpg < base.meta.fpg * 0.95, `a cold start lowers it (${base.meta.fpg} -> ${cold.meta.fpg})`);
assert.ok(hot.meta.fpg < 3.5, 'ten games don\'t rewrite a career');
assert.match(hot.meta.factors[0].text, /^This season: .* in 10 games/, 'the factors lead with this season so far');
assert.equal(hot.meta.factors[0].tone, 'good');
assert.equal(hot.meta.hist.length, 3, 'the history stays the last three full seasons');
assert.equal(hot.meta.model, 'sak-2');

const rookie = projectAll([{ ...player, id: 2 }, mate], new Map([[2, [sk(current, 8, 3, 4, 20)]], [9, mateRows]]), new Map(), scoring, latest).find((x) => x.id === 2);
assert.ok(rookie && rookie.meta.fpg > 0, 'a rookie is projected from his first games');
assert.match(rookie.meta.factors[0].text, /from these games alone/);

// goalies: ten club games, he started nine of them this season after a backup's year
const gl = (season, gp, gs, w, sa, sv) => ({ season, gp, gs, w, l: gs - w, otl: 0, ga: sa - sv, sa, sv, sho: 0, team: 'TOR' });
const goalie = { id: 3, pos: 'G', birth: '1996-01-01', nhl_team: 'TOR', injury_status: null };
const ghist = [gl(20252026, 30, 28, 14, 800, 725), gl(20242025, 28, 26, 12, 750, 680)];
const gBase = projectAll([goalie, mate], new Map([[9, mateRows]]), new Map([[3, ghist]]), scoring, latest).find((x) => x.id === 3);
const gNow = projectAll([goalie, mate], new Map([[9, mateRows]]), new Map([[3, [gl(current, 9, 9, 6, 260, 240), ...ghist]]]), scoring, latest).find((x) => x.id === 3);
assert.ok(gNow.gp > gBase.gp + 5, `the crease this season moves his starts (${gBase.gp} -> ${gNow.gp})`);

console.log('projections: this season counts ok');
