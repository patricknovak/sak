// Draft brains shared by the mock draft and the live draft room: what a roster still needs, how a bot GM
// picks, a full simulation of the draft as it stands, and the odds a player is still there at your pick.
import type { Player } from './types';

export interface SimPick { overall: number; round: number; team: number; original: number; pid: number | null }
export type StartSlot = 'C' | 'LW' | 'RW' | 'D' | 'Util' | 'G';
export const START_SLOTS: StartSlot[] = ['C', 'LW', 'RW', 'D', 'Util', 'G'];
export const DEFAULT_CAPS: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2, BN: 12, IR: 2 };
// a sane ceiling per position so bots don't draft nine defencemen
const POS_CAP: Record<string, number> = { C: 7, LW: 7, RW: 7, D: 9, G: 4 };

export interface Needs {
  filled: Record<StartSlot, Player[]>;      // who fills each starting slot (best projected first)
  open: Record<StartSlot, number>;          // starting slots still empty
  bench: Player[];                          // everyone else
  benchOpen: number;                        // bench spots left
  total: number;                            // roster spots left (starters + bench)
  gaps: string[];                           // "1 LW", "2 G" …
}

// greedy lineup: scarce slots first, best projected player who's eligible, Util takes any skater
export function needsOf(ps: Player[], caps: Record<string, number> = DEFAULT_CAPS): Needs {
  const skaters = [...ps].filter((p) => p.pos !== 'G').sort((a, b) => b.proj - a.proj);
  const goalies = [...ps].filter((p) => p.pos === 'G').sort((a, b) => b.proj - a.proj);
  const used = new Set<number>();
  const filled = { C: [], LW: [], RW: [], D: [], Util: [], G: [] } as Record<StartSlot, Player[]>;
  for (const slot of ['C', 'LW', 'RW', 'D'] as const) {
    for (let i = 0; i < (caps[slot] ?? 0); i++) {
      const pick = skaters.find((x) => !used.has(x.id) && x.elig.includes(slot));
      if (pick) { used.add(pick.id); filled[slot].push(pick); }
    }
  }
  for (let i = 0; i < (caps.Util ?? 0); i++) { const pick = skaters.find((x) => !used.has(x.id)); if (pick) { used.add(pick.id); filled.Util.push(pick); } }
  for (let i = 0; i < (caps.G ?? 0); i++) { const pick = goalies.find((x) => !used.has(x.id)); if (pick) { used.add(pick.id); filled.G.push(pick); } }
  const open = Object.fromEntries(START_SLOTS.map((s) => [s, Math.max(0, (caps[s] ?? 0) - filled[s].length)])) as Record<StartSlot, number>;
  const bench = ps.filter((p) => !used.has(p.id)).sort((a, b) => b.proj - a.proj);
  const starters = START_SLOTS.reduce((n, s) => n + (caps[s] ?? 0), 0);
  const total = Math.max(0, starters + (caps.BN ?? 0) - ps.length);
  const benchOpen = Math.max(0, (caps.BN ?? 0) - bench.length);
  const gaps = START_SLOTS.filter((s) => open[s] > 0).map((s) => `${open[s]} ${s}`);
  return { filled, open, bench, benchOpen, total, gaps };
}

// where a player would go on this roster right now
export function fitFor(p: Player, n: Needs): StartSlot | 'BN' {
  if (p.pos === 'G') return n.open.G > 0 ? 'G' : 'BN';
  for (const s of ['C', 'LW', 'RW', 'D'] as const) if (n.open[s] > 0 && p.elig.includes(s)) return s;
  return n.open.Util > 0 ? 'Util' : 'BN';
}

// a seeded random so a simulation can be replayed
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// how a bot GM picks: best projection with a little chaos, leaning to open starting slots, goalies in time,
// never a fourth goalie or a ninth defenceman, and a discount on anyone listed Out
export function botChoose(mine: Player[], avail: Player[], round: number, rounds: number, rand: () => number, caps = DEFAULT_CAPS): Player | undefined {
  const n = needsOf(mine, caps);
  const count = (k: string) => mine.filter((p) => p.pos === k).length;
  const late = round > rounds - 5;
  const cands = avail.filter((p) => count(p.pos) < (POS_CAP[p.pos] ?? 9)).slice(0, 45).map((p) => {
    let v = p.proj * (0.92 + rand() * 0.16);
    const fit = fitFor(p, n);
    if (fit !== 'BN') v *= fit === 'G' ? (round >= 3 ? 1.22 : 1.05) : 1.12;
    else v *= late ? 0.7 : 0.85;
    if (p.pos === 'G' && count('G') >= 3) v *= 0.4;
    if (p.injury_status === 'Out' || p.injury_status === 'Suspension' || p.injury_status === 'Injured Reserve') v *= 0.8;
    if (n.total <= 0) v *= 0.5;
    return { p, v };
  }).sort((a, b) => b.v - a.v);
  if (!cands.length) return avail[0];
  return (rand() < 0.15 ? cands[Math.floor(rand() * Math.min(3, cands.length))] : cands[0]).p;
}

export interface SimOptions { rounds: number; human?: number; stopAt?: 'human' | 'end'; queues?: Map<number, number[]>; rand?: () => number; caps?: Record<string, number> }
// run the draft from where it stands: bots for everyone (or everyone but `human`), stopping at the human's
// next pick or the end. `pool` is every draftable player sorted by projection.
export function simulateDraft(board: SimPick[], keepers: Map<number, number[]>, pool: Player[], byId: Map<number, Player>, opts: SimOptions): SimPick[] {
  const rand = opts.rand ?? Math.random;
  const out = board.map((b) => ({ ...b }));
  const taken = new Set(out.filter((b) => b.pid).map((b) => b.pid!));
  const rosters = new Map<number, Player[]>();
  const roster = (t: number) => {
    if (!rosters.has(t)) rosters.set(t, [...(keepers.get(t) ?? []), ...out.filter((b) => b.team === t && b.pid).map((b) => b.pid!)].map((id) => byId.get(id)).filter(Boolean) as Player[]);
    return rosters.get(t)!;
  };
  let avail = pool.filter((p) => !taken.has(p.id));
  for (const pk of out) {
    if (pk.pid) continue;
    if (opts.human != null && pk.team === opts.human && opts.stopAt !== 'end') break;
    let choice: Player | undefined;
    const q = opts.queues?.get(pk.team);
    if (q) { const qid = q.find((id) => !taken.has(id)); if (qid) choice = byId.get(qid); }
    if (!choice) choice = botChoose(roster(pk.team), avail, pk.round, opts.rounds, rand, opts.caps);
    if (!choice) break;
    pk.pid = choice.id; taken.add(choice.id); roster(pk.team).push(choice);
    avail = avail.filter((p) => p.id !== choice!.id);
  }
  return out;
}

export interface Outlook { picks: number[]; odds: Map<number, number[]> }   // my pick overalls, and per player the chance he's there at each
// run the draft many times with everyone (me included) on bot logic, and count how often each player is still
// on the board when each of my picks comes up
export function availabilityOdds(board: SimPick[], keepers: Map<number, number[]>, pool: Player[], byId: Map<number, Player>, me: number, rounds: number, sims = 25, caps = DEFAULT_CAPS): Outlook {
  const picks = board.filter((b) => b.team === me && !b.pid).map((b) => b.overall).slice(0, 4);
  const odds = new Map<number, number[]>();
  const watch = pool.slice(0, 120);
  for (const p of watch) odds.set(p.id, picks.map(() => 0));
  for (let s = 0; s < sims; s++) {
    const res = simulateDraft(board, keepers, pool, byId, { rounds, rand: rng(1000 + s * 7919), caps, stopAt: 'end' });
    picks.forEach((ov, i) => {
      const gone = new Set(res.filter((b) => b.pid && b.overall < ov).map((b) => b.pid!));
      for (const p of watch) if (!gone.has(p.id)) odds.get(p.id)![i]++;
    });
  }
  for (const v of odds.values()) for (let i = 0; i < v.length; i++) v[i] = Math.round((v[i] / sims) * 100);
  return { picks, odds };
}
