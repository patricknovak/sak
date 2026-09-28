// Season forecast: plays out every remaining day of the real NHL schedule with each team's best possible
// daily lineup (the same exact assignment the lineup optimizer uses), then simulates the season thousands of
// times with each player's projection range to get finish odds. Pure functions; the hooks live in the pages.
import { hungarian, slotOk, STARTING } from './lineup';

export interface FPlayer {
  id: number; pos: string; elig: string[]; nhl_team: string | null; injury_status: string | null;
  proj: number; proj_gp?: number | null; lo?: number; hi?: number;
  stats?: Record<string, number> | null;       // projected season line (for category totals)
}
export interface FGame { date: string; home: string; away: string; state?: string }

export interface PlayerContrib { id: number; starts: number; benched: number; pts: number; benchPts: number }
export interface TeamForecast {
  team: number;
  ros: number;                      // expected points from today to the end of the season
  current: number;                  // points already banked
  total: number;                    // current + ros
  benchWaste: number;               // expected points left on the bench (games a starter slot couldn't use)
  emptySlots: number;               // starting slots expected to go unfilled over the season
  players: Map<number, PlayerContrib>;
  byPos: Record<string, number>;    // expected starter points by position (C LW RW D G)
  cats: Record<string, number>;     // expected category totals from starts (g, a, sog, hit … / w, sv …)
}
export interface Odds { team: number; first: number; top3: number; last: number; avgRank: number; p10: number; p90: number }

const GAMES = 82;
// expected fantasy points a player adds on a day his NHL team plays: points per game he dresses, times the
// chance he dresses (goalies: the chance he starts)
export function perTeamGame(p: FPlayer) {
  const gp = p.proj_gp && p.proj_gp > 0 ? p.proj_gp : p.pos === 'G' ? 58 : 80;
  const perGame = p.proj / gp;
  const avail = Math.min(1, gp / GAMES);
  return { value: perGame * avail, avail, perGame };
}

// the whole rest of the season for one roster
export function forecastTeam(team: number, roster: FPlayer[], games: FGame[], caps: Record<string, number>, from: string, current = 0): TeamForecast {
  const playing = new Map<string, Set<string>>();
  for (const g of games) {
    if (g.date < from || g.state === 'PPD' || g.state === 'CNCL') continue;
    const s = playing.get(g.date) ?? new Set<string>();
    s.add(g.home); s.add(g.away);
    playing.set(g.date, s);
  }
  const cols: string[] = [];
  for (const s of STARTING) for (let i = 0; i < (caps[s] ?? 0); i++) cols.push(s);
  const vals = new Map(roster.map((p) => [p.id, perTeamGame(p)]));
  const contrib = new Map<number, PlayerContrib>(roster.map((p) => [p.id, { id: p.id, starts: 0, benched: 0, pts: 0, benchPts: 0 }]));
  const byPos: Record<string, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0 };
  let ros = 0, waste = 0, empty = 0;
  for (const [, teams] of playing) {
    const today = roster.filter((p) => p.nhl_team && teams.has(p.nhl_team));
    if (!today.length) { empty += cols.length; continue; }
    const BIG = 1e9;
    const cost = today.map((p) => [...cols.map((s) => (slotOk(p, s) ? -vals.get(p.id)!.value : BIG)), ...today.map(() => 0)]);
    const a = hungarian(cost);
    let filled = 0;
    today.forEach((p, i) => {
      const j = a[i], v = vals.get(p.id)!.value, c = contrib.get(p.id)!;
      if (j >= 0 && j < cols.length && cost[i][j] < BIG) {
        c.starts += vals.get(p.id)!.avail; c.pts += v; ros += v; filled++;
        byPos[p.pos] = (byPos[p.pos] ?? 0) + v;
      } else { c.benched += vals.get(p.id)!.avail; c.benchPts += v; waste += v; }
    });
    empty += cols.length - filled;
  }
  // category totals: each player's projected line, scaled to the share of his games that land in the lineup
  const cats: Record<string, number> = {};
  for (const p of roster) {
    const c = contrib.get(p.id)!, st = p.stats;
    if (!st || !c.starts) continue;
    const share = c.starts / Math.max(1, st.gp ?? st.gs ?? 1);
    for (const [k, v] of Object.entries(st)) if (k !== 'gp' && k !== 'svp') cats[k] = (cats[k] ?? 0) + v * Math.min(1, share);
  }
  return { team, ros, current, total: current + ros, benchWaste: waste, emptySlots: empty, players: contrib, byPos, cats };
}

// deterministic normal draws so the page gives the same odds every render
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(r: () => number) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// finish odds: each player's season lands somewhere in his range (the range is roughly an 80% band), plus
// game-to-game noise on the team total
export function finishOdds(fc: TeamForecast[], players: Map<number, FPlayer>, sims = 4000): Odds[] {
  const r = rng(20262027);
  const n = fc.length;
  const ranks = fc.map(() => [] as number[]);
  const totals = fc.map(() => [] as number[]);
  const parts = fc.map((f) => [...f.players.values()].filter((c) => c.pts > 0).map((c) => {
    const p = players.get(c.id);
    const lo = p?.lo ?? 0.8, hi = p?.hi ?? 1.18;
    return { pts: c.pts, sd: Math.max(0.05, (hi - lo) / 2.56) };
  }));
  for (let s = 0; s < sims; s++) {
    const t = fc.map((f, i) => {
      let x = f.current;
      for (const q of parts[i]) x += q.pts * Math.max(0.2, 1 + q.sd * gauss(r));
      x += gauss(r) * Math.sqrt(Math.max(1, f.ros)) * 1.2;
      return x;
    });
    const order = t.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    order.forEach(([, i], k) => ranks[i].push(k + 1));
    t.forEach((v, i) => totals[i].push(v));
  }
  return fc.map((f, i) => {
    const rk = ranks[i], tt = totals[i].sort((a, b) => a - b);
    return {
      team: f.team,
      first: rk.filter((x) => x === 1).length / sims,
      top3: rk.filter((x) => x <= 3).length / sims,
      last: rk.filter((x) => x === n).length / sims,
      avgRank: rk.reduce((a, b) => a + b, 0) / sims,
      p10: tt[Math.floor(sims * 0.1)], p90: tt[Math.floor(sims * 0.9)],
    };
  });
}

// rank helper: 1 = best
export const rankIn = (vals: number[], v: number, lowerIsBetter = false) => vals.filter((x) => (lowerIsBetter ? x < v : x > v)).length + 1;
