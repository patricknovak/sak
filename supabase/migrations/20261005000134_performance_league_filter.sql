-- The Performance page's two reads filter to the caller's league themselves. They relied on row-level security alone,
-- which a caller with the service key skips: such a caller would have seen every league's teams in one table (the rule
-- since migration 96: a read that lists across teams filters league_id = current_league_id() itself). A signed-in GM
-- sees exactly what they saw before.

set client_min_messages = warning;

CREATE OR REPLACE FUNCTION public.performance_days(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(team_id integer, date date, game_type integer, points numeric, bench numeric, goalie_points numeric, starters integer, benched integer, stats jsonb, bench_stats jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.date, g.game_type, s.slot not in ('BN', 'IR') as starter, s.slot = 'G' as goalie, pg.fpts, pg.stats
    from lineup_snapshots s
    join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where s.league_id = current_league_id()
      and s.date >= coalesce(p_from, l.season_start, s.date)
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
$function$;

CREATE OR REPLACE FUNCTION public.performance_players(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_team integer DEFAULT NULL::integer)
 RETURNS TABLE(team_id integer, player_id integer, started integer, benched integer, points numeric, bench numeric, stats jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.player_id, s.slot not in ('BN', 'IR') as starter, pg.fpts, pg.stats
    from lineup_snapshots s
    join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where s.league_id = current_league_id()
      and (p_team is null or s.team_id = p_team)
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
$function$;
