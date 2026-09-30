-- No betting on a night that's already under way. A box-score bet (head-to-head, over/under, player vs player,
-- pools) can't be created, taken or joined once the first day of its window has started: a day in the past, or
-- today (the league day) after its first puck drop. Otherwise a GM could post or take "tonight" at 10 pm with
-- most of the points already on the board. Custom and final-standings bets aren't tied to a night's games.
create or replace function public._bet_underway(p_start date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_start is not null and (p_start < today_et() or (p_start = today_et() and exists (
    select 1 from games g where g.date = p_start and g.start_utc <= now() and g.state not in ('PPD', 'CNCL'))))
$$;
grant execute on function public._bet_underway(date) to authenticated;

create or replace function public._bets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player') then return new; end if;
  if tg_op = 'INSERT' and _bet_underway(new.start_date) then
    raise exception 'That window has already started (games are under way or done). Start it on a day whose games haven''t begun.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'open' and new.status = 'accepted' and new.kind not like 'pool%' and _bet_underway(new.start_date) then
    raise exception 'Too late to take this one: its games have already started.';
  end if;
  return new;
end $$;
drop trigger if exists bets_guard on public.bets;
create trigger bets_guard before insert or update of status on public.bets for each row execute function public._bets_guard();

create or replace function public._bet_entries_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  select * into b from bets where id = new.bet_id;
  -- the creator's own entry goes in with the pool itself; everyone else has to beat the first puck drop
  if b.creator_team <> new.team_id and _bet_underway(b.start_date) then
    raise exception 'Too late to join: this pool''s games have already started.';
  end if;
  return new;
end $$;
drop trigger if exists bet_entries_guard on public.bet_entries;
create trigger bet_entries_guard before insert on public.bet_entries for each row execute function public._bet_entries_guard();
revoke execute on function public._bets_guard(), public._bet_entries_guard() from public, anon, authenticated;
