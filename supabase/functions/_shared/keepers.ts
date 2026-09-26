// Keeper grading shared by the site (Keepers page) and Garry's keeper report. Pure TypeScript.
// A team's keeper grade weighs what its keepers project to score, how close that is to the best set it
// could have kept, how many starting slots the keepers already fill, and injury risk; letters are
// league-relative (z-scores), like the draft report card.
import { lineupStrength, type GP } from './grades.ts';

export interface KP extends GP { name: string; injury_status?: string | null; nhl_team?: string | null }
export interface KeeperPick { player: KP; posRank: number; overallRank: number; tier: 'Elite' | 'Star' | 'Solid' | 'Depth' | 'Flyer'; grade: string; injured: boolean }
export interface TeamKeepers {
  team: number; keepers: KeeperPick[]; proj: number; bestProj: number; efficiency: number; starterPts: number;
  filled: number; gaps: string[]; injured: number; score: number; grade: string; rank: number;
  best: KeeperPick | null; weakest: KeeperPick | null; leftBehind: KP[]; submitted: boolean;
}

const LETTERS: [number, string][] = [[1.25, 'A+'], [0.75, 'A'], [0.35, 'B+'], [-0.05, 'B'], [-0.45, 'C+'], [-0.85, 'C'], [-1.3, 'D'], [-Infinity, 'F']];
const START: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2 };
const OUT = /^(out|injured reserve|ir|suspension|long)/i;

// a single keeper, judged against the whole pool: where he ranks at his position and overall
export function gradeKeeper(p: KP, byPos: Map<string, number[]>, all: number[]): KeeperPick {
  const posRank = (byPos.get(p.pos)?.findIndex((v) => v <= p.proj) ?? -1) + 1;
  const overallRank = all.findIndex((v) => v <= p.proj) + 1;
  const g = p.pos === 'G';
  const tier = posRank <= (g ? 5 : 10) ? 'Elite' : posRank <= (g ? 12 : 25) ? 'Star' : posRank <= (g ? 24 : 60) ? 'Solid' : posRank <= (g ? 40 : 110) ? 'Depth' : 'Flyer';
  const grade = overallRank <= 10 ? 'A+' : overallRank <= 25 ? 'A' : overallRank <= 50 ? 'A-' : overallRank <= 80 ? 'B+' : overallRank <= 120 ? 'B' : overallRank <= 180 ? 'B-' : overallRank <= 250 ? 'C+' : overallRank <= 350 ? 'C' : 'D';
  return { player: p, posRank, overallRank, tier, grade, injured: OUT.test(p.injury_status ?? '') };
}

// every team at once, so the letters are relative
export function gradeAllKeepers(
  teams: { id: number; submitted: boolean }[],
  keepersOf: (team: number) => KP[],          // the keepers as they stand (saved, or the default the site would use)
  eligibleOf: (team: number) => KP[],         // everyone the team could have kept (last season's roster minus the banned top scorer)
  pool: KP[], max = 6,
): Map<number, TeamKeepers> {
  const byPos = new Map<string, number[]>();
  for (const p of pool) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p.proj]);
  for (const v of byPos.values()) v.sort((a, b) => b - a);
  const all = pool.map((p) => p.proj).sort((a, b) => b - a);
  const rows = teams.map((t) => {
    const ks = keepersOf(t.id).map((p) => gradeKeeper(p, byPos, all)).sort((a, b) => b.player.proj - a.player.proj);
    const elig = eligibleOf(t.id);
    const proj = ks.reduce((s, k) => s + k.player.proj, 0);
    // the best set they could have kept: top projections, at most two goalies
    let g = 0; const best: KP[] = [];
    for (const p of [...elig].sort((a, b) => b.proj - a.proj)) { if (best.length >= max) break; if (p.pos === 'G') { if (g >= 2) continue; g++; } best.push(p); }
    const bestProj = best.reduce((s, p) => s + p.proj, 0);
    const lu = lineupStrength(ks.map((k) => k.player));
    const filledBy: Record<string, number> = {};
    for (const s of lu.starters) filledBy[s.slot] = (filledBy[s.slot] ?? 0) + 1;
    const gaps = Object.entries(START).filter(([s, n]) => (filledBy[s] ?? 0) < n).map(([s, n]) => `${n - (filledBy[s] ?? 0)} ${s}`);
    const injured = ks.filter((k) => k.injured).length;
    const efficiency = bestProj ? Math.round((proj / bestProj) * 100) : 100;
    const leftBehind = elig.filter((p) => !ks.some((k) => k.player.id === p.id)).sort((a, b) => b.proj - a.proj).slice(0, 3);
    // score: projected keeper points, a bonus for starters filled, a penalty for wasted value and injuries
    const score = proj + lu.starters.length * 12 - (100 - efficiency) * 3 - injured * 25;
    return { team: t.id, keepers: ks, proj: Math.round(proj), bestProj: Math.round(bestProj), efficiency, starterPts: Math.round(lu.starterPts), filled: lu.starters.length, gaps, injured, score, grade: '', rank: 0, best: ks[0] ?? null, weakest: ks[ks.length - 1] ?? null, leftBehind, submitted: t.submitted } as TeamKeepers;
  });
  const mean = rows.reduce((s, r) => s + r.score, 0) / Math.max(1, rows.length);
  const sd = Math.sqrt(rows.reduce((s, r) => s + (r.score - mean) ** 2, 0) / Math.max(1, rows.length)) || 1;
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  for (const r of rows) { const z = (r.score - mean) / sd; r.grade = LETTERS.find(([min]) => z >= min)![1]; r.rank = sorted.findIndex((x) => x.team === r.team) + 1; }
  return new Map(rows.map((r) => [r.team, r]));
}

export const gradeColorClass = (g: string) => (g.startsWith('A') ? 'text-emerald-300' : g.startsWith('B') ? 'text-sky-300' : g.startsWith('C') ? 'text-amber-300' : 'text-red-300');
