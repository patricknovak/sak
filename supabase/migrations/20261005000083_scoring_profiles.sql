-- Super Pools B3: every league scores with its own weights.
--
-- Until now a game's fantasy points were stored once, on player_games.fpts, with SaK's weights, and the season
-- projection, last season's points and the overall rank were stored once on players. A second league with other
-- weights would have read SaK's numbers, and a second commissioner saving scoring would have re-scored SaK's season.
--
-- Now:
--   * scoring_profiles holds one row per distinct set of weights. Leagues with the same rules share a row. SaK's
--     weights are profile 1.
--   * league_rules.profile_id says which profile a league scores with. A trigger keeps it in step with
--     league_rules.scoring: saving new weights switches the league to the matching profile (a new one if nobody
--     has used those weights yet, scored over the whole season on the spot). It never rewrites another league's.
--   * player_game_points holds a game's points under every profile in use; player_values holds each profile's
--     projection, last-season points and rank.
--   * league_games and league_players are player_games and players with the caller's league's points and values
--     in place of SaK's. Every view and function that adds up points reads them.
--   * player_games.fpts and players.proj / last_fp / rank keep holding the model league's numbers, so anything
--     that still reads them directly (the site until it moves to the new views, the edge functions until the
--     league pass) sees exactly what it saw before.

set client_min_messages = warning;

-- the points one set of weights gives one stat line (goalie weights for a goalie's line, skater weights otherwise)
create or replace function public._score(p_scoring jsonb, p_stats jsonb) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(round(sum(w.value::numeric * coalesce((p_stats ->> w.key)::numeric, 0)), 2), 0)
  from jsonb_each_text(case when p_stats ? 'sv' or p_stats ? 'gs' then p_scoring -> 'goalie' else p_scoring -> 'skater' end) w
$$;

create table if not exists public.scoring_profiles (
  id serial primary key,
  hash text not null unique,                 -- md5 of the weights, so two leagues with the same rules share a row
  scoring jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.scoring_profiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.scoring_profiles'::regclass and polname = 'read_all') then
    create policy read_all on public.scoring_profiles for select to authenticated using (true);
  end if;
end $$;
revoke all on public.scoring_profiles from anon;
grant select on public.scoring_profiles to authenticated, service_role;

alter table public.league_rules add column if not exists profile_id int references public.scoring_profiles (id);

create table if not exists public.player_game_points (
  profile_id int not null references public.scoring_profiles (id),
  game_id bigint not null,
  player_id int not null,
  fpts numeric not null default 0,
  primary key (profile_id, game_id, player_id),
  foreign key (game_id, player_id) references public.player_games (game_id, player_id) on delete cascade
);
alter table public.player_game_points enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.player_game_points'::regclass and polname = 'read_all') then
    create policy read_all on public.player_game_points for select to authenticated using (true);
  end if;
end $$;
revoke all on public.player_game_points from anon;
grant select on public.player_game_points to authenticated, service_role;

create table if not exists public.player_values (
  profile_id int not null references public.scoring_profiles (id),
  player_id int not null references public.players (id) on delete cascade,
  proj numeric not null default 0,           -- the season projection in this profile's points
  last_fp numeric not null default 0,        -- last season's points under this profile's weights
  rank int,                                  -- overall rank by projection, then last season
  primary key (profile_id, player_id)
);
alter table public.player_values enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.player_values'::regclass and polname = 'read_all') then
    create policy read_all on public.player_values for select to authenticated using (true);
  end if;
end $$;
revoke all on public.player_values from anon;
grant select on public.player_values to authenticated, service_role;

-- the profile the caller's league scores with
create or replace function public.current_profile_id() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select profile_id from league_rules where league_id = current_league_id()), 1)
$$;

-- the model league's weights: what player_games.fpts and players.proj / last_fp / rank keep holding
create or replace function public._compat_scoring() returns jsonb
language sql stable security definer set search_path = public as $$
  select scoring from league_rules where league_id = 1
$$;

-- the caller's league's weights, as before
create or replace function public.calc_fpts(p_stats jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select _score(l.scoring, p_stats) from league l), 0)
$$;

-- one profile's projection, last-season points and rank for every player (the same sums the players table
-- has always held for SaK: the model's projection where there is one, last season's pace otherwise)
create or replace function public._player_values(p_profile int) returns void
language plpgsql security definer set search_path = public as $$
declare sc jsonb;
begin
  select scoring into sc from scoring_profiles where id = p_profile;
  if sc is null then return; end if;
  insert into player_values (profile_id, player_id, proj, last_fp)
  select p_profile, p.id,
    case
      when p.proj_stats is not null then _score(sc, p.proj_stats)
      when p.last_stats is null or coalesce((p.last_stats->>'gp')::numeric, 0) = 0 then 0
      else round(
        _score(sc, p.last_stats)
          / greatest(1, case when p.pos = 'G' then coalesce(nullif((p.last_stats->>'gs')::numeric, 0), (p.last_stats->>'gp')::numeric)
                             else (p.last_stats->>'gp')::numeric end)
          * (case when p.pos = 'G' then 58 else 78 end) * least((p.last_stats->>'gp')::numeric, 40) / 40
        + _score(sc, p.last_stats) * (1 - least((p.last_stats->>'gp')::numeric, 40) / 40), 2)
    end,
    case when p.last_stats is not null then _score(sc, p.last_stats) else 0 end
  from players p
  on conflict (profile_id, player_id) do update set proj = excluded.proj, last_fp = excluded.last_fp
    where player_values.proj is distinct from excluded.proj or player_values.last_fp is distinct from excluded.last_fp;
  with r as (select player_id, row_number() over (order by proj desc, last_fp desc, player_id) as rn from player_values where profile_id = p_profile)
  update player_values v set rank = r.rn from r
  where v.profile_id = p_profile and v.player_id = r.player_id and v.rank is distinct from r.rn;
end $$;

-- score every game this season under one profile, and its player values
create or replace function public._fill_profile(p_profile int) returns void
language plpgsql security definer set search_path = public as $$
declare sc jsonb;
begin
  select scoring into sc from scoring_profiles where id = p_profile;
  if sc is null then return; end if;
  insert into player_game_points (profile_id, game_id, player_id, fpts)
  select p_profile, pg.game_id, pg.player_id, _score(sc, pg.stats) from player_games pg
  on conflict (profile_id, game_id, player_id) do update set fpts = excluded.fpts
    where player_game_points.fpts is distinct from excluded.fpts;
  perform _player_values(p_profile);
end $$;

-- the profile for a set of weights, made the first time anyone uses them
create or replace function public._profile_for(p_scoring jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pid int;
begin
  if p_scoring is null then return null; end if;
  insert into scoring_profiles (hash, scoring) values (md5(p_scoring::text), p_scoring) on conflict (hash) do nothing;
  select id into pid from scoring_profiles where hash = md5(p_scoring::text);
  return pid;
end $$;

revoke execute on function public._player_values(int), public._fill_profile(int), public._profile_for(jsonb)
  from public, anon, authenticated;

-- a league's rules row always points at the profile for its weights; switching profile scores the season under
-- it (a profile nobody else uses may be stale, so it is always brought up to date)
create or replace function public._league_rules_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.profile_id := _profile_for(new.scoring);
  if new.profile_id is not null and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id) then
    perform _fill_profile(new.profile_id);
  end if;
  return new;
end $$;

-- SaK's weights become profile 1, then every league gets its profile
insert into public.scoring_profiles (hash, scoring)
select md5(scoring::text), scoring from public.league_rules where league_id = 1 and scoring is not null
on conflict (hash) do nothing;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.league_rules'::regclass and tgname = 'league_rules_profile') then
    create trigger league_rules_profile before insert or update of scoring on public.league_rules
      for each row execute function public._league_rules_profile();
  end if;
end $$;
update public.league_rules set scoring = scoring where profile_id is null;

-- every new or corrected stat line is scored under every profile a league uses
create or replace function public._player_game_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.stats is not distinct from old.stats then return null; end if;
  insert into player_game_points (profile_id, game_id, player_id, fpts)
  select sp.id, new.game_id, new.player_id, _score(sp.scoring, new.stats)
  from scoring_profiles sp where sp.id in (select profile_id from league_rules)
  on conflict (profile_id, game_id, player_id) do update set fpts = excluded.fpts
    where player_game_points.fpts is distinct from excluded.fpts;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.player_games'::regclass and tgname = 'player_games_points') then
    create trigger player_games_points after insert or update of stats on public.player_games
      for each row execute function public._player_game_points();
  end if;
end $$;

-- player_games.fpts: the model league's points, as before
create or replace function public._player_games_fpts() returns trigger
language plpgsql set search_path = public as $$
begin
  new.fpts := coalesce(public._score(public._compat_scoring(), new.stats), 0);
  new.updated_at := now();
  return new;
end $$;

-- a correction is logged when it changes the points in any league, not only SaK's
create or replace function public._log_correction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from games g where g.id = new.game_id and g.final_synced)
     and exists (select 1 from scoring_profiles sp where sp.id in (select profile_id from league_rules)
                 and _score(sp.scoring, new.stats) <> _score(sp.scoring, old.stats)) then
    insert into stat_corrections (game_id, player_id, date, old_stats, new_stats, old_fpts, new_fpts)
    values (new.game_id, new.player_id, new.date, old.stats, new.stats, old.fpts, new.fpts);
  end if;
  return new;
end $$;

-- the caller's league's view of the shared NHL data
create or replace view public.league_games with (security_invoker = true) as
  select pg.game_id, pg.player_id, pg.date, pg.nhl_team, pg.stats, coalesce(pp.fpts, 0::numeric) as fpts, pg.updated_at
  from player_games pg
  left join player_game_points pp on pp.game_id = pg.game_id and pp.player_id = pg.player_id and pp.profile_id = (select current_profile_id());
revoke all on public.league_games from anon;
grant select on public.league_games to authenticated, service_role;

create or replace view public.league_players with (security_invoker = true) as
  select p.id, p.name, p.first, p.last_name, p.pos, p.elig, p.nhl_team, p.num, p.birth, p.shoots, p.headshot,
    coalesce(v.last_fp, 0::numeric) as last_fp, p.last_stats, coalesce(v.proj, 0::numeric) as proj, v.rank,
    p.status, p.injury_note, p.updated_at, p.injury_status, p.injury_date, p.proj_stats, p.proj_gp, p.proj_meta
  from players p
  left join player_values v on v.player_id = p.id and v.profile_id = (select current_profile_id());
revoke all on public.league_players from anon;
grant select on public.league_players to authenticated, service_role;

create or replace view public.league_corrections with (security_invoker = true) as
  select c.id, c.game_id, c.player_id, c.date, c.old_stats, c.new_stats,
    _score(sp.scoring, c.old_stats) as old_fpts, _score(sp.scoring, c.new_stats) as new_fpts, c.notified, c.created_at
  from stat_corrections c
  join scoring_profiles sp on sp.id = (select current_profile_id())
  where _score(sp.scoring, c.old_stats) <> _score(sp.scoring, c.new_stats);
revoke all on public.league_corrections from anon;
grant select on public.league_corrections to authenticated, service_role;

-- the views that add up points read the caller's league's points
create or replace view public.player_season with (security_invoker = true) as
  select pg.player_id, count(*) as gp, round(sum(pg.fpts), 2) as fpts,
    round(sum(pg.fpts) filter (where pg.date > today_et() - 14), 2) as fpts14,
    jsonb_build_object(
      'g', sum((stats->>'g')::numeric), 'a', sum((stats->>'a')::numeric), 'pm', sum((stats->>'pm')::numeric),
      'sog', sum((stats->>'sog')::numeric), 'hit', sum((stats->>'hit')::numeric), 'blk', sum((stats->>'blk')::numeric),
      'ppp', sum((stats->>'ppp')::numeric), 'w', sum((stats->>'w')::numeric), 'sv', sum((stats->>'sv')::numeric),
      'ga', sum((stats->>'ga')::numeric), 'sho', sum((stats->>'sho')::numeric)) as totals,
    count(*) filter (where pg.date > today_et() - 14) as gp14
  from league_games pg, league l
  group by pg.player_id;

create or replace view public.player_windows with (security_invoker = true) as
  with w(win, days) as (values ('season', 100000), ('30', 30), ('14', 14), ('7', 7))
  select pg.player_id, w.win, count(*)::int as gp, round(sum(pg.fpts), 2) as fpts,
    jsonb_strip_nulls(jsonb_build_object(
      'g', sum((stats->>'g')::numeric), 'a', sum((stats->>'a')::numeric), 'pts', sum((stats->>'pts')::numeric),
      'pm', sum((stats->>'pm')::numeric), 'pim', sum((stats->>'pim')::numeric),
      'ppg', sum((stats->>'ppg')::numeric), 'ppa', sum((stats->>'ppa')::numeric), 'ppp', sum((stats->>'ppp')::numeric),
      'shg', sum((stats->>'shg')::numeric), 'sha', sum((stats->>'sha')::numeric), 'shp', sum((stats->>'shp')::numeric),
      'gwg', sum((stats->>'gwg')::numeric), 'sog', sum((stats->>'sog')::numeric),
      'fow', sum((stats->>'fow')::numeric), 'fol', sum((stats->>'fol')::numeric),
      'hit', sum((stats->>'hit')::numeric), 'blk', sum((stats->>'blk')::numeric),
      'gs', sum((stats->>'gs')::numeric), 'w', sum((stats->>'w')::numeric), 'l', sum((stats->>'l')::numeric),
      'otl', sum((stats->>'otl')::numeric), 'ga', sum((stats->>'ga')::numeric), 'sa', sum((stats->>'sa')::numeric),
      'sv', sum((stats->>'sv')::numeric), 'sho', sum((stats->>'sho')::numeric))) as totals
  from league_games pg cross join w
  where pg.date > today_et() - w.days
  group by pg.player_id, w.win;

create or replace view public.team_daily_all with (security_invoker = true) as
  select s.team_id, s.date, g.game_type, round(sum(pg.fpts), 2) as points, count(*) as games
  from lineup_snapshots s
  join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join games g on g.id = s.game_id
  cross join league l
  where s.slot not in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.date, g.game_type;

create or replace view public.team_bench_daily with (security_invoker = true) as
  select s.team_id, s.date, round(sum(pg.fpts), 2) as points, count(*) as games, g.game_type
  from lineup_snapshots s
  join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join games g on g.id = s.game_id
  cross join league l
  where s.slot in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.date, g.game_type;

-- every profile in use gets its player values; the players table keeps the model league's
create or replace function public.recompute_player_values() returns void
language plpgsql security definer set search_path = public as $$
declare pid int;
begin
  for pid in select distinct profile_id from league_rules where profile_id is not null loop
    perform _player_values(pid);
  end loop;
  update players p set last_fp = v.last_fp, proj = v.proj, rank = v.rank
  from player_values v
  where v.profile_id = (select profile_id from league_rules where league_id = 1) and v.player_id = p.id
    and (p.last_fp, p.proj, p.rank) is distinct from (v.last_fp, v.proj, v.rank);
end $$;

-- saving scoring switches the caller's league to the profile for the new weights; no other league moves
create or replace function public.commish_update_scoring(p_scoring jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform _commish();
  if coalesce(jsonb_typeof(p_scoring -> 'skater'), '') <> 'object' or coalesce(jsonb_typeof(p_scoring -> 'goalie'), '') <> 'object' then
    raise exception 'Scoring needs skater and goalie sections';
  end if;
  for k in select key from jsonb_each(p_scoring -> 'skater') union all select key from jsonb_each(p_scoring -> 'goalie') loop
    if k !~ '^[a-z]+$' then raise exception 'Bad stat key %', k; end if;
  end loop;
  update league_rules set scoring = p_scoring, updated_at = now() where league_id = current_league_id();
  update player_games set fpts = _score(_compat_scoring(), stats) where fpts is distinct from _score(_compat_scoring(), stats);
  perform recompute_player_values();
  perform _sys('general', '📐 The commissioner updated the scoring settings. Every game this season has been re-scored and the rankings recalculated.');
end $$;

create or replace function public.rescore_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  perform _fill_profile(current_profile_id());
  update player_games set fpts = _score(_compat_scoring(), stats) where fpts is distinct from _score(_compat_scoring(), stats);
  perform recompute_player_values();
end $$;

-- a stat correction tells each GM what it did to their total, in their own league's points
create or replace function public.notify_corrections() returns integer
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in
    select s.team_id,
      round(sum(x.d), 2) as delta,
      string_agg(format('%s %s%s (%s, %s)', (select name from players where id = c.player_id), case when x.d >= 0 then '+' else '' end,
        round(x.d, 2), _stat_diff(c.old_stats, c.new_stats), to_char(c.date, 'Mon DD')), '; ' order by c.id) as what
    from stat_corrections c
    join lineup_snapshots s on s.game_id = c.game_id and s.player_id = c.player_id and s.slot not in ('BN', 'IR')
    join league_rules lr on lr.league_id = s.league_id
    join scoring_profiles sp on sp.id = lr.profile_id
    cross join lateral (select _score(sp.scoring, c.new_stats) - _score(sp.scoring, c.old_stats) as d) x
    where not c.notified and x.d <> 0
    group by s.team_id
  loop
    perform _notify(t.team_id, 'correction', format('📝 Stat correction%s: %s. Your total %s%s.',
      case when position(';' in t.what) > 0 then 's' else '' end, t.what, case when t.delta >= 0 then '+' else '' end, t.delta), '/standings');
    n := n + 1;
  end loop;
  update stat_corrections set notified = true where not notified;
  return n;
end $$;

-- The rest read points or projections through the caller's league's views. Each is the current version with
-- player_games read as league_games and players (where the projection is used) as league_players.

CREATE OR REPLACE FUNCTION public._auto_lineup(p_team integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  cap jsonb := '{}';
  sl text;
  placed boolean;
begin
  perform take_snapshots();
  for sl in select unnest(array['C','LW','RW','D','Util','G']) loop
    cap := cap || jsonb_build_object(sl, _cap(sl) - (
      select count(*) from rosters r where r.team_id = p_team and r.slot = sl and player_locked(r.player_id)));
  end loop;

  update rosters r set slot = 'BN'
  where r.team_id = p_team and r.slot not in ('IR', 'BN') and not player_locked(r.player_id);

  for c in
    select r.player_id, p.pos, p.elig,
      exists (select 1 from games g where g.date = today_et() and p.nhl_team in (g.home, g.away)
              and g.state not in ('PPD','CNCL')) as plays,
      coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp * 80 end, p.proj, 0) as val
    from rosters r join league_players p on p.id = r.player_id
    left join player_season ps on ps.player_id = r.player_id
    where r.team_id = p_team and r.slot = 'BN' and not player_locked(r.player_id)
    order by plays desc, val desc
  loop
    placed := false;
    if c.pos = 'G' then
      if (cap ->> 'G')::int > 0 then
        update rosters set slot = 'G' where player_id = c.player_id and team_id = p_team;
        cap := jsonb_set(cap, '{G}', to_jsonb((cap ->> 'G')::int - 1));
      end if;
      continue;
    end if;
    foreach sl in array c.elig loop
      if sl in ('C','LW','RW','D') and (cap ->> sl)::int > 0 then
        update rosters set slot = sl where player_id = c.player_id and team_id = p_team;
        cap := jsonb_set(cap, array[sl], to_jsonb((cap ->> sl)::int - 1));
        placed := true;
        exit;
      end if;
    end loop;
    if not placed and (cap ->> 'Util')::int > 0 then
      update rosters set slot = 'Util' where player_id = c.player_id and team_id = p_team;
      cap := jsonb_set(cap, '{Util}', to_jsonb((cap ->> 'Util')::int - 1));
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public._autopick_player(p_team integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with have as (select p.pos, count(*) n from rosters r join league_players p on p.id = r.player_id where r.team_id = p_team group by p.pos),
  lim(pos, mx, target) as (values ('C', 7, 4), ('LW', 7, 4), ('RW', 7, 4), ('D', 9, 6), ('G', 4, 3))
  select coalesce(
    (select q.player_id from draft_queue q where q.team_id = p_team
       and not exists (select 1 from rosters r where r.player_id = q.player_id and r.league_id = _league_of(p_team)) order by q.pos, q.player_id limit 1),
    (select p.id from league_players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team))
         and coalesce(have.n, 0) < lim.mx
         and coalesce(p.injury_status, '') !~* '^(out|ir\b|injured|suspen|long)'
       order by case when coalesce(have.n, 0) < lim.target then 0 else 1 end, p.proj desc, p.last_fp desc limit 1),
    (select p.id from league_players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team)) and coalesce(have.n, 0) < lim.mx
       order by p.proj desc, p.last_fp desc limit 1))
$function$;

CREATE OR REPLACE FUNCTION public._live_options(m markets)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g games; s jsonb := m.subject; opts jsonb := m.options; f numeric; oh numeric; oa numeric; ph numeric; lh numeric; la numeric; share numeric;
  hs int; aw int; i int; j int; w numeric; p_home numeric := 0; p_away numeric := 0; p_ot numeric := 0; p_over numeric := 0; line numeric;
  sofar numeric; mean numeric; sd numeric; per_game numeric; probs jsonb; d_from date; d_to date; stat text; ids int[]; rows jsonb; tot numeric; sumw numeric;
  pts jsonb; clubs text[]; keyp text;
begin
  if m.status <> 'open' then return opts; end if;

  -- tonight's markets: only while the game is on
  if m.kind in ('winner', 'total', 'ot', 'prop') then
    if m.game_id is null then return opts; end if;
    select * into g from games where id = m.game_id;
    if g.id is null or g.state not in ('LIVE', 'CRIT') then return opts; end if;
    f := _minutes_left(g) / 60;
    hs := coalesce(g.home_score, 0); aw := coalesce(g.away_score, 0);
    if m.kind = 'prop' then
      line := coalesce((s->>'line')::numeric, 0);
      select coalesce(sum(pg.fpts), 0) into sofar from league_games pg where pg.game_id = g.id and pg.player_id = (s->>'player_id')::int;
      per_game := greatest(0.5, _player_rate((s->>'player_id')::int, 'fpts'));
      mean := sofar + f * per_game; sd := sqrt(greatest(0.0001, f * greatest(0.6, per_game * 1.4)));
      p_over := case when f <= 0.001 then (case when sofar > line then 1 else 0 end) else 1 - _phi((line - mean) / sd) end;
      probs := jsonb_build_object('over', p_over, 'under', 1 - p_over);
    else
      -- the pre-game moneyline sets each side's scoring rate (the total and overtime markets borrow the moneyline on the same game)
      select (o->>'odds')::numeric into oh from markets mm, jsonb_array_elements(mm.options) o where mm.game_id = m.game_id and mm.kind = 'winner' and o->>'key' = 'home' order by mm.id limit 1;
      select (o->>'odds')::numeric into oa from markets mm, jsonb_array_elements(mm.options) o where mm.game_id = m.game_id and mm.kind = 'winner' and o->>'key' = 'away' order by mm.id limit 1;
      oh := coalesce(oh, 1.9); oa := coalesce(oa, 1.9);
      ph := (1 / oh) / (1 / oh + 1 / oa);
      lh := 3.05 * (1 + (ph - 0.5) * 0.9); la := 3.05 * (1 - (ph - 0.5) * 0.9);
      share := lh / (lh + la);
      line := coalesce((s->>'line')::numeric, 6.5);
      if upper(coalesce(g.period, '')) like '%OT%' or upper(coalesce(g.period, '')) like '%SO%' then
        p_ot := 1; p_home := share; p_away := 1 - share; p_over := case when hs + aw + 1 > line then 1 else 0 end;
      else
        for i in 0..12 loop
          for j in 0..12 loop
            w := _poisson(lh * f, i) * _poisson(la * f, j);
            if hs + i > aw + j then p_home := p_home + w;
            elsif aw + j > hs + i then p_away := p_away + w;
            else p_ot := p_ot + w; p_home := p_home + w * share; p_away := p_away + w * (1 - share); end if;
            if hs + i + aw + j + (case when hs + i = aw + j then 1 else 0 end) > line then p_over := p_over + w; end if;
          end loop;
        end loop;
      end if;
      probs := jsonb_build_object('home', p_home, 'away', p_away, 'yes', p_ot, 'no', 1 - p_ot, 'over', p_over, 'under', 1 - p_over);
    end if;
    return (select jsonb_agg(o || jsonb_build_object('odds', _odds_live((probs->>(o->>'key'))::numeric)) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
  end if;

  -- the season futures: re-priced from the standings on read
  if m.kind = 'future' then return coalesce(_future_options(s->>'what'), opts); end if;

  -- requested races: what's in the book so far plus what's left
  if m.kind = 'race' then
    stat := s->>'stat';
    if s->>'template' = 'player_race' and s ? 'group' then return _race_field_options(m); end if;
    if s->>'template' in ('player_race', 'player_line') then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      if s->>'template' = 'player_line' then ids := array[(s->>'player_id')::int]; else select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e; end if;
      select jsonb_agg(jsonb_build_object('id', pl.id, 'sofar', _race_sofar(pl.id, stat, d_from, d_to),
        'left', _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to))) into rows from players pl where pl.id = any(ids);
      select avg(r."left") into mean from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
      sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));
      if s->>'template' = 'player_race' then
        select max(r.sofar + r."left") into tot from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        select sum(exp((r.sofar + r."left" - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        select jsonb_object_agg('p' || r.id, exp((r.sofar + r."left" - tot) / sd) / sumw) into probs from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        return (select jsonb_agg(o || jsonb_build_object('odds', _odds_long(round((probs->>(o->>'key'))::numeric, 4))) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
      else
        select r.sofar + r."left" into mean from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        line := (s->>'line')::numeric;
        p_over := least(0.97, greatest(0.03, 1 - _phi((line - mean) / sd)));
        return jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(p_over)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - p_over)));
      end if;
    elsif s->>'template' = 'club_race' and s->>'what' = 'points' then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      select array_agg(e) into clubs from jsonb_array_elements_text(s->'clubs') e;
      select jsonb_agg(jsonb_build_object('abbrev', c, 'x', _club_points_in(c, d_from, d_to) + 2 * _club_rating(c) * _club_games_left(c, d_from, d_to), 'left', _club_games_left(c, d_from, d_to))) into rows from unnest(clubs) c;
      select avg(r."left"), max(r.x) into mean, tot from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      sd := greatest(0.75, 0.95 * sqrt(greatest(1, mean)));
      select sum(exp((r.x - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      select jsonb_object_agg('c' || r.abbrev, exp((r.x - tot) / sd) / sumw) into probs from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      return (select jsonb_agg(o || jsonb_build_object('odds', _odds_long(round((probs->>(o->>'key'))::numeric, 4))) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
    else
      -- season-long club races, the playoff yes/no and a club's season points: the same pricing as a fresh request
      begin
        pts := preview_market(jsonb_build_object('template', s->>'template', 'what', s->>'what', 'clubs', s->'clubs', 'club', s->>'club', 'line', s->>'line'));
        return coalesce(pts->'options', opts);
      exception when others then return opts; end;
    end if;
  end if;

  return opts;
end $function$;

CREATE OR REPLACE FUNCTION public._player_rate(p_player integer, p_stat text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with p as (select * from league_players where id = p_player), s as (select * from player_season where player_id = p_player),
  ls as (select case p_stat when 'fpts' then 'fp' else p_stat end as k)
  select round(coalesce(
    case when (select gp from s) >= 5 then
      case p_stat when 'fpts' then (select fpts / gp from s)
                  when 'pts' then (select ((totals->>'g')::numeric + (totals->>'a')::numeric) / gp from s)
                  else (select (totals->>p_stat)::numeric / gp from s) end end,
    case p_stat when 'fpts' then (select nullif(proj, 0) / coalesce(nullif(proj_gp, 0), 82) from p)
                else (select (proj_stats->>p_stat)::numeric / coalesce(nullif(proj_gp, 0), 82) from p) end,
    (select (last_stats->>(select k from ls))::numeric / nullif((last_stats->>'gp')::numeric, 0) from p),
    0), 3)
$function$;

CREATE OR REPLACE FUNCTION public._race_sofar(p_player integer, p_stat text, p_from date, p_to date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(case p_stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>p_stat)::numeric end), 0)
  from league_games pg where pg.player_id = p_player and pg.date between p_from and p_to
$function$;

CREATE OR REPLACE FUNCTION public._season_ratings()
 RETURNS TABLE(team_id integer, points numeric, proj numeric, rating numeric, remaining numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with l as (select season_start, season_end from league),
  rem as (select case when l.season_start is null or l.season_end is null or l.season_end <= l.season_start then 1
                      else greatest(0, least(1, (l.season_end - greatest(today_et(), l.season_start))::numeric / (l.season_end - l.season_start))) end as remaining from l),
  tm as (select id from teams where role = 'gm' and league_id = current_league_id()),
  pr as (select r.team_id, sum(p.proj) as proj from rosters r join tm on tm.id = r.team_id join league_players p on p.id = r.player_id where r.slot not in ('BN', 'IR') group by r.team_id)
  select tm.id, coalesce(s.points, 0)::numeric, coalesce(pr.proj, 0)::numeric,
         round(coalesce(s.points, 0) + coalesce(pr.proj, 0) * rem.remaining, 1), rem.remaining
  from tm cross join rem left join standings s on s.team_id = tm.id left join pr on pr.team_id = tm.id
$function$;

CREATE OR REPLACE FUNCTION public._stat_sum(p_player integer, p_stat text, p_start date, p_end date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(case when p_stat = 'fpts' then fpts else coalesce((stats->>p_stat)::numeric, 0) end), 0)
  from league_games where player_id = p_player and date >= coalesce(p_start, date) and date <= coalesce(p_end, date)
$function$;

CREATE OR REPLACE FUNCTION public.apply_lineup_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t int; d date := today_et(); moved int; total int := 0; s text; over int;
begin
  for t in select distinct lp.team_id from lineup_plans lp
    where lp.date = d and not exists (select 1 from lineup_plan_applied a where a.team_id = lp.team_id and a.date = d) loop
    with target as (
      select r.player_id, r.slot as cur,
        case
          when player_locked(r.player_id) or r.slot = 'IR' then r.slot
          when lp.slot is null or lp.slot = 'IR' then 'BN'
          when not slot_ok(pl.elig, pl.pos, lp.slot) then 'BN'
          else lp.slot end as slot
      from rosters r join league_players pl on pl.id = r.player_id
      left join lineup_plans lp on lp.team_id = r.team_id and lp.date = d and lp.player_id = r.player_id
      where r.team_id = t
    )
    update rosters r set slot = target.slot from target
    where r.player_id = target.player_id and r.team_id = t and r.slot is distinct from target.slot;
    get diagnostics moved = row_count;
    for s in select unnest(array['C','LW','RW','D','Util','G']) loop
      select count(*) - _cap(s) into over from rosters where team_id = t and slot = s;
      if over > 0 then
        update rosters set slot = 'BN' where team_id = t and player_id in (
          select r.player_id from rosters r join league_players pl on pl.id = r.player_id
          where r.team_id = t and r.slot = s and not player_locked(r.player_id) order by pl.proj asc limit over);
      end if;
    end loop;
    insert into lineup_plan_applied (team_id, date, moves) values (t, d, moved) on conflict do nothing;
    update teams set lineup_touched = d where id = t;
    total := total + 1;
  end loop;
  delete from lineup_plans where date < d - 7;
  delete from lineup_plan_applied where date < d - 30;
  return total;
end $function$;

CREATE OR REPLACE FUNCTION public.book_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare out jsonb := '[]'::jsonb; x record; lid int := current_league_id(); d_to date; today date := today_et(); ids int[]; out_clubs text[]; nm text; season_end date := _nhl_season_end();
begin
  -- the rest of this month, or next month once there's under ten days left in this one
  d_to := (date_trunc('month', today) + interval '1 month - 1 day')::date;
  if d_to - today < 10 then d_to := (date_trunc('month', today) + interval '2 month - 1 day')::date; end if;
  d_to := least(d_to, season_end);

  -- marquee games in the next week: the two strongest clubs, with the league's own players in them
  for x in
    select * from (
      select g.id, g.away, g.home, g.date, g.start_utc, _club_rating(g.home) + _club_rating(g.away) as strength,
        (select count(*) from rosters r join league_players p on p.id = r.player_id where r.league_id = lid and r.slot not in ('IR') and p.nhl_team in (g.home, g.away)) as ours
      from games g
      where g.date > today and g.date <= today + 7 and g.game_type = 2 and g.state in ('FUT', 'PRE') and g.start_utc > now()
        and not exists (select 1 from markets m where m.game_id = g.id and m.status = 'open' and m.league_id = lid)) q
    order by q.strength + 0.02 * q.ours desc, q.start_utc limit 3
  loop
    out := out || jsonb_build_array(jsonb_build_object('template', 'game', 'bet', 'winner', 'game_id', x.id, 'label', format('%s @ %s · %s', x.away, x.home, to_char(x.date, 'FMDy Mon FMDD')),
      'why', format('Two of the strongest clubs%s', case when x.ours > 0 then format(', with %s of the league''s players on the ice', x.ours) else '' end), 'group', 'games'));
  end loop;

  -- the league's best skaters, one per GM team, racing on goals this month; and the best goalies on wins
  with best as (
    select distinct on (r.team_id) p.id, p.proj, coalesce(p.last_name, p.name) as short from rosters r join league_players p on p.id = r.player_id
    where r.league_id = lid and r.slot not in ('IR', 'BN') and p.pos <> 'G' and p.injury_status is null and p.proj > 0 order by r.team_id, p.proj desc),
  top4 as (select * from best order by proj desc limit 4)
  select array_agg(id), string_agg(short, ' vs ' order by proj desc) into ids, nm from top4;
  if array_length(ids, 1) >= 2 then
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'g', 'players', to_jsonb(ids), 'from', today, 'to', d_to, 'label', format('%s: most goals %s', nm, _window_label(today, d_to)),
      'why', 'The league''s biggest guns, each on a different GM''s roster', 'group', 'players'));
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'fpts', 'players', to_jsonb(ids), 'from', today, 'to', season_end, 'label', format('%s: most fantasy points the rest of the way', nm),
      'why', 'The long race between the league''s best', 'group', 'players'));
  end if;
  with best as (
    select distinct on (r.team_id) p.id, p.proj, coalesce(p.last_name, p.name) as short from rosters r join league_players p on p.id = r.player_id
    where r.league_id = lid and r.slot not in ('IR', 'BN') and p.pos = 'G' and p.injury_status is null and p.proj > 0 order by r.team_id, p.proj desc),
  top3 as (select * from best order by proj desc limit 3)
  select array_agg(id), string_agg(short, ' vs ' order by proj desc) into ids, nm from top3;
  if array_length(ids, 1) >= 2 then
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'w', 'players', to_jsonb(ids), 'from', today, 'to', d_to, 'label', format('%s: most wins %s', nm, _window_label(today, d_to)),
      'why', 'The league''s starting goalies', 'group', 'players'));
  end if;

  -- the NHL: the tightest division at the top, the club on the playoff bubble, the Presidents' Trophy and the Cup
  if exists (select 1 from nhl_teams where proj_pts is not null) then
    for x in
      select division, array_agg(abbrev order by proj_pts desc) as clubs, max(proj_pts) - (array_agg(proj_pts order by proj_pts desc))[2] as gap
      from nhl_teams where proj_pts is not null group by division order by gap, division limit 1
    loop
      out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'division', 'clubs', to_jsonb(x.clubs[1:4]),
        'label', format('The %s: %s', case x.division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else x.division end, array_to_string(x.clubs[1:4], ' vs ')),
        'why', format('The tightest division: %s points between first and second in the projections', round(x.gap)), 'group', 'nhl'));
    end loop;
    for x in select abbrev, name, playoff_odds from nhl_teams where playoff_odds is not null order by abs(playoff_odds - 0.5), abbrev limit 1 loop
      out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'playoffs', 'clubs', jsonb_build_array(x.abbrev), 'label', format('%s: make the playoffs?', x.name),
        'why', format('The bubble: %s%% to get in', round(x.playoff_odds * 100)), 'group', 'nhl'));
    end loop;
    select array_agg(abbrev order by proj_pts desc) into out_clubs from (select abbrev, proj_pts from nhl_teams order by proj_pts desc nulls last limit 4) t;
    out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'president', 'clubs', to_jsonb(out_clubs), 'label', format('Presidents'' Trophy: %s', array_to_string(out_clubs, ' vs ')), 'why', 'The four best clubs in the projections, or the field', 'group', 'nhl'));
    select array_agg(abbrev order by strength desc) into out_clubs from (select abbrev, strength from nhl_teams order by strength desc nulls last limit 4) t;
    out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'cup', 'clubs', to_jsonb(out_clubs), 'label', format('Stanley Cup: %s', array_to_string(out_clubs, ' vs ')), 'why', 'The four strongest clubs, or the field', 'group', 'nhl'));
  end if;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.open_markets(p_date date DEFAULT today_et())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; n int := 0; fh numeric; fa numeric; ph numeric; pr record; line numeric; first_start timestamptz; ngames int := 0;
begin
  for g in select * from games where date = p_date and start_utc > now() and state not in ('PPD', 'CNCL')
             and not exists (select 1 from markets m where m.game_id = games.id and m.created_by is null) order by start_utc loop
    ngames := ngames + 1;
    first_start := coalesce(first_start, g.start_utc);
    fh := _club_form(g.home); fa := _club_form(g.away);
    ph := least(0.75, greatest(0.25, 0.54 + coalesce(fh - fa, 0) * 0.6));
    if not exists (select 1 from markets where game_id = g.id and kind = 'winner' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('winner', format('%s @ %s: who wins?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph))), g.start_utc);
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'total' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('total', format('%s @ %s: total goals', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away, 'line', 6.5),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9)), g.start_utc);
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'ot' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('ot', format('%s @ %s: goes to overtime?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28)), g.start_utc);
      n := n + 1;
    end if;
    -- SaK-points over/under on the two best SaK-rostered skaters in the game
    for pr in
      select p.id, p.name, r.team_id, coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp end, p.proj / 82.0, 0) as avg
      from league_players p join rosters r on r.player_id = p.id and r.league_id = coalesce(current_league_id(), 1) left join player_season ps on ps.player_id = p.id
      where p.nhl_team in (g.home, g.away) and p.pos <> 'G' and p.injury_status is null
      order by avg desc limit 2
    loop
      line := floor(pr.avg * 2) / 2;                       -- to the half point, always ending in .5 so there's no push
      if line = floor(line) then line := line + 0.5; end if;
      line := round(greatest(0.5, line), 1);
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('prop', format('%s: SaK points tonight', pr.name), g.id, p_date, jsonb_build_object('player_id', pr.id, 'stat', 'fpts', 'line', line, 'owner', pr.team_id),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), g.start_utc);
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then
    perform _sys('general', format('📖 Garry''s Book is open: %s game%s %s, %s markets. Moneylines, totals, overtime and player props, St. Patrick coins only. First puck drop %s ET. 👉 #/bets?t=book',
      ngames, case when ngames = 1 then '' else 's' end, case when p_date = today_et() then 'tonight' else 'on ' || to_char(p_date, 'FMDay FMMonth FMDD') end, n, to_char(first_start at time zone 'America/Toronto', 'FMHH:MI am')), jsonb_build_object('book', p_date));
  end if;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.open_season_markets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l league; b jsonb; n int := 0; closes timestamptz; what text; t record; pr record; line numeric; booby text; trophy text;
begin
  select * into l from league;
  if l.id is null or l.phase <> 'season' or l.season_start is null or l.season_end is null then return 0; end if;
  if exists (select 1 from markets where kind = 'future' and subject->>'season' = l.season and league_id = current_league_id()) then return 0; end if;
  closes := coalesce(l.trade_deadline, (l.season_end - 30)::timestamptz);
  if closes <= now() then return 0; end if;
  select brand into b from leagues where id = current_league_id();
  booby := coalesce(b->>'booby', 'the booby prize'); trophy := coalesce(b->>'trophy', 'the Cup');
  foreach what in array array['johnson', 'peter', 'playoffs', 'cup'] loop
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('future',
      case what when 'johnson' then 'Regular season champion' when 'peter' then format('Last place: who holds %s?', booby)
                when 'playoffs' then 'Playoff Cup winner' else format('%s: the full-year winner', trophy) end,
      today_et(), jsonb_build_object('what', what, 'season', l.season), _future_options(what), closes, current_league_id());
    n := n + 1;
  end loop;
  -- every team's season points, over or under what the Book projects
  for t in select r.*, tm.name from _season_ratings() r join teams tm on tm.id = r.team_id order by r.rating desc loop
    line := floor(t.rating) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: season points', t.name), today_et(),
      jsonb_build_object('scope', 'team', 'team_id', t.team_id, 'stat', 'fpts', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  -- the biggest names: season fantasy points, and goals for the snipers (over or under last season's count)
  for pr in select id, name, proj from league_players where pos <> 'G' and proj > 0 order by proj desc limit 8 loop
    line := floor(pr.proj) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: season fantasy points', pr.name), today_et(),
      jsonb_build_object('scope', 'player', 'player_id', pr.id, 'stat', 'fpts', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  for pr in select id, name, (last_stats->>'g')::numeric as g from league_players
            where pos <> 'G' and last_stats ? 'g' and coalesce((last_stats->>'gp')::int, 0) >= 60 and (last_stats->>'g')::numeric >= 30
            order by (last_stats->>'g')::numeric desc limit 4 loop
    line := floor(pr.g) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: goals this season', pr.name), today_et(),
      jsonb_build_object('scope', 'player', 'player_id', pr.id, 'stat', 'g', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  perform _sys('general', format('🔮 The Book, season edition: futures on the champion, %s, the Playoff Cup and %s, plus season-long props on every team and the biggest names. Odds move with the standings; your ticket keeps the odds you took. Open until %s. 👉 #/bets?t=book',
    booby, trophy, to_char(closes at time zone 'America/Toronto', 'FMMonth FMDD')), jsonb_build_object('book', 'season'));
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.performance_days(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(team_id integer, date date, game_type integer, points numeric, bench numeric, goalie_points numeric, starters integer, benched integer, stats jsonb, bench_stats jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.date, g.game_type, s.slot not in ('BN', 'IR') as starter, s.slot = 'G' as goalie, pg.fpts, pg.stats
    from lineup_snapshots s
    join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  ),
  k as (
    select team_id, date, game_type, starter, e.key, sum(e.value::numeric) as v
    from s, jsonb_each_text(s.stats) e
    where e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1, 2, 3, 4, 5
  ),
  kk as (
    select team_id, date, game_type, starter, jsonb_object_agg(key, v) as stats
    from k group by 1, 2, 3, 4
  )
  select s.team_id, s.date, s.game_type,
         round(coalesce(sum(s.fpts) filter (where s.starter), 0), 2) as points,
         round(coalesce(sum(s.fpts) filter (where not s.starter), 0), 2) as bench,
         round(coalesce(sum(s.fpts) filter (where s.starter and s.goalie), 0), 2) as goalie_points,
         count(*) filter (where s.starter)::int as starters,
         count(*) filter (where not s.starter)::int as benched,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.date = s.date and kk.game_type = s.game_type and kk.starter), '{}'::jsonb) as stats,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.date = s.date and kk.game_type = s.game_type and not kk.starter), '{}'::jsonb) as bench_stats
  from s
  group by s.team_id, s.date, s.game_type
  order by s.date, s.team_id;
$function$;

CREATE OR REPLACE FUNCTION public.performance_players(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_team integer DEFAULT NULL::integer)
 RETURNS TABLE(team_id integer, player_id integer, started integer, benched integer, points numeric, bench numeric, stats jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with l as (select season_start from league),
  s as (
    select s.team_id, s.player_id, s.slot not in ('BN', 'IR') as starter, pg.fpts, pg.stats
    from lineup_snapshots s
    join league_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join l
    where (p_team is null or s.team_id = p_team)
      and g.game_type = 2
      and s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  ),
  k as (
    select team_id, player_id, e.key, sum(e.value::numeric) as v
    from s, jsonb_each_text(s.stats) e
    where s.starter and e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by 1, 2, 3
  ),
  kk as (select team_id, player_id, jsonb_object_agg(key, v) as stats from k group by 1, 2)
  select s.team_id, s.player_id,
         count(*) filter (where s.starter)::int as started,
         count(*) filter (where not s.starter)::int as benched,
         round(coalesce(sum(s.fpts) filter (where s.starter), 0), 2) as points,
         round(coalesce(sum(s.fpts) filter (where not s.starter), 0), 2) as bench,
         coalesce((select stats from kk where kk.team_id = s.team_id and kk.player_id = s.player_id), '{}'::jsonb) as stats
  from s
  group by s.team_id, s.player_id
  order by points desc;
$function$;

CREATE OR REPLACE FUNCTION public.preview_market(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tpl text := p->>'template'; stat text := coalesce(p->>'stat', 'fpts'); what text := p->>'what';
  d_from date; d_to date; g games; r numeric; ph numeric; line numeric; mean numeric; sd numeric; sigma numeric;
  ids int[]; clubs text[]; grp text[]; names text; n int; mkind text := 'race'; title text; subject jsonb; options jsonb; closes timestamptz; note text; m_date date;
  first timestamptz; nt record; tot numeric; sumw numeric; wfield numeric; k text; lbl text; rows jsonb; grp_ids int[]; season_end date := _nhl_season_end();
begin
  if stat not in ('fpts', 'g', 'a', 'pts', 'sog', 'hit', 'blk', 'ppp', 'w', 'sv', 'sho') then raise exception 'Pick a stat the Book keeps'; end if;

  if tpl = 'game' then
    if coalesce(p->>'bet', 'winner') not in ('winner', 'total', 'ot') then raise exception 'Moneyline, total or overtime'; end if;
    mkind := coalesce(p->>'bet', 'winner');
    select * into g from games where id = nullif(p->>'game_id', '')::bigint;
    if g.id is null then raise exception 'Pick a game from the schedule'; end if;
    if g.start_utc <= now() or g.state not in ('FUT', 'PRE') then raise exception 'That game has started'; end if;
    if g.date <= today_et() then raise exception 'Tonight''s games get their markets from the Book at 9:35 ET; ask for one later in the week'; end if;
    if exists (select 1 from markets where game_id = g.id and markets.kind = mkind and status = 'open' and league_id = current_league_id()) then raise exception 'That market is already on the board'; end if;
    ph := least(0.75, greatest(0.25, 0.54 + (_club_rating(g.home) - _club_rating(g.away)) * 0.6));
    m_date := g.date; closes := g.start_utc;
    subject := jsonb_build_object('home', g.home, 'away', g.away, 'template', 'game');
    if mkind = 'winner' then
      title := format('%s @ %s: who wins? (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      options := jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph)));
      note := format('%s is %s%% to win on form and home ice. Settled from the final score.', g.home, round(ph * 100));
    elsif mkind = 'total' then
      title := format('%s @ %s: total goals (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      subject := subject || jsonb_build_object('line', 6.5);
      options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9));
      note := 'Both clubs'' goals, overtime and the shootout goal included. Settled from the final score.';
    else
      title := format('%s @ %s: goes to overtime? (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      options := jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28));
      note := 'Settled from the final score.';
    end if;
    return jsonb_build_object('kind', mkind, 'title', title, 'game_id', g.id, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  -- windows: from today (or later) to a day the season still covers
  d_from := coalesce(nullif(p->>'from', '')::date, today_et()); d_to := coalesce(nullif(p->>'to', '')::date, season_end);
  if d_from < today_et() and not coalesce((p->>'whole_season')::boolean, false) then d_from := today_et(); end if;
  if d_from > season_end then raise exception 'The regular season is over by then'; end if;
  if d_to > season_end then d_to := season_end; end if;
  if d_to < d_from then raise exception 'The window ends before it starts'; end if;
  m_date := d_from;

  if tpl in ('player_race', 'player_line') then
    if tpl = 'player_line' then ids := array[nullif(p->>'player_id', '')::int]; else select array_agg(distinct v::int) into ids from jsonb_array_elements_text(coalesce(p->'players', '[]'::jsonb)) v; end if;
    if ids is null or array_length(ids, 1) < (case when tpl = 'player_line' then 1 when coalesce((p->>'field')::boolean, false) then 1 else 2 end) then raise exception 'Pick % players', case when tpl = 'player_line' then 'a player' when coalesce((p->>'field')::boolean, false) then 'a player, or up to eight' else 'two to eight' end; end if;
    if array_length(ids, 1) > 8 then raise exception 'Eight players at most'; end if;
    if (select count(*) from league_players where id = any(ids)) < array_length(ids, 1) then raise exception 'Unknown player'; end if;
    if (select count(distinct pos = 'G') from league_players where id = any(ids)) > 1 then raise exception 'Skaters race skaters and goalies race goalies'; end if;
    if (select bool_or(pos = 'G') from league_players where id = any(ids)) and stat not in ('fpts', 'w', 'sv', 'sho') then raise exception 'Goalies race on fantasy points, wins, saves or shutouts'; end if;
    if (select bool_or(pos <> 'G') from league_players where id = any(ids)) and stat in ('w', 'sv', 'sho') then raise exception 'That''s a goalie stat'; end if;
    -- the field: the rest of the top 30 at that stat (skaters, goalies, or one position), by projection
    if tpl = 'player_race' and coalesce((p->>'field')::boolean, false) then
      select array_agg(id) into grp_ids from (
        select pl.id from league_players pl
        where pl.status = 'active' and pl.proj_stats is not null
          and case coalesce(p->>'pos', '') when 'G' then pl.pos = 'G' when 'D' then pl.pos = 'D' when 'F' then pl.pos in ('C', 'LW', 'RW') else pl.pos <> 'G' end
        order by case stat when 'fpts' then pl.proj else (pl.proj_stats->>stat)::numeric end desc nulls last limit 30) t;
      grp_ids := (select array_agg(distinct x) from unnest(grp_ids || ids) x);
    end if;
    select array_agg(distinct nhl_team) into clubs from league_players where id = any(coalesce(grp_ids, ids)) and nhl_team is not null;
    first := case when clubs is null then null else _first_start(clubs, d_from, d_to) end;
    if first is null then raise exception 'No games left in that window'; end if;
    -- tickets stop at the first game of the race, but a race starting tonight still takes tickets for 48 hours
    closes := greatest(first, now() + interval '48 hours');
    closes := least(closes, (d_to + 1)::timestamp at time zone 'America/Toronto');
    -- each player's expected total: his rate × his club's games left
    select jsonb_agg(jsonb_build_object('id', pl.id, 'short', coalesce(pl.last_name, pl.name), 'gl', _club_games_left(pl.nhl_team, d_from, d_to),
      'left', round(_player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2),
      'mean', round(_race_sofar(pl.id, stat, d_from, d_to) + _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2), 'picked', pl.id = any(ids))) into rows from league_players pl where pl.id = any(coalesce(grp_ids, ids));
    if grp_ids is null and exists (select 1 from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean) where gl = 0 and picked) then
      raise exception '% has no games left in that window', (select short from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric) where gl = 0 limit 1);
    end if;
    select avg(r."left"), max(r.mean) into mean, tot from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
    sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));   -- the spread is on what's still to play
    if tpl = 'player_race' then
      -- a softmax over expected totals, spread by how much the stat swings over the window
      select sum(exp((r.mean - tot) / sd)), coalesce(sum(exp((r.mean - tot) / sd)) filter (where not r.picked), 0) into sumw, wfield from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
      select jsonb_agg(jsonb_build_object('key', 'p' || r.id, 'label', r.short, 'odds', _odds_long(round(exp((r.mean - tot) / sd) / sumw, 4))) order by r.mean desc, r.id),
             string_agg(r.short, ' vs ' order by r.mean desc, r.id),
             string_agg(format('%s %s', r.short, round(r.mean, 1)), ', ' order by r.mean desc, r.id),
             jsonb_object_agg(r.id, round(r.mean, 1))
        into options, names, lbl, subject from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean) where r.picked;
      if grp_ids is not null then options := options || jsonb_build_array(jsonb_build_object('key', 'field', 'label', 'The field', 'odds', _odds_long(round(wfield / sumw, 4)))); end if;
      title := coalesce(nullif(p->>'title', ''), format('%s: most %s %s%s', names, _stat_label(stat), _window_label(d_from, d_to), case when grp_ids is not null then ' (or the field)' else '' end));
      subject := jsonb_build_object('template', tpl, 'players', to_jsonb(ids), 'stat', stat, 'from', d_from, 'to', d_to, 'settle', 'auto', 'means', subject)
        || case when grp_ids is not null then jsonb_build_object('group', to_jsonb(grp_ids), 'pos', coalesce(p->>'pos', 'S')) else '{}'::jsonb end;
      note := format('Expected: %s. Counted from the box scores %s; %s. The price moves with the box scores; a ticket keeps the price it was bought at.', lbl, _window_label(d_from, d_to),
        case when grp_ids is not null then 'the field is everyone else in the league; a tie at the top goes to the NHL tiebreaker, settled by the commish' else 'a tie refunds everyone' end);
    else
      select r.mean, r.short, r.gl into mean, names, n from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
      line := coalesce(nullif(p->>'line', '')::numeric, floor(mean) + 0.5);
      if line <> floor(line) + 0.5 then line := floor(line) + 0.5; end if;      -- always a half, so there's no push
      if line < 0.5 then line := 0.5; end if;
      ph := least(0.95, greatest(0.05, 1 - _phi((line - mean) / sd)));
      title := format('%s: %s %s', names, _stat_label(stat), _window_label(d_from, d_to));
      options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(ph)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - ph)));
      subject := jsonb_build_object('template', tpl, 'player_id', ids[1], 'stat', stat, 'line', line, 'from', d_from, 'to', d_to, 'settle', 'auto', 'mean', round(mean, 1));
      note := format('The Book expects %s over %s games. Counted from the box scores; refunded if he never dresses in the window. The price moves with the box scores; a ticket keeps the price it was bought at.', round(mean, 1), n);
    end if;
    return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  if tpl = 'club_race' then
    if what not in ('points', 'division', 'conference', 'president', 'cup', 'playoffs') then raise exception 'Pick a race'; end if;
    select array_agg(distinct upper(v)) into clubs from jsonb_array_elements_text(coalesce(p->'clubs', '[]'::jsonb)) v;
    if clubs is null or array_length(clubs, 1) < (case when what = 'points' then 2 else 1 end) then raise exception 'Pick % clubs', case when what = 'points' then 'two to eight' else 'a club, or up to eight' end; end if;
    if array_length(clubs, 1) > 8 then raise exception 'Eight clubs at most'; end if;
    if not exists (select 1 from nhl_teams) and what <> 'points' then raise exception 'The standings aren''t in yet; ask for a points race over a window instead'; end if;
    if exists (select 1 from nhl_teams) and (select count(*) from nhl_teams where abbrev = any(clubs)) < array_length(clubs, 1) then raise exception 'Unknown club'; end if;
    if what = 'points' then
      -- most standings points over the window, from the schedule: 2 × points % × games left
      first := _first_start(clubs, d_from, d_to);
      if first is null then raise exception 'No games left in that window'; end if;
      closes := least(greatest(first, now() + interval '48 hours'), (d_to + 1)::timestamp at time zone 'America/Toronto');
      select jsonb_agg(jsonb_build_object('abbrev', c, 'gl', _club_games_left(c, d_from, d_to), 'x', round(_club_points_in(c, d_from, d_to) + 2 * _club_rating(c) * _club_games_left(c, d_from, d_to), 2))) into rows from unnest(clubs) c;
      if exists (select 1 from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric) where gl = 0) then
        raise exception '% has no games left in that window', (select abbrev from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric) where gl = 0 limit 1);
      end if;
      select avg(gl), max(x) into mean, tot from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric);
      sd := greatest(0.75, 0.95 * sqrt(greatest(1, mean)));   -- the spread is on the games still to play
      select sum(exp((x - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(abbrev text, x numeric);
      select jsonb_agg(jsonb_build_object('key', 'c' || abbrev, 'label', abbrev, 'odds', _odds_long(round(exp((x - tot) / sd) / sumw, 4))) order by x desc, abbrev),
             string_agg(format('%s %s', abbrev, round(x, 1)), ', ' order by x desc)
        into options, lbl from jsonb_to_recordset(rows) as r(abbrev text, x numeric);
      title := format('%s: most points %s', array_to_string(clubs, ' vs '), _window_label(d_from, d_to));
      note := format('Expected: %s. Standings points (2 a win, 1 an overtime or shootout loss) over the window, from the schedule; a tie refunds everyone.', lbl);
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'from', d_from, 'to', d_to, 'settle', 'auto');
      return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    elsif what = 'playoffs' then
      closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
      select least(0.97, greatest(0.03, coalesce(playoff_odds, 0.5))) into ph from nhl_teams where abbrev = clubs[1];
      title := format('%s: make the playoffs?', _club_label(clubs[1]));
      options := jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'In', 'odds', _odds(ph)), jsonb_build_object('key', 'no', 'label', 'Out', 'odds', _odds(1 - ph)));
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'settle', 'auto');
      note := format('The standings model has them %s%% to get in. Settled when the bracket is set.', round(ph * 100));
      return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    else
      -- a season-long race: everyone in the group runs, the clubs not picked are "the field"
      closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
      if what = 'division' then
        if (select count(distinct division) from nhl_teams where abbrev = any(clubs)) > 1 then raise exception 'A division race needs clubs from one division'; end if;
        select array_agg(abbrev) into grp from nhl_teams where division = (select division from nhl_teams where abbrev = clubs[1]);
        title := format('%s: first in the %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, (select case division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else division || ' Division' end from nhl_teams where abbrev = clubs[1]));
      elsif what = 'conference' then
        if (select count(distinct conf) from nhl_teams where abbrev = any(clubs)) > 1 then raise exception 'A conference race needs clubs from one conference'; end if;
        select array_agg(abbrev) into grp from nhl_teams where conf = (select conf from nhl_teams where abbrev = clubs[1]);
        title := format('%s: first in the %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, (select case conf when 'E' then 'East' when 'W' then 'West' else conf end from nhl_teams where abbrev = clubs[1]));
      else
        select array_agg(abbrev) into grp from nhl_teams;
        title := format('%s: %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, case when what = 'cup' then 'the Stanley Cup' else 'the Presidents'' Trophy' end);
      end if;
      if what = 'cup' then
        -- in the playoffs and strong once there
        select jsonb_agg(jsonb_build_object('abbrev', abbrev, 'picked', abbrev = any(clubs), 'x', greatest(0.01, coalesce(playoff_odds, 0.5)) * exp(12 * (coalesce(strength, 0.5) - 0.5)))) into rows from nhl_teams where abbrev = any(grp);
        note := 'Priced from each club''s playoff odds and strength. Settled by the commish when the Cup is handed over.';
      else
        -- final points: banked plus 2 × strength × games left, a softmax that tightens as the games run out
        select avg(_club_games_left(abbrev, today_et(), season_end)) into mean from nhl_teams where abbrev = any(grp);
        sigma := greatest(1, 0.95 * sqrt(greatest(1, mean)));
        select max(pts + 2 * coalesce(strength, 0.5) * _club_games_left(abbrev, today_et(), season_end)) into tot from nhl_teams where abbrev = any(grp);
        select jsonb_agg(jsonb_build_object('abbrev', abbrev, 'picked', abbrev = any(clubs), 'x', exp((pts + 2 * coalesce(strength, 0.5) * _club_games_left(abbrev, today_et(), season_end) - tot) / sigma))) into rows from nhl_teams where abbrev = any(grp);
        note := 'Final regular-season points, from the standings when the 82 are played. A tie at the top goes to the NHL tiebreakers, settled by the commish.';
      end if;
      select sum(x), coalesce(sum(x) filter (where not picked), 0) into sumw, wfield from jsonb_to_recordset(rows) as r(abbrev text, picked boolean, x numeric);
      select jsonb_agg(jsonb_build_object('key', 'c' || abbrev, 'label', abbrev, 'odds', _odds_long(round(x / sumw, 4))) order by x desc, abbrev) into options from jsonb_to_recordset(rows) as r(abbrev text, picked boolean, x numeric) where picked;
      if wfield > 0 then options := options || jsonb_build_array(jsonb_build_object('key', 'field', 'label', 'The field', 'odds', _odds_long(round(wfield / sumw, 4)))); end if;
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'group', to_jsonb(grp), 'settle', case when what = 'cup' then 'commish' else 'auto' end);
      return jsonb_build_object('kind', mkind, 'title', coalesce(nullif(p->>'title', ''), title), 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    end if;
  end if;

  if tpl = 'club_line' then
    k := upper(coalesce(p->>'club', ''));
    select * into nt from nhl_teams where abbrev = k;
    if nt.abbrev is null then raise exception 'Pick a club'; end if;
    n := _club_games_left(k, today_et(), season_end);
    if n = 0 then raise exception 'They have played their 82'; end if;
    mean := nt.pts + 2 * coalesce(nt.strength, 0.5) * n;
    sd := greatest(1, 0.95 * sqrt(n));
    line := coalesce(nullif(p->>'line', '')::numeric, floor(mean) + 0.5);
    if line <> floor(line) + 0.5 then line := floor(line) + 0.5; end if;
    ph := 1 - _phi((line - mean) / sd);
    closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
    title := format('%s: season points', nt.name);
    options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(ph)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - ph)));
    subject := jsonb_build_object('template', tpl, 'club', k, 'line', line, 'settle', 'auto', 'mean', round(mean, 1));
    note := format('%s banked, %s games left, the Book projects %s. Settled from the standings when the 82 are played.', nt.pts, n, round(mean, 1));
    return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  raise exception 'Pick a template';
end $function$;

CREATE OR REPLACE FUNCTION public.settle_markets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; g games; w text; res jsonb; n int := 0; v int := 0; pg record; summary text;
begin
  for m in select * from markets where status = 'open' and closes_at < now() and kind <> 'custom' loop
    select * into g from games where id = m.game_id;
    if g.id is null then continue; end if;
    if g.state in ('PPD', 'CNCL') then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    if g.state not in ('OFF', 'FINAL') or g.home_score is null then continue; end if;
    w := null; res := jsonb_build_object('home', g.home_score, 'away', g.away_score, 'period', g.period);
    if m.kind = 'winner' then
      w := case when g.home_score > g.away_score then 'home' when g.away_score > g.home_score then 'away' end;
    elsif m.kind = 'total' then
      w := case when g.home_score + g.away_score > (m.subject->>'line')::numeric then 'over' else 'under' end;
    elsif m.kind = 'ot' then
      w := case when g.period in ('OT', 'SO') then 'yes' else 'no' end;
    elsif m.kind = 'prop' then
      if not g.final_synced then continue; end if;   -- wait for the box score
      select * into pg from league_games where game_id = g.id and player_id = (m.subject->>'player_id')::int;
      if pg.player_id is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;   -- never dressed: void
      res := res || jsonb_build_object('value', pg.fpts);
      w := case when pg.fpts > (m.subject->>'line')::numeric then 'over' else 'under' end;
    end if;
    if w is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    update markets set result = res where id = m.id;
    perform _payout_market(m.id, w);
    n := n + 1;
  end loop;
  -- one chat line per batch: who's up and who's down
  if n > 0 then
    select string_agg(format('%s %s%s', _tname(team_id), case when net >= 0 then '+' else '' end, net), ' · ' order by net desc) into summary
    from (select b.team_id, sum(coalesce(b.payout, 0) - b.coins)::int as net from market_bets b join markets mk on mk.id = b.market_id
          where mk.settled_at > now() - interval '2 minutes' group by b.team_id) x;
    if summary is not null then perform _sys('general', format('📖 Book settled %s market%s: %s 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end, summary), jsonb_build_object('book', 'settle')); end if;
  end if;
  return jsonb_build_object('settled', n, 'void', v);
end $function$;

CREATE OR REPLACE FUNCTION public.settle_race_markets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m markets; s jsonb; d_from date; d_to date; w text; val numeric; n int := 0; ids int[]; clubs text[]; grp text[]; top record; second record; stat text; alive int;
begin
  for m in select * from markets where status = 'open' and kind = 'race' and closes_at < now() and league_id = current_league_id() order by id loop
    s := m.subject; w := null; val := null;
    if s->>'template' in ('player_race', 'player_line', 'club_race') and s ? 'to' then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      if d_to >= today_et() then continue; end if;                                             -- the window is still running
      -- every game in the window final and, for players, in the box scores
      if exists (select 1 from games where date between d_from and d_to and game_type = 2 and (state not in ('OFF', 'FINAL', 'PPD', 'CNCL') or (state in ('OFF', 'FINAL') and not final_synced))) then continue; end if;
    end if;
    stat := s->>'stat';
    if s->>'template' = 'player_race' and s ? 'group' then
      -- against the field: the league-wide leader at the stat over the window (one position, goalies, or every skater)
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into top from league_games pg join league_players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last limit 1;
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into second from league_games pg join league_players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last offset 1 limit 1;
      if top.player_id is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- no box scores at all: refund
      if second.v is not null and second.v = top.v then continue; end if;                                -- the NHL tiebreakers: the commish settles
      update markets set result = jsonb_build_object('winner', top.player_id, 'value', top.v) where id = m.id;
      w := case when _market_option_odds(m, 'p' || top.player_id) is not null then 'p' || top.player_id else 'field' end;
    elsif s->>'template' = 'player_race' then
      select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e;
      with tot as (
        select i as player_id, coalesce((select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end)
                                        from league_games pg where pg.player_id = i and pg.date between d_from and d_to), 0) as v
        from unnest(ids) i)
      select jsonb_object_agg(player_id, v) into s from tot;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- a tie refunds everyone
      w := 'p' || top.key;
    elsif s->>'template' = 'player_line' then
      select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) into val
      from league_games pg where pg.player_id = (s->>'player_id')::int and pg.date between d_from and d_to;
      if val is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;    -- never dressed: refund
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    elsif s->>'template' = 'club_race' and s->>'what' = 'points' then
      select array_agg(e) into clubs from jsonb_array_elements_text(s->'clubs') e;
      with pts as (
        select c, coalesce((select sum(case when (g.home = c and g.home_score > g.away_score) or (g.away = c and g.away_score > g.home_score) then 2 when g.period in ('OT', 'SO') then 1 else 0 end)
                            from games g where c in (g.home, g.away) and g.date between d_from and d_to and g.game_type = 2 and g.state in ('OFF', 'FINAL') and g.home_score is not null), 0) as v
        from unnest(clubs) c)
      select jsonb_object_agg(c, v) into s from pts;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;
      w := 'c' || top.key;
    elsif s->>'template' = 'club_race' and s->>'what' in ('division', 'conference', 'president') then
      select array_agg(e) into grp from jsonb_array_elements_text(s->'group') e;
      if (select bool_and(gp >= 82) from nhl_teams where abbrev = any(grp)) is not true then continue; end if;
      select abbrev, pts into top from nhl_teams where abbrev = any(grp) order by pts desc limit 1;
      select abbrev, pts into second from nhl_teams where abbrev = any(grp) order by pts desc offset 1 limit 1;
      if second.pts = top.pts then continue; end if;                                          -- the NHL tiebreakers: the commish settles
      w := case when _market_option_odds(m, 'c' || top.abbrev) is not null then 'c' || top.abbrev else 'field' end;
      update markets set result = jsonb_build_object('winner', top.abbrev, 'value', top.pts) where id = m.id;
    elsif s->>'template' = 'club_race' and s->>'what' = 'playoffs' then
      select count(*) into alive from nhl_teams where po_status = 'alive';
      if alive <> 16 then continue; end if;                                                   -- the bracket isn't set
      w := case when exists (select 1 from nhl_teams where abbrev = s->'clubs'->>0 and po_status = 'alive') then 'yes' else 'no' end;
    elsif s->>'template' = 'club_line' then
      select pts into val from nhl_teams where abbrev = s->>'club' and gp >= 82;
      if val is null then continue; end if;
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    else
      continue;                                                                               -- the Cup: the commish
    end if;
    if w is not null then perform _payout_market(m.id, w); n := n + 1; end if;
  end loop;
  if n > 0 then perform _sys('general', format('🏁 The Book settled %s requested market%s. 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end), jsonb_build_object('book', 'race-settle')); end if;
  return n;
end $function$;
