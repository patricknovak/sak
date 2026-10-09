-- The prop sheet's table (migration 208's follow-up): once a sheet locks, a member with no sheet in can make nothing more, so
-- their "still possible" is 0 rather than every call (the table, "what you need" and the scoreboard read it).

create or replace function public._props_table(p_game bigint) returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; ans jsonb; nq int;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  if g.id is null then return; end if;
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  ans := _props_answers(g.id);
  nq := jsonb_array_length(g.rules->'questions');
  return query
  select tm.id::int,
    coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)::int,
    case when f.state = 'final' then coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)
         -- called off, or locked with no sheet in: nothing more to make
         when f.state = 'cancelled' or (pk.id is null and (f.state <> 'scheduled' or f.kickoff <= now())) then 0 else nq end::int,
    coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)::int,
    0, (pk.id is not null)::int,
    case when f.state = 'final' and pk.id is not null then abs((pk.pick->>'total')::int - (f.home_score + f.away_score)) end::int
  from teams tm left join pool_picks pk on pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'props'
  where tm.league_id = g.league_id and tm.role = 'gm';
end $$;
revoke execute on function public._props_table(bigint) from public, anon, authenticated;

