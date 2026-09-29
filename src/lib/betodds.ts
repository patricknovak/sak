// Live odds of winning, for side bets and Garry's Book. Everything here is a normal or Poisson approximation
// on top of numbers the site already has (what's banked so far, projections, the schedule, the live score):
// good enough to say "you're 72% to win this", not a pricing engine.
import type { Bet, BetProgress, Game, Market, Player } from './types';
import { forecastTeam, type FGame, type FPlayer } from './forecast';
import { gamesOf, healthFactor } from './lineup';

// standard normal CDF (Abramowitz-Stegun)
export function phi(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));
// P(X > Y) for independent normals; exact ties can't happen with continuous scoring, so this is the win chance
const pAhead = (mean: number, sd: number) => (sd < 1e-6 ? (mean > 0 ? 1 : mean < 0 ? 0 : 0.5) : clamp(phi(mean / sd)));

export interface OddsCtx {
  today: string;
  games: FGame[];                                  // the season schedule
  started: Set<string>;                            // `${date}|${team}` for games today that are under way or over
  players: Map<number, Player>;
  rosterOf: (team: number) => Player[];           // current active roster
  caps: Record<string, number>;
  seasonStart?: string | null; seasonEnd?: string | null;
}

// games a club still has to play in [from, to], not counting tonight's once they've started
function gamesLeft(team: string | null, from: string, to: string, ctx: OddsCtx) {
  if (!team) return 0;
  const lo = from > ctx.today ? from : ctx.today;
  return ctx.games.filter((g) => g.date >= lo && g.date <= to && (g.home === team || g.away === team) && !ctx.started.has(`${g.date}|${team}`)
    && g.state !== 'PPD' && g.state !== 'CNCL').length;
}

// a player's expected remaining output of one stat, and its variance
function playerRest(id: number, stat: string, from: string, to: string, ctx: OddsCtx) {
  const p = ctx.players.get(id);
  if (!p) return { mean: 0, v: 0 };
  const n = gamesLeft(p.nhl_team, from, to, ctx);
  const dress = Math.min(1, gamesOf(p) / 82) * healthFactor(p.injury_status);
  let perGame: number;
  if (stat === 'fpts') perGame = p.proj / gamesOf(p);
  else { const ls = p.last_stats ?? {}; perGame = ls.gp ? (ls[stat] ?? 0) / ls.gp : 0; }
  const mean = n * dress * perGame;
  // fantasy points swing about as much as their mean (plus a floor); counting stats are roughly Poisson
  const perVar = stat === 'fpts' ? Math.max(0.6, perGame * 1.4) : stat === 'pm' ? 1.3 : Math.max(0.05, perGame);
  return { mean, v: n * dress * perVar };
}

// a SaK team's expected remaining points in [from, to] (best lineup each day), and its variance
const teamCache = new Map<string, { mean: number; v: number }>();
function teamRest(team: number, from: string, to: string, ctx: OddsCtx) {
  const lo = from > ctx.today ? from : ctx.today;
  if (lo > to) return { mean: 0, v: 0 };
  const key = `${team}|${lo}|${to}|${ctx.started.size}`;
  const hit = teamCache.get(key);
  if (hit) return hit;
  const roster = ctx.rosterOf(team) as unknown as FPlayer[];
  const games = ctx.games.filter((g) => !(g.date === ctx.today && (ctx.started.has(`${g.date}|${g.home}`) || ctx.started.has(`${g.date}|${g.away}`))));
  const f = forecastTeam(team, roster, games, ctx.caps, lo, 0, to);
  const out = { mean: f.ros, v: f.ros * 1.44 + (0.08 * f.ros) ** 2 };
  teamCache.set(key, out);
  return out;
}

// chance the bet's creator wins (null when there's nothing to model: custom bets, or not enough info)
export function betWinChance(b: Bet, pr: BetProgress | undefined, ctx: OddsCtx): { creator: number } | { pool: Map<number, number> } | null {
  if (!pr) return null;
  const from = b.start_date ?? ctx.today;
  const to = b.kind === 'season' ? ctx.seasonEnd ?? b.end_date ?? ctx.today : b.end_date ?? ctx.today;
  const s = b.subject ?? {};
  if (b.kind === 'h2h' || b.kind === 'season') {
    const f = b.kind === 'season' ? ctx.seasonStart ?? from : from;
    const A = teamRest(b.creator_team, f, to, ctx), B = teamRest(b.opponent_team ?? 0, f, to, ctx);
    return { creator: pAhead((pr.a ?? 0) + A.mean - (pr.b ?? 0) - B.mean, Math.sqrt(A.v + B.v)) };
  }
  if (b.kind === 'team_ou') {
    const A = teamRest(b.creator_team, from, to, ctx);
    const over = pAhead((pr.value ?? 0) + A.mean - (pr.line ?? 0), Math.sqrt(A.v));
    return { creator: s.side === 'under' ? 1 - over : over };
  }
  if (b.kind === 'player_ou' && s.player_id) {
    const R = playerRest(s.player_id, s.stat ?? 'fpts', from, to, ctx);
    const over = pAhead((pr.value ?? 0) + R.mean - (pr.line ?? 0), Math.sqrt(R.v));
    return { creator: s.side === 'under' ? 1 - over : over };
  }
  if (b.kind === 'player_vs' && s.player_a && s.player_b) {
    const A = playerRest(s.player_a, s.stat ?? 'fpts', from, to, ctx), B = playerRest(s.player_b, s.stat ?? 'fpts', from, to, ctx);
    return { creator: pAhead((pr.a ?? 0) + A.mean - (pr.b ?? 0) - B.mean, Math.sqrt(A.v + B.v)) };
  }
  if ((b.kind === 'pool_team' || b.kind === 'pool_player') && pr.entries?.length) {
    // simulate: each entry's final total, most wins (ties split)
    const parts = pr.entries.map((e) => {
      const R = b.kind === 'pool_team' ? teamRest(e.pick, from, to, ctx) : playerRest(e.pick, s.stat ?? 'fpts', from, to, ctx);
      return { team: e.team_id, mean: e.value + R.mean, sd: Math.sqrt(R.v) };
    });
    const wins = new Map(parts.map((p) => [p.team, 0]));
    const N = 2000;
    let seed = b.id * 7919;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    for (let i = 0; i < N; i++) {
      const vals = parts.map((p) => p.mean + p.sd * gauss());
      const best = Math.max(...vals);
      const top = parts.filter((_, j) => vals[j] >= best - 1e-9);
      for (const t of top) wins.set(t.team, wins.get(t.team)! + 1 / top.length);
    }
    return { pool: new Map([...wins].map(([t, w]) => [t, w / N])) };
  }
  return null;
}

// ───────────── Garry's Book: live chances for each option on a market ─────────────
const poisson = (l: number, k: number) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

// minutes of regulation left, from the game's period and clock
function minutesLeft(g: Game) {
  const per = String(g.period ?? '').toUpperCase();
  if (per.includes('OT') || per.includes('SO')) return 0;
  const n = Number(per.replace(/\D/g, '')) || 1;
  const [m, s] = String(g.clock ?? '20:00').split(':').map(Number);
  return Math.max(0, (3 - n) * 20 + (m || 0) + (s || 0) / 60);
}

// chance of each option on a Book market, given the game (live or not) and, for props, the player's points so far
export function marketChances(m: Market, g: Game | undefined, propSoFar = 0, players?: Map<number, Player>): Record<string, number> | null {
  if (m.kind === 'custom') return null;
  const done = g && ['OFF', 'FINAL'].includes(g.state);
  const live = g && ['LIVE', 'CRIT'].includes(g.state);
  if (m.kind === 'prop') {
    const p = m.subject.player_id ? players?.get(m.subject.player_id) : undefined;
    const line = m.subject.line ?? 0;
    if (done) return { over: propSoFar > line ? 1 : 0, under: propSoFar > line ? 0 : 1 };
    const frac = live && g ? minutesLeft(g) / 60 : 1;
    const perGame = p ? (p.proj / gamesOf(p)) * healthFactor(p.injury_status) : line;
    const mean = propSoFar + frac * perGame, sd = Math.sqrt(frac * Math.max(0.6, perGame * 1.4));
    const over = pAhead(mean - line, sd);
    return { over, under: 1 - over };
  }
  // goals: the pre-game moneyline sets each side's scoring rate; the live score and clock do the rest
  const oh = m.kind === 'winner' ? Number(m.options.find((o) => o.key === 'home')?.odds ?? 1.9) : 1.9;
  const oa = m.kind === 'winner' ? Number(m.options.find((o) => o.key === 'away')?.odds ?? 1.9) : 1.9;
  const ph = (1 / oh) / (1 / oh + 1 / oa);
  const lh = 3.05 * (1 + (ph - 0.5) * 0.9), la = 3.05 * (1 - (ph - 0.5) * 0.9);
  const hs = g?.home_score ?? 0, as = g?.away_score ?? 0;
  if (done) {
    const ot = /OT|SO/i.test(String(g!.period ?? ''));
    const r: Record<string, number> = { home: hs > as ? 1 : 0, away: as > hs ? 1 : 0, yes: ot ? 1 : 0, no: ot ? 0 : 1 };
    const line = m.subject.line ?? 6.5;
    r.over = hs + as > line ? 1 : 0; r.under = 1 - r.over;
    return pick(m, r);
  }
  const per = String(g?.period ?? '').toUpperCase();
  const inOT = !!live && (per.includes('OT') || per.includes('SO'));
  const f = live ? minutesLeft(g!) / 60 : 1;
  let pHome = 0, pAway = 0, pOT = 0, pOver = 0;
  const line = m.subject.line ?? 6.5;
  const share = lh / (lh + la);
  if (inOT) {
    pOT = 1; pHome = share; pAway = 1 - share; pOver = hs + as + 1 > line ? 1 : 0;
  } else {
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const w = poisson(lh * f, i) * poisson(la * f, j);
      const h = hs + i, a = as + j;
      if (h > a) pHome += w; else if (a > h) pAway += w; else { pOT += w; pHome += w * share; pAway += w * (1 - share); }
      if (h + a + (h === a ? 1 : 0) > line) pOver += w;
    }
  }
  return pick(m, { home: pHome, away: pAway, yes: pOT, no: 1 - pOT, over: pOver, under: 1 - pOver });
}
function pick(m: Market, r: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const o of m.options) if (r[o.key] != null) out[o.key] = Math.min(1, Math.max(0, r[o.key]));
  return Object.keys(out).length ? out : null;
}
