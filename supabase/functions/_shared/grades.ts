// Draft grading shared by the site (mock + real draft report card) and Garry's draft recap.
// Pure TypeScript, no Deno or DOM APIs, so both runtimes can import it.
export interface GP { id: number; pos: string; elig: string[]; proj: number }

// SaK starting lineup: 2C 2LW 2RW 3D 1Util 2G
const SKATER_SLOTS: { slot: string; n: number }[] = [{ slot: 'C', n: 2 }, { slot: 'LW', n: 2 }, { slot: 'RW', n: 2 }, { slot: 'D', n: 3 }];

// best projected lineup from a roster (greedy: fill the scarcest slots first), plus bench depth
export function lineupStrength<P extends GP>(ps: P[]) {
  const goalies = ps.filter((p) => p.pos === 'G').sort((a, b) => b.proj - a.proj);
  const skaters = ps.filter((p) => p.pos !== 'G').sort((a, b) => b.proj - a.proj);
  const used = new Set<number>();
  const starters: { slot: string; p: P }[] = [];
  // fill each position slot with the best eligible skater still available
  for (const { slot, n } of SKATER_SLOTS) {
    for (let i = 0; i < n; i++) {
      const pick = skaters.find((x) => !used.has(x.id) && x.elig.includes(slot));
      if (pick) { used.add(pick.id); starters.push({ slot, p: pick }); }
    }
  }
  const util = skaters.find((x) => !used.has(x.id));
  if (util) { used.add(util.id); starters.push({ slot: 'Util', p: util }); }
  goalies.slice(0, 2).forEach((g) => { used.add(g.id); starters.push({ slot: 'G', p: g }); });
  const bench = ps.filter((p) => !used.has(p.id)).sort((a, b) => b.proj - a.proj);
  const starterPts = starters.reduce((t, s) => t + s.p.proj, 0);
  // depth matters (injuries, off nights, streaming), but far less than the starters
  const depth = bench.slice(0, 6).reduce((t, p) => t + p.proj, 0) * 0.15;
  return { starters, bench, starterPts, score: starterPts + depth };
}

const LETTERS: [number, string][] = [[1.25, 'A+'], [0.75, 'A'], [0.35, 'B+'], [-0.05, 'B'], [-0.45, 'C+'], [-0.85, 'C'], [-1.3, 'D'], [-Infinity, 'F']];

export interface Grade { team: number; score: number; starterPts: number; grade: string; rank: number }

// grade teams against each other (league-relative, like the post-draft grades on TV)
export function gradeTeams<P extends GP>(teams: Map<number, P[]>): Map<number, Grade> {
  const rows = [...teams].map(([team, ps]) => ({ team, ...lineupStrength(ps) }));
  const mean = rows.reduce((t, r) => t + r.score, 0) / Math.max(1, rows.length);
  const sd = Math.sqrt(rows.reduce((t, r) => t + (r.score - mean) ** 2, 0) / Math.max(1, rows.length)) || 1;
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return new Map(rows.map((r) => {
    const z = (r.score - mean) / sd;
    return [r.team, { team: r.team, score: r.score, starterPts: r.starterPts, grade: LETTERS.find(([min]) => z >= min)![1], rank: sorted.findIndex((x) => x.team === r.team) + 1 }];
  }));
}

