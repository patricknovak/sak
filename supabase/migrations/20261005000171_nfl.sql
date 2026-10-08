-- The NFL on ESPN (docs/DEVELOPMENT.md §6 item 2, docs/POOL-TYPES.md §9): the sport's row and its 2026 season as a
-- competition, so weekly pick'em (migration 170) and the start page have it the day soccer-sync fills its weeks.
--
-- * The sports row reads like soccer's for what pools use: no draws (a tie counts for nobody), its rounds are Weeks,
--   kickoff, and the states ESPN's statuses are turned into (soccer-sync maps them to the same short codes as soccer).
-- * The competition is on ESPN's public scoreboard (provider 'espn', `ext_id` the path under ESPN's sports,
--   'football/nfl'), free and keyless for testing; a licensed feed replaces it before anyone pays (§8). The regular
--   season is weeks 1 to 18; the playoffs follow as weeks 19 to 22 (wild card, divisional, conference, the Super Bowl),
--   each match keeping ESPN's name for its round.

insert into public.sports (id, name, config)
select 'nfl', 'NFL football', s.config || jsonb_build_object(
  'name', 'NFL football',
  'draws', false,
  'day', jsonb_build_object('tz', 'America/New_York', 'rollover', '06:00'),
  'season', jsonb_build_object('games', 17, 'playoffs', true, 'starterGames', 17),
  'words', jsonb_build_object('rec', 'flag-football', 'club', 'team', 'game', 'football', 'room', 'locker room', 'start', 'kickoff',
    'voice', 'a quick, sure-of-himself Sunday regular with a take on every game in the late window', 'centre', 'NFL centre',
    'starter', 'starting quarterback', 'round', 'Week'),
  'periods', jsonb_build_object('1Q', '1st quarter', '2Q', '2nd quarter', 'HT', 'Half-time', '3Q', '3rd quarter', '4Q', '4th quarter', 'OT', 'Overtime'),
  'states', jsonb_build_object('scheduled', jsonb_build_array('TBD', 'NS'), 'live', jsonb_build_array('LIVE', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'SUSP'),
    'final', jsonb_build_array('FT', 'AET', 'PEN', 'AWD'), 'postponed', jsonb_build_array('PST'), 'cancelled', jsonb_build_array('CANC', 'ABD')))
from public.sports s where s.id = 'soccer'
on conflict (id) do nothing;

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort)
values ('nfl', 'nfl', 'NFL', 'NFL', 'USA', 'America/New_York', '2026', 'espn', 'football/nfl', '2026', true, 5)
on conflict (id) do nothing;
