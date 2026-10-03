import type { League } from './types';

// What a league uses beyond the game itself: money (entry fees, prize pots, who owes what) and a league fund. Both
// are options a commissioner turns on in League settings; SaK has both. A league row without the features column
// (a database from before migration 95) reads as having both, the way SaK always did.
export type Feature = 'money' | 'fund';

export function hasFeature(league: League | null | undefined, f: Feature): boolean {
  if (!league) return false;
  if (league.features == null) return true;
  return league.features[f] === true;
}
