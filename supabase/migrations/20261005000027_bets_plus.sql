-- Side bets, round two: bets that settle themselves from the box scores (player over/under, player vs player,
-- team over/under), pool bets where everyone buys in and picks (top SaK team of the week, or a player), live
-- progress for any tracked bet, and a nightly settle job. Real-money bets still settle between GMs; the site
-- keeps the tab.

alter table public.bets drop constraint if exists bets_kind_check;
alter table public.bets add constraint bets_kind_check check (kind in ('custom', 'h2h', 'season', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player'));
alter table public.bets add column if not exists subject jsonb;          -- what's being tracked: {player_id, stat, line, side} / {player_a, player_b} / {line, side} / {} for pools
alter table public.bets add column if not exists entry_close date;       -- pools: last day to buy in
alter table public.bets add column if not exists result jsonb;           -- the numbers it settled on
alter table public.bets add column if not exists push boolean not null default false;   -- a tie: coins refunded, nobody wins

create table if not exists public.bet_entries (
  bet_id bigint not null references public.bets(id) on delete cascade,
  team_id int not null references public.teams(id) on delete cascade,
  choice jsonb not null,            -- {team_id} or {player_id}
  coins int not null check (coins >= 0),
  created_at timestamptz not null default now(),
  primary key (bet_id, team_id)
);
alter table public.bet_entries enable row level security;
revoke all on public.bet_entries from anon, authenticated;
grant select on public.bet_entries to authenticated;
grant all on public.bet_entries to service_role;
drop policy if exists read_all on public.bet_entries;
create policy read_all on public.bet_entries for select to authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.bet_entries; exception when duplicate_object then null; end $$;

-- escrow now includes pool buy-ins
create or replace view public.coin_balances as
  select t.id as team_id,
    coalesce((select sum(amount) from coin_ledger c where c.team_id = t.id), 0)::int as balance,
    (coalesce((select sum(coins) from bets b where b.kind not like 'pool%' and ((b.status = 'open' and b.creator_team = t.id)
      or (b.status = 'accepted' and t.id in (b.creator_team, b.opponent_team)))), 0)
     + coalesce((select sum(e.coins) from bet_entries e join bets b on b.id = e.bet_id where e.team_id = t.id and b.status in ('open', 'accepted')), 0))::int as escrow
  from teams t;
revoke all on public.coin_balances from anon, authenticated;
grant select on public.coin_balances to authenticated;

-- ───────────── the numbers ─────────────
create or replace function public._stat_sum(p_player int, p_stat text, p_start date, p_end date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when p_stat = 'fpts' then fpts else coalesce((stats->>p_stat)::numeric, 0) end), 0)
  from player_games where player_id = p_player and date >= coalesce(p_start, date) and date <= coalesce(p_end, date)
$$;
create or replace function public._team_sum(p_team int, p_start date, p_end date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0) from team_daily where team_id = p_team and date >= coalesce(p_start, date) and date <= coalesce(p_end, date)
$$;

-- where a tracked bet stands right now (any GM can look)
create or replace function public.bet_progress(p_bet bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b bets; s jsonb; out jsonb := '{}';
begin
  select * into b from bets where id = p_bet;
  if b.id is null then return null; end if;
  s := coalesce(b.subject, '{}'::jsonb);
  if b.kind = 'h2h' then
    out := jsonb_build_object('a', _team_sum(b.creator_team, b.start_date, b.end_date), 'b', _team_sum(b.opponent_team, b.start_date, b.end_date));
  elsif b.kind = 'player_ou' then
    out := jsonb_build_object('value', _stat_sum((s->>'player_id')::int, s->>'stat', b.start_date, b.end_date), 'line', (s->>'line')::numeric, 'side', s->>'side');
  elsif b.kind = 'player_vs' then
    out := jsonb_build_object('a', _stat_sum((s->>'player_a')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date), 'b', _stat_sum((s->>'player_b')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date));
  elsif b.kind = 'team_ou' then
    out := jsonb_build_object('value', _team_sum(b.creator_team, b.start_date, b.end_date), 'line', (s->>'line')::numeric, 'side', s->>'side');
  elsif b.kind = 'pool_team' then
    select jsonb_agg(jsonb_build_object('team_id', e.team_id, 'pick', (e.choice->>'team_id')::int, 'value', _team_sum((e.choice->>'team_id')::int, b.start_date, b.end_date), 'coins', e.coins) order by _team_sum((e.choice->>'team_id')::int, b.start_date, b.end_date) desc)
      into out from bet_entries e where e.bet_id = b.id;
    out := jsonb_build_object('entries', coalesce(out, '[]'::jsonb));
  elsif b.kind = 'pool_player' then
    select jsonb_agg(jsonb_build_object('team_id', e.team_id, 'pick', (e.choice->>'player_id')::int, 'value', _stat_sum((e.choice->>'player_id')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date), 'coins', e.coins) order by _stat_sum((e.choice->>'player_id')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date) desc)
      into out from bet_entries e where e.bet_id = b.id;
    out := jsonb_build_object('entries', coalesce(out, '[]'::jsonb));
  end if;
  return out;
end $$;
grant execute on function public.bet_progress(bigint) to authenticated;

-- ───────────── creating the new kinds ─────────────
-- p: {opponent, title, terms, kind, stake, amount, start, end, coins, subject, entry_close}
create or replace function public.create_bet_v2(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); bid bigint; kind text := coalesce(p->>'kind', 'custom'); s jsonb := coalesce(p->'subject', '{}'::jsonb);
  opp int := nullif(p->>'opponent', '')::int; coins int := coalesce((p->>'coins')::int, 0); title text := trim(coalesce(p->>'title', ''));
  st date := nullif(p->>'start', '')::date; en date := nullif(p->>'end', '')::date; pool boolean := kind like 'pool%';
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  if opp = me then raise exception 'You can''t bet yourself'; end if;
  if length(title) < 3 then raise exception 'Give the bet a title'; end if;
  if coins < 0 then raise exception 'Coins must be positive'; end if;
  if coins > _coins_available(me) then raise exception 'You only have % St. Patrick coins available', _coins_available(me); end if;
  if kind in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player') and (st is null or en is null or en < st) then raise exception 'That kind of bet needs a start and end date'; end if;
  if kind = 'player_ou' then
    if not exists (select 1 from players where id = (s->>'player_id')::int) then raise exception 'Pick a player'; end if;
    if s->>'stat' not in ('fpts', 'g', 'a', 'pts', 'ppp', 'sog', 'hit', 'blk', 'pim', 'w', 'sv', 'sho') then raise exception 'Pick a stat'; end if;
    if (s->>'line') is null or s->>'side' not in ('over', 'under') then raise exception 'Set the line and over/under'; end if;
  elsif kind = 'player_vs' then
    if not exists (select 1 from players where id = (s->>'player_a')::int) or not exists (select 1 from players where id = (s->>'player_b')::int) or s->>'player_a' = s->>'player_b' then raise exception 'Pick two different players'; end if;
  elsif kind = 'team_ou' then
    if (s->>'line') is null or s->>'side' not in ('over', 'under') then raise exception 'Set the line and over/under'; end if;
  elsif pool then
    if coins <= 0 then raise exception 'A pool needs a buy-in in coins'; end if;
    if opp is not null then raise exception 'Pools are open to everyone'; end if;
    if kind = 'pool_team' and not exists (select 1 from teams where id = (s->>'team_id')::int and role = 'gm') then raise exception 'Pick the team you think wins'; end if;
    if kind = 'pool_player' and not exists (select 1 from players where id = (s->>'player_id')::int) then raise exception 'Pick your player'; end if;
  end if;
  insert into bets (creator_team, opponent_team, title, terms, kind, stake, amount, start_date, end_date, coins, subject, entry_close)
    values (me, opp, left(title, 140), nullif(trim(coalesce(p->>'terms', '')), ''), kind, nullif(trim(coalesce(p->>'stake', '')), ''), nullif(p->>'amount', '')::numeric, st, en, coins,
      case when pool then s - 'team_id' - 'player_id' else s end, case when pool then coalesce(nullif(p->>'entry_close', '')::date, st) else null end)
    returning id into bid;
  if pool then
    insert into bet_entries (bet_id, team_id, choice, coins) values (bid, me, case when kind = 'pool_team' then jsonb_build_object('team_id', (s->>'team_id')::int) else jsonb_build_object('player_id', (s->>'player_id')::int) end, coins);
    perform _sys('general', format('🎰 %s opened a pool: "%s" · %s ☘️ coins to enter, entries close %s', _tname(me), title, coins, coalesce(nullif(p->>'entry_close', '')::date, st)), jsonb_build_object('bet', bid));
  else
    perform _sys('general', format('🎲 %s %s: "%s"%s', _tname(me),
      case when opp is null then 'posted an open challenge' else 'challenged ' || _tname(opp) end, title,
      coalesce(' · stakes: ' || nullif(concat_ws(' + ', case when coins > 0 then coins || ' ☘️ coins' end, case when nullif(p->>'amount', '')::numeric > 0 then '$' || (p->>'amount') end, nullif(p->>'stake', '')), ''), '')),
      jsonb_build_object('bet', bid));
    if opp is not null then perform _notify(opp, 'bet', format('%s challenged you: %s', _tname(me), title), '/bets'); end if;
  end if;
  return bid;
end $$;
revoke execute on function public.create_bet_v2(jsonb) from public, anon;
grant execute on function public.create_bet_v2(jsonb) to authenticated;

create or replace function public.join_pool(p_bet bigint, p_choice jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  select * into b from bets where id = p_bet for update;
  if b.kind not like 'pool%' or b.status <> 'open' then raise exception 'That pool isn''t open'; end if;
  if b.entry_close < today_et() then raise exception 'Entries closed on %', b.entry_close; end if;
  if exists (select 1 from bet_entries where bet_id = p_bet and team_id = me) then raise exception 'You''re already in'; end if;
  if b.coins > _coins_available(me) then raise exception 'You need % coins to buy in; you have % available', b.coins, _coins_available(me); end if;
  if b.kind = 'pool_team' then
    if not exists (select 1 from teams where id = (p_choice->>'team_id')::int and role = 'gm') then raise exception 'Pick a team'; end if;
    insert into bet_entries (bet_id, team_id, choice, coins) values (p_bet, me, jsonb_build_object('team_id', (p_choice->>'team_id')::int), b.coins);
  else
    if not exists (select 1 from players where id = (p_choice->>'player_id')::int) then raise exception 'Pick a player'; end if;
    if exists (select 1 from bet_entries where bet_id = p_bet and (choice->>'player_id')::int = (p_choice->>'player_id')::int) then raise exception 'Someone already has that player; pick another'; end if;
    insert into bet_entries (bet_id, team_id, choice, coins) values (p_bet, me, jsonb_build_object('player_id', (p_choice->>'player_id')::int), b.coins);
  end if;
  perform _sys('general', format('🎰 %s is in the pool "%s" (%s in, %s ☘️ in the pot)', _tname(me), b.title, (select count(*) from bet_entries where bet_id = p_bet), (select sum(coins) from bet_entries where bet_id = p_bet)), jsonb_build_object('bet', p_bet));
end $$;
revoke execute on function public.join_pool(bigint, jsonb) from public, anon;
grant execute on function public.join_pool(bigint, jsonb) to authenticated;

-- leave a pool while entries are open (the creator can't; cancel the pool instead)
create or replace function public.leave_pool(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet;
  if b.status <> 'open' or b.entry_close < today_et() then raise exception 'Too late to back out'; end if;
  if b.creator_team = me then raise exception 'Cancel the pool instead'; end if;
  delete from bet_entries where bet_id = p_bet and team_id = me;
end $$;
revoke execute on function public.leave_pool(bigint) from public, anon;
grant execute on function public.leave_pool(bigint) to authenticated;

-- ───────────── settling ─────────────
-- decide a tracked two-sided bet from the numbers; null = push
create or replace function public._decide_bet(b bets) returns int
language plpgsql stable security definer set search_path = public as $$
declare p jsonb := bet_progress(b.id); a numeric; bb numeric; v numeric; line numeric;
begin
  if b.kind in ('h2h', 'player_vs') then
    a := (p->>'a')::numeric; bb := (p->>'b')::numeric;
    if a = bb then return null; end if;
    return case when a > bb then b.creator_team else b.opponent_team end;
  elsif b.kind in ('player_ou', 'team_ou') then
    v := (p->>'value')::numeric; line := (p->>'line')::numeric;
    if v = line then return null; end if;
    -- the creator took the side in the subject; the opponent has the other side
    return case when (v > line) = (b.subject->>'side' = 'over') then b.creator_team else b.opponent_team end;
  end if;
  return null;
end $$;

create or replace function public.settle_due_bets() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bets; w int; n int := 0; pot int; best numeric; winners int[]; prog jsonb; e jsonb;
begin
  -- pools close for entries on their own
  update bets set status = 'accepted', accepted_at = now() where kind like 'pool%' and status = 'open' and entry_close < today_et();
  for b in select * from bets where status = 'accepted' and end_date is not null and end_date < today_et() and kind in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player') loop
    prog := bet_progress(b.id);
    if b.kind like 'pool%' then
      select max((x->>'value')::numeric) into best from jsonb_array_elements(prog->'entries') x;
      select array_agg((x->>'team_id')::int) into winners from jsonb_array_elements(prog->'entries') x where (x->>'value')::numeric = best;
      select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = b.id;
      if winners is null or array_length(winners, 1) is null then
        update bets set status = 'cancelled' where id = b.id; continue;
      end if;
      insert into coin_ledger (team_id, amount, reason, bet_id) select team_id, -coins, 'Pool buy-in: ' || b.title, b.id from bet_entries where bet_id = b.id;
      insert into coin_ledger (team_id, amount, reason, bet_id) select x, pot / array_length(winners, 1), 'Won the pool: ' || b.title, b.id from unnest(winners) x;
      update bets set status = 'settled', winner_team = winners[1], settled_at = now(), result = prog || jsonb_build_object('winners', to_jsonb(winners), 'pot', pot) where id = b.id;
      perform _sys('general', format('🎰 Pool "%s" is settled: %s take%s the %s ☘️ pot', b.title, (select string_agg(_tname(x), ' and ') from unnest(winners) x), case when array_length(winners, 1) = 1 then 's' else '' end, pot), jsonb_build_object('bet', b.id));
    else
      w := _decide_bet(b);
      if w is null then
        update bets set status = 'settled', push = true, settled_at = now(), result = prog where id = b.id;
        perform _sys('general', format('🤝 Push: "%s" ended dead even. Coins back to both.', b.title), jsonb_build_object('bet', b.id));
      else
        update bets set status = 'settled', winner_team = w, settled_at = now(), result = prog where id = b.id;
        perform _settle_coins(b.id);
        perform _sys('general', format('🏆 %s wins the bet "%s" (%s)%s', _tname(w), b.title,
          case when b.kind in ('h2h', 'player_vs') then format('%s to %s', round((prog->>'a')::numeric, 1), round((prog->>'b')::numeric, 1)) else format('%s vs the line of %s', round((prog->>'value')::numeric, 1), prog->>'line') end,
          coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end, case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', b.id));
        perform _notify(w, 'bet', format('🏆 You won "%s"', b.title), '/bets');
      end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('settled', n, 'at', now());
end $$;
revoke execute on function public.settle_due_bets(), public._decide_bet(bets), public._stat_sum(int, text, date, date), public._team_sum(int, date, date) from public, anon, authenticated;

-- the creator can cancel an open pool (refunds nothing: coins were only held)
create or replace function public.cancel_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet;
  if b.creator_team <> me or b.status <> 'open' then raise exception 'Only your own open bets can be cancelled'; end if;
  update bets set status = 'cancelled' where id = p_bet;
  delete from bet_entries where bet_id = p_bet;
end $$;
