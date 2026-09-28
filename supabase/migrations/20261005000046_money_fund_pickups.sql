-- League money, in the open.
--
-- Pots: the prize pool (entry less the SaK Fund share, times the GMs) is split three ways: the Johnson (regular
-- season) 50%, the Playoff Cup 25% and the SAK Cup (regular season + playoffs) 25%. Each pays 1st/2nd/3rd.
--
-- The ledger is one signed list of everything between each GM and the league: a positive amount is money the GM
-- owes (entry fee, Peter Punishment, extra pickups, fines), a negative amount is money the league owes the GM
-- (winnings). A GM's balance is the sum of what's unpaid, so last season's winnings net against this season's
-- entry the way the commish has always done it: a winner who won more than $200 is paid the difference, one who
-- won less pays the rest.
--
-- The SaK Fund: TSLA shares plus cash, held in trust by the commissioner and shared equally by the active GMs,
-- for a live draft or a league trip. Every movement is in fund_ledger; the share price is refreshed daily.
--
-- Pickups: 10 free pickups for the regular season and playoffs, plus 3 more for everyone once the playoffs start.
-- Unused pickups and St. Patrick coins can be traded like players and picks.

alter table public.league add column if not exists cup_share numeric not null default 25 check (cup_share >= 0 and cup_share <= 100);
alter table public.league add column if not exists playoff_bonus_acq int not null default 3 check (playoff_bonus_acq >= 0);
update public.league set playoff_share = 25, cup_share = 25 where id = 1;

alter table public.ledger add column if not exists paid_at timestamptz;
alter table public.ledger add column if not exists method text;
alter table public.ledger add column if not exists note text;

-- ───────────── the SaK Fund ─────────────
create table if not exists public.fund (
  id int primary key default 1 check (id = 1),
  symbol text not null default 'TSLA',
  price_usd numeric,
  fx_usdcad numeric,
  priced_at timestamptz,
  owed_back numeric not null default 0,       -- returned to its contributor before the fund is shared out
  owed_back_note text,
  custodian text,
  purpose text,
  updated_at timestamptz not null default now()
);
create table if not exists public.fund_ledger (
  id bigserial primary key,
  date date not null default today_et(),
  kind text not null check (kind in ('contribution', 'peter', 'fee', 'buy', 'sell', 'withdraw', 'deposit', 'adjust')),
  cash numeric not null default 0,            -- CAD in (+) or out (−)
  shares numeric not null default 0,          -- shares in (+) or out (−)
  team_id int references public.teams,
  ledger_id bigint unique references public.ledger on delete cascade,
  season text,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.fund_prices (
  date date primary key,
  price_usd numeric not null,
  fx_usdcad numeric not null,
  shares numeric not null,
  cash numeric not null,
  value_cad numeric not null
);
alter table public.fund enable row level security;
alter table public.fund_ledger enable row level security;
alter table public.fund_prices enable row level security;
revoke all on public.fund, public.fund_ledger, public.fund_prices from anon, authenticated;
grant select on public.fund, public.fund_ledger, public.fund_prices to authenticated;
grant all on public.fund, public.fund_ledger, public.fund_prices to service_role;
grant usage on sequence public.fund_ledger_id_seq to service_role;
drop policy if exists read_all on public.fund;
drop policy if exists read_all on public.fund_ledger;
drop policy if exists read_all on public.fund_prices;
create policy read_all on public.fund for select to authenticated using (true);
create policy read_all on public.fund_ledger for select to authenticated using (true);
create policy read_all on public.fund_prices for select to authenticated using (true);

-- the fund as it stands: shares and cash from the ledger, valued at the last price
create or replace view public.fund_status as
  select f.symbol, f.price_usd, f.fx_usdcad, f.priced_at, f.owed_back, f.owed_back_note, f.custodian, f.purpose,
    coalesce(sum(l.shares), 0) as shares,
    coalesce(sum(l.cash), 0) as cash,
    round(coalesce(sum(l.shares), 0) * coalesce(f.price_usd, 0) * coalesce(f.fx_usdcad, 0), 2) as stock_cad,
    round(coalesce(sum(l.shares), 0) * coalesce(f.price_usd, 0) * coalesce(f.fx_usdcad, 0) + coalesce(sum(l.cash), 0) - f.owed_back, 2) as net_cad,
    (select count(*) from teams where role = 'gm') as members
  from fund f left join fund_ledger l on true
  group by f.id;
revoke all on public.fund_status from anon, authenticated;
grant select on public.fund_status to authenticated;

-- what the fund held going into 2026-27: 36 TSLA shares, last season's $25 contributions and Eagle Palace's
-- 2025-26 Peter Punishment; the commissioner's $1,000 stake comes back to him before the fund is shared
insert into public.fund (id, owed_back, owed_back_note, custodian, purpose)
  values (1, 1000, 'Patrick''s $1,000 toward the original share purchase, returned to him before the fund is split', 'Held in trust by the commissioner (Patrick)',
          'A live draft or a league trip. Shared equally by the active GMs.')
  on conflict (id) do nothing;
insert into public.fund_ledger (date, kind, shares, note)
  select '2025-11-27', 'buy', 36, 'TSLA shares held going into 2026-27'
  where not exists (select 1 from public.fund_ledger where kind = 'buy' and note like 'TSLA shares held%');
insert into public.fund_ledger (date, kind, cash, season, note)
  select '2025-10-01', 'contribution', 200, '2025-26', '2025-26 contributions: $25 × 8 GMs'
  where not exists (select 1 from public.fund_ledger where kind = 'contribution' and season = '2025-26');

-- ───────────── ledger: money owed both ways ─────────────
-- when the commish marks a line paid, the fund gets its part: $25 of every entry, all of a Peter Punishment and
-- extra-pickup fees; marking it unpaid takes it back out
create or replace function public._fund_on_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare lg league; amt numeric; k text;
begin
  select * into lg from league;
  if new.paid and not coalesce(old.paid, false) then
    k := case new.kind when 'entry' then 'contribution' when 'peter' then 'peter' when 'acq_fee' then 'fee' else null end;
    amt := case new.kind when 'entry' then least(lg.sak_fee, new.amount) when 'peter' then new.amount when 'acq_fee' then new.amount else 0 end;
    if k is not null and amt > 0 then
      insert into fund_ledger (kind, cash, team_id, ledger_id, season, note)
        values (k, amt, new.team_id, new.id, new.season, format('%s: %s', _tname(new.team_id), new.description))
        on conflict (ledger_id) do nothing;
    end if;
  elsif not new.paid and coalesce(old.paid, false) then
    delete from fund_ledger where ledger_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists ledger_fund on public.ledger;
create trigger ledger_fund after update of paid on public.ledger for each row execute function public._fund_on_paid();

-- balances: unpaid lines per GM, every season (+ they owe, − they're owed)
create or replace view public.money_balances as
  select t.id as team_id,
    coalesce(sum(l.amount) filter (where not l.paid), 0) as balance,
    coalesce(sum(l.amount) filter (where not l.paid and l.amount > 0), 0) as owes,
    coalesce(-sum(l.amount) filter (where not l.paid and l.amount < 0), 0) as owed,
    coalesce(sum(l.amount) filter (where l.paid and l.amount > 0), 0) as paid_in,
    coalesce(-sum(l.amount) filter (where l.paid and l.amount < 0), 0) as paid_out
  from teams t left join ledger l on l.team_id = t.id
  where t.role = 'gm'
  group by t.id;
revoke all on public.money_balances from anon, authenticated;
grant select on public.money_balances to authenticated;

create or replace function public.commish_mark_paid(p_id bigint, p_paid boolean, p_method text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update ledger set paid = p_paid, paid_at = case when p_paid then now() end, method = case when p_paid then coalesce(p_method, method) end where id = p_id;
end $$;

-- settle a GM: everything unpaid is marked paid in one go (the net was e-transferred one way or the other)
create or replace function public.commish_settle_team(p_team int, p_method text default 'e-transfer', p_note text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare net numeric;
begin
  perform _commish();
  select coalesce(sum(amount), 0) into net from ledger where team_id = p_team and not paid;
  update ledger set paid = true, paid_at = now(), method = p_method, note = coalesce(p_note, note) where team_id = p_team and not paid;
  perform _notify(p_team, 'money', case when net > 0 then format('💵 Received: $%s. You''re all square with the league.', net)
    when net < 0 then format('💵 Paid out: $%s sent your way. You''re all square with the league.', -net)
    else 'You''re all square with the league.' end, '/money');
  return net;
end $$;

-- add any line: a charge (+) or a credit (−)
create or replace function public.commish_money_line(p_team int, p_kind text, p_amount numeric, p_desc text, p_season text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare id bigint;
begin
  perform _commish();
  if p_kind not in ('entry', 'payout', 'peter', 'acq_fee', 'fine', 'adjust', 'credit') then raise exception 'Unknown kind %', p_kind; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Enter an amount'; end if;
  insert into ledger (season, team_id, kind, amount, description)
    values (coalesce(p_season, (select season from league)), p_team, p_kind, p_amount, p_desc) returning ledger.id into id;
  if p_kind = 'fine' then perform _sys('general', format('💸 %s fined $%s: %s', _tname(p_team), p_amount, p_desc)); end if;
  return id;
end $$;
create or replace function public.commish_delete_line(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  delete from ledger where id = p_id;
end $$;

-- bill this season's entry to every GM (once)
create or replace function public.commish_bill_entries(p_season text default null) returns int
language plpgsql security definer set search_path = public as $$
declare lg league; s text; n int;
begin
  perform _commish();
  select * into lg from league;
  s := coalesce(p_season, lg.season);
  insert into ledger (season, team_id, kind, amount, description)
    select s, t.id, 'entry', lg.entry_fee, format('%s entry: $%s to the prize pool, $%s to the SaK Fund', s, lg.entry_fee - lg.sak_fee, lg.sak_fee)
    from teams t where t.role = 'gm' and not exists (select 1 from ledger l where l.team_id = t.id and l.season = s and l.kind = 'entry');
  get diagnostics n = row_count;
  return n;
end $$;

-- the final tables: pay the pot's 1st/2nd/3rd (and bill the Peter Punishment after the regular season)
create or replace function public.commish_post_payouts(p_pot text) returns int
language plpgsql security definer set search_path = public as $$
declare lg league; pool numeric; share numeric; label text; r record; n int := 0; last_t int; second_pts numeric; last_pts numeric;
begin
  perform _commish();
  select * into lg from league;
  if p_pot not in ('regular', 'playoffs', 'cup') then raise exception 'Pot is regular, playoffs or cup'; end if;
  if exists (select 1 from ledger where season = lg.season and kind = 'payout' and description like '%' || case p_pot when 'regular' then 'Johnson' when 'playoffs' then 'Playoff Cup' else 'SAK Cup' end || '%') then
    raise exception 'Those payouts are already posted';
  end if;
  pool := (lg.entry_fee - lg.sak_fee) * (select count(*) from teams where role = 'gm');
  share := case p_pot when 'playoffs' then lg.playoff_share when 'cup' then lg.cup_share else 100 - lg.playoff_share - lg.cup_share end / 100;
  label := case p_pot when 'regular' then 'The Johnson (regular season)' when 'playoffs' then 'Playoff Cup' else 'SAK Cup (full year)' end;
  for r in execute format('select team_id, rank, points from %I order by rank, team_id limit 3',
      case p_pot when 'regular' then 'standings' when 'playoffs' then 'playoff_standings' else 'sak_cup_standings' end) loop
    n := n + 1;
    insert into ledger (season, team_id, kind, amount, description)
      values (lg.season, r.team_id, 'payout', -round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2),
              format('%s %s: %s place', lg.season, label, case n when 1 then '1st' when 2 then '2nd' else '3rd' end));
    perform _notify(r.team_id, 'money', format('🏆 %s: $%s coming your way.', label, round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2)), '/money');
  end loop;
  if p_pot = 'regular' then
    select team_id, points into last_t, last_pts from standings order by points asc, team_id limit 1;
    select points into second_pts from standings order by points asc, team_id offset 1 limit 1;
    if last_t is not null and second_pts > last_pts then
      insert into ledger (season, team_id, kind, amount, description)
        values (lg.season, last_t, 'peter', round(second_pts - last_pts, 2), format('%s Peter Punishment: $1 a point behind second-last, to the SaK Fund', lg.season));
    end if;
  end if;
  perform _sys('general', format('💰 %s payouts posted. See the Money page.', label));
  return n;
end $$;

-- the fund: price updates (nhl-sync, daily) and the commish's own entries
create or replace function public.set_fund_price(p_price numeric, p_fx numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fund set price_usd = p_price, fx_usdcad = p_fx, priced_at = now(), updated_at = now() where id = 1;
  insert into fund_prices (date, price_usd, fx_usdcad, shares, cash, value_cad)
    select today_et(), p_price, p_fx, s.shares, s.cash, s.net_cad from fund_status s
    on conflict (date) do update set price_usd = excluded.price_usd, fx_usdcad = excluded.fx_usdcad, shares = excluded.shares, cash = excluded.cash, value_cad = excluded.value_cad;
end $$;
revoke execute on function public.set_fund_price(numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_fund_price(numeric, numeric) to service_role;

create or replace function public.commish_fund_price(p_price numeric, p_fx numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_price <= 0 or p_fx <= 0 then raise exception 'Enter a price and exchange rate'; end if;
  perform set_fund_price(p_price, p_fx);
end $$;
create or replace function public.commish_fund_entry(p_kind text, p_cash numeric, p_shares numeric, p_note text, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if coalesce(p_cash, 0) = 0 and coalesce(p_shares, 0) = 0 then raise exception 'Enter cash or shares'; end if;
  insert into fund_ledger (date, kind, cash, shares, note, season) values (coalesce(p_date, today_et()), p_kind, coalesce(p_cash, 0), coalesce(p_shares, 0), p_note, (select season from league));
  perform _sys('general', format('🏦 SaK Fund: %s%s%s.', coalesce(p_note, p_kind),
    case when coalesce(p_cash, 0) <> 0 then format(' (%s$%s cash)', case when p_cash > 0 then '+' else '−' end, abs(p_cash)) else '' end,
    case when coalesce(p_shares, 0) <> 0 then format(' (%s%s shares)', case when p_shares > 0 then '+' else '−' end, abs(p_shares)) else '' end));
end $$;
create or replace function public.commish_fund_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update fund set
    owed_back = coalesce((p->>'owed_back')::numeric, owed_back),
    owed_back_note = case when p ? 'owed_back_note' then p->>'owed_back_note' else owed_back_note end,
    custodian = case when p ? 'custodian' then p->>'custodian' else custodian end,
    purpose = case when p ? 'purpose' then p->>'purpose' else purpose end,
    symbol = coalesce(p->>'symbol', symbol),
    updated_at = now()
  where id = 1;
end $$;
revoke execute on function public.commish_mark_paid(bigint, boolean, text), public.commish_settle_team(int, text, text), public.commish_money_line(int, text, numeric, text, text),
  public.commish_delete_line(bigint), public.commish_bill_entries(text), public.commish_post_payouts(text), public.commish_fund_price(numeric, numeric),
  public.commish_fund_entry(text, numeric, numeric, text, date), public.commish_fund_settings(jsonb) from public, anon;
grant execute on function public.commish_mark_paid(bigint, boolean, text), public.commish_settle_team(int, text, text), public.commish_money_line(int, text, numeric, text, text),
  public.commish_delete_line(bigint), public.commish_bill_entries(text), public.commish_post_payouts(text), public.commish_fund_price(numeric, numeric),
  public.commish_fund_entry(text, numeric, numeric, text, date), public.commish_fund_settings(jsonb) to authenticated;
drop function if exists public.commish_mark_paid(bigint, boolean);

-- league settings: the SAK Cup share and the playoff pickup bonus
create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
  end if;
  if coalesce((p->>'playoff_share')::numeric, (select playoff_share from league)) + coalesce((p->>'cup_share')::numeric, (select cup_share from league)) > 100 then
    raise exception 'The playoff and SAK Cup shares can''t add up to more than 100%%';
  end if;
  update league set
    keepers = coalesce((p->>'keepers')::int, keepers),
    top_scorer_rule = coalesce((p->>'top_scorer_rule')::boolean, top_scorer_rule),
    keeper_deadline = case when p ? 'keeper_deadline' then (p->>'keeper_deadline')::timestamptz else keeper_deadline end,
    draft_at = case when p ? 'draft_at' then (p->>'draft_at')::timestamptz else draft_at end,
    pick_seconds = coalesce((p->>'pick_seconds')::int, pick_seconds),
    draft_rounds = coalesce((p->>'draft_rounds')::int, draft_rounds),
    snake = coalesce((p->>'snake')::boolean, snake),
    trade_deadline = case when p ? 'trade_deadline' then (p->>'trade_deadline')::timestamptz else trade_deadline end,
    max_acquisitions = coalesce((p->>'max_acquisitions')::int, max_acquisitions),
    playoff_bonus_acq = coalesce((p->>'playoff_bonus_acq')::int, playoff_bonus_acq),
    extra_acq_fee = coalesce((p->>'extra_acq_fee')::numeric, extra_acq_fee),
    entry_fee = coalesce((p->>'entry_fee')::numeric, entry_fee),
    sak_fee = coalesce((p->>'sak_fee')::numeric, sak_fee),
    prize_split = coalesce(p->'prize_split', prize_split),
    playoff_share = coalesce((p->>'playoff_share')::numeric, playoff_share),
    cup_share = coalesce((p->>'cup_share')::numeric, cup_share),
    phase = coalesce(p->>'phase', phase),
    commish_note = case when p ? 'commish_note' then p->>'commish_note' else commish_note end,
    scoring = coalesce(p->'scoring', scoring),
    info = coalesce(p->'info', info),
    updated_at = now()
  where id = 1;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;

-- ───────────── pickups: the playoff bonus, and trading them ─────────────
create table if not exists public.acq_transfers (
  id bigserial primary key,
  season text not null,
  from_team int not null references public.teams,
  to_team int not null references public.teams,
  n int not null check (n > 0),
  trade_id bigint references public.trades on delete set null,
  created_at timestamptz not null default now()
);
alter table public.acq_transfers enable row level security;
revoke all on public.acq_transfers from anon, authenticated;
grant select on public.acq_transfers to authenticated;
grant all on public.acq_transfers to service_role;
drop policy if exists read_all on public.acq_transfers;
create policy read_all on public.acq_transfers for select to authenticated using (true);

create or replace function public._playoffs_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(today_et() > season_end, false) from league where id = 1
$$;
-- free pickups a team has this season: 10, +3 once the playoffs start, plus any it traded for, less any it traded away
create or replace function public._acq_allowed(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select (l.max_acquisitions + case when _playoffs_on() then l.playoff_bonus_acq else 0 end
    + coalesce((select sum(n) from acq_transfers where to_team = p_team and season = l.season), 0)
    - coalesce((select sum(n) from acq_transfers where from_team = p_team and season = l.season), 0))::int
  from league l where l.id = 1
$$;
create or replace function public._acq_used(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from transactions t, league l where t.team_id = p_team and t.type = 'add' and t.season = l.season
$$;
create or replace view public.pickup_status as
  select t.id as team_id, _acq_used(t.id) as used, _acq_allowed(t.id) as allowed, greatest(0, _acq_allowed(t.id) - _acq_used(t.id)) as remaining,
    (select playoff_bonus_acq from league) as playoff_bonus, _playoffs_on() as bonus_on
  from teams t where t.role = 'gm';
revoke all on public.pickup_status from anon, authenticated;
grant select on public.pickup_status to authenticated;

create or replace function public.add_player(p_add integer, p_drop integer default null, p_accept_fee boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); l league; used int; fee numeric := 0; cnt int; stuck text; allowed int;
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
  used := _acq_used(me);
  allowed := _acq_allowed(me);
  if used >= allowed then
    if l.season_end is not null and today_et() > l.season_end - 7 and today_et() <= l.season_end then
      raise exception 'No extra pickups in the final week of the regular season';
    end if;
    if not p_accept_fee then raise exception 'ACQ_LIMIT: You''ve used all % free pickups. Extra pickups cost $%.', allowed, l.extra_acq_fee; end if;
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

-- trade items can now be pickups or St. Patrick coins too
alter table public.trade_items add column if not exists pickups int check (pickups > 0);
alter table public.trade_items add column if not exists coins int check (coins > 0);
alter table public.trade_items drop constraint if exists trade_items_check;
alter table public.trade_items add constraint trade_items_check
  check ((player_id is not null)::int + (pick_id is not null)::int + (pickups is not null)::int + (coins is not null)::int = 1);

create or replace function public._coins_free(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(balance - escrow, 0) from coin_balances where team_id = p_team
$$;
-- everything a team is putting into open trades, so it can't promise the same pickups or coins twice
create or replace function public._item_label(i trade_items) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(_pname(i.player_id),
    (select format('%s R%s pick', season, round) from draft_picks where id = i.pick_id),
    case when i.pickups is not null then format('%s free-agent pickup%s', i.pickups, case when i.pickups > 1 then 's' else '' end) end,
    case when i.coins is not null then format('%s St. Patrick coins', i.coins) end, 'something')
$$;
create or replace function public._check_trade_extras(p_team int, p_pickups int, p_coins int) returns void
language plpgsql stable security definer set search_path = public as $$
declare left_acq int := _acq_allowed(p_team) - _acq_used(p_team); free int := _coins_free(p_team);
begin
  if coalesce(p_pickups, 0) > 0 and p_pickups > left_acq then
    raise exception '% has only % free-agent pickup% left to trade', _tname(p_team), greatest(left_acq, 0), case when left_acq = 1 then '' else 's' end;
  end if;
  if coalesce(p_coins, 0) > 0 and p_coins > free then
    raise exception '% has only % St. Patrick coins free (the rest are riding on bets)', _tname(p_team), greatest(free, 0);
  end if;
end $$;

drop function if exists public.propose_trade(int, int[], int[], int[], int[], text);
create or replace function public.propose_trade(p_to int, p_give int[], p_get int[], p_give_picks int[] default '{}', p_get_picks int[] default '{}', p_note text default null,
  p_give_pickups int default 0, p_get_pickups int default 0, p_give_coins int default 0, p_get_coins int default 0) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint;
begin perform _gm_only();
  select * into l from league;
  if l.trade_deadline is not null and now() > l.trade_deadline then raise exception 'The trade deadline has passed'; end if;
  if l.phase = 'draft' then raise exception 'No trades during the live draft'; end if;
  if p_to = me then raise exception 'You can''t trade with yourself'; end if;
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
  perform _notify(p_to, 'trade', format('%s sent you a trade offer', _tname(me)), '/trades');
  return tid;
end $$;
revoke execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int) from public, anon;
grant execute on function public.propose_trade(int, int[], int[], int[], int[], text, int, int, int, int) to authenticated;

create or replace function public.propose_multi_trade(p_items jsonb, p_note text default null) returns bigint
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
  for t in select x from unnest(parts) x where x <> me loop
    perform _notify(t, 'trade', format('%s proposed a %s-team trade with you', _tname(me), array_length(parts, 1)), '/trades');
  end loop;
  return tid;
end $$;

create or replace function public._execute_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades; it record; dest int; parts int[]; t int; summary text; n int;
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
    perform _check_trade_extras(t,
      (select coalesce(sum(pickups), 0) from trade_items where trade_id = p_trade and from_team = t)::int,
      (select coalesce(sum(coins), 0) from trade_items where trade_id = p_trade and from_team = t)::int);
  end loop;
  create temp table if not exists _moving (player_id int, dest int, was_ir boolean, ir_ok boolean) on commit drop;
  delete from _moving;
  for it in select * from trade_items where trade_id = p_trade loop
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
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.from_team), 'nothing'),
      _tname(tr.to_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.to_team), 'nothing'))
    into summary;
  else
    select string_agg(format('%s send %s to %s', _tname(g.from_team), g.what, _tname(g.to_team)), '; ' order by g.from_team, g.to_team) into summary
    from (select from_team, to_team, string_agg(_item_label(i), ', ') as what from trade_items i where trade_id = p_trade group by from_team, to_team) g;
    summary := format('%s-team deal: %s', array_length(tr.parties, 1), summary);
  end if;
  perform _sys('general', '🔄 TRADE! ' || summary, jsonb_build_object('trade', p_trade));
  for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'Your trade went through: ' || left(summary, 140), '/trades'); end loop;
  update trade_block b set offering = array(select x from unnest(b.offering) x where not exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id = x))
    where b.team_id = any (parts);
end $$;

revoke execute on function public._execute_trade(bigint), public._check_trade_extras(int, int, int), public._acq_allowed(int), public._acq_used(int), public._coins_free(int),
  public._item_label(trade_items), public._playoffs_on() from public, anon, authenticated;

-- ───────────── this season's books ─────────────
-- 2025-26: the regular season paid 100% of the pool (60/30/10); none of it is paid out yet. Eagle Palace's Peter
-- Punishment is already in the fund. 2026-27: everyone's entry is billed, so each GM's balance nets the two.
insert into public.ledger (season, team_id, kind, amount, description)
  select '2025-26', t, 'payout', a, d from (values
    (8, -840::numeric, '2025-26 regular season: 1st place (Hatrick Swayze)'),
    (4, -420::numeric, '2025-26 regular season: 2nd place (Ravens)'),
    (6, -140::numeric, '2025-26 regular season: 3rd place (Connor McPanos)')) v(t, a, d)
  where not exists (select 1 from public.ledger where season = '2025-26' and kind = 'payout');
insert into public.ledger (season, team_id, kind, amount, description, paid, paid_at, method)
  select '2025-26', 5, 'peter', 270.70, '2025-26 Peter Punishment: $1 a point behind second-last, to the SaK Fund', true, now(), 'in the fund'
  where not exists (select 1 from public.ledger where season = '2025-26' and kind = 'peter');
insert into public.ledger (season, team_id, kind, amount, description)
  select '2026-27', t.id, 'entry', 200, '2026-27 entry: $175 to the prize pool, $25 to the SaK Fund'
  from public.teams t where t.role = 'gm' and not exists (select 1 from public.ledger l where l.team_id = t.id and l.season = '2026-27' and l.kind = 'entry');
-- the Peter money was already in the fund before the ledger existed: record it without the trigger doubling it
insert into public.fund_ledger (date, kind, cash, team_id, ledger_id, season, note)
  select '2026-04-20', 'peter', 270.70, 5, l.id, '2025-26', 'Eagle Palace: 2025-26 Peter Punishment'
  from public.ledger l where l.season = '2025-26' and l.kind = 'peter'
  on conflict (ledger_id) do nothing;
update public.league set info = info - 'peterOwed' - 'fund' where id = 1;
