-- A prediction pool opened via _pool_open always started as sport 'nhl' (the default row).
-- When its first games are attached, stamp leagues.sport from that competition so an MLB
-- (or NFL, NBA, …) postseason pool is not left labelled hockey.

create or replace function public.pool_start_games(p_league int, p_games jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; ids bigint[] := '{}'; comp text; sport_id text;
begin
  if auth.uid() is null or not exists (select 1 from teams where league_id = p_league and user_id = auth.uid() and is_commish) then
    raise exception 'Only the pool''s host starts its games';
  end if;
  if (select created_at from leagues where id = p_league) < now() - interval '1 day' then raise exception 'Add games from the Host page'; end if;
  perform set_config('app.league_id', p_league::text, true);
  if current_league_id() <> p_league then raise exception 'Could not open that pool'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_games, '[]')) loop
    ids := ids || case
      when x->>'kind' = 'survivor' then _survivor_create(x->>'competition', (x->'rules'->>'from_round')::int, (x->'rules'->>'to_round')::int, (x->'rules'->>'lives')::int)
      when x->>'kind' = 'score' then predictor_start(x->>'competition', (x->'rules'->>'from_round')::int)
      else _pool_game_create(x->>'kind', x->>'competition', (x->'rules') - 'auto'::text) end;
    -- a sheet on every game of the event from here on, the ones due now opened at once
    if x->>'kind' = 'props' and coalesce((x->'rules'->>'auto')::boolean, false) then
      insert into pool_auto_sheets (competition, by_team)
      values (x->>'competition', (select id from teams where league_id = p_league and user_id = auth.uid() and is_commish limit 1)) on conflict do nothing;
      perform _props_auto(p_league);
    end if;
  end loop;
  -- first competition on the payload names the pool's sport (predict pools only)
  -- alias must not clash with the loop variable `x` (PL/pgSQL ambiguity)
  select nullif(g->>'competition', '') into comp
  from jsonb_array_elements(coalesce(p_games, '[]')) g
  where nullif(g->>'competition', '') is not null
  limit 1;
  if comp is not null then
    select c.sport into sport_id from competitions c where c.id = comp;
    if sport_id is not null then
      update leagues set sport = sport_id where id = p_league and kind = 'predict' and sport is distinct from sport_id;
    end if;
  end if;
  return to_jsonb(ids);
end $$;
