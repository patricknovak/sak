// Player stats by timeframe, for sorting and filtering the player lists any way a GM likes.
import type { Player, PlayerSeason, PlayerWindow } from './types';
import { GAMES_PER_SEASON, rosPerGame } from './lineup';

export type Timeframe = 'proj' | 'ros' | 'last' | 'season' | '30' | '14' | '7';
export const TIMEFRAMES: { k: Timeframe; label: string; short: string; live: boolean }[] = [
  { k: 'proj', label: 'Projected 2026-27', short: 'Proj', live: false },
  { k: 'ros', label: 'Rest of season (projection blended with this season’s pace)', short: 'ROS', live: false },
  { k: 'last', label: '2025-26 season', short: '’25-26', live: false },
  { k: 'season', label: 'This season', short: 'Season', live: true },
  { k: '30', label: 'Last 30 days', short: '30d', live: true },
  { k: '14', label: 'Last 14 days', short: '14d', live: true },
  { k: '7', label: 'Last 7 days', short: '7d', live: true },
];

// what a stat means: counting stats are summed and can be shown per game; rates are computed from totals
export interface StatDef { k: string; label: string; short: string; rate?: boolean; goalie?: boolean; skater?: boolean; dp?: number; lowerIsBetter?: boolean }
export const STATS: StatDef[] = [
  { k: 'fp', label: 'Fantasy points', short: 'FP', dp: 1 },
  { k: 'gp', label: 'Games played', short: 'GP' },
  { k: 'g', label: 'Goals', short: 'G', skater: true },
  { k: 'a', label: 'Assists', short: 'A', skater: true },
  { k: 'pts', label: 'Points', short: 'P', skater: true },
  { k: 'pm', label: 'Plus / minus', short: '+/-', skater: true },
  { k: 'ppp', label: 'Powerplay points', short: 'PPP', skater: true },
  { k: 'ppg', label: 'Powerplay goals', short: 'PPG', skater: true },
  { k: 'shp', label: 'Shorthanded points', short: 'SHP', skater: true },
  { k: 'gwg', label: 'Game-winning goals', short: 'GWG', skater: true },
  { k: 'sog', label: 'Shots on goal', short: 'SOG', skater: true },
  { k: 'hit', label: 'Hits', short: 'HIT', skater: true },
  { k: 'blk', label: 'Blocks', short: 'BLK', skater: true },
  { k: 'pim', label: 'Penalty minutes', short: 'PIM', skater: true },
  { k: 'fow', label: 'Faceoffs won', short: 'FW', skater: true },
  { k: 'shpct', label: 'Shooting %', short: 'S%', skater: true, rate: true, dp: 1 },
  { k: 'gs', label: 'Games started', short: 'GS', goalie: true },
  { k: 'w', label: 'Wins', short: 'W', goalie: true },
  { k: 'l', label: 'Losses', short: 'L', goalie: true, lowerIsBetter: true },
  { k: 'otl', label: 'OT losses', short: 'OTL', goalie: true, lowerIsBetter: true },
  { k: 'sv', label: 'Saves', short: 'SV', goalie: true },
  { k: 'sa', label: 'Shots against', short: 'SA', goalie: true },
  { k: 'ga', label: 'Goals against', short: 'GA', goalie: true, lowerIsBetter: true },
  { k: 'sho', label: 'Shutouts', short: 'SO', goalie: true },
  { k: 'svp', label: 'Save %', short: 'SV%', goalie: true, rate: true, dp: 3 },
  { k: 'gaa', label: 'Goals against avg', short: 'GAA', goalie: true, rate: true, dp: 2, lowerIsBetter: true },
];
export const statDef = (k: string) => STATS.find((s) => s.k === k) ?? STATS[0];
export const statsFor = (goalie: boolean) => STATS.filter((s) => goalie ? !s.skater : !s.goalie);

// a player's line for a timeframe: games, fantasy points and raw totals (null when there's nothing to show)
export interface Line { gp: number | null; fp: number; totals: Record<string, number> }
// projection-style timeframes have one number and no raw totals
export const projLike = (tf: Timeframe) => tf === 'proj' || tf === 'ros';
// what's left in the tank: blended per-game pace times the games he has left
export function rosPoints(p: Player, s?: PlayerSeason | null) {
  const gp = s?.gp ?? 0;
  return rosPerGame(p.proj, p.pos, gp, s?.fpts ?? 0) * Math.max(0, GAMES_PER_SEASON(p.pos) - gp);
}
export function lineFor(p: Player, tf: Timeframe, windows?: Record<string, PlayerWindow>, season?: PlayerSeason | null): Line | null {
  if (tf === 'proj') return { gp: null, fp: p.proj, totals: {} };
  if (tf === 'ros') return { gp: season?.gp ?? null, fp: rosPoints(p, season), totals: {} };
  if (tf === 'last') {
    if (!p.last_stats) return null;
    const { fp, gp, ...totals } = p.last_stats as Record<string, number>;
    return { gp: gp ?? null, fp: fp ?? p.last_fp, totals };
  }
  const w = windows?.[tf];
  return w ? { gp: w.gp, fp: w.fpts, totals: w.totals } : null;
}

// rates need a sample or one hot night tops every list: fewer games count in a short window
export const minSample = (tf: Timeframe) => (tf === '7' || tf === '14' ? { gp: 2, sog: 8 } : { gp: 5, sog: 25 });

// the number to sort or display: counting stats, optionally per game, or a computed rate
export function statValue(line: Line | null, k: string, perGame = false, sample = { gp: 5, sog: 25 }): number | null {
  if (!line) return null;
  const t = line.totals;
  if (k === 'fp') return perGame && line.gp ? line.fp / line.gp : line.fp;
  if (k === 'gp') return line.gp;
  if (k === 'shpct') return t.sog && t.sog >= sample.sog ? (100 * (t.g ?? 0)) / t.sog : null;
  if (k === 'svp') return t.sa && (line.gp ?? 0) >= sample.gp ? (t.sv ?? 0) / t.sa : null;
  if (k === 'gaa') return (line.gp ?? 0) >= sample.gp ? (t.ga ?? 0) / line.gp! : null; // per game started would need TOI; per appearance is close enough
  const v = t[k];
  if (v == null) return null;
  return perGame && line.gp ? v / line.gp : v;
}

export function fmtStat(v: number | null | undefined, k: string, perGame = false) {
  if (v == null || Number.isNaN(v)) return '–';
  const d = statDef(k);
  if (k === 'svp') return v.toFixed(3).replace(/^0/, '');
  const dp = d.dp ?? (perGame ? 2 : 0);
  return (k === 'pm' && v > 0 ? '+' : '') + v.toFixed(dp);
}
