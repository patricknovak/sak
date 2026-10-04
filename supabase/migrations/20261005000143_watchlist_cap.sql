-- The watch list's 100-player cap (migration 142), tightened after review:
--
-- * counted within the team's league (the primary key leads with league_id, so the count uses it);
-- * one star at a time per team (a lock held to the end of the insert), so two phones starring at once can't reach 101;
-- * a player already on the list is left to the primary key, whose duplicate error the site reads as "already
--   starred", rather than reported as a full list.

set client_min_messages = warning;

create or replace function public._watchlist_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('watchlist'), new.team_id);
  if exists (select 1 from watchlist where league_id = new.league_id and team_id = new.team_id and player_id = new.player_id) then
    return new;
  end if;
  if (select count(*) from watchlist where league_id = new.league_id and team_id = new.team_id) >= 100 then
    raise exception 'Your watch list is full (100 players). Unstar someone first.';
  end if;
  return new;
end $$;
revoke execute on function public._watchlist_cap() from public, anon, authenticated;
