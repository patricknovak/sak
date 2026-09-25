// Trade evaluation: what a deal does to each team's best starting lineup, its depth and its position
// strength, plus a search for deals that help both sides. Values are rest-of-season fantasy points
// (the projection before the season, blended with pace once games are played); picks are worth
// about what the player taken there projects to, discounted for uncertainty.
import type { DraftPick, Player, PlayerSeason, Standing } from './types';
import { rosPoints } from './playerstats';
import { lineupStrength } from './grades';

export const NEED: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 3, G: 2 };
export const POS = ['C', 'LW', 'RW', 'D', 'G'];

export interface Valuer { player: (p: Player) => number; pick: (k: DraftPick) => number }

export function makeValuer(players: Map<number, Player>, season: Map<number, PlayerSeason>, rostered: Set<number>, nTeams: number, currentSeason: string | undefined): Valuer {
  const player = (p: Player) => rosPoints(p, season.get(p.id));
  // the pool a pick draws from: everyone not on a roster, best first
  const pool = [...players.values()].filter((p) => !rostered.has(p.id)).map(player).sort((a, b) => b - a);
  const pick = (k: DraftPick) => {
    const slot = Math.max(0, (k.round - 1) * Math.max(1, nTeams) + Math.floor(nTeams / 2));
    const v = pool[Math.min(slot, pool.length - 1)] ?? 0;
    return v * (k.season === currentSeason ? 0.85 : 0.6);
  };
  return { player, pick };
}

export interface Side { team: number; before: Player[]; after: Player[]; picksOut: DraftPick[]; picksIn: DraftPick[] }
export interface SideEval {
  team: number;
  startersBefore: number; startersAfter: number; startersDelta: number;
  depthBefore: number; depthAfter: number;
  valueOut: number; valueIn: number; net: number;           // asset value leaving vs arriving (players + picks)
  pos: { pos: string; before: number; after: number; delta: number }[];
  rosterAfter: number; warnings: string[];
}

const posStrength = (ps: Player[], pos: string, val: (p: Player) => number) =>
  ps.filter((p) => p.pos === pos).map(val).sort((a, b) => b - a).slice(0, NEED[pos]).reduce((t, v) => t + v, 0);
const strength = (ps: Player[], val: (p: Player) => number) => {
  const r = lineupStrength(ps.map((p) => ({ id: p.id, pos: p.pos, elig: p.elig, proj: val(p) })));
  return { starters: r.starterPts, depth: r.bench.slice(0, 6).reduce((t, p) => t + p.proj, 0) };
};

export function evaluateSide(s: Side, v: Valuer, rosterMax: number): SideEval {
  const b = strength(s.before, v.player), a = strength(s.after, v.player);
  const beforeIds = new Set(s.before.map((p) => p.id)), afterIds = new Set(s.after.map((p) => p.id));
  const out = s.before.filter((p) => !afterIds.has(p.id)), inn = s.after.filter((p) => !beforeIds.has(p.id));
  const valueOut = out.reduce((t, p) => t + v.player(p), 0) + s.picksOut.reduce((t, k) => t + v.pick(k), 0);
  const valueIn = inn.reduce((t, p) => t + v.player(p), 0) + s.picksIn.reduce((t, k) => t + v.pick(k), 0);
  const pos = POS.map((pos) => { const bb = posStrength(s.before, pos, v.player), aa = posStrength(s.after, pos, v.player); return { pos, before: bb, after: aa, delta: aa - bb }; });
  const warnings: string[] = [];
  const count = (ps: Player[], k: string) => ps.filter((p) => p.pos === k).length;
  for (const k of POS) if (count(s.after, k) < NEED[k] && count(s.before, k) >= NEED[k]) warnings.push(`Only ${count(s.after, k)} ${k} left: can't fill ${NEED[k]} starting spot${NEED[k] > 1 ? 's' : ''}`);
  if (s.after.length > rosterMax) warnings.push(`${s.after.length} players after the deal: ${s.after.length - rosterMax} to drop before it can go through`);
  for (const p of inn) if (p.injury_status && /^(out|ir|injured|long|suspend)/i.test(p.injury_status)) warnings.push(`${p.name} is listed ${p.injury_status}`);
  return {
    team: s.team, startersBefore: b.starters, startersAfter: a.starters, startersDelta: a.starters - b.starters,
    depthBefore: b.depth, depthAfter: a.depth, valueOut, valueIn, net: valueIn - valueOut, pos, rosterAfter: s.after.length, warnings,
  };
}

// a plain-English read on a two-sided (or many-sided) evaluation
export function verdict(sides: SideEval[], names: (t: number) => string) {
  const gain = sides.map((s) => s.startersDelta);
  const allUp = gain.every((g) => g >= -2);
  const net = sides.map((s) => s.net);
  const spread = Math.max(...net) - Math.min(...net);
  if (sides.length === 2) {
    const [a, b] = sides;
    if (a.startersDelta > 3 && b.startersDelta > 3) return { tone: 'good' as const, text: 'Win-win: both starting lineups get better.' };
    if (spread > 60) { const w = net[0] > net[1] ? a : b; return { tone: 'warn' as const, text: `Lopsided: ${names(w.team)} comes out ${Math.round(spread)} points of value ahead. Expect a counter.` }; }
    if (a.startersDelta > 3 && Math.abs(b.startersDelta) <= 3) return { tone: 'good' as const, text: `Good for ${names(a.team)}, neutral for ${names(b.team)}: a sensible ask.` };
    if (b.startersDelta > 3 && Math.abs(a.startersDelta) <= 3) return { tone: 'warn' as const, text: `This mostly helps ${names(b.team)}. What are you getting for it?` };
    if (a.startersDelta < -3 && b.startersDelta < -3) return { tone: 'bad' as const, text: 'Both lineups get worse. Depth-for-depth deals rarely move the needle.' };
    return { tone: 'ok' as const, text: 'Fair: roughly even value, small lineup changes either way.' };
  }
  if (allUp) return { tone: 'good' as const, text: 'Everyone comes out even or better. That is how you sell a three-way.' };
  const loser = sides.reduce((m, s) => (s.startersDelta < m.startersDelta ? s : m));
  return { tone: 'warn' as const, text: `${names(loser.team)} gets worse in the lineup. Give them something.` };
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

export interface Suggestion { partner: number; give: Player[]; get: Player[]; me: SideEval; them: SideEval; score: number }

// deals that improve both starting lineups: 1-for-1, 2-for-1 and 1-for-2 across the best players on each side
export function findTrades(me: number, myRoster: Player[], partners: { team: number; roster: Player[] }[], v: Valuer, rosterMax: number, opts: { minMine?: number; minTheirs?: number; top?: number; limit?: number } = {}): Suggestion[] {
  const { minMine = 4, minTheirs = -1, top = 14, limit = 12 } = opts;
  const out: Suggestion[] = [];
  const healthy = (p: Player) => !p.injury_status || !/^(out|ir|injured|long|suspend)/i.test(p.injury_status);
  const byVal = (ps: Player[]) => [...ps].filter(healthy).sort((a, b) => v.player(b) - v.player(a)).slice(0, top);
  const mine = byVal(myRoster);
  const seen = new Set<string>();
  for (const { team, roster } of partners) {
    const theirs = byVal(roster);
    const tryDeal = (give: Player[], get: Player[]) => {
      const key = `${team}:${give.map((p) => p.id).sort().join(',')}>${get.map((p) => p.id).sort().join(',')}`;
      if (seen.has(key)) return; seen.add(key);
      const giveIds = new Set(give.map((p) => p.id)), getIds = new Set(get.map((p) => p.id));
      const myAfter = [...myRoster.filter((p) => !giveIds.has(p.id)), ...get];
      const theirAfter = [...roster.filter((p) => !getIds.has(p.id)), ...give];
      const a = evaluateSide({ team: me, before: myRoster, after: myAfter, picksOut: [], picksIn: [] }, v, rosterMax);
      if (a.startersDelta < minMine) return;
      const b = evaluateSide({ team, before: roster, after: theirAfter, picksOut: [], picksIn: [] }, v, rosterMax);
      if (b.startersDelta < minTheirs || b.warnings.some((w) => w.startsWith('Only'))) return;
      // fairness: the partner has to see value too, or they'll never say yes; and you shouldn't be fleeced either
      if (b.net < -25 || a.net < -70) return;
      out.push({ partner: team, give, get, me: a, them: b, score: a.startersDelta + Math.max(0, b.startersDelta) * 0.8 - Math.max(0, -b.net) * 0.2 - Math.max(0, -a.net - 30) * 0.15 });
    };
    for (const g of mine) for (const r of theirs) {
      if (g.id === r.id) continue;
      tryDeal([g], [r]);
    }
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) for (const r of theirs) tryDeal([mine[i], mine[j]], [r]);
    for (const g of mine) for (let i = 0; i < theirs.length; i++) for (let j = i + 1; j < theirs.length; j++) tryDeal([g], [theirs[i], theirs[j]]);
  }
  // variety: the best version of each ask, at most one deal per player you'd receive, a few per partner
  const sorted = out.sort((a, b) => b.score - a.score);
  const picked: Suggestion[] = [];
  const perPartner = new Map<number, number>(), gotPlayer = new Set<string>();
  const maxPer = partners.length > 1 ? 3 : limit;
  for (const s of sorted) {
    const gk = s.get.map((p) => p.id).sort().join(',');
    if (gotPlayer.has(`${s.partner}:${gk}`) || (perPartner.get(s.partner) ?? 0) >= maxPer) continue;
    gotPlayer.add(`${s.partner}:${gk}`); perPartner.set(s.partner, (perPartner.get(s.partner) ?? 0) + 1);
    picked.push(s);
    if (picked.length >= limit) break;
  }
  return picked;
}
