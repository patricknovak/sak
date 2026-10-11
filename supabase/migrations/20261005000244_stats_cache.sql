-- The players' season and windows, kept ready (E5's database half, the 11 October 2026 review, DEVELOPMENT.md §8.3).
--
-- player_windows (season, 30, 14 and 7 days) and player_season are aggregates over every game of the season under the
-- league's scoring. Every open page reads them, page by page, every few minutes on game nights, and each read summed the
-- whole season again (135 ms with a week of games; by the spring, twenty times the rows). Now each scoring profile's
-- answer is kept in a table, built once after the numbers move, and the two views read it while it is provably current:
-- built from the same points (a counter that every change to player_games or player_game_points moves on) and on the
-- same Eastern day (the windows end today). Any other time they work it out live, exactly as before, so a reader can
-- never see an old number: at worst a slower one.
--
-- The views keep their names and columns; nothing that reads them changes. refresh_stats_cache() rebuilds whatever is
-- out of date (nhl-sync calls it after each scores run and corrections run; a cron job every minute is the backstop).
--
-- Safe to run twice.

set client_min_messages = warning;

-- what moves the numbers: a counter, one row
create table if not exists public.stats_gen (one boolean primary key default true check (one), gen bigint not null default 0, at timestamptz not null default now());
insert into public.stats_gen (one) values (true) on conflict do nothing;
alter table public.stats_gen enable row level security;
revoke all on public.stats_gen from public, anon, authenticated;

create or replace function public._stats_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update stats_gen set gen = gen + 1, at = now() where one;
  return null;
end $$;
revoke execute on function public._stats_bump() from public, anon, authenticated;
drop trigger if exists player_games_stats_bump on public.player_games;
create trigger player_games_stats_bump after insert or update or delete or truncate on public.player_games
  for each statement execute function public._stats_bump();
drop trigger if exists player_game_points_stats_bump on public.player_game_points;
create trigger player_game_points_stats_bump after insert or update or delete or truncate on public.player_game_points
  for each statement execute function public._stats_bump();

-- the answers, per scoring profile, as the views give them
create table if not exists public.player_windows_cache (
  profile_id int not null, player_id int not null, win text not null, gp integer, fpts numeric, totals jsonb,
  primary key (profile_id, player_id, win));
create table if not exists public.player_season_cache (
  profile_id int not null, player_id int not null, gp bigint, fpts numeric, fpts14 numeric, totals jsonb, gp14 bigint,
  primary key (profile_id, player_id));
create table if not exists public.stats_cache_state (profile_id int primary key, gen bigint not null, day date not null, built_at timestamptz not null default now());
alter table public.player_windows_cache enable row level security;
alter table public.player_season_cache enable row level security;
alter table public.stats_cache_state enable row level security;
-- the same reach as the points they're made from (player_game_points: any signed-in reader)
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.player_windows_cache'::regclass and polname = 'read_all') then
    create policy read_all on public.player_windows_cache for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.player_season_cache'::regclass and polname = 'read_all') then
    create policy read_all on public.player_season_cache for select to authenticated using (true);
  end if;
end $$;
revoke all on public.player_windows_cache, public.player_season_cache, public.stats_cache_state from public, anon, authenticated;
grant select on public.player_windows_cache, public.player_season_cache to authenticated;

-- the live answers, as the views were (their text unchanged)
create or replace view public.player_windows_live with (security_invoker = true) as
WITH w(win, days) AS (
         VALUES ('season'::text,100000), ('30'::text,30), ('14'::text,14), ('7'::text,7)
        )
 SELECT pg.player_id,
    w.win,
    (count(*))::integer AS gp,
    round(sum(pg.fpts), 2) AS fpts,
    jsonb_strip_nulls(jsonb_build_object('g', sum(((pg.stats ->> 'g'::text))::numeric), 'a', sum(((pg.stats ->> 'a'::text))::numeric), 'pts', sum(((pg.stats ->> 'pts'::text))::numeric), 'pm', sum(((pg.stats ->> 'pm'::text))::numeric), 'pim', sum(((pg.stats ->> 'pim'::text))::numeric), 'ppg', sum(((pg.stats ->> 'ppg'::text))::numeric), 'ppa', sum(((pg.stats ->> 'ppa'::text))::numeric), 'ppp', sum(((pg.stats ->> 'ppp'::text))::numeric), 'shg', sum(((pg.stats ->> 'shg'::text))::numeric), 'sha', sum(((pg.stats ->> 'sha'::text))::numeric), 'shp', sum(((pg.stats ->> 'shp'::text))::numeric), 'gwg', sum(((pg.stats ->> 'gwg'::text))::numeric), 'sog', sum(((pg.stats ->> 'sog'::text))::numeric), 'fow', sum(((pg.stats ->> 'fow'::text))::numeric), 'fol', sum(((pg.stats ->> 'fol'::text))::numeric), 'hit', sum(((pg.stats ->> 'hit'::text))::numeric), 'blk', sum(((pg.stats ->> 'blk'::text))::numeric), 'gs', sum(((pg.stats ->> 'gs'::text))::numeric), 'w', sum(((pg.stats ->> 'w'::text))::numeric), 'l', sum(((pg.stats ->> 'l'::text))::numeric), 'otl', sum(((pg.stats ->> 'otl'::text))::numeric), 'ga', sum(((pg.stats ->> 'ga'::text))::numeric), 'sa', sum(((pg.stats ->> 'sa'::text))::numeric), 'sv', sum(((pg.stats ->> 'sv'::text))::numeric), 'sho', sum(((pg.stats ->> 'sho'::text))::numeric))) AS totals
   FROM (league_games pg
     CROSS JOIN w)
  WHERE (pg.date > (today_et() - w.days))
  GROUP BY pg.player_id, w.win;
create or replace view public.player_season_live with (security_invoker = true) as
SELECT pg.player_id,
    count(*) AS gp,
    round(sum(pg.fpts), 2) AS fpts,
    round(sum(pg.fpts) FILTER (WHERE (pg.date > (today_et() - 14))), 2) AS fpts14,
    jsonb_build_object('g', sum(((pg.stats ->> 'g'::text))::numeric), 'a', sum(((pg.stats ->> 'a'::text))::numeric), 'pm', sum(((pg.stats ->> 'pm'::text))::numeric), 'sog', sum(((pg.stats ->> 'sog'::text))::numeric), 'hit', sum(((pg.stats ->> 'hit'::text))::numeric), 'blk', sum(((pg.stats ->> 'blk'::text))::numeric), 'ppp', sum(((pg.stats ->> 'ppp'::text))::numeric), 'w', sum(((pg.stats ->> 'w'::text))::numeric), 'sv', sum(((pg.stats ->> 'sv'::text))::numeric), 'ga', sum(((pg.stats ->> 'ga'::text))::numeric), 'sho', sum(((pg.stats ->> 'sho'::text))::numeric)) AS totals,
    count(*) FILTER (WHERE (pg.date > (today_et() - 14))) AS gp14
   FROM league_games pg,
    league l
  GROUP BY pg.player_id;
revoke all on public.player_windows_live, public.player_season_live from public, anon;
grant select on public.player_windows_live, public.player_season_live to authenticated;

-- is a profile's kept answer current: the points it was built from are today's points, on today's date
create or replace function public._stats_fresh(p_profile int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from stats_cache_state s, stats_gen g where s.profile_id = p_profile and s.gen = g.gen and s.day = today_et())
$$;
revoke execute on function public._stats_fresh(int) from public, anon;
grant execute on function public._stats_fresh(int) to authenticated, service_role;

-- the views: the kept answer while it is current, the live one otherwise (one branch runs, the other is skipped)
create or replace view public.player_windows with (security_invoker = true) as
  select c.player_id, c.win, c.gp, c.fpts, c.totals from player_windows_cache c
  where c.profile_id = current_profile_id() and _stats_fresh(current_profile_id())
  union all
  select w.player_id, w.win, w.gp, w.fpts, w.totals from player_windows_live w where not _stats_fresh(current_profile_id());
create or replace view public.player_season with (security_invoker = true) as
  select c.player_id, c.gp, c.fpts, c.fpts14, c.totals, c.gp14 from player_season_cache c
  where c.profile_id = current_profile_id() and _stats_fresh(current_profile_id())
  union all
  select s.player_id, s.gp, s.fpts, s.fpts14, s.totals, s.gp14 from player_season_live s where not _stats_fresh(current_profile_id());

-- build one profile's answer from the live views, read as a league that scores with it; the counter is read first, so
-- a change made while it builds leaves it marked out of date
create or replace function public._stats_cache_build(p_profile int) returns void
language plpgsql security definer set search_path = public as $$
declare lid int; g bigint;
begin
  select lr.league_id into lid from league_rules lr where coalesce(lr.profile_id, 1) = p_profile order by lr.league_id limit 1;
  if lid is null then return; end if;
  select gen into g from stats_gen where one;
  perform set_config('app.league_id', lid::text, true);
  delete from player_windows_cache where profile_id = p_profile;
  insert into player_windows_cache (profile_id, player_id, win, gp, fpts, totals)
    select p_profile, player_id, win, gp, fpts, totals from player_windows_live;
  delete from player_season_cache where profile_id = p_profile;
  insert into player_season_cache (profile_id, player_id, gp, fpts, fpts14, totals, gp14)
    select p_profile, player_id, gp, fpts, fpts14, totals, gp14 from player_season_live;
  insert into stats_cache_state (profile_id, gen, day, built_at) values (p_profile, g, today_et(), now())
  on conflict (profile_id) do update set gen = excluded.gen, day = excluded.day, built_at = excluded.built_at;
end $$;
revoke execute on function public._stats_cache_build(int) from public, anon, authenticated;

-- rebuild every profile in use whose kept answer is out of date; a no-op when all are current
create or replace function public.refresh_stats_cache() returns int
language plpgsql security definer set search_path = public as $$
declare p int; n int := 0; was text := current_setting('app.league_id', true);
begin
  for p in select distinct coalesce(lr.profile_id, 1) from league_rules lr join leagues l on l.id = lr.league_id where l.status <> 'archived' loop
    if not _stats_fresh(p) then perform _stats_cache_build(p); n := n + 1; end if;
  end loop;
  perform set_config('app.league_id', coalesce(was, ''), true);
  return n;
end $$;
revoke execute on function public.refresh_stats_cache() from public, anon, authenticated;
grant execute on function public.refresh_stats_cache() to service_role;
