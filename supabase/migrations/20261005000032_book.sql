-- Garry's Book: a St. Patrick coin predictions market on real NHL games and box-score stats, plus odds on
-- GM-vs-GM side bets.
--   * Every morning the Book opens markets on the night's games: moneyline (odds from each club's form this
--     season plus home ice), total goals over/under 6.5, overtime yes/no, and a SaK-points over/under on the
--     best SaK-rostered skaters in the game. The commish can add a custom market on anything verifiable.
--   * GMs bet coins at the odds shown; the stake leaves the bank right away and winners are paid stake × odds
--     when the box score is final. Postponed games, or a player who never dressed, are voided and refunded.
--   * Side bets get odds: the creator can lay 2:1, 3:1 (or take 1:2) so the two stakes differ.

-- ───────────────────────────── odds on side bets ─────────────────────────────
alter table public.bets add column if not exists odds numeric not null default 1 check (odds >= 0.2 and odds <= 5);
-- what each side risks: the opponent puts up `coins`, the creator puts up `coins × odds`
create or replace function public._creator_stake(b bets) returns int
language sql immutable as $$ select round(b.coins * b.odds)::int $$;

create or replace view public.coin_balances as
  select t.id as team_id,
    coalesce((select sum(amount) from coin_ledger c where c.team_id = t.id), 0)::int as balance,
    (coalesce((select sum(case when b.creator_team = t.id then _creator_stake(b) else b.coins end) from bets b
      where b.kind not like 'pool%' and ((b.status = 'open' and b.creator_team = t.id) or (b.status = 'accepted' and t.id in (b.creator_team, b.opponent_team)))), 0)
     + coalesce((select sum(e.coins) from bet_entries e join bets b on b.id = e.bet_id where e.team_id = t.id and b.status in ('open', 'accepted')), 0))::int as escrow
  from teams t;

create or replace function public._settle_coins(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b bets; loser int; amt int;
begin
  select * into b from bets where id = p_bet;
  if b.coins <= 0 or b.winner_team is null then return; end if;
  loser := case when b.winner_team = b.creator_team then b.opponent_team else b.creator_team end;
  amt := case when loser = b.creator_team then _creator_stake(b) else b.coins end;   -- the winner collects what the loser risked
  insert into coin_ledger (team_id, amount, reason, bet_id) values
    (b.winner_team, amt, 'Won bet: ' || b.title, b.id),
    (loser, -amt, 'Lost bet: ' || b.title, b.id);
end $$;

-- create_bet_v2 learns 'odds'
create or replace function public.create_bet_v2(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); bid bigint; kind text := coalesce(p->>'kind', 'custom'); s jsonb := coalesce(p->'subject', '{}'::jsonb);
  opp int := nullif(p->>'opponent', '')::int; coins int := coalesce((p->>'coins')::int, 0); title text := trim(coalesce(p->>'title', ''));
  st date := nullif(p->>'start', '')::date; en date := nullif(p->>'end', '')::date; pool boolean := kind like 'pool%';
  odds numeric := coalesce(nullif(p->>'odds', '')::numeric, 1);
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  if opp = me then raise exception 'You can''t bet yourself'; end if;
  if length(title) < 3 then raise exception 'Give the bet a title'; end if;
  if coins < 0 then raise exception 'Coins must be positive'; end if;
  if pool then odds := 1; end if;
  if odds < 0.2 or odds > 5 then raise exception 'Odds must be between 1:5 and 5:1'; end if;
  if round(coins * odds) > _coins_available(me) then raise exception 'You only have % St. Patrick coins available (you''d be risking %)', _coins_available(me), round(coins * odds); end if;
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
  insert into bets (creator_team, opponent_team, title, terms, kind, stake, amount, start_date, end_date, coins, subject, entry_close, odds)
    values (me, opp, left(title, 140), nullif(trim(coalesce(p->>'terms', '')), ''), kind, nullif(trim(coalesce(p->>'stake', '')), ''), nullif(p->>'amount', '')::numeric, st, en, coins,
      case when pool then s - 'team_id' - 'player_id' else s end, case when pool then coalesce(nullif(p->>'entry_close', '')::date, st) else null end, odds)
    returning id into bid;
  if pool then
    insert into bet_entries (bet_id, team_id, choice, coins) values (bid, me, case when kind = 'pool_team' then jsonb_build_object('team_id', (s->>'team_id')::int) else jsonb_build_object('player_id', (s->>'player_id')::int) end, coins);
    perform _sys('general', format('🎰 %s opened a pool: "%s" · %s ☘️ coins to enter, entries close %s', _tname(me), title, coins, coalesce(nullif(p->>'entry_close', '')::date, st)), jsonb_build_object('bet', bid));
  else
    perform _sys('general', format('🎲 %s %s: "%s"%s', _tname(me),
      case when opp is null then 'posted an open challenge' else 'challenged ' || _tname(opp) end, title,
      coalesce(' · stakes: ' || nullif(concat_ws(' + ', case when coins > 0 then (case when odds <> 1 then round(coins * odds) || ' ☘️ against ' || coins || ' ☘️' else coins || ' ☘️ coins' end) end, case when nullif(p->>'amount', '')::numeric > 0 then '$' || (p->>'amount') end, nullif(p->>'stake', '')), ''), '')),
      jsonb_build_object('bet', bid));
    if opp is not null then perform _notify(opp, 'bet', format('%s challenged you: %s', _tname(me), title), '/bets'); end if;
  end if;
  return bid;
end $$;

-- ───────────────────────────── the Book ─────────────────────────────
create table if not exists public.markets (
  id bigserial primary key,
  kind text not null check (kind in ('winner', 'total', 'ot', 'prop', 'custom')),
  title text not null,
  game_id bigint references public.games(id) on delete cascade,
  date date not null,
  subject jsonb not null default '{}',          -- winner: {home,away}; total: {line}; prop: {player_id, stat, line}; ot: {}
  options jsonb not null,                       -- [{key, label, odds}], decimal odds
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'settled', 'void')),
  winner_key text,
  result jsonb,
  created_by int references public.teams(id),   -- null = the house (Garry)
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists markets_date_idx on public.markets (date, status);
create table if not exists public.market_bets (
  id bigserial primary key,
  market_id bigint not null references public.markets(id) on delete cascade,
  team_id int not null references public.teams(id) on delete cascade,
  pick text not null,
  coins int not null check (coins > 0),
  odds numeric not null,
  payout int,                                   -- set at settlement: coins × odds on a win, coins on a void, 0 on a loss
  created_at timestamptz not null default now(),
  unique (market_id, team_id, pick)
);
alter table public.markets enable row level security;
alter table public.market_bets enable row level security;
grant select on public.markets, public.market_bets to authenticated;
create policy read_all on public.markets for select to authenticated using (true);
create policy read_all on public.market_bets for select to authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.markets; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.market_bets; exception when duplicate_object then null; end $$;

-- a club's form this season: points percentage over finished games (null until it has played 3)
create or replace function public._club_form(p_abbrev text) returns numeric
language sql stable security definer set search_path = public as $$
  with g as (
    select case when (home = p_abbrev and home_score > away_score) or (away = p_abbrev and away_score > home_score) then 2
                when period in ('OT', 'SO') then 1 else 0 end as pts
    from games, league l
    where l.id = 1 and p_abbrev in (home, away) and state in ('OFF', 'FINAL') and home_score is not null and date >= coalesce(l.season_start, date)
  )
  select case when count(*) >= 3 then round(sum(pts)::numeric / (2 * count(*)), 3) end from g
$$;
-- decimal odds from a probability, with the house's 5% edge, kept between 1.15 and 6
create or replace function public._odds(p numeric) returns numeric
language sql immutable as $$ select least(6, greatest(1.15, round(0.95 / greatest(0.05, least(0.95, p)), 2))) $$;

create or replace function public._market_option_odds(m markets, p_key text) returns numeric
language sql immutable as $$ select (o->>'odds')::numeric from jsonb_array_elements(m.options) o where o->>'key' = p_key $$;

-- open the Book on a day's games (idempotent: a game only ever gets one set of markets)
create or replace function public.open_markets(p_date date default today_et()) returns int
language plpgsql security definer set search_path = public as $$
declare g record; n int := 0; fh numeric; fa numeric; ph numeric; pr record; line numeric; first_start timestamptz; ngames int := 0;
begin
  for g in select * from games where date = p_date and start_utc > now() and state not in ('PPD', 'CNCL')
             and not exists (select 1 from markets m where m.game_id = games.id) order by start_utc loop
    ngames := ngames + 1;
    first_start := coalesce(first_start, g.start_utc);
    fh := _club_form(g.home); fa := _club_form(g.away);
    ph := least(0.75, greatest(0.25, 0.54 + coalesce(fh - fa, 0) * 0.6));
    insert into markets (kind, title, game_id, date, subject, options, closes_at) values
      ('winner', format('%s @ %s: who wins?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
        jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph))), g.start_utc),
      ('total', format('%s @ %s: total goals', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away, 'line', 6.5),
        jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9)), g.start_utc),
      ('ot', format('%s @ %s: goes to overtime?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
        jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28)), g.start_utc);
    n := n + 3;
    -- SaK-points over/under on the two best SaK-rostered skaters in the game
    for pr in
      select p.id, p.name, r.team_id, coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp end, p.proj / 82.0, 0) as avg
      from players p join rosters r on r.player_id = p.id left join player_season ps on ps.player_id = p.id
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

create or replace function public.place_market_bet(p_market bigint, p_pick text, p_coins int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); m markets; o numeric; staked int; lbl text;
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  select * into m from markets where id = p_market for update;
  if m.status <> 'open' or m.closes_at <= now() then raise exception 'That market is closed'; end if;
  o := _market_option_odds(m, p_pick);
  if o is null then raise exception 'Pick one of the options'; end if;
  if p_coins < 5 or p_coins > 500 then raise exception 'Bet between 5 and 500 coins'; end if;
  select coalesce(sum(coins), 0) into staked from market_bets where market_id = p_market and team_id = me;
  if staked + p_coins > 500 then raise exception 'Max 500 coins per market (you have % on it)', staked; end if;
  if p_coins > _coins_available(me) then raise exception 'You only have % St. Patrick coins available', _coins_available(me); end if;
  select o2->>'label' into lbl from jsonb_array_elements(m.options) o2 where o2->>'key' = p_pick;
  insert into market_bets (market_id, team_id, pick, coins, odds) values (p_market, me, p_pick, p_coins, o)
    on conflict (market_id, team_id, pick) do update set odds = round((market_bets.coins * market_bets.odds + excluded.coins * excluded.odds) / (market_bets.coins + excluded.coins), 2), coins = market_bets.coins + excluded.coins;
  insert into coin_ledger (team_id, amount, reason) values (me, -p_coins, format('Book: %s · %s @ %s', m.title, lbl, o));
end $$;
revoke execute on function public.place_market_bet(bigint, text, int) from public, anon;
grant execute on function public.place_market_bet(bigint, text, int) to authenticated;

-- pay a market out: winners get coins × odds, voids get their stake back
create or replace function public._payout_market(p_market bigint, p_winner text) returns void
language plpgsql security definer set search_path = public as $$
declare m markets; b record;
begin
  select * into m from markets where id = p_market;
  for b in select * from market_bets where market_id = p_market loop
    if p_winner is null then
      update market_bets set payout = coins where id = b.id;
      insert into coin_ledger (team_id, amount, reason) values (b.team_id, b.coins, 'Book refund (void): ' || m.title);
    elsif b.pick = p_winner then
      update market_bets set payout = round(b.coins * b.odds) where id = b.id;
      insert into coin_ledger (team_id, amount, reason) values (b.team_id, round(b.coins * b.odds), format('Book win: %s (%s ☘️ @ %s)', m.title, b.coins, b.odds));
    else
      update market_bets set payout = 0 where id = b.id;
    end if;
  end loop;
  update markets set status = case when p_winner is null then 'void' else 'settled' end, winner_key = p_winner, settled_at = now() where id = p_market;
end $$;

-- settle everything whose game is final (or postponed); runs from cron every half hour
create or replace function public.settle_markets() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; g games; w text; res jsonb; n int := 0; v int := 0; pg record; summary text;
begin
  for m in select * from markets where status = 'open' and closes_at < now() and kind <> 'custom' loop
    select * into g from games where id = m.game_id;
    if g.id is null then continue; end if;
    if g.state in ('PPD', 'CNCL') then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    if g.state not in ('OFF', 'FINAL') or g.home_score is null then continue; end if;
    w := null; res := jsonb_build_object('home', g.home_score, 'away', g.away_score, 'period', g.period);
    if m.kind = 'winner' then
      w := case when g.home_score > g.away_score then 'home' when g.away_score > g.home_score then 'away' end;
    elsif m.kind = 'total' then
      w := case when g.home_score + g.away_score > (m.subject->>'line')::numeric then 'over' else 'under' end;
    elsif m.kind = 'ot' then
      w := case when g.period in ('OT', 'SO') then 'yes' else 'no' end;
    elsif m.kind = 'prop' then
      if not g.final_synced then continue; end if;   -- wait for the box score
      select * into pg from player_games where game_id = g.id and player_id = (m.subject->>'player_id')::int;
      if pg.player_id is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;   -- never dressed: void
      res := res || jsonb_build_object('value', pg.fpts);
      w := case when pg.fpts > (m.subject->>'line')::numeric then 'over' else 'under' end;
    end if;
    if w is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    update markets set result = res where id = m.id;
    perform _payout_market(m.id, w);
    n := n + 1;
  end loop;
  -- one chat line per batch: who's up and who's down
  if n > 0 then
    select string_agg(format('%s %s%s', _tname(team_id), case when net >= 0 then '+' else '' end, net), ' · ' order by net desc) into summary
    from (select b.team_id, sum(coalesce(b.payout, 0) - b.coins)::int as net from market_bets b join markets mk on mk.id = b.market_id
          where mk.settled_at > now() - interval '2 minutes' group by b.team_id) x;
    if summary is not null then perform _sys('general', format('📖 Book settled %s market%s: %s 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end, summary), jsonb_build_object('book', 'settle')); end if;
  end if;
  return jsonb_build_object('settled', n, 'void', v);
end $$;

-- commissioner: a custom market on anything verifiable, and settling / voiding any market by hand
create or replace function public.commish_market(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare id bigint; opts jsonb := coalesce(p->'options', '[]'::jsonb); o jsonb;
begin
  perform _commish();
  if length(trim(coalesce(p->>'title', ''))) < 3 then raise exception 'Give the market a title'; end if;
  if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'Two to eight options'; end if;
  for o in select * from jsonb_array_elements(opts) loop
    if length(trim(coalesce(o->>'label', ''))) < 1 or (o->>'odds')::numeric < 1.05 or (o->>'odds')::numeric > 50 then raise exception 'Each option needs a label and odds between 1.05 and 50'; end if;
  end loop;
  insert into markets (kind, title, date, subject, options, closes_at, created_by)
    values ('custom', left(trim(p->>'title'), 140), coalesce(nullif(p->>'date', '')::date, today_et()), jsonb_build_object('terms', p->>'terms'),
      (select jsonb_agg(jsonb_build_object('key', 'o' || (i - 1), 'label', left(trim(x->>'label'), 60), 'odds', round((x->>'odds')::numeric, 2))) from jsonb_array_elements(opts) with ordinality as t(x, i)),
      coalesce(nullif(p->>'closes_at', '')::timestamptz, now() + interval '1 day'), _team())
    returning markets.id into id;
  perform _sys('general', format('📖 New market from the commish: "%s" · %s 👉 #/bets?t=book', p->>'title',
    (select string_agg(format('%s @ %s', x->>'label', round((x->>'odds')::numeric, 2)), ' · ') from jsonb_array_elements(opts) x)), jsonb_build_object('market', id));
  return id;
end $$;
revoke execute on function public.commish_market(jsonb) from public, anon;
grant execute on function public.commish_market(jsonb) to authenticated;

create or replace function public.commish_settle_market(p_market bigint, p_winner text) returns void
language plpgsql security definer set search_path = public as $$
declare m markets;
begin
  perform _commish();
  select * into m from markets where id = p_market for update;
  if m.status <> 'open' then raise exception 'Already settled'; end if;
  if p_winner is not null and _market_option_odds(m, p_winner) is null then raise exception 'Pick one of the options, or void'; end if;
  perform _payout_market(p_market, p_winner);
  perform _sys('general', format('📖 Commish settled "%s": %s', m.title, coalesce((select o->>'label' from jsonb_array_elements(m.options) o where o->>'key' = p_winner), 'void, stakes refunded')), jsonb_build_object('market', p_market));
end $$;
revoke execute on function public.commish_settle_market(bigint, text) from public, anon;
grant execute on function public.commish_settle_market(bigint, text) to authenticated;

-- the Book's leaderboard: record, staked, returned, net and ROI per GM
create or replace view public.book_standings as
  select t.id as team_id,
    count(b.id) filter (where m.status = 'settled') as bets,
    count(b.id) filter (where m.status = 'settled' and b.pick = m.winner_key) as wins,
    coalesce(sum(b.coins) filter (where m.status = 'settled'), 0)::int as staked,
    coalesce(sum(b.payout) filter (where m.status = 'settled'), 0)::int as returned,
    coalesce(sum(b.payout - b.coins) filter (where m.status = 'settled'), 0)::int as net,
    coalesce(sum(b.coins) filter (where m.status = 'open'), 0)::int as open_coins,
    coalesce(max(b.payout - b.coins) filter (where m.status = 'settled'), 0)::int as best_win
  from teams t left join market_bets b on b.team_id = t.id left join markets m on m.id = b.market_id
  where t.role = 'gm'
  group by t.id;
grant select on public.book_standings to authenticated;
