-- Game-day status (will he play tonight?) and airtight lineup locks.
--
-- player_status: one row per player per game day with something to know: a confirmed or probable starting
-- goalie, the backup, a game-time decision, out, or (once the game is on) scratched. Filled every 15 minutes by
-- nhl-sync?task=gameday from ESPN's probable goalies and injury report, and the box score.
create table if not exists public.player_status (
  player_id int not null references public.players(id) on delete cascade,
  date date not null,
  status text not null check (status in ('confirmed', 'expected', 'backup', 'gtd', 'out', 'scratched')),
  note text,
  opponent text,
  updated_at timestamptz not null default now(),
  primary key (player_id, date)
);
create index if not exists player_status_date_idx on public.player_status (date);
alter table public.player_status enable row level security;
revoke all on public.player_status from anon, authenticated;
grant select on public.player_status to authenticated;
grant all on public.player_status to service_role;
drop policy if exists read_all on public.player_status;
create policy read_all on public.player_status for select to authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.player_status; exception when others then null; end $$;

-- starting-goalie confirmations and scratches go on the player's timeline too
alter table public.player_events drop constraint if exists player_events_kind_check;
alter table public.player_events add constraint player_events_kind_check check (kind in ('team', 'injury', 'lineup'));

-- A player is locked from the moment his game starts: at the scheduled puck drop, or earlier if the game is
-- already under way, or once his lineup has been frozen for a game today, or once he's in a box score today
-- (which also covers a game-day trade the roster feed hasn't caught up with). Every lineup path checks this:
-- manual moves and swaps, "best lineup", saved daily lineups and the auto-pilot.
create or replace function public.player_locked(p_player int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g join players p on p.id = p_player and p.nhl_team in (g.home, g.away)
    where g.date = today_et() and g.state not in ('PPD','CNCL')
      and (g.start_utc <= now() or g.state in ('LIVE','CRIT','OFF','FINAL'))
  ) or exists (
    select 1 from lineup_snapshots s where s.player_id = p_player and s.date = today_et()
  ) or exists (
    select 1 from player_games pg where pg.player_id = p_player and pg.date = today_et()
  )
$$;
