// What the fans can add to a fan zone and the calls they can make (migration 337). The database checks every one of
// these (_fan_topic_ok, _fan_call_ok, fan_post's kinds); supabase/tests/fan-voice.test.mjs keeps the two the same, so
// a list changes here and in a migration together. No imports: the test reads this file on its own.

export type FanKind = 'idea' | 'ask' | 'insight' | 'fact' | 'fix';

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

export const GRADES: [string, string][] = [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['f', 'F']];

// a call names a player of the club ('goalie', 'player'), one of the league's ('hart', 'vezina', 'norris'), a club
// ('club') or one of a few fixed answers ('choice')
export type CallKind = 'goalie' | 'player' | 'hart' | 'vezina' | 'norris' | 'club' | 'choice';
export interface CallDef { key: string; title: string; short: string; kind: CallKind; choices?: [string, string][] }

export const CLUB_CALLS: CallDef[] = [
  { key: 'goalie', title: 'Who should start in goal?', short: 'In goal', kind: 'goalie' },
  { key: 'mvp', title: 'The MVP so far', short: 'MVP', kind: 'player' },
  { key: 'move', title: 'The one player you would move', short: 'Move him', kind: 'player' },
  { key: 'need', title: 'The biggest need', short: 'Need', kind: 'choice', choices: [['goalie', 'A goalie'], ['defence', 'A top-four defenceman'], ['scoring', 'Scoring'], ['centre', 'A centre'], ['power-play', 'Power-play help'], ['kill', 'Penalty killing'], ['toughness', 'Toughness'], ['depth', 'Depth']] },
  { key: 'window', title: 'Where is the club?', short: 'Window', kind: 'choice', choices: [['win-now', 'Win now'], ['retool', 'Retool on the fly'], ['rebuild', 'Rebuild']] },
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

// the analysis's bigger questions (src/lib/fanOffice.ts questions(), by area): the fan gives their own verdict on each
export const QUESTION_CALLS: Record<string, string> = {
  'The window': 'q-window', 'The stars': 'q-stars', 'The crease': 'q-crease', 'The system': 'q-system', 'The kill': 'q-kill',
  'Special teams': 'q-special', 'The blue line': 'q-blue', 'The pipeline': 'q-pipeline', 'The identity': 'q-identity',
};
export const VERDICTS: [string, string][] = [['keep', 'Keep'], ['adjust', 'Adjust'], ['rethink', 'Rethink']];
