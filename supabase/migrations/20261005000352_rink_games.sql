-- Rink Duel's games, kept (7 November 2026, Patrick: "show comprehensive statistics for all players who play the game
-- including cumulative goals and own goals and goals against and trends. Show ranking of players/GM based on
-- statistics."). Until now nothing about the game was stored; a phone kept only its own record against the computer.
--
-- One row a finished game, in the league it was played in. 'home' is the phone that records it: the challenger in a
-- duel (the member who sent the challenge, side 0 on the table), the player in a game against the computer. 'away' is
-- the other member, or empty for the computer (then 'level' names which one). Own goals are the ones a player put in
-- their own net: they count for the other side and are already in its score. The site works every total, trend and
-- ranking out from these rows.
-- Safe to run twice.

create table if not exists public.rink_games (
  id bigserial primary key,
  league_id int not null default current_league_id() references public.leagues(id),
  match_id text not null,
  home int not null references public.teams(id),
  away int references public.teams(id),
  level text check (level in ('beer', 'junior', 'pro', 'legend')),
  home_goals int not null check (home_goals between 0 and 8),
  away_goals int not null check (away_goals between 0 and 8),
  home_own int not null default 0 check (home_own >= 0),
  away_own int not null default 0 check (away_own >= 0),
  home_best int not null default 0 check (home_best between 0 and 400),   -- hardest goal, km/h
  away_best int not null default 0 check (away_best between 0 and 400),
  rally int not null default 0 check (rally between 0 and 999),           -- the longest rally in the game
  secs int not null default 0 check (secs between 0 and 7200),
  played_at timestamptz not null default now(),
  -- a duel against a member, or a game against the computer: never both, never neither
  check ((away is null) <> (level is null)),
  check (away is distinct from home),
  unique (league_id, match_id)
);
create index if not exists rink_games_league_played on public.rink_games (league_id, played_at desc);

alter table public.rink_games enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.rink_games'::regclass and polname = 'league_reads') then
    create policy league_reads on public.rink_games for select to authenticated using (league_id = (select current_league_id()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.rink_games'::regclass and tgname = 'rink_games_stamp_league') then
    create trigger rink_games_stamp_league before insert on public.rink_games for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.rink_games from anon;
grant select on public.rink_games to authenticated;

-- a finished game, from the phone that recorded it. The same match told twice (a retry) is kept once; a rematch is a
-- new match id. Only a finished game is taken: someone reached seven.
create or replace function public.rink_record(
  p_match text, p_away int, p_level text,
  p_home_goals int, p_away_goals int, p_home_own int default 0, p_away_own int default 0,
  p_home_best int default 0, p_away_best int default 0, p_rally int default 0, p_secs int default 0
) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := my_team(); rid bigint;
begin
  if me is null then raise exception 'Only a member of this league can record a game'; end if;
  if p_match is null or length(p_match) not between 4 and 40 then raise exception 'That game has no id'; end if;
  if p_away is not null then
    perform _in_league('teams', p_away);
    if not exists (select 1 from teams where id = p_away and league_id = current_league_id()) then
      raise exception 'That member isn''t in this league';
    end if;
  end if;
  if greatest(p_home_goals, p_away_goals) < 7 then raise exception 'Only a finished game counts'; end if;
  if p_home_own > p_away_goals or p_away_own > p_home_goals then raise exception 'More own goals than goals'; end if;
  insert into rink_games (league_id, match_id, home, away, level, home_goals, away_goals, home_own, away_own,
                          home_best, away_best, rally, secs)
    values (current_league_id(), p_match, me, p_away, case when p_away is null then p_level end, p_home_goals, p_away_goals,
            p_home_own, p_away_own, least(p_home_best, 400), least(p_away_best, 400), least(p_rally, 999), least(p_secs, 7200))
    on conflict (league_id, match_id) do nothing
    returning id into rid;
  return rid;
end $$;
revoke execute on function public.rink_record(text, int, text, int, int, int, int, int, int, int, int) from public, anon;
grant execute on function public.rink_record(text, int, text, int, int, int, int, int, int, int, int) to authenticated;
