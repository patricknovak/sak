-- Garry's daily budget per league (docs/EXPANSION.md, section 5, cost): every league's Garry calls the paid model,
-- and nothing capped what one league could spend in a day. Each league now has a daily budget in US dollars
-- (garry_state.daily_budget_usd, $1.00 when unset; SaK spends about $0.08 a day), counted from the running-costs
-- ledger (ops.cost_usage, Garry's features, today in Eastern time). Once it is spent, Garry stops calling the model for
-- that league until tomorrow and uses his canned lines, the same ones he falls back on when the model is down. A
-- platform admin sets a league's budget with set_garry_budget.

set client_min_messages = warning;

alter table public.garry_state add column if not exists daily_budget_usd numeric check (daily_budget_usd >= 0);

-- a league's budget for today, what Garry has spent of it and what is left (the edge function asks before each call)
create or replace function public.garry_budget(p_league int) returns jsonb
language sql stable security definer set search_path = public, ops as $$
  select jsonb_build_object('budget', b, 'spent', round(s, 6), 'left', round(greatest(b - s, 0), 6))
  from (select coalesce((select daily_budget_usd from garry_state where league_id = p_league), 1.00) as b,
               coalesce((select sum(usd) from ops.cost_usage where league_id = p_league and source = 'xai' and feature like 'garry.%'
                         and day = (now() at time zone 'America/New_York')::date), 0) as s) x
$$;
revoke execute on function public.garry_budget(int) from public, anon, authenticated;
grant execute on function public.garry_budget(int) to service_role;

-- the platform sets a league's budget (null goes back to the default)
create or replace function public.set_garry_budget(p_league int, p_usd numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  if p_usd is not null and (p_usd < 0 or p_usd > 100) then raise exception 'A daily budget between $0 and $100'; end if;
  insert into garry_state (league_id) values (p_league) on conflict (league_id) do nothing;
  update garry_state set daily_budget_usd = p_usd where league_id = p_league;
end $$;
revoke execute on function public.set_garry_budget(int, numeric) from public, anon;
grant execute on function public.set_garry_budget(int, numeric) to authenticated;
