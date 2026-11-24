-- The front door, counted (24 November 2026, the market review's "pipeline"). The Platform page could say how many pools
-- started and who joined, but not how many people reached the marketing site, opened the start page, or pressed Start and
-- then stopped: GA4 sees only the visitors who accept its cookie, which on a first visit is few. This is the cookieless
-- count beside it: one row per day, step, page and source, a number and nothing else. No cookie, no address, no account,
-- no hash of anyone: a visit can't be followed from one step to the next, only the day's totals compared.
--
-- Steps: 'view' (a marketing page opened; page is its name), 'start_open' (the app's start page, #/new, opened) and
-- 'start_go' (Start pressed on it). Source is the ?src= or utm_source the visitor arrived with, empty when none.
-- Anyone may add one to a count (the marketing site has no sign-in); a count can be inflated but never read by them,
-- and every word is checked against a short pattern so nothing else can be stored. Safe to run twice.

create table if not exists private.funnel_daily (
  day date not null,
  step text not null,
  page text not null default '',
  src text not null default '',
  n int not null default 0,
  primary key (day, step, page, src)
);
revoke all on private.funnel_daily from public, anon, authenticated;

create or replace function public.funnel_hit(p_step text, p_page text default '', p_src text default '') returns void
language plpgsql security definer set search_path = public, private as $$
declare pg text := lower(coalesce(p_page, '')); s text := lower(coalesce(p_src, ''));
begin
  if p_step is null or p_step not in ('view', 'start_open', 'start_go') then return; end if;
  if pg !~ '^[a-z0-9_-]{0,32}$' then pg := 'other'; end if;
  if s !~ '^[a-z0-9_.-]{0,32}$' then s := 'other'; end if;
  insert into private.funnel_daily (day, step, page, src, n) values (today_et(), p_step, pg, s, 1)
  on conflict (day, step, page, src) do update set n = private.funnel_daily.n + 1
    where private.funnel_daily.n < 1000000;
end $$;
revoke execute on function public.funnel_hit(text, text, text) from public;
grant execute on function public.funnel_hit(text, text, text) to anon, authenticated;

-- the platform admins' read: the last p_days of counts, and beside them what the database already knows for the same
-- days (pools and leagues started by real accounts, and the seats taken in them), so the page can show the whole path
create or replace function public.platform_funnel(p_days int default 28) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare d int := greatest(1, least(coalesce(p_days, 28), 120));
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  return jsonb_build_object(
    'counts', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'step', step, 'page', page, 'src', src, 'n', n) order by day, step, page, src)
                        from private.funnel_daily where day > today_et() - d), '[]'::jsonb),
    'started', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'n', x.n) order by x.day) from (
        select (l.created_at at time zone 'America/New_York')::date as day, count(*)::int as n
        from leagues l
        where (l.created_at at time zone 'America/New_York')::date > today_et() - d
          and exists (select 1 from league_members m left join accounts a on a.user_id = m.user_id
                      where m.league_id = l.id and m.role = 'commish' and not coalesce(a.is_test, false))
        group by 1) x), '[]'::jsonb),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'n', x.n) order by x.day) from (
        select (m.joined_at at time zone 'America/New_York')::date as day, count(*)::int as n
        from league_members m left join accounts a on a.user_id = m.user_id
        where (m.joined_at at time zone 'America/New_York')::date > today_et() - d and not coalesce(a.is_test, false)
        group by 1) x), '[]'::jsonb));
end $$;
revoke execute on function public.platform_funnel(int) from public, anon;
grant execute on function public.platform_funnel(int) to authenticated;
