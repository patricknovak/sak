// Garry's wrap from worked-out stories (19 November 2026): the night of 17 November as the league had it, the stories
// beats.ts tells from it, and the real wrap of that night held to them. Plus the gag cooldown and the quote check.
import assert from 'node:assert/strict';
import { buildBeats, pickBeats, scoreBeats, beatsCheck, plainWrap } from '../functions/garry/beats.ts';
import { rested, quoteCheck, CRUDE } from '../functions/garry/voice.ts';

// season totals after the night and the night's points (SaK, 17 November 2026)
const rows = [
  ['Terry', 806.35, 18.7], ['Jason', 758.75, 29.25], ['Patrick', 735.6, 20.8], ['Todd', 727.0, 20.65],
  ['Craig', 687.35, 21.4], ['Panagiotis', 670.5, 7.25], ['Darin', 653.55, 31.7], ['Trystan', 649.35, 25.55],
].map(([gm, points, tonight], i) => ({ gm, points, tonight, now: i + 1 }));
const starters = [
  { gm: 'Darin', player: 'Matthew Schaefer', fpts: 8.5, line: '3 G, 9 SOG' }, { gm: 'Darin', player: 'Joel Eriksson Ek', fpts: 7.6, line: '1 G, 3 A' },
  { gm: 'Craig', player: 'Cutter Gauthier', fpts: 8.1, line: '3 G, 1 A' }, { gm: 'Darin', player: 'Sergei Bobrovsky', fpts: -2.05, line: 'L, 19 SV, 6 GA' },
  { gm: 'Jason', player: 'Matt Boldy', fpts: 8, line: '2 G, 1 A' }, { gm: 'Terry', player: 'Mark Stone', fpts: -0.4, line: '-1' },
];
const bench = [{ gm: 'Terry', player: 'Vasily Podkolzin', fpts: 6.2, over: 'Mark Stone', over_fpts: -0.4, cost: 6.6 }];
const all = buildBeats({ rows, starters, bench, week: [], news: [], next: null, bonus: { gm: 'Darin', coins: 25 }, pointsTable: true });
const told = pickBeats(all, 6);

// the night's best score is always told: the real wrap of 17 November never mentioned Darin's 31.7
assert.equal(told.find((b) => b.kind === 'best_night')?.gms[0], 'Darin');
assert.ok(told.some((b) => b.kind === 'climb' && b.text.startsWith('Darin passed Trystan and moved from 8th to 7th')));
// a gap is told the way it went
assert.ok(told.some((b) => b.text === "Jason (2nd) cut Terry's lead at the top from 58.2 to 47.6, by 10.6" && b.dir === 'closed'));
assert.ok(told.some((b) => b.text.startsWith("Craig's (5th) gap over Panagiotis (6th) grew from 2.7 to 16.9") && b.dir === 'grew'));
// the plain wrap leads with the best night
assert.ok(plainWrap('Final horn.', told).startsWith('Final horn. Darin had the best night in the league, 31.7 points'));

const people = rows.map((r) => ({ gm: r.gm, team: `${r.gm} FC` }));
const roster = [...starters.map((s) => s.player), 'Vasily Podkolzin', 'Connor Bedard', 'Connor McDavid', 'Alex Ovechkin'];
const check = beatsCheck([...told, ...scoreBeats(rows)], people, roster);

// what the real wrap got wrong, caught
assert.match(check('Jason’s 29.8 trimmed Terry’s lead to 47.1.'), /29\.8/);
assert.match(check('Bedard’s shoulder keeps Darin guessing.'), /Connor Bedard/);
assert.match(check('McDavid’s 23-game streak rolls for Trystan.'), /23/);
// a number moved onto another GM's story (the 16 November wrap: "Todd ... trim Jason's gap by 3.3")
assert.match(check("Todd's 20.7 trimmed Jason's lead by 10.6."), /10\.6 beside/);
// a gap that grew, called closed (the 16 November wrap: "widened his cushion" on a gap that shrank)
assert.match(check('Panagiotis trimmed the gap to Craig to 16.9.'), /closed/);
// and what it may say
assert.equal(check("Darin dropped 31.7 on the league, the best night of anyone, with Schaefer's hat trick worth 8.5, and passed Trystan for seventh."), null);
assert.equal(check("Jason cut Terry's lead at the top from 58.2 to 47.6 with a 29.3-point night."), null);
assert.equal(check("Jason cut Terry's lead to 47.6, while Todd posted 20.7."), null);
assert.equal(check('@Terry, Podkolzin’s 6.2 rotting on the bench cost you 6.6 versus Stone.'), null);
assert.equal(check("Craig's gap over Panagiotis grew to 16.9."), null);

// the gag that's in his last posts rests; the others stay
const names = ['Garry', 'Terry', 'Jason', 'Craig'];
const mem = ["[Terry] (running gag) Claims to be Garry's daddy who lets others get close then crushes their dreams", '[Jason] Drafted all Oilers roster, calling it their cup year'];
const kept = rested(mem, ['Terry’s already calling this the trade that keeps the rest of us “close before he crushes our dreams.”'], names);
assert.deepEqual(kept, [mem[1]]);

// quotes: said, and by whoever the sentence says
const q = quoteCheck(['Terry: you are all dust', '[Patrick] said "this trade is a heist"'], ['Terry', 'Patrick', 'Jason']);
assert.equal(q('Terry said "you are all dust" again.'), null);
assert.match(q('Jason said "you are all dust" again.'), /Jason, who didn't say it/);
assert.match(q('Terry is calling it "the trade that keeps us close before he crushes our dreams".'), /nobody said that/);
assert.ok(CRUDE.test('your trash talk are like assholes') && !CRUDE.test('Dickinson scored twice'));

console.log('garry beats tests passed');
