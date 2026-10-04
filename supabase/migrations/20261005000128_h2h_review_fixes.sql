-- Head-to-head fixes from a review of migrations 118 to 121.
--
-- * h2h_scores() scored every matchup, upcoming ones too: in a category league that is the full category count for
--   weeks nobody has played. A week that hasn't started is 0 to 0 without counting.
-- * h2h_standings() read h2h_scores() twice; it reads it once now. And it gains seed: the table's order with no ties
--   (wins, ties as a half, points for, then team id), the order the bracket and the payouts already use, so the site's
--   playoff line and Garry agree with the bracket when teams are level (before week 1 every team is ranked 1).

set client_min_messages = warning;

drop function if exists public.h2h_scores();
create function public.h2h_scores()
returns table (id bigint, week int, starts date, ends date, home_team int, away_team int, home_pts numeric, away_pts numeric, status text, cats jsonb)
language sql stable set search_path = public as $$
  select m.id, m.week, m.starts, m.ends, m.home_team, m.away_team,
    case when m.starts > today_et() then 0 else x.a_score end,
    case when m.away_team is null then null when m.starts > today_et() then 0 else x.b_score end,
    case when m.ends < today_et() then 'final' when m.starts <= today_et() then 'live' else 'upcoming' end, x.cats
  from matchups m
  left join lateral (select * from _h2h_result(m.home_team, m.away_team, m.starts, m.ends) where m.starts <= today_et()) x on true
  where m.league_id = current_league_id()
  order by m.week, m.id
$$;
revoke execute on function public.h2h_scores() from public, anon;
grant execute on function public.h2h_scores() to authenticated, service_role;

drop function if exists public.h2h_standings();
create function public.h2h_standings()
returns table (team_id int, w int, l int, t int, pf numeric, pa numeric, rank int, seed int)
language sql stable set search_path = public as $$
  with sc as materialized (
    select * from h2h_scores() where status = 'final' and away_team is not null
  ), res as (
    select home_team as team, home_pts as f, away_pts as a from sc
    union all
    select away_team, away_pts, home_pts from sc
  ), agg as (
    select tm.id as team_id,
      count(*) filter (where r.f > r.a)::int as w, count(*) filter (where r.f < r.a)::int as l, count(*) filter (where r.f = r.a)::int as t,
      coalesce(sum(r.f), 0) as pf, coalesce(sum(r.a), 0) as pa
    from teams tm left join res r on r.team = tm.id
    where tm.league_id = current_league_id() and tm.role = 'gm'
    group by tm.id
  )
  select agg.*, (rank() over (order by agg.w + agg.t / 2.0 desc, agg.pf desc))::int,
    (row_number() over (order by agg.w + agg.t / 2.0 desc, agg.pf desc, agg.team_id))::int
  from agg
$$;
revoke execute on function public.h2h_standings() from public, anon;
grant execute on function public.h2h_standings() to authenticated, service_role;
