-- Drops to make room, inside the trade. A 2-for-1 leaves the side that gets two players one over the roster limit.
-- Until now the deal was refused at accept ("drop one first, then accept"), and the side that proposed it was only
-- caught at approval, where the trade errored and sat stuck. Now each side names who it lets go as part of the deal:
-- the proposer when sending it, the other GM (or each GM in a multi-team deal) when accepting. A drop is a trade item
-- with release = true; it happens only if the trade goes through, at the same moment, and the player goes to free agency.
-- Also: the "trade to review" notice now goes to this league's commissioner only.

alter table public.trade_items add column if not exists release boolean not null default false;

-- active roster count after the deal: players in and out, the IR spots that open up, and this team's drops
create or replace function public._trade_active_after(p_trade bigint, p_team int) returns int
language sql stable security definer set search_path = public as $$
  with tr as (select * from trades where id = p_trade),
  items as (
    select i.player_id, i.from_team, i.release,
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
    + (select count(*) from items where dest = p_team and not release)
    - least((select n from ir_free), (select count(*) from items where dest = p_team and not release and slot = 'IR' and _ir_ok(injury_status))))::int
$$;
revoke execute on function public._trade_active_after(bigint, int) from public, anon, authenticated;

-- the drops one team names for a trade: its own players, not already in the deal, and no more than it needs
create or replace function public._trade_add_drops(p_trade bigint, p_team int, p_drops int[]) returns void
language plpgsql security definer set search_path = public as $$
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
  if (select count(*) from rosters where player_id = any (p_drops) and slot <> 'IR') > over then
    raise exception 'You only need to drop % to make room', over;
  end if;
  insert into trade_items (trade_id, from_team, player_id, release) select p_trade, p_team, x, true from unnest(p_drops) x;
end $$;
revoke execute on function public._trade_add_drops(bigint, int, int[]) from public, anon, authenticated;

-- a team that would end up over the limit has to name its drops
create or replace function public._trade_check_room(p_trade bigint, p_team int, p_you boolean) returns void
language plpgsql stable security definer set search_path = public as $$
declare n int := _trade_active_after(p_trade, p_team);
begin
  if n > _roster_max() then
    if p_you then
      raise exception 'You''d have % active players after this trade (max %). Pick % to drop with it.', n, _roster_max(), n - _roster_max();
    end if;
    raise exception '% would have % active players after this trade (max %).', _tname(p_team), n, _roster_max();
  end if;
end $$;
revoke execute on function public._trade_check_room(bigint, int, boolean) from public, anon, authenticated;

-- the old signatures step aside (renamed and locked, so a call by name can only reach the new ones)
do $$ begin
  if to_regprocedure('public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int)') is not null then
    alter function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int) rename to propose_trade_before_drops;
    revoke execute on function public.propose_trade_before_drops(int, int[], int[], int[], int[], text, int, int, int, int) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.respond_trade(bigint, boolean)') is not null then
    alter function public.respond_trade(bigint, boolean) rename to respond_trade_before_drops;
    revoke execute on function public.respond_trade_before_drops(bigint, boolean) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.propose_multi_trade(jsonb, text)') is not null then
    alter function public.propose_multi_trade(jsonb, text) rename to propose_multi_trade_before_drops;
    revoke execute on function public.propose_multi_trade_before_drops(jsonb, text) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.propose_trade(p_to int, p_give int[], p_get int[], p_give_picks int[] default '{}', p_get_picks int[] default '{}', p_note text default null,
  p_give_pickups int default 0, p_get_pickups int default 0, p_give_coins int default 0, p_get_coins int default 0, p_drops int[] default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint;
begin
  perform public._in_league('teams', p_to); perform _gm_only();
  select * into l from league;
  if l.trade_deadline is not null and now() > l.trade_deadline then raise exception 'The trade deadline has passed'; end if;
  if l.phase = 'draft' then raise exception 'No trades during the live draft'; end if;
  if p_to = me then raise exception 'You can''t trade with yourself'; end if;
  if not exists (select 1 from teams where id = p_to and role = 'gm') then raise exception 'Only GMs can be in a trade'; end if;
  p_give := coalesce(p_give, '{}'); p_get := coalesce(p_get, '{}'); p_give_picks := coalesce(p_give_picks, '{}'); p_get_picks := coalesce(p_get_picks, '{}');
  p_give_pickups := greatest(coalesce(p_give_pickups, 0), 0); p_get_pickups := greatest(coalesce(p_get_pickups, 0), 0);
  p_give_coins := greatest(coalesce(p_give_coins, 0), 0); p_get_coins := greatest(coalesce(p_get_coins, 0), 0);
  if cardinality(p_give) + cardinality(p_get) + cardinality(p_give_picks) + cardinality(p_get_picks) + p_give_pickups + p_get_pickups + p_give_coins + p_get_coins = 0 then
    raise exception 'Add something to the trade';
  end if;
  if exists (select 1 from unnest(p_give) x where not exists (select 1 from rosters where player_id = x and team_id = me))
    or exists (select 1 from unnest(p_get) x where not exists (select 1 from rosters where player_id = x and team_id = p_to))
    or exists (select 1 from unnest(p_give_picks) x where not exists (select 1 from draft_picks where id = x and team_id = me and player_id is null))
    or exists (select 1 from unnest(p_get_picks) x where not exists (select 1 from draft_picks where id = x and team_id = p_to and player_id is null)) then
    raise exception 'Some of those assets aren''t owned by the right team';
  end if;
  perform _check_trade_extras(me, p_give_pickups, p_give_coins);
  perform _check_trade_extras(p_to, p_get_pickups, p_get_coins);
  insert into trades (season, from_team, to_team, note) values (l.season, me, p_to, p_note) returning id into tid;
  insert into trade_items (trade_id, from_team, player_id) select tid, me, x from unnest(p_give) x;
  insert into trade_items (trade_id, from_team, player_id) select tid, p_to, x from unnest(p_get) x;
  insert into trade_items (trade_id, from_team, pick_id) select tid, me, x from unnest(p_give_picks) x;
  insert into trade_items (trade_id, from_team, pick_id) select tid, p_to, x from unnest(p_get_picks) x;
  if p_give_pickups > 0 then insert into trade_items (trade_id, from_team, pickups) values (tid, me, p_give_pickups); end if;
  if p_get_pickups > 0 then insert into trade_items (trade_id, from_team, pickups) values (tid, p_to, p_get_pickups); end if;
  if p_give_coins > 0 then insert into trade_items (trade_id, from_team, coins) values (tid, me, p_give_coins); end if;
  if p_get_coins > 0 then insert into trade_items (trade_id, from_team, coins) values (tid, p_to, p_get_coins); end if;
  -- your own roster has to fit: name your drops now (the other GM names theirs when accepting)
  perform _trade_add_drops(tid, me, p_drops);
  perform _trade_check_room(tid, me, true);
  perform _notify(p_to, 'trade', format('%s sent you a trade offer', _tname(me)), '/trades');
  return tid;
end $$;
revoke execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[]) from public, anon;
grant execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[]) to authenticated;

create or replace function public.propose_multi_trade(p_items jsonb, p_note text default null, p_drops int[] default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint; it jsonb; parts int[]; f int; t int; pid int; kid int; pk int; cn int; other int;
begin
  perform _gm_only();
  select * into l from league;
  if l.trade_deadline is not null and now() > l.trade_deadline then raise exception 'The trade deadline has passed'; end if;
  if l.phase = 'draft' then raise exception 'No trades during the live draft'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add something to the trade'; end if;
  select array_agg(distinct x order by x) into parts
    from (select (i->>'from')::int as x from jsonb_array_elements(p_items) i union select (i->>'to')::int from jsonb_array_elements(p_items) i) s;
  if not (me = any (parts)) then raise exception 'You have to be part of your own trade'; end if;
  if array_length(parts, 1) < 2 then raise exception 'A trade needs at least two teams'; end if;
  if exists (select 1 from unnest(parts) x where not exists (select 1 from teams where id = x and role = 'gm')) then raise exception 'Only GMs can be in a trade'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    f := (it->>'from')::int; t := (it->>'to')::int; pid := (it->>'player_id')::int; kid := (it->>'pick_id')::int;
    pk := nullif((it->>'pickups')::int, 0); cn := nullif((it->>'coins')::int, 0);
    if f = t then raise exception 'An asset can''t go to the team that already has it'; end if;
    if (pid is not null)::int + (kid is not null)::int + (pk is not null)::int + (cn is not null)::int <> 1 then raise exception 'Each item is one player, one pick, pickups or coins'; end if;
    if pid is not null and not exists (select 1 from rosters where player_id = pid and team_id = f) then raise exception 'Some of those assets aren''t owned by the right team'; end if;
    if kid is not null and not exists (select 1 from draft_picks where id = kid and team_id = f and player_id is null) then raise exception 'Some of those assets aren''t owned by the right team'; end if;
  end loop;
  for f in select x from unnest(parts) x loop
    perform _check_trade_extras(f,
      (select coalesce(sum((i->>'pickups')::int), 0) from jsonb_array_elements(p_items) i where (i->>'from')::int = f)::int,
      (select coalesce(sum((i->>'coins')::int), 0) from jsonb_array_elements(p_items) i where (i->>'from')::int = f)::int);
  end loop;
  select x into other from unnest(parts) x where x <> me order by x limit 1;
  insert into trades (season, from_team, to_team, note, parties, accepted_by) values (l.season, me, other, p_note, parts, array[me]) returning id into tid;
  insert into trade_items (trade_id, from_team, to_team, player_id, pick_id, pickups, coins)
    select tid, (i->>'from')::int, (i->>'to')::int, (i->>'player_id')::int, (i->>'pick_id')::int, nullif((i->>'pickups')::int, 0), nullif((i->>'coins')::int, 0) from jsonb_array_elements(p_items) i;
  perform _trade_add_drops(tid, me, p_drops);
  perform _trade_check_room(tid, me, true);
  for t in select x from unnest(parts) x where x <> me loop
    perform _notify(t, 'trade', format('%s proposed a %s-team trade with you', _tname(me), array_length(parts, 1)), '/trades');
  end loop;
  return tid;
end $$;
revoke execute on function public.propose_multi_trade(jsonb, text, int[]) from public, anon;
grant execute on function public.propose_multi_trade(jsonb, text, int[]) to authenticated;

create or replace function public.respond_trade(p_trade bigint, p_accept boolean, p_drops int[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); tr trades; c int; t int; waiting text;
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
  -- name your drops with the accept; they go only if the trade does
  perform _trade_add_drops(p_trade, me, p_drops);
  perform _trade_check_room(p_trade, me, true);
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
    for c in select id from teams where is_commish and league_id = tr.league_id loop
      perform _notify(c, 'trade', format('Trade to review: %s ↔ %s', _tname(tr.from_team), _tname(tr.to_team)), '/trades');
    end loop;
    perform _sys('general', format('🤝 %s and %s agreed to a trade. Pending commissioner review.', _tname(tr.from_team), _tname(tr.to_team)));
  else
    for t in select x from unnest(tr.parties) x where x <> me loop
      perform _notify(t, 'trade', 'Everyone accepted the trade. Waiting on commissioner review.', '/trades');
    end loop;
    for c in select id from teams where is_commish and league_id = tr.league_id loop
      perform _notify(c, 'trade', format('%s-team trade to review: %s', array_length(tr.parties, 1), (select string_agg(_tname(x), ', ') from unnest(tr.parties) x)), '/trades');
    end loop;
    perform _sys('general', format('🤝 %s agreed to a %s-team trade. Pending commissioner review.', (select string_agg(_tname(x), ', ') from unnest(tr.parties) x), array_length(tr.parties, 1)));
  end if;
end $$;
revoke execute on function public.respond_trade(bigint, boolean, int[]) from public, anon;
grant execute on function public.respond_trade(bigint, boolean, int[]) to authenticated;

-- carrying out a trade: the drops first (they make the room), then the assets. A roster that no longer fits (a GM
-- added players after accepting) fails the trade with the reason, rather than erroring and leaving it stuck.
create or replace function public._execute_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
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
    delete from rosters where player_id = it.player_id;
    insert into transactions (season, type, team_id, player_id, note) values (tr.season, 'drop', it.from_team, it.player_id, 'To make room for trade #' || p_trade);
  end loop;
  create temp table if not exists _moving (player_id int, dest int, was_ir boolean, ir_ok boolean) on commit drop;
  delete from _moving;
  for it in select * from trade_items where trade_id = p_trade and not release loop
    dest := coalesce(it.to_team, case when it.from_team = tr.from_team then tr.to_team else tr.from_team end);
    if it.player_id is not null then
      insert into _moving select it.player_id, dest, r.slot = 'IR', _ir_ok(pl.injury_status)
        from rosters r join players pl on pl.id = r.player_id where r.player_id = it.player_id;
      update rosters set team_id = dest, slot = 'BN', acquired = 'trade', acquired_at = now() where player_id = it.player_id;
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
      update rosters set slot = 'IR' where player_id = it.player_id;
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
revoke execute on function public._execute_trade(bigint) from public, anon, authenticated;
