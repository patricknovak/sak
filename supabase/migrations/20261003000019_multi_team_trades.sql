-- Trades between three or more teams. A multi-team trade is a normal trades row whose `parties` lists
-- every team involved; each item names the team it goes to. Every party except the proposer has to
-- accept before it goes to the commissioner, exactly like a two-team deal.

alter table public.trades add column if not exists parties int[];
alter table public.trades add column if not exists accepted_by int[] not null default '{}';
alter table public.trade_items add column if not exists to_team int references public.teams;

-- p_items: [{"from": 1, "to": 3, "player_id": 8478402}, {"from": 3, "to": 5, "pick_id": 12}, ...]
create or replace function public.propose_multi_trade(p_items jsonb, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint; it jsonb; parts int[]; f int; t int; pid int; kid int; other int;
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
    if f = t then raise exception 'An asset can''t go to the team that already has it'; end if;
    if (pid is null) = (kid is null) then raise exception 'Each item is one player or one pick'; end if;
    if pid is not null and not exists (select 1 from rosters where player_id = pid and team_id = f) then raise exception 'Some of those assets aren''t owned by the right team'; end if;
    if kid is not null and not exists (select 1 from draft_picks where id = kid and team_id = f and player_id is null) then raise exception 'Some of those assets aren''t owned by the right team'; end if;
  end loop;
  select x into other from unnest(parts) x where x <> me order by x limit 1;
  insert into trades (season, from_team, to_team, note, parties, accepted_by) values (l.season, me, other, p_note, parts, array[me]) returning id into tid;
  insert into trade_items (trade_id, from_team, to_team, player_id, pick_id)
    select tid, (i->>'from')::int, (i->>'to')::int, (i->>'player_id')::int, (i->>'pick_id')::int from jsonb_array_elements(p_items) i;
  for t in select x from unnest(parts) x where x <> me loop
    perform _notify(t, 'trade', format('%s proposed a %s-team trade with you', _tname(me), array_length(parts, 1)), '/trades');
  end loop;
  return tid;
end $$;
revoke execute on function public.propose_multi_trade(jsonb, text) from public, anon;
grant execute on function public.propose_multi_trade(jsonb, text) to authenticated;

-- accepting: two-team trades as before; multi-team trades collect every party's yes
create or replace function public.respond_trade(p_trade bigint, p_accept boolean) returns void
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

-- moving the assets: each item goes to its named team (two-team trades keep the old rule)
create or replace function public._execute_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades; it record; dest int; parts int[]; t int; summary text;
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
  for it in select * from trade_items where trade_id = p_trade loop
    dest := coalesce(it.to_team, case when it.from_team = tr.from_team then tr.to_team else tr.from_team end);
    if it.player_id is not null then
      update rosters set team_id = dest, slot = 'BN', acquired = 'trade', acquired_at = now() where player_id = it.player_id;
      insert into transactions (season, type, team_id, player_id, other_team, note) values (tr.season, 'trade', dest, it.player_id, it.from_team, 'Trade #' || p_trade);
    else
      update draft_picks set team_id = dest where id = it.pick_id;
    end if;
  end loop;
  update trades set status = 'approved', decided_at = now() where id = p_trade;
  -- "A send X to B for Y" for two teams; "A send X to B; B send Y to C" for more
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
end $$;

create or replace function public.review_trade(p_trade bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades; t int;
begin
  perform _commish();
  select * into tr from trades where id = p_trade;
  if tr.status <> 'accepted' then raise exception 'That trade isn''t waiting on review'; end if;
  if p_approve then
    update trades set review_note = p_note where id = p_trade;
    perform _execute_trade(p_trade);
  else
    update trades set status = 'vetoed', decided_at = now(), review_note = p_note where id = p_trade;
    perform _sys('general', format('🚫 Commissioner vetoed the %s trade.%s', (select string_agg(_tname(x), ' ↔ ') from unnest(coalesce(tr.parties, array[tr.from_team, tr.to_team])) x), coalesce(' "' || p_note || '"', '')));
    for t in select x from unnest(coalesce(tr.parties, array[tr.from_team, tr.to_team])) x loop perform _notify(t, 'trade', 'Your trade was vetoed', '/trades'); end loop;
  end if;
end $$;
