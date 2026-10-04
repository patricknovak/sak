// Trade evaluation: what a deal does to each team's best starting lineup, its depth and its position
// strength, plus a search for deals that help both sides. Values are rest-of-season fantasy points
// (the projection before the season, blended with pace once games are played); picks are worth
// about what the player taken there projects to, discounted for uncertainty.
// A deal is also about roster spots: the side that takes in more players than it sends has to drop its weakest
// (or the ones its GM names), and the side that sends more gets an open spot it can fill with the best free agent,
// if it has a pickup left. Free-agent pickups are worth what the best free agent adds over the roster's weakest
// player, less for each one a team already has. St. Patrick coins are shown but never counted as hockey value.
import type { DraftPick, Player, PlayerSeason, Standing } from './types';
import { flexMult, rosPoints } from './playerstats';
import { lineupStrength } from './grades';
import { gamesOf, rosPerGame } from './lineup';
import { forecastPlayoffs, forecastTeam, type FGame, type FPlayer } from './forecast';

export const NEED: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 3, G: 2 };
export const POS = ['C', 'LW', 'RW', 'D', 'G'];

const OUT = /^(out|ir|injured|long|suspen)/i;
export const healthy = (p: Player) => !p.injury_status || !OUT.test(p.injury_status);

export interface Valuer {
  player: (p: Player) => number;
  pick: (k: DraftPick) => number;
  fa: Player[];                                                   // healthy free agents, best first
  pickups: (roster: Player[], have: number, change: number) => number;   // what gaining (or losing) pickups is worth
}

export function makeValuer(players: Map<number, Player>, season: Map<number, PlayerSeason>, rostered: Set<number>, nTeams: number, currentSeason: string | undefined,
  perGame?: (p: Player) => number): Valuer {
  // rest-of-season points, with a premium for multi-position skaters (they fill more slots); a category league hands
  // its own per-game value on a points scale (catpickup's pointsScale), over the same games left
  const player = (p: Player) => (perGame ? perGame(p) * Math.max(0, gamesOf(p) - (season.get(p.id)?.gp ?? 0)) : rosPoints(p, season.get(p.id))) * flexMult(p);
  // the pool a pick draws from: everyone not on a roster, best first
  const free = [...players.values()].filter((p) => !rostered.has(p.id));
  const pool = free.map(player).sort((a, b) => b - a);
  const pick = (k: DraftPick) => {
    // the slot when it's known, otherwise the middle of its round
    const slot = k.overall ? k.overall - 1 : Math.max(0, (k.round - 1) * Math.max(1, nTeams) + Math.floor(nTeams / 2));
    const v = pool[Math.min(slot, pool.length - 1)] ?? 0;
    return v * (k.season === currentSeason ? 0.85 : 0.6);
  };
  const fa = free.filter(healthy).sort((a, b) => player(b) - player(a)).slice(0, 40);
  // one pickup buys the best free agent over your weakest player; each extra one is worth 60% of the one before
  const pickups = (roster: Player[], have: number, change: number) => {
    const worst = roster.length ? Math.min(...roster.map(player)) : 0;
    const gain = Math.max(3, (fa[0] ? player(fa[0]) : 0) - worst);
    const f = (k: number) => gain * (1 - Math.pow(0.6, Math.max(0, k))) / 0.4;
    return f(have + change) - f(have);
  };
  return { player, pick, fa, pickups };
}

// who a roster can spare, weakest first: someone whose position would drop below its starting spots goes last
export function dropOrder(roster: Player[], candidates: Player[], v: Valuer, n = candidates.length): Player[] {
  const left = Object.fromEntries(POS.map((k) => [k, roster.filter((p) => p.pos === k).length]));
  const pool = [...candidates].sort((a, b) => v.player(a) - v.player(b));
  const out: Player[] = [];
  while (out.length < Math.min(n, pool.length)) {
    const rest = pool.filter((p) => !out.includes(p));
    const pick = rest.find((p) => (left[p.pos] ?? 0) - 1 >= (NEED[p.pos] ?? 0)) ?? rest[0];
    out.push(pick); left[pick.pos] = (left[pick.pos] ?? 0) - 1;
  }
  return out;
}

export interface Side {
  team: number; before: Player[]; after: Player[]; picksOut: DraftPick[]; picksIn: DraftPick[];
  ir?: Set<number>;                          // players in IR slots: they don't take an active roster spot
  drops?: number[];                          // the players this GM has named to drop with the deal
  pickupsIn?: number; pickupsOut?: number;   // free-agent pickups changing hands
  pickupsLeft?: number;                      // this team's pickups before the deal
  coinsIn?: number; coinsOut?: number;       // St. Patrick coins changing hands (shown, not counted)
}
export interface SideEval {
  team: number;
  startersBefore: number; startersAfter: number; startersDelta: number;
  depthBefore: number; depthAfter: number;
  valueOut: number; valueIn: number; net: number;           // asset value leaving vs arriving (players, picks, pickups, roster spots)
  pos: { pos: string; before: number; after: number; delta: number }[];
  rosterAfter: number; warnings: string[];
  drops: { p: Player; named: boolean; value: number }[];    // who goes to make room
  fills: { p: Player; value: number }[];                    // the free agents an open spot brings in
  pickupValue: number;                                      // what the pickups in or out are worth (+ in, - out)
  coinsNet: number;
}

const posStrength = (ps: Player[], pos: string, val: (p: Player) => number) =>
  ps.filter((p) => p.pos === pos).map(val).sort((a, b) => b - a).slice(0, NEED[pos]).reduce((t, v) => t + v, 0);
const strength = (ps: Player[], val: (p: Player) => number) => {
  const r = lineupStrength(ps.map((p) => ({ id: p.id, pos: p.pos, elig: p.elig, proj: val(p) })));
  return { starters: r.starterPts, depth: r.bench.slice(0, 6).reduce((t, p) => t + p.proj, 0) };
};

// The schedule-aware lineup: each roster played out day by day over the rest of the real schedule (and the
// playoffs, from NHL playoff odds) with the best lineup each night. This is what makes a multi-position player
// worth more than his raw points: on nights a C is off, a C/LW keeps the slot filled.
export interface Sched {
  games: FGame[]; caps: Record<string, number>; from: string; to?: string;
  days?: Set<string>[];                       // synthetic playoff days (forecast.playoffDays)
  season: Map<number, PlayerSeason>;
  cache?: Map<string, number>;
  perGame?: (p: Player) => number;            // a category league's value per game on a points scale
}
const asF = (p: Player, sc: Sched): FPlayer => {
  const s = sc.season.get(p.id);
  const gp = p.proj_gp && p.proj_gp > 0 ? p.proj_gp : p.pos === 'G' ? 58 : 80;
  return { ...p, proj: (sc.perGame ? sc.perGame(p) : rosPerGame(Number(p.proj), p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp)) * gp, proj_gp: gamesOf(p) };
};
export function schedStarters(ps: Player[], sc: Sched, team = 0) {
  const key = ps.map((p) => p.id).sort((a, b) => a - b).join(',');
  const hit = sc.cache?.get(key);
  if (hit != null) return hit;
  const f = ps.map((p) => asF(p, sc));
  const v = forecastTeam(team, f, sc.games, sc.caps, sc.from, 0, sc.to).ros + (sc.days ? forecastPlayoffs(team, f, sc.days, sc.caps).ros : 0);
  sc.cache?.set(key, v);
  return v;
}

export function evaluateSide(s: Side, v: Valuer, rosterMax: number, sc?: Sched): SideEval {
  const ir = s.ir ?? new Set<number>();
  const active = (ps: Player[]) => ps.filter((p) => !ir.has(p.id)).length;
  const beforeIds = new Set(s.before.map((p) => p.id)), afterIds = new Set(s.after.map((p) => p.id));
  const out = s.before.filter((p) => !afterIds.has(p.id)), inn = s.after.filter((p) => !beforeIds.has(p.id));
  // too many players: the named drops go first, then the weakest of what's left (never someone just acquired)
  const named = (s.drops ?? []).map((id) => s.after.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const over = active(s.after) - rosterMax;
  const drops: SideEval['drops'] = named.map((p) => ({ p, named: true, value: v.player(p) }));
  const namedActive = named.filter((p) => !ir.has(p.id)).length;
  if (over - namedActive > 0) {
    const pool = s.after.filter((p) => !ir.has(p.id) && beforeIds.has(p.id) && !named.includes(p));
    const roster = s.after.filter((p) => !named.includes(p));
    for (const p of dropOrder(roster, pool, v, over - namedActive)) drops.push({ p, named: false, value: v.player(p) });
  }
  const dropIds = new Set(drops.map((d) => d.p.id));
  const kept = s.after.filter((p) => !dropIds.has(p.id));
  // fewer players: a new open spot goes to the best free agent, if there's a pickup to spend on it
  const pkAfter = (s.pickupsLeft ?? 3) + (s.pickupsIn ?? 0) - (s.pickupsOut ?? 0);
  const opened = Math.max(0, rosterMax - active(kept)) - Math.max(0, rosterMax - active(s.before));
  const fills: SideEval['fills'] = [];
  if (opened > 0 && pkAfter > 0) {
    for (const p of v.fa.filter((p) => !afterIds.has(p.id)).slice(0, Math.min(opened, pkAfter))) fills.push({ p, value: v.player(p) });
  }
  const final = [...kept, ...fills.map((f) => f.p)];
  const b = strength(s.before, v.player), a = strength(final, v.player);
  if (sc) { b.starters = schedStarters(s.before, sc, s.team); a.starters = schedStarters(final, sc, s.team); }
  // pickups changing hands, then the ones the open spots use
  const pkTrade = v.pickups(s.before, s.pickupsLeft ?? 3, (s.pickupsIn ?? 0) - (s.pickupsOut ?? 0));
  const pkUsed = fills.length ? -v.pickups(kept, pkAfter, -fills.length) : 0;
  const valueOut = out.reduce((t, p) => t + v.player(p), 0) + s.picksOut.reduce((t, k) => t + v.pick(k), 0)
    + drops.reduce((t, d) => t + d.value, 0) + Math.max(0, -pkTrade) + pkUsed;
  const valueIn = inn.reduce((t, p) => t + v.player(p), 0) + s.picksIn.reduce((t, k) => t + v.pick(k), 0)
    + fills.reduce((t, f) => t + f.value, 0) + Math.max(0, pkTrade);
  const pos = POS.map((pos) => { const bb = posStrength(s.before, pos, v.player), aa = posStrength(final, pos, v.player); return { pos, before: bb, after: aa, delta: aa - bb }; });
  const warnings: string[] = [];
  const count = (ps: Player[], k: string) => ps.filter((p) => p.pos === k).length;
  for (const k of POS) if (count(final, k) < NEED[k] && count(s.before, k) >= NEED[k]) warnings.push(`Only ${count(final, k)} ${k} left: can't fill ${NEED[k]} starting spot${NEED[k] > 1 ? 's' : ''}`);
  for (const p of inn) if (p.injury_status && OUT.test(p.injury_status)) warnings.push(`${p.name} is listed ${p.injury_status}`);
  return {
    team: s.team, startersBefore: b.starters, startersAfter: a.starters, startersDelta: a.starters - b.starters,
    depthBefore: b.depth, depthAfter: a.depth, valueOut, valueIn, net: valueIn - valueOut, pos, rosterAfter: active(final), warnings,
    drops, fills, pickupValue: pkTrade, coinsNet: (s.coinsIn ?? 0) - (s.coinsOut ?? 0),
  };
}

const lower = (n: string) => (n === 'You' ? 'you' : n);
// a plain-English read on a two-sided (or many-sided) evaluation
export function verdict(sides: SideEval[], names: (t: number) => string) {
  const gain = sides.map((s) => s.startersDelta);
  const allUp = gain.every((g) => g >= -2);
  const net = sides.map((s) => s.net);
  const spread = Math.max(...net) - Math.min(...net);
  if (sides.length === 2) {
    const [a, b] = sides;
    if (a.startersDelta > 3 && b.startersDelta > 3) return { tone: 'good' as const, text: 'Win-win: both starting lineups get better.' };
    if (spread > 60) { const w = net[0] > net[1] ? a : b; const n = names(w.team); return { tone: 'warn' as const, text: `Lopsided: ${n} come${n === 'You' ? '' : 's'} out ${Math.round(spread)} points of value ahead. Expect a counter.` }; }
    if (a.startersDelta > 3 && Math.abs(b.startersDelta) <= 3) return { tone: 'good' as const, text: `Good for ${lower(names(a.team))}, neutral for ${lower(names(b.team))}: a sensible ask.` };
    if (b.startersDelta > 3 && Math.abs(a.startersDelta) <= 3) return { tone: 'warn' as const, text: `This mostly helps ${lower(names(b.team))}. What are you getting for it?` };
    if (a.startersDelta < -3 && b.startersDelta < -3) return { tone: 'bad' as const, text: 'Both lineups get worse. Depth-for-depth deals rarely move the needle.' };
    return { tone: 'ok' as const, text: 'Fair: roughly even value, small lineup changes either way.' };
  }
  if (allUp) return { tone: 'good' as const, text: 'Everyone comes out even or better. That is how you sell a three-way.' };
  const loser = sides.reduce((m, s) => (s.startersDelta < m.startersDelta ? s : m));
  return { tone: 'warn' as const, text: names(loser.team) === 'You' ? 'Your lineup gets worse. Ask for something back.' : `${names(loser.team)} gets worse in the lineup. Give them something.` };
}

// standings context: are you buying or selling?
export function posture(me: number, standings: Standing[], progress: number) {
  const mine = standings.find((s) => s.team_id === me);
  if (!mine || standings.length < 3 || progress < 0.15) return null;
  const sorted = [...standings].sort((a, b) => a.rank - b.rank);
  const third = Number(sorted[Math.min(2, sorted.length - 1)].points), lead = Number(sorted[0].points), pts = Number(mine.points);
  const gapToMoney = third - pts, gapToLead = lead - pts;
  if (mine.rank <= 3) return { mode: 'buy' as const, text: `You're ${mine.rank === 1 ? 'leading' : `${Math.round(gapToLead)} back of the lead`} and in the money. Buy: trade depth and picks for starters.` };
  if (progress > 0.6 && gapToMoney > 60) return { mode: 'sell' as const, text: `${Math.round(gapToMoney)} points out of the money with ${Math.round((1 - progress) * 100)}% of the season left. Sell: move veterans for next year's picks and young upside.` };
  return { mode: 'buy' as const, text: `${Math.round(gapToMoney)} points out of 3rd. Still in it: target one clear upgrade at your weakest position.` };
}

// one team as the finder sees it: its roster, who's on IR, its pickups and its unused picks
export interface TeamCtx { team: number; roster: Player[]; ir?: Set<number>; pickupsLeft?: number; picks?: DraftPick[] }

export interface Suggestion {
  partner: number; give: Player[]; get: Player[]; me: SideEval; them: SideEval; score: number;
  givePicks: DraftPick[]; getPicks: DraftPick[]; givePk: number; getPk: number;   // picks and pickups that balance the deal
  kind: 'swap' | 'sell' | 'buy';
}
type Deal = { give: Player[]; get: Player[]; givePicks?: DraftPick[]; getPicks?: DraftPick[]; givePk?: number; getPk?: number };

// both sides of a deal, evaluated with everything that moves: players, picks, pickups and the roster spots
export function evalDeal(me: TeamCtx, them: TeamCtx, d: Deal, v: Valuer, rosterMax: number, sc?: Sched) {
  const giveIds = new Set(d.give.map((p) => p.id)), getIds = new Set(d.get.map((p) => p.id));
  const a = evaluateSide({ team: me.team, before: me.roster, after: [...me.roster.filter((p) => !giveIds.has(p.id)), ...d.get], ir: me.ir,
    picksOut: d.givePicks ?? [], picksIn: d.getPicks ?? [], pickupsOut: d.givePk ?? 0, pickupsIn: d.getPk ?? 0, pickupsLeft: me.pickupsLeft }, v, rosterMax, sc);
  const b = evaluateSide({ team: them.team, before: them.roster, after: [...them.roster.filter((p) => !getIds.has(p.id)), ...d.give], ir: them.ir,
    picksOut: d.getPicks ?? [], picksIn: d.givePicks ?? [], pickupsOut: d.getPk ?? 0, pickupsIn: d.givePk ?? 0, pickupsLeft: them.pickupsLeft }, v, rosterMax, sc);
  return { a, b };
}

// the smallest add-on (a pick or a pickup or two) from one side that closes a value gap of `gap` points
function sweetener(from: TeamCtx, gap: number, v: Valuer, used: Set<number> = new Set()): { picks: DraftPick[]; pk: number; value: number } | null {
  if (gap <= 0) return null;
  const opts: { picks: DraftPick[]; pk: number; value: number }[] = [];
  for (const k of (from.picks ?? []).filter((k) => !used.has(k.id))) opts.push({ picks: [k], pk: 0, value: v.pick(k) });
  for (let n = 1; n <= Math.min(3, from.pickupsLeft ?? 0); n++) opts.push({ picks: [], pk: n, value: -v.pickups(from.roster, from.pickupsLeft ?? 0, -n) });
  // the cheapest one that covers most of the gap without overpaying by much
  return opts.filter((o) => o.value >= gap * 0.7 && o.value <= gap * 1.8 + 6).sort((a, b) => a.value - b.value)[0] ?? null;
}

export interface FindOpts {
  minMine?: number; minTheirs?: number; top?: number; limit?: number; winWin?: boolean; sched?: Sched;
  wantPos?: string[];        // positions you want back (empty = any)
  givePos?: string[];        // positions you're willing to move (empty = any)
  balance?: boolean;         // add a pick or pickups to even out a close deal
  only?: (s: { partner: number; give: Player[]; get: Player[] }) => boolean;
}
const posOk = (ps: Player[], want?: string[]) => !want?.length || ps.some((p) => p.elig.some((e) => want.includes(e)) || want.includes(p.pos));

// deals that improve both starting lineups: 1-for-1, 2-for-1, 1-for-2 and 2-for-2 across the best players on each side.
// winWin (the default): both starting lineups must get better and the value has to stay close, so the other GM has a
// real reason to say yes. With balance on, a deal that's close but uneven gets the smallest pick or pickups that evens
// it. Ranked by the smaller of the two gains, so the fairest deals come first. Roster spots count: the side taking
// more players drops its weakest, the side sending more fills the spot from free agency.
export function findTrades(me: TeamCtx, partners: TeamCtx[], v: Valuer, rosterMax: number, opts: FindOpts = {}): Suggestion[] {
  const winWin = opts.winWin ?? true;
  const { minMine = winWin ? 2 : 4, minTheirs = winWin ? 2 : -1, top = 14, limit = 12, balance = true } = opts;
  // with the schedule to check against, the quick pass casts a wider net and the schedule decides
  const slack = opts.sched ? 8 : 0;
  const out: Suggestion[] = [];
  const byVal = (ps: Player[]) => [...ps].filter(healthy).sort((a, b) => v.player(b) - v.player(a)).slice(0, top);
  const mine = byVal(me.roster).filter((p) => posOk([p], opts.givePos));
  const seen = new Set<string>();
  const score = (a: SideEval, b: SideEval) => winWin
    ? Math.min(a.startersDelta, b.startersDelta) * 2 + (a.startersDelta + b.startersDelta) * 0.5 - Math.abs(a.net) * 0.1
    : a.startersDelta + Math.max(0, b.startersDelta) * 0.8 - Math.max(0, -b.net) * 0.2 - Math.max(0, -a.net - 30) * 0.15;
  for (const them of partners) {
    const theirs = byVal(them.roster);
    const tryDeal = (give: Player[], get: Player[]) => {
      if (opts.only && !opts.only({ partner: them.team, give, get })) return;
      if (!posOk(get, opts.wantPos)) return;
      const key = `${them.team}:${give.map((p) => p.id).sort().join(',')}>${get.map((p) => p.id).sort().join(',')}`;
      if (seen.has(key)) return; seen.add(key);
      let d: Deal = { give, get };
      let { a, b } = evalDeal(me, them, d, v, rosterMax);
      if (a.startersDelta < minMine - slack) return;
      if (b.startersDelta < minTheirs - slack || b.warnings.some((w) => w.startsWith('Only'))) return;
      // close but uneven: even it out with the smallest pick or pickups from the side that's ahead
      if (balance && (b.net < -25 || (winWin && a.net > 45))) {
        const sw = sweetener(me, b.net < -25 ? -b.net - 10 : a.net - 25, v);
        if (sw) { d = { ...d, givePicks: sw.picks, givePk: sw.pk }; ({ a, b } = evalDeal(me, them, d, v, rosterMax)); }
      } else if (balance && winWin && a.net < -45) {
        const sw = sweetener(them, -a.net - 25, v);
        if (sw) { d = { ...d, getPicks: sw.picks, getPk: sw.pk }; ({ a, b } = evalDeal(me, them, d, v, rosterMax)); }
      }
      // fairness: the partner has to see value too, or they'll never say yes; and you shouldn't be fleeced either
      if (b.net < -25 || a.net < -70) return;
      if (winWin && Math.abs(a.net) > 45) return;
      if (a.startersDelta < minMine - slack || b.startersDelta < minTheirs - slack) return;
      out.push({ partner: them.team, give, get, me: a, them: b, score: score(a, b), givePicks: d.givePicks ?? [], getPicks: d.getPicks ?? [], givePk: d.givePk ?? 0, getPk: d.getPk ?? 0, kind: 'swap' });
    };
    for (const g of mine) for (const r of theirs) {
      if (g.id === r.id) continue;
      tryDeal([g], [r]);
    }
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) for (const r of theirs) tryDeal([mine[i], mine[j]], [r]);
    for (const g of mine) for (let i = 0; i < theirs.length; i++) for (let j = i + 1; j < theirs.length; j++) tryDeal([g], [theirs[i], theirs[j]]);
    // two for two: where most win-win deals live (each side swaps surplus for need), top 8 on each side
    const m8 = mine.slice(0, 8), t8 = theirs.slice(0, 8);
    for (let i = 0; i < m8.length; i++) for (let j = i + 1; j < m8.length; j++) for (let k = 0; k < t8.length; k++) for (let l = k + 1; l < t8.length; l++) tryDeal([m8[i], m8[j]], [t8[k], t8[l]]);
  }
  // the quick pass above ranks deals on a static best lineup; the best of them are re-scored on the real schedule
  // (daily lineups, multi-position flexibility, the playoffs) and must still help both sides
  let sorted = out.sort((a, b) => b.score - a.score);
  if (opts.sched) {
    const sc = { ...opts.sched, cache: opts.sched.cache ?? new Map<string, number>() };
    sorted = sorted.slice(0, 120).map((x) => {
      const them = partners.find((p) => p.team === x.partner)!;
      const { a, b } = evalDeal(me, them, x, v, rosterMax, sc);
      return { ...x, me: a, them: b, score: score(a, b) };
    }).filter((x) => x.me.startersDelta >= minMine && x.them.startersDelta >= minTheirs).sort((a, b) => b.score - a.score);
  }
  return varied(sorted, partners.length, limit);
}

// variety: the best version of each ask, at most one deal per player you'd receive, a few per partner
function varied(sorted: Suggestion[], nPartners: number, limit: number) {
  const picked: Suggestion[] = [];
  const perPartner = new Map<number, number>(), gotPlayer = new Set<string>();
  const maxPer = nPartners > 1 ? 3 : limit;
  for (const s of sorted) {
    const gk = s.get.map((p) => p.id).sort().join(',');
    if (gotPlayer.has(`${s.partner}:${gk}`) || (perPartner.get(s.partner) ?? 0) >= maxPer) continue;
    gotPlayer.add(`${s.partner}:${gk}`); perPartner.set(s.partner, (perPartner.get(s.partner) ?? 0) + 1);
    picked.push(s);
    if (picked.length >= limit) break;
  }
  return picked;
}

// the packages one team could offer from its picks and pickups (at most two picks and three pickups)
function packages(t: TeamCtx, v: Valuer) {
  const ks = [...(t.picks ?? [])].sort((a, b) => v.pick(b) - v.pick(a)).slice(0, 6);
  const pickSets: DraftPick[][] = [[]];
  for (let i = 0; i < ks.length; i++) { pickSets.push([ks[i]]); for (let j = i + 1; j < ks.length; j++) pickSets.push([ks[i], ks[j]]); }
  const out: { picks: DraftPick[]; pk: number }[] = [];
  for (const ps of pickSets) for (let n = 0; n <= Math.min(3, t.pickupsLeft ?? 0); n++) if (ps.length || n) out.push({ picks: ps, pk: n });
  return out;
}

// selling: your player (or players) for picks and pickups, no player back. Every GM's best fair package, ranked by
// how much your player helps their lineup (who wants him most), then by how close the value is.
export function sellPlayers(me: TeamCtx, give: Player[], partners: TeamCtx[], v: Valuer, rosterMax: number, limit = 8): Suggestion[] {
  const out: Suggestion[] = [];
  for (const them of partners) {
    let best: Suggestion | null = null;
    for (const pk of packages(them, v)) {
      const { a, b } = evalDeal(me, them, { give, get: [], getPicks: pk.picks, getPk: pk.pk }, v, rosterMax);
      if (b.startersDelta < 1 || b.net < -30 || a.net < -Math.max(15, a.valueOut * 0.25)) continue;
      const s: Suggestion = { partner: them.team, give, get: [], me: a, them: b, givePicks: [], getPicks: pk.picks, givePk: 0, getPk: pk.pk, kind: 'sell',
        score: b.startersDelta - Math.abs(a.net) * 0.3 - pk.picks.length - pk.pk * 0.5 };
      if (!best || s.score > best.score) best = s;
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// buying: their player for your picks and pickups (and, if it takes one, a bench player of yours). The cheapest fair
// offer per target, ranked by what the player adds to your lineup per point of value you pay.
export function buyPlayers(me: TeamCtx, partners: TeamCtx[], v: Valuer, rosterMax: number, opts: { wantPos?: string[]; target?: number; limit?: number } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const bench = [...me.roster].filter(healthy).sort((a, b) => v.player(a) - v.player(b)).slice(0, 6);
  for (const them of partners) {
    const targets = [...them.roster].filter(healthy).filter((p) => (opts.target ? p.id === opts.target : posOk([p], opts.wantPos)))
      .sort((a, b) => v.player(b) - v.player(a)).slice(0, opts.target ? 1 : 10);
    for (const t of targets) {
      let best: Suggestion | null = null;
      const tries: Deal[] = [];
      for (const pk of packages(me, v)) { tries.push({ give: [], get: [t], givePicks: pk.picks, givePk: pk.pk }); for (const bp of bench.slice(0, 3)) tries.push({ give: [bp], get: [t], givePicks: pk.picks, givePk: pk.pk }); }
      for (const bp of bench) tries.push({ give: [bp], get: [t] });
      for (const d of tries) {
        const { a, b } = evalDeal(me, them, d, v, rosterMax);
        if (a.startersDelta < 2 || b.net < -10 || b.warnings.some((w) => w.startsWith('Only'))) continue;
        const cost = a.valueOut;
        const s: Suggestion = { partner: them.team, give: d.give, get: d.get, me: a, them: b, givePicks: d.givePicks ?? [], getPicks: [], givePk: d.givePk ?? 0, getPk: 0, kind: 'buy',
          score: a.startersDelta * 10 / Math.max(10, cost) - Math.max(0, b.net - 20) * 0.02 };
        if (!best || cost < best.me.valueOut) best = s;
      }
      if (best) out.push(best);
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 10);
}

// where each team stands at each position against the league (1 = best), and the partners whose surplus fits your
// need and whose need fits your surplus
export function positionRanks(teams: TeamCtx[], v: Valuer) {
  const strengthOf = new Map(teams.map((t) => [t.team, Object.fromEntries(POS.map((p) => [p, posStrength(t.roster, p, v.player)])) as Record<string, number>]));
  const rank = new Map<number, Record<string, number>>();
  for (const t of teams) rank.set(t.team, Object.fromEntries(POS.map((p) => [p, teams.filter((o) => strengthOf.get(o.team)![p] > strengthOf.get(t.team)![p]).length + 1])) as Record<string, number>);
  return rank;
}
export function partnerFit(me: number, rank: Map<number, Record<string, number>>, n: number) {
  const mine = rank.get(me);
  if (!mine) return [];
  const mid = (n + 1) / 2;
  return [...rank.entries()].filter(([t]) => t !== me).map(([t, r]) => {
    // you're weak where they're strong (they can give), and strong where they're weak (you can give)
    const theyGive = POS.filter((p) => mine[p] > mid && r[p] < mid).sort((a, b) => (mine[b] - r[b]) - (mine[a] - r[a]));
    const youGive = POS.filter((p) => mine[p] < mid && r[p] > mid).sort((a, b) => (r[b] - mine[b]) - (r[a] - mine[a]));
    const score = theyGive.reduce((t, p) => t + mine[p] - r[p], 0) + youGive.reduce((t, p) => t + r[p] - mine[p], 0) + (theyGive.length && youGive.length ? 3 : 0);
    return { team: t, theyGive, youGive, score };
  }).sort((a, b) => b.score - a.score);
}

// A letter grade and a written assessment for each side of a deal. Lineup impact counts most (that's what wins
// the season), then value in and out (what the deal is worth in trade and next year), then depth, with
// penalties for holes it opens, injured arrivals and roster overflow.
export interface SideGrade { team: number; grade: string; score: number; notes: { tone: 'good' | 'bad' | 'info'; text: string }[] }
const LETTERS: [number, string][] = [[25, 'A+'], [15, 'A'], [8, 'A-'], [3, 'B+'], [-3, 'B'], [-8, 'B-'], [-15, 'C+'], [-25, 'C'], [-40, 'D']];
export const tradeLetter = (score: number) => LETTERS.find(([min]) => score >= min)?.[1] ?? 'F';
export function gradeSide(e: SideEval, extra: { outAge?: number | null; inAge?: number | null; name?: string; coin?: string } = {}): SideGrade {
  const depth = e.depthAfter - e.depthBefore;
  let score = e.startersDelta + e.net * 0.25 + depth * 0.1;
  const notes: SideGrade['notes'] = [];
  const r = (n: number) => Math.round(Math.abs(n));
  if (Math.abs(e.startersDelta) >= 2) notes.push({ tone: e.startersDelta > 0 ? 'good' : 'bad', text: `Best lineup ${e.startersDelta > 0 ? 'gains' : 'loses'} about ${r(e.startersDelta)} projected points the rest of the way.` });
  else notes.push({ tone: 'info', text: 'Barely moves the starting lineup.' });
  const up = e.pos.filter((p) => p.delta >= 3).map((p) => p.pos), down = e.pos.filter((p) => p.delta <= -3).map((p) => p.pos);
  if (up.length) notes.push({ tone: 'good', text: `Stronger at ${up.join(', ')}.` });
  if (down.length) notes.push({ tone: 'bad', text: `Weaker at ${down.join(', ')}.` });
  if (Math.abs(e.net) >= 10) notes.push({ tone: e.net > 0 ? 'good' : 'bad', text: `${e.net > 0 ? 'Wins' : 'Loses'} the value count by about ${r(e.net)} points (${Math.round(e.valueIn)} in, ${Math.round(e.valueOut)} out).` });
  if (e.net < -20 && e.startersDelta > 3) notes.push({ tone: 'info', text: 'Pays a premium for a lineup upgrade: consolidation. Worth it if the depth going out was sitting on the bench.' });
  if (e.net > 20 && e.startersDelta < -3) notes.push({ tone: 'info', text: 'More total value but a weaker lineup now: a long-game move.' });
  if (extra.inAge != null && extra.outAge != null && Math.abs(extra.inAge - extra.outAge) >= 3) notes.push({ tone: 'info', text: `Gets ${extra.inAge < extra.outAge ? 'younger' : 'older'}: average age in ${extra.inAge.toFixed(0)} vs out ${extra.outAge.toFixed(0)}.` });
  // roster spots: who goes to make room, and what an open spot brings in
  const named = e.drops.filter((d) => d.named), auto = e.drops.filter((d) => !d.named);
  if (named.length) notes.push({ tone: 'info', text: `Drops ${named.map((d) => `${d.p.name} (${r(d.value)})`).join(', ')} to make room.` });
  if (auto.length) notes.push({ tone: 'bad', text: `One player too many: has to drop ${auto.map((d) => `${d.p.name}, the weakest he can spare (${r(d.value)} pts the rest of the way)`).join(' and ')}. That's counted.` });
  if (e.fills.length) notes.push({ tone: 'good', text: `Frees a roster spot: ${e.fills.map((f) => `${f.p.name} (${r(f.value)})`).join(', ')}, the best free agent, can fill it with a pickup.` });
  if (Math.abs(e.pickupValue) >= 1) notes.push({ tone: e.pickupValue > 0 ? 'good' : 'bad', text: `Pickups ${e.pickupValue > 0 ? 'in' : 'out'}: worth about ${r(e.pickupValue)} points (what the best free agents add over the weakest player, less for each one already in hand).` });
  if (e.coinsNet) notes.push({ tone: 'info', text: `${e.coinsNet > 0 ? 'Gets' : 'Pays'} ${Math.abs(e.coinsNet).toLocaleString()} ${extra.coin ?? 'coins'}: side-bet money, not counted in the grade.` });
  for (const w of e.warnings) { notes.push({ tone: 'bad', text: w }); score -= w.startsWith('Only') ? 12 : 6; }
  return { team: e.team, grade: tradeLetter(score), score, notes };
}
