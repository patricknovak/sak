-- Alerts for prediction pools (docs/POOLS.md section 6: the test passes if two thirds of players call in three of the
-- four drop weeks, so the pool has to tell them when there is something to do). Four kinds, each a notifications row,
-- which the push trigger sends to the member's phone when alerts are on, opening that pool's page:
--   * coins dropped: every member when a scheduled drop is paid (not the catch-up a late joiner gets for drops before
--     they came), with how many questions are open
--   * new questions: the members when the host asks one; a burst of them (the questions after a drop) folds into one
--     alert that counts them, so a host writing six questions sends one ping, not six
--   * closing soon: a member who hasn't called a question that closes in the next six hours, once per question
--   * settled: everyone who held a position, with what they won, or the refund when a question is voided
-- Triggers on the pool tables do it, so the functions that pay drops, ask and settle questions are unchanged; the
-- hourly drop job also sends the closing reminders.

create or replace function public._pool_alert(p_team int, p_kind text, p_body text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (league_id, team_id, kind, body, link)
  select t.league_id, t.id, p_kind, left(p_body, 300), p_link from teams t where t.id = p_team and t.user_id is not null
$$;
revoke execute on function public._pool_alert(int, text, text, text) from public, anon, authenticated;

-- coins dropped: the ledger line a drop pays; only a drop paid within the last few hours, to a member who was already in
create or replace function public._pool_alert_drop() returns trigger
language plpgsql security definer set search_path = public as $$
declare did bigint; d pool_drops; coin text; open_n int;
begin
  if new.reason not like 'Coin drop:%' then return new; end if;
  did := nullif(substring(new.reason from '\[drop (\d+)\]$'), '')::bigint;
  select * into d from pool_drops where id = did;
  if d.id is null or d.at < now() - interval '3 hours' then return new; end if;
  if (select min(created_at) from coin_ledger where team_id = new.team_id) >= d.at then return new; end if;
  coin := _brand_word('{coin,name}', 'coins', d.league_id);
  open_n := (select count(*) from pool_markets where league_id = d.league_id and status = 'open' and closes_at > now());
  perform _pool_alert(new.team_id, 'pool_drop',
    format('🪙 %s %s dropped: %s.%s', new.amount, coin, d.note,
      case when open_n = 1 then ' One question is open to call.' when open_n > 1 then format(' %s questions are open to call.', open_n) else '' end),
    '/questions');
  return new;
end $$;
revoke execute on function public._pool_alert_drop() from public, anon, authenticated;
drop trigger if exists coin_ledger_pool_drop_alert on public.coin_ledger;
create trigger coin_ledger_pool_drop_alert after insert on public.coin_ledger
  for each row when (new.reason like 'Coin drop:%') execute function public._pool_alert_drop();

-- new questions: one alert per member, counting the burst while it is still unread
create or replace function public._pool_alert_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; n record; c int;
begin
  -- a pack's questions arrive with the pool itself, before anyone else is in
  if new.pack is not null or new.status <> 'open' then return new; end if;
  for t in select id from teams where league_id = new.league_id and role = 'gm' and user_id is not null and id is distinct from new.created_by loop
    select * into n from notifications where team_id = t.id and kind = 'pool_new' and not read and created_at > now() - interval '6 hours'
      order by id desc limit 1;
    if n.id is null then
      perform _pool_alert(t.id, 'pool_new', format('🔮 New question: %s', new.title), '/q/' || new.id);
    else
      c := coalesce(nullif(substring(n.body from '^🔮 (\d+) new questions'), '')::int, 1) + 1;
      update notifications set body = format('🔮 %s new questions to call, the latest: %s', c, left(new.title, 160)), link = '/questions' where id = n.id;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._pool_alert_new() from public, anon, authenticated;
drop trigger if exists pool_markets_new_alert on public.pool_markets;
create trigger pool_markets_new_alert after insert on public.pool_markets
  for each row execute function public._pool_alert_new();

-- settled: everyone who held a position hears how it went
create or replace function public._pool_alert_settled() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; lbl text;
begin
  if new.status = old.status or new.status not in ('resolved', 'void') then return new; end if;
  lbl := case when new.status = 'resolved' then _pool_label(new, new.winner_key) end;
  for r in select team_id, sum(paid) paid, sum(cost) cost, bool_or(outcome = new.winner_key and shares >= 1) won
           from pool_positions where market_id = new.id group by team_id having sum(cost) > 0 or sum(paid) > 0 loop
    perform _pool_alert(r.team_id, 'pool_settled',
      case when new.status = 'void' then format('↩️ Voided: %s. Your %s came back.', new.title, ceil(r.cost)::int)
           when r.won then format('✅ Called it: %s → %s. You won %s.', new.title, lbl, r.paid::int)
           else format('🔮 Settled: %s → %s.', new.title, lbl) end,
      '/q/' || new.id);
  end loop;
  return new;
end $$;
revoke execute on function public._pool_alert_settled() from public, anon, authenticated;
drop trigger if exists pool_markets_settled_alert on public.pool_markets;
create trigger pool_markets_settled_alert after update of status on public.pool_markets
  for each row execute function public._pool_alert_settled();

-- closing soon: once per member per question, six hours out, for a question they haven't called
create table if not exists private.pool_nudged (
  market_id bigint not null,
  team_id int not null,
  at timestamptz not null default now(),
  primary key (market_id, team_id)
);
revoke all on private.pool_nudged from public, anon, authenticated;

create or replace function public._pool_nudge_closing(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare t record; ms record; n int := 0; cnt int; first_m record;
begin
  for t in select id from teams where league_id = p_league and role = 'gm' and user_id is not null loop
    cnt := 0; first_m := null;
    for ms in select m.id, m.title, m.closes_at from pool_markets m
              where m.league_id = p_league and m.status = 'open' and m.closes_at > now() and m.closes_at <= now() + interval '6 hours'
                and not exists (select 1 from pool_positions p where p.market_id = m.id and p.team_id = t.id and (p.shares > 0 or p.cost > 0))
                and not exists (select 1 from private.pool_nudged x where x.market_id = m.id and x.team_id = t.id)
              order by m.closes_at loop
      insert into private.pool_nudged (market_id, team_id) values (ms.id, t.id) on conflict do nothing;
      cnt := cnt + 1;
      if first_m is null then first_m := ms; end if;
    end loop;
    if cnt = 1 then
      perform _pool_alert(t.id, 'pool_closing', format('⏰ Closes in %s: %s. You haven''t called it yet.',
        case when first_m.closes_at - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from first_m.closes_at - now()) / 3600))::int || 'h' end,
        first_m.title), '/q/' || first_m.id);
      n := n + 1;
    elsif cnt > 1 then
      perform _pool_alert(t.id, 'pool_closing', format('⏰ %s questions close in the next few hours and you haven''t called them yet.', cnt), '/questions');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_nudge_closing(int) from public, anon, authenticated;

-- the hourly pass pays the drops that are due, then sends the closing reminders
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id())
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
