import type { Brand } from './brand';
import type { League } from './types';

// League money: every GM pays the entry fee, part of it goes to the league's fund, and the rest is the prize pool.
// The pool is split three ways, each paid 1st/2nd/3rd by prize_split: the regular-season prize (the Johnson in
// SaK), the playoff prize (playoff points only) and the full-year trophy (the SAK Cup). Names from the brand.
export type PotKey = 'regular' | 'playoffs' | 'cup';
export const potsOf = (b: Brand): { key: PotKey; trophy: string; label: string; icon: string }[] => [
  { key: 'regular', trophy: b.regular, label: 'Regular season', icon: '🏒' },
  { key: 'playoffs', trophy: b.playoff, label: 'Playoffs', icon: '🔥' },
  { key: 'cup', trophy: b.trophy, label: 'Full year: regular season + playoffs', icon: '🏆' },
];

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
