-- The guillotine's winner is the last team standing (migration 278), so in a guillotine league the standings rank the
-- teams still in first, then the cut, the latest cut highest; the payouts, the voice and every page that ranks by the
-- standings follow. A league with no cuts (every league but a guillotine) ranks by points exactly as before.
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
    -- the guillotine (migration 278): the teams still in rank first, then the cut, the later cut higher; a league
    -- with no cuts ranks by points alone, as it always has
    rank() over (order by (select c.week_start from guillotine_cuts c where c.league_id = current_league_id() and c.team_id = agg.team_id) desc nulls first,
                          agg.points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;
