// NHL playoff odds: how likely each NHL team is to make the playoffs and how many playoff games it should play
// from here. A fantasy player's playoff value is his points per game times those games, so this drives the SAK
// playoff and SAK Cup forecasts. Pure TypeScript (no Deno or DOM APIs).
//
//   * team strength: points % this season, pulled toward last season's (itself pulled halfway to the league
//     average) until enough games are played
//   * regular season: the rest of the season simulated a few thousand times; the top 8 in each conference make it
//     (close enough to the division/wild-card format for odds)
//   * playoffs: each series from its current score, game by game, with the better team a modest favourite
//     (playoff hockey is close to a coin flip); later rounds against an average playoff team

export interface NhlTeamIn { abbrev: string; name: string; conf: string; division: string; gp: number; pts: number; prior: number | null }
export interface SeriesIn { round: number; a: string; b: string; aw: number; bw: number; winner: string | null; loser: string | null }
export interface NhlTeamOut {
  abbrev: string; name: string; conf: string; division: string; gp: number; pts: number;
  point_pct: number | null; prior_pct: number | null; strength: number; proj_pts: number;
  playoff_odds: number; exp_po_games: number; po_status: 'regular' | 'alive' | 'out'; po_note: string | null;
}

const K = 25;                 // games of prior the strength estimate starts with
const ROUNDS = 4;

export function strengthOf(t: { gp: number; pts: number; prior: number | null }, avg: number) {
  const prior = t.prior == null ? avg : (t.prior + avg) / 2;
  return (t.pts + K * 2 * prior) / (2 * t.gp + 2 * K);
}

// chance the stronger side wins one game: points % gaps shrink a lot in the playoffs
export const gameWinProb = (sa: number, sb: number) => Math.min(0.65, Math.max(0.35, 0.5 + (sa - sb) * 1.0));

// a best-of-seven from its current score: chance to win it and expected games still to play
export function seriesOdds(w: number, l: number, p: number, need = 4): { win: number; games: number } {
  const memo = new Map<string, { win: number; games: number }>();
  const go = (a: number, b: number): { win: number; games: number } => {
    if (a >= need) return { win: 1, games: 0 };
    if (b >= need) return { win: 0, games: 0 };
    const k = `${a}:${b}`;
    const hit = memo.get(k);
    if (hit) return hit;
    const x = go(a + 1, b), y = go(a, b + 1);
    const r = { win: p * x.win + (1 - p) * y.win, games: 1 + p * x.games + (1 - p) * y.games };
    memo.set(k, r);
    return r;
  };
  return go(w, l);
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(r: () => number) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// expected playoff games for a team that makes it, against average playoff opposition from round `from` on
function futureGames(s: number, avgPo: number, rounds: number) {
  const p = gameWinProb(s, avgPo);
  const o = seriesOdds(0, 0, p);
  let g = 0, reach = 1;
  for (let i = 0; i < rounds; i++) { g += reach * o.games; reach *= o.win; }
  return { games: g, seriesWin: o.win };
}

export function playoffOdds(teams: NhlTeamIn[], series: SeriesIn[] | null, sims = 4000): NhlTeamOut[] {
  const withGp = teams.filter((t) => t.gp > 0);
  const avg = withGp.length ? withGp.reduce((a, t) => a + t.pts, 0) / Math.max(1, withGp.reduce((a, t) => a + 2 * t.gp, 0))
    : teams.filter((t) => t.prior != null).reduce((a, t) => a + t.prior!, 0) / Math.max(1, teams.filter((t) => t.prior != null).length) || 0.55;
  const str = new Map(teams.map((t) => [t.abbrev, strengthOf(t, avg)]));
  const base = (t: NhlTeamIn): NhlTeamOut => ({
    abbrev: t.abbrev, name: t.name, conf: t.conf, division: t.division, gp: t.gp, pts: t.pts,
    point_pct: t.gp ? Math.round((t.pts / (2 * t.gp)) * 1000) / 1000 : null, prior_pct: t.prior,
    strength: Math.round(str.get(t.abbrev)! * 1000) / 1000,
    proj_pts: Math.round(t.pts + Math.max(0, 82 - t.gp) * 2 * str.get(t.abbrev)!),
    playoff_odds: 0, exp_po_games: 0, po_status: 'regular', po_note: null,
  });

  // the playoffs are on: work from the bracket
  if (series && series.length) {
    const inPo = new Set(series.flatMap((s) => [s.a, s.b]));
    const poStr = [...inPo].map((a) => str.get(a) ?? avg);
    const avgPo = poStr.reduce((a, b) => a + b, 0) / Math.max(1, poStr.length);
    const out = new Set(series.filter((s) => s.loser).map((s) => s.loser!));
    return teams.map((t) => {
      const o = base(t);
      if (!inPo.has(t.abbrev) || out.has(t.abbrev)) {
        o.po_status = 'out'; o.po_note = inPo.has(t.abbrev) ? 'Eliminated' : 'Missed the playoffs';
        o.playoff_odds = inPo.has(t.abbrev) ? 1 : 0;
        return o;
      }
      o.po_status = 'alive'; o.playoff_odds = 1;
      const s = str.get(t.abbrev) ?? avg;
      // his latest series: in progress, or won and waiting on the next round
      const cur = series.filter((x) => x.a === t.abbrev || x.b === t.abbrev).sort((x, y) => y.round - x.round)[0];
      const mine = cur.a === t.abbrev;
      const opp = mine ? cur.b : cur.a;
      let now = { win: 1, games: 0 };
      if (!cur.winner) now = seriesOdds(mine ? cur.aw : cur.bw, mine ? cur.bw : cur.aw, gameWinProb(s, str.get(opp) ?? avg));
      const f = futureGames(s, avgPo, ROUNDS - cur.round);
      o.exp_po_games = Math.round((now.games + now.win * f.games) * 10) / 10;
      o.po_note = cur.winner ? `Won round ${cur.round}` : `Round ${cur.round}: ${mine ? cur.aw : cur.bw}-${mine ? cur.bw : cur.aw} vs ${opp}`;
      return o;
    });
  }

  // regular season: simulate the rest of it
  const r = rng(82_2027);
  const makes = new Map(teams.map((t) => [t.abbrev, 0]));
  const poAvg: number[] = [];
  for (let i = 0; i < sims; i++) {
    const fin = teams.map((t) => {
      const rem = Math.max(0, 82 - t.gp);
      const s = str.get(t.abbrev)!;
      const sd = Math.sqrt(rem) * 0.95 + rem * 2 * 0.035 * Math.sqrt(K / (K + t.gp));
      return { t, v: t.pts + rem * 2 * s + gauss(r) * sd + r() * 0.01 };
    });
    let sum = 0, n = 0;
    for (const conf of new Set(teams.map((t) => t.conf))) {
      const top = fin.filter((x) => x.t.conf === conf).sort((a, b) => b.v - a.v).slice(0, 8);
      for (const x of top) { makes.set(x.t.abbrev, makes.get(x.t.abbrev)! + 1); sum += str.get(x.t.abbrev)!; n++; }
    }
    poAvg.push(sum / Math.max(1, n));
  }
  const avgPo = poAvg.reduce((a, b) => a + b, 0) / Math.max(1, poAvg.length);
  return teams.map((t) => {
    const o = base(t);
    o.playoff_odds = Math.round((makes.get(t.abbrev)! / sims) * 1000) / 1000;
    const f = futureGames(str.get(t.abbrev)!, avgPo, ROUNDS);
    o.exp_po_games = Math.round(o.playoff_odds * f.games * 10) / 10;
    o.po_note = `${Math.round(o.playoff_odds * 100)}% to make the playoffs · ${o.proj_pts} projected points`;
    return o;
  });
}
