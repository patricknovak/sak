// The kinds of sports pool a host can start (docs/POOL-TYPES.md §2, migrations 165, 167 and 170), in words: what each is,
// how long it takes, and the scoring presets. The start page and the Host page read the same list.

// 'survivor' is last one standing (its own tables, migration 157): the start page and the host offer it like the rest
export type GameKind = 'series' | 'rank' | 'squares' | 'pickem' | 'survivor' | 'bracket';
export type PickemPreset = 'classic' | 'confidence';
export type SeriesPreset = 'classic' | 'flat' | 'exact';

export interface PoolEvent {
  competition: string; sport: string; name: string; pack: string | null; stage: string | null;
  open_round: number; open_label: string; next_lock: string | null; final_round: number; final_label: string; final_starts: string | null;
  kinds: GameKind[];
  // what the sport calls a round ('Matchweek') and a side ('club', 'team'), on an event that comes in rounds of matches
  word?: string;
  club_word?: string;
  // the series a grid of squares can still go on, last round first
  grids?: Grid[];
}
export interface Grid { id: number; round: number; label: string; short: string | null; best_of: number; starts_at: string | null; tbd: boolean; high: string | null; low: string | null }

// a grid's knobs, as the host chooses them
export interface SquaresRules { series: number; size: 5 | 10; cost: number; cap: number; pays: 'innings' | 'final'; digits: 'once' | 'each' }
export const SQUARES_DEFAULT: Omit<SquaresRules, 'series'> = { size: 10, cost: 10, cap: 0, pays: 'innings', digits: 'once' };
export const SIZES: { key: 5 | 10; label: string; line: string }[] = [
  { key: 10, label: '10 × 10', line: '100 squares, one digit a side: the classic, for a big group.' },
  { key: 5, label: '5 × 5', line: '25 squares, two digits a side: better odds each, made for a small group.' },
];
export const PAYS: { key: 'innings' | 'final'; label: string; line: string }[] = [
  { key: 'innings', label: '3rd, 6th, final', line: 'Each game pays three times: 25% after the 3rd, 25% after the 6th, 50% on the final score.' },
  { key: 'final', label: 'Final score', line: 'Each game pays once, on its final score.' },
];
// the grid on an event's last series when it has one, else the first still to come
export const gridFor = (e: PoolEvent) => (e.grids ?? []).find((g) => g.round === e.final_round) ?? e.grids?.[0] ?? null;
export const gridLabel = (g: Grid) => (g.high && g.low ? `${g.label}: ${g.high} v ${g.low}` : `${g.label}, matchup to be set`);

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
  pickem: {
    title: 'Pick\'em', badge: 'Every week', emoji: '✅',
    line: 'Pick the winner of every match, round by round, or a draw where the sport has them. Each pick locks at its own kick-off, so you can join any week.',
    time: 'Two minutes a round',
  },
  bracket: {
    title: 'The bracket', badge: 'All the way', emoji: '🏆',
    line: 'Pick the winner of every series through to the final, all before the first game. Later rounds are worth more, and a broken bracket can still climb.',
    time: 'Three minutes, once',
  },
  survivor: {
    title: 'Last one standing', badge: 'Lose once, out', emoji: '🛡️',
    line: 'Pick one winner every round, never the same side twice. Lose once and you’re out; the last one in wins it.',
    time: 'Ten seconds a round',
  },
  squares: {
    title: 'Squares', badge: 'Pure luck', emoji: '🔢',
    line: 'Claim squares on a grid with coins. The digits are drawn when it fills; the last digit of each club’s runs names the winning square after the 3rd, the 6th and the final of every game.',
    time: 'Ten seconds',
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

export const PICKEM_PRESETS: { key: PickemPreset; label: string; line: string; example: string }[] = [
  { key: 'classic', label: 'Classic', line: 'A point for every right pick. The most points wins.', example: 'Ten matches in a round: get seven right, 7 points.' },
  { key: 'confidence', label: 'Confidence', line: 'Number each round\'s picks from 1 up to its number of matches, your surest highest. A right pick earns its number.', example: 'Ten matches: your surest pick is ×10. Right, 10 points; wrong, nothing, so a long shot goes low.' },
];

// the centre for a competition played in rounds (#/centre/<competition>), by its sport
export const centreName = (sport: string | null | undefined) => (sport === 'nfl' ? 'NFL centre' : 'Match centre');
