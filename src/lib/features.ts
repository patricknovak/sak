import type { League } from './types';

// What a league uses beyond the game itself: money (entry fees, prize pots, who owes what) and a league fund. Both
// are options a commissioner turns on in League settings; SaK has both. A league row without the features column
// (a database from before migration 95) reads as having both, the way SaK always did.
export type Feature = 'money' | 'fund';

// the game night's live room (who's watching, the swings, the reactions) shows unless the league switched it off
// (migration 265; SaK has it off): on by default, unlike money and the fund
export const liveRoomOn = (league: League | null | undefined) => league?.features?.live_room !== false;

// best ball (migration 276): each finished night counts the best lineup the team's players allowed; points leagues only
export const bestBall = (league: League | null | undefined) => league?.features?.bestball === true && !league?.categories?.length;

export function hasFeature(league: League | null | undefined, f: Feature): boolean {
  if (!league) return false;
  if (league.features == null) return true;
  return league.features[f] === true;
}
