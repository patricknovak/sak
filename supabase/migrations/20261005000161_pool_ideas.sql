-- What pool players ask for (docs/POOLS.md section 6: "whatever the result, we write down what people asked for"). A
-- prediction pool's members suggest and vote on its ideas board like a league's GMs do (feature_ideas, per league);
-- this lets the platform read every pool's ideas in one place, newest first, with their votes and comments, on the
-- Platform page. Platform admins only.
create or replace function public.platform_ideas(p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public, ops as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform reads every pool''s ideas'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select i.id, i.title, i.body, i.status, i.created_at, l.name pool, l.brand #>> '{colors,gold}' color, t.gm_name by,
      (select count(*) from feature_votes v where v.idea_id = i.id) votes,
      (select count(*) from feature_comments c where c.feature_key = 'idea:' || i.id) comments
    from feature_ideas i join teams t on t.id = i.team_id join leagues l on l.id = t.league_id
    where l.kind = 'predict'
    order by i.created_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 200))) x), '[]'::jsonb);
end $$;
revoke execute on function public.platform_ideas(int) from public, anon;
grant execute on function public.platform_ideas(int) to authenticated;

-- the chat line a new idea posts points to where the idea lives: More → Ideas in a pool, More → League features in a
-- league
create or replace function public._idea_posted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _sys('general', format('💡 %s suggested %s: “%s”. Vote on it under More → %s.', _tname(new.team_id),
    case when _idea_in_pool(new.team_id) then 'an idea' else 'a feature' end, new.title,
    case when _idea_in_pool(new.team_id) then 'Ideas' else 'League features' end));
  return new;
end $$;
revoke execute on function public._idea_posted() from public, anon, authenticated;

create or replace function public._idea_in_pool(p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select l.kind = 'predict' from teams t join leagues l on l.id = t.league_id where t.id = p_team), false)
$$;
revoke execute on function public._idea_in_pool(int) from public, anon, authenticated;
