-- Analytics foundation for Super Pools (Mission Control counts, test accounts, first-touch attribution).
-- Numbered after 240 (security_harden, PR #247): that PR must merge and apply first when both land.
-- Safe to run twice. The Mission Control passcode hash is never committed: Patrick inserts it out of band.
--
-- Grants vs 240: set_account_is_test is authenticated-only (never anon). mission_control_counts is
-- intentionally anon-callable and passcode-gated (portfolio Mission Control); 240's revoke list does not
-- touch it. _mc_test_email and _pool_start_new stay off the public API.

set client_min_messages = warning;

-- ───────────── accounts.is_test ─────────────
alter table public.accounts add column if not exists is_test boolean not null default false;
comment on column public.accounts.is_test is 'Marks test or founder accounts so portfolio counts exclude them. Platform admins only to change.';

-- backfill: same email filter the onboarding brief uses (and keep the email fallback in the counts RPC)
insert into public.accounts (user_id, is_test)
select u.id, true
from auth.users u
where coalesce(u.email, '') ilike '%patricknovak%'
   or coalesce(u.email, '') ilike '%planetterrian%'
   or coalesce(u.email, '') ilike '%+test%'
   or coalesce(u.email, '') ilike '%test@%'
   or coalesce(u.email, '') ilike '%example.com%'
   or coalesce(u.email, '') ilike '%qa@%'
   or coalesce(u.email, '') ilike '%@superpoolsai.com%'
   or coalesce(u.email, '') ilike '%@superpools.com%'
on conflict (user_id) do update set is_test = true, updated_at = now()
where not accounts.is_test;

-- platform admins only flip the flag (no direct update policy on accounts)
create or replace function public.set_account_is_test(p_user uuid, p_test boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  if p_user is null then raise exception 'No such account'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such account'; end if;
  insert into accounts (user_id, is_test) values (p_user, coalesce(p_test, false))
  on conflict (user_id) do update set is_test = excluded.is_test, updated_at = now();
end $$;
-- never anon: platform admins only, same revoke pattern as migration 240's signed-in RPCs
revoke execute on function public.set_account_is_test(uuid, boolean) from public, anon;
grant execute on function public.set_account_is_test(uuid, boolean) to authenticated, service_role;

-- ───────────── first-touch UTM / referrer on waitlist and pool signups ─────────────
alter table public.waitlist add column if not exists utm_source text;
alter table public.waitlist add column if not exists utm_medium text;
alter table public.waitlist add column if not exists utm_campaign text;
alter table public.waitlist add column if not exists utm_content text;
alter table public.waitlist add column if not exists utm_term text;
alter table public.waitlist add column if not exists referrer text;
do $$ begin
  alter table public.waitlist drop constraint if exists waitlist_utm_source_check;
  alter table public.waitlist add constraint waitlist_utm_source_check check (utm_source is null or length(utm_source) <= 120);
  alter table public.waitlist drop constraint if exists waitlist_utm_medium_check;
  alter table public.waitlist add constraint waitlist_utm_medium_check check (utm_medium is null or length(utm_medium) <= 120);
  alter table public.waitlist drop constraint if exists waitlist_utm_campaign_check;
  alter table public.waitlist add constraint waitlist_utm_campaign_check check (utm_campaign is null or length(utm_campaign) <= 160);
  alter table public.waitlist drop constraint if exists waitlist_utm_content_check;
  alter table public.waitlist add constraint waitlist_utm_content_check check (utm_content is null or length(utm_content) <= 160);
  alter table public.waitlist drop constraint if exists waitlist_utm_term_check;
  alter table public.waitlist add constraint waitlist_utm_term_check check (utm_term is null or length(utm_term) <= 160);
  alter table public.waitlist drop constraint if exists waitlist_referrer_check;
  alter table public.waitlist add constraint waitlist_referrer_check check (referrer is null or length(referrer) <= 500);
end $$;

-- anon may insert the new columns with the existing waitlist form (still insert-only)
grant insert (email, name, league, note, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer)
  on public.waitlist to anon;

alter table private.pool_signups
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists referrer text;

-- retire the six-arg form so callers with or without attribution land on one function (defaults fill the rest)
do $$ begin
  if to_regprocedure('public._pool_start_new(uuid,text,text,text,text,text)') is not null
     and to_regprocedure('public._pool_start_new_before_attr(uuid,text,text,text,text,text)') is null then
    alter function public._pool_start_new(uuid, text, text, text, text, text) rename to _pool_start_new_before_attr;
  elsif to_regprocedure('public._pool_start_new(uuid,text,text,text,text,text)') is not null
     and to_regprocedure('public._pool_start_new_before_attr(uuid,text,text,text,text,text)') is not null then
    -- a prior run already renamed; drop the leftover six-arg if a recreate left one behind
    drop function public._pool_start_new(uuid, text, text, text, text, text);
  end if;
end $$;
do $$ begin
  revoke execute on function public._pool_start_new_before_attr(uuid, text, text, text, text, text)
    from public, anon, authenticated, service_role;
exception when undefined_function then null;
end $$;

create or replace function public._pool_start_new(
  p_user uuid, p_name text, p_color text, p_pack text, p_host text, p_ip text,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
  p_utm_content text default null, p_utm_term text default null, p_referrer text default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare why text := _pool_signup_check(p_ip); r jsonb;
begin
  if why is not null then raise exception '%', why; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such account'; end if;
  if exists (select 1 from league_members where user_id = p_user) or exists (select 1 from leagues where owner_user = p_user) then
    raise exception 'That account is already in a pool. Sign in and start one from My pools.';
  end if;
  r := _pool_open(p_user, p_name, p_color, p_pack, p_host);
  insert into private.pool_signups (ip_hash, user_id, league_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer)
  values (
    p_ip, p_user, (r->>'id')::int,
    nullif(left(btrim(coalesce(p_utm_source, '')), 120), ''),
    nullif(left(btrim(coalesce(p_utm_medium, '')), 120), ''),
    nullif(left(btrim(coalesce(p_utm_campaign, '')), 160), ''),
    nullif(left(btrim(coalesce(p_utm_content, '')), 160), ''),
    nullif(left(btrim(coalesce(p_utm_term, '')), 160), ''),
    nullif(left(btrim(coalesce(p_referrer, '')), 500), '')
  );
  return r;
end $$;
revoke execute on function public._pool_start_new(uuid, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public._pool_start_new(uuid, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

-- ───────────── Mission Control counts (portfolio pattern; passcode hash inserted by Patrick) ─────────────
create schema if not exists mission_control;
revoke all on schema mission_control from public, anon, authenticated;
grant usage on schema mission_control to postgres, service_role;

create table if not exists mission_control.counts_passcode (
  sha256_hex text primary key check (sha256_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
revoke all on mission_control.counts_passcode from public, anon, authenticated;
grant all on mission_control.counts_passcode to postgres, service_role;

-- real-user email filter (fallback when is_test is not set), matching the brief
create or replace function public._mc_test_email(p_email text) returns boolean
language sql immutable as $$
  select coalesce(p_email, '') ilike '%patricknovak%'
      or coalesce(p_email, '') ilike '%planetterrian%'
      or coalesce(p_email, '') ilike '%+test%'
      or coalesce(p_email, '') ilike '%test@%'
      or coalesce(p_email, '') ilike '%example.com%'
      or coalesce(p_email, '') ilike '%qa@%'
      or coalesce(p_email, '') ilike '%@superpoolsai.com%'
      or coalesce(p_email, '') ilike '%@superpools.com%'
$$;
revoke execute on function public._mc_test_email(text) from public, anon, authenticated;

create or replace function public.mission_control_counts(
  p_yesterday_start timestamptz,
  p_yesterday_end timestamptz,
  p_last7_start timestamptz,
  p_last7_end timestamptz,
  p_passcode text
) returns table (
  users_yesterday bigint,
  users_7d bigint,
  users_all bigint,
  pools_yesterday bigint,
  pools_7d bigint,
  pools_all bigint,
  members_yesterday bigint,
  members_7d bigint,
  members_all bigint,
  actions_yesterday bigint,
  actions_7d bigint,
  actions_all bigint,
  weekly_active_pool_players bigint
)
language plpgsql stable security definer
set search_path to 'public', 'private', 'mission_control', 'extensions', 'auth'
as $function$
begin
  if p_passcode is null or not exists (
       select 1 from mission_control.counts_passcode
       where sha256_hex = encode(extensions.digest(p_passcode, 'sha256'), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with real_users as (
    select au.id, au.created_at
    from auth.users au
    left join public.accounts a on a.user_id = au.id
    where not coalesce(a.is_test, false)
      and not public._mc_test_email(au.email)
  ),
  pools as (
    select l.id, l.created_at, l.owner_user
    from public.leagues l
    join real_users u on u.id = l.owner_user
  ),
  members as (
    select m.user_id, m.league_id, m.joined_at
    from public.league_members m
    join real_users u on u.id = m.user_id
  ),
  -- one game action: a pool pick, a pool trade/call, a Book bet, or a day's lineup plan
  actions as (
    select t.user_id, pt.league_id, pt.created_at as at
    from public.pool_trades pt
    join public.teams t on t.id = pt.team_id
    join real_users u on u.id = t.user_id
    union all
    select t.user_id, pp.league_id, pp.picked_at
    from public.pool_picks pp
    join public.teams t on t.id = pp.team_id
    join real_users u on u.id = t.user_id
    union all
    select t.user_id, t.league_id, mb.created_at
    from public.market_bets mb
    join public.teams t on t.id = mb.team_id
    join real_users u on u.id = t.user_id
    union all
    select t.user_id, coalesce(lp.league_id, t.league_id), max(lp.set_at)
    from public.lineup_plans lp
    join public.teams t on t.id = lp.team_id
    join real_users u on u.id = t.user_id
    group by t.user_id, coalesce(lp.league_id, t.league_id), lp.date
  ),
  big_pools as (
    select m.league_id
    from members m
    group by m.league_id
    having count(*) >= 3
  )
  select
    (select count(*) from real_users ru where ru.created_at >= p_yesterday_start and ru.created_at < p_yesterday_end)::bigint,
    (select count(*) from real_users ru where ru.created_at >= p_last7_start and ru.created_at < p_last7_end)::bigint,
    (select count(*) from real_users ru)::bigint,
    (select count(*) from pools p where p.created_at >= p_yesterday_start and p.created_at < p_yesterday_end)::bigint,
    (select count(*) from pools p where p.created_at >= p_last7_start and p.created_at < p_last7_end)::bigint,
    (select count(*) from pools p)::bigint,
    (select count(*) from members m where m.joined_at >= p_yesterday_start and m.joined_at < p_yesterday_end)::bigint,
    (select count(*) from members m where m.joined_at >= p_last7_start and m.joined_at < p_last7_end)::bigint,
    (select count(*) from members m)::bigint,
    (select count(*) from actions a where a.at >= p_yesterday_start and a.at < p_yesterday_end)::bigint,
    (select count(*) from actions a where a.at >= p_last7_start and a.at < p_last7_end)::bigint,
    (select count(*) from actions a)::bigint,
    (select count(distinct a.user_id) from actions a
      join big_pools b on b.league_id = a.league_id
     where a.at >= p_last7_start and a.at < p_last7_end)::bigint;
end;
$function$;

-- intentional anon grant: Mission Control calls with the anon key + passcode (not revoked by 240)
revoke execute on function public.mission_control_counts(timestamptz, timestamptz, timestamptz, timestamptz, text)
  from public;
grant execute on function public.mission_control_counts(timestamptz, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated, service_role;
