-- The learning loop on series (docs/DEVELOPMENT.md §6 item 5, "series picks next on the same log"): Pick the series'
-- split goes in the prediction log as pick'em's does (migration 174), so `crowd_calibration()` learns how good a
-- group's call on a playoff series is, sport by sport, beside its call on a match.
-- * When a series' first game starts (its picks lock), each Pick the series game on it writes `pool_split`: the club
--   most of the pool picked and its share, made at the first pitch. Fewer than three picks, or an even split, says
--   nothing.
-- * When the series is over it is scored: 1 if the favourite won it, 0 if not.

-- the split on one series for one Pick the series game, written once (made at the first pitch)
create or replace function public._pool_split_series_write(p_game bigint, p_series bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; hi int; lo int; n int; fav bigint;
begin
  select * into g from pool_games where id = p_game and kind = 'series';
  select * into s from series where id = p_series;
  if g.id is null or s.id is null or s.competition <> g.competition or s.round < (g.rules->>'from_round')::int
     or s.high_club is null or s.low_club is null then return; end if;
  select count(*) filter (where (pick->>'winner')::bigint = s.high_club), count(*) filter (where (pick->>'winner')::bigint = s.low_club)
    into hi, lo from pool_picks where game_id = g.id and thing = 's:' || s.id;
  n := hi + lo;
  if n < 3 or hi = lo then return; end if;
  fav := case when hi > lo then s.high_club else s.low_club end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'series', s.id), round(greatest(hi, lo)::numeric / n, 3), s.sport,
    least(coalesce(s.starts_at, now()), now()), coalesce((s.starts_at at time zone 'America/New_York')::date, today_et()) + s.best_of * 2,
    jsonb_build_object('fav', fav, 'high', hi, 'low', lo, 'picks', n, 'competition', s.competition, 'round', s.round, 'series', coalesce(s.short, s.label)))
  on conflict (league_id, kind, subject) do nothing;
end $$;
revoke execute on function public._pool_split_series_write(bigint, bigint) from public, anon, authenticated;

-- score the splits on a series once it is over
create or replace function public._pool_split_series_score(p_series bigint) returns int
language plpgsql security definer set search_path = public as $$
declare s series; n int;
begin
  select * into s from series where id = p_series;
  if s.id is null or s.state <> 'final' or s.winner is null then return 0; end if;
  update predictions set status = 'scored', outcome = (s.winner = (detail->>'fav')::bigint)::int,
    error = (s.winner = (detail->>'fav')::bigint)::int - predicted, scored_at = now()
  where kind = 'pool_split' and (subject->>'series')::bigint = p_series and status <> 'scored';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public._pool_split_series_score(bigint) from public, anon, authenticated;

-- every Pick the series game on a series writes its split once the series is under way (or over), then scores it
create or replace function public._pool_split_series() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.state = old.state or new.state = 'scheduled' then return new; end if;
  for g in select id from pool_games where kind = 'series' and competition = new.competition loop
    perform _pool_split_series_write(g.id, new.id);
  end loop;
  if new.state = 'final' then perform _pool_split_series_score(new.id); end if;
  return new;
end $$;
revoke execute on function public._pool_split_series() from public, anon, authenticated;
drop trigger if exists series_pool_split on public.series;
create trigger series_pool_split after update of state on public.series
  for each row execute function public._pool_split_series();

-- the series already under way in a running Pick the series write theirs now, and score if done
do $$ declare r record; begin
  for r in select g.id gid, s.id sid from pool_games g join series s on s.competition = g.competition
           where g.kind = 'series' and s.round >= (g.rules->>'from_round')::int and s.state <> 'scheduled' loop
    perform _pool_split_series_write(r.gid, r.sid);
    perform _pool_split_series_score(r.sid);
  end loop;
end $$;
