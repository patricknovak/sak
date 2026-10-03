-- Two reads that counted every league once a second one existed (found the morning the shadow league opened).
--
-- * team_directory, the sign-in screen's team list, runs with the owner's rights (the public key can't read teams)
--   and listed every league's teams: SaK's picker showed the shadow league's copies beside the real ones. It now
--   lists the caller's league: SaK's for the sign-in screen (no one signed in reads as league 1), a signed-in GM's
--   own league otherwise.
-- * standings, playoff_standings and sak_cup_standings rank the teams they can see. A GM sees only their league,
--   but Garry and the edge functions read with the service key, which sees every league, so SaK's ranks came out
--   interleaved with the shadow league's. Each now ranks the caller's league only (the league an edge function
--   names in x-league, SaK's when it names none). For a signed-in GM nothing changes.

set client_min_messages = warning;

create or replace view public.team_directory as
  select id, name, abbrev, gm_name, login_email, color, emoji, role, league_id
  from teams where league_id = current_league_id();

create or replace view public.standings with (security_invoker = true) as
  with d as (
    select team_daily.team_id, team_daily.date, team_daily.points, team_daily.games from team_daily
  ), b as (
    select team_bench_daily.team_id, team_bench_daily.date, team_bench_daily.points from team_bench_daily
    where team_bench_daily.game_type = 2
  ), agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join d on d.team_id = t.id
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  ), bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join b on b.team_id = t.id
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  )
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games,
    rank() over (order by agg.points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;

create or replace view public.playoff_standings with (security_invoker = true) as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join playoff_daily d on d.team_id = t.id
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  ), bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join team_bench_daily b on b.team_id = t.id and b.game_type = 3
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  )
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games,
    rank() over (order by agg.points desc) as rank,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;

create or replace view public.sak_cup_standings with (security_invoker = true) as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0::numeric) as last7,
      coalesce(sum(d.games), 0::numeric) as games
    from teams t left join sak_cup_daily d on d.team_id = t.id
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  ), bench as (
    select t.id as team_id,
      coalesce(sum(b.points), 0::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), 0::numeric) as bench_today
    from teams t left join team_bench_daily b on b.team_id = t.id
    where t.role = 'gm' and t.league_id = current_league_id()
    group by t.id
  )
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games,
    rank() over (order by agg.points desc) as rank,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;
