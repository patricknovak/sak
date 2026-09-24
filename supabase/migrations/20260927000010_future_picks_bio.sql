-- Tradable draft picks for this season and next, and a cache for player bios.

-- the season after '2026-27' is '2027-28'
create or replace function public._next_season(p text) returns text
language sql immutable as $$
  select (split_part(p, '-', 1)::int + 1)::text || '-' || lpad(((split_part(p, '-', 2)::int + 1) % 100)::text, 2, '0')
$$;

-- every team always owns (or has traded) its picks for this draft and next year's
create or replace function public.ensure_future_picks() returns void
language plpgsql security definer set search_path = public as $$
declare s text := (select season from league where id = 1);
begin
  perform _ensure_picks(s);
  perform _ensure_picks(_next_season(s));
end $$;
select public.ensure_future_picks();

-- keep them topped up when the commish changes rounds or the season rolls over
create or replace function public._league_picks_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform ensure_future_picks();
  return new;
end $$;
drop trigger if exists league_picks on public.league;
create trigger league_picks after update of season, draft_rounds on public.league
  for each row execute function public._league_picks_trigger();

-- NHL bio (birthplace, size, draft, awards...) cached alongside season history
alter table public.player_history add column if not exists bio jsonb;
revoke all on function public.ensure_future_picks() from public, anon, authenticated;
revoke all on function public._league_picks_trigger() from public, anon, authenticated;
