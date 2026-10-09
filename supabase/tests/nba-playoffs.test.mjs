// The NBA playoffs (migration 220): ESPN's scoreboard and standings become the rows sport_ingest() writes. Tested on
// the 2026 postseason as ESPN had it (nba-2026.json: every game from the play-in to the Finals, trimmed to the fields
// the adapter reads, and the final standings' seeds).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nbaPlayoffPayload, nbaRound } from '../functions/_shared/nbaPlayoffs.ts';

const data = JSON.parse(fs.readFileSync(new URL('./nba-2026.json', import.meta.url), 'utf8'));
assert.equal(nbaRound('NBA Play-In - East - 7th Place vs 8th Place'), null);
assert.equal(nbaRound('East 1st Round - Game 3'), 1);
assert.equal(nbaRound('West Semifinals - Game 1'), 2);
assert.equal(nbaRound('West Finals - Game 2'), 3);
assert.equal(nbaRound('NBA Finals - Game 2'), 4);

const p = nbaPlayoffPayload('2026', [{ events: data.events }], data.standings);
const ab = new Map(p.clubs.map((c) => [c.ext_id, c.short]));
const wins = (s, id) => p.fixtures.filter((f) => f.series === s.ext_id && f.state === 'final'
  && ((f.home === id && f.home_score > f.away_score) || (f.away === id && f.away_score > f.home_score))).length;
const line = (s) => `${s.short} ${ab.get(s.high)} ${wins(s, s.high)}-${wins(s, s.low)} ${ab.get(s.low)}`;
// fifteen best-of-7 series in bracket order, East before West, each round fed by the two above it; the play-in left out
assert.equal(p.series.length, 15);
assert.ok(p.series.every((s) => s.best_of === 7 && !s.tbd));
assert.deepEqual(p.series.sort((a, b) => a.sort - b.sort).map(line), [
  'E R1 DET 4-3 ORL', 'E R1 CLE 4-3 TOR', 'E R1 NY 4-2 ATL', 'E R1 BOS 3-4 PHI',
  'W R1 OKC 4-0 PHX', 'W R1 LAL 4-2 HOU', 'W R1 DEN 2-4 MIN', 'W R1 SA 4-1 POR',
  'E Semis DET 3-4 CLE', 'E Semis NY 4-0 PHI', 'W Semis OKC 4-0 LAL', 'W Semis SA 4-2 MIN',
  'ECF NY 4-0 CLE', 'WCF OKC 3-4 SA', 'Finals SA 1-4 NY']);
assert.equal(p.fixtures.length, 85);
assert.equal(p.clubs.length, 16);
assert.ok(p.fixtures.every((f) => f.game_no >= 1 && f.game_no <= 7 && f.state === 'final' && f.ext_id.startsWith('B')));
// each series starts at its first game
const r1 = p.series.find((s) => s.sort === 1);
assert.equal(r1.starts_at, p.fixtures.filter((f) => f.series === r1.ext_id).map((f) => f.kickoff).sort()[0]);

// before the playoffs: every slot is there, later rounds to be decided, from nothing but the standings
const empty = nbaPlayoffPayload('2027', [], data.standings);
assert.equal(empty.series.length, 15);
assert.ok(empty.series.every((s) => s.tbd && s.high === null) && empty.fixtures.length === 0);

// a live run sends only the days around now: the series those games are in, nothing else (so it never unsets one)
const finalsDay = data.events.filter((e) => /NBA Finals - Game 2/.test(e.competitions[0].notes[0]?.headline ?? ""));
const live = nbaPlayoffPayload('2026', [{ events: finalsDay }], data.standings, false);
assert.deepEqual(live.series.map((s) => s.ext_id), ['nba:2026:R4:F:0']);
assert.equal(live.fixtures[0].game_no, 2);
// standings that don't name the league's teams send nothing, rather than every series as undecided
assert.deepEqual(nbaPlayoffPayload('2026', [{ events: data.events }], { children: [] }), { clubs: [], series: [], fixtures: [] });
console.log('nba playoffs ok');
