-- IR rules, the SAK Cup, NHL playoff odds and the trade block.
--
-- IR, spelled out:
--   * two IR spots. Only injured players go there (Out, IR, IR-LT, Day-To-Day...). Suspended players don't:
--     a suspension is not an injury.
--   * a player on IR doesn't count against the roster, so each one on IR opens a roster spot for a pickup.
--   * coming off IR needs a free roster spot: if you filled his spot, drop someone first. The active roster
--     (everyone not on IR) can never be bigger than the league's roster size.
--   * a player who is healthy (or suspended) but still on IR blocks pickups until he's activated or dropped,
--     so IR can't be used as a stash.
--
-- The season: the regular season table is kept as it stands when the NHL regular season ends; the playoff table
-- starts every team at zero with the same rosters and the same daily lineup rules; the SAK Cup is the whole year,
-- from the draft to the Stanley Cup final (regular season plus playoffs).

alter table public.league add column if not exists playoffs_end date;
update public.league set playoffs_end = '2027-06-30' where id = 1 and playoffs_end is null;

create or replace function public._ir_ok(p_status text) returns boolean
language sql immutable as $$ select p_status is not null and p_status !~* 'suspen' $$;

create or replace function public._active_count(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from rosters where team_id = p_team and slot <> 'IR'
$$;

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
      raise exception 'No roster spot to bring % off IR: % active players is the max. Drop someone first.', p.name, _roster_max();
    end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player;
  end if;
  if _active_count(me) > _roster_max() then
    raise exception 'No roster spot to bring % off IR: % active players is the max. Drop someone first.',
      case when r.slot = 'IR' then p.name else q.name end, _roster_max();
  end if;
end $$;

-- the optimizer's lineups (auto-pilot and "set best lineup") follow the same rules
create or replace function public._apply_lineup(p_team int, p_slots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text; v text; r rosters; p players; n int := 0; s text;
begin
  perform take_snapshots();
  for k, v in select * from jsonb_each_text(p_slots) loop
    select * into r from rosters where player_id = k::int and team_id = p_team for update;
    if not found then raise exception 'Player % is not on this roster', k; end if;
    if r.slot = v then continue; end if;
    select * into p from players where id = r.player_id;
    if player_locked(r.player_id) then raise exception '% is locked: his game has started', p.name; end if;
    if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
    if v = 'IR' and not _ir_ok(p.injury_status) then raise exception '% can''t go on IR (%)', p.name, coalesce(p.injury_status, 'healthy'); end if;
    update rosters set slot = v where player_id = r.player_id and team_id = p_team;
    n := n + 1;
  end loop;
  for s in select unnest(array['C','LW','RW','D','Util','G','BN','IR']) loop
    if (select count(*) from rosters where team_id = p_team and slot = s) > _cap(s) then
      raise exception 'Too many players at %', s;
    end if;
  end loop;
  if _active_count(p_team) > _roster_max() then
    raise exception 'No roster spot to bring a player off IR: drop someone first';
  end if;
  return n;
end $$;

-- saved daily lineups: a player on IR stays there unless the plan activates him, and an activation that would
-- overfill the roster is skipped (he stays on IR)
create or replace function public.apply_lineup_plans() returns int
language plpgsql security definer set search_path = public as $$
declare t int; d date := today_et(); moved int; total int := 0; s text; over int; ir_before int[];
begin
  for t in select distinct lp.team_id from lineup_plans lp
    where lp.date = d and not exists (select 1 from lineup_plan_applied a where a.team_id = lp.team_id and a.date = d) loop
    ir_before := array(select player_id from rosters where team_id = t and slot = 'IR');
    with target as (
      select r.player_id, r.slot as cur,
        case
          when player_locked(r.player_id) then r.slot
          when r.slot = 'IR' and (lp.slot is null or lp.slot = 'IR') then 'IR'
          when lp.slot is null then 'BN'
          when not slot_ok(pl.elig, pl.pos, lp.slot) then 'BN'
          when lp.slot = 'IR' and not _ir_ok(pl.injury_status) then 'BN'
          else lp.slot end as slot
      from rosters r join players pl on pl.id = r.player_id
      left join lineup_plans lp on lp.team_id = r.team_id and lp.date = d and lp.player_id = r.player_id
      where r.team_id = t
    )
    update rosters r set slot = target.slot from target
    where r.player_id = target.player_id and r.team_id = t and r.slot is distinct from target.slot;
    get diagnostics moved = row_count;
    for s in select unnest(array['C','LW','RW','D','Util','G','IR']) loop
      select count(*) - _cap(s) into over from rosters where team_id = t and slot = s;
      if over > 0 then
        update rosters set slot = 'BN' where player_id in (
          select r.player_id from rosters r join players pl on pl.id = r.player_id
          where r.team_id = t and r.slot = s and not player_locked(r.player_id) order by pl.proj asc limit over);
      end if;
    end loop;
    over := _active_count(t) - _roster_max();
    if over > 0 then
      update rosters set slot = 'IR' where team_id = t and player_id in (
        select r.player_id from rosters r join players pl on pl.id = r.player_id
        where r.team_id = t and r.player_id = any (ir_before) and r.slot <> 'IR' and not player_locked(r.player_id)
        order by pl.proj asc limit over);
      perform _notify(t, 'lineup', 'Your saved lineup tried to bring a player off IR with no roster spot open. He stays on IR until you drop someone.', '/team');
    end if;
    insert into lineup_plan_applied (team_id, date, moves) values (t, d, moved) on conflict do nothing;
    update teams set lineup_touched = d where id = t;
    total := total + 1;
  end loop;
  delete from lineup_plans where date < d - 7;
  delete from lineup_plan_applied where date < d - 30;
  return total;
end $$;

-- plans run through the Stanley Cup final, and a plan can't activate more players than the roster holds
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
      select * into p from players where id = k::int;
      if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
      insert into lineup_plans (team_id, date, player_id, slot) values (me, dt, k::int, v);
    end loop;
    for s in select unnest(array['C','LW','RW','D','Util','G','IR']) loop
      select count(*) into cnt from lineup_plans where team_id = me and date = dt and slot = s;
      if cnt > _cap(s) then raise exception 'Too many players at % on %', s, to_char(dt, 'Mon DD'); end if;
    end loop;
    select count(*) into cnt from rosters r
      left join lineup_plans lp on lp.team_id = me and lp.date = dt and lp.player_id = r.player_id
      where r.team_id = me and coalesce(lp.slot, case when r.slot = 'IR' then 'IR' else 'BN' end) <> 'IR';
    if cnt > _roster_max() then
      raise exception 'On %, % players would be active (max %): leave someone on IR or drop a player first', to_char(dt, 'Mon DD'), cnt, _roster_max();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- pickups: IR only opens room for injured players
create or replace function public.add_player(p_add integer, p_drop integer default null, p_accept_fee boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); l league; used int; fee numeric := 0; cnt int; stuck text;
begin perform _gm_only();
  select * into l from league;
  if l.phase <> 'season' then raise exception 'Free agency opens after the draft'; end if;
  perform take_snapshots();
  if exists (select 1 from rosters where player_id = p_add) then raise exception 'That player is already on a roster'; end if;
  if not exists (select 1 from players where id = p_add) then raise exception 'Unknown player'; end if;
  select string_agg(pl.name, ', ') into stuck from rosters r join players pl on pl.id = r.player_id
    where r.team_id = me and r.slot = 'IR' and not _ir_ok(pl.injury_status) and r.player_id is distinct from p_drop;
  if stuck is not null then
    raise exception '% % no longer injured but still on IR. Activate or drop before adding: IR only frees a spot for injured players.',
      stuck, case when position(',' in stuck) > 0 then 'are' else 'is' end;
  end if;
  select count(*) into used from transactions where team_id = me and type = 'add' and season = l.season;
  if used >= l.max_acquisitions then
    if l.season_end is not null and today_et() > l.season_end - 7 then
      raise exception 'No extra pickups in the final week of the season';
    end if;
    if not p_accept_fee then raise exception 'ACQ_LIMIT: You''ve used all % free pickups. Extra pickups cost $%.', l.max_acquisitions, l.extra_acq_fee; end if;
    fee := l.extra_acq_fee;
  end if;
  if p_drop is not null then
    if not exists (select 1 from rosters where player_id = p_drop and team_id = me) then raise exception 'You can only drop your own players'; end if;
    delete from rosters where player_id = p_drop;
    insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_drop);
  end if;
  select count(*) into cnt from rosters where team_id = me and slot <> 'IR';
  if cnt >= _roster_max() then raise exception 'Roster is full (% players). Choose someone to drop.', _roster_max(); end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_add, me, 'BN', 'fa');
  insert into transactions (season, type, team_id, player_id, fee) values (l.season, 'add', me, p_add, fee);
  if fee > 0 then
    insert into ledger (season, team_id, kind, amount, description)
      values (l.season, me, 'acq_fee', fee, 'Extra pickup: ' || _pname(p_add));
  end if;
  perform _sys('general', format('➕ %s add %s%s%s', _tname(me), _pname(p_add),
    case when p_drop is not null then ', drop ' || _pname(p_drop) else '' end,
    case when fee > 0 then format(' ($%s extra pickup fee)', fee) else '' end));
end $$;

-- trades: an injured player on IR stays on IR with his new team when there's an IR spot; everyone else lands on
-- the bench. No team can come out of a trade with more active players than the roster holds.
create or replace function public._trade_active_after(p_trade bigint, p_team int) returns int
language sql stable security definer set search_path = public as $$
  with tr as (select * from trades where id = p_trade),
  items as (
    select i.player_id, i.from_team,
      coalesce(i.to_team, case when i.from_team = tr.from_team then tr.to_team else tr.from_team end) as dest,
      r.slot, pl.injury_status
    from trade_items i cross join tr
    join rosters r on r.player_id = i.player_id
    join players pl on pl.id = i.player_id
    where i.trade_id = p_trade and i.player_id is not null
  ),
  ir_free as (
    select greatest(0, _cap('IR') - (select count(*) from rosters where team_id = p_team and slot = 'IR')
      + (select count(*) from items where from_team = p_team and slot = 'IR'))::int as n
  )
  select (_active_count(p_team)
    - (select count(*) from items where from_team = p_team and slot <> 'IR')
    + (select count(*) from items where dest = p_team)
    - least((select n from ir_free), (select count(*) from items where dest = p_team and slot = 'IR' and _ir_ok(injury_status))))::int
$$;

create or replace function public._execute_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades; it record; dest int; parts int[]; t int; summary text; slot_to text; n int;
begin
  select * into tr from trades where id = p_trade for update;
  parts := coalesce(tr.parties, array[tr.from_team, tr.to_team]);
  perform take_snapshots();
  if exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id is not null
               and not exists (select 1 from rosters r where r.player_id = i.player_id and r.team_id = i.from_team))
     or exists (select 1 from trade_items i where i.trade_id = p_trade and i.pick_id is not null
               and not exists (select 1 from draft_picks d where d.id = i.pick_id and d.team_id = i.from_team and d.player_id is null)) then
    update trades set status = 'failed', decided_at = now(), review_note = 'Assets changed hands before approval' where id = p_trade;
    for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'A trade failed: assets changed hands', '/trades'); end loop;
    return;
  end if;
  for t in select x from unnest(parts) x loop
    n := _trade_active_after(p_trade, t);
    if n > _roster_max() then
      raise exception '% would have % active players after this trade (max %). They need to drop % first.', _tname(t), n, _roster_max(), n - _roster_max();
    end if;
  end loop;
  -- players leave first, so IR spots they free can be used by players arriving
  create temp table if not exists _moving (player_id int, dest int, was_ir boolean, ir_ok boolean) on commit drop;
  delete from _moving;
  for it in select * from trade_items where trade_id = p_trade loop
    dest := coalesce(it.to_team, case when it.from_team = tr.from_team then tr.to_team else tr.from_team end);
    if it.player_id is not null then
      insert into _moving select it.player_id, dest, r.slot = 'IR', _ir_ok(pl.injury_status)
        from rosters r join players pl on pl.id = r.player_id where r.player_id = it.player_id;
      update rosters set team_id = dest, slot = 'BN', acquired = 'trade', acquired_at = now() where player_id = it.player_id;
      insert into transactions (season, type, team_id, player_id, other_team, note) values (tr.season, 'trade', dest, it.player_id, it.from_team, 'Trade #' || p_trade);
    else
      update draft_picks set team_id = dest where id = it.pick_id;
    end if;
  end loop;
  for it in select * from _moving where was_ir and ir_ok loop
    if (select count(*) from rosters where team_id = it.dest and slot = 'IR') < _cap('IR') then
      update rosters set slot = 'IR' where player_id = it.player_id;
    end if;
  end loop;
  update trades set status = 'approved', decided_at = now() where id = p_trade;
  if tr.parties is null then
    select format('%s send %s to %s for %s', _tname(tr.from_team),
      coalesce((select string_agg(coalesce(_pname(player_id), (select format('%s R%s pick', season, round) from draft_picks where id = pick_id)), ', ') from trade_items where trade_id = p_trade and from_team = tr.from_team), 'nothing'),
      _tname(tr.to_team),
      coalesce((select string_agg(coalesce(_pname(player_id), (select format('%s R%s pick', season, round) from draft_picks where id = pick_id)), ', ') from trade_items where trade_id = p_trade and from_team = tr.to_team), 'nothing'))
    into summary;
  else
    select string_agg(format('%s send %s to %s', _tname(g.from_team), g.what, _tname(g.to_team)), '; ' order by g.from_team, g.to_team) into summary
    from (select from_team, to_team, string_agg(coalesce(_pname(player_id), (select format('%s R%s pick', season, round) from draft_picks where id = pick_id)), ', ') as what
          from trade_items where trade_id = p_trade group by from_team, to_team) g;
    summary := format('%s-team deal: %s', array_length(tr.parties, 1), summary);
  end if;
  perform _sys('general', '🔄 TRADE! ' || summary, jsonb_build_object('trade', p_trade));
  for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'Your trade went through: ' || left(summary, 140), '/trades'); end loop;
  -- players who moved come off the trade block
  update trade_block b set offering = array(select x from unnest(b.offering) x where not exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id = x))
    where b.team_id = any (parts);
end $$;

-- accepting: you can't take on more players than you have room for
create or replace function public.respond_trade(p_trade bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); tr trades; c int; t int; waiting text; n int;
begin
  perform _gm_only();
  select * into tr from trades where id = p_trade for update;
  if tr.status <> 'proposed' then raise exception 'You can''t respond to that trade'; end if;
  if tr.parties is null then
    if tr.to_team <> me then raise exception 'You can''t respond to that trade'; end if;
  else
    if not (me = any (tr.parties)) or me = tr.from_team or me = any (tr.accepted_by) then raise exception 'You can''t respond to that trade'; end if;
  end if;
  if not p_accept then
    update trades set status = 'declined', responded_at = now() where id = p_trade;
    for t in select x from unnest(coalesce(tr.parties, array[tr.from_team, tr.to_team])) x where x <> me loop
      perform _notify(t, 'trade', _tname(me) || ' declined the trade offer', '/trades');
    end loop;
    return;
  end if;
  n := _trade_active_after(p_trade, me);
  if n > _roster_max() then
    raise exception 'You''d have % active players after this trade (max %). Drop % first, then accept.', n, _roster_max(), n - _roster_max();
  end if;
  if tr.parties is not null then
    update trades set accepted_by = accepted_by || me where id = p_trade;
    select string_agg(_tname(x), ', ') into waiting from unnest(tr.parties) x where x <> me and not (x = any (tr.accepted_by));
    if waiting is not null then
      for t in select x from unnest(tr.parties) x where x <> me loop
        perform _notify(t, 'trade', format('%s accepted the %s-team trade. Waiting on %s.', _tname(me), array_length(tr.parties, 1), waiting), '/trades');
      end loop;
      return;
    end if;
  end if;
  update trades set status = 'accepted', responded_at = now() where id = p_trade;
  if tr.parties is null then
    perform _notify(tr.from_team, 'trade', _tname(me) || ' accepted your trade. Waiting on commissioner review.', '/trades');
    for c in select id from teams where is_commish loop
      perform _notify(c, 'trade', format('Trade to review: %s ↔ %s', _tname(tr.from_team), _tname(tr.to_team)), '/trades');
    end loop;
    perform _sys('general', format('🤝 %s and %s agreed to a trade. Pending commissioner review.', _tname(tr.from_team), _tname(tr.to_team)));
  else
    for t in select x from unnest(tr.parties) x where x <> me loop
      perform _notify(t, 'trade', 'Everyone accepted the trade. Waiting on commissioner review.', '/trades');
    end loop;
    for c in select id from teams where is_commish loop
      perform _notify(c, 'trade', format('%s-team trade to review: %s', array_length(tr.parties, 1), (select string_agg(_tname(x), ', ') from unnest(tr.parties) x)), '/trades');
    end loop;
    perform _sys('general', format('🤝 %s agreed to a %s-team trade. Pending commissioner review.', (select string_agg(_tname(x), ', ') from unnest(tr.parties) x), array_length(tr.parties, 1)));
  end if;
end $$;

-- standings: the playoff table is GMs only (like the regular season), and the SAK Cup is the whole year
create or replace view public.playoff_standings as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0) as last7,
      coalesce(sum(d.games), 0) as games
    from teams t left join playoff_daily d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id
  )
  select agg.*, rank() over (order by points desc) as rank from agg;

create or replace view public.sak_cup_daily as
  select team_id, date, sum(points) as points, sum(games)::bigint as games
  from team_daily_all group by team_id, date;

create or replace view public.sak_cup_standings as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0) as last7,
      coalesce(sum(d.games), 0) as games
    from teams t left join sak_cup_daily d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id
  )
  select agg.*, rank() over (order by points desc) as rank from agg;

revoke all on public.playoff_standings, public.sak_cup_daily, public.sak_cup_standings from anon, authenticated;
grant select on public.playoff_standings, public.sak_cup_daily, public.sak_cup_standings to authenticated;

-- NHL teams: standings, strength and playoff odds (nhl-sync?task=standings, daily). exp_po_games is how many
-- playoff games the team is expected to play from here, which is what a player's playoff value hangs on.
create table if not exists public.nhl_teams (
  abbrev text primary key,
  name text,
  conf text,
  division text,
  gp int not null default 0,
  pts int not null default 0,
  point_pct numeric,
  prior_pct numeric,             -- last season's points %, the preseason prior
  strength numeric,              -- blended points % estimate
  proj_pts numeric,              -- projected regular season points
  playoff_odds numeric,          -- chance to make the playoffs (1 or 0 once they start)
  exp_po_games numeric,          -- expected playoff games still to play
  po_status text,                -- 'regular' | 'alive' | 'out'
  po_note text,
  updated_at timestamptz not null default now()
);
alter table public.nhl_teams enable row level security;
revoke all on public.nhl_teams from anon, authenticated;
grant select on public.nhl_teams to authenticated;
grant all on public.nhl_teams to service_role;
drop policy if exists read_all on public.nhl_teams;
create policy read_all on public.nhl_teams for select to authenticated using (true);

-- the trade block: each GM can post who they'd move, the positions they want and what they'll give
create table if not exists public.trade_block (
  team_id int primary key references public.teams on delete cascade,
  offering int[] not null default '{}',      -- players available
  wants text[] not null default '{}',        -- positions wanted: C LW RW D G
  offer_note text,                           -- what they're willing to give, in their words
  picks boolean not null default false,      -- will move draft picks
  updated_at timestamptz not null default now()
);
alter table public.trade_block enable row level security;
revoke all on public.trade_block from anon, authenticated;
grant select on public.trade_block to authenticated;
grant all on public.trade_block to service_role;
drop policy if exists read_all on public.trade_block;
create policy read_all on public.trade_block for select to authenticated using (true);

create or replace function public.set_trade_block(p_offering int[], p_wants text[], p_note text default null, p_picks boolean default false, p_announce boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); offer text; want text;
begin
  perform _gm_only();
  if me is null then raise exception 'Not signed in'; end if;
  p_offering := coalesce(p_offering, '{}'); p_wants := coalesce(p_wants, '{}');
  if exists (select 1 from unnest(p_offering) x where not exists (select 1 from rosters where player_id = x and team_id = me)) then
    raise exception 'You can only offer your own players';
  end if;
  if exists (select 1 from unnest(p_wants) w where w not in ('C', 'LW', 'RW', 'D', 'G')) then raise exception 'Positions are C, LW, RW, D or G'; end if;
  if length(coalesce(p_note, '')) > 280 then raise exception 'Keep the note under 280 characters'; end if;
  if cardinality(p_offering) = 0 and cardinality(p_wants) = 0 and coalesce(trim(p_note), '') = '' then
    delete from trade_block where team_id = me;
    return;
  end if;
  insert into trade_block (team_id, offering, wants, offer_note, picks, updated_at)
    values (me, p_offering, p_wants, nullif(trim(p_note), ''), coalesce(p_picks, false), now())
    on conflict (team_id) do update set offering = excluded.offering, wants = excluded.wants, offer_note = excluded.offer_note,
      picks = excluded.picks, updated_at = now();
  if p_announce then
    select string_agg(_pname(x), ', ') into offer from unnest(p_offering) x;
    select string_agg(w, ', ') into want from unnest(p_wants) w;
    perform _sys('general', format('📣 %s trade block.%s%s%s%s', _tname(me),
      case when offer is not null then ' Available: ' || offer || '.' else '' end,
      case when want is not null then ' Looking for: ' || want || '.' else '' end,
      case when p_picks then ' Will move picks.' else '' end,
      case when coalesce(trim(p_note), '') <> '' then ' "' || trim(p_note) || '"' else '' end),
      jsonb_build_object('trade_block', me));
  end if;
end $$;
revoke execute on function public.set_trade_block(int[], text[], text, boolean, boolean) from public, anon;
grant execute on function public.set_trade_block(int[], text[], text, boolean, boolean) to authenticated;

-- dropped players come off the block too
create or replace function public._block_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update trade_block set offering = array_remove(offering, old.player_id) where team_id = old.team_id and old.player_id = any (offering);
  return old;
end $$;
drop trigger if exists rosters_block_cleanup on public.rosters;
create trigger rosters_block_cleanup after delete on public.rosters for each row execute function public._block_cleanup();

revoke execute on function public._trade_active_after(bigint, int), public._active_count(int), public._execute_trade(bigint), public._apply_lineup(int, jsonb) from public, anon, authenticated;
grant execute on function public._ir_ok(text) to authenticated;
