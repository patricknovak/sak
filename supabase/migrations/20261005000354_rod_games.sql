-- Rod Hockey's games, kept (8 November 2026, Patrick: "build a rod hockey simulator game so that I can play rod hockey
-- against the computer or against other GMs in the same way as air hockey with standings and statistics").
--
-- The same shape as Rink Duel's (rink_games, migration 352), with shots in place of the rally: rod hockey is won on the
-- shots you get through, so each side's shots on goal are kept and the site works shooting and save percentages from
-- them. 'home' is the phone that records it: the challenger in a duel, the player in a game against the computer.
-- 'away' is the other member, or empty for the computer (then 'level' names which one). Own goals count for the other
-- side and are already in its score. Every total, trend and ranking is worked out on the phone from these rows.
-- Safe to run twice.

create table if not exists public.rod_games (
  id bigserial primary key,
  league_id int not null default current_league_id() references public.leagues(id),
  match_id text not null,
  home int not null references public.teams(id),
  away int references public.teams(id),
  level text check (level in ('beer', 'junior', 'pro', 'legend')),
  home_goals int not null check (home_goals between 0 and 9),
  away_goals int not null check (away_goals between 0 and 9),
  home_own int not null default 0 check (home_own >= 0),
  away_own int not null default 0 check (away_own >= 0),
  home_shots int not null default 0 check (home_shots between 0 and 300),   -- shots on goal, goals included
  away_shots int not null default 0 check (away_shots between 0 and 300),
  home_best int not null default 0 check (home_best between 0 and 400),     -- hardest goal, km/h
  away_best int not null default 0 check (away_best between 0 and 400),
  secs int not null default 0 check (secs between 0 and 7200),
  played_at timestamptz not null default now(),
  -- a duel against a member, or a game against the computer: never both, never neither
  check ((away is null) <> (level is null)),
  check (away is distinct from home),
  unique (league_id, match_id)
);
create index if not exists rod_games_league_played on public.rod_games (league_id, played_at desc);

alter table public.rod_games enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.rod_games'::regclass and polname = 'league_reads') then
    create policy league_reads on public.rod_games for select to authenticated using (league_id = (select current_league_id()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.rod_games'::regclass and tgname = 'rod_games_stamp_league') then
    create trigger rod_games_stamp_league before insert on public.rod_games for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.rod_games from anon;
grant select on public.rod_games to authenticated;

-- a finished game, from the phone that recorded it. The same match told twice (a retry) is kept once; a rematch is a
-- new match id. Only a finished game is taken: someone reached three (a game is first to five; three leaves room for a
-- shorter one later).
create or replace function public.rod_record(
  p_match text, p_away int, p_level text,
  p_home_goals int, p_away_goals int, p_home_own int default 0, p_away_own int default 0,
  p_home_shots int default 0, p_away_shots int default 0, p_home_best int default 0, p_away_best int default 0,
  p_secs int default 0
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
  if greatest(p_home_goals, p_away_goals) < 3 then raise exception 'Only a finished game counts'; end if;
  if p_home_own > p_away_goals or p_away_own > p_home_goals then raise exception 'More own goals than goals'; end if;
  insert into rod_games (league_id, match_id, home, away, level, home_goals, away_goals, home_own, away_own,
                         home_shots, away_shots, home_best, away_best, secs)
    values (current_league_id(), p_match, me, p_away, case when p_away is null then p_level end, p_home_goals, p_away_goals,
            p_home_own, p_away_own,
            -- a goal is a shot: never fewer shots than goals scored by the side's own stick
            least(greatest(p_home_shots, p_home_goals - p_away_own), 300), least(greatest(p_away_shots, p_away_goals - p_home_own), 300),
            least(p_home_best, 400), least(p_away_best, 400), least(p_secs, 7200))
    on conflict (league_id, match_id) do nothing
    returning id into rid;
  return rid;
end $$;
revoke execute on function public.rod_record(text, int, text, int, int, int, int, int, int, int, int, int) from public, anon;
grant execute on function public.rod_record(text, int, text, int, int, int, int, int, int, int, int, int) to authenticated;
