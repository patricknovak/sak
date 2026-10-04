-- Prediction pools (docs/POOLS.md, Patrick's direction of 4 October 2026): the interface of a prediction market for a
-- private pool, played in the pool's coins, never money.
--
-- * A question has two to twelve answers. Its prices come from a market maker (the logarithmic market scoring rule):
--   they always add to 100%, every pick moves them, and anyone can buy or sell an answer until the question closes. A
--   share of the right answer pays one coin; the maker is the pool's, funded with new coins (at most b·ln(n) a
--   question), so nobody in the pool is the house. b is sized to the pool so ten friends still see the price move.
-- * A cap per question, coin drops on a schedule (every member, late joiners caught up), and a leaderboard by net worth
--   (coins plus shares at today's prices) with the hit rate beside it, so the biggest bankroll is not the strategy.
-- * The host writes how a question resolves when it is made (locked once anyone trades) and resolves it with a reason
--   that goes to the chat. Void refunds every stake, even after a resolution (payouts are taken back first).
-- * Any league can run questions (a fantasy league's Markets tab); a league of kind 'predict' is questions only, with
--   none of the sport machinery (no Book, no lineups, no Garry posts), and its open invite link seats whoever joins.
-- * Question packs (pool_packs) are shared like the sports rows: a pool loads one (the Love Is Blind Season 11 pack below)
--   and gets its questions and coin drops.

set client_min_messages = warning;

-- ───────────── a league's kind ─────────────
alter table public.leagues add column if not exists kind text not null default 'fantasy';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leagues_kind_check') then
    alter table public.leagues add constraint leagues_kind_check check (kind in ('fantasy', 'predict'));
  end if;
end $$;

-- ───────────── the tables ─────────────
create table if not exists public.pool_markets (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  title text not null check (length(title) between 3 and 160),
  rule text not null default '',                 -- how it resolves; locked once anyone has traded
  category text,                                 -- a pack's grouping: 'The whole season', 'Drop 2 · Oct 21'
  outcomes jsonb not null,                       -- [{key, label}]
  q jsonb not null,                              -- shares sold of each answer, by key
  b numeric not null check (b between 20 and 5000),
  max_stake int not null default 500 check (max_stake between 10 and 100000),
  status text not null default 'open' check (status in ('open', 'resolved', 'void')),
  closes_at timestamptz not null,
  winner_key text,
  note text,                                     -- the host's reason, with the resolution
  created_by int references public.teams (id) on delete set null,
  pack text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists pool_markets_league on public.pool_markets (league_id, status, closes_at);

create table if not exists public.pool_positions (
  league_id int not null default public.current_league_id() references public.leagues (id),
  market_id bigint not null references public.pool_markets (id) on delete cascade,
  team_id int not null references public.teams (id) on delete cascade,
  outcome text not null,
  shares numeric not null default 0,
  cost numeric not null default 0,               -- coins put in, less coins taken out by selling
  paid int not null default 0,                   -- coins paid out at the resolution (taken back if it is voided)
  primary key (market_id, team_id, outcome)
);
create index if not exists pool_positions_team on public.pool_positions (league_id, team_id);

create table if not exists public.pool_trades (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  market_id bigint not null references public.pool_markets (id) on delete cascade,
  team_id int not null references public.teams (id) on delete cascade,
  outcome text not null,
  shares numeric not null,                       -- + bought, - sold
  coins int not null,                            -- + spent, - received
  prices jsonb not null,                         -- every answer's price after the trade: the chart
  created_at timestamptz not null default now()
);
create index if not exists pool_trades_market on public.pool_trades (market_id, created_at);

create table if not exists public.pool_drops (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  at timestamptz not null,
  amount int not null check (amount between 1 and 100000),
  note text not null,
  created_at timestamptz not null default now()
);
create index if not exists pool_drops_league on public.pool_drops (league_id, at);

-- shared: question packs a pool can load (questions with closing times, coin drops, a suggested brand)
create table if not exists public.pool_packs (
  slug text primary key,
  name text not null,
  brand jsonb not null default '{}',
  markets jsonb not null default '[]',
  drops jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- row-level security: a pool reads its own questions, positions, trades and drops (positions are public inside a pool,
-- the way a market's holders are); every write goes through the functions below
do $$ declare t text; begin
  foreach t in array array['pool_markets', 'pool_positions', 'pool_trades', 'pool_drops'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = format('public.%I', t)::regclass and polname = 'league_read') then
      execute format('create policy league_read on public.%I for select to authenticated using (league_id = (select current_league_id()))', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_positions'::regclass and tgname = 'pool_positions_stamp_league') then
    create trigger pool_positions_stamp_league before insert on public.pool_positions for each row execute function public._stamp_league();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.pool_trades'::regclass and tgname = 'pool_trades_stamp_league') then
    create trigger pool_trades_stamp_league before insert on public.pool_trades for each row execute function public._stamp_league();
  end if;
end $$;
alter table public.pool_packs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.pool_packs'::regclass and polname = 'read_all') then
    create policy read_all on public.pool_packs for select to authenticated using (true);
  end if;
end $$;
revoke all on public.pool_packs from anon, authenticated;
grant select on public.pool_packs to authenticated;

-- ───────────── the market maker ─────────────
-- cost C(q) = b·ln(Σ e^(q_i/b)), computed with the largest q taken out so nothing overflows
create or replace function public._lmsr_cost(p_q jsonb, p_b numeric) returns double precision
language sql immutable set search_path = public as $$
  with v as (select (value)::double precision x from jsonb_each_text(p_q)), m as (select max(x) mx from v)
  select max(m.mx) + p_b * ln(sum(exp((v.x - m.mx) / p_b))) from v, m
$$;

-- every answer's price (the market's chance of it), adding to 1
create or replace function public.pool_prices(p_q jsonb, p_b numeric) returns jsonb
language sql immutable set search_path = public as $$
  with v as (select key k, (value)::double precision x from jsonb_each_text(p_q)), m as (select max(x) mx from v),
  e as (select k, exp((x - mx) / p_b) w from v, m), t as (select sum(w) tot from e)
  select jsonb_object_agg(k, round((w / tot)::numeric, 6)) from e, t
$$;

-- the shares that a stake of p_coins buys of one answer: solve C(q') - C(q) = coins for q'_i
create or replace function public._lmsr_buy_shares(p_q jsonb, p_b numeric, p_key text, p_coins numeric) returns numeric
language sql immutable set search_path = public as $$
  with v as (select key k, (value)::double precision x from jsonb_each_text(p_q)), m as (select max(x) mx from v),
  s as (select sum(exp((v.x - m.mx) / p_b)) s, max(case when v.k = p_key then exp((v.x - m.mx) / p_b) end) si,
               max(case when v.k = p_key then v.x end) qi, max(m.mx) mx from v, m)
  select (mx + p_b * ln(s * (exp(p_coins / p_b) - 1) + si) - qi)::numeric from s
$$;

-- a pool's liquidity: 30 per member, between 60 and 600 (ten friends with 1,000 coins move a price by a stake of 100)
create or replace function public._pool_default_b(p_league int) returns numeric
language sql stable set search_path = public as $$
  select greatest(60, least(600, 30 * (select count(*) from teams where league_id = p_league and role = 'gm')))::numeric
$$;

create or replace function public._pool_label(m public.pool_markets, p_key text) returns text
language sql immutable set search_path = public as $$
  select o->>'label' from jsonb_array_elements(m.outcomes) o where o->>'key' = p_key
$$;

-- ───────────── making questions ─────────────
-- p: {title, rule, category, outcomes: ["Yes","No"] or [{label}], closes_at, b, max_stake, sort}
create or replace function public._pool_insert_market(p_league int, p jsonb, p_by int, p_pack text) returns bigint
language plpgsql security definer set search_path = public as $$
declare opts jsonb := coalesce(p->'outcomes', '[]'::jsonb); n int; outs jsonb; mid bigint; closes timestamptz;
begin
  n := jsonb_array_length(opts);
  if length(btrim(coalesce(p->>'title', ''))) < 3 then raise exception 'Give the question a title'; end if;
  if n < 2 or n > 12 then raise exception 'Two to twelve answers'; end if;
  select jsonb_agg(jsonb_build_object('key', 'a' || i, 'label', left(btrim(coalesce(x->>'label', x #>> '{}')), 60)) order by i)
    into outs from jsonb_array_elements(opts) with ordinality t(x, i);
  if exists (select 1 from jsonb_array_elements(outs) o where length(o->>'label') < 1) then raise exception 'Every answer needs words'; end if;
  if (select count(distinct lower(o->>'label')) from jsonb_array_elements(outs) o) < n then raise exception 'Two answers say the same thing'; end if;
  closes := nullif(p->>'closes_at', '')::timestamptz;
  if closes is null then raise exception 'When does it close?'; end if;
  insert into pool_markets (league_id, title, rule, category, outcomes, q, b, max_stake, closes_at, created_by, pack, sort)
  values (p_league, left(btrim(p->>'title'), 160), left(btrim(coalesce(p->>'rule', '')), 600), nullif(left(btrim(coalesce(p->>'category', '')), 40), ''),
          outs, (select jsonb_object_agg(o->>'key', 0) from jsonb_array_elements(outs) o),
          coalesce(nullif(p->>'b', '')::numeric, _pool_default_b(p_league)), coalesce(nullif(p->>'max_stake', '')::int, 500),
          closes, p_by, p_pack, coalesce(nullif(p->>'sort', '')::int, 0))
  returning pool_markets.id into mid;
  return mid;
end $$;
revoke execute on function public._pool_insert_market(int, jsonb, int, text) from public, anon, authenticated;

-- the host makes a question (or any member, where the pool lets members ask: features.member_markets)
create or replace function public.pool_create(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); mid bigint;
begin
  if not exists (select 1 from teams t where t.id = me and t.is_commish)
     and not coalesce((select (features->>'member_markets')::boolean from league_rules where league_id = current_league_id()), false) then
    raise exception 'The host asks the questions in this pool';
  end if;
  if nullif(p->>'closes_at', '')::timestamptz <= now() then raise exception 'Close it in the future'; end if;
  mid := _pool_insert_market(current_league_id(), p, me, null);
  perform _sys('general', format('🔮 New question: "%s" · %s', left(btrim(p->>'title'), 160),
    (select string_agg(coalesce(x->>'label', x #>> '{}'), ' · ') from jsonb_array_elements(p->'outcomes') x)), jsonb_build_object('pool_market', mid));
  return mid;
end $$;

-- the host changes a question: the closing time always; the words, answers' labels and rule only before anyone trades
create or replace function public.pool_edit(p_market bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m pool_markets; traded boolean;
begin
  perform _in_league('pool_markets', p_market);
  perform _commish();
  select * into m from pool_markets where id = p_market for update;
  if m.status <> 'open' then raise exception 'That question is settled'; end if;
  traded := exists (select 1 from pool_trades where market_id = p_market);
  if traded and (p ? 'title' or p ? 'rule') and (coalesce(p->>'title', m.title) <> m.title or coalesce(p->>'rule', m.rule) <> m.rule) then
    raise exception 'People have traded on it, so the question and its rule stay as they are';
  end if;
  update pool_markets set
    title = coalesce(nullif(left(btrim(p->>'title'), 160), ''), title),
    rule = coalesce(left(btrim(p->>'rule'), 600), rule),
    category = case when p ? 'category' then nullif(left(btrim(p->>'category'), 40), '') else category end,
    closes_at = coalesce(nullif(p->>'closes_at', '')::timestamptz, closes_at),
    sort = coalesce(nullif(p->>'sort', '')::int, sort)
  where id = p_market;
end $$;

-- ───────────── trading ─────────────
create or replace function public.pool_buy(p_market bigint, p_outcome text, p_coins int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me int; m pool_markets; sh numeric; staked numeric; before jsonb; after jsonb; free int;
begin
  perform _in_league('pool_markets', p_market);
  perform _gm_only();
  me := _team();
  select * into m from pool_markets where id = p_market for update;
  if m.id is null then raise exception 'No such question'; end if;
  if m.status <> 'open' or m.closes_at <= now() then raise exception 'That question is closed'; end if;
  if not (m.q ? p_outcome) then raise exception 'Pick one of the answers'; end if;
  if coalesce(p_coins, 0) < 1 then raise exception 'Put at least one coin on it'; end if;
  select coalesce(sum(cost), 0) into staked from pool_positions where market_id = p_market and team_id = me;
  if staked + p_coins > m.max_stake then
    raise exception 'Up to % coins on one question (you have % on it)', m.max_stake, greatest(round(staked), 0);
  end if;
  free := _coins_free(me);
  if p_coins > free then raise exception 'You have % coins to spend', greatest(free, 0); end if;
  sh := round(_lmsr_buy_shares(m.q, m.b, p_outcome, p_coins), 6);
  before := pool_prices(m.q, m.b);
  update pool_markets set q = jsonb_set(q, array[p_outcome], to_jsonb(round((q->>p_outcome)::numeric + sh, 6)))
  where id = p_market returning q into m.q;
  after := pool_prices(m.q, m.b);
  insert into pool_positions (league_id, market_id, team_id, outcome, shares, cost) values (m.league_id, p_market, me, p_outcome, sh, p_coins)
  on conflict (market_id, team_id, outcome) do update set shares = pool_positions.shares + excluded.shares, cost = pool_positions.cost + excluded.cost;
  insert into pool_trades (league_id, market_id, team_id, outcome, shares, coins, prices) values (m.league_id, p_market, me, p_outcome, sh, p_coins, after);
  insert into coin_ledger (team_id, amount, reason) values (me, -p_coins, format('Called it: %s · %s', m.title, _pool_label(m, p_outcome)));
  return jsonb_build_object('shares', sh, 'pays', floor(sh), 'before', before, 'after', after);
end $$;

-- sell shares back to the market (all of them when p_shares is null)
create or replace function public.pool_sell(p_market bigint, p_outcome text, p_shares numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me int; m pool_markets; pos pool_positions; d numeric; newq jsonb; got int; after jsonb;
begin
  perform _in_league('pool_markets', p_market);
  perform _gm_only();
  me := _team();
  select * into m from pool_markets where id = p_market for update;
  if m.id is null then raise exception 'No such question'; end if;
  if m.status <> 'open' or m.closes_at <= now() then raise exception 'That question is closed'; end if;
  select * into pos from pool_positions where market_id = p_market and team_id = me and outcome = p_outcome for update;
  if pos.market_id is null or pos.shares <= 0 then raise exception 'You hold none of that answer'; end if;
  d := least(coalesce(p_shares, pos.shares), pos.shares);
  if d <= 0 then raise exception 'Sell more than nothing'; end if;
  newq := jsonb_set(m.q, array[p_outcome], to_jsonb(round((m.q->>p_outcome)::numeric - d, 6)));
  got := floor(_lmsr_cost(m.q, m.b) - _lmsr_cost(newq, m.b));
  update pool_markets set q = newq where id = p_market;
  after := pool_prices(newq, m.b);
  update pool_positions set shares = round(shares - d, 6), cost = cost - got where market_id = p_market and team_id = me and outcome = p_outcome;
  insert into pool_trades (league_id, market_id, team_id, outcome, shares, coins, prices) values (m.league_id, p_market, me, p_outcome, -d, -got, after);
  if got > 0 then
    insert into coin_ledger (team_id, amount, reason) values (me, got, format('Sold: %s · %s', m.title, _pool_label(m, p_outcome)));
  end if;
  return jsonb_build_object('shares', d, 'coins', got, 'after', after);
end $$;

-- ───────────── resolving ─────────────
-- p_winner: an answer's key pays one coin a share; null voids it and refunds every stake. A resolved question can be
-- voided later (the payouts are taken back, then the stakes refunded); a void one stays void.
create or replace function public.pool_resolve(p_market bigint, p_winner text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m pool_markets; r record; lbl text;
begin
  perform _in_league('pool_markets', p_market);
  perform _commish();
  select * into m from pool_markets where id = p_market for update;
  if m.id is null then raise exception 'No such question'; end if;
  if m.status = 'void' then raise exception 'That question was voided'; end if;
  if m.status = 'resolved' and p_winner is not null then raise exception 'It is settled; void it to start over'; end if;
  if p_winner is not null and not (m.q ? p_winner) then raise exception 'Pick one of the answers, or void it'; end if;
  if p_winner is null then
    -- take back what a resolution paid, then refund what each member still had in
    for r in select team_id, sum(paid) paid, sum(cost) cost from pool_positions where market_id = p_market group by team_id loop
      if r.paid > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, -r.paid, format('Taken back (voided): %s', m.title)); end if;
      if r.cost > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, ceil(r.cost)::int, format('Refund (voided): %s', m.title)); end if;
    end loop;
    update pool_positions set paid = 0 where market_id = p_market;
    update pool_markets set status = 'void', winner_key = null, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
    perform _sys('general', format('🔮 Voided: "%s"; every stake refunded%s', m.title, coalesce(' · ' || nullif(btrim(p_note), ''), '')), jsonb_build_object('pool_market', p_market));
    return;
  end if;
  lbl := _pool_label(m, p_winner);
  for r in select team_id, shares from pool_positions where market_id = p_market and outcome = p_winner and floor(shares) > 0 loop
    insert into coin_ledger (team_id, amount, reason) values (r.team_id, floor(r.shares)::int, format('Paid: %s · %s', m.title, lbl));
    update pool_positions set paid = floor(r.shares)::int where market_id = p_market and team_id = r.team_id and outcome = p_winner;
  end loop;
  update pool_markets set status = 'resolved', winner_key = p_winner, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
  perform _sys('general', format('✅ Settled: "%s" → %s%s', m.title, lbl, coalesce(' · ' || nullif(btrim(p_note), ''), '')), jsonb_build_object('pool_market', p_market));
end $$;

-- ───────────── coins on a schedule ─────────────
-- pay every member each drop that is due and not yet paid to them (a late joiner gets the ones before they came)
create or replace function public._pool_pay_drops(p_league int, p_team int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d record; t record; n int := 0; tag text;
begin
  for d in select * from pool_drops where league_id = p_league and at <= now() order by at loop
    tag := '[drop ' || d.id || ']';
    for t in select id from teams where league_id = p_league and role = 'gm' and (p_team is null or id = p_team) loop
      if not exists (select 1 from coin_ledger where team_id = t.id and reason like '%' || tag) then
        insert into coin_ledger (team_id, amount, reason) values (t.id, d.amount, format('Coin drop: %s %s', d.note, tag));
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_pay_drops(int, int) from public, anon, authenticated;

-- the scheduler's pass, one league at a time (run_league_jobs('pool-drops'))
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$ select _pool_pay_drops(current_league_id()) $$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

-- the host schedules a drop (or pays one now: p_at in the past or null)
create or replace function public.pool_add_drop(p_amount int, p_note text, p_at timestamptz default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare did bigint;
begin
  perform _commish();
  if length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'Say what the drop is for'; end if;
  insert into pool_drops (league_id, at, amount, note) values (current_league_id(), coalesce(p_at, now()), p_amount, left(btrim(p_note), 80))
  returning pool_drops.id into did;
  perform _pool_pay_drops(current_league_id());
  return did;
end $$;

-- ───────────── packs ─────────────
create or replace function public._pool_load_pack(p_league int, p_slug text, p_by int) returns int
language plpgsql security definer set search_path = public as $$
declare pk pool_packs; x jsonb; n int := 0;
begin
  select * into pk from pool_packs where slug = p_slug;
  if pk.slug is null then raise exception 'No such pack'; end if;
  for x in select * from jsonb_array_elements(pk.markets) loop
    if not exists (select 1 from pool_markets where league_id = p_league and pack = p_slug and title = x->>'title') then
      perform _pool_insert_market(p_league, x, p_by, p_slug);
      n := n + 1;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(pk.drops) loop
    if not exists (select 1 from pool_drops where league_id = p_league and note = x->>'note' and at = (x->>'at')::timestamptz) then
      insert into pool_drops (league_id, at, amount, note) values (p_league, (x->>'at')::timestamptz, (x->>'amount')::int, x->>'note');
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_load_pack(int, text, int) from public, anon, authenticated;

create or replace function public.pool_load_pack(p_slug text) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  return _pool_load_pack(current_league_id(), p_slug, my_team());
end $$;

-- the platform opens a prediction pool: a league of kind 'predict' with the host's seat, a pack's questions, drops
-- and brand; friends join through the host's open link (pool_invite_link)
create or replace function public.platform_open_pool(p_slug text, p_name text, p_short text, p_pack text default null) returns int
language plpgsql security definer set search_path = public as $$
declare nid int; br jsonb;
begin
  if not is_platform_admin() then raise exception 'Only the platform can open a pool'; end if;
  br := coalesce((select brand from pool_packs where slug = p_pack), '{}'::jsonb);
  nid := create_league(p_slug, p_name, p_short, br, 1, 1);
  update leagues set kind = 'predict' where id = nid;
  update league_rules set phase = 'season', features = coalesce(features, '{}'::jsonb) - 'money' - 'fund' where league_id = nid;
  update teams set name = 'Host', abbrev = 'HST', emoji = '🔮' where league_id = nid;
  if p_pack is not null then perform _pool_load_pack(nid, p_pack, null); end if;
  return nid;
end $$;

-- the host's open link: anyone with it joins and gets a seat of their own (prediction pools only)
create or replace function public.pool_invite_link(p_days int default 30, p_uses int default 50) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  perform _commish();
  if (select kind from leagues where id = current_league_id()) <> 'predict' then raise exception 'Open links are for prediction pools'; end if;
  code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values (code, current_league_id(), null, 'gm', auth.uid(), now() + make_interval(days => greatest(p_days, 1)), greatest(least(p_uses, 500), 1));
  return code;
end $$;

-- the join: as before, plus an open link in a prediction pool seats the newcomer on a team of their own, with the
-- opening coins and every drop so far
create or replace function public._accept_invite(p_user uuid, p_code text, p_name text default null) returns int
language plpgsql security definer set search_path = public as $$
declare inv league_invites; em text; ab text; tid int; nm text; colors text[] := array['#fb7185', '#f472b6', '#c084fc', '#38bdf8', '#34d399', '#fbbf24', '#f97316', '#a78bfa'];
begin
  if p_user is null then raise exception 'Sign in first'; end if;
  select * into inv from league_invites where code = lower(trim(p_code)) for update;
  if inv.code is null or inv.revoked or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'That invite is no longer good';
  end if;
  if exists (select 1 from league_members where user_id = p_user and league_id = inv.league_id) then
    raise exception 'You are already in this league';
  end if;
  select email into em from auth.users where id = p_user;
  nm := nullif(left(btrim(coalesce(p_name, '')), 40), '');
  if inv.team_id is not null then
    if exists (select 1 from teams where id = inv.team_id and user_id is not null) then
      raise exception 'That seat has been taken';
    end if;
    update teams set user_id = p_user, login_email = coalesce(login_email, em),
      gm_name = case when lower(gm_name) = 'open seat' then coalesce(nm, split_part(em, '@', 1), gm_name) else gm_name end
    where id = inv.team_id;
    tid := inv.team_id;
  elsif inv.role = 'gm' and (select kind from leagues where id = inv.league_id) = 'predict' then
    -- an open link into a prediction pool: a seat of their own
    nm := coalesce(nm, split_part(em, '@', 1), 'Player');
    ab := coalesce(nullif(upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), ''), 'PLR');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (nm, ab, nm, em, p_user, inv.league_id, colors[1 + floor(random() * array_length(colors, 1))::int], '✨', 'gm',
            (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || _brand_word('{coin,name}', 'coins', inv.league_id));
    perform _pool_pay_drops(inv.league_id, tid);
  else
    -- a spectator place: a team row with no roster, the way commish_add_spectator makes one
    nm := coalesce(nm, split_part(em, '@', 1), 'Spectator');
    ab := coalesce(nullif(upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), ''), 'SPC');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (nm, ab, nm, em, p_user, inv.league_id,
            '#64748b', '🍿', 'spectator', (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
  end if;
  update league_invites set uses = uses + 1 where code = inv.code;
  insert into accounts (user_id, active_league_id) values (p_user, inv.league_id)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return inv.league_id;
end $$;
revoke execute on function public._accept_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public._accept_invite(uuid, text, text) to service_role;

-- ───────────── the leaderboard ─────────────
-- every member: coins, what their open shares are worth at today's prices, net worth, questions called and hit
create or replace function public.pool_leaders() returns table (team_id int, coins int, holdings numeric, worth numeric, calls int, hits int, trades int)
language sql stable set search_path = public as $$
  with lg as (select current_league_id() lid),
  t as (select id from teams, lg where league_id = lg.lid and role = 'gm'),
  ov as (select p.team_id, sum(p.shares * (pool_prices(m.q, m.b)->>p.outcome)::numeric) v
         from pool_positions p join pool_markets m on m.id = p.market_id, lg
         where p.league_id = lg.lid and m.status = 'open' and p.shares > 0 group by p.team_id),
  rs as (select p.team_id, count(distinct p.market_id)::int calls, count(distinct p.market_id) filter (where m.winner_key = p.outcome)::int hits
         from pool_positions p join pool_markets m on m.id = p.market_id, lg
         where p.league_id = lg.lid and m.status = 'resolved' and (p.shares > 0 or p.paid > 0) group by p.team_id),
  tr as (select tt.team_id, count(*)::int n from pool_trades tt, lg where tt.league_id = lg.lid group by tt.team_id)
  select t.id, coalesce(cb.balance, 0), round(coalesce(ov.v, 0), 1), round(coalesce(cb.balance, 0) + coalesce(ov.v, 0), 1),
         coalesce(rs.calls, 0), coalesce(rs.hits, 0), coalesce(tr.n, 0)
  from t left join coin_balances cb on cb.team_id = t.id left join ov on ov.team_id = t.id left join rs on rs.team_id = t.id left join tr on tr.team_id = t.id
  order by 4 desc
$$;

-- ───────────── the scheduler ─────────────
-- the league jobs skip prediction pools (no Book, no predictions, no matchups there) and gain the coin drops
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions', 'h2h-notes', 'pool-drops') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' and (p_job = 'pool-drops' or kind = 'fantasy') order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
      r := case p_job
        when 'open-book' then to_jsonb(open_markets())
        when 'open-book-season' then jsonb_build_array(open_season_markets(), open_nhl_markets(), reprice_season_markets())
        when 'settle-book' then settle_markets()
        when 'settle-book-season' then jsonb_build_array(settle_season_markets(), settle_race_markets())
        when 'settle-bets' then settle_due_bets()
        when 'predict' then to_jsonb(predict_tonight())
        when 'score-predictions' then to_jsonb(score_predictions())
        when 'h2h-notes' then to_jsonb(h2h_week_notes())
        when 'pool-drops' then to_jsonb(run_pool_drops())
      end;
      out := out || jsonb_build_object(lid::text, r);
    exception when others then
      raise warning 'run_league_jobs % league %: %', p_job, lid, sqlerrm;
      out := out || jsonb_build_object(lid::text, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return out;
end $$;

grant execute on function public.pool_prices(jsonb, numeric), public.pool_create(jsonb), public.pool_edit(bigint, jsonb),
  public.pool_buy(bigint, text, int), public.pool_sell(bigint, text, numeric), public.pool_resolve(bigint, text, text),
  public.pool_add_drop(int, text, timestamptz), public.pool_load_pack(text), public.platform_open_pool(text, text, text, text),
  public.pool_invite_link(int, int), public.pool_leaders() to authenticated;
revoke execute on function public.pool_create(jsonb), public.pool_edit(bigint, jsonb), public.pool_buy(bigint, text, int),
  public.pool_sell(bigint, text, numeric), public.pool_resolve(bigint, text, text), public.pool_add_drop(int, text, timestamptz),
  public.pool_load_pack(text), public.platform_open_pool(text, text, text, text), public.pool_invite_link(int, int) from anon;

-- ───────────── the first pack: Love Is Blind, Season 11 (Boston) ─────────────
-- Netflix drops each batch on a Wednesday at 3 am ET: 14, 21, 28 October (EDT, 07:00 UTC) and 4 November (EST,
-- 08:00 UTC). The reunion isn't announced; seasons 9 and 10 had it a week after the finale, so its question closes
-- 11 November and the host moves it when Netflix says. Week-by-week couple questions are the host's, once the couples
-- are known.
insert into public.pool_packs (slug, name, brand, markets, drops) values ('love-is-blind-s11', 'Love Is Blind · Season 11',
  '{"wordmark": {"a": "POD", "b": "SQUAD"}, "tagline": "A Love Is Blind pool", "trophy": "The Golden Goblet", "booby": "The Pod Wall",
    "coin": {"name": "Goblets", "emoji": "🥂"}, "bot": {"name": "Vee", "emoji": "💌"}, "colors": {"gold": "#fb7185"}}'::jsonb,
  '[
    {"title": "How many couples get engaged in the pods?", "category": "Before the premiere", "sort": 1,
     "rule": "Every engagement the show airs from the pods, counted when the couples leave them. A proposal accepted later, outside the pods, does not count.",
     "outcomes": ["4 or fewer", "5", "6", "7", "8 or more"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will a woman propose in the pods?", "category": "Before the premiere", "sort": 2,
     "rule": "Yes if the show airs a woman asking a man to marry her while they are in the pods, whatever his answer.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will an engagement end before the getaway?", "category": "Before the premiere", "sort": 3,
     "rule": "Yes if any engaged couple splits on screen between the reveal and the start of the getaway trip.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will the getaway be somewhere other than Mexico for any couple?", "category": "Before the premiere", "sort": 4,
     "rule": "Yes if at least one couple''s post-pods getaway, as aired, is outside Mexico.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "How many couples make it to the altar?", "category": "The whole season", "sort": 10,
     "rule": "Couples who stand at the altar at a wedding the show airs, whatever they say there. Trading stays open until the finale drops.",
     "outcomes": ["2 or fewer", "3", "4", "5 or more"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "How many couples say \"I do\"?", "category": "The whole season", "sort": 11,
     "rule": "Couples where both say \"I do\" at the altar, as aired in the finale. Trading stays open until the finale drops.",
     "outcomes": ["None", "1", "2", "3 or more"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "Will someone say \"I do\" while their partner says \"I don''t\"?", "category": "The whole season", "sort": 12,
     "rule": "Yes if, at any wedding the show airs, one says \"I do\" and the other does not.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "Will any couple still be together at the reunion?", "category": "The whole season", "sort": 13,
     "rule": "Yes if at least one couple from this season says at the reunion that they are together (married or not). Closes when the reunion drops; the host moves the date once Netflix announces it.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-11T08:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-10-14T07:00:00Z", "amount": 250, "note": "Premiere night (episodes 1-5)"},
    {"at": "2026-10-21T07:00:00Z", "amount": 250, "note": "Drop 2 (episodes 6-8)"},
    {"at": "2026-10-28T07:00:00Z", "amount": 250, "note": "Drop 3 (episodes 9-11)"},
    {"at": "2026-11-04T08:00:00Z", "amount": 250, "note": "The weddings (episode 12)"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
