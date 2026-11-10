-- Indexes for the three foreign keys on tables big enough to feel it (the database advisor lists about a hundred
-- unindexed foreign keys; every other one is on a table of a few hundred rows or fewer, where an index costs writes
-- and saves nothing). Safe to run twice.

-- a club's games, read by win totals, the sweepstake and the fan zones' fixtures, and checked when a club changes
create index if not exists fixtures_home_club on public.fixtures (home_club);
create index if not exists fixtures_away_club on public.fixtures (away_club);
-- each league's points on a box-score line, found from the line (the cache's key leads with the scoring profile)
create index if not exists player_game_points_line on public.player_game_points (game_id, player_id);
