// Keeper grades for the site, built from the store's data with the same engine Garry uses.
import { gradeAllKeepers, gradeColorClass, type KP, type TeamKeepers, type KeeperPick } from '../../supabase/functions/_shared/keepers.ts';
import { projectedKeepers } from './grades';
import { bannedTopScorers } from './keepers';
import type { League, Player, Roster, Team } from './types';

export type { TeamKeepers, KeeperPick };
export const keeperGradeColor = gradeColorClass;

export interface KeeperReport {
  generated_at: string; intro: string; llm: boolean;
  teams: { team_id: number; grade: string; take: string }[];
  predictions: { team_id: number; rank: number; line: string }[];
  bold: string | null;
}

const toKP = (p: Player): KP => ({ id: p.id, pos: p.pos, elig: p.elig, proj: p.proj, name: p.name, injury_status: p.injury_status, nhl_team: p.nhl_team });

export function keeperGrades(teams: Team[], rosters: Roster[], players: Map<number, Player>, league: League | null): Map<number, TeamKeepers> {
  const gms = teams.filter((t) => t.role !== 'spectator');
  const max = league?.keepers ?? 6;
  const banned = bannedTopScorers(rosters, league?.top_scorer_rule);
  const finalized = rosters.some((r) => r.acquired === 'keeper');
  const keepersOf = (t: number) => {
    const rows = rosters.filter((r) => r.team_id === t);
    const ids = finalized ? rows.filter((r) => r.acquired === 'keeper').map((r) => r.player_id) : [...projectedKeepers(rows, max, !!league?.top_scorer_rule)];
    return ids.map((id) => players.get(id)).filter(Boolean).map((p) => toKP(p!));
  };
  // once keepers are final the released players are back in the pool, so "the best set they could have kept" is unknowable: treat the keepers as it
  const eligibleOf = (t: number) => finalized ? keepersOf(t) : rosters.filter((r) => r.team_id === t && !banned.has(r.player_id)).map((r) => players.get(r.player_id)).filter(Boolean).map((p) => toKP(p!));
  return gradeAllKeepers(gms.map((t) => ({ id: t.id, submitted: t.keepers_submitted })), keepersOf, eligibleOf, [...players.values()].map(toKP), max);
}
