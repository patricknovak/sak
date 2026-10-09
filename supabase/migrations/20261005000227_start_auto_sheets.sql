-- Automatic sheets from the start page (migration 223 put the switch on the Host page): a new pool's first prop sheet can
-- carry `auto`, which opens the sheet on the game chosen and turns on a sheet for every game of the event, as the host's
-- switch does. Safe to run twice.

create or replace function public.pool_start_games(p_league int, p_games jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; ids bigint[] := '{}';
begin
  if auth.uid() is null or not exists (select 1 from teams where league_id = p_league and user_id = auth.uid() and is_commish) then
    raise exception 'Only the pool''s host starts its games';
  end if;
  if (select created_at from leagues where id = p_league) < now() - interval '1 day' then raise exception 'Add games from the Host page'; end if;
  perform set_config('app.league_id', p_league::text, true);
  if current_league_id() <> p_league then raise exception 'Could not open that pool'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_games, '[]')) loop
    ids := ids || case when x->>'kind' = 'survivor'
      then _survivor_create(x->>'competition', (x->'rules'->>'from_round')::int, (x->'rules'->>'to_round')::int)
      else _pool_game_create(x->>'kind', x->>'competition', (x->'rules') - 'auto'::text) end;
    -- a sheet on every game of the event from here on, the ones due now opened at once
    if x->>'kind' = 'props' and coalesce((x->'rules'->>'auto')::boolean, false) then
      insert into pool_auto_sheets (competition, by_team)
      values (x->>'competition', (select id from teams where league_id = p_league and user_id = auth.uid() and is_commish limit 1)) on conflict do nothing;
      perform _props_auto(p_league);
    end if;
  end loop;
  return to_jsonb(ids);
end $$;
revoke execute on function public.pool_start_games(int, jsonb) from public, anon;
grant execute on function public.pool_start_games(int, jsonb) to authenticated;
