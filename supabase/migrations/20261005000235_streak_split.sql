-- The daily streak in the prediction log (docs/DEVELOPMENT.md §4): once a game a streak's members picked is under way,
-- the pool's split on it goes in as `pool_split`, the same as a pick'em match's (three picks or more and a single
-- favourite), and is scored by the pool's own result. The crowd's record then covers every game a pool picks, whichever
-- kind it was picked in. Safe to run twice.

create or replace function public._pool_split_write(p_game bigint, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; h int; d int; a int; n int; top int; fav text;
begin
  select * into g from pool_games where id = p_game and kind in ('pickem', 'streak');
  select * into f from fixtures where id = p_fixture;
  if g.id is null or f.id is null or f.competition <> g.competition
     or (g.kind = 'pickem' and f.gameweek not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int) then return; end if;
  -- pick'em's picks are by match; the streak's by day, each naming its game (migration 235)
  select count(*) filter (where pick->>'pick' = 'H'), count(*) filter (where pick->>'pick' = 'D'), count(*) filter (where pick->>'pick' = 'A')
    into h, d, a from pool_picks
  where game_id = g.id and case when g.kind = 'streak' then thing like 'd:%' and (pick->>'fixture')::bigint = f.id else thing = 'f:' || f.id end;
  n := h + d + a;
  top := greatest(h, d, a);
  if n < 3 or (h = top)::int + (d = top)::int + (a = top)::int > 1 then return; end if;
  fav := case when h = top then 'H' when a = top then 'A' else 'D' end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'fixture', f.id), round(top::numeric / n, 3), f.sport,
    least(f.kickoff, now()), f.date,
    jsonb_build_object('fav', fav, 'H', h, 'D', d, 'A', a, 'picks', n, 'competition', f.competition, 'round', f.gameweek,
      -- what the market gave the pool's favourite at kick-off, when the feed carries it
      'market', case fav when 'H' then f.detail->'odds'->'home' when 'A' then f.detail->'odds'->'away' else f.detail->'odds'->'draw' end))
  on conflict (league_id, kind, subject) do nothing;
end $$;
revoke execute on function public._pool_split_write(bigint, bigint) from public, anon, authenticated;

create or replace function public._pool_split_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.state = old.state then return new; end if;
  if new.state in ('live', 'final') then
    for g in select id from pool_games where kind in ('pickem', 'streak') and competition = new.competition loop
      perform _pool_split_write(g.id, new.id);
    end loop;
  end if;
  if new.state in ('final', 'postponed', 'cancelled') then perform _pool_split_score(new.id); end if;
  return new;
end $$;
revoke execute on function public._pool_split_fixture() from public, anon, authenticated;

create or replace function public._pool_split_override() returns trigger
language plpgsql security definer set search_path = public as $$
declare fx bigint := coalesce(new.fixture_id, old.fixture_id); lg int := coalesce(new.league_id, old.league_id); g record;
begin
  -- settled by hand before the feed said it had started: the picks are locked all the same
  for g in select id from pool_games where kind in ('pickem', 'streak') and league_id = lg and competition = (select competition from fixtures where id = fx) loop
    perform _pool_split_write(g.id, fx);
  end loop;
  perform _pool_split_score(fx);
  return null;
end $$;
revoke execute on function public._pool_split_override() from public, anon, authenticated;
