-- The league day doesn't turn over at midnight: it stays on the previous day until every one of that day's
-- games has finished, even deep into overtime. Lineups, locks, saved lineups, the scoreboard and "today's
-- points" all follow it. A game stuck without a final can't hold the day forever: it turns over at 6 am ET
-- regardless.
create or replace function public._league_day(p_now timestamptz) returns date
language sql stable set search_path = public as $$
  select case
    when (p_now at time zone 'America/New_York')::time < time '06:00'
     and exists (
       select 1 from games g
       where g.date = (p_now at time zone 'America/New_York')::date - 1
         and g.start_utc <= p_now
         and g.state not in ('OFF', 'FINAL', 'PPD', 'CNCL'))
    then (p_now at time zone 'America/New_York')::date - 1
    else (p_now at time zone 'America/New_York')::date
  end
$$;

create or replace function public.today_et() returns date
language sql stable set search_path = public as $$ select _league_day(now()) $$;

grant execute on function public._league_day(timestamptz), public.today_et() to anon, authenticated, service_role;
