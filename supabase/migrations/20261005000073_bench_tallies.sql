-- Bench tallies: what every GM left on the bench (and IR), per day and for the season, in every table.
--
-- Bench points are shown and never counted. The site already kept them per team and day (team_bench_daily)
-- and the regular-season table carried a season total. This rounds it out:
--   * team_bench_daily says which kind of game each bench point came from (regular season or playoffs), so the
--     regular-season table counts only regular-season bench points and the playoff table only playoff ones,
--     the way the points themselves are split. It also keeps working once the NHL season is over, like the
--     daily points do.
--   * the playoff table and the SAK Cup (full year) table carry bench and bench_today too.
--   * team_daily_all and team_bench_daily read the caller's own rules row. They were pinned to the rules row
--     with id 1 (the SaK row); a new league's row takes its own id, so every other league read no points.

set client_min_messages = warning;

create or replace view public.team_daily_all with (security_invoker = true) as
  select s.team_id, s.date, g.game_type, round(sum(pg.fpts), 2) as points, count(*) as games
  from lineup_snapshots s
  join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join games g on g.id = s.game_id
  cross join league l
  where s.slot not in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.date, g.game_type;

-- one row per team, day and kind of game; game_type comes last so the view keeps its existing columns
create or replace view public.team_bench_daily with (security_invoker = true) as
  select s.team_id, s.date, round(sum(pg.fpts), 2) as points, count(*) as games, g.game_type
  from lineup_snapshots s
  join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join games g on g.id = s.game_id
  cross join league l
  where s.slot in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.date, g.game_type;
grant select on public.team_bench_daily to authenticated;

-- the regular-season table: regular-season bench points only
create or replace view public.standings with (security_invoker = true) as
  with d as (select team_id, date, points, games from team_daily),
  b as (select team_id, date, points from team_bench_daily where game_type = 2),
  agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id),
  bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join b on b.team_id = t.id
    where t.role = 'gm'
    group by t.id)
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games, rank() over (order by agg.points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;

-- the playoff table: playoff bench points
create or replace view public.playoff_standings with (security_invoker = true) as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join playoff_daily d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id),
  bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join team_bench_daily b on b.team_id = t.id and b.game_type = 3
    where t.role = 'gm'
    group by t.id)
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games, rank() over (order by agg.points desc) as rank,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;

-- the SAK Cup, the whole year: every bench point
create or replace view public.sak_cup_standings with (security_invoker = true) as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join sak_cup_daily d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id),
  bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join team_bench_daily b on b.team_id = t.id
    where t.role = 'gm'
    group by t.id)
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games, rank() over (order by agg.points desc) as rank,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;
