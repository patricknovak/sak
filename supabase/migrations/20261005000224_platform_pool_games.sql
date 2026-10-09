-- The pools in play, for the people who run Super Pools (the Platform page's "Sports games" card): every live pool with
-- its players and each sports game it runs, how many have picked and when last, and the events it opens prop sheets on
-- by itself, so a test like the World Series can be watched from one place. Platform admins only. Safe to run twice.

create or replace function public.platform_pool_games() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  return coalesce((select jsonb_agg(x.j order by x.last desc nulls last, x.id) from (
    select l.id, (select max(pk.picked_at) from pool_picks pk where pk.league_id = l.id) last,
      jsonb_build_object('league_id', l.id, 'name', l.name, 'slug', l.slug, 'color', l.brand->'colors'->>'gold',
        'players', (select count(*) from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
        'last', (select max(pk.picked_at) from pool_picks pk where pk.league_id = l.id),
        'auto', coalesce((select jsonb_agg(c.name order by c.name) from pool_auto_sheets a join competitions c on c.id = a.competition where a.league_id = l.id), '[]'),
        'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status,
            -- a grid takes claims until its digits are drawn, whatever its rules say
            'competition', g.competition, 'locked', case when g.kind = 'squares' then g.draw is not null else _pool_game_locked(g.id) end,
            'pickers', (select count(distinct pk.team_id) from pool_picks pk where pk.game_id = g.id),
            'last', (select max(pk.picked_at) from pool_picks pk where pk.game_id = g.id)) order by g.status, g.id desc)
          from pool_games g where g.league_id = l.id), '[]')) j
    from leagues l where l.kind = 'predict' and l.status <> 'archived') x), '[]');
end $$;
revoke execute on function public.platform_pool_games() from public, anon;
grant execute on function public.platform_pool_games() to authenticated;
