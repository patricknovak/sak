-- Review fixes 6 (the review of #164 to #166):
--
-- * log_pickup_call checked a named drop against the log but let a call leave it out (the dropped player's points never
--   counted against the pickup), and one pickup could be logged twice, with and without its drop. The drop is now the one
--   made with the add: add_player writes both in one transaction, so they share a moment, and a call must name exactly
--   that drop (or none, when there wasn't one).
-- * _watch_dropped told watchers a player was there to be picked up when he was dropped before the draft, while free
--   agency is still closed. It speaks only during the season now.
-- * The watch list: an index for the injury alert's lookup by player, and a list holds up to 100 players.

set client_min_messages = warning;

create or replace function public.log_pickup_call(p_add int, p_drop int, p_gain numeric, p_to date) returns boolean
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); t int := my_team(); r league_rules; upto date; cap numeric; made timestamptz; d int;
begin
  if t is null or p_add is null or p_gain is null then return false; end if;
  -- the GM's own pickup, just made: on their roster, and the add in the log minutes ago
  if not exists (select 1 from rosters where team_id = t and player_id = p_add and league_id = lid) then return false; end if;
  select created_at into made from transactions where league_id = lid and team_id = t and type = 'add' and player_id = p_add
    and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
  if made is null then return false; end if;
  -- the drop made with it (the same moment), or none
  select player_id into d from transactions where league_id = lid and team_id = t and type = 'drop' and created_at = made limit 1;
  if p_drop is distinct from d then return false; end if;
  select * into r from league_rules where league_id = lid;
  upto := least(coalesce(p_to, today_et() + 14), coalesce(r.season_end, today_et() + 200), today_et() + 200);
  if upto <= today_et() then return false; end if;
  cap := 30 * (upto - today_et() + 1);
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
  values (lid, 'pickup', jsonb_build_object('team_id', t, 'add', p_add, 'drop', d, 'from', today_et()),
          round(greatest(-cap, least(cap, p_gain)), 2), 'advisor', upto)
  on conflict (league_id, kind, subject) do nothing;
  return true;
end $$;
revoke execute on function public.log_pickup_call(int, int, numeric, date) from public, anon;
grant execute on function public.log_pickup_call(int, int, numeric, date) to authenticated;

-- a watched player dropped: tell everyone else in his league who's watching him, while he's there for the taking (in
-- the season: a drop before the draft goes back to the pool, not to free agency)
create or replace function public._watch_dropped() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'drop' or new.player_id is null then return new; end if;
  if not exists (select 1 from league_rules where league_id = new.league_id and phase = 'season') then return new; end if;
  insert into notifications (league_id, team_id, kind, body, link)
  select new.league_id, w.team_id, 'watch',
         format('%s is a free agent: %s dropped him. He''s on your watch list.', _pname(new.player_id), coalesce(_tname(new.team_id), 'a team')),
         '/player/' || new.player_id
  from watchlist w
  where w.league_id = new.league_id and w.player_id = new.player_id and w.team_id is distinct from new.team_id
    -- still unclaimed (a trade's drop can be followed at once by another add)
    and not exists (select 1 from rosters r where r.league_id = new.league_id and r.player_id = new.player_id);
  return new;
end $$;
revoke execute on function public._watch_dropped() from public, anon, authenticated;

-- the injury alert finds a player's watchers in every league at once
create index if not exists watchlist_by_player on public.watchlist (player_id);

-- a watch list is a short list: 100 players
create or replace function public._watchlist_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from watchlist where team_id = new.team_id) >= 100 then
    raise exception 'Your watch list is full (100 players). Unstar someone first.';
  end if;
  return new;
end $$;
revoke execute on function public._watchlist_cap() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.watchlist'::regclass and tgname = 'watchlist_cap') then
    create trigger watchlist_cap before insert on public.watchlist for each row execute function public._watchlist_cap();
  end if;
end $$;
