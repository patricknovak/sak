-- A counter-offer is its own thing. The site made a counter by declining the offer and sending a new one, so the GM
-- who made the offer was told it was declined, and nothing tied the two together. Now the new offer names the one
-- it answers (trades.counter_of), that offer closes as 'countered' in the same step, and its GM is told "countered
-- your trade offer". Only the GM an offer was made to can counter it, back to the GM who made it, while it's open.
-- propose_trade gains p_counter; the old signature is renamed out of the way (two would make the site's calls
-- ambiguous) and closed to callers.

set client_min_messages = warning;

alter table public.trades add column if not exists counter_of bigint references public.trades (id);
alter table public.trades drop constraint if exists trades_status_check;
alter table public.trades add constraint trades_status_check
  check (status in ('proposed', 'accepted', 'approved', 'declined', 'cancelled', 'vetoed', 'failed', 'countered'));

do $$
begin
  if to_regprocedure('public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[])') is not null then
    alter function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[]) rename to propose_trade_before_counter;
    revoke execute on function public.propose_trade_before_counter(int, int[], int[], int[], int[], text, int, int, int, int, int[]) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.propose_trade(p_to int, p_give int[], p_get int[], p_give_picks int[] default '{}', p_get_picks int[] default '{}', p_note text default null,
  p_give_pickups int default 0, p_get_pickups int default 0, p_give_coins int default 0, p_get_coins int default 0, p_drops int[] default '{}',
  p_counter bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint; o trades;
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
  -- a counter answers an offer made to you, by the GM who made it; that offer closes as countered
  if p_counter is not null then
    perform public._in_league('trades', p_counter);
    select * into o from trades where id = p_counter for update;
    if o.status is distinct from 'proposed' or o.parties is not null or o.to_team <> me or o.from_team <> p_to then
      raise exception 'You can only counter an open offer made to you';
    end if;
  end if;
  perform _check_trade_extras(me, p_give_pickups, p_give_coins);
  perform _check_trade_extras(p_to, p_get_pickups, p_get_coins);
  insert into trades (season, from_team, to_team, note, counter_of) values (l.season, me, p_to, p_note, p_counter) returning id into tid;
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
  if p_counter is not null then
    update trades set status = 'countered', responded_at = now() where id = p_counter;
    perform _notify(p_to, 'trade', format('%s countered your trade offer', _tname(me)), '/trades');
  else
    perform _notify(p_to, 'trade', format('%s sent you a trade offer', _tname(me)), '/trades');
  end if;
  return tid;
end $$;
revoke execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[], bigint) from public, anon;
grant execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int, int[], bigint) to authenticated;
