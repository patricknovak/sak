-- B1 (docs/EXPANSION.md): a player can be on one roster per league, not one roster in the whole database. Until now
-- rosters were keyed by player alone, so a second league could never roster anyone SaK owns, and every lookup by
-- player (adds, drops, the draft's "already taken", the alerts, trades) read across leagues. The key becomes
-- (league_id, player_id) and every lookup by player names its league: the team's league for a GM's own moves, the
-- caller's league for the commissioner's, the pick's league in the draft, and every owning league for the alerts.
-- Also: open_markets (a scheduler job) was callable with the public key; it isn't any more.

-- the league a team plays in
create or replace function public._league_of(p_team int) returns int
language sql stable security definer set search_path = public as $$ select league_id from teams where id = p_team $$;
revoke execute on function public._league_of(int) from public, anon, authenticated;

-- a row "belongs to another league" only when none of its rows is in the caller's league (a player is now on one
-- roster per league, so a lookup by player can find several)
create or replace function public._in_league(p_table text, p_id bigint, p_col text default 'id') returns void
language plpgsql stable security definer set search_path = public as $$
declare n int; mine int;
begin
  execute format('select count(*), count(*) filter (where league_id = current_league_id()) from public.%I where %I = $1', p_table, p_col)
    into n, mine using p_id;
  if n > 0 and mine = 0 then raise exception 'That belongs to another league'; end if;
end $$;

-- the key: one row per player per league
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'rosters_pkey' and conrelid = 'public.rosters'::regclass
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (player_id)') then
    alter table public.rosters drop constraint rosters_pkey;
    alter table public.rosters add constraint rosters_pkey primary key (league_id, player_id);
  end if;
end $$;
create index if not exists rosters_player_idx on public.rosters (player_id);

CREATE OR REPLACE FUNCTION public._auto_lineup(p_team integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
    from rosters r join players p on p.id = r.player_id
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
end $$;

CREATE OR REPLACE FUNCTION public._autopick_player(p_team integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  with have as (select p.pos, count(*) n from rosters r join players p on p.id = r.player_id where r.team_id = p_team group by p.pos),
  lim(pos, mx, target) as (values ('C', 7, 4), ('LW', 7, 4), ('RW', 7, 4), ('D', 9, 6), ('G', 4, 3))
  select coalesce(
    (select q.player_id from draft_queue q where q.team_id = p_team
       and not exists (select 1 from rosters r where r.player_id = q.player_id and r.league_id = _league_of(p_team)) order by q.pos, q.player_id limit 1),
    (select p.id from players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team))
         and coalesce(have.n, 0) < lim.mx
         and coalesce(p.injury_status, '') !~* '^(out|ir\b|injured|suspen|long)'
       order by case when coalesce(have.n, 0) < lim.target then 0 else 1 end, p.proj desc, p.last_fp desc limit 1),
    (select p.id from players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team)) and coalesce(have.n, 0) < lim.mx
       order by p.proj desc, p.last_fp desc limit 1))
$$;

CREATE OR REPLACE FUNCTION public._big_night_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  o int; pname text; what text;
  g int := coalesce((new.stats->>'g')::int, 0); pts int := coalesce((new.stats->>'pts')::int, 0); sho int := coalesce((new.stats->>'sho')::int, 0);
  og int := 0; opts int := 0; osho int := 0;
begin
  if tg_op = 'UPDATE' then
    og := coalesce((old.stats->>'g')::int, 0); opts := coalesce((old.stats->>'pts')::int, 0); osho := coalesce((old.stats->>'sho')::int, 0);
  end if;
  select name into pname from players where id = new.player_id;
  if g >= 3 and og < 3 then what := format('🎩 Hat trick! %s has %s goals tonight', pname, g);
  elsif pts >= 4 and opts < 4 then what := format('🔥 %s has %s points tonight', pname, pts);
  elsif sho = 1 and osho = 0 then what := format('🧱 Shutout for %s', pname);
  else return new; end if;
  -- every league that has him: the team that dressed him that night, else the team that has him now
  for o in select distinct on (x.lid) x.tid from (
      select s.league_id as lid, s.team_id as tid, 0 as pri from lineup_snapshots s where s.player_id = new.player_id and s.date = new.date
      union all select r.league_id, r.team_id, 1 from rosters r where r.player_id = new.player_id) x
    order by x.lid, x.pri loop
    perform _notify(o, 'big_night', what, '/player/' || new.player_id);
  end loop;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public._injury_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare o int;
begin
  if new.injury_status is not distinct from old.injury_status then return new; end if;
  -- the team that has him, in every league that does
  for o in select team_id from rosters where player_id = new.id loop
    if new.injury_status is null then
      perform _notify(o, 'injury', format('✅ %s is off the injury report', new.name), '/player/' || new.id);
    else
      perform _notify(o, 'injury', format('🚑 %s: %s%s', new.name, new.injury_status, coalesce(' · ' || left(new.injury_note, 90), '')), '/player/' || new.id);
    end if;
  end loop;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public._do_pick(p_pick draft_picks, p_player integer, p_auto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare n int := (select count(*) from teams where league_id = p_pick.league_id and role = 'gm'); rp int;
begin
  if not exists (select 1 from players where id = p_player) then raise exception 'Unknown player'; end if;
  if exists (select 1 from rosters where player_id = p_player and league_id = p_pick.league_id) then raise exception 'That player is already taken'; end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_player, p_pick.team_id, 'BN', 'draft');
  update draft_picks set player_id = p_player, picked_at = now(), auto = p_auto where id = p_pick.id;
  delete from draft_queue where player_id = p_player and team_id in (select id from teams where league_id = p_pick.league_id);
  insert into transactions (season, type, team_id, player_id, note)
    values (p_pick.season, 'draft', p_pick.team_id, p_player, format('Round %s, pick %s', p_pick.round, p_pick.overall));
  rp := (p_pick.overall - 1) % n + 1;
  perform _sys('draft', format('%s%s.%s (#%s) %s select %s', case when p_auto then '🤖 ' else '🚨 ' end,
      p_pick.round, lpad(rp::text, 2, '0'), p_pick.overall, _tname(p_pick.team_id), _pname(p_player)),
    jsonb_build_object('pick', p_pick.overall, 'player', p_player, 'team', p_pick.team_id, 'auto', p_auto));
  perform _advance();
end $$;

CREATE OR REPLACE FUNCTION public._execute_trade(p_trade bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare tr trades; it record; dest int; parts int[]; t int; summary text; n int; drops text;
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
      update trades set status = 'failed', decided_at = now(),
        review_note = format('%s would have %s active players (max %s): rosters changed after the deal was agreed', _tname(t), n, _roster_max()) where id = p_trade;
      perform _notify(x, 'trade', format('A trade failed: %s would be over the roster limit', _tname(t)), '/trades') from unnest(parts) x;
      return;
    end if;
    perform _check_trade_extras(t,
      (select coalesce(sum(pickups), 0) from trade_items where trade_id = p_trade and from_team = t)::int,
      (select coalesce(sum(coins), 0) from trade_items where trade_id = p_trade and from_team = t)::int);
  end loop;
  -- the drops that make room
  for it in select * from trade_items where trade_id = p_trade and release loop
    delete from rosters where player_id = it.player_id and team_id = it.from_team;
    insert into transactions (season, type, team_id, player_id, note) values (tr.season, 'drop', it.from_team, it.player_id, 'To make room for trade #' || p_trade);
  end loop;
  create temp table if not exists _moving (player_id int, dest int, was_ir boolean, ir_ok boolean) on commit drop;
  delete from _moving;
  for it in select * from trade_items where trade_id = p_trade and not release loop
    dest := coalesce(it.to_team, case when it.from_team = tr.from_team then tr.to_team else tr.from_team end);
    if it.player_id is not null then
      insert into _moving select it.player_id, dest, r.slot = 'IR', _ir_ok(pl.injury_status)
        from rosters r join players pl on pl.id = r.player_id where r.player_id = it.player_id and r.team_id = it.from_team;
      update rosters set team_id = dest, slot = 'BN', acquired = 'trade', acquired_at = now() where player_id = it.player_id and team_id = it.from_team;
      insert into transactions (season, type, team_id, player_id, other_team, note) values (tr.season, 'trade', dest, it.player_id, it.from_team, 'Trade #' || p_trade);
    elsif it.pick_id is not null then
      update draft_picks set team_id = dest where id = it.pick_id;
    elsif it.pickups is not null then
      insert into acq_transfers (season, from_team, to_team, n, trade_id) values (tr.season, it.from_team, dest, it.pickups, p_trade);
    elsif it.coins is not null then
      insert into coin_ledger (team_id, amount, reason) values
        (it.from_team, -it.coins, format('Trade #%s to %s', p_trade, _tname(dest))),
        (dest, it.coins, format('Trade #%s from %s', p_trade, _tname(it.from_team)));
    end if;
  end loop;
  for it in select * from _moving where was_ir and ir_ok loop
    if (select count(*) from rosters where team_id = it.dest and slot = 'IR') < _cap('IR') then
      update rosters set slot = 'IR' where player_id = it.player_id and team_id = it.dest;
    end if;
  end loop;
  update trades set status = 'approved', decided_at = now() where id = p_trade;
  if tr.parties is null then
    select format('%s send %s to %s for %s', _tname(tr.from_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.from_team and not release), 'nothing'),
      _tname(tr.to_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.to_team and not release), 'nothing'))
    into summary;
  else
    select string_agg(format('%s send %s to %s', _tname(g.from_team), g.what, _tname(g.to_team)), '; ' order by g.from_team, g.to_team) into summary
    from (select from_team, to_team, string_agg(_item_label(i), ', ') as what from trade_items i where trade_id = p_trade and not release group by from_team, to_team) g;
    summary := format('%s-team deal: %s', array_length(tr.parties, 1), summary);
  end if;
  select string_agg(format('%s drop %s', _tname(from_team), _pname(player_id)), '; ') into drops from trade_items where trade_id = p_trade and release;
  if drops is not null then summary := summary || '. To make room: ' || drops; end if;
  perform _sys('general', '🔄 TRADE! ' || summary, jsonb_build_object('trade', p_trade));
  for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'Your trade went through: ' || left(summary, 140), '/trades'); end loop;
  update trade_block b set offering = array(select x from unnest(b.offering) x where not exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id = x))
    where b.team_id = any (parts);
end $$;

CREATE OR REPLACE FUNCTION public._trade_active_after(p_trade bigint, p_team integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  with tr as (select * from trades where id = p_trade),
  items as (
    select i.player_id, i.from_team, i.release,
      coalesce(i.to_team, case when i.from_team = tr.from_team then tr.to_team else tr.from_team end) as dest,
      r.slot, pl.injury_status
    from trade_items i cross join tr
    join rosters r on r.player_id = i.player_id and r.team_id = i.from_team
    join players pl on pl.id = i.player_id
    where i.trade_id = p_trade and i.player_id is not null
  ),
  ir_free as (
    select greatest(0, _cap('IR') - (select count(*) from rosters where team_id = p_team and slot = 'IR')
      + (select count(*) from items where from_team = p_team and slot = 'IR'))::int as n
  )
  select (_active_count(p_team)
    - (select count(*) from items where from_team = p_team and slot <> 'IR')
    + (select count(*) from items where dest = p_team and not release)
    - least((select n from ir_free), (select count(*) from items where dest = p_team and not release and slot = 'IR' and _ir_ok(injury_status))))::int
$$;

CREATE OR REPLACE FUNCTION public._trade_add_drops(p_trade bigint, p_team integer, p_drops integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare over int;
begin
  p_drops := coalesce(p_drops, '{}');
  if cardinality(p_drops) = 0 then return; end if;
  if exists (select 1 from unnest(p_drops) x where not exists (select 1 from rosters where player_id = x and team_id = p_team)) then
    raise exception 'You can only drop your own players';
  end if;
  if exists (select 1 from trade_items where trade_id = p_trade and player_id = any (p_drops)) then
    raise exception 'A player in the deal can''t also be a drop';
  end if;
  over := _trade_active_after(p_trade, p_team) - _roster_max();
  if over <= 0 then raise exception 'You have room for this trade: no drop needed'; end if;
  if (select count(*) from rosters where player_id = any (p_drops) and team_id = p_team and slot <> 'IR') > over then
    raise exception 'You only need to drop % to make room', over;
  end if;
  insert into trade_items (trade_id, from_team, player_id, release) select p_trade, p_team, x, true from unnest(p_drops) x;
end $$;

CREATE OR REPLACE FUNCTION public.add_player(p_add integer, p_drop integer DEFAULT NULL::integer, p_accept_fee boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  me int := _team(); l league; used int; cnt int; allowed int;
begin perform _gm_only();
  select * into l from league;
  if l.phase <> 'season' then raise exception 'Free agency opens after the draft'; end if;
  perform take_snapshots();
  if exists (select 1 from rosters where player_id = p_add and league_id = _league_of(me)) then raise exception 'That player is already on a roster'; end if;
  if not exists (select 1 from players where id = p_add) then raise exception 'Unknown player'; end if;
  used := _acq_used(me);
  allowed := _acq_allowed(me);
  if used >= allowed then
    raise exception 'You''ve used all % of your free-agent pickups. Trade with another GM for more.', allowed;
  end if;
  if p_drop is not null then
    if not exists (select 1 from rosters where player_id = p_drop and team_id = me) then raise exception 'You can only drop your own players'; end if;
    delete from rosters where player_id = p_drop and team_id = me;
    insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_drop);
  end if;
  select count(*) into cnt from rosters where team_id = me and slot <> 'IR';
  if cnt >= _roster_max() then raise exception 'Roster is full (% players). Choose someone to drop.', _roster_max(); end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_add, me, 'BN', 'fa');
  insert into transactions (season, type, team_id, player_id) values (l.season, 'add', me, p_add);
  perform _sys('general', format('➕ %s add %s%s', _tname(me), _pname(p_add),
    case when p_drop is not null then ', drop ' || _pname(p_drop) else '' end));
end $$;

CREATE OR REPLACE FUNCTION public.apply_lineup_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
        update rosters set slot = 'BN' where team_id = t and player_id in (
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

CREATE OR REPLACE FUNCTION public.commish_move_player(p_player integer, p_team integer, p_slot text DEFAULT 'BN'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare l league; prev int; lid int := current_league_id();
begin
  -- the team must be this league's; the player is looked up in this league's rosters only (another league having
  -- him makes him a free agent here, not someone else's)
  perform public._in_league('teams', p_team);
  perform _commish();
  select * into l from league;
  perform take_snapshots();
  select team_id into prev from rosters where player_id = p_player and league_id = lid;
  if p_team is null then
    delete from rosters where player_id = p_player and league_id = lid;
  else
    insert into rosters (league_id, player_id, team_id, slot, acquired) values (lid, p_player, p_team, coalesce(p_slot, 'BN'), 'commish')
    on conflict (league_id, player_id) do update set team_id = excluded.team_id, slot = excluded.slot, acquired = 'commish', acquired_at = now();
  end if;
  insert into transactions (season, type, team_id, player_id, other_team, note)
    values (l.season, 'commish', p_team, p_player, prev, 'Commissioner roster move');
  perform _sys('general', format('🛠️ Commissioner moved %s %s', _pname(p_player),
    case when p_team is null then 'to free agency' else 'to ' || _tname(p_team) end));
end $$;

CREATE OR REPLACE FUNCTION public.commish_set_keeper(p_player integer, p_keep boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  perform _commish();
  update rosters set keeper = p_keep where player_id = p_player and league_id = current_league_id();
end $$;

CREATE OR REPLACE FUNCTION public.draft_reset()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare st draft_state;
begin
  perform _commish();
  select * into st from draft_state for update;
  delete from rosters where acquired = 'draft' and league_id = current_league_id();
  delete from transactions where type = 'draft' and season = st.season;
  update draft_picks set player_id = null, picked_at = null, auto = false where season = st.season;
  update draft_state set status = 'scheduled', current_overall = case when order_set then 1 end,
    deadline = null, paused_remaining = null, started_at = null, updated_at = now()
  where id = 1;
  update league set phase = 'predraft' where phase in ('draft', 'season');
  perform _sys('draft', '🔄 Draft board reset by the commissioner.');
end $$;

CREATE OR REPLACE FUNCTION public.drop_player(p_player integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare me int := _team(); l league;
begin perform _gm_only();
  select * into l from league;
  if l.phase not in ('season', 'predraft') then raise exception 'Drops are closed right now'; end if;
  perform take_snapshots();
  if not exists (select 1 from rosters where player_id = p_player and team_id = me) then raise exception 'Not your player'; end if;
  delete from rosters where player_id = p_player and team_id = me;
  insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_player);
  perform _sys('general', format('➖ %s drop %s', _tname(me), _pname(p_player)));
end $$;

CREATE OR REPLACE FUNCTION public.finalize_keepers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  l league;
  lid int := current_league_id();
  t record;
  msg text := '';
begin
  perform _commish();
  select * into l from league;
  if l.phase <> 'keepers' then raise exception 'Keepers already finalized'; end if;
  -- teams that never submitted keep their best eligible players automatically
  for t in select id from teams where league_id = lid and role = 'gm' and (not keepers_submitted or not exists (select 1 from rosters where team_id = teams.id and keeper)) loop
    update rosters set keeper = true where team_id = t.id and player_id in (
      select player_id from rosters r where r.team_id = t.id
        and (not l.top_scorer_rule or r.player_id is distinct from top_scorer(t.id))
      order by prev_fp desc nulls last limit l.keepers);
  end loop;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'release', team_id, player_id, 'Not kept' from rosters where league_id = lid and not keeper;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'keeper', team_id, player_id, 'Kept for ' || l.season from rosters where league_id = lid and keeper;
  delete from rosters where league_id = lid and not keeper;
  update rosters set acquired = 'keeper', slot = 'BN', keeper = false
  where league_id = lid;
  update league set phase = 'predraft', updated_at = now();
  for t in select id, name from teams where league_id = lid and role = 'gm' order by id loop
    msg := msg || E'\n' || t.name || ': ' || coalesce((
      select string_agg(p.name, ', ' order by r.prev_fp desc nulls last)
      from rosters r join players p on p.id = r.player_id where r.team_id = t.id), '—');
  end loop;
  perform _sys('general', '📋 Keepers are final! Everyone else is back in the pool.' || msg);
end $$;

CREATE OR REPLACE FUNCTION public.move_player(p_player integer, p_slot text, p_swap integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
    update rosters set slot = s_new where player_id = p_swap and team_id = me;
    update rosters set slot = p_slot where player_id = p_player and team_id = me;
  else
    if r.slot = p_slot then return; end if;
    if r.slot = 'IR' and _active_count(me) >= _roster_max() then
      raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.', p.name, _roster_max();
    end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player and team_id = me;
  end if;
  if _active_count(me) > _roster_max() then
    raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.',
      case when r.slot = 'IR' then p.name else q.name end, _roster_max();
  end if;
  -- anyone now on IR drops out of saved future lineups
  delete from lineup_plans lp using rosters x
    where x.team_id = me and x.slot = 'IR' and lp.team_id = me and lp.player_id = x.player_id and lp.date > today_et();
end $$;

CREATE OR REPLACE FUNCTION public.open_markets(p_date date DEFAULT today_et())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
      from players p join rosters r on r.player_id = p.id and r.league_id = coalesce(current_league_id(), 1) left join player_season ps on ps.player_id = p.id
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
end $$;

CREATE OR REPLACE FUNCTION public.set_lineup_plans(p_plans jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
      if v = 'IR' or exists (select 1 from rosters where player_id = k::int and team_id = me and slot = 'IR') then continue; end if;
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

revoke execute on function public.open_markets(date) from public, anon, authenticated;
