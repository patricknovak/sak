-- How alive each league is, for the Platform page (docs/EXPANSION.md, Phase 2's gate: a friend's league played for two
-- weeks). platform_leagues() now also says how many of a league's GMs used the site in the last seven days and when
-- anyone last did, from teams.last_seen, which the site already keeps; nothing new is collected.

set client_min_messages = warning;

drop function if exists public.platform_leagues();
create function public.platform_leagues()
returns table (league_id int, slug text, name text, short_name text, status text, created_at timestamptz, seats int, filled int,
               spectators int, commish_team int, commish_name text, commish_seated boolean, brand jsonb, domain text,
               active_7d int, last_seen timestamptz)
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
      (select max(t.last_seen) from teams t where t.league_id = l.id)
    from leagues l
    left join lateral (select t.id, t.gm_name, t.user_id from teams t where t.league_id = l.id and t.is_commish order by t.id limit 1) c on true
    order by l.id;
end $$;
revoke execute on function public.platform_leagues() from public, anon;
grant execute on function public.platform_leagues() to authenticated;
