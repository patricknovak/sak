// The kinds of sports pool a host can start (docs/POOL-TYPES.md §2, migration 165), in words: what each is, how long
// it takes, and the scoring presets. The start page and the Host page read the same list.

export type GameKind = 'series' | 'rank';
export type SeriesPreset = 'classic' | 'flat' | 'exact';

export interface PoolEvent {
  competition: string; sport: string; name: string; pack: string | null; stage: string | null;
  open_round: number; open_label: string; next_lock: string | null; final_round: number; final_label: string; final_starts: string | null;
  kinds: GameKind[];
}

export const KINDS: Record<GameKind, { title: string; badge: string; line: string; time: string; emoji: string }> = {
  series: {
    title: 'Pick the series', badge: 'Most popular', emoji: '⚔️',
    line: 'Call each series and how many games it goes, round by round. Later rounds open as their matchups are set.',
    time: 'A minute a round',
  },
  rank: {
    title: 'Rank the teams', badge: 'Easiest', emoji: '📊',
    line: 'Put the clubs in order once. Your top club is worth the most for every game it wins, all the way to the trophy.',
    time: 'One minute, once',
  },
};

export const PRESETS: { key: SeriesPreset; label: string; line: string; points: number[]; length: number[] }[] = [
  { key: 'classic', label: 'Classic', line: 'Later rounds are worth more: 1, 2, 4 and 8 for the winner, plus 1, 1, 2 and 3 for the right length.', points: [1, 2, 4, 8], length: [1, 1, 2, 3] },
  { key: 'flat', label: 'Flat', line: 'Every series counts the same: a point for the winner and a point for the length.', points: [1, 1, 1, 1], length: [1, 1, 1, 1] },
  { key: 'exact', label: 'All or nothing', line: 'MLB.com’s rule: a point only when the winner and the number of games are both right.', points: [1, 1, 1, 1], length: [0, 0, 0, 0] },
];

// a worked example for a preset, from the event's last round: "Your club in 6, and they win in 6: 8 + 3 = 11 points"
export function presetExample(p: SeriesPreset, finalLabel: string, finalRound: number): string {
  const pr = PRESETS.find((x) => x.key === p)!;
  const w = pr.points[finalRound - 1] ?? 1, l = pr.length[finalRound - 1] ?? 0;
  const label = finalLabel.replace(/^(AL|NL) /, '');
  if (p === 'exact') return `Pick a club in 6 in the ${label}: they win in 6, 1 point; they win in 5, nothing.`;
  return `Pick a club in 6 in the ${label}: they win in 6, ${w} + ${l} = ${w + l} points; they win in 7, ${w}.`;
}
