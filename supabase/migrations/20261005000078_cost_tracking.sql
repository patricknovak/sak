-- Running costs: what SaK and Super Pools cost to run, by day, by month, by source, by feature and by league, for
-- the platform owner's dashboard (#/costs). Two kinds of cost:
--   * metered: every paid AI call (Garry, the X insiders feed) records its exact price as it happens (xAI returns
--     the price of every call), tagged with the feature and the league it served (league 0 = shared by every league)
--   * fixed: the monthly bills (Supabase plan and compute, hosting, domains), entered by hand and spread evenly
--     over the days of each month
-- Nothing here is league data, so it lives in its own schema the API doesn't serve; the dashboard reads it through
-- functions that only a platform admin may call.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.platform_admins (user_id uuid primary key, added_at timestamptz not null default now());

create table if not exists ops.cost_usage (
  day date not null,
  league_id int not null default 0,            -- 0: shared by every league (the X feed, the NHL data)
  source text not null,                        -- who bills it: xai, ...
  feature text not null,                       -- what it was for: garry.reply, hub.x_feed, ...
  calls int not null default 0,
  input_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  units numeric not null default 0,            -- the feature's own billed unit, when it has one (X posts read)
  usd numeric(12, 6) not null default 0,
  primary key (day, league_id, source, feature)
);

create table if not exists ops.cost_fixed (
  id serial primary key,
  source text not null,
  item text not null,
  monthly_usd numeric(10, 2) not null default 0,
  share numeric(5, 4) not null default 1 check (share between 0 and 1),   -- the part of the bill Super Pools carries
  starts date not null default date '2026-09-24',
  ends date,
  note text
);

create table if not exists ops.usage_daily (day date not null, metric text not null, value numeric not null, primary key (day, metric));
create table if not exists ops.cost_alerts (id bigserial primary key, day date not null, message text not null, created_at timestamptz not null default now());

revoke all on all tables in schema ops from public, anon, authenticated;

-- the bills as they stand in October 2026; edit them on the dashboard
insert into ops.cost_fixed (source, item, monthly_usd, share, note)
select * from (values
  ('supabase', 'Supabase Pro plan', 25.00, 1.0, 'Billed once for the whole Supabase organisation, which also runs other projects: lower the share to the part Super Pools should carry'),
  ('supabase', 'Database server (Micro compute, sak-league)', 10.00, 1.0, 'This project''s own compute; the plan''s compute credit goes to one project in the organisation'),
  ('hosting', 'GitHub Pages (the site)', 0.00, 1.0, 'Free'),
  ('hosting', 'Vercel (landing page)', 0.00, 1.0, 'Free tier; commercial use needs Vercel Pro or Cloudflare Pages'),
  ('domains', 'superpoolsai.com and superpoolai.com', 0.00, 1.0, 'Enter the yearly renewals divided by 12')
) v(source, item, monthly_usd, share, note)
where not exists (select 1 from ops.cost_fixed);

-- the commissioner of league 1 (Patrick) is the platform owner
insert into ops.platform_admins (user_id)
  select user_id from teams where league_id = 1 and is_commish and user_id is not null
  on conflict do nothing;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, ops as $$
  select exists (select 1 from ops.platform_admins where user_id = auth.uid())
$$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- one paid call, added to its day's row (Eastern calendar day); only the edge functions (service role) call it
create or replace function public.meter_cost(p_league int, p_source text, p_feature text, p_calls int default 1,
  p_input bigint default 0, p_cached bigint default 0, p_output bigint default 0, p_units numeric default 0, p_usd numeric default 0)
returns void language sql security definer set search_path = ops, public as $$
  insert into ops.cost_usage as c (day, league_id, source, feature, calls, input_tokens, cached_tokens, output_tokens, units, usd)
  values ((now() at time zone 'America/New_York')::date, coalesce(p_league, 0), p_source, p_feature, coalesce(p_calls, 1),
    coalesce(p_input, 0), coalesce(p_cached, 0), coalesce(p_output, 0), coalesce(p_units, 0), coalesce(p_usd, 0))
  on conflict (day, league_id, source, feature) do update set
    calls = c.calls + excluded.calls, input_tokens = c.input_tokens + excluded.input_tokens,
    cached_tokens = c.cached_tokens + excluded.cached_tokens, output_tokens = c.output_tokens + excluded.output_tokens,
    units = c.units + excluded.units, usd = c.usd + excluded.usd
$$;
revoke execute on function public.meter_cost(int, text, text, int, bigint, bigint, bigint, numeric, numeric) from public, anon, authenticated;
grant execute on function public.meter_cost(int, text, text, int, bigint, bigint, bigint, numeric, numeric) to service_role;

-- a fixed bill's cost on one day: its monthly amount, times the share Super Pools carries, over the days in that month
create or replace function ops.fixed_on(p_day date) returns numeric language sql stable as $$
  select coalesce(sum(f.monthly_usd * f.share / extract(day from (date_trunc('month', p_day) + interval '1 month - 1 day'))), 0)
  from ops.cost_fixed f where p_day >= f.starts and (f.ends is null or p_day <= f.ends)
$$;

-- yesterday's footprint, once a day: database size and how much scheduled work ran (the scheduler's run log only
-- exists where pg_cron does)
create or replace function public.cost_snapshot() returns void
language plpgsql security definer set search_path = public, ops as $$
declare d date := (now() at time zone 'America/New_York')::date - 1;
begin
  insert into ops.usage_daily values (d, 'db_bytes', pg_database_size(current_database()))
    on conflict (day, metric) do update set value = excluded.value;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      insert into ops.usage_daily (day, metric, value)
      select $1, 'cron_runs', count(*) from cron.job_run_details
      where (start_time at time zone 'America/New_York')::date = $1
      on conflict (day, metric) do update set value = excluded.value $q$ using d;
  end if;
end $$;
revoke execute on function public.cost_snapshot() from public, anon, authenticated;

-- spike watch, once a day: yesterday's metered spend against the week before it. Over twice the week's average (and
-- at least 50 cents more), or over $5 in a day, is a spike: it goes on the dashboard and to the platform owner's phone.
create or replace function public.cost_watch() returns int
language plpgsql security definer set search_path = public, ops as $$
declare
  d date := (now() at time zone 'America/New_York')::date - 1;
  y numeric; avg7 numeric; msg text; n int := 0; r record;
begin
  select coalesce(sum(usd), 0) into y from ops.cost_usage where day = d;
  select coalesce(sum(usd), 0) / 7 into avg7 from ops.cost_usage where day between d - 7 and d - 1;
  if (y > 2 * avg7 and y - avg7 >= 0.5) or y > 5 then
    select format('Running costs: $%s of AI spend yesterday, against $%s a day the week before. Top: %s.',
      to_char(y, 'FM9990.00'), to_char(avg7, 'FM9990.00'),
      (select string_agg(format('%s $%s', feature, to_char(s, 'FM9990.00')), ', ') from (
        select feature, sum(usd) s from ops.cost_usage where day = d group by feature order by 2 desc limit 3) t))
      into msg;
    if not exists (select 1 from ops.cost_alerts where day = d) then
      insert into ops.cost_alerts (day, message) values (d, msg);
      for r in select distinct on (a.user_id) t.id from ops.platform_admins a join teams t on t.user_id = a.user_id order by a.user_id, t.league_id loop
        insert into notifications (team_id, kind, body, link) values (r.id, 'cost', msg, '/costs');
        n := n + 1;
      end loop;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.cost_watch() from public, anon, authenticated;

-- the dashboard: everything the page shows, in one read
create or replace function public.cost_dashboard(p_days int default 92) returns jsonb
language plpgsql stable security definer set search_path = public, ops as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  first date := today - (least(greatest(p_days, 7), 400) - 1);
  m0 date := date_trunc('month', today)::date;
  m_days int := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int;
  leagues int := greatest(1, (select count(*) from leagues where status = 'active'));
  out jsonb;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  with days as (select generate_series(first, today, interval '1 day')::date as day),
  var as (
    select day,
      sum(usd) filter (where feature like 'garry.%') as garry,
      sum(usd) filter (where feature like 'hub.x%') as x_feed,
      sum(usd) filter (where feature not like 'garry.%' and feature not like 'hub.x%') as other
    from ops.cost_usage group by day),
  daily as (
    select d.day, round(ops.fixed_on(d.day), 4) as fixed, round(coalesce(v.garry, 0), 4) as garry,
      round(coalesce(v.x_feed, 0), 4) as x_feed, round(coalesce(v.other, 0), 4) as other
    from days d left join var v using (day)),
  -- every month from the start of the books (24 Sep 2026, the site's launch), at most the last year
  months as (
    select to_char(d.day, 'YYYY-MM') as month, round(sum(ops.fixed_on(d.day)), 2) as fixed,
      round(coalesce(sum(v.garry), 0), 2) as garry, round(coalesce(sum(v.x_feed), 0), 2) as x_feed,
      round(coalesce(sum(v.other), 0), 2) as other, count(*) as days_in
    from (select generate_series(greatest(date '2026-09-24', date_trunc('month', today - 365)::date), today, interval '1 day')::date as day) d
    left join var v using (day)
    group by 1),
  feat as (
    select source, feature, sum(calls) as calls, sum(units) as units, sum(input_tokens) as input_tokens,
      sum(cached_tokens) as cached_tokens, sum(output_tokens) as output_tokens, round(sum(usd), 4) as usd,
      count(distinct day) as days, count(distinct league_id) filter (where league_id > 0) as leagues
    from ops.cost_usage where day > today - 30 group by source, feature),
  lg as (
    select l.id, l.name, l.short_name,
      (select count(*) from teams t where t.league_id = l.id and t.role = 'gm') as gms,
      round(coalesce((select sum(usd) from ops.cost_usage u where u.league_id = l.id and u.day > today - 30), 0), 4) as direct_30
    from leagues l where l.status = 'active'),
  shared as (
    select round(coalesce((select sum(usd) from ops.cost_usage where league_id = 0 and day > today - 30), 0)
      + (select sum(ops.fixed_on(d::date)) from generate_series(today - 29, today, interval '1 day') d), 4) as total_30)
  select jsonb_build_object(
    'today', today,
    'metered_since', (select min(day) from ops.cost_usage),
    'daily', (select jsonb_agg(to_jsonb(x) order by x.day) from daily x),
    'months', (select jsonb_agg(to_jsonb(x) order by x.month desc) from months x),
    'features', (select coalesce(jsonb_agg(to_jsonb(x) order by x.usd desc), '[]') from feat x),
    'leagues', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'short_name', short_name, 'gms', gms, 'direct_30', direct_30,
        'shared_30', round((select total_30 from shared) / leagues, 4),
        'total_30', round(direct_30 + (select total_30 from shared) / leagues, 4)) order by id) from lg),
    'fixed', (select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'item', item, 'monthly_usd', monthly_usd, 'share', share,
        'starts', starts, 'ends', ends, 'note', note) order by monthly_usd * share desc, id) from ops.cost_fixed where ends is null or ends >= today),
    'summary', jsonb_build_object(
      'today', (select fixed + garry + x_feed + other from daily where day = today),
      'yesterday', (select fixed + garry + x_feed + other from daily where day = today - 1),
      'mtd', (select round(sum(fixed + garry + x_feed + other), 2) from daily where day >= m0),
      'metered_avg_7', round(coalesce((select sum(usd) from ops.cost_usage where day between today - 7 and today - 1), 0) / 7, 4),
      'fixed_month', round((select sum(monthly_usd * share) from ops.cost_fixed where today >= starts and (ends is null or today <= ends)), 2),
      'projected_month', round(
        (select sum(ops.fixed_on(d::date)) from generate_series(m0, (m0 + interval '1 month - 1 day')::date, interval '1 day') d)
        + coalesce((select sum(usd) from ops.cost_usage where day >= m0 and day < today), 0)
        + (m_days - extract(day from today)::int + 1) * coalesce(
            nullif((select sum(usd) from ops.cost_usage where day between today - 7 and today - 1), 0) / 7,
            (select sum(usd) from ops.cost_usage where day = today), 0), 2),
      'leagues', leagues),
    'usage', jsonb_build_object(
      'db_bytes', pg_database_size(current_database()), 'db_included_bytes', 8::bigint * 1024 * 1024 * 1024,
      'cron_runs_yesterday', (select value from ops.usage_daily where metric = 'cron_runs' and day = today - 1),
      'ai_calls_30', (select coalesce(sum(calls), 0) from ops.cost_usage where day > today - 30)),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'message', message) order by day desc), '[]') from (select * from ops.cost_alerts order by day desc limit 10) a)
  ) into out;
  return out;
end $$;
revoke execute on function public.cost_dashboard(int) from public, anon;
grant execute on function public.cost_dashboard(int) to authenticated;

-- the fixed bills, edited on the dashboard. A change of price or share starts a new line from today and closes the old
-- one yesterday, so past days keep the price they were really charged; a fix made the same day just edits the line.
create or replace function public.cost_set_fixed(p_id int, p_item text, p_monthly numeric, p_share numeric, p_note text, p_source text default null)
returns int language plpgsql security definer set search_path = public, ops as $$
declare
  rid int; f ops.cost_fixed;
  today date := (now() at time zone 'America/New_York')::date;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  if coalesce(trim(p_item), '') = '' then raise exception 'Name the bill'; end if;
  if p_monthly is null or p_monthly < 0 or p_share is null or p_share < 0 or p_share > 1 then
    raise exception 'Monthly cost must be 0 or more and the share between 0 and 1';
  end if;
  if p_id is null then
    insert into ops.cost_fixed (source, item, monthly_usd, share, note, starts)
      values (coalesce(nullif(trim(p_source), ''), 'other'), trim(p_item), p_monthly, p_share, nullif(trim(p_note), ''), today)
      returning id into rid;
    return rid;
  end if;
  select * into f from ops.cost_fixed where id = p_id and (ends is null or ends >= today);
  if not found then raise exception 'No such bill'; end if;
  if f.starts < today and (f.monthly_usd <> p_monthly or f.share <> p_share) then
    update ops.cost_fixed set ends = today - 1 where id = p_id;
    insert into ops.cost_fixed (source, item, monthly_usd, share, note, starts)
      values (f.source, trim(p_item), p_monthly, p_share, nullif(trim(p_note), ''), today) returning id into rid;
  else
    update ops.cost_fixed set item = trim(p_item), monthly_usd = p_monthly, share = p_share, note = nullif(trim(p_note), '')
      where id = p_id returning id into rid;
  end if;
  return rid;
end $$;
revoke execute on function public.cost_set_fixed(int, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.cost_set_fixed(int, text, numeric, numeric, text, text) to authenticated;

-- a bill that stops: it counts through yesterday and not from today (one added today then never counts at all)
create or replace function public.cost_end_fixed(p_id int) returns void
language plpgsql security definer set search_path = public, ops as $$
declare today date := (now() at time zone 'America/New_York')::date;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  update ops.cost_fixed set ends = today - 1 where id = p_id and (ends is null or ends >= today);
end $$;
revoke execute on function public.cost_end_fixed(int) from public, anon;
grant execute on function public.cost_end_fixed(int) to authenticated;

-- today so far, from the counters kept before this: Garry's tokens on each league's state row (priced at grok-4.3's
-- rates: $1.25 a million in, $0.20 cached, $2.50 out) and the X feed's own priced tally
do $$
declare today date := (now() at time zone 'America/New_York')::date; x jsonb;
begin
  insert into ops.cost_usage (day, league_id, source, feature, calls, input_tokens, cached_tokens, output_tokens, usd)
  select today, league_id, 'xai', 'garry.other', (usage->>'calls')::int, (usage->>'input')::bigint, (usage->>'cached')::bigint,
    (usage->>'output')::bigint + coalesce((usage->>'reasoning')::bigint, 0),
    (((usage->>'input')::bigint - (usage->>'cached')::bigint) * 1.25 + (usage->>'cached')::bigint * 0.20
      + ((usage->>'output')::bigint + coalesce((usage->>'reasoning')::bigint, 0)) * 2.50) / 1e6
  from garry_state where usage->>'day' = today::text and coalesce((usage->>'calls')::int, 0) > 0
  on conflict do nothing;
  if to_regclass('public.hub_cache') is not null then
    select body into x from hub_cache where key = 'x_usage';
    if x->>'day' = today::text and x ? 'usd' then   -- the tally is priced only from the October cost pass on
      insert into ops.cost_usage (day, league_id, source, feature, calls, input_tokens, output_tokens, units, usd)
      values (today, 0, 'xai', 'hub.x_feed', coalesce((x->>'searches')::int, 0), coalesce((x->>'input')::bigint, 0),
        coalesce((x->>'output')::bigint, 0), coalesce((x->>'posts_read')::numeric, 0), coalesce((x->>'usd')::numeric, 0))
      on conflict do nothing;
    end if;
  end if;
end $$;
