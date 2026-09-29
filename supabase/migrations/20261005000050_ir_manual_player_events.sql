-- 1. IR is manual. A GM moves a player onto IR (injured, not suspended) or off it (needs a free roster spot)
--    with move_player. No tool, saved plan or auto-pilot ever moves a player on or off IR, and a player can stay
--    on IR after he's healthy. Lineup tools just leave IR players out.
-- 2. Player timeline: NHL team changes (trades, call-ups, waivers) and injury changes are logged per player so
--    they show on his card beside the headlines.
-- 3. Box-score team: once today's game starts, the box score says which NHL team a player is dressed for. That
--    beats a stale roster feed, so a player traded on game day still gets his lineup frozen and his points.

-- ───────────── 1. IR ─────────────
create or replace function public.move_player(p_player int, p_slot text, p_swap int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team();
  r rosters; s rosters; p players; q players;
  s_new text;
begin
  perform take_snapshots();
  select * into r from rosters where player_id = p_player and team_id = me for update;
  if not found then raise exception 'That player is not on your roster'; end if;
  select * into p from players where id = p_player;
  if player_locked(p_player) then raise exception '% is locked: his game has started', p.name; end if;
  if not slot_ok(p.elig, p.pos, p_slot) then raise exception '% can''t play %', p.name, p_slot; end if;
  if p_slot = 'IR' and r.slot <> 'IR' and not _ir_ok(p.injury_status) then
    if p.injury_status is null then
      raise exception '% isn''t on the injury report: IR is for injured players only', p.name;
    end if;
    raise exception '% is listed %: suspended players can''t go on IR', p.name, p.injury_status;
  end if;

  if p_swap is not null then
    select * into s from rosters where player_id = p_swap and team_id = me for update;
    if not found or s.slot <> p_slot then raise exception 'Swap target is not in that slot'; end if;
    select * into q from players where id = p_swap;
    if player_locked(p_swap) then raise exception '% is locked: his game has started', q.name; end if;
    s_new := case when slot_ok(q.elig, q.pos, r.slot) and not (r.slot = 'IR' and not _ir_ok(q.injury_status)) then r.slot else 'BN' end;
    if s_new = 'BN' and r.slot <> 'BN' and (select count(*) from rosters where team_id = me and slot = 'BN') >= _cap('BN') then
      raise exception 'Bench is full';
    end if;
    update rosters set slot = s_new where player_id = p_swap;
    update rosters set slot = p_slot where player_id = p_player;
  else
    if r.slot = p_slot then return; end if;
    if r.slot = 'IR' and _active_count(me) >= _roster_max() then
      raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.', p.name, _roster_max();
    end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player;
  end if;
  if _active_count(me) > _roster_max() then
    raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.',
      case when r.slot = 'IR' then p.name else q.name end, _roster_max();
  end if;
  -- anyone now on IR drops out of saved future lineups
  delete from lineup_plans lp using rosters x
    where x.team_id = me and x.slot = 'IR' and lp.team_id = me and lp.player_id = x.player_id and lp.date > today_et();
end $$;

-- the optimizer's lineups ("set best lineup", auto-pilot): IR players and IR moves are skipped, never an error,
-- so a stale screen can't break a lineup
create or replace function public._apply_lineup(p_team int, p_slots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text; v text; r rosters; p players; n int := 0; s text;
begin
  perform take_snapshots();
  for k, v in select * from jsonb_each_text(p_slots) loop
    select * into r from rosters where player_id = k::int and team_id = p_team for update;
    if not found then raise exception 'Player % is not on this roster', k; end if;
    if r.slot = v or r.slot = 'IR' or v = 'IR' then continue; end if;
    select * into p from players where id = r.player_id;
    if player_locked(r.player_id) then raise exception '% is locked: his game has started', p.name; end if;
    if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
    update rosters set slot = v where player_id = r.player_id and team_id = p_team;
    n := n + 1;
  end loop;
  for s in select unnest(array['C','LW','RW','D','Util','G','BN','IR']) loop
    if (select count(*) from rosters where team_id = p_team and slot = s) > _cap(s) then
      raise exception 'Too many players at %', s;
    end if;
  end loop;
  return n;
end $$;

-- saved daily lineups: IR players stay on IR and a plan can't put anyone there
create or replace function public.apply_lineup_plans() returns int
language plpgsql security definer set search_path = public as $$
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
      from rosters r join players pl on pl.id = r.player_id
      left join lineup_plans lp on lp.team_id = r.team_id and lp.date = d and lp.player_id = r.player_id
      where r.team_id = t
    )
    update rosters r set slot = target.slot from target
    where r.player_id = target.player_id and r.team_id = t and r.slot is distinct from target.slot;
    get diagnostics moved = row_count;
    for s in select unnest(array['C','LW','RW','D','Util','G']) loop
      select count(*) - _cap(s) into over from rosters where team_id = t and slot = s;
      if over > 0 then
        update rosters set slot = 'BN' where player_id in (
          select r.player_id from rosters r join players pl on pl.id = r.player_id
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
end $$;

-- saving future lineups: IR players and IR slots are left out (IR is set on the day, by hand)
create or replace function public.set_lineup_plans(p_plans jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); d text; plan jsonb; dt date; k text; v text; p players; n int := 0; s text; cnt int;
  lg league;
begin
  perform _gm_only();
  if me is null then raise exception 'Not signed in'; end if;
  select * into lg from league;
  if jsonb_typeof(p_plans) <> 'object' then raise exception 'Plans must be an object of dates'; end if;
  for d, plan in select * from jsonb_each(p_plans) loop
    dt := d::date;
    if dt <= today_et() then raise exception 'Today''s lineup is set live on the lineup page (% is not in the future)', dt; end if;
    if dt > today_et() + 60 then raise exception 'Lineups can be set up to 60 days ahead'; end if;
    if coalesce(lg.playoffs_end, lg.season_end) is not null and dt > coalesce(lg.playoffs_end, lg.season_end) then
      raise exception '% is after the Stanley Cup final', dt;
    end if;
    delete from lineup_plans where team_id = me and date = dt;
    if plan is null or plan = '{}'::jsonb then n := n + 1; continue; end if;
    for k, v in select * from jsonb_each_text(plan) loop
      if not exists (select 1 from rosters where player_id = k::int and team_id = me) then
        raise exception 'Player % is not on your roster', k;
      end if;
      if v = 'IR' or exists (select 1 from rosters where player_id = k::int and slot = 'IR') then continue; end if;
      select * into p from players where id = k::int;
      if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
      insert into lineup_plans (team_id, date, player_id, slot) values (me, dt, k::int, v);
    end loop;
    for s in select unnest(array['C','LW','RW','D','Util','G']) loop
      select count(*) into cnt from lineup_plans where team_id = me and date = dt and slot = s;
      if cnt > _cap(s) then raise exception 'Too many players at % on %', s, to_char(dt, 'Mon DD'); end if;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

-- pickups: a healthy player can stay on IR, so he no longer blocks a pickup
create or replace function public.add_player(p_add integer, p_drop integer default null, p_accept_fee boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); l league; used int; cnt int; allowed int;
begin perform _gm_only();
  select * into l from league;
  if l.phase <> 'season' then raise exception 'Free agency opens after the draft'; end if;
  perform take_snapshots();
  if exists (select 1 from rosters where player_id = p_add) then raise exception 'That player is already on a roster'; end if;
  if not exists (select 1 from players where id = p_add) then raise exception 'Unknown player'; end if;
  used := _acq_used(me);
  allowed := _acq_allowed(me);
  if used >= allowed then
    raise exception 'You''ve used all % of your free-agent pickups. Trade with another GM for more.', allowed;
  end if;
  if p_drop is not null then
    if not exists (select 1 from rosters where player_id = p_drop and team_id = me) then raise exception 'You can only drop your own players'; end if;
    delete from rosters where player_id = p_drop;
    insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_drop);
  end if;
  select count(*) into cnt from rosters where team_id = me and slot <> 'IR';
  if cnt >= _roster_max() then raise exception 'Roster is full (% players). Choose someone to drop.', _roster_max(); end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_add, me, 'BN', 'fa');
  insert into transactions (season, type, team_id, player_id) values (l.season, 'add', me, p_add);
  perform _sys('general', format('➕ %s add %s%s', _tname(me), _pname(p_add),
    case when p_drop is not null then ', drop ' || _pname(p_drop) else '' end));
end $$;

-- saved plans made before a player went on IR no longer count him
delete from public.lineup_plans lp using public.rosters r
  where r.player_id = lp.player_id and r.team_id = lp.team_id and r.slot = 'IR';

-- ───────────── 2. player timeline ─────────────
create table if not exists public.player_events (
  id bigserial primary key,
  player_id int not null references public.players(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('team', 'injury')),
  body text not null
);
create index if not exists player_events_player_idx on public.player_events (player_id, at desc);
alter table public.player_events enable row level security;
revoke all on public.player_events from anon, authenticated;
grant select on public.player_events to authenticated;
grant all on public.player_events to service_role;
grant usage on sequence public.player_events_id_seq to service_role;
drop policy if exists read_all on public.player_events;
create policy read_all on public.player_events for select to authenticated using (true);

create or replace function public._player_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.nhl_team is not null and new.nhl_team is not null and new.nhl_team is distinct from old.nhl_team then
    insert into player_events (player_id, kind, body) values (new.id, 'team', format('Moved from %s to %s', old.nhl_team, new.nhl_team));
  end if;
  if new.injury_status is distinct from old.injury_status then
    insert into player_events (player_id, kind, body) values (new.id, 'injury',
      case when new.injury_status is null then format('Off the injury report (was %s)', old.injury_status)
           when old.injury_status is null then format('Listed %s%s', new.injury_status, coalesce(': ' || new.injury_note, ''))
           else format('Now %s (was %s)%s', new.injury_status, old.injury_status, coalesce(': ' || new.injury_note, '')) end);
  end if;
  return new;
end $$;
revoke execute on function public._player_events() from public, anon, authenticated;
drop trigger if exists players_events on public.players;
create trigger players_events after update of nhl_team, injury_status on public.players
  for each row when (old.nhl_team is distinct from new.nhl_team or old.injury_status is distinct from new.injury_status)
  execute function public._player_events();

-- ───────────── 3. box-score team ─────────────
-- a player in one of today's box scores plays for that team, whatever the roster feed still says
create or replace function public.sync_teams_from_box() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update players p set nhl_team = pg.nhl_team, updated_at = now()
  from player_games pg join games g on g.id = pg.game_id
  where g.date = today_et() and pg.player_id = p.id and pg.nhl_team is not null and p.nhl_team is distinct from pg.nhl_team;
  get diagnostics n = row_count;
  if n > 0 then perform take_snapshots(); end if;
  return n;
end $$;
revoke execute on function public.sync_teams_from_box() from public, anon, authenticated;
grant execute on function public.sync_teams_from_box() to service_role;
