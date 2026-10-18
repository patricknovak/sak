-- Win totals' lock held the moment the season starts (18 October 2026, NBA opening-week audit). The calls lock at the
-- season's first game and the hourly job keeps that time (`rules.locked_at`), but in the hour before it runs the lock was
-- worked out again from the opener's kickoff: had ESPN moved the opener later just after its listed tip, calls would have
-- reopened after the board had shown everyone's. A season game that has reached its time and then changes (it starts, is
-- postponed, its time moves) now holds the lock on every open win-totals game on its season (`rules.lock_held`, the earliest
-- the lock could have been). The hourly job still writes `locked_at`, from the held time, and still tells the pool how it
-- split. Safe to run twice.

create or replace function public._wins_lock(p_game bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((rules->>'locked_at')::timestamptz, (rules->>'lock_held')::timestamptz, _wins_lock_at(competition))
  from pool_games where id = p_game
$$;
revoke execute on function public._wins_lock(bigint) from public, anon, authenticated;

create or replace function public._fixtures_wins_hold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update pool_games set rules = rules || jsonb_build_object('lock_held', least(old.kickoff, coalesce(_wins_lock_at(new.competition), old.kickoff)))
  where kind = 'wins' and status = 'open' and competition = new.competition
    and not rules ? 'locked_at' and not rules ? 'lock_held';
  return null;
exception when others then
  -- never hold up a score
  raise warning '_fixtures_wins_hold: %', sqlerrm;
  return null;
end $$;
revoke execute on function public._fixtures_wins_hold() from public, anon, authenticated;

drop trigger if exists fixtures_wins_hold on public.fixtures;
create trigger fixtures_wins_hold after update of kickoff, state on public.fixtures
  for each row when (old.kickoff <= now() and (new.kickoff is distinct from old.kickoff or new.state is distinct from old.state))
  execute function public._fixtures_wins_hold();
