-- A box pool's rules change only as asked (migration 188 follow-up): the host's change used to start from the game's
-- rules with the worked-out keys stripped, `length` among them, which for a box pool is its window, so a change that
-- didn't name the window again put it back to four weeks. A box pool's change now starts from its rules as they are,
-- and the boxes-stay check judges the rules that would be saved.

-- the host's rules change: a box pool's from its rules as they are
create or replace function public.pool_game_set_rules(p_game bigint, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; r jsonb; base jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if _pool_game_locked(g.id) then raise exception 'The rules froze at the first lock'; end if;
  if g.kind = 'pickem' and coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
     and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Picks are in, so the scoring stays: it changes only before anyone picks';
  end if;
  -- what was worked out from a preset is worked out again from the new one
  base := case when g.kind = 'players' then g.rules else g.rules - 'points' - 'length' - 'exact_only' - 'weights' - 'draws' - 'per' end;
  r := _pool_game_rules(g.kind, g.competition, base || coalesce(p_rules, '{}')
         || jsonb_strip_nulls(jsonb_build_object('from_round', g.rules->'from_round', 'series', g.rules->'series')));
  -- a box pool's boxes stay once a team is in
  if g.kind = 'players' and r->>'key' is distinct from g.rules->>'key' and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Teams are in, so the boxes stay: the size, the nights and the scoring change only before anyone picks';
  end if;
  update pool_games set rules = r where id = g.id;
  perform _sys('general', format('📝 The host changed the rules of %s before the first lock.', g.title), jsonb_build_object('pool_game', g.id));
  return r;
end $$;
revoke execute on function public.pool_game_set_rules(bigint, jsonb) from public, anon;
grant execute on function public.pool_game_set_rules(bigint, jsonb) to authenticated;

