// What the fans can add to a fan zone and the calls they can make (migrations 337 and 338). The database checks every
// one of these (_fan_topic_ok and _fan_call_ok, by sport, and fan_post's kinds); supabase/tests/fan-voice.test.mjs keeps
// the two the same, so a list changes here and in a migration together. No imports: the test reads this file on its own.

export type FanKind = 'idea' | 'ask' | 'insight' | 'fact' | 'fix';
// the sports the fan zones carry (fan_leagues.sport): a new league of one of these needs nothing here
export type FanSport = 'hockey' | 'football' | 'basketball' | 'soccer';

export const KINDS: { key: FanKind; label: string; one: string; hint: string; emoji: string }[] = [
  { key: 'idea', label: 'Ideas', one: 'An idea', hint: 'A move, a line or a change you would make', emoji: '💡' },
  { key: 'ask', label: 'Questions', one: 'A question', hint: 'What you would ask the general manager or the coach', emoji: '❓' },
  { key: 'insight', label: 'Insights', one: 'An insight', hint: 'Something you see in the games or the numbers', emoji: '🔎' },
  { key: 'fact', label: 'Facts', one: 'A fact', hint: 'History, records and trivia for the knowledge base', emoji: '📚' },
  { key: 'fix', label: 'Fixes', one: 'A fix', hint: 'Something the analysis or the data got wrong', emoji: '🛠️' },
];

export const TOPICS: [string, string][] = [
  ['goaltending', 'Goaltending'], ['defence', 'Defence'], ['forwards', 'Forwards'], ['special-teams', 'Special teams'],
  ['coaching', 'Coaching'], ['roster', 'Roster and cap'], ['prospects', 'Prospects'], ['history', 'History'],
  ['analytics', 'Analytics'], ['culture', 'Fans and the rink'], ['league', 'The league'], ['other', 'Other'],
];
// each sport's topics, in its own words
export const TOPICS_BY_SPORT: Record<FanSport, [string, string][]> = {
  hockey: TOPICS,
  football: [
    ['quarterback', 'Quarterback'], ['offence', 'Offence'], ['defence', 'Defence'], ['special-teams', 'Special teams'],
    ['coaching', 'Coaching'], ['roster', 'Roster and cap'], ['draft', 'The draft'], ['history', 'History'],
    ['analytics', 'Analytics'], ['culture', 'Fans and the stadium'], ['league', 'The league'], ['other', 'Other'],
  ],
  basketball: [
    ['guards', 'Guards'], ['wings', 'Wings'], ['bigs', 'Bigs'], ['offence', 'Offence'], ['defence', 'Defence'],
    ['coaching', 'Coaching'], ['roster', 'Roster and cap'], ['draft', 'The draft'], ['history', 'History'],
    ['analytics', 'Analytics'], ['culture', 'Fans and the arena'], ['league', 'The league'], ['other', 'Other'],
  ],
  soccer: [
    ['goalkeeping', 'Goalkeeping'], ['defence', 'Defence'], ['midfield', 'Midfield'], ['attack', 'Attack'],
    ['set-pieces', 'Set pieces'], ['manager', 'The manager'], ['transfers', 'Transfers'], ['academy', 'The academy'],
    ['history', 'History'], ['analytics', 'Analytics'], ['culture', 'Fans and the ground'], ['league', 'The league'], ['other', 'Other'],
  ],
};

export const GRADES: [string, string][] = [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['f', 'F']];

// a call names a player of the club ('goalie', 'player', and by position 'qb' and 'keeper'), one of the league's ('hart',
// 'vezina' and 'norris' for the NHL; 'athlete', any player of the league, for the rest), a club ('club') or one of a few
// fixed answers ('choice')
export type CallKind = 'goalie' | 'player' | 'qb' | 'keeper' | 'hart' | 'vezina' | 'norris' | 'athlete' | 'club' | 'choice';
export interface CallDef { key: string; title: string; short: string; kind: CallKind; choices?: [string, string][] }

const WINDOW: CallDef = { key: 'window', title: 'Where is the club?', short: 'Window', kind: 'choice', choices: [['win-now', 'Win now'], ['retool', 'Retool on the fly'], ['rebuild', 'Rebuild']] };

export const CLUB_CALLS: CallDef[] = [
  { key: 'goalie', title: 'Who should start in goal?', short: 'In goal', kind: 'goalie' },
  { key: 'mvp', title: 'The MVP so far', short: 'MVP', kind: 'player' },
  { key: 'move', title: 'The one player you would move', short: 'Move him', kind: 'player' },
  { key: 'need', title: 'The biggest need', short: 'Need', kind: 'choice', choices: [['goalie', 'A goalie'], ['defence', 'A top-four defenceman'], ['scoring', 'Scoring'], ['centre', 'A centre'], ['power-play', 'Power-play help'], ['kill', 'Penalty killing'], ['toughness', 'Toughness'], ['depth', 'Depth']] },
  WINDOW,
  { key: 'spring', title: 'How far do they go this spring?', short: 'Spring', kind: 'choice', choices: [['miss', 'Miss the playoffs'], ['first', 'Out in round one'], ['second', 'Out in round two'], ['conference', 'Lose the conference final'], ['final', 'Lose the Cup final'], ['cup', 'Win the Cup']] },
  { key: 'gm', title: 'Grade the general manager', short: 'GM', kind: 'choice', choices: GRADES },
  { key: 'coach', title: 'Grade the coach', short: 'Coach', kind: 'choice', choices: GRADES },
];

export const NHL_CALLS: CallDef[] = [
  { key: 'cup', title: 'Who wins the Cup?', short: 'Cup', kind: 'club' },
  { key: 'hart', title: 'The Hart: the most valuable player', short: 'Hart', kind: 'hart' },
  { key: 'vezina', title: 'The Vezina: the best goalie', short: 'Vezina', kind: 'vezina' },
  { key: 'norris', title: 'The Norris: the best defenceman', short: 'Norris', kind: 'norris' },
  { key: 'surprise', title: 'The surprise of the season', short: 'Surprise', kind: 'club' },
  { key: 'letdown', title: 'The letdown of the season', short: 'Letdown', kind: 'club' },
];

// each sport's calls on a club, and on the league's own board
export const CLUB_CALLS_BY_SPORT: Record<FanSport, CallDef[]> = {
  hockey: CLUB_CALLS,
  football: [
    { key: 'qb', title: 'Who should be the quarterback?', short: 'QB', kind: 'qb' },
    { key: 'mvp', title: 'The MVP so far', short: 'MVP', kind: 'player' },
    { key: 'move', title: 'The one player you would move', short: 'Move him', kind: 'player' },
    { key: 'need', title: 'The biggest need', short: 'Need', kind: 'choice', choices: [['quarterback', 'A quarterback'], ['offensive-line', 'The offensive line'], ['pass-rush', 'A pass rusher'], ['secondary', 'The secondary'], ['receivers', 'A receiver'], ['running-back', 'A running back'], ['linebackers', 'Linebackers'], ['depth', 'Depth']] },
    WINDOW,
    { key: 'spring', title: 'How far do they go in January?', short: 'Playoffs', kind: 'choice', choices: [['miss', 'Miss the playoffs'], ['first', 'Out in the wild-card round'], ['second', 'Out in the divisional round'], ['conference', 'Lose the conference title game'], ['final', 'Lose the Super Bowl'], ['cup', 'Win the Super Bowl']] },
    { key: 'gm', title: 'Grade the general manager', short: 'GM', kind: 'choice', choices: GRADES },
    { key: 'coach', title: 'Grade the head coach', short: 'Coach', kind: 'choice', choices: GRADES },
  ],
  basketball: [
    { key: 'mvp', title: 'The MVP so far', short: 'MVP', kind: 'player' },
    { key: 'move', title: 'The one player you would move', short: 'Move him', kind: 'player' },
    { key: 'need', title: 'The biggest need', short: 'Need', kind: 'choice', choices: [['star', 'A star'], ['shooting', 'Shooting'], ['rim-protection', 'Rim protection'], ['playmaking', 'Playmaking'], ['defence', 'Perimeter defence'], ['rebounding', 'Rebounding'], ['bench', 'The bench'], ['health', 'Health']] },
    WINDOW,
    { key: 'spring', title: 'How far do they go this spring?', short: 'Spring', kind: 'choice', choices: [['miss', 'Miss the playoffs'], ['play-in', 'Out in the play-in'], ['first', 'Out in round one'], ['second', 'Out in round two'], ['conference', 'Lose the conference finals'], ['final', 'Lose the NBA Finals'], ['cup', 'Win the title']] },
    { key: 'gm', title: 'Grade the general manager', short: 'GM', kind: 'choice', choices: GRADES },
    { key: 'coach', title: 'Grade the head coach', short: 'Coach', kind: 'choice', choices: GRADES },
  ],
  soccer: [
    { key: 'goalie', title: 'Who should be the number one?', short: 'In goal', kind: 'keeper' },
    { key: 'mvp', title: 'The player of the season so far', short: 'Player', kind: 'player' },
    { key: 'move', title: 'The one player you would sell', short: 'Sell him', kind: 'player' },
    { key: 'need', title: 'The biggest need', short: 'Need', kind: 'choice', choices: [['goalkeeper', 'A goalkeeper'], ['centre-back', 'A centre-back'], ['full-back', 'A full-back'], ['midfield', 'A midfielder'], ['winger', 'A winger'], ['striker', 'A striker'], ['depth', 'Depth'], ['manager', 'A new manager']] },
    { key: 'finish', title: 'Where do they finish?', short: 'Finish', kind: 'choice', choices: [['title', 'Champions'], ['top-four', 'Top four'], ['europe', 'Europe'], ['mid-table', 'Mid-table'], ['relegation-fight', 'A relegation fight'], ['relegated', 'Relegated']] },
    WINDOW,
    { key: 'gm', title: 'Grade the board and the sporting director', short: 'Board', kind: 'choice', choices: GRADES },
    { key: 'coach', title: 'Grade the manager', short: 'Manager', kind: 'choice', choices: GRADES },
  ],
};
export const LEAGUE_CALLS_BY_SPORT: Record<FanSport, CallDef[]> = {
  hockey: NHL_CALLS,
  football: [
    { key: 'cup', title: 'Who wins the Super Bowl?', short: 'Super Bowl', kind: 'club' },
    { key: 'mvp', title: 'The MVP', short: 'MVP', kind: 'athlete' },
    { key: 'dpoy', title: 'Defensive player of the year', short: 'Defence', kind: 'athlete' },
    { key: 'surprise', title: 'The surprise of the season', short: 'Surprise', kind: 'club' },
    { key: 'letdown', title: 'The letdown of the season', short: 'Letdown', kind: 'club' },
  ],
  basketball: [
    { key: 'cup', title: 'Who wins the title?', short: 'Title', kind: 'club' },
    { key: 'mvp', title: 'The MVP', short: 'MVP', kind: 'athlete' },
    { key: 'dpoy', title: 'Defensive player of the year', short: 'Defence', kind: 'athlete' },
    { key: 'surprise', title: 'The surprise of the season', short: 'Surprise', kind: 'club' },
    { key: 'letdown', title: 'The letdown of the season', short: 'Letdown', kind: 'club' },
  ],
  soccer: [
    { key: 'cup', title: 'Who wins the league?', short: 'Champions', kind: 'club' },
    { key: 'down', title: 'Who goes down?', short: 'Down', kind: 'club' },
    { key: 'scorer', title: 'The Golden Boot: the top scorer', short: 'Golden Boot', kind: 'athlete' },
    { key: 'poty', title: 'The player of the season', short: 'Player', kind: 'athlete' },
    { key: 'surprise', title: 'The surprise of the season', short: 'Surprise', kind: 'club' },
    { key: 'letdown', title: 'The letdown of the season', short: 'Letdown', kind: 'club' },
  ],
};

// the analysis's bigger questions (src/lib/fanOffice.ts and src/lib/fanSport.ts questions(), by area): the fan gives
// their own verdict on each
export const QUESTION_CALLS: Record<string, string> = {
  'The window': 'q-window', 'The stars': 'q-stars', 'The crease': 'q-crease', 'The system': 'q-system', 'The kill': 'q-kill',
  'Special teams': 'q-special', 'The blue line': 'q-blue', 'The pipeline': 'q-pipeline', 'The identity': 'q-identity',
  'The attack': 'q-attack', 'The defence': 'q-defence', 'The record': 'q-record', 'The road ahead': 'q-ahead',
  'Discipline': 'q-discipline', 'The depth': 'q-depth',
};
export const VERDICTS: [string, string][] = [['keep', 'Keep'], ['adjust', 'Adjust'], ['rethink', 'Rethink']];
