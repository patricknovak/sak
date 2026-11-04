-- proof_counts(): the founding league's record, as the marketing site states it, read live.
--
-- superpoolsai.com says what the SaK Superleague (league 1) has done this season: every player's night written down
-- before the games and scored after (the prediction log, migration 87), and every game night scored with a morning
-- column the next day. Those numbers were dated static copy (docs/CLAIMS-AUDIT-2026-11-04.md); this answers them for
-- the page, which keeps its copy when the call fails. Only league 1's aggregates, never a name or a row; no argument,
-- so nothing a caller passes reaches a query. Safe to run twice.

create or replace function public.proof_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (
    select error from predictions
    where league_id = 1 and kind = 'player_night' and scored_at is not null and error is not null
  ), r as (
    select season_start from league_rules where league_id = 1
  ), n as (
    -- a game night is a date of regular-season games, all of them final, before today's league day
    select g.date from games g, r
    where g.game_type = 2 and g.date >= r.season_start and g.date < today_et()
    group by g.date having bool_and(g.state = 'OFF')
  ), c as (
    -- the voice's recap of a night is posted the morning after it (garry's daily task, meta.type 'recap')
    select distinct ((m.created_at at time zone 'America/New_York')::date - 1) as d
    from messages m, r
    where m.league_id = 1 and m.kind = 'bot' and m.meta->>'bot' = 'garry' and m.meta->>'type' = 'recap'
      and m.created_at >= r.season_start
  )
  select jsonb_build_object(
    'calls', (select count(*) from p),
    'avg_miss', (select round(avg(abs(error)), 1) from p),
    'within_two', (select round(100 * avg((abs(error) <= 2)::int)) from p),
    'since', (select min(resolves_on) from predictions where league_id = 1 and kind = 'player_night'),
    'nights', (select count(*) from n),
    'nights_with_column', (select count(*) from n where n.date in (select d from c)),
    'as_of', today_et())
$$;
revoke execute on function public.proof_counts() from public;
grant execute on function public.proof_counts() to anon, authenticated;
