-- The round in play, set-based (migration 177 follow-up): `_survivor_week` and `_predictor_week` asked `_pool_fixture`
-- about every match of the season, one call each, and the boards ask for each member, so a pool of twenty took most of
-- a second. The same rule as a join: a match is done for a pool when its host settled it or the feed has it final,
-- postponed or cancelled.

create or replace function public._survivor_week(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select min(f.gameweek) from survivors s
  join fixtures f on f.competition = s.competition and f.gameweek between s.start_gw and _survivor_end(s.id)
  left join pool_result_overrides o on o.league_id = s.league_id and o.fixture_id = f.id
  where s.id = p_survivor and o.fixture_id is null and f.state not in ('final', 'postponed', 'cancelled')
$$;

create or replace function public._predictor_week(p_predictor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(f.gameweek) from predictors s
     join fixtures f on f.competition = s.competition and f.gameweek >= s.start_gw
     left join pool_result_overrides o on o.league_id = s.league_id and o.fixture_id = f.id
     where s.id = p_predictor and o.fixture_id is null and f.state not in ('final', 'postponed', 'cancelled')),
    (select max(f.gameweek) from fixtures f join predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw))
$$;
