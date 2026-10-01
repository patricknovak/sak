-- Performance: the points that counted, day by day and category by category, for every team in the league.
-- Both functions read the puck-drop freeze-frames (lineup_snapshots) joined to the box scores (player_games),
-- the same rows the standings count, and run as the caller so each league sees only its own teams.

-- One row per team per league day: the starters' points and summed categories, the bench's points, and the
-- goalie share, from the league's season start (or p_from) to p_to (default: today).
create or replace function public.performance_days(p_from date default null, p_to date default null)
returns table (team_id int, date date, game_type int, points numeric, bench numeric, goalie_points numeric,
               starters int, benched int, stats jsonb, bench_stats jsonb)
language sql stable security invoker set search_path = public as $$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.date, g.game_type, s.slot not in ('BN', 'IR') as starter, s.slot = 'G' as goalie, pg.fpts, pg.stats
    from lineup_snapshots s
    join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  ),
  k as (
    select team_id, date, game_type, starter, e.key, sum(e.value::numeric) as v
    from s, jsonb_each_text(s.stats) e
    where e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1, 2, 3, 4, 5
  ),
  kk as (
    select team_id, date, game_type, starter, jsonb_object_agg(key, v) as stats
    from k group by 1, 2, 3, 4
  )
  select s.team_id, s.date, s.game_type,
         round(coalesce(sum(s.fpts) filter (where s.starter), 0), 2) as points,
         round(coalesce(sum(s.fpts) filter (where not s.starter), 0), 2) as bench,
         round(coalesce(sum(s.fpts) filter (where s.starter and s.goalie), 0), 2) as goalie_points,
         count(*) filter (where s.starter)::int as starters,
         count(*) filter (where not s.starter)::int as benched,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.date = s.date and kk.game_type = s.game_type and kk.starter), '{}'::jsonb) as stats,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.date = s.date and kk.game_type = s.game_type and not kk.starter), '{}'::jsonb) as bench_stats
  from s
  group by s.team_id, s.date, s.game_type
  order by s.date, s.team_id;
$$;

-- One row per team and player over a range: games started and benched, the points each produced, and the
-- starter categories summed, so a GM can see who carried the team and what was left on the bench.
create or replace function public.performance_players(p_from date default null, p_to date default null, p_team int default null)
returns table (team_id int, player_id int, started int, benched int, points numeric, bench numeric, stats jsonb)
language sql stable security invoker set search_path = public as $$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.player_id, s.slot not in ('BN', 'IR') as starter, pg.fpts, pg.stats
    from lineup_snapshots s
    join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where (p_team is null or s.team_id = p_team)
      and g.game_type = 2
      and s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  ),
  k as (
    select team_id, player_id, e.key, sum(e.value::numeric) as v
    from s, jsonb_each_text(s.stats) e
    where s.starter and e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1, 2, 3
  ),
  kk as (select team_id, player_id, jsonb_object_agg(key, v) as stats from k group by 1, 2)
  select s.team_id, s.player_id,
         count(*) filter (where s.starter)::int as started,
         count(*) filter (where not s.starter)::int as benched,
         round(coalesce(sum(s.fpts) filter (where s.starter), 0), 2) as points,
         round(coalesce(sum(s.fpts) filter (where not s.starter), 0), 2) as bench,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.player_id = s.player_id), '{}'::jsonb) as stats
  from s
  group by s.team_id, s.player_id
  order by points desc;
$$;

grant execute on function public.performance_days(date, date) to authenticated;
grant execute on function public.performance_players(date, date, int) to authenticated;
