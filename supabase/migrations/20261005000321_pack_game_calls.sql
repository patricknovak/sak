-- Calls on the games inside a series (18 October 2026). Once the World Series matchup is set, "Which league wins?" is the
-- same call as "Who wins?", so a pool started this week had three questions to play, all on the series' end. The feed can
-- now answer three about its games: who wins one game (`game`, the club ahead once that game is final), whether the
-- club that wins Game 1 wins the series (`opener_wins`), and whether any game goes past regulation (`extras`, yes the
-- moment one does, no once the series ends with every game's periods on file). The World Series pack gets one of each;
-- the hourly pool job brings them to the pool that already has the pack, and the start page counts them. A question on
-- one game drops knocked-out clubs like the series' own winner question does (migration 316). Safe to run twice.

create or replace function public._feed_answer(p_feed jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare s record; w text; g record; g1 bigint; k text := p_feed->>'kind'; comp text := p_feed->>'competition';
begin
  if k = 'game7' then
    if exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7
               and high_wins >= 3 and low_wins >= 3) then return 'Yes'; end if;
    if exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7)
       and not exists (select 1 from series where competition = comp and round = (p_feed->>'round')::int and best_of = 7
                       and winner is null) then return 'No'; end if;
    return null;
  end if;
  select * into s from series where competition = comp and label = p_feed->>'series' order by id desc limit 1;
  if s.id is null then return null; end if;
  -- one game: the club ahead once it's final
  if k = 'game' then
    select f.home_club, f.away_club, f.home_score, f.away_score into g from fixtures f
      where f.series_id = s.id and f.game_no = (p_feed->>'game')::int and f.state = 'final' order by f.id desc limit 1;
    if g.home_score is null or g.away_score is null or g.home_score = g.away_score then return null; end if;
    return (select name from clubs where id = case when g.home_score > g.away_score then g.home_club else g.away_club end);
  end if;
  -- past regulation in any game: yes the moment one is, no only once the series is over and every game's periods are in
  if k = 'extras' then
    if exists (select 1 from fixtures f join fixture_periods p on p.fixture_id = f.id
               where f.series_id = s.id and p.n > (p_feed->>'after')::int) then return 'Yes'; end if;
    if s.winner is not null and not exists (select 1 from fixtures f where f.series_id = s.id and f.state = 'final'
                                            and not exists (select 1 from fixture_periods p where p.fixture_id = f.id)) then
      return 'No';
    end if;
    return null;
  end if;
  if s.winner is null then return null; end if;
  select name into w from clubs where id = s.winner;
  if k = 'winner' then return w; end if;
  if k = 'winner_is' then return case when lower(w) = lower(p_feed->>'club') then 'Yes' else 'No' end; end if;
  if k = 'games' then
    return (array['One','Two','Three','Four','Five','Six','Seven'])[s.high_wins + s.low_wins];
  end if;
  if k = 'winner_from' then
    return (select e.value #>> '{}' from jsonb_each(p_feed->'from') e
            join series f on f.competition = comp and f.label = e.key and f.winner = s.winner limit 1);
  end if;
  -- the club that won Game 1 won it all
  if k = 'opener_wins' then
    select case when f.home_score > f.away_score then f.home_club else f.away_club end into g1
      from fixtures f where f.series_id = s.id and f.game_no = 1 and f.state = 'final' and f.home_score <> f.away_score
      order by f.id desc limit 1;
    if g1 is null then return null; end if;
    return case when g1 = s.winner then 'Yes' else 'No' end;
  end if;
  return null;
end $$;
revoke execute on function public._feed_answer(jsonb) from public, anon, authenticated;

create or replace function public._pack_market_now(x jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := x->'feed'; gone text[]; keep jsonb;
begin
  if f is null or f->>'competition' is null then return x; end if;
  -- decided already: nothing left to call
  if _feed_answer(f) is not null then return null; end if;
  if f->>'kind' not in ('winner', 'winner_is', 'game') then return x; end if;
  gone := _feed_out(f->>'competition');
  if cardinality(gone) = 0 then return x; end if;
  if f->>'kind' = 'winner_is' then
    return case when lower(f->>'club') = any (gone) then null else x end;
  end if;
  select jsonb_agg(o order by i) into keep
  from jsonb_array_elements(x->'outcomes') with ordinality t(o, i)
  where not lower(coalesce(o->>'label', o #>> '{}')) = any (gone);
  if keep is null or jsonb_array_length(keep) < 2 then return null; end if;
  return jsonb_set(x, '{outcomes}', keep);
end $$;
revoke execute on function public._pack_market_now(jsonb) from public, anon, authenticated;

-- the World Series pack's calls on its games, each added once
update public.pool_packs p set markets = p.markets || coalesce((
  select jsonb_agg(q order by q->>'sort')
  from jsonb_array_elements('[
    {"title": "Who wins Game 1 of the World Series?", "category": "The World Series", "sort": 6,
     "rule": "The club that wins Game 1, extra innings included. Closes at its first pitch; the host moves the time if the schedule moves.",
     "outcomes": ["Milwaukee Brewers", "Tampa Bay Rays", "Cleveland Guardians"], "closes_at": "2026-10-23T22:00:00Z",
     "feed": {"kind": "game", "competition": "mlb-post-2026", "series": "World Series", "game": 1}},
    {"title": "Does the Game 1 winner win the World Series?", "category": "The World Series", "sort": 7,
     "rule": "Yes if the club that wins Game 1 goes on to win the series.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-23T22:00:00Z",
     "feed": {"kind": "opener_wins", "competition": "mlb-post-2026", "series": "World Series"}},
    {"title": "Does any World Series game go to extra innings?", "category": "The World Series", "sort": 8,
     "rule": "Yes if any game of the series goes past the ninth inning.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-23T22:00:00Z",
     "feed": {"kind": "extras", "competition": "mlb-post-2026", "series": "World Series", "after": 9}}
  ]'::jsonb) q
  where not exists (select 1 from jsonb_array_elements(p.markets) e where e->>'title' = q->>'title')), '[]'::jsonb)
where p.slug = 'world-series-2026';
