import type { League } from './types';

// SaK money: every GM pays the entry fee, part of it goes to the SaK Fund, and the rest is the prize
// pool. The pool is split between the regular season and the playoffs, and each is paid 1st/2nd/3rd.
export function prizes(league: League | null | undefined, teams: number) {
  const entry = Number(league?.entry_fee ?? 200);
  const fund = Number(league?.sak_fee ?? 25);
  const split = (league?.prize_split ?? [60, 30, 10]).map(Number);
  const playoffShare = Number(league?.playoff_share ?? 40) / 100;
  const pool = (entry - fund) * teams;
  const regularPool = pool * (1 - playoffShare);
  const playoffPool = pool * playoffShare;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    entry, fund, teams, split, pool,
    fundTotal: fund * teams,
    regularPool: round2(regularPool), playoffPool: round2(playoffPool),
    regularPct: Math.round((1 - playoffShare) * 100), playoffPct: Math.round(playoffShare * 100),
    regular: split.map((p) => round2((p / 100) * regularPool)),
    playoffs: split.map((p) => round2((p / 100) * playoffPool)),
  };
}

export const PLACES = ['1st', '2nd', '3rd', '4th', '5th'];
