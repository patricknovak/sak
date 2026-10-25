// The other leagues' fan zones (src/lib/fanSport.ts) on made-up leagues of every sport: the numbers read by name, every
// measure ranked with the low ones turned round, the season simulated to an end that adds up (one champion a season, the
// NFL's seven seeds a conference, the NBA's play-in, the Premier League's twenty places), the luck read, the schedule
// ahead, and the front office's bigger questions, each one the fans can answer, with needs the database takes.
import assert from 'node:assert/strict';
import { MEASURES, SPORTS, ahead, assess, form, luck, outlook, phi, soccerProbs, statsOf, strengths, table } from '../../src/lib/fanSport.ts';
import { CLUB_CALLS_BY_SPORT, QUESTION_CALLS } from '../../src/lib/fanLists.ts';

// a season: every club plays every other twice (home and away), the first `played` rounds done, the better club (a
// lower index) winning by its margin
function league(sport, n, opts = {}) {
  const codes = Array.from({ length: n }, (_, i) => `C${String.fromCharCode(65 + i)}${String.fromCharCode(65 + (i % 7))}`);
  const confs = opts.confs ?? 1, divs = opts.divs ?? 1;
  const games = [];
  const day = (k) => new Date(Date.UTC(2026, 8, 1) + k * 86_400_000).toISOString();
  let k = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b && (sport !== 'football' || (b - a + n) % n <= 8)) games.push([a, b]);
  games.sort((x, y) => ((x[0] * 7 + x[1] * 13) % 97) - ((y[0] * 7 + y[1] * 13) % 97));
  const rows = codes.map((code, i) => ({ code, id: String(i + 1), name: `Club ${code}`, short: code, nick: null, logo: null, logoDark: null, color: null, alt: null,
    conf: confs > 1 ? `K${i % confs}` : null, div: divs > 1 ? `K${i % confs} D${Math.floor(i / confs) % divs}` : null, gp: 0, w: 0, l: 0, d: 0, pf: 0, pa: 0, pts: sport === 'soccer' ? 0 : null,
    deducted: null, seed: null, streak: null, home: null, road: null, vsDiv: null, vsConf: null, last10: null, note: null }));
  const played = Math.round(games.length * (opts.share ?? 0.3));
  const out = games.map(([h, a], j) => {
    const at = day(k++);
    // the market prices some of the games ahead, every one of the best club's
    const priced = j % 5 === 0 || h === 0 || a === 0;
    if (j >= played) return [at, codes[h], codes[a], null, null, null, priced ? 0.6 : null, priced ? 0.4 : null, null, priced ? -3 : null];
    const edge = (a - h) * (sport === 'soccer' ? 0.2 : 1);
    const hs = sport === 'soccer' ? Math.max(0, Math.round(1.4 + edge / 2)) : Math.round(100 + edge * 2), as = sport === 'soccer' ? Math.max(0, Math.round(1.1 - edge / 2)) : Math.round(97 - edge * 2);
    for (const [i, us, them] of [[h, hs, as], [a, as, hs]]) {
      const r = rows[i]; r.gp++; r.pf += us; r.pa += them;
      if (us > them) r.w++; else if (us < them) r.l++; else r.d++;
      if (sport === 'soccer') r.pts += us > them ? 3 : us === them ? 1 : 0;
    }
    return [at, codes[h], codes[a], hs, as, null, null, null, null, null];
  });
  // a few numbers: the better clubs better at everything
  const keys = ['offensive.points', 'offensive.fieldGoalsAttempted', 'offensive.fieldGoalsMade', 'offensive.threePointFieldGoalsMade', 'offensive.threePointFieldGoalsAttempted',
    'offensive.freeThrowsAttempted', 'offensive.offensiveRebounds', 'offensive.turnovers', 'offensive.assists', 'defensive.defensiveRebounds', 'defensive.blocks',
    'passing.netTotalYards', 'passing.passingAttempts', 'passing.sacks', 'rushing.rushingAttempts', 'passing.QBRating', 'passing.netYardsPerPassAttempt',
    'offensive.avgExpectedGoals', 'goalKeeping.avgExpectedGoalsConceded', 'offensive.totalShots', 'goalKeeping.saves', 'goalKeeping.goalsConceded', 'general.appearances'];
  const own = {}, opp = {};
  rows.forEach((r, i) => {
    const q = 1 - i / n;
    own[r.code] = [r.pf, 85 * r.gp, (38 + 6 * q) * r.gp, 12 * r.gp, 35 * r.gp, 22 * r.gp, 10 * r.gp, (16 - 3 * q) * r.gp, 25 * r.gp, 33 * r.gp, 5 * r.gp,
      (300 + 80 * q) * r.gp, 34 * r.gp, (3 - q) * r.gp, 26 * r.gp, 80 + 25 * q, 5.5 + 2 * q, 1 + q, 1.6 - q, 12 * r.gp, 30, r.pa, r.gp];
    opp[r.code] = [r.pa, 85 * r.gp, (44 - 6 * q) * r.gp, 12 * r.gp, 35 * r.gp, 22 * r.gp, 10 * r.gp, 14 * r.gp, 24 * r.gp, 33 * r.gp, 5 * r.gp,
      (380 - 80 * q) * r.gp, 34 * r.gp, (2 + q) * r.gp, 26 * r.gp, 105 - 25 * q, 7.5 - 2 * q, null, null, 12 * r.gp, null, null, null];
  });
  return { league: sport.slice(0, 3), name: sport, sport, season: '2026', year: 2026, clubs: rows, stats: { keys, own, opp: sport === 'soccer' ? {} : opp }, games: out, leaders: [], at: '' };
}

for (const [sport, n, opts] of [['football', 32, { confs: 2, divs: 4 }], ['basketball', 30, { confs: 2, divs: 3 }], ['soccer', 20, {}]]) {
  const l = league(sport, n, opts);
  const s = statsOf(l);
  assert.equal(s(l.clubs[0].code, 'offensive.points'), l.clubs[0].pf, `${sport}: a number read by its name`);
  assert.equal(s(l.clubs[0].code, 'no.such'), null, `${sport}: a number the feed lacks is null`);
  const tb = table(l);
  const best = l.clubs[0].code, worst = l.clubs[n - 1].code;
  const first = MEASURES[sport].find((m) => m.group === 'Results');
  const top = l.clubs.map((c) => tb.ranks[c.code].find((r) => r.key === first.key)).sort((x, y) => y.value - x.value)[0];
  assert.equal(top.rank, 1, `${sport}: the most ${first.key} ranks first`);
  const low = tb.ranks[worst].find((r) => r.low && r.group === 'Defence' && r.key !== 'cs');
  if (low) assert.ok(low.rank > n / 2, `${sport}: a low measure (${low.key}) ranks the club that allows the most near the bottom`);
  assert.ok(tb.grades[best].score > tb.grades[worst].score, `${sport}: the better club grades higher`);

  const out = outlook(l, 600);
  const all = Object.values(out.chances);
  const sum = (f) => all.reduce((t, x) => t + f(x), 0);
  assert.ok(Math.abs(sum((x) => x.title) - 1) < 1e-9, `${sport}: one champion a season`);
  assert.ok(all.every((x) => x.title >= 0 && x.title <= 1), `${sport}: chances are chances`);
  assert.ok(out.chances[best].title > out.chances[worst].title, `${sport}: the best club wins more often`);
  if (sport === 'football') {
    assert.ok(Math.abs(sum((x) => x.playoffs) - 14) < 1e-9, 'football: seven seeds a conference');
    assert.ok(Math.abs(sum((x) => x.division) - 8) < 1e-9, 'football: a winner in each of the eight divisions');
    assert.ok(Math.abs(sum((x) => x.finals) - 2) < 1e-9, 'football: two in the Super Bowl');
  }
  if (sport === 'basketball') {
    assert.ok(Math.abs(sum((x) => x.playoffs) - 16) < 1e-9, 'basketball: sixteen in the playoffs');
    assert.ok(Math.abs(sum((x) => x.playIn) - 8) < 1e-9, 'basketball: four a conference in the play-in');
    assert.ok(Math.abs(sum((x) => x.top6) - 12) < 1e-9, 'basketball: six a conference straight in');
  }
  if (sport === 'soccer') {
    assert.ok(all.every((x) => Math.abs(x.positions.reduce((a, b) => a + b, 0) - 1) < 1e-9), 'soccer: every club finishes somewhere');
    assert.ok(Math.abs(sum((x) => x.relegated) - 3) < 1e-9, 'soccer: three go down');
    assert.ok(Math.abs(sum((x) => x.top4) - 4) < 1e-9, 'soccer: four in the top four');
  }
  const lk = luck(l, best);
  assert.ok(lk && Number.isFinite(lk.expected) && ['hot', 'cold', 'fair'].includes(lk.tone), `${sport}: a luck read`);
  const fm = form(l, best);
  assert.ok(fm && fm.games.length === SPORTS[sport].form && fm.games.every((g) => g.res === 'W' || g.res === 'D' || g.res === 'L'), `${sport}: the last ${SPORTS[sport].form} games`);
  const ah = ahead(l, best);
  assert.ok(ah && ah.left > 0 && ah.next.length && ah.next.every((g) => g.win > 0 && g.win < 1), `${sport}: the games ahead with chances`);
  assert.ok(ah.next.every((g) => g.market && Math.abs(g.win - (g.home ? 0.6 : 0.4)) < 1e-9), `${sport}: a game the market priced keeps the market's chance`);
  for (const code of [best, l.clubs[Math.floor(n / 2)].code, worst]) {
    const a = assess(l, code, tb, out, null);
    assert.ok(a.summary.includes(l.clubs.find((c) => c.code === code).name), `${sport}: the summary names the club`);
    assert.ok(a.questions.length >= 3, `${sport}: the bigger questions`);
    for (const q of a.questions) {
      assert.ok(QUESTION_CALLS[q.area], `${sport}: the fans can answer "${q.area}"`);
      assert.ok(['Keep', 'Adjust', 'Rethink'].includes(q.verdict) && q.evidence.length && q.action, `${sport}: "${q.area}" has a verdict, evidence and an action`);
    }
    const needs = CLUB_CALLS_BY_SPORT[sport].find((d) => d.key === 'need').choices.map((c) => c[0]);
    for (const x of a.needs) assert.ok(needs.includes(x.key), `${sport}: the need ${x.key} is one the fans can call`);
  }
}

// the chances from a margin, and soccer's from two scoring rates
assert.ok(Math.abs(phi(0) - 0.5) < 1e-9 && phi(1.96) > 0.97 && phi(-1.96) < 0.03, 'the normal curve');
const p = soccerProbs(1.5, 1.0);
assert.ok(Math.abs(p.h + p.d + p.a - 1) < 1e-9 && p.h > p.a, 'a stronger home side wins more often');
// a market rating: the lines of the games make the favourite the stronger club
const nfl = league('football', 32, { confs: 2, divs: 4, share: 0 });
nfl.games.forEach((g, i) => { if (i < 200) { g[9] = g[1] < g[2] ? -6 : 6; } });
const st = strengths(nfl);
assert.ok(st.get(nfl.clubs[0].code).market > st.get(nfl.clubs[31].code).market, 'the market rates the club it favours higher');
assert.ok([...st.values()].every((x) => x.sd > 0), 'every strength comes with its doubt');

console.log('fan sport: every league reads, simulates and asks its questions');
