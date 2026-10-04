-- League by host (docs/EXPANSION.md B5, the hosting move's step 5): each league has an address of its own, and the site
-- opens that league when it is served from it.
--
-- * A league's address is <slug>.superpoolsai.com (SaK: sak.superpoolsai.com), or its own domain (leagues.domain).
-- * league_by_host(host): which league an address is, with its name and brand and nothing else, readable before sign-in
--   so the sign-in page wears the league's wordmark and colour. The app's own hosts (the apex, www, app, the GitHub and
--   Cloudflare Pages addresses, localhost) are no league's: the site then opens the account's own league as before.
-- * The site sends that league in the x-league header; current_league_id() already honours it for a member of the
--   league, and ignores it for anyone else.
-- * platform_set_league_domain(league, domain): the platform gives a league its own domain (or takes it away).

set client_min_messages = warning;

create or replace function public._host_slug(p_host text) returns text
language sql immutable set search_path = public as $$
  -- the part before .superpoolsai.com (or the .superpoolai.com spelling we also own), unless it's one of the app's own
  select case when s is null or s in ('www', 'app', 'api', 'admin', 'mail', 'send') then null else s end
  from (select (regexp_match(lower(split_part(btrim(coalesce(p_host, '')), ':', 1)), '^([a-z0-9][a-z0-9-]{0,30})\.superpools?ai\.com$'))[1] as s) x
$$;

create or replace function public.league_by_host(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'short_name', l.short_name, 'brand', l.brand, 'status', l.status)
  from leagues l
  where l.status <> 'archived'
    and (l.domain = lower(split_part(btrim(coalesce(p_host, '')), ':', 1)) or l.slug = _host_slug(p_host))
  order by (l.domain is not null and l.domain = lower(split_part(btrim(coalesce(p_host, '')), ':', 1))) desc
  limit 1
$$;
revoke execute on function public.league_by_host(text) from public;
grant execute on function public.league_by_host(text) to anon, authenticated;

create or replace function public.platform_set_league_domain(p_league int, p_domain text) returns text
language plpgsql security definer set search_path = public as $$
declare d text := nullif(lower(btrim(coalesce(p_domain, ''))), '');
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  if not exists (select 1 from leagues where id = p_league) then raise exception 'No such league'; end if;
  if d is not null and d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' then raise exception 'That isn''t a web address like pool.example.com'; end if;
  -- a superpoolsai.com address is already the league's by its web name
  if d is not null and d ~ '\.superpools?ai\.com$' then raise exception 'Every league already has <web name>.superpoolsai.com; this is for an address of its own'; end if;
  if d is not null and exists (select 1 from leagues where domain = d and id <> p_league) then raise exception 'Another league has that address'; end if;
  update leagues set domain = d, updated_at = now() where id = p_league;
  return d;
end $$;
revoke execute on function public.platform_set_league_domain(int, text) from public, anon;
grant execute on function public.platform_set_league_domain(int, text) to authenticated;

-- the platform's list carries each league's own domain too
drop function if exists public.platform_leagues();
create function public.platform_leagues()
returns table (league_id int, slug text, name text, short_name text, status text, created_at timestamptz, seats int, filled int,
               spectators int, commish_team int, commish_name text, commish_seated boolean, brand jsonb, domain text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  return query
    select l.id, l.slug, l.name, l.short_name, l.status, l.created_at,
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm'),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'spectator'),
      c.id, c.gm_name, c.user_id is not null, l.brand, l.domain
    from leagues l
    left join lateral (select t.id, t.gm_name, t.user_id from teams t where t.league_id = l.id and t.is_commish order by t.id limit 1) c on true
    order by l.id;
end $$;
revoke execute on function public.platform_leagues() from public, anon;
grant execute on function public.platform_leagues() to authenticated;
