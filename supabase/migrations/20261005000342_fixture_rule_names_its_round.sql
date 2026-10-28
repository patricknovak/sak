-- A fixture question names its matchweek (or week) instead of falling back to "the season" when the feed left
-- fixtures.round blank. Soccer's ESPN path fills gameweek and leaves round null; the category line also used the
-- hard-coded word "Matchweek" for every sport. Prefer the feed's own round string, then the competition's word plus
-- the gameweek, then "the season".

create or replace function public._pool_fixture_market(p_league int, p_fixture bigint, p_by int) returns bigint
language plpgsql security definer set search_path = public as $$
declare f fixtures; c competitions; h clubs; a clubs; mid bigint;
begin
  select * into f from fixtures where id = p_fixture;
  select * into c from competitions where id = f.competition;
  select * into h from clubs where id = f.home_club;
  select * into a from clubs where id = f.away_club;
  if exists (select 1 from pool_markets where league_id = p_league and status <> 'void' and source->>'kind' = 'result'
             and (source->>'fixture')::bigint = p_fixture) then
    return null;
  end if;
  mid := _pool_insert_market(p_league, jsonb_build_object(
    'title', format('%s v %s', h.name, a.name),
    'rule', format('The result after ninety minutes and stoppage time (%s, %s). Extra time and penalties don''t count. '
      'Postponed or abandoned: voided, every stake refunded.', c.name,
      coalesce(f.round, lower(_round_word(c.id)) || ' ' || f.gameweek, 'the season')),
    'category', c.short || coalesce(' · ' || _round_word(c.id) || ' ' || f.gameweek, ''),
    'outcomes', jsonb_build_array(h.name, 'Draw', a.name),
    'closes_at', f.kickoff,
    'sort', 100 + coalesce(f.gameweek, 0)), p_by, null);
  update pool_markets set source = jsonb_build_object('fixture', p_fixture, 'kind', 'result') where id = mid;
  return mid;
end $$;
revoke execute on function public._pool_fixture_market(int, bigint, int) from public, anon, authenticated;
