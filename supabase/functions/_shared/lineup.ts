// Lineup optimizer shared by the site (previews, "optimize now") and the server (daily auto-pilot).
// Pure TypeScript, no Deno or DOM APIs. It finds the best possible assignment of players to starting
// slots (an exact assignment, not a greedy fill, so a C/LW never blocks a better winger), respecting
// players whose games have started, the GM's pins, and injuries.
import { statusChance, type GameStatus } from './gameday.ts';

export type Mode = 'day' | 'week' | 'season';
export type Basis = 'proj' | 'form' | 'season' | 'ros';

export interface LPlayer {
  id: number; pos: string; elig: string[]; proj: number; nhl_team: string | null; injury_status: string | null;
  proj_gp?: number | null;          // games (starts for goalies) the projection covers
  gs?: GameStatus | null;           // today's game-day status: confirmed/expected/backup goalie, out, scratched
}
export interface LRow { player_id: number; slot: string; pin?: string | null }
export interface LSeason { gp: number; fpts: number; gp14?: number | null; fpts14?: number | null }
export interface LGame { home: string; away: string; date: string; start_utc: string; state: string }

export interface LContext {
  today: string;                    // Eastern date, YYYY-MM-DD
  weekEnd: string;                  // last day (Sunday) of the fantasy week, YYYY-MM-DD
  now: number;                      // ms, for locks
  games: LGame[];                   // at least today through weekEnd
  season: Map<number, LSeason>;
  caps: Record<string, number>;     // starting slots: C LW RW D Util G (+ IR, BN)
  avail?: Map<number, number>;      // chance each player plays on a night his team does (see availability())
}

export const STARTING = ['C', 'LW', 'RW', 'D', 'Util', 'G'];
const OUT = /^(out|ir|injured reserve|injured|suspension|suspended|long[- ]term)/i;
export const isOut = (s: string | null | undefined) => !!s && OUT.test(s);
// who can go on IR: anyone on the injury report except a suspended player (a suspension isn't an injury)
export const irOk = (s: string | null | undefined) => !!s && !/suspen/i.test(s);

export const slotOk = (p: { pos: string; elig: string[] }, slot: string) =>
  slot === 'BN' || slot === 'IR' ? true : slot === 'Util' ? p.pos !== 'G' : slot === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(slot);

const live = (g: LGame) => g.state !== 'PPD' && g.state !== 'CNCL';
export function gameToday(team: string | null, ctx: LContext) {
  return team ? ctx.games.find((g) => g.date === ctx.today && live(g) && (g.home === team || g.away === team)) : undefined;
}
export function locked(p: LPlayer, ctx: LContext) {
  const g = gameToday(p.nhl_team, ctx) as { start_utc: string; state?: string } | undefined;
  return !!g && (new Date(g.start_utc).getTime() <= ctx.now || ['LIVE', 'CRIT', 'OFF', 'FINAL'].includes(g.state ?? ''));
}
export function gamesLeftThisWeek(team: string | null, ctx: LContext) {
  return team ? ctx.games.filter((g) => live(g) && g.date >= ctx.today && g.date <= ctx.weekEnd && (g.home === team || g.away === team)).length : 0;
}

export const GAMES_PER_SEASON = (pos: string) => (pos === 'G' ? 58 : 80);
// the games a player's projection is spread over: the model's projected games when there is one
export const gamesOf = (p: { pos: string; proj_gp?: number | null }) => (p.proj_gp && p.proj_gp > 0 ? p.proj_gp : GAMES_PER_SEASON(p.pos));

// rest-of-season points per game: the preseason projection, trusted less and the season's pace trusted more
// as games pile up (half and half at 30 games; fantasy scoring rates take most of a season to settle)
export function rosPerGame(proj: number, pos: string, gp: number, fpts: number, projGp?: number | null) {
  const base = proj / (projGp && projGp > 0 ? projGp : GAMES_PER_SEASON(pos));
  if (!gp) return base;
  const w = gp / (gp + 30);
  return (1 - w) * base + w * (fpts / gp);
}

// fantasy points per game under the chosen basis (falls back to the projection when there's no sample)
export function perGame(p: LPlayer, basis: Basis, ctx: LContext) {
  const base = p.proj / gamesOf(p);
  const s = ctx.season.get(p.id);
  if (basis === 'ros') return rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp);
  if (basis === 'form' && s?.gp14 && s.gp14 >= 2 && s.fpts14 != null) return s.fpts14 / s.gp14;
  if ((basis === 'season' || basis === 'form') && s && s.gp >= 5) return s.fpts / s.gp;
  return base;
}

// the chance he's in the lineup on a night his team plays: a starting goalie starts about 70% of games, a
// backup far fewer, a skater nearly all (from his projected games)
export const dressRate = (p: { pos: string; proj_gp?: number | null }) => Math.min(1, gamesOf(p) / 82);

// how likely an injury status lets him play on a given night: out is out, day-to-day is a coin flip
export function healthFactor(s: string | null | undefined) {
  if (!s) return 1;
  if (isOut(s)) return 0;
  if (/day[- ]?to[- ]?day|questionable|dtd|game[- ]time/i.test(s)) return 0.5;
  if (/probable/i.test(s)) return 0.85;
  return 0.9;
}

// the chance each player is in the NHL lineup on a night his team plays: how often he dresses (or, for a
// goalie, starts), times his health. A hurt goalie's starts go to his healthy crease partners.
export function availability(players: Iterable<LPlayer>): Map<number, number> {
  const out = new Map<number, number>();
  const goalies = new Map<string, { p: LPlayer; base: number; h: number }[]>();
  for (const p of players) {
    const base = dressRate(p), h = healthFactor(p.injury_status);
    out.set(p.id, base * h);
    if (p.pos === 'G' && p.nhl_team) goalies.set(p.nhl_team, [...(goalies.get(p.nhl_team) ?? []), { p, base, h }]);
  }
  for (const gs of goalies.values()) {
    const lost = gs.reduce((t, g) => t + g.base * (1 - g.h), 0);
    const healthy = gs.filter((g) => g.h >= 0.85);
    const pool = healthy.reduce((t, g) => t + g.base, 0);
    if (lost <= 0 || !pool) continue;
    for (const g of healthy) out.set(g.p.id, Math.min(0.92, g.base * g.h + lost * (g.base / pool)));
  }
  return out;
}

// what a player is worth in a starting slot for this mode (expected points: per game × chance he plays)
export function worth(p: LPlayer, mode: Mode, basis: Basis, ctx: LContext) {
  if (isOut(p.injury_status)) return 0;
  const chance = ctx.avail?.get(p.id) ?? dressRate(p) * healthFactor(p.injury_status);
  const pg = perGame(p, basis, ctx) * chance;
  // tonight we may know for sure: a confirmed starter plays, the backup almost never does, a scratch doesn't
  if (mode === 'day') { const sc = statusChance(p.gs); return gameToday(p.nhl_team, ctx) ? (sc == null ? pg : perGame(p, basis, ctx) * sc) : 0; }
  if (mode === 'week') return gamesLeftThisWeek(p.nhl_team, ctx) * pg;
  return pg * 82;
}

// Hungarian algorithm: minimum-cost assignment of n rows to m >= n columns
export function hungarian(cost: number[][]): number[] {
  const n = cost.length, m = cost[0]?.length ?? 0;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

export interface Plan {
  slots: Map<number, string>;      // final slot for every player on the roster
  moves: { player_id: number; from: string; to: string }[];
  value: number;                   // expected value of the starters under this mode
  before: number;                  // same measure for the current lineup
}

export function optimize(rows: LRow[], players: Map<number, LPlayer>, mode: Mode, basis: Basis, ctxIn: LContext): Plan {
  const ctx = ctxIn.avail ? ctxIn : { ...ctxIn, avail: availability(players.values()) };
  const caps = { ...ctx.caps };
  const final = new Map<number, string>();
  const roster = rows.map((r) => ({ r, p: players.get(r.player_id) })).filter((x): x is { r: LRow; p: LPlayer } => !!x.p);
  const w = (p: LPlayer) => worth(p, mode, basis, ctx);

  // players whose games have started stay put and use up their slots
  const free: { r: LRow; p: LPlayer }[] = [];
  for (const x of roster) {
    if (locked(x.p, ctx)) { final.set(x.p.id, x.r.slot); if (x.r.slot in caps) caps[x.r.slot]--; }
    else free.push(x);
  }

  // IR is the GM's call: players on it stay there (even once healthy) and the optimizer never puts anyone on it
  const candidates: { r: LRow; p: LPlayer }[] = [];
  for (const x of free) {
    if (x.r.slot === 'IR') { final.set(x.p.id, 'IR'); continue; }
    candidates.push(x);
  }

  // one column per open starting slot, plus a bench column per player
  const cols: string[] = [];
  for (const s of STARTING) for (let i = 0; i < Math.max(0, caps[s] ?? 0); i++) cols.push(s);
  const BIG = 1e9;
  const cost = candidates.map(({ r, p }) => {
    const val = w(p) + (worth(p, 'season', basis, ctx) * 1e-6); // tiny tie-break toward better players
    const row = cols.map((s) => {
      if (!slotOk(p, s) || r.pin === 'bench') return BIG;
      return -(val + (r.pin === 'start' ? 1e6 : 0));
    });
    return [...row, ...candidates.map(() => 0)];
  });
  const assign = candidates.length ? hungarian(cost) : [];
  candidates.forEach(({ p }, i) => {
    const j = assign[i];
    final.set(p.id, j >= 0 && j < cols.length && cost[i][j] < BIG ? cols[j] : 'BN');
  });

  const starterValue = (slotOf: (id: number) => string) =>
    roster.filter((x) => STARTING.includes(slotOf(x.p.id))).reduce((t, x) => t + w(x.p), 0);
  const moves = roster.filter((x) => final.get(x.p.id) !== x.r.slot).map((x) => ({ player_id: x.p.id, from: x.r.slot, to: final.get(x.p.id)! }));
  return {
    slots: final, moves,
    value: starterValue((id) => final.get(id) ?? 'BN'),
    before: starterValue((id) => rows.find((r) => r.player_id === id)?.slot ?? 'BN'),
  };
}

// Monday-to-Sunday fantasy week containing `today` (Eastern dates)
export function weekEndOf(today: string) {
  const d = new Date(today + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() + ((7 - dow) % 7));
  return d.toISOString().slice(0, 10);
}
