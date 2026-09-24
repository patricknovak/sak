import type { Player, Roster } from './types';

export { lineupStrength, gradeTeams, type Grade } from '../../supabase/functions/_shared/grades';

export const gradeColor = (g: string) =>
  g.startsWith('A') ? 'text-emerald-300' : g.startsWith('B') ? 'text-sky-300' : g.startsWith('C') ? 'text-amber-300' : 'text-red-300';

// value vs. where the player "should" have gone: rank in the pre-draft pool by projection
export function pickValues(picks: { overall: number; team: number; player: Player }[], poolRank: Map<number, number>) {
  // positive = he fell further than expected (a steal); negative = taken early (a reach)
  return picks.map((k) => ({ ...k, value: k.overall - (poolRank.get(k.player.id) ?? k.overall) }));
}

// keepers the server will use if a team doesn't submit: their picks if saved, else the top N by
// 2025-26 points, skipping the team's top scorer when that rule is on
export function projectedKeepers(rows: Roster[], max: number, topScorerRule: boolean): Set<number> {
  const saved = rows.filter((r) => r.keeper);
  if (saved.length) return new Set(saved.map((r) => r.player_id));
  const ranked = rows.filter((r) => r.prev_fp != null).sort((a, b) => b.prev_fp! - a.prev_fp! || a.player_id - b.player_id);
  const eligible = topScorerRule ? ranked.slice(1) : ranked;
  return new Set(eligible.slice(0, max).map((r) => r.player_id));
}
