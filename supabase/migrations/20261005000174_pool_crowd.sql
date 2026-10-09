-- The learning loop for pools (docs/DEVELOPMENT.md §6 item 5): a pool's pick split is a forecast, and the product
-- learns how good a group's consensus is, sport by sport.
--
-- * When a pick'em match kicks off (every pick on it is locked), the pool's split goes in the prediction log as
--   `pool_split`: the favourite (the side most of the pool picked) and its share, made at kick-off. A match with fewer
--   than three picks, or no single favourite, says nothing and is left out.
-- * At the final whistle it is scored: 1 if the favourite was right, 0 if not (a draw beats a home or away favourite;
--   an NFL tie beats either). A match called off is void. The result read is the pool's own: a host who settled the
--   match by hand (migration 172) scores it, and handing it back to the feed re-scores it from the feed.
-- * `crowd_calibration()` reads it back by sport and by how lopsided the split was: when 80% of a pool agreed, how
--   often were they right? A pool sees its own; a platform admin sees every pool's, which is the point.
-- * Pick'em is the first kind written; series picks and the survivor follow on the same log.

-- the split on one match for one pool game, written once (made at kick-off)
create or replace function public._pool_split_write(p_game bigint, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; h int; d int; a int; n int; top int; fav text;
begin
  select * into g from pool_games where id = p_game and kind = 'pickem';
  select * into f from fixtures where id = p_fixture;
  if g.id is null or f.id is null or f.competition <> g.competition
     or f.gameweek not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then return; end if;
  select count(*) filter (where pick->>'pick' = 'H'), count(*) filter (where pick->>'pick' = 'D'), count(*) filter (where pick->>'pick' = 'A')
    into h, d, a from pool_picks where game_id = g.id and thing = 'f:' || f.id;
  n := h + d + a;
  top := greatest(h, d, a);
  if n < 3 or (h = top)::int + (d = top)::int + (a = top)::int > 1 then return; end if;
  fav := case when h = top then 'H' when a = top then 'A' else 'D' end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'fixture', f.id), round(top::numeric / n, 3), f.sport,
    least(f.kickoff, now()), f.date,
    jsonb_build_object('fav', fav, 'H', h, 'D', d, 'A', a, 'picks', n, 'competition', f.competition, 'round', f.gameweek))
  on conflict (league_id, kind, subject) do nothing;
end $$;
revoke execute on function public._pool_split_write(bigint, bigint) from public, anon, authenticated;

-- score (or re-score) the splits on a match, each by its own pool's result
create or replace function public._pool_split_score(p_fixture bigint) returns int
language plpgsql security definer set search_path = public as $$
declare pr record; x record; n int := 0;
begin
  for pr in select * from predictions where kind = 'pool_split' and (subject->>'fixture')::bigint = p_fixture loop
    select * into x from _pool_fixture(pr.league_id, p_fixture);
    if x.void then
      update predictions set status = 'void', outcome = null, error = null, scored_at = now() where id = pr.id;
    elsif x.res is not null then
      update predictions set status = 'scored', outcome = (x.res = pr.detail->>'fav')::int,
        error = (x.res = pr.detail->>'fav')::int - pr.predicted, scored_at = now() where id = pr.id;
    else
      -- the host handed it back and the feed hasn't finished it: open again
      update predictions set status = 'open', outcome = null, error = null, scored_at = null where id = pr.id and status <> 'open';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_split_score(bigint) from public, anon, authenticated;

-- every pick'em on a match's competition writes its split once the match is under way (or over), then scores it
create or replace function public._pool_split_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.state = old.state then return new; end if;
  if new.state in ('live', 'final') then
    for g in select id from pool_games where kind = 'pickem' and competition = new.competition loop
      perform _pool_split_write(g.id, new.id);
    end loop;
  end if;
  if new.state in ('final', 'postponed', 'cancelled') then perform _pool_split_score(new.id); end if;
  return new;
end $$;
revoke execute on function public._pool_split_fixture() from public, anon, authenticated;
drop trigger if exists fixtures_pool_split on public.fixtures;
create trigger fixtures_pool_split after update of state on public.fixtures
  for each row execute function public._pool_split_fixture();

-- a host's result (or handing it back) re-scores that pool's split
create or replace function public._pool_split_override() returns trigger
language plpgsql security definer set search_path = public as $$
declare fx bigint := coalesce(new.fixture_id, old.fixture_id); lg int := coalesce(new.league_id, old.league_id); g record;
begin
  -- settled by hand before the feed said it had started: the picks are locked all the same
  for g in select id from pool_games where kind = 'pickem' and league_id = lg and competition = (select competition from fixtures where id = fx) loop
    perform _pool_split_write(g.id, fx);
  end loop;
  perform _pool_split_score(fx);
  return null;
end $$;
revoke execute on function public._pool_split_override() from public, anon, authenticated;
drop trigger if exists pool_result_overrides_split on public.pool_result_overrides;
create trigger pool_result_overrides_split after insert or update or delete on public.pool_result_overrides
  for each row execute function public._pool_split_override();

-- the matches already under way in a running pick'em write theirs now (made at their kick-off), and score if done
do $$ declare r record; begin
  for r in select g.id gid, f.id fid from pool_games g join fixtures f on f.competition = g.competition
           where g.kind = 'pickem' and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
             and (f.state <> 'scheduled' or f.kickoff <= now()) loop
    perform _pool_split_write(r.gid, r.fid);
  end loop;
  for r in select distinct (subject->>'fixture')::bigint fid from predictions where kind = 'pool_split' and status = 'open' loop
    perform _pool_split_score(r.fid);
  end loop;
end $$;

-- how good the crowd is: by sport and by the favourite's share (tenths), how often the favourite was right. A pool's
-- members see their pool; a platform admin sees every pool, which is how the product learns
create or replace function public.crowd_calibration()
returns table (sport text, bucket numeric, n int, said numeric, right_share numeric, pools int)
language sql stable security definer set search_path = public as $$
  select basis, least(floor(predicted * 10) / 10, 0.9), count(*)::int, round(avg(predicted), 3), round(avg(outcome), 3), count(distinct league_id)::int
  from predictions
  where kind = 'pool_split' and status = 'scored' and (is_platform_admin() or league_id = current_league_id())
  group by 1, 2 order by 1, 2
$$;
revoke execute on function public.crowd_calibration() from public, anon;
grant execute on function public.crowd_calibration() to authenticated;
