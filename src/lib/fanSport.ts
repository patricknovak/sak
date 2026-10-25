// The fan zones of the other leagues (25 October 2026, Patrick: "I would like to include Premier League, NFL and NBA
// with the possibility of adding other leagues"): a club read the way the NHL's zone reads one (fanZone.ts, fanDeep.ts,
// fanOffice.ts), for every sport the zones carry. nhl-hub's fan-sport-league and fan-sport tasks bring ESPN's public
// numbers and the pools engine's own fixtures; everything here is worked out on the phone, pure and tested on its own
// (supabase/tests/fan-sport.test.mjs). A sport is a list of measures, a way to turn a season into a strength and the
// shape of its spring; a new league of a sport already here (MLS, the WNBA, La Liga) needs nothing in this file.
//   measures   every number that matters in the sport, ranked among the league's clubs, with a grade from those that win
//   strength   each club's true strength: its own margin blended with what the market's lines have said about it
//   outlook    the season simulated to its end a few thousand times, the spring included (the NFL's seven seeds a
//              conference, the NBA's play-in and best-of-seven rounds, the Premier League's table from first to 20th)
//   luck       the record against what the scoring has earned (points-based wins; for soccer, expected goals)
//   form       the last few games; ahead: the schedule still to play, how hard it is, the next few with their chances
//   players    the club's leaders, its stars and depth, its ages and who is hurt
//   questions  the front office's bigger questions, each with a verdict the fans can answer, and the needs and moves
import type { FanSport } from './fanLists.ts';
import { normal, rng, seedOf } from './fanDeep.ts';
import { rankWord } from './fanZone.ts';

export type Sport = Exclude<FanSport, 'hockey'>;
export interface SportClubRow {
  code: string; id: string; name: string; short: string | null; nick: string | null; logo: string | null; logoDark: string | null;
  color: string | null; alt: string | null; conf: string | null; div: string | null; gp: number; w: number; l: number; d: number;
  pf: number; pa: number; pts: number | null; deducted: number | null; seed: number | null; streak: string | null; home: string | null;
  road: string | null; vsDiv: string | null; vsConf: string | null; last10: string | null; note: string | null;
}
// [kick-off, home, away, home score, away score, round, home chance, away chance, draw chance, line] (the score null
// until it's final; the chances are the market's before the game, null where it had none)
export type SportGame = [string, string | null, string | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
export interface SportLeader { id: string | null; name: string; team: string | null; pos: string | null; headshot: string | null; value: number; display: string }
export interface SportLeaderCat { cat: string; name: string; rows: SportLeader[] }
export interface SportLeague {
  league: string; name: string; sport: Sport; season: string | null; year: number; clubs: SportClubRow[];
  stats: { keys: string[]; own: Record<string, (number | null)[]>; opp: Record<string, (number | null)[]> };
  games: SportGame[]; leaders: SportLeaderCat[]; at: string; stale?: boolean;
}
export interface SportInjury { status: string; date: string | null; type: string | null; detail: string | null; back: string | null }
export interface SoccerSeason { apps: number; subs: number; g: number; a: number; sh: number; sot: number; sv: number; ga: number; faced: number; yc: number; rc: number; fc: number; fs: number; off: number }
export interface SportPlayer {
  id: string; name: string; short: string | null; pos: string | null; posName: string | null; group: string | null; jersey: string | null;
  age: number | null; exp: number | null; ht: string | null; wt: string | null; headshot: string | null; from: string | null;
  injury: SportInjury | null; season: SoccerSeason | null;
}
export interface SportClub {
  league: string; club: string; id: string; name: string; short: string | null; logo: string | null; logoDark: string | null; color: string | null;
  alt: string | null; venue: string | null; city: string | null; standing: string | null; record: string | null;
  coach: { name: string; years: number | null } | null;
  next: { at: string | null; name: string | null; home: boolean; opp: string | null; oppName: string | null; venue: string | null; week: string | null; tv: string | null } | null;
  players: SportPlayer[]; leaders: { cat: string; name: string; rows: { id: string; value: number; display: string }[] }[];
  news: { headline: string; blurb: string | null; link: string | null; image: string | null; at: string | null }[]; season: string | null; at: string;
}

// ── the sports
interface SportCfg {
  noun: string; games: number;   // a game, and a season's worth for a club
  sigma: number; hfa: number;    // a game's margin: how much it swings around the strengths, and what home is worth
  K: number;                     // games of league-average play a club's own margin is pulled toward
  market: number;                // games of its own play it takes to count as much as the market's view of a club
  early: number;                 // before this many games the read is a lean, not a verdict
  pyth: number; close: number;   // the points-based wins' exponent; a close game's margin
  form: number;                  // the last games read as form
}
export const SPORTS: Record<Sport, SportCfg> = {
  football: { noun: 'game', games: 17, sigma: 13.5, hfa: 1.6, K: 7, market: 8, early: 6, pyth: 2.37, close: 8, form: 5 },
  basketball: { noun: 'game', games: 82, sigma: 12, hfa: 2.3, K: 7, market: 20, early: 15, pyth: 14, close: 5, form: 10 },
  soccer: { noun: 'match', games: 38, sigma: 0, hfa: 0, K: 8, market: 0, early: 10, pyth: 1.3, close: 1, form: 6 },
};

// ── formats
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const dec1 = (v: number) => v.toFixed(1);
const dec2 = (v: number) => v.toFixed(2);
const rate3 = (v: number) => v.toFixed(3).replace(/^0/, '');
const signed = (f: (v: number) => string) => (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : noun.endsWith('ch') ? 'es' : 's'}`;
export const chance = (p: number) => (p >= 0.995 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : pct0(p));
export { rankWord };

// ── reading a league's numbers
export type StatFn = (code: string, key: string, side?: 'own' | 'opp') => number | null;
export function statsOf(l: SportLeague): StatFn {
  const idx = new Map(l.stats.keys.map((k, i) => [k, i]));
  return (code, key, side = 'own') => {
    const i = idx.get(key), row = l.stats[side]?.[code];
    const v = i == null || !row ? null : row[i];
    return v == null || !Number.isFinite(v) ? null : v;
  };
}
const div = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : a / b);
const sum = (...v: (number | null)[]) => (v.some((x) => x == null) ? null : (v as number[]).reduce((a, b) => a + b, 0));

// what a measure reads: the club's table line, its numbers and what it allowed
interface T { row: SportClubRow; gp: number; s: (k: string) => number | null; o: (k: string) => number | null }
export type MeasureGroup = 'Results' | 'Offence' | 'Defence' | 'Attack' | 'Control' | 'Turnovers' | 'Rebounding' | 'Special teams' | 'Discipline' | 'Style';
export interface Measure { key: string; label: string; group: MeasureGroup; low?: boolean; style?: boolean; fmt: (v: number) => string; what: string; get: (t: T) => number | null }

// basketball's possessions: shots taken, less the misses rebounded, plus turnovers and trips to the line
const poss = (t: T, side: 's' | 'o') => {
  const f = t[side];
  const fga = f('offensive.fieldGoalsAttempted'), orb = f('offensive.offensiveRebounds'), tov = f('offensive.turnovers'), fta = f('offensive.freeThrowsAttempted');
  return fga == null || orb == null || tov == null || fta == null ? null : fga - orb + tov + 0.44 * fta;
};
const pace = (t: T) => { const a = poss(t, 's'), b = poss(t, 'o'); return a == null || b == null ? null : (a + b) / 2; };
const efg = (t: T, side: 's' | 'o') => { const f = t[side]; return div(sum(f('offensive.fieldGoalsMade'), (f('offensive.threePointFieldGoalsMade') ?? 0) * 0.5), f('offensive.fieldGoalsAttempted')); };
// football's plays: passes, sacks and runs
const plays = (t: T, side: 's' | 'o') => { const f = t[side]; return sum(f('passing.passingAttempts'), f('passing.sacks'), f('rushing.rushingAttempts')); };
const perGame = (v: number | null, t: T) => (v == null || !t.gp ? null : v / t.gp);
// soccer's matches: ESPN's count where it has one
const apps = (t: T) => t.s('general.appearances') || t.gp;
const perApp = (v: number | null, t: T) => { const n = apps(t); return v == null || !n ? null : v / n; };

export const MEASURES: Record<Sport, Measure[]> = {
  football: [
    { key: 'winPct', group: 'Results', label: 'Win %', fmt: rate3, what: 'games won, a tie counting half', get: (t) => (t.gp ? (t.row.w + t.row.d / 2) / t.gp : null) },
    { key: 'margin', group: 'Results', label: 'Point margin a game', fmt: signed(dec1), what: 'points scored less points allowed, per game: the best single read of how good a team is', get: (t) => perGame(t.row.pf - t.row.pa, t) },
    { key: 'ppg', group: 'Offence', label: 'Points a game', fmt: dec1, what: 'points scored per game', get: (t) => perGame(t.row.pf, t) },
    { key: 'ypp', group: 'Offence', label: 'Yards a play', fmt: dec2, what: 'net yards gained per pass, sack and run: how efficiently the offence moves', get: (t) => div(t.s('passing.netTotalYards'), plays(t, 's')) },
    { key: 'nya', group: 'Offence', label: 'Net yards a pass', fmt: dec2, what: 'passing yards per dropback with the sacks taken off: the passing game in one number', get: (t) => t.s('passing.netYardsPerPassAttempt') },
    { key: 'ypc', group: 'Offence', label: 'Yards a carry', fmt: dec2, what: 'rushing yards per attempt', get: (t) => t.s('rushing.yardsPerRushAttempt') },
    { key: 'third', group: 'Offence', label: '3rd-down conversions', fmt: pct1, what: 'third downs turned into a first down: staying on the field', get: (t) => div(t.s('miscellaneous.thirdDownConvs'), t.s('miscellaneous.thirdDownAttempts')) },
    { key: 'rating', group: 'Offence', label: 'Passer rating', fmt: dec1, what: 'the team’s passer rating: completions, yards, touchdowns and interceptions together', get: (t) => t.s('passing.QBRating') },
    { key: 'sacked', group: 'Offence', label: 'Sacks taken a dropback', low: true, fmt: pct1, what: 'dropbacks that end in a sack: the line, and the quarterback’s clock', get: (t) => div(t.s('passing.sacks'), sum(t.s('passing.passingAttempts'), t.s('passing.sacks'))) },
    { key: 'papg', group: 'Defence', label: 'Points allowed a game', low: true, fmt: dec1, what: 'points allowed per game', get: (t) => perGame(t.row.pa, t) },
    { key: 'oypp', group: 'Defence', label: 'Yards a play allowed', low: true, fmt: dec2, what: 'net yards allowed per play', get: (t) => div(t.o('passing.netTotalYards'), plays(t, 'o')) },
    { key: 'onya', group: 'Defence', label: 'Net yards a pass allowed', low: true, fmt: dec2, what: 'the passing game allowed, sacks counted in', get: (t) => t.o('passing.netYardsPerPassAttempt') },
    { key: 'oypc', group: 'Defence', label: 'Yards a carry allowed', low: true, fmt: dec2, what: 'rushing yards allowed per attempt: the run defence', get: (t) => t.o('rushing.yardsPerRushAttempt') },
    { key: 'othird', group: 'Defence', label: '3rd downs allowed', low: true, fmt: pct1, what: 'third downs the other team converts: getting off the field', get: (t) => div(t.o('miscellaneous.thirdDownConvs'), t.o('miscellaneous.thirdDownAttempts')) },
    { key: 'sackRate', group: 'Defence', label: 'Sack rate', fmt: pct1, what: 'the other team’s dropbacks that end in a sack: the pass rush', get: (t) => div(t.o('passing.sacks'), sum(t.o('passing.passingAttempts'), t.o('passing.sacks'))) },
    { key: 'orating', group: 'Defence', label: 'Passer rating allowed', low: true, fmt: dec1, what: 'what the passers facing them rate: the coverage', get: (t) => t.o('passing.QBRating') },
    { key: 'toDiff', group: 'Turnovers', label: 'Turnover margin a game', fmt: signed(dec2), what: 'takeaways less giveaways per game', get: (t) => perGame(t.s('miscellaneous.turnOverDifferential'), t) },
    { key: 'take', group: 'Turnovers', label: 'Takeaways a game', fmt: dec2, what: 'interceptions and fumbles recovered per game', get: (t) => perGame(t.s('miscellaneous.totalTakeaways'), t) },
    { key: 'give', group: 'Turnovers', label: 'Giveaways a game', low: true, fmt: dec2, what: 'interceptions thrown and fumbles lost per game', get: (t) => perGame(t.s('miscellaneous.totalGiveaways'), t) },
    { key: 'fg', group: 'Special teams', label: 'Field goals', fmt: pct1, what: 'field goals made', get: (t) => div(t.s('kicking.fieldGoalsMade'), t.s('kicking.fieldGoalAttempts')) },
    { key: 'punt', group: 'Special teams', label: 'Net punting', fmt: dec1, what: 'yards a punt, the return taken off', get: (t) => t.s('punting.netAvgPuntYards') },
    { key: 'kr', group: 'Special teams', label: 'Kick returns', fmt: dec1, what: 'yards a kick return', get: (t) => t.s('returning.yardsPerKickReturn') },
    { key: 'pen', group: 'Discipline', label: 'Penalty yards a game', low: true, fmt: dec1, what: 'yards given away in penalties per game', get: (t) => perGame(t.s('miscellaneous.totalPenaltyYards'), t) },
    { key: 'fourth', group: 'Style', style: true, label: '4th-down tries a game', fmt: dec2, what: 'how often they go for it on fourth down: the coach’s nerve', get: (t) => perGame(t.s('miscellaneous.fourthDownAttempts'), t) },
    { key: 'passShare', group: 'Style', style: true, label: 'Pass share', fmt: pct1, what: 'plays that are dropbacks rather than runs', get: (t) => div(sum(t.s('passing.passingAttempts'), t.s('passing.sacks')), plays(t, 's')) },
  ],
  basketball: [
    { key: 'winPct', group: 'Results', label: 'Win %', fmt: rate3, what: 'games won', get: (t) => (t.gp ? t.row.w / t.gp : null) },
    { key: 'net', group: 'Results', label: 'Net rating', fmt: signed(dec1), what: 'points scored less points allowed per 100 possessions: the truest single read of a team', get: (t) => { const p = pace(t); const a = t.s('offensive.points'), b = t.o('offensive.points'); return p && a != null && b != null ? (100 * (a - b)) / p : null; } },
    { key: 'margin', group: 'Results', label: 'Point margin a game', fmt: signed(dec1), what: 'points scored less points allowed, per game', get: (t) => perGame(t.row.pf - t.row.pa, t) },
    { key: 'ortg', group: 'Offence', label: 'Offensive rating', fmt: dec1, what: 'points scored per 100 possessions', get: (t) => { const p = pace(t); const a = t.s('offensive.points'); return p && a != null ? (100 * a) / p : null; } },
    { key: 'efg', group: 'Offence', label: 'Effective shooting', fmt: pct1, what: 'field-goal percentage with a three worth half again a two', get: (t) => efg(t, 's') },
    { key: 'three', group: 'Offence', label: '3-point %', fmt: pct1, what: 'threes made', get: (t) => div(t.s('offensive.threePointFieldGoalsMade'), t.s('offensive.threePointFieldGoalsAttempted')) },
    { key: 'ftr', group: 'Offence', label: 'Free throws a shot', fmt: dec2, what: 'free-throw attempts per shot from the floor: getting to the line', get: (t) => div(t.s('offensive.freeThrowsAttempted'), t.s('offensive.fieldGoalsAttempted')) },
    { key: 'ast', group: 'Offence', label: 'Assisted baskets', fmt: pct1, what: 'baskets that came from a pass: how the ball moves', get: (t) => div(t.s('offensive.assists'), t.s('offensive.fieldGoalsMade')) },
    { key: 'drtg', group: 'Defence', label: 'Defensive rating', low: true, fmt: dec1, what: 'points allowed per 100 possessions', get: (t) => { const p = pace(t); const b = t.o('offensive.points'); return p && b != null ? (100 * b) / p : null; } },
    { key: 'oefg', group: 'Defence', label: 'Shooting allowed', low: true, fmt: pct1, what: 'the other team’s effective shooting', get: (t) => efg(t, 'o') },
    { key: 'othree', group: 'Defence', label: '3-point % allowed', low: true, fmt: pct1, what: 'threes the other team makes: part defence, a fair part luck', get: (t) => div(t.o('offensive.threePointFieldGoalsMade'), t.o('offensive.threePointFieldGoalsAttempted')) },
    { key: 'oftr', group: 'Defence', label: 'Free throws allowed a shot', low: true, fmt: dec2, what: 'the other team’s trips to the line per shot: defending without fouling', get: (t) => div(t.o('offensive.freeThrowsAttempted'), t.o('offensive.fieldGoalsAttempted')) },
    { key: 'blk', group: 'Defence', label: 'Blocks a game', fmt: dec1, what: 'shots blocked per game: rim protection', get: (t) => perGame(t.s('defensive.blocks'), t) },
    { key: 'stl', group: 'Defence', label: 'Steals a game', fmt: dec1, what: 'steals per game', get: (t) => perGame(t.s('defensive.steals'), t) },
    { key: 'oreb', group: 'Rebounding', label: 'Offensive rebounding', fmt: pct1, what: 'their own misses they get back: second chances', get: (t) => div(t.s('offensive.offensiveRebounds'), sum(t.s('offensive.offensiveRebounds'), t.o('defensive.defensiveRebounds'))) },
    { key: 'dreb', group: 'Rebounding', label: 'Defensive rebounding', fmt: pct1, what: 'the other team’s misses they finish the possession with', get: (t) => div(t.s('defensive.defensiveRebounds'), sum(t.s('defensive.defensiveRebounds'), t.o('offensive.offensiveRebounds'))) },
    { key: 'tov', group: 'Turnovers', label: 'Turnovers a possession', low: true, fmt: pct1, what: 'possessions thrown away', get: (t) => div(t.s('offensive.turnovers'), poss(t, 's')) },
    { key: 'otov', group: 'Turnovers', label: 'Turnovers forced', fmt: pct1, what: 'the other team’s possessions that end in a turnover', get: (t) => div(t.o('offensive.turnovers'), poss(t, 'o')) },
    { key: 'fouls', group: 'Discipline', label: 'Fouls a game', low: true, fmt: dec1, what: 'personal fouls per game', get: (t) => perGame(t.s('general.fouls'), t) },
    { key: 'pace', group: 'Style', style: true, label: 'Pace', fmt: dec1, what: 'possessions a game: how fast they play', get: (t) => perGame(pace(t), t) },
    { key: 'threeRate', group: 'Style', style: true, label: '3-point attempt rate', fmt: pct1, what: 'shots from the floor that are threes', get: (t) => div(t.s('offensive.threePointFieldGoalsAttempted'), t.s('offensive.fieldGoalsAttempted')) },
  ],
  soccer: [
    { key: 'ppg', group: 'Results', label: 'Points a match', fmt: dec2, what: 'league points per match', get: (t) => (t.gp && t.row.pts != null ? t.row.pts / t.gp : null) },
    { key: 'gd', group: 'Results', label: 'Goal difference a match', fmt: signed(dec2), what: 'goals scored less goals conceded, per match', get: (t) => perGame(t.row.pf - t.row.pa, t) },
    { key: 'xgd', group: 'Results', label: 'Expected goal difference', fmt: signed(dec2), what: 'the chances made less the chances given, per match, by expected goals: the truest single read of a side', get: (t) => { const a = t.s('offensive.avgExpectedGoals'), b = t.s('goalKeeping.avgExpectedGoalsConceded'); return a == null || b == null ? null : a - b; } },
    { key: 'gf', group: 'Attack', label: 'Goals a match', fmt: dec2, what: 'goals scored per match', get: (t) => perGame(t.row.pf, t) },
    { key: 'xg', group: 'Attack', label: 'Expected goals a match', fmt: dec2, what: 'the quality of the chances they make, in goals', get: (t) => t.s('offensive.avgExpectedGoals') },
    { key: 'shots', group: 'Attack', label: 'Shots a match', fmt: dec1, what: 'shots taken per match', get: (t) => perApp(t.s('offensive.totalShots'), t) },
    { key: 'sot', group: 'Attack', label: 'On target a match', fmt: dec1, what: 'shots on target per match', get: (t) => perApp(t.s('offensive.shotsOnTarget'), t) },
    { key: 'big', group: 'Attack', label: 'Big chances a match', fmt: dec2, what: 'clear chances created per match', get: (t) => t.s('offensive.avgBigChanceCreated') },
    { key: 'conv', group: 'Attack', label: 'Shots scored', fmt: pct1, what: 'goals per shot: finishing, and some luck', get: (t) => div(t.row.pf, t.s('offensive.totalShots')) },
    { key: 'ga', group: 'Defence', label: 'Goals conceded a match', low: true, fmt: dec2, what: 'goals conceded per match', get: (t) => perGame(t.row.pa, t) },
    { key: 'xga', group: 'Defence', label: 'Expected goals against', low: true, fmt: dec2, what: 'the quality of the chances they give away, in goals', get: (t) => t.s('goalKeeping.avgExpectedGoalsConceded') },
    { key: 'faced', group: 'Defence', label: 'Shots faced a match', low: true, fmt: dec1, what: 'shots the other side takes per match', get: (t) => perApp(t.s('goalKeeping.shotsFaced'), t) },
    { key: 'cs', group: 'Defence', label: 'Clean sheets', fmt: pct0, what: 'matches without conceding', get: (t) => perApp(t.s('goalKeeping.cleanSheet'), t) },
    { key: 'save', group: 'Defence', label: 'Saves', fmt: pct1, what: 'shots on target the goalkeeper keeps out', get: (t) => div(t.s('goalKeeping.saves'), sum(t.s('goalKeeping.saves'), t.s('goalKeeping.goalsConceded'))) },
    { key: 'tackles', group: 'Defence', label: 'Tackles won', fmt: pct1, what: 'tackles that win the ball', get: (t) => t.s('defensive.tacklePct') },
    { key: 'poss', group: 'Control', label: 'Possession', fmt: pct1, what: 'share of the ball', get: (t) => div(t.s('offensive.possessionPct'), 100) },
    { key: 'pass', group: 'Control', label: 'Pass accuracy', fmt: pct1, what: 'passes that find a teammate', get: (t) => t.s('general.passPct') },
    { key: 'duels', group: 'Control', label: 'Duels won', fmt: pct1, what: 'one-on-one contests won, in the air and on the ground', get: (t) => t.s('general.duelWinPct') },
    { key: 'corners', group: 'Control', label: 'Corners a match', fmt: dec1, what: 'corners won per match: pressure in the final third', get: (t) => perApp(t.s('general.wonCorners'), t) },
    { key: 'cards', group: 'Discipline', label: 'Cards a match', low: true, fmt: dec2, what: 'yellow cards per match, a red counting two', get: (t) => perApp(sum(t.s('general.yellowCards'), 2 * (t.s('general.redCards') ?? 0)), t) },
    { key: 'fouls', group: 'Discipline', label: 'Fouls a match', low: true, fmt: dec1, what: 'fouls committed per match', get: (t) => perApp(t.s('general.foulsCommitted'), t) },
    { key: 'crosses', group: 'Style', style: true, label: 'Crosses a match', fmt: dec1, what: 'balls whipped in from wide: a style, not a grade', get: (t) => perApp(t.s('offensive.totalCrosses'), t) },
    { key: 'long', group: 'Style', style: true, label: 'Long-ball share', fmt: pct1, what: 'passes played long: going direct rather than building', get: (t) => div(t.s('offensive.totalLongBalls'), t.s('offensive.totalPasses')) },
  ],
};
// the measures a grade is made of, by weight: the ones that win games
const GRADE_WEIGHTS: Record<Sport, Record<string, number>> = {
  football: { winPct: 2, margin: 3, ypp: 1.5, oypp: 1.5, nya: 1, onya: 1, toDiff: 1, third: 0.5, othird: 0.5 },
  basketball: { winPct: 2, net: 3, ortg: 1.5, drtg: 1.5, efg: 1, oefg: 1, tov: 0.5, dreb: 0.5 },
  soccer: { ppg: 3, xgd: 2.5, gd: 1.5, xg: 1, xga: 1 },
};
// the record itself and the near-duplicates stay off the strengths and weaknesses: the reasons for a record go there
const OFF_LIST: Record<Sport, string[]> = {
  football: ['winPct', 'margin', 'ppg', 'papg', 'take', 'give'],
  basketball: ['winPct', 'margin', 'net', 'stl'],
  soccer: ['ppg', 'gd', 'xgd', 'sot', 'corners'],
};

export interface Ranked { key: string; label: string; group: MeasureGroup; style: boolean; low: boolean; value: number; rank: number; of: number; avg: number; best: number; worst: number; pct: number; fmt: (v: number) => string; what: string }
export interface Table { sport: Sport; ranks: Record<string, Ranked[]>; grades: Record<string, { grade: string; score: number }> }

const tOf = (s: StatFn, row: SportClubRow): T => ({ row, gp: row.gp, s: (k) => s(row.code, k), o: (k) => s(row.code, k, 'opp') });
export const gradeOf = (score: number) => (score >= 0.9 ? 'A+' : score >= 0.8 ? 'A' : score >= 0.72 ? 'A-' : score >= 0.65 ? 'B+' : score >= 0.58 ? 'B' : score >= 0.5 ? 'B-' : score >= 0.43 ? 'C+' : score >= 0.36 ? 'C' : score >= 0.28 ? 'C-' : score >= 0.2 ? 'D' : 'F');

// every club ranked on every measure (1 is best), and a grade for each from the measures that win
export function table(l: SportLeague): Table {
  const s = statsOf(l);
  const ms = MEASURES[l.sport];
  const clubs = l.clubs.filter((c) => c.gp > 0);
  const vals = new Map(ms.map((m) => [m.key, new Map(clubs.map((c) => [c.code, m.get(tOf(s, c))]))]));
  const ranks: Record<string, Ranked[]> = Object.fromEntries(l.clubs.map((c) => [c.code, [] as Ranked[]]));
  for (const m of ms) {
    const rows = [...vals.get(m.key)!.entries()].filter((x): x is [string, number] => x[1] != null && Number.isFinite(x[1]));
    if (rows.length < Math.min(8, l.clubs.length)) continue;
    const all = rows.map(([, v]) => v);
    const avg = all.reduce((a, b) => a + b, 0) / all.length;
    for (const [code, v] of rows) {
      const rank = 1 + rows.filter(([, x]) => (m.low ? x < v : x > v)).length;
      ranks[code].push({ key: m.key, label: m.label, group: m.group, style: !!m.style, low: !!m.low, value: v, rank, of: rows.length, avg,
        best: m.low ? Math.min(...all) : Math.max(...all), worst: m.low ? Math.max(...all) : Math.min(...all),
        pct: rows.length > 1 ? 1 - (rank - 1) / (rows.length - 1) : 0.5, fmt: m.fmt, what: m.what });
    }
  }
  // a grade from the measures that win, pulled toward the middle while the season is young, with the club's strength
  // beside it (its margin and the market's view of it), which knows more than a handful of games can say
  const W = GRADE_WEIGHTS[l.sport], cfg = SPORTS[l.sport];
  const str = l.sport === 'soccer' ? null : strengths(l);
  const ratings = str ? [...str.values()].map((x) => x.rating) : [];
  const grades: Table['grades'] = {};
  for (const c of l.clubs) {
    let sw = 0, st = 0;
    for (const r of ranks[c.code]) { const w = W[r.key]; if (w) { st += w * r.pct; sw += w; } }
    const shrink = c.gp / (c.gp + cfg.early / 3);
    let score = sw ? 0.5 + (st / sw - 0.5) * shrink : 0.5;
    const me = str?.get(c.code);
    if (me && ratings.length > 1) {
      const pct = ratings.filter((x) => x < me.rating).length / (ratings.length - 1);
      score = (score * sw + pct * 3) / (sw + 3);
    }
    grades[c.code] = { grade: gradeOf(score), score };
  }
  return { sport: l.sport, ranks, grades };
}

// ── the games
export interface Played { at: string; home: string; away: string; hs: number; as: number; round: number | null }
export interface Upcoming { at: string; home: string; away: string; round: number | null; pH: number | null; pA: number | null; pD: number | null; line: number | null }
export function gamesOf(l: SportLeague) {
  const played: Played[] = [], left: Upcoming[] = [];
  for (const [at, home, away, hs, as, round, pH, pA, pD, line] of l.games) {
    if (!home || !away) continue;
    if (hs != null && as != null) played.push({ at, home, away, hs, as, round });
    else left.push({ at, home, away, round, pH, pA, pD, line });
  }
  return { played, left };
}

// ── strength: a club's margin a game, as the season and the market see it
// The season's own margin is pulled toward the league average by K games of average play. Where ESPN's market lines
// came with the games (the spread before each one), they say what the market thinks of every club, preseason knowledge
// and injuries included: a club's market rating is solved from all of them, and its own margin takes over as the games
// add up (half and half after `market` games). Soccer has no spreads; its strength is attack and defence (below).
export interface Strength { rating: number; sd: number; own: number; market: number | null }
export function strengths(l: SportLeague): Map<string, Strength> {
  const cfg = SPORTS[l.sport];
  // every line the market set, the games played included: each fixture keeps its pre-game line
  const all = l.games.filter((g) => g[1] && g[2] && g[9] != null).map((g) => ({ home: g[1]!, away: g[2]!, line: g[9]! }));
  const market = new Map<string, number>();
  if (all.length >= l.clubs.length / 2) {
    // least squares with a small pull to zero: home − away + home edge = −line
    const r = new Map(l.clubs.map((c) => [c.code, 0]));
    const games = new Map<string, { opp: string; target: number }[]>();
    for (const g of all) {
      if (!r.has(g.home) || !r.has(g.away)) continue;
      const t = -g.line - cfg.hfa;
      (games.get(g.home) ?? games.set(g.home, []).get(g.home)!).push({ opp: g.away, target: t });
      (games.get(g.away) ?? games.set(g.away, []).get(g.away)!).push({ opp: g.home, target: -t });
    }
    for (let it = 0; it < 60; it++) {
      for (const [code, gs] of games) r.set(code, gs.reduce((s, g) => s + g.target + r.get(g.opp)!, 0) / (gs.length + 1));
      const mean = [...r.values()].reduce((a, b) => a + b, 0) / r.size;
      for (const [k, v] of r) r.set(k, v - mean);
    }
    for (const [k, v] of r) if (games.has(k)) market.set(k, v);
  }
  const out = new Map<string, Strength>();
  for (const c of l.clubs) {
    const margin = c.gp ? (c.pf - c.pa) / c.gp : 0;
    const own = (margin * c.gp) / (c.gp + cfg.K);
    const m = market.get(c.code) ?? null;
    const w = m == null ? 1 : c.gp / (c.gp + cfg.market);
    const rating = m == null ? own : w * margin + (1 - w) * m;
    out.set(c.code, { rating, own, market: m, sd: cfg.sigma / Math.sqrt(c.gp + (m == null ? cfg.K : cfg.market + cfg.K)) });
  }
  return out;
}

// soccer's strength: how many goals a side makes and allows against an average one, from its expected goals (the
// chances, which settle faster than the goals) and its goals, pulled toward the league by K matches of average play
export interface SoccerStrength { att: number; def: number; xg: number | null; xga: number | null }
export function soccerStrengths(l: SportLeague) {
  const s = statsOf(l);
  const { played } = gamesOf(l);
  const K = SPORTS.soccer.K;
  const raw = l.clubs.map((c) => {
    const xg = s(c.code, 'offensive.avgExpectedGoals'), xga = s(c.code, 'goalKeeping.avgExpectedGoalsConceded');
    const gf = c.gp ? c.pf / c.gp : null, ga = c.gp ? c.pa / c.gp : null;
    const blend = (x: number | null, g: number | null) => (x != null && g != null ? 0.65 * x + 0.35 * g : x ?? g);
    return { c, xg, xga, a: blend(xg, gf), d: blend(xga, ga) };
  });
  const mu = (() => { const v = raw.map((x) => x.a).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1.35; })();
  const out = new Map<string, SoccerStrength>();
  for (const x of raw) {
    const gp = x.c.gp;
    out.set(x.c.code, { att: ((x.a ?? mu) * gp + mu * K) / (gp + K) / mu, def: ((x.d ?? mu) * gp + mu * K) / (gp + K) / mu, xg: x.xg, xga: x.xga });
  }
  // the home and away goal rates from the matches played, with fifty matches of a typical season behind them
  const n = played.length;
  const home = (played.reduce((t, g) => t + g.hs, 0) + 1.55 * 50) / (n + 50), away = (played.reduce((t, g) => t + g.as, 0) + 1.25 * 50) / (n + 50);
  return { by: out, home, away, mu };
}

// the chance a home side wins (football, basketball) from the two strengths
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
export const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const poisson = (r: () => number, lambda: number) => { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= r(); } while (p > L && k < 12); return k - 1; };
// the chances of a home win, a draw and an away win between two soccer sides, from their scoring rates (to ten goals)
export function soccerProbs(lh: number, la: number) {
  const pmf = (lam: number) => { const out: number[] = []; let p = Math.exp(-lam); for (let k = 0; k <= 10; k++) { out.push(p); p *= lam / (k + 1); } return out; };
  const a = pmf(lh), b = pmf(la);
  let h = 0, d = 0, w = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = a[i] * b[j]; if (i > j) h += p; else if (i === j) d += p; else w += p; }
  const t = h + d + w;
  return { h: h / t, d: d / t, a: w / t };
}

// ── the outlook: every club's season and spring, simulated
export interface Chances {
  playoffs: number; division: number; top: number; conf: number; finals: number; title: number;   // football, basketball
  playIn: number; top6: number; round2: number;                                                    // basketball
  top4: number; top7: number; relegated: number; positions: number[];                              // soccer: by place
  projected: { low: number; mid: number; high: number };   // wins (points for soccer) at the end of the season
}
export interface Outlook { sims: number; chances: Record<string, Chances>; left: number }
const emptyChances = (n: number): Chances => ({ playoffs: 0, division: 0, top: 0, conf: 0, finals: 0, title: 0, playIn: 0, top6: 0, round2: 0, top4: 0, top7: 0, relegated: 0, positions: new Array(n).fill(0), projected: { low: 0, mid: 0, high: 0 } });

export function outlook(l: SportLeague, sims = 4000): Outlook | null {
  if (l.clubs.length < 8) return null;
  return l.sport === 'soccer' ? soccerOutlook(l, sims) : usOutlook(l, sims);
}

function usOutlook(l: SportLeague, sims: number): Outlook {
  const cfg = SPORTS[l.sport];
  const { played, left } = gamesOf(l);
  const str = strengths(l);
  const codes = l.clubs.map((c) => c.code);
  const idx = new Map(codes.map((c, i) => [c, i]));
  // the record from the games played, so the games still to play add up to a season
  const w0 = new Array(codes.length).fill(0), t0 = new Array(codes.length).fill(0), m0 = new Array(codes.length).fill(0);
  for (const g of played) {
    const h = idx.get(g.home), a = idx.get(g.away);
    if (h == null || a == null) continue;
    if (g.hs > g.as) w0[h]++; else if (g.hs < g.as) w0[a]++; else { t0[h]++; t0[a]++; }
    m0[h] += g.hs - g.as; m0[a] += g.as - g.hs;
  }
  // a game the market priced is the market's chance; the rest come from the two strengths
  const rest = left.map((g) => ({ h: idx.get(g.home), a: idx.get(g.away), p: g.pH != null && g.pA != null && g.pH + g.pA > 0 ? g.pH / (g.pH + g.pA) : null }))
    .filter((g): g is { h: number; a: number; p: number | null } => g.h != null && g.a != null);
  const base = codes.map((c) => str.get(c)!);
  const confs = [...new Set(l.clubs.map((c) => c.conf ?? ''))];
  const r = rng(seedOf(`${l.league}:${played.length}:${codes.join('')}`));
  const ch = codes.map(() => emptyChances(codes.length));
  const wins: number[][] = codes.map(() => []);
  const football = l.sport === 'football';
  for (let s = 0; s < sims; s++) {
    // this season's true strengths: the estimate, give or take what a season this short can't yet say
    const rt = base.map((b) => b.rating + normal(r) * b.sd);
    const w = w0.slice(), t = t0.slice(), m = m0.slice();
    for (const g of rest) {
      const p = g.p ?? phi((rt[g.h] - rt[g.a] + cfg.hfa) / cfg.sigma);
      if (r() < p) w[g.h]++; else w[g.a]++;
      const mg = rt[g.h] - rt[g.a] + cfg.hfa;
      m[g.h] += mg; m[g.a] -= mg;
    }
    // the order: wins (a tie half), then the margin, then a coin
    const key = codes.map((_, i) => (w[i] + t[i] / 2) * 1e6 + m[i] + r() * 0.01);
    // one game: a at home (1), b at home (-1) or a neutral field (0)
    const game = (a: number, b: number, venue: 1 | 0 | -1) => r() < phi((rt[a] - rt[b] + venue * cfg.hfa) / cfg.sigma);
    // a best of seven, home court to the better record: games 1, 2, 5 and 7
    const series = (a: number, b: number) => {
      const [hi, lo] = key[a] >= key[b] ? [a, b] : [b, a];
      let x = 0, y = 0;
      for (let n = 0; x < 4 && y < 4; n++) { if (game(hi, lo, n === 0 || n === 1 || n === 4 || n === 6 ? 1 : -1)) x++; else y++; }
      return x === 4 ? hi : lo;
    };
    const champs: number[] = [];
    for (const conf of confs) {
      const inConf = codes.map((_, i) => i).filter((i) => (l.clubs[i].conf ?? '') === conf).sort((a, b) => key[b] - key[a]);
      if (football) {
        if (inConf.length < 7) continue;
        // the four division winners seeded first, then the three best of the rest
        const winners = [...new Set(inConf.map((i) => l.clubs[i].div))].map((dv) => inConf.find((i) => l.clubs[i].div === dv)!).sort((a, b) => key[b] - key[a]);
        winners.forEach((i) => ch[i].division++);
        const seeds = [...winners, ...inConf.filter((i) => !winners.includes(i)).slice(0, 3)];
        seeds.forEach((i) => ch[i].playoffs++);
        ch[seeds[0]].top++;
        // wild-card weekend: 2 v 7, 3 v 6 and 4 v 5 at the higher seed; the top seed rests
        const alive = [seeds[0], ...[[1, 6], [2, 5], [3, 4]].map(([a, b]) => (game(seeds[a], seeds[b], 1) ? seeds[a] : seeds[b]))]
          .sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
        // the top seed left plays the lowest left
        const d1 = game(alive[0], alive[3], 1) ? alive[0] : alive[3];
        const d2 = game(alive[1], alive[2], 1) ? alive[1] : alive[2];
        [d1, d2].forEach((i) => ch[i].conf++);
        const [hi, lo] = seeds.indexOf(d1) < seeds.indexOf(d2) ? [d1, d2] : [d2, d1];
        const champ = game(hi, lo, 1) ? hi : lo;
        ch[champ].finals++;
        champs.push(champ);
      } else {
        if (inConf.length < 10) continue;
        // six straight in; seven to ten play in: 7 v 8 for the seventh seed, its loser against the winner of 9 v 10
        inConf.slice(0, 6).forEach((i) => ch[i].top6++);
        inConf.slice(6, 10).forEach((i) => ch[i].playIn++);
        const [s7, s8, s9, s10] = inConf.slice(6, 10);
        const first = game(s7, s8, 1);
        const seven = first ? s7 : s8, loser = first ? s8 : s7;
        const other = game(s9, s10, 1) ? s9 : s10;
        const eight = game(loser, other, 1) ? loser : other;
        const seeds = [...inConf.slice(0, 6), seven, eight];
        seeds.forEach((i) => ch[i].playoffs++);
        ch[seeds[0]].top++;
        const r1 = [series(seeds[0], seeds[7]), series(seeds[3], seeds[4]), series(seeds[1], seeds[6]), series(seeds[2], seeds[5])];
        r1.forEach((i) => ch[i].round2++);
        const r2 = [series(r1[0], r1[1]), series(r1[2], r1[3])];
        r2.forEach((i) => ch[i].conf++);
        const champ = series(r2[0], r2[1]);
        ch[champ].finals++;
        champs.push(champ);
      }
    }
    // the final: a neutral field for the Super Bowl, a series for the NBA's
    if (champs.length === 2) ch[football ? (game(champs[0], champs[1], 0) ? champs[0] : champs[1]) : series(champs[0], champs[1])].title++;
    codes.forEach((_, i) => wins[i].push(w[i] + t[i] / 2));
  }
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const out: Record<string, Chances> = {};
  codes.forEach((c, i) => {
    const x = ch[i];
    const ws = wins[i].sort((a, b) => a - b);
    out[c] = { ...x, playoffs: x.playoffs / sims, division: x.division / sims, top: x.top / sims, conf: x.conf / sims, finals: x.finals / sims, title: x.title / sims,
      playIn: x.playIn / sims, top6: x.top6 / sims, round2: x.round2 / sims, positions: [], projected: { low: q(ws, 0.1), mid: q(ws, 0.5), high: q(ws, 0.9) } };
  });
  return { sims, chances: out, left: rest.length };
}

function soccerOutlook(l: SportLeague, sims: number): Outlook {
  const { played, left } = gamesOf(l);
  const { by, home, away } = soccerStrengths(l);
  const codes = l.clubs.map((c) => c.code);
  const n = codes.length;
  const idx = new Map(codes.map((c, i) => [c, i]));
  const pts0 = new Array(n).fill(0), gd0 = new Array(n).fill(0), gf0 = new Array(n).fill(0);
  for (const g of played) {
    const h = idx.get(g.home), a = idx.get(g.away);
    if (h == null || a == null) continue;
    pts0[h] += g.hs > g.as ? 3 : g.hs === g.as ? 1 : 0; pts0[a] += g.as > g.hs ? 3 : g.hs === g.as ? 1 : 0;
    gd0[h] += g.hs - g.as; gd0[a] += g.as - g.hs; gf0[h] += g.hs; gf0[a] += g.as;
  }
  l.clubs.forEach((c, i) => { pts0[i] -= c.deducted ?? 0; });
  const rest = left.map((g) => ({ h: idx.get(g.home), a: idx.get(g.away), o: g.pH != null && g.pA != null && g.pD != null ? [g.pH, g.pD, g.pA] : null }))
    .filter((g): g is { h: number; a: number; o: number[] | null } => g.h != null && g.a != null);
  const st = codes.map((c) => by.get(c)!);
  const r = rng(seedOf(`${l.league}:${played.length}:${codes.join('')}`));
  const ch = codes.map(() => emptyChances(n));
  const final: number[][] = codes.map(() => []);
  for (let s = 0; s < sims; s++) {
    const att = st.map((x) => x.att * Math.exp(normal(r) * 0.08)), dfn = st.map((x) => x.def * Math.exp(normal(r) * 0.08));
    const pts = pts0.slice(), gd = gd0.slice(), gf = gf0.slice();
    for (const g of rest) {
      const lh = home * att[g.h] * dfn[g.a], la = away * att[g.a] * dfn[g.h];
      let hs = poisson(r, lh), as = poisson(r, la);
      if (g.o) {
        // the market's result, with a score the model finds for it
        const t = g.o[0] + g.o[1] + g.o[2], u = r() * t;
        const want = u < g.o[0] ? 1 : u < g.o[0] + g.o[1] ? 0 : -1;
        for (let k = 0; k < 12 && Math.sign(hs - as) !== want; k++) { hs = poisson(r, lh); as = poisson(r, la); }
        if (Math.sign(hs - as) !== want) [hs, as] = want === 1 ? [1, 0] : want === 0 ? [1, 1] : [0, 1];
      }
      pts[g.h] += hs > as ? 3 : hs === as ? 1 : 0; pts[g.a] += as > hs ? 3 : hs === as ? 1 : 0;
      gd[g.h] += hs - as; gd[g.a] += as - hs; gf[g.h] += hs; gf[g.a] += as;
    }
    const order = codes.map((_, i) => i).sort((a, b) => pts[b] - pts[a] || gd[b] - gd[a] || gf[b] - gf[a] || r() - 0.5);
    order.forEach((i, place) => {
      ch[i].positions[place]++;
      if (place === 0) ch[i].title++;
      if (place < 4) ch[i].top4++;
      if (place < 7) ch[i].top7++;
      if (place >= n - 3) ch[i].relegated++;
    });
    codes.forEach((_, i) => final[i].push(pts[i]));
  }
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const out: Record<string, Chances> = {};
  codes.forEach((c, i) => {
    const x = ch[i], ps = final[i].sort((a, b) => a - b);
    out[c] = { ...x, title: x.title / sims, top4: x.top4 / sims, top7: x.top7 / sims, relegated: x.relegated / sims, positions: x.positions.map((v) => v / sims),
      projected: { low: q(ps, 0.1), mid: q(ps, 0.5), high: q(ps, 0.9) } };
  });
  return { sims, chances: out, left: rest.length };
}

// ── luck: the record against what the scoring has earned
export interface Luck { expected: number; actual: number; diff: number; close: { w: number; l: number; d: number } | null; tone: 'hot' | 'cold' | 'fair'; read: string;
  finishing: number | null; keeping: number | null }
export function luck(l: SportLeague, code: string): Luck | null {
  const c = l.clubs.find((x) => x.code === code);
  if (!c || !c.gp) return null;
  const cfg = SPORTS[l.sport];
  const { played } = gamesOf(l);
  const mine = played.filter((g) => g.home === code || g.away === code);
  const close = mine.reduce((t, g) => {
    const us = g.home === code ? g.hs : g.as, them = g.home === code ? g.as : g.hs;
    if (Math.abs(us - them) > cfg.close) return t;
    if (us > them) t.w++; else if (us < them) t.l++; else t.d++;
    return t;
  }, { w: 0, l: 0, d: 0 });
  if (l.sport === 'soccer') {
    const s = statsOf(l);
    const xg = s(code, 'offensive.avgExpectedGoals'), xga = s(code, 'goalKeeping.avgExpectedGoalsConceded');
    if (xg == null || xga == null || c.pts == null) return null;
    // the points the chances were worth: each match a draw from the side's expected goals for and against
    const p = soccerProbs(xg, xga);
    const expected = (3 * p.h + p.d) * c.gp, actual = c.pts + (c.deducted ?? 0);
    const diff = actual - expected;
    const finishing = c.pf - xg * c.gp, keeping = xga * c.gp - c.pa;
    const band = 2 + 0.15 * c.gp;
    const tone = diff >= band ? 'hot' : diff <= -band ? 'cold' : 'fair';
    const read = `Their chances (${(xg * c.gp).toFixed(1)} expected goals for, ${(xga * c.gp).toFixed(1)} against) are worth ${expected.toFixed(1)} points; they have ${actual}. `
      + (tone === 'hot' ? `That is ${diff.toFixed(1)} more than the chances explain: ` : tone === 'cold' ? `That is ${(-diff).toFixed(1)} fewer than the chances explain: ` : 'The table is about what the football has earned. ')
      + (tone === 'fair' ? '' : `${Math.abs(finishing) >= 2 ? `the finishing is ${signed(dec1)(finishing)} goals against the chances` : 'the finishing is about par'}, ${Math.abs(keeping) >= 2 ? `the keeping ${signed(dec1)(keeping)}` : 'the keeping about par'}. Both tend to drift back.`);
    return { expected, actual, diff, close: c.gp >= 3 ? close : null, tone, read, finishing, keeping };
  }
  const x = cfg.pyth;
  const share = c.pf ** x / (c.pf ** x + c.pa ** x || 1);
  const expected = share * c.gp, actual = c.w + c.d / 2, diff = actual - expected;
  const band = 0.75 + 0.03 * c.gp;
  const tone = diff >= band ? 'hot' : diff <= -band ? 'cold' : 'fair';
  const cl = close.w + close.l + close.d;
  const read = `Their points (${c.pf} for, ${c.pa} against) are worth ${expected.toFixed(1)} wins; they have ${actual % 1 ? actual.toFixed(1) : actual}. `
    + (tone === 'hot' ? `That's ${diff.toFixed(1)} more than the scoring explains${cl ? `, most of it in close games (${close.w}-${close.l}${close.d ? `-${close.d}` : ''} within ${cfg.close} points)` : ''}: close games even out over a season.`
      : tone === 'cold' ? `That's ${(-diff).toFixed(1)} fewer than the scoring explains${cl ? ` (${close.w}-${close.l}${close.d ? `-${close.d}` : ''} in games within ${cfg.close} points)` : ''}: the record should catch up with the play.`
        : 'The record is what the scoring has earned.');
  return { expected, actual, diff, close: cl ? close : null, tone, read, finishing: null, keeping: null };
}

// ── form: the last few games
export interface FormGame { at: string; opp: string; home: boolean; us: number; them: number; res: 'W' | 'L' | 'D' }
export interface Form { games: FormGame[]; w: number; l: number; d: number; margin: number; seasonMargin: number; trend: 'up' | 'down' | 'flat' }
export function form(l: SportLeague, code: string): Form | null {
  const cfg = SPORTS[l.sport];
  const all = gamesOf(l).played.filter((g) => g.home === code || g.away === code).sort((a, b) => a.at.localeCompare(b.at))
    .map((g): FormGame => { const home = g.home === code, us = home ? g.hs : g.as, them = home ? g.as : g.hs; return { at: g.at, opp: home ? g.away : g.home, home, us, them, res: us > them ? 'W' : us < them ? 'L' : 'D' }; });
  if (!all.length) return null;
  const games = all.slice(-cfg.form);
  const m = (gs: FormGame[]) => gs.reduce((t, g) => t + g.us - g.them, 0) / gs.length;
  const margin = m(games), seasonMargin = m(all);
  const gap = l.sport === 'soccer' ? 0.5 : l.sport === 'football' ? 5 : 4;
  return { games, w: games.filter((g) => g.res === 'W').length, l: games.filter((g) => g.res === 'L').length, d: games.filter((g) => g.res === 'D').length,
    margin, seasonMargin, trend: all.length >= games.length + 2 && margin - seasonMargin >= gap / 2 ? 'up' : all.length >= games.length + 2 && seasonMargin - margin >= gap / 2 ? 'down' : 'flat' };
}

// ── the schedule still to play
export interface NextGame { at: string; opp: string; home: boolean; win: number; draw: number | null; market: boolean }
export interface Ahead { left: number; home: number; hardness: number; rank: number; of: number; next: NextGame[]; toughest: string | null }
export function ahead(l: SportLeague, code: string): Ahead | null {
  const { left } = gamesOf(l);
  const mine = left.filter((g) => g.home === code || g.away === code).sort((a, b) => a.at.localeCompare(b.at));
  if (!mine.length) return null;
  const cfg = SPORTS[l.sport];
  const soccer = l.sport === 'soccer';
  const ss = soccer ? soccerStrengths(l) : null;
  const us = soccer ? null : strengths(l);
  // an opponent's strength: its margin a game (its expected goal difference for soccer)
  const power = (c: string) => (soccer ? (() => { const x = ss!.by.get(c); return x ? ss!.mu * (x.att - x.def) : 0; })() : us!.get(c)?.rating ?? 0);
  const hardness = (cc: string) => { const gs = left.filter((g) => g.home === cc || g.away === cc); return gs.length ? gs.reduce((t, g) => t + power(g.home === cc ? g.away : g.home), 0) / gs.length : null; };
  const all = l.clubs.map((c) => ({ c: c.code, h: hardness(c.code) })).filter((x): x is { c: string; h: number } => x.h != null).sort((a, b) => b.h - a.h);
  const counts = new Map<string, number>();
  mine.forEach((g) => { const o = g.home === code ? g.away : g.home; counts.set(o, (counts.get(o) ?? 0) + 1); });
  const next = mine.slice(0, 5).map((g): NextGame => {
    const home = g.home === code, opp = home ? g.away : g.home;
    if (g.pH != null && g.pA != null) {
      const t = g.pH + g.pA + (g.pD ?? 0);
      return { at: g.at, opp, home, win: (home ? g.pH : g.pA) / t, draw: g.pD != null ? g.pD / t : null, market: true };
    }
    if (soccer) {
      const a = ss!.by.get(g.home)!, b = ss!.by.get(g.away)!;
      const p = soccerProbs(ss!.home * a.att * b.def, ss!.away * b.att * a.def);
      return { at: g.at, opp, home, win: home ? p.h : p.a, draw: p.d, market: false };
    }
    const p = phi((power(g.home) - power(g.away) + cfg.hfa) / cfg.sigma);
    return { at: g.at, opp, home, win: home ? p : 1 - p, draw: null, market: false };
  });
  const toughest = [...counts.keys()].sort((a, b) => power(b) - power(a))[0] ?? null;
  return { left: mine.length, home: mine.filter((g) => g.home === code).length, hardness: hardness(code) ?? 0, rank: all.findIndex((x) => x.c === code) + 1, of: all.length, next, toughest };
}

// ── the players
export interface Leader { cat: string; label: string; rows: { player: SportPlayer | null; id: string; name: string; value: number; display: string }[] }
export interface PlayerLine { player: SportPlayer; cells: Record<string, number | null> }
export interface PlayersRead {
  leaders: Leader[]; table: PlayerLine[]; cols: { key: string; label: string; fmt: (v: number) => string }[];
  stars: { names: string[]; share: number; what: string } | null; coreAge: number | null; avgAge: number | null; young: number; old: number;
  hurt: SportPlayer[];
}
// the leader categories worth showing, in the sport's order and words
const LEAD: Record<Sport, [string, string][]> = {
  football: [['passingYards', 'Passing'], ['rushingYards', 'Rushing'], ['receivingYards', 'Receiving'], ['totalTackles', 'Tackles'], ['sacks', 'Sacks'], ['interceptions', 'Interceptions']],
  basketball: [['pointsPerGame', 'Points'], ['reboundsPerGame', 'Rebounds'], ['assistsPerGame', 'Assists'], ['stealsPerGame', 'Steals'], ['blocksPerGame', 'Blocks'], ['3PointMadePerGame', 'Threes']],
  soccer: [['goals', 'Goals'], ['assists', 'Assists'], ['shotsOnTarget', 'On target'], ['accuratePasses', 'Passes'], ['saves', 'Saves']],
};
export function playersRead(l: SportLeague, club: SportClub): PlayersRead {
  const sport = l.sport;
  const byId = new Map(club.players.map((p) => [p.id, p]));
  const lgName = new Map(l.leaders.flatMap((c) => c.rows).filter((r) => r.id).map((r) => [r.id!, r.name]));
  const cat = (k: string) => club.leaders.find((c) => c.cat === k);
  const leaders: Leader[] = LEAD[sport].map(([k, label]) => {
    const c = cat(k);
    const rows = (c?.rows ?? []).filter((r) => r.value > 0).slice(0, 3).map((r) => ({ player: byId.get(r.id) ?? null, id: r.id, name: byId.get(r.id)?.name ?? lgName.get(r.id) ?? 'A player', value: r.value, display: r.display }));
    return { cat: k, label, rows };
  }).filter((x) => x.rows.length);
  // the table: basketball's every player from the leader lists (each lists the whole roster), soccer's from the roster
  let cols: PlayersRead['cols'] = [], lines: PlayerLine[] = [];
  if (sport === 'basketball') {
    cols = [['minutesPerGame', 'MIN', dec1], ['pointsPerGame', 'PTS', dec1], ['reboundsPerGame', 'REB', dec1], ['assistsPerGame', 'AST', dec1], ['stealsPerGame', 'STL', dec1],
      ['blocksPerGame', 'BLK', dec1], ['fieldGoalPercentage', 'FG%', dec1], ['3PointMadePerGame', '3PM', dec1], ['PER', 'PER', dec1]].map(([key, label, fmt]) => ({ key: key as string, label: label as string, fmt: fmt as (v: number) => string }));
    const ids = new Set(club.leaders.flatMap((c) => c.rows.map((r) => r.id)));
    lines = [...ids].map((id) => byId.get(id)).filter((p): p is SportPlayer => !!p).map((p) => ({ player: p, cells: Object.fromEntries(cols.map((c) => [c.key, cat(c.key)?.rows.find((r) => r.id === p.id)?.value ?? null])) }))
      .sort((a, b) => (b.cells.minutesPerGame ?? 0) - (a.cells.minutesPerGame ?? 0));
  } else if (sport === 'soccer') {
    cols = [['apps', 'Apps', String], ['g', 'G', String], ['a', 'A', String], ['sh', 'Shots', String], ['sot', 'On tgt', String], ['yc', 'YC', String]].map(([key, label, fmt]) => ({ key: key as string, label: label as string, fmt: fmt as (v: number) => string }));
    lines = club.players.filter((p) => (p.season?.apps ?? 0) > 0).map((p) => ({ player: p, cells: { apps: p.season!.apps, g: p.season!.g, a: p.season!.a, sh: p.season!.sh, sot: p.season!.sot, yc: p.season!.yc } }))
      .sort((a, b) => (b.cells.apps ?? 0) - (a.cells.apps ?? 0) || (b.cells.g ?? 0) - (a.cells.g ?? 0));
  }
  // how much rides on the top two
  let stars: PlayersRead['stars'] = null;
  if (sport === 'basketball') {
    const pts = club.leaders.find((c) => c.cat === 'pointsPerGame')?.rows ?? [];
    const total = pts.reduce((t, r) => t + r.value, 0);
    if (pts.length >= 3 && total > 0) stars = { names: pts.slice(0, 2).map((r) => byId.get(r.id)?.name ?? 'A player'), share: (pts[0].value + pts[1].value) / total, what: 'of the points' };
  } else if (sport === 'soccer') {
    const g = club.players.map((p) => ({ p, g: p.season?.g ?? 0 })).sort((a, b) => b.g - a.g);
    const total = g.reduce((t, x) => t + x.g, 0);
    if (total >= 5) stars = { names: g.slice(0, 2).map((x) => x.p.name), share: (g[0].g + (g[1]?.g ?? 0)) / total, what: 'of the goals' };
  } else {
    const rec = cat('receivingYards')?.rows ?? [], rush = cat('rushingYards')?.rows ?? [];
    const yards = [...rec, ...rush];
    const total = yards.reduce((t, r) => t + r.value, 0);
    const per = new Map<string, number>();
    yards.forEach((r) => per.set(r.id, (per.get(r.id) ?? 0) + r.value));
    const top = [...per.entries()].sort((a, b) => b[1] - a[1]);
    if (top.length >= 3 && total > 0) stars = { names: top.slice(0, 2).map(([id]) => byId.get(id)?.name ?? 'A player'), share: (top[0][1] + top[1][1]) / total, what: 'of the yards from scrimmage' };
  }
  // the ages: the whole roster, and the players doing the most
  const ages = club.players.map((p) => p.age).filter((a): a is number => a != null);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const coreIds = sport === 'basketball' ? lines.slice(0, 8).map((x) => x.player.id)
    : sport === 'soccer' ? lines.slice(0, 14).map((x) => x.player.id)
      : [...new Set(club.leaders.filter((c) => LEAD.football.some(([k]) => k === c.cat)).flatMap((c) => c.rows.slice(0, c.cat === 'receivingYards' || c.cat === 'totalTackles' ? 4 : 2).map((r) => r.id)))];
  const coreAges = coreIds.map((id) => byId.get(id)?.age).filter((a): a is number => a != null);
  return {
    leaders, table: lines, cols, stars, coreAge: coreAges.length >= 4 ? coreAges.reduce((a, b) => a + b, 0) / coreAges.length : null, avgAge,
    young: ages.filter((a) => a <= 24).length, old: ages.filter((a) => a >= 31).length,
    hurt: club.players.filter((p) => p.injury && !/^active$/i.test(p.injury.status)),
  };
}

// ── the assessment: grade, strengths and weaknesses, the bigger questions, the needs and the moves
export interface Question { area: string; label: string; verdict: 'Keep' | 'Adjust' | 'Rethink'; title: string; evidence: string[]; action: string }
export interface Need { key: string; label: string; why: string }
export interface Move { area: string; title: string; why: string; priority: 'high' | 'medium' | 'watch' }
export interface SportRead {
  ranks: Ranked[]; strengths: Ranked[]; weaknesses: Ranked[]; grade: string; score: number; early: boolean; gp: number;
  luck: Luck | null; form: Form | null; ahead: Ahead | null; players: PlayersRead | null;
  chances: Chances | null; questions: Question[]; needs: Need[]; moves: Move[]; summary: string;
}
const NEED_LABEL: Record<string, string> = {
  quarterback: 'A quarterback', 'offensive-line': 'The offensive line', 'pass-rush': 'A pass rusher', secondary: 'The secondary', receivers: 'A receiver',
  'running-back': 'A running back', linebackers: 'Linebackers', depth: 'Depth', star: 'A star', shooting: 'Shooting', 'rim-protection': 'Rim protection',
  playmaking: 'Playmaking', defence: 'Perimeter defence', rebounding: 'Rebounding', bench: 'The bench', health: 'Health', goalkeeper: 'A goalkeeper',
  'centre-back': 'A centre-back', 'full-back': 'A full-back', midfield: 'A midfielder', winger: 'A winger', striker: 'A striker', manager: 'A new manager',
};

export function assess(l: SportLeague, code: string, tb: Table, out: Outlook | null, club: SportClub | null): SportRead | null {
  const c = l.clubs.find((x) => x.code === code);
  if (!c) return null;
  const sport = l.sport, cfg = SPORTS[sport];
  const ranks = tb.ranks[code] ?? [];
  const by = (k: string) => ranks.find((r) => r.key === k) ?? null;
  const third = Math.round((l.clubs.length || 30) / 3);
  const top = (r: Ranked | null) => !!r && r.rank <= third;
  const bottom = (r: Ranked | null) => !!r && r.rank > r.of - third;
  const early = c.gp < cfg.early;
  const graded = MEASURES[sport].filter((m) => !m.style && !OFF_LIST[sport].includes(m.key)).map((m) => m.key);
  const strengths = ranks.filter((r) => graded.includes(r.key) && top(r)).sort((a, b) => a.rank - b.rank);
  const weaknesses = ranks.filter((r) => graded.includes(r.key) && bottom(r)).sort((a, b) => b.rank - a.rank);
  const { grade, score } = tb.grades[code] ?? { grade: 'C', score: 0.5 };
  const lk = luck(l, code), fm = form(l, code), ah = ahead(l, code), pl = club ? playersRead(l, club) : null;
  const chances = out?.chances[code] ?? null;
  const sample = early ? ` Only ${count(c.gp, cfg.noun)} in, so a lean, not a verdict.` : '';
  const says = (r: Ranked) => `${r.fmt(r.value)} ${r.label.toLowerCase()}, ${rankWord(r.rank)} of ${r.of}`;
  const qs: Question[] = [];
  const needs: Need[] = [];
  const moves: Move[] = [];
  const need = (key: string, why: string) => { if (!needs.some((n) => n.key === key)) needs.push({ key, label: NEED_LABEL[key] ?? key, why }); };
  // the evidence for a need: the worst-ranked of the measures behind it
  const worst = (...rs: (Ranked | null)[]) => { const x = rs.filter((r): r is Ranked => !!r).sort((a, b) => b.rank / b.of - a.rank / a.of)[0]; return x ? says(x) : ''; };
  const nm = (cc: string | null) => (cc ? l.clubs.find((x) => x.code === cc)?.short ?? cc : '');

  // the window: how old the players doing the most are, and how this season looks
  const coreAge = pl?.coreAge ?? null;
  const po = chances ? (sport === 'soccer' ? chances.top4 : chances.playoffs) : null;
  const poWord = sport === 'soccer' ? 'a top-four finish' : 'the playoffs';
  if (coreAge != null || po != null) {
    const old = coreAge != null && coreAge >= (sport === 'soccer' ? 28.5 : sport === 'basketball' ? 29 : 28);
    const young = coreAge != null && coreAge <= (sport === 'soccer' ? 25 : 25.5);
    const good = po != null && po >= 0.5, bad = po != null && po < 0.15;
    const [verdict, title, action]: [Question['verdict'], string, string] =
      old && bad ? ['Rethink', 'An old core and a fading season', 'Sell the veterans who will not be here for the next good team while they still bring something back, and give the young players the minutes.']
        : old && good ? ['Adjust', 'The window is now', 'Spend for this season and next: the core will not be this good for long, so add the piece that closes the gap rather than waiting.']
          : old ? ['Adjust', 'The window is closing', 'Decide this season: either add for one more push or start moving the veterans while they still bring something back.']
            : young && bad ? ['Keep', 'Building, and it shows', 'Let the young players play through it and judge the season on how they grow, not the table; add veterans only around them.']
              : young && good ? ['Keep', 'Ahead of schedule', 'Add around the young core without trading its development away: the best years are still ahead.']
                : young ? ['Keep', 'A young core with time', 'Be patient: add around the young players, and keep the picks.']
                  : good ? ['Keep', 'In the window', 'Add at the margins and keep the young players: the window is open but not wide.']
                    : bad ? ['Adjust', 'Between windows', 'Decide which way to go: the core is in its prime but the results are not there, so add only what fits the next two seasons as well as this one.']
                      : ['Adjust', 'On the bubble', 'One good addition could swing it: spend where the measures are weakest, not on a name.'];
    qs.push({ area: 'The window', label: 'The window', verdict, title, action,
      evidence: [coreAge != null ? `The players doing the most average ${coreAge.toFixed(1)} years old${pl?.avgAge ? `; the whole roster ${pl.avgAge.toFixed(1)}` : ''}.` : '', po != null ? `Chances of ${poWord}: ${chance(po)}.` : '', pl ? `${pl.young} players 24 or younger, ${pl.old} aged 31 or more.` : ''].filter(Boolean) });
  }

  if (sport === 'football') {
    const ypp = by('ypp'), nya = by('nya'), ypc = by('ypc'), third3 = by('third'), rating = by('rating'), sacked = by('sacked'), ppg = by('ppg');
    const oypp = by('oypp'), onya = by('onya'), oypc = by('oypc'), othird = by('othird'), sackRate = by('sackRate'), orating = by('orating'), papg = by('papg');
    const toDiff = by('toDiff'), pen = by('pen'), fg = by('fg'), punt = by('punt'), kr = by('kr');
    const winning = (by('winPct')?.pct ?? 0.5) >= 0.5;
    if (ypp) {
      const bad = bottom(ypp) || (bottom(nya) && !top(ypc)), good = top(ypp);
      qs.push({ area: 'The attack', label: 'The offence', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'The offence does not move the ball' : good ? 'The offence works' : 'An ordinary offence',
        evidence: [says(ypp) + '.', nya ? `${says(nya)}; ${ypc ? says(ypc) : ''}.` : '', third3 ? `${says(third3)}.` : '', ppg ? `${says(ppg)}.` : ''].filter(Boolean),
        action: bad ? 'Change how the offence is built, not just who calls it: protect the passer, get the ball out quicker, and lean on whichever of the run and the pass is working.' : good ? 'Keep the scheme; add a weapon only if one comes cheap.' : 'Small fixes: more early-down passing, and plays built for third and medium.' });
    }
    if (oypp) {
      const bad = bottom(oypp) || bottom(papg), good = top(oypp) && !bottom(papg);
      qs.push({ area: 'The defence', label: 'The defence', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'The defence gives up too much' : good ? (winning ? 'The defence wins games' : 'The defence holds up its end') : 'A defence in the middle',
        evidence: [says(oypp) + '.', onya ? `${says(onya)}; ${oypc ? says(oypc) : ''}.` : '', sackRate ? `${says(sackRate)}.` : '', othird ? `${says(othird)}.` : ''].filter(Boolean),
        action: bad ? 'The pass defence first: a rusher who wins one-on-one makes every corner better, and simpler coverages to stop the big plays.' : good ? 'Keep the core together; it is the reason this team is in games.' : 'Find the one weak spot the other teams attack every week and spend there.' });
    }
    const passer = pl?.leaders.find((x) => x.cat === 'passingYards')?.rows[0] ?? null;
    if (rating) {
      const bad = bottom(rating), good = top(rating);
      qs.push({ area: 'The stars', label: 'The quarterback', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'The quarterback play is holding them back' : good ? (winning ? 'The quarterback is the reason' : 'The quarterback is not the problem') : 'The quarterback is good enough, not more',
        evidence: [says(rating) + '.', nya ? `${says(nya)}.` : '', sacked ? `${says(sacked)}.` : '', passer ? `${passer.name} has thrown for ${passer.display} yards.` : ''].filter(Boolean),
        action: bad ? 'Make the quarterback position the first question of the offseason, and in the meantime cut the plays that ask him to hold the ball.'
          : good ? (winning ? 'Build the next contract and the roster around him.' : 'The problems are around him: protect him better and give him a receiver who wins on third down.')
            : 'Give him easier throws: quicker reads, better protection, a receiver who wins on third down.' });
      if (bad) need('quarterback', `${says(rating)}.`);
    }
    if (lk) qs.push(recordQuestion(lk, c, sport));
    if (ah) qs.push(aheadQuestion(ah, chances, sport, c, nm));
    if (toDiff || pen) {
      const both = bottom(toDiff) && bottom(pen), flags = bottom(pen), balls = bottom(toDiff), good = top(toDiff) && !bottom(pen);
      qs.push({ area: 'Discipline', label: 'Turnovers and flags', verdict: both ? 'Rethink' : flags || balls ? 'Adjust' : 'Keep',
        title: both ? 'They give games away' : flags ? 'The flags cost them' : balls ? 'The turnovers cost them' : good ? 'They win the hidden yards' : 'Clean enough',
        evidence: [toDiff ? `${says(toDiff)}.` : '', pen ? `${says(pen)}.` : '', by('give') ? `${says(by('give')!)}.` : ''].filter(Boolean),
        action: both ? 'Ball security in every practice, and a cost for the penalties that extend drives: these are the cheapest wins in football.'
          : flags ? 'Find out which penalties they are (holding, false starts, pass interference) and coach the repeat offenders: drives are being handed back.'
            : balls ? 'Protect the ball first: fewer throws into coverage and two hands in traffic.' : 'Keep it up, but do not count on it: turnover margin swings from year to year.' });
    }
    if (fg || punt) {
      const bad = bottom(fg) && bottom(punt), weak = bottom(fg) || bottom(punt) || bottom(kr);
      qs.push({ area: 'Special teams', label: 'Special teams', verdict: bad ? 'Rethink' : weak ? 'Adjust' : 'Keep', title: bad ? 'Special teams cost them' : weak ? 'One unit lets them down' : 'Special teams hold up',
        evidence: [fg ? `${says(fg)}.` : '', punt ? `${says(punt)}.` : '', kr ? `${says(kr)}.` : ''].filter(Boolean),
        action: bad ? 'A kicker and a punter are cheap: bring in competition for both this week.' : weak ? 'Bring in competition for the weak unit; close games turn on it.' : 'Leave it alone.' });
    }
    // the needs, from where it is worst
    if (bottom(sacked) && !top(ypc)) need('offensive-line', `${worst(sacked, ypc)}.`);
    if (bottom(sackRate)) need('pass-rush', `${worst(sackRate)}.`);
    if (bottom(onya) || bottom(orating)) need('secondary', `${worst(onya, orating)}.`);
    if (bottom(oypc)) need('linebackers', `${worst(oypc)}.`);
    if (bottom(ypc) && !bottom(sacked)) need('running-back', `${worst(ypc)}.`);
    if (bottom(nya) && !bottom(rating)) need('receivers', `${worst(nya)}.`);
    if ((pl?.hurt.length ?? 0) >= 8) need('depth', `${pl!.hurt.length} players on the injury report.`);
  } else if (sport === 'basketball') {
    const ortg = by('ortg'), drtg = by('drtg'), efg = by('efg'), oefg = by('oefg'), tov = by('tov'), oreb = by('oreb'), dreb = by('dreb'), three = by('three');
    const blk = by('blk'), ast = by('ast'), othree = by('othree'), paceR = by('pace'), threeRate = by('threeRate');
    if (ortg) {
      const bad = bottom(ortg), good = top(ortg);
      qs.push({ area: 'The attack', label: 'The offence', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'The offence cannot score' : good ? 'The offence is a weapon' : 'An offence in the middle',
        evidence: [says(ortg) + '.', efg ? `${says(efg)}.` : '', tov ? `${says(tov)}.` : '', ast ? `${says(ast)}.` : ''].filter(Boolean),
        action: bad ? 'More shots at the rim and from the corners, fewer long twos, and the ball in the hands that turn it over least.' : good ? 'Keep the shape; protect the shooting with spacing in every lineup.' : 'Move the ball more: assisted baskets are the efficient ones.' });
    }
    if (drtg) {
      const bad = bottom(drtg), good = top(drtg);
      qs.push({ area: 'The defence', label: 'The defence', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'The defence leaks' : good ? 'The defence travels' : 'A defence that comes and goes',
        evidence: [says(drtg) + '.', oefg ? `${says(oefg)}.` : '', dreb ? `${says(dreb)}.` : '', blk ? `${says(blk)}.` : ''].filter(Boolean),
        action: bad ? 'Protect the rim and finish possessions with the rebound: a big who does both changes a defence more than any scheme.' : good ? 'Keep the rotation together.' : 'Close out on the shooters and end possessions with the rebound.' });
    }
    const scorer = pl?.leaders.find((x) => x.cat === 'pointsPerGame')?.rows[0] ?? null;
    if (pl?.stars) {
      const heavy = pl.stars.share >= 0.5, light = pl.stars.share < 0.36;
      qs.push({ area: 'The stars', label: 'The stars', verdict: heavy ? 'Adjust' : 'Keep', title: heavy ? 'Two players carry the scoring' : light ? 'Scoring by committee' : 'A star pair with help',
        evidence: [`${pl.stars.names.join(' and ')}: ${pct0(pl.stars.share)} ${pl.stars.what} between them.`, scorer ? `${scorer.name} scores ${scorer.display} a game.` : ''].filter(Boolean),
        action: heavy ? 'Find a third creator: in the playoffs the defences load up on the top two.' : light ? 'Balance wins in the regular season; a star wins in May. Know which this team needs.' : 'Keep feeding the pair and stagger their minutes so one is always on the floor.' });
      if (light && (scorer?.value ?? 30) < 21) need('star', `No one scores more than ${scorer?.display ?? '20'} a game.`);
    }
    if (pl && pl.table.length >= 8) {
      const minutes = pl.table.map((x) => x.cells.minutesPerGame ?? 0), pts = pl.table.map((x) => (x.cells.pointsPerGame ?? 0));
      const bench = pts.slice(5).reduce((a, b) => a + b, 0), all = pts.reduce((a, b) => a + b, 0);
      const benchShare = all ? bench / all : 0;
      const thin = benchShare < 0.22, deep = benchShare >= 0.33;
      qs.push({ area: 'The depth', label: 'The bench', verdict: thin ? 'Adjust' : 'Keep', title: thin ? 'The bench gives little' : deep ? 'A deep bench' : 'Enough depth',
        evidence: [`The players after the top five in minutes score ${pct0(benchShare)} of the points.`, `${minutes.filter((m) => m >= 20).length} players average 20 minutes or more.`],
        action: thin ? 'One reliable scorer off the bench saves the starters’ legs for the spring.' : 'Keep the rotation honest: minutes for the ones who earn them.' });
      if (thin) need('bench', `The bench scores ${pct0(benchShare)} of the points.`);
    }
    if (lk) qs.push(recordQuestion(lk, c, sport));
    if (ah) qs.push(aheadQuestion(ah, chances, sport, c, nm));
    if (paceR && threeRate) {
      const lowThree = threeRate.rank > threeRate.of - third;
      qs.push({ area: 'The identity', label: 'How they play', verdict: lowThree && !top(efg) ? 'Adjust' : 'Keep', title: lowThree ? (top(efg) ? 'Few threes, and it works' : 'Out of step with the league’s shot chart') : 'A modern shot profile',
        evidence: [`${says(paceR)}.`, `${says(threeRate)}.`, three ? `${says(three)}.` : ''].filter(Boolean),
        action: lowThree && !top(efg) ? 'Take more threes: the math is settled, and the shots are there.' : 'Keep the style; it suits the roster.' });
    }
    if (bottom(three) || (bottom(efg) && !top(three))) need('shooting', `${worst(three, efg)}.`);
    if (bottom(blk) || bottom(oefg)) need('rim-protection', `${worst(blk, oefg)}.`);
    if (bottom(ast) || bottom(tov)) need('playmaking', `${worst(ast, tov)}.`);
    if (bottom(othree) || bottom(drtg)) need('defence', `${worst(othree, drtg)}.`);
    if (bottom(dreb) || bottom(oreb)) need('rebounding', `${worst(dreb, oreb)}.`);
    if ((pl?.hurt.length ?? 0) >= 3) need('health', `${pl!.hurt.length} players on the injury report.`);
  } else {
    const xg = by('xg'), xga = by('xga'), shots = by('shots'), big = by('big'), conv = by('conv'), faced = by('faced'), save = by('save'), cs = by('cs');
    const poss = by('poss'), pass = by('pass'), duels = by('duels'), cards = by('cards'), ga = by('ga'), gf = by('gf'), tackles = by('tackles');
    if (xg) {
      const bad = bottom(xg), good = top(xg);
      qs.push({ area: 'The attack', label: 'The attack', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'Not enough chances' : good ? 'The chances keep coming' : 'An attack in the middle',
        evidence: [says(xg) + '.', shots ? `${says(shots)}.` : '', big ? `${says(big)}.` : '', gf ? `${says(gf)}.` : ''].filter(Boolean),
        action: bad ? 'More bodies in the box and quicker play into the final third: the chances come before the goals.' : good ? 'Keep the pattern; the goals follow the chances.' : 'More runners beyond the striker and more shots from inside the box.' });
    }
    if (xga) {
      const bad = bottom(xga) || bottom(ga), good = top(xga);
      qs.push({ area: 'The defence', label: 'The defence', verdict: bad ? 'Rethink' : good ? 'Keep' : 'Adjust', title: bad ? 'Too many chances given away' : good ? 'Hard to break down' : 'A defence that holds, mostly',
        evidence: [says(xga) + '.', faced ? `${says(faced)}.` : '', cs ? `${says(cs)}.` : '', ga ? `${says(ga)}.` : ''].filter(Boolean),
        action: bad ? 'A compact block and a holding midfielder in front of the back line: stop the chances before asking the keeper to.' : good ? 'Keep the back line together.' : 'Defend the box better on set pieces and crosses, where the cheap goals come from.' });
    }
    if (lk && lk.keeping != null && save) {
      const bad = lk.keeping <= -2.5 || bottom(save), good = lk.keeping >= 2;
      qs.push({ area: 'The crease', label: 'The goalkeeper', verdict: bad ? 'Rethink' : 'Keep', title: bad ? 'The goalkeeping costs goals' : good ? 'The goalkeeper is winning points' : 'The goalkeeping is about par',
        evidence: [`They have conceded ${c.pa} from chances worth ${(c.pa + lk.keeping).toFixed(1)}: ${signed(dec1)(lk.keeping)} goals.`, `${says(save)}.`].filter(Boolean),
        action: bad ? 'Make a goalkeeper the first signing in the next window; no position changes as many points per pound.' : good ? 'Keep him; it is points in the bank.' : 'Leave the position alone.' });
      if (bad) need('goalkeeper', `Conceded ${signed(dec1)(-lk.keeping)} goals against the chances faced.`);
    }
    if (poss) {
      const bad = bottom(poss) && bottom(pass) && bottom(xg), lowBall = bottom(poss);
      qs.push({ area: 'The system', label: 'How they play', verdict: bad ? 'Rethink' : lowBall && !top(xg) ? 'Adjust' : 'Keep', title: bad ? 'No way to keep the ball or hurt teams' : lowBall ? 'A side that plays without the ball' : top(poss) ? 'A side that controls games' : 'A balanced style',
        evidence: [`${says(poss)}.`, pass ? `${says(pass)}.` : '', duels ? `${says(duels)}.` : '', tackles ? `${says(tackles)}.` : ''].filter(Boolean),
        action: bad ? 'Pick a way to play and recruit for it: either a midfield that keeps the ball or a press and a counter that do not need it.' : lowBall ? 'Without the ball the counter has to be sharp: pace in wide areas and a striker who holds it up.' : 'Keep the style; it suits the squad.' });
    }
    if (lk) qs.push(recordQuestion(lk, c, sport));
    if (ah) qs.push(aheadQuestion(ah, chances, sport, c, nm));
    if (pl?.stars) {
      const heavy = pl.stars.share >= 0.55;
      qs.push({ area: 'The depth', label: 'Where the goals come from', verdict: heavy ? 'Adjust' : 'Keep', title: heavy ? 'Two players score most of the goals' : 'Goals from across the side',
        evidence: [`${pl.stars.names.join(' and ')}: ${pct0(pl.stars.share)} ${pl.stars.what}.`],
        action: heavy ? 'A second source of goals for the run-in: an injury to either and the goals dry up.' : 'Keep spreading the goals; it is hard to plan against.' });
      if (heavy) need('striker', `${pl.stars.names.join(' and ')} have ${pct0(pl.stars.share)} of the goals.`);
    }
    if (cards) {
      const bad = bottom(cards);
      qs.push({ area: 'Discipline', label: 'Discipline', verdict: bad ? 'Adjust' : 'Keep', title: bad ? 'Too many cards' : 'Disciplined enough',
        evidence: [`${says(cards)}.`, by('fouls') ? `${says(by('fouls')!)}.` : ''].filter(Boolean),
        action: bad ? 'Cards turn into suspensions in the run-in: fewer tactical fouls high up the pitch.' : 'Nothing to change.' });
    }
    if (bottom(xga) && !bottom(faced)) need('centre-back', `${worst(xga)}.`);
    if (bottom(poss) || bottom(pass)) need('midfield', `${worst(poss, pass)}.`);
    if (bottom(big) || bottom(shots)) need('winger', `${worst(big, shots)}.`);
    if ((lk?.finishing ?? 0) <= -3 || bottom(conv)) need('striker', `${(lk?.finishing ?? 0) <= -3 ? `${signed(dec1)(lk!.finishing!)} goals against the chances` : worst(conv)}.`);
    if (bottom(by('ppg')) && bottom(by('xgd'))) need('manager', `${says(by('ppg')!)}, and the chances say it is no accident (${says(by('xgd')!)}).`);
    if ((pl?.hurt.length ?? 0) >= 5) need('depth', `${pl!.hurt.length} players injured.`);
  }

  // a handful of games is a lean, not a verdict: nothing is torn up on it
  if (early) for (const q of qs) if (q.verdict === 'Rethink') { q.verdict = 'Adjust'; q.evidence.push(`Only ${count(c.gp, cfg.noun)} in: a lean, not a verdict.`); }

  // the moves the numbers point to, most pressing first
  for (const w of weaknesses.slice(0, 3)) moves.push({ area: w.group, priority: w.rank > w.of - 3 ? 'high' : 'medium', title: `Fix ${w.label.toLowerCase()}`,
    why: `${w.fmt(w.value)}, ${rankWord(w.rank)} of ${w.of} (league average ${w.fmt(w.avg)}): ${w.what}.${sample}` });
  if (lk?.tone === 'hot') moves.push({ area: 'Luck', priority: 'watch', title: 'Don’t let the record hide the work', why: lk.read });
  if (lk?.tone === 'cold') moves.push({ area: 'Patience', priority: 'watch', title: 'Stay the course', why: lk.read });
  if (pl && pl.hurt.length >= (sport === 'football' ? 8 : sport === 'basketball' ? 3 : 5)) moves.push({ area: 'Health', priority: 'medium', title: 'Manage the injury list', why: `${pl.hurt.length} players are on the injury report: ${pl.hurt.slice(0, 4).map((p) => `${p.name} (${p.injury!.status.toLowerCase()})`).join(', ')}${pl.hurt.length > 4 ? ' and more' : ''}.` });
  const order = { high: 0, medium: 1, watch: 2 };
  moves.sort((a, b) => order[a.priority] - order[b.priority]);

  const rec = sport === 'soccer' ? `${c.seed ? `${rankWord(c.seed)} in the table` : 'in the table'} on ${c.pts ?? 0} point${c.pts === 1 ? '' : 's'} (${c.w} won, ${c.d} drawn, ${c.l} lost)` : `${c.w}-${c.l}${c.d ? `-${c.d}` : ''}`;
  const place = sport === 'soccer' ? null : c.seed ? `the ${rankWord(c.seed)} seed${c.conf ? ` in the ${c.conf}` : ''}` : null;
  const summary = !c.gp ? `${c.name}: the season is about to start.`
    : `${c.name} are ${rec}${place ? `, ${place}` : ''}${strengths.length ? `, built on ${strengths.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}${weaknesses.length ? `, held back by ${weaknesses.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}.`
      + (lk?.tone === 'hot' ? ' Some of the record is luck.' : lk?.tone === 'cold' ? ' The record owes them.' : '')
      + (chances ? (sport === 'soccer' ? ` Title chances ${chance(chances.title)}, top four ${chance(chances.top4)}, relegation ${chance(chances.relegated)}.` : ` Playoff chances ${chance(chances.playoffs)}, title ${chance(chances.title)}.`) : '')
      + (early ? ` ${count(c.gp, cfg.noun)} in: early, and the numbers will move.` : '');
  return { ranks, strengths, weaknesses, grade, score, early, gp: c.gp, luck: lk, form: fm, ahead: ah, players: pl, chances, questions: qs, needs, moves, summary };
}

function recordQuestion(lk: Luck, c: SportClubRow, sport: Sport): Question {
  const unit = sport === 'soccer' ? 'points' : 'wins';
  return { area: 'The record', label: 'The record', verdict: lk.tone === 'fair' ? 'Keep' : 'Adjust',
    title: lk.tone === 'hot' ? 'Better than the play' : lk.tone === 'cold' ? 'Worse than the play' : 'The record is real',
    evidence: [`${lk.actual % 1 ? lk.actual.toFixed(1) : lk.actual} ${unit} against ${lk.expected.toFixed(1)} earned.`, lk.close ? `${lk.close.w}-${lk.close.l}${lk.close.d ? `-${lk.close.d}` : ''} in ${sport === 'soccer' ? 'one-goal matches' : 'close games'}.` : '', sport === 'soccer' && lk.finishing != null ? `Finishing ${signed(dec1)(lk.finishing)} goals against the chances.` : ''].filter(Boolean),
    action: lk.tone === 'hot' ? `Judge the team on the play, not the table: ${c.short ?? c.name} will need to be better to keep this up.` : lk.tone === 'cold' ? 'Hold your nerve: the results should follow the play without a big change.' : 'The table tells the truth: change what the measures say, not what the results say.' };
}
function aheadQuestion(ah: Ahead, ch: Chances | null, sport: Sport, c: SportClubRow, nm: (code: string | null) => string): Question {
  const hard = ah.rank <= Math.ceil(ah.of / 4), soft = ah.rank > ah.of - Math.ceil(ah.of / 4);
  const mark = ch ? (sport === 'soccer' ? `Chances of a top-four finish ${chance(ch.top4)}, relegation ${chance(ch.relegated)}.` : `Playoff chances ${chance(ch.playoffs)}.`) : '';
  return { area: 'The road ahead', label: 'The road ahead', verdict: hard ? 'Adjust' : 'Keep',
    title: hard ? 'The hardest stretch is still to come' : soft ? 'The schedule is kind from here' : 'An average road ahead',
    evidence: [`${ah.left} ${sport === 'soccer' ? 'matches' : 'games'} left, ${ah.home} at home; the ${rankWord(ah.rank)} hardest schedule of ${ah.of} from here.`, ah.toughest ? `The toughest opponent still to face: ${nm(ah.toughest)}.` : '', mark].filter(Boolean),
    action: hard ? `Bank the points now: ${c.short ?? c.name} will be judged on the run-in.` : soft ? 'The schedule gives them a chance: take it.' : 'Win the games they should, and the rest takes care of itself.' };
}
