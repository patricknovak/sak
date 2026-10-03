-- Money and the Fund are options a league turns on, not part of every league (Patrick, 3 October 2026).
--
-- * league_rules.features says what a league uses: {"money": true} keeps entry fees, payouts and who owes what on
--   the site; {"fund": true} keeps a league fund (shares and cash held for the league). A league that has neither
--   plays for nothing, or keeps its money elsewhere. SaK has both; a new league starts with neither and its
--   commissioner turns them on under League settings.
-- * The ledger refuses a line in a league that doesn't keep money, whichever path writes it.
-- * The Fund is per league: one fund row per league (keyed by league), every league's own price history, and the
--   fund view reads the caller's league. Turning the Fund on makes the league's row. A paid entry or punishment adds
--   to the fund only in a league that has one.

set client_min_messages = warning;

alter table public.league_rules add column if not exists features jsonb not null default '{}';
update public.league_rules set features = features || '{"money": true, "fund": true}'::jsonb
where league_id = 1 and not (features ? 'money');

-- the caller's league, now with what it uses (columns as before, features added at the end)
create or replace view public.league with (security_invoker = true) as
  select id, name, short_name, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds, draft_rounds,
    snake, season_start, season_end, trade_deadline, trade_review_hours, max_acquisitions, extra_acq_fee, entry_fee, sak_fee,
    prize_split, roster, scoring, commish_note, info, updated_at, playoff_share, playoffs_end, cup_share, playoff_bonus_acq,
    league_id, features
  from league_rules where league_id = current_league_id();

-- does a league use money or the fund
create or replace function public.league_has(p_feature text, p_league int default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (r.features ->> p_feature)::boolean from league_rules r
                   where r.league_id = coalesce(p_league, current_league_id())), false)
$$;
revoke execute on function public.league_has(text, int) from public, anon;
grant execute on function public.league_has(text, int) to authenticated, service_role;

-- refuse what the caller's league doesn't use
create or replace function public._feature(p_feature text, p_league int default null) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not league_has(p_feature, p_league) then
    raise exception '%', case p_feature
      when 'money' then 'This league doesn''t keep its money on the site. The commissioner can turn it on in League settings.'
      when 'fund' then 'This league has no fund. The commissioner can turn one on in League settings.'
      else format('This league doesn''t use %s', p_feature) end;
  end if;
end $$;
revoke execute on function public._feature(text, int) from public, anon, authenticated;

-- every line on the ledger belongs to a league that keeps money (runs after the league is stamped from the team)
create or replace function public._ledger_money_on() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _feature('money', new.league_id);
  return new;
end $$;
drop trigger if exists ledger_tz_money on public.ledger;
create trigger ledger_tz_money before insert on public.ledger for each row execute function public._ledger_money_on();

-- ───────────── the Fund, one per league ─────────────
-- the caller's league's fund as it stands: shares and cash from its ledger, valued at its last price (no grouping,
-- so the view doesn't lean on the fund's key while the key changes below)
create or replace view public.fund_status with (security_invoker = true) as
  select f.symbol, f.price_usd, f.fx_usdcad, f.priced_at, f.owed_back, f.owed_back_note, f.custodian, f.purpose,
    l.shares,
    l.cash,
    round(l.shares * coalesce(f.price_usd, 0) * coalesce(f.fx_usdcad, 0), 2) as stock_cad,
    round(l.shares * coalesce(f.price_usd, 0) * coalesce(f.fx_usdcad, 0) + l.cash - f.owed_back, 2) as net_cad,
    (select count(*) from teams t where t.role = 'gm' and t.league_id = f.league_id) as members
  from fund f
  cross join lateral (select coalesce(sum(x.shares), 0) as shares, coalesce(sum(x.cash), 0) as cash
                      from fund_ledger x where x.league_id = f.league_id) l
  where f.league_id = current_league_id();

do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'public.fund'::regclass and conname = 'fund_id_check') then
    alter table public.fund drop constraint fund_id_check;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.fund'::regclass and conname = 'fund_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table public.fund drop constraint fund_pkey;
  end if;
end $$;
-- fund.id was always 1; the league is the key now (the column stays for old readers until it is retired)
alter table public.fund alter column id drop not null;
alter table public.fund alter column id drop default;
update public.fund set league_id = 1 where league_id is null;
alter table public.fund alter column league_id set not null;
alter table public.fund alter column league_id set default current_league_id();
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.fund'::regclass and contype = 'p') then
    alter table public.fund add primary key (league_id);
  end if;
end $$;

-- each league's own price history
alter table public.fund_prices add column if not exists league_id int references public.leagues;
update public.fund_prices set league_id = 1 where league_id is null;
alter table public.fund_prices alter column league_id set not null;
alter table public.fund_prices alter column league_id set default current_league_id();
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'public.fund_prices'::regclass and conname = 'fund_prices_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (date)') then
    alter table public.fund_prices drop constraint fund_prices_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.fund_prices'::regclass and contype = 'p') then
    alter table public.fund_prices add primary key (league_id, date);
  end if;
end $$;
drop policy if exists read_all on public.fund_prices;
create policy read_all on public.fund_prices for select to authenticated using (league_id = (select current_league_id()));

-- the day's price for the caller's league's fund (the edge function names the league; a league without a fund is skipped)
create or replace function public.set_fund_price(p_price numeric, p_fx numeric) returns void
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id();
begin
  if not league_has('fund', lid) then return; end if;
  update fund set price_usd = p_price, fx_usdcad = p_fx, priced_at = now(), updated_at = now() where league_id = lid;
  insert into fund_prices (league_id, date, price_usd, fx_usdcad, shares, cash, value_cad)
    select lid, today_et(), p_price, p_fx, s.shares, s.cash, s.net_cad from fund_status s
    on conflict (league_id, date) do update set price_usd = excluded.price_usd, fx_usdcad = excluded.fx_usdcad, shares = excluded.shares,
      cash = excluded.cash, value_cad = excluded.value_cad;
end $$;

create or replace function public.commish_fund_price(p_price numeric, p_fx numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  perform _feature('fund');
  if p_price <= 0 or p_fx <= 0 then raise exception 'Enter a price and exchange rate'; end if;
  perform set_fund_price(p_price, p_fx);
end $$;

create or replace function public.commish_fund_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  perform _feature('fund');
  update fund set
    owed_back = coalesce((p->>'owed_back')::numeric, owed_back),
    owed_back_note = case when p ? 'owed_back_note' then p->>'owed_back_note' else owed_back_note end,
    custodian = case when p ? 'custodian' then p->>'custodian' else custodian end,
    purpose = case when p ? 'purpose' then p->>'purpose' else purpose end,
    symbol = coalesce(p->>'symbol', symbol),
    updated_at = now()
  where league_id = current_league_id();
end $$;

create or replace function public.commish_fund_entry(p_kind text, p_cash numeric, p_shares numeric, p_note text, p_date date default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  perform _feature('fund');
  if coalesce(p_cash, 0) = 0 and coalesce(p_shares, 0) = 0 then raise exception 'Enter cash or shares'; end if;
  insert into fund_ledger (league_id, date, kind, cash, shares, note, season)
    values (current_league_id(), coalesce(p_date, today_et()), p_kind, coalesce(p_cash, 0), coalesce(p_shares, 0), p_note, (select season from league));
  perform _sys('general', format('🏦 %s: %s%s%s.', _fund_name(), coalesce(p_note, p_kind),
    case when coalesce(p_cash, 0) <> 0 then format(' (%s$%s cash)', case when p_cash > 0 then '+' else '−' end, abs(p_cash)) else '' end,
    case when coalesce(p_shares, 0) <> 0 then format(' (%s%s shares)', case when p_shares > 0 then '+' else '−' end, abs(p_shares)) else '' end));
end $$;

-- a paid entry, punishment or pickup fee adds its part to the league's fund, when the league has one
create or replace function public._fund_on_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare fee numeric; amt numeric; k text;
begin
  if new.paid and not coalesce(old.paid, false) then
    if not league_has('fund', new.league_id) then return new; end if;
    select r.sak_fee into fee from league_rules r where r.league_id = new.league_id;
    k := case new.kind when 'entry' then 'contribution' when 'peter' then 'peter' when 'acq_fee' then 'fee' else null end;
    amt := case new.kind when 'entry' then least(coalesce(fee, 0), new.amount) when 'peter' then new.amount when 'acq_fee' then new.amount else 0 end;
    if k is not null and amt > 0 then
      insert into fund_ledger (league_id, kind, cash, team_id, ledger_id, season, note)
        values (new.league_id, k, amt, new.team_id, new.id, new.season, format('%s: %s', _tname(new.team_id), new.description))
        on conflict (ledger_id) do nothing;
    end if;
  elsif not new.paid and coalesce(old.paid, false) then
    delete from fund_ledger where ledger_id = new.id;
  end if;
  return new;
end $$;

-- League settings: the commissioner turns money and the fund on or off (as before for everything else)
create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f jsonb;
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
  end if;
  if coalesce((p->>'playoff_share')::numeric, (select playoff_share from league)) + coalesce((p->>'cup_share')::numeric, (select cup_share from league)) > 100 then
    raise exception 'The playoff and % shares can''t add up to more than 100%%', regexp_replace(_brand_word('{trophy}', 'full-year'), '^The ', '');
  end if;
  if p ? 'features' then
    f := p->'features';
    if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_each(f) e where e.key not in ('money', 'fund') or jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'Features are money and fund, each on or off';
    end if;
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
    features = features || coalesce(f, '{}'),
    updated_at = now();
  -- a league that turns its fund on gets its fund row (kept, with its history, if it is turned off again)
  if league_has('fund') then
    insert into fund (league_id) values (current_league_id()) on conflict (league_id) do nothing;
  end if;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;
