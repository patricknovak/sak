import type { League } from './types';

// SaK money: every GM pays the entry fee, part of it goes to the SaK Fund, and the rest is the prize pool. The
// pool is split three ways, each paid 1st/2nd/3rd by prize_split:
//   the Johnson (regular season), the Playoff Cup (playoff points only) and the SAK Cup (the whole year).
export const POTS = [
  { key: 'regular', trophy: 'The Johnson', label: 'Regular season', icon: '🏒' },
  { key: 'playoffs', trophy: 'The Playoff Cup', label: 'Playoffs', icon: '🔥' },
  { key: 'cup', trophy: 'The SAK Cup', label: 'Full year: regular season + playoffs', icon: '🏆' },
] as const;
export type PotKey = (typeof POTS)[number]['key'];

export function prizes(league: League | null | undefined, teams: number) {
  const entry = Number(league?.entry_fee ?? 200);
  const fund = Number(league?.sak_fee ?? 25);
  const split = (league?.prize_split ?? [60, 30, 10]).map(Number);
  const playoffShare = Number(league?.playoff_share ?? 25) / 100;
  const cupShare = Number(league?.cup_share ?? 25) / 100;
  const regularShare = Math.max(0, 1 - playoffShare - cupShare);
  const pool = (entry - fund) * teams;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const pot = (share: number) => ({ amount: round2(pool * share), pct: Math.round(share * 100), places: split.map((p) => round2((p / 100) * pool * share)) });
  const pots = { regular: pot(regularShare), playoffs: pot(playoffShare), cup: pot(cupShare) };
  return {
    entry, fund, teams, split, pool, pots,
    fundTotal: fund * teams,
    // the older names, still used around the site
    regularPool: pots.regular.amount, playoffPool: pots.playoffs.amount, cupPool: pots.cup.amount,
    regularPct: pots.regular.pct, playoffPct: pots.playoffs.pct, cupPct: pots.cup.pct,
    regular: pots.regular.places, playoffs: pots.playoffs.places, cup: pots.cup.places,
  };
}

export const PLACES = ['1st', '2nd', '3rd', '4th', '5th'];
