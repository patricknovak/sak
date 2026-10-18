-- A question about one club is answered the moment that club is knocked out (18 October 2026): "Do the Dodgers win a third
-- straight World Series?" waited on the World Series itself, so a pool that had it kept a question whose answer was
-- already No for a week, its coins tied up. The feed now answers No once the club has lost a series in the competition,
-- so the host's bell and one-tap answer settle it now. Safe to run twice.

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
  -- a club already knocked out can't win it (migration 325)
  if k = 'winner_is' and lower(p_feed->>'club') = any (_feed_out(comp)) then return 'No'; end if;
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
