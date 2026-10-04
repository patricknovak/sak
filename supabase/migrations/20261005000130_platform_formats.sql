-- The Platform page says how each league plays: platform_leagues() gains its format ('season' or 'h2h') and how many
-- categories it plays (0 for points), from its rules.

set client_min_messages = warning;

drop function if exists public.platform_leagues();
create function public.platform_leagues()
returns table (league_id int, slug text, name text, short_name text, status text, created_at timestamptz, seats int, filled int,
               spectators int, commish_team int, commish_name text, commish_seated boolean, brand jsonb, domain text,
               active_7d int, last_seen timestamptz, format text, categories int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  return query
    select l.id, l.slug, l.name, l.short_name, l.status, l.created_at,
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm'),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'spectator'),
      c.id, c.gm_name, c.user_id is not null, l.brand, l.domain,
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm' and t.last_seen > now() - interval '7 days'),
      (select max(t.last_seen) from teams t where t.league_id = l.id),
      r.format, coalesce(cardinality(r.categories), 0)
    from leagues l
    left join league_rules r on r.league_id = l.id
    left join lateral (select t.id, t.gm_name, t.user_id from teams t where t.league_id = l.id and t.is_commish order by t.id limit 1) c on true
    order by l.id;
end $$;
revoke execute on function public.platform_leagues() from public, anon;
grant execute on function public.platform_leagues() to authenticated;
