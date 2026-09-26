// Keeper-rule helpers shared by the Players, Keepers and Draft pages.
import type { League, Player, Roster } from './types';

// each team's 2025-26 top scorer can't be kept (highest points, ties to the lower player id: the same rule as
// the server's top_scorer()), so he is sure to be back in the draft pool
export function bannedTopScorers(rosters: Roster[], rule: boolean | undefined) {
  const best = new Map<number, { id: number; fp: number }>();
  if (rule) for (const r of rosters) {
    if (r.prev_fp == null) continue;
    const b = best.get(r.team_id);
    if (!b || r.prev_fp > b.fp || (r.prev_fp === b.fp && r.player_id < b.id)) best.set(r.team_id, { id: r.player_id, fp: r.prev_fp });
  }
  return new Set([...best.values()].map((b) => b.id));
}

// rostered players who are certain to come back into the pool once keepers lock, best first
export function comingAvailable(players: Map<number, Player>, rosters: Roster[], league: League | null | undefined): Player[] {
  if (league?.phase !== 'keepers') return [];
  const banned = bannedTopScorers(rosters, league.top_scorer_rule);
  return [...banned].map((id) => players.get(id)).filter((p): p is Player => !!p).sort((a, b) => b.proj - a.proj);
}
