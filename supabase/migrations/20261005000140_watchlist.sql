-- The watch list (a GM's idea on the Features page, 28 September 2026: "add to watch list, similar to Yahoo"). A GM
-- stars players to keep an eye on: anyone, free agent or on another team. The Players page lists them, and when another
-- team drops a player a GM is watching, that GM hears about it (bell and phone) while he's there to be picked up.
--
-- * watchlist: one row per team and player, in the team's league. A GM reads and changes only their own team's rows.
-- * _watch_dropped(): after a drop is written to the transaction log, every other team in the league watching that
--   player gets a notification (kind 'watch').

set client_min_messages = warning;

create table if not exists public.watchlist (
  league_id int not null default public.current_league_id() references public.leagues (id),
  team_id int not null references public.teams (id) on delete cascade,
  player_id int not null references public.players (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (league_id, team_id, player_id)
);
create index if not exists watchlist_player on public.watchlist (league_id, player_id);
alter table public.watchlist enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.watchlist'::regclass and polname = 'own_team') then
    create policy own_team on public.watchlist for all to authenticated
      using (league_id = (select current_league_id()) and team_id = (select my_team()))
      with check (league_id = (select current_league_id()) and team_id = (select my_team()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.watchlist'::regclass and tgname = 'watchlist_stamp_league') then
    create trigger watchlist_stamp_league before insert on public.watchlist for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.watchlist from anon, authenticated;
grant select, insert, delete on public.watchlist to authenticated;

-- a watched player dropped: tell everyone else in his league who's watching him, while he's there for the taking
create or replace function public._watch_dropped() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'drop' or new.player_id is null then return new; end if;
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
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.transactions'::regclass and tgname = 'transactions_watch_dropped') then
    create trigger transactions_watch_dropped after insert on public.transactions for each row execute function public._watch_dropped();
  end if;
end $$;
