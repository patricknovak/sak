// Rink Duel's numbers (7 November 2026, Patrick: "show comprehensive statistics for all players who play the game
// including cumulative goals and own goals and goals against and trends. Show ranking of players/GM"). Everything is
// worked out here from the league's kept games (rink_games, migration 352): no totals are stored.
//
// The ranking is a rating, chess style: everyone starts at 1000; a duel moves both members by how surprising the result
// was (beating someone rated well above you is worth more), and a game against the computer counts against the level's
// fixed rating, at half the weight, so a member who only plays the computer still gets a place but can't farm it.

export type RinkLevel = 'beer' | 'junior' | 'pro' | 'legend';
export interface RinkGameRow {
  id: number; match_id: string; home: number; away: number | null; level: RinkLevel | null;
  home_goals: number; away_goals: number; home_own: number; away_own: number;
  home_best: number; away_best: number; rally: number; secs: number; played_at: string;
}

export const START = 1000;
export const CPU_RATING: Record<RinkLevel, number> = { beer: 760, junior: 920, pro: 1080, legend: 1260 };
const K = 32;
const DAY = 86_400_000;

// one game from one member's side
export interface Side {
  game: RinkGameRow; at: number; vs: number | null; level: RinkLevel | null;
  gf: number; ga: number; own: number; theirOwn: number; best: number; won: boolean; rally: number; secs: number;
  before: number; after: number;              // the rating either side of it
}

export interface Line { gp: number; w: number; l: number; gf: number; ga: number; own: number }
const emptyLine = (): Line => ({ gp: 0, w: 0, l: 0, gf: 0, ga: 0, own: 0 });
const add = (l: Line, s: Side) => { l.gp++; if (s.won) l.w++; else l.l++; l.gf += s.gf; l.ga += s.ga; l.own += s.own; };

export interface PlayerStats {
  team: number;
  rating: number; peak: number; rank: number;
  all: Line; duels: Line; cpu: Line;
  byLevel: Partial<Record<RinkLevel, Line>>;
  vs: Map<number, Line>;                        // head to head against each member
  best: number; rally: number; shutouts: number; comebacks: number; hot: number; secs: number;
  streak: { kind: 'W' | 'L'; n: number } | null; longestWin: number;
  form: ('W' | 'L')[];                          // the last five, newest first
  // the trend: the last two weeks against everything before them
  recent: { gp: number; winPct: number | null; gfpg: number | null; gapg: number | null; ratingMove: number };
  before: { gp: number; winPct: number | null; gfpg: number | null; gapg: number | null };
  trend: 'up' | 'down' | 'flat' | 'new';
  path: { at: number; r: number }[];            // the rating over time, for the chart
  games: Side[];                                // newest first
}

export interface LeagueRecords {
  hardest: { team: number; kmh: number; at: number } | null;
  rally: { teams: number[]; n: number; at: number } | null;
  rout: { team: number; vs: number | null; level: RinkLevel | null; gf: number; ga: number; at: number } | null;
  ownGoals: { team: number; n: number } | null;
  games: number; goals: number; duels: number;
}

const expect = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400));
const pct = (w: number, gp: number) => (gp ? w / gp : null);
const per = (n: number, gp: number) => (gp ? n / gp : null);

export function rinkStats(rows: RinkGameRow[], now = Date.now()): { players: PlayerStats[]; records: LeagueRecords } {
  const games = [...rows].sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at) || a.id - b.id);
  const rating = new Map<number, number>();
  const sides = new Map<number, Side[]>();
  const r = (t: number) => rating.get(t) ?? START;
  const push = (t: number, s: Side) => { if (!sides.has(t)) sides.set(t, []); sides.get(t)!.push(s); };

  for (const g of games) {
    const at = Date.parse(g.played_at);
    const homeWon = g.home_goals > g.away_goals;
    if (g.away != null) {
      const a = r(g.home), b = r(g.away);
      const ea = expect(a, b);
      // a bigger win moves a little more: up to half again for a 7-0
      const margin = 1 + Math.min(0.5, Math.abs(g.home_goals - g.away_goals) / 14);
      const d = K * margin * ((homeWon ? 1 : 0) - ea);
      rating.set(g.home, a + d); rating.set(g.away, b - d);
      push(g.home, { game: g, at, vs: g.away, level: null, gf: g.home_goals, ga: g.away_goals, own: g.home_own, theirOwn: g.away_own, best: g.home_best, won: homeWon, rally: g.rally, secs: g.secs, before: a, after: a + d });
      push(g.away, { game: g, at, vs: g.home, level: null, gf: g.away_goals, ga: g.home_goals, own: g.away_own, theirOwn: g.home_own, best: g.away_best, won: !homeWon, rally: g.rally, secs: g.secs, before: b, after: b - d });
    } else if (g.level) {
      const a = r(g.home);
      const d = (K / 2) * ((homeWon ? 1 : 0) - expect(a, CPU_RATING[g.level]));
      rating.set(g.home, a + d);
      push(g.home, { game: g, at, vs: null, level: g.level, gf: g.home_goals, ga: g.away_goals, own: g.home_own, theirOwn: g.away_own, best: g.home_best, won: homeWon, rally: g.rally, secs: g.secs, before: a, after: a + d });
    }
  }

  const players: PlayerStats[] = [...sides.entries()].map(([team, list]) => {
    const all = emptyLine(), duels = emptyLine(), cpu = emptyLine();
    const byLevel: PlayerStats['byLevel'] = {};
    const vs = new Map<number, Line>();
    let best = 0, rally = 0, shutouts = 0, comebacks = 0, hot = 0, secs = 0, longestWin = 0, run = 0, peak = START;
    for (const s of list) {
      add(all, s);
      if (s.vs != null) { add(duels, s); if (!vs.has(s.vs)) vs.set(s.vs, emptyLine()); add(vs.get(s.vs)!, s); }
      else if (s.level) { add(cpu, s); add((byLevel[s.level] ??= emptyLine()), s); }
      best = Math.max(best, s.best); rally = Math.max(rally, s.rally); secs += s.secs;
      if (s.won && s.ga === 0) shutouts++;
      // a hot puck is worth two, so a score past seven means one went in on fire
      if (s.gf > 7) hot++;
      if (s.won && s.ga >= 5) comebacks++;
      run = s.won ? run + 1 : 0; longestWin = Math.max(longestWin, run);
      peak = Math.max(peak, s.after);
    }
    const newest = [...list].reverse();
    let streak: PlayerStats['streak'] = null;
    for (const s of newest) {
      const k = s.won ? 'W' : 'L';
      if (!streak) streak = { kind: k, n: 1 };
      else if (streak.kind === k) streak.n++;
      else break;
    }
    const cut = now - 14 * DAY;
    const rec = list.filter((s) => s.at >= cut), old = list.filter((s) => s.at < cut);
    const sum = (xs: Side[], f: (s: Side) => number) => xs.reduce((n, s) => n + f(s), 0);
    const recent = {
      gp: rec.length, winPct: pct(rec.filter((s) => s.won).length, rec.length),
      gfpg: per(sum(rec, (s) => s.gf), rec.length), gapg: per(sum(rec, (s) => s.ga), rec.length),
      ratingMove: rec.length ? rec[rec.length - 1].after - rec[0].before : 0,
    };
    const before = { gp: old.length, winPct: pct(old.filter((s) => s.won).length, old.length), gfpg: per(sum(old, (s) => s.gf), old.length), gapg: per(sum(old, (s) => s.ga), old.length) };
    const trend: PlayerStats['trend'] = list.length < 3 || !rec.length ? 'new' : recent.ratingMove > 8 ? 'up' : recent.ratingMove < -8 ? 'down' : 'flat';
    return {
      team, rating: r(team), peak, rank: 0, all, duels, cpu, byLevel, vs,
      best, rally, shutouts, comebacks, hot, secs, streak, longestWin,
      form: newest.slice(0, 5).map((s) => (s.won ? 'W' : 'L')),
      recent, before, trend,
      path: [{ at: list[0].at - 1, r: START }, ...list.map((s) => ({ at: s.at, r: s.after }))],
      games: newest,
    };
  });
  // the table: rating, then wins, then goal difference
  players.sort((a, b) => b.rating - a.rating || b.all.w - a.all.w || (b.all.gf - b.all.ga) - (a.all.gf - a.all.ga));
  players.forEach((p, i) => { p.rank = i + 1; });

  // the league's records
  const records: LeagueRecords = { hardest: null, rally: null, rout: null, ownGoals: null, games: games.length, goals: 0, duels: 0 };
  for (const g of games) {
    const at = Date.parse(g.played_at);
    records.goals += g.home_goals + g.away_goals;
    if (g.away != null) records.duels++;
    for (const [team, kmh] of [[g.home, g.home_best], ...(g.away != null ? [[g.away, g.away_best]] : [])] as [number, number][]) {
      if (kmh > (records.hardest?.kmh ?? 0)) records.hardest = { team, kmh, at };
    }
    if (g.rally > (records.rally?.n ?? 0)) records.rally = { teams: g.away != null ? [g.home, g.away] : [g.home], n: g.rally, at };
    // the biggest win by a member (a member beaten by the computer isn't a member's rout)
    const homeWon = g.home_goals > g.away_goals;
    const margin = Math.abs(g.home_goals - g.away_goals);
    const winner = homeWon ? g.home : g.away;
    if (winner != null && margin > ((records.rout?.gf ?? 0) - (records.rout?.ga ?? 0))) {
      records.rout = homeWon
        ? { team: g.home, vs: g.away, level: g.level, gf: g.home_goals, ga: g.away_goals, at }
        : { team: g.away!, vs: g.home, level: null, gf: g.away_goals, ga: g.home_goals, at };
    }
  }
  const og = [...players].sort((a, b) => b.all.own - a.all.own)[0];
  if (og && og.all.own > 0) records.ownGoals = { team: og.team, n: og.all.own };
  return { players, records };
}
