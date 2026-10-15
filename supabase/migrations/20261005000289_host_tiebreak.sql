-- The host enters a pick'em round's tiebreaker for a member who asked (15 October 2026), as they already can the round's
-- picks: `pool_host_pick` with `{"thing": "t:<round>", "pick": {"runs": n}}`, under the same lock as the member's own.

create or replace function public.pool_host_pick(p_game bigint, p_team int, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; out jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if not exists (select 1 from teams where id = p_team and league_id = current_league_id() and role = 'gm') then
    raise exception 'Pick for a player in this pool';
  end if;
  if g.kind = 'pickem' and not (p_pick ? 'thing') then
    out := to_jsonb(_pickem_save_as(p_team, g.id, (p_pick->>'round')::int, p_pick->'picks'));
  -- a pick'em round's tiebreaker ('t:<round>', migration 289) goes the way a series or bracket tiebreaker does
  elsif g.kind in ('series', 'rank', 'bracket', 'players', 'props', 'streak', 'pickem') then
    out := _pool_game_pick_as(p_team, g.id, p_pick->>'thing', p_pick->'pick');
  else
    raise exception '%', case g.kind when 'squares' then 'Squares are claimed by each player, with their own coins'
      when 'survivor' then 'Pick for them on the Last one standing page' else 'The host can''t pick for a member in this game' end;
  end if;
  if p_team <> my_team() then
    perform _pool_alert(p_team, 'pool_game', format('📝 The host entered a pick for you in %s.', g.title), '/picks?g=' || g.id);
  end if;
  return out;
end $$;
