-- A postseason fixture question's category names its series, not "Round N". Migration 342 used `_round_word`,
-- which answers 'Round' for any competition with series rows, so a World Series card said "MLB · Round 4" beside a
-- rule that already named World Series.
-- Where a series exists the feed's round is the name to show; everywhere else the category keeps 342's competition
-- word and gameweek. On production this changes the category on the 50 mlb-post-2026 fixtures and leaves the other
-- 4,129 exactly as 342 printed them.

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
    'category', c.short || coalesce(
      case when exists (select 1 from series s where s.competition = c.id) then ' · ' || f.round end,
      ' · ' || _round_word(c.id) || ' ' || f.gameweek, ''),
    'outcomes', jsonb_build_array(h.name, 'Draw', a.name),
    'closes_at', f.kickoff,
    'sort', 100 + coalesce(f.gameweek, 0)), p_by, null);
  update pool_markets set source = jsonb_build_object('fixture', p_fixture, 'kind', 'result') where id = mid;
  return mid;
end $$;
revoke execute on function public._pool_fixture_market(int, bigint, int) from public, anon, authenticated;
