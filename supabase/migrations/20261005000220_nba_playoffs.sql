-- The NBA playoffs (docs/POOL-TYPES.md §9 item 6): the sport row and the 2027 postseason as a series competition, so
-- Pick the series, the bracket from the first round and Rank the teams run on the NBA in April as they do on the
-- Stanley Cup. soccer-sync fills it from ESPN's public scoreboard (`nbaPlayoffPayload` in `_shared/nbaPlayoffs.ts`:
-- fifteen best-of-7 series in bracket order from the standings' seeds, the play-in left out; tested on the 2026
-- playoffs), day by day from mid-April to late June and only the days around now on a live run; outside those months
-- it fetches nothing. Basketball's tiebreaker already runs to 300 points (`_score_cap`, migration 201).
-- Safe to run twice.

insert into public.sports (id, name, config)
select 'nba', 'Basketball', s.config || jsonb_build_object(
  'name', 'Basketball',
  'draws', false,
  'day', jsonb_build_object('tz', 'America/New_York', 'rollover', '06:00'),
  'season', jsonb_build_object('games', 82, 'playoffs', true, 'starterGames', 82),
  'words', jsonb_build_object('rec', 'pickup', 'club', 'team', 'game', 'basketball', 'room', 'locker room', 'start', 'tip-off',
    'score', 'points', 'period', 'quarter', 'voice', 'a courtside regular who has argued every Finals since the nineties',
    'centre', 'NBA centre', 'round', 'Round', 'match', 'game'),
  'periods', jsonb_build_object('1Q', '1st quarter', '2Q', '2nd quarter', '3Q', '3rd quarter', '4Q', '4th quarter', 'HT', 'Half-time', 'OT', 'Overtime'))
from public.sports s where s.id = 'nfl'
on conflict (id) do nothing;

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format)
values ('nba-post-2027', 'nba', 'NBA Playoffs 2027', 'NBA', 'USA', 'America/New_York', '2027', 'espn', 'basketball/nba', '2027', true, 4, 'series')
on conflict (id) do nothing;
