-- The Traitors, season 5 (Peacock): a question pack a group can start from #/new weeks before the premiere, so the
-- Traitors page (landing/traitors.html) has a pool to open the day it is found (the growth review of 24 November 2026:
-- pools form in the week before a premiere). From Peacock's and NBCUniversal's announcements of 17 November 2026: the
-- first two episodes on Thursday 14 January 2027 at 9 pm ET, a new episode every Thursday at 9 pm ET, the finale and
-- reunion on 18 March; 23 players at the castle, Alan Cumming hosting. The episode count is not announced, so the
-- weekly questions name their Thursday, never an episode number, and a Thursday with no new episode is voided by the
-- host. No player is named: every question is about what the show airs, and the host settles each from it.
-- Three questions close as the premiere goes on air (2 am UTC on the 15th), one a week closes each Thursday at 9 pm
-- Eastern (2 am UTC until the clocks change on 14 March, 1 am after), and the five finale questions stay open all
-- season. A coin drop lands the morning of every episode day. The pack's room is the Traitors lounge (migration 333).
-- Safe to run twice; the hourly pool job carries any later change to the pools already on it (migration 251).
insert into public.pool_packs (slug, name, brand, markets, drops) values ('traitors-s5', 'The Traitors: Season 5',
  '{"tagline": "A Traitors pool", "trophy": "The Prize Pot", "booby": "The Banished", "icon": "🗡️",
    "blurb": "Every round table and the finale, called with your friends, with coins on every episode night",
    "wordmark": {"a": "ROUND", "b": "TABLE"},
    "coin": {"name": "Gold", "emoji": "🪙"}, "bot": {"name": "Cloak", "emoji": "🗡️"}, "colors": {"gold": "#c084fc"}}'::jsonb,
  '[
 {
  "title": "Does a Traitor win the prize?",
  "category": "The finale",
  "sort": 1,
  "rule": "Yes if a player who is a Traitor when the game ends takes the prize, alone or shared. Closes as the finale goes on air.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-03-19T01:00:00Z"
 },
 {
  "title": "How many players share the prize?",
  "category": "The finale",
  "sort": 2,
  "rule": "The number of players the show names as winners of the prize in the finale.",
  "outcomes": [
   "One",
   "Two",
   "Three or more"
  ],
  "closes_at": "2027-03-19T01:00:00Z"
 },
 {
  "title": "How many players reach the final round table?",
  "category": "The finale",
  "sort": 3,
  "rule": "The players still in the game when the finale''s last round table begins.",
  "outcomes": [
   "Three or fewer",
   "Four",
   "Five or more"
  ],
  "closes_at": "2027-03-19T01:00:00Z"
 },
 {
  "title": "How many Traitors are still in when the finale starts?",
  "category": "The finale",
  "sort": 4,
  "rule": "The Traitors in the game at the start of the finale, as the show reveals them by the end of it.",
  "outcomes": [
   "None",
   "One",
   "Two",
   "Three or more"
  ],
  "closes_at": "2027-03-19T01:00:00Z"
 },
 {
  "title": "Is a Faithful banished at the final round table?",
  "category": "The finale",
  "sort": 5,
  "rule": "Yes if the finale''s last round table banishes at least one Faithful.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-03-19T01:00:00Z"
 },
 {
  "title": "How many Traitors are chosen at the first selection?",
  "category": "Before the premiere",
  "sort": 10,
  "rule": "The players made Traitors at the first selection the premiere shows. A player who is offered the role and turns it down does not count.",
  "outcomes": [
   "Three or fewer",
   "Four or more"
  ],
  "closes_at": "2027-01-15T02:00:00Z"
 },
 {
  "title": "Is a Faithful recruited as a Traitor this season?",
  "category": "Before the premiere",
  "sort": 11,
  "rule": "Yes if the show airs a Faithful becoming a Traitor after the first selection, by accepting an offer or under an ultimatum, at any point in the season.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-01-15T02:00:00Z"
 },
 {
  "title": "Does one of the first Traitors reach the finale?",
  "category": "Before the premiere",
  "sort": 12,
  "rule": "Yes if a player made a Traitor at the first selection is still in the game when the finale begins.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-01-15T02:00:00Z"
 },
 {
  "title": "Premiere night: does a round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 20,
  "rule": "Yes if a player banished at a round table in the episodes released on Thursday 14 January is revealed as a Traitor. No round table in those episodes counts as No.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-01-15T02:00:00Z"
 },
 {
  "title": "Thursday 21 January: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 21,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 21 January is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-01-22T02:00:00Z"
 },
 {
  "title": "Thursday 28 January: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 22,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 28 January is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-01-29T02:00:00Z"
 },
 {
  "title": "Thursday 4 February: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 23,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 4 February is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-02-05T02:00:00Z"
 },
 {
  "title": "Thursday 11 February: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 24,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 11 February is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-02-12T02:00:00Z"
 },
 {
  "title": "Thursday 18 February: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 25,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 18 February is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-02-19T02:00:00Z"
 },
 {
  "title": "Thursday 25 February: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 26,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 25 February is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-02-26T02:00:00Z"
 },
 {
  "title": "Thursday 4 March: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 27,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 4 March is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-03-05T02:00:00Z"
 },
 {
  "title": "Thursday 11 March: does the round table banish a Traitor?",
  "category": "Episode nights",
  "sort": 28,
  "rule": "Yes if a player banished at a round table in an episode first released on Thursday 11 March is revealed as a Traitor. No round table that night counts as No. If no new episode is released that day, the host voids the question.",
  "outcomes": [
   "Yes",
   "No"
  ],
  "closes_at": "2027-03-12T02:00:00Z"
 }
]'::jsonb,
  '[
 {
  "at": "2027-01-14T13:00:00Z",
  "amount": 250,
  "note": "The premiere"
 },
 {
  "at": "2027-01-21T13:00:00Z",
  "amount": 200,
  "note": "Thursday 21 January"
 },
 {
  "at": "2027-01-28T13:00:00Z",
  "amount": 200,
  "note": "Thursday 28 January"
 },
 {
  "at": "2027-02-04T13:00:00Z",
  "amount": 200,
  "note": "Thursday 4 February"
 },
 {
  "at": "2027-02-11T13:00:00Z",
  "amount": 200,
  "note": "Thursday 11 February"
 },
 {
  "at": "2027-02-18T13:00:00Z",
  "amount": 200,
  "note": "Thursday 18 February"
 },
 {
  "at": "2027-02-25T13:00:00Z",
  "amount": 200,
  "note": "Thursday 25 February"
 },
 {
  "at": "2027-03-04T13:00:00Z",
  "amount": 200,
  "note": "Thursday 4 March"
 },
 {
  "at": "2027-03-11T13:00:00Z",
  "amount": 200,
  "note": "Thursday 11 March"
 },
 {
  "at": "2027-03-18T12:00:00Z",
  "amount": 300,
  "note": "The finale"
 }
]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
update public.pool_packs set lounge = 'traitors' where slug = 'traitors-s5' and lounge is distinct from 'traitors';
