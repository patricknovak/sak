-- The SQL messages speak the league's language (docs/EXPANSION.md, section 5): the coin's name in the Book, the bets,
-- trades and the commissioner's awards; the bot's name on the Book's morning post; the fund's name on fund entries;
-- the full-year trophy in the money settings. Every one reads the league's brand (_brand_word, _fund_name from
-- migration 86), with SaK's words unchanged ("St. Patrick coins", "Garry's Book", "SaK Fund", "SAK Cup").

CREATE OR REPLACE FUNCTION public._check_trade_extras(p_team integer, p_pickups integer, p_coins integer)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare left_acq int := _acq_allowed(p_team) - _acq_used(p_team); free int := _coins_free(p_team);
begin
  if coalesce(p_pickups, 0) > 0 and p_pickups > left_acq then
    raise exception '% has only % free-agent pickup% left to trade', _tname(p_team), greatest(left_acq, 0), case when left_acq = 1 then '' else 's' end;
  end if;
  if coalesce(p_coins, 0) > 0 and p_coins > free then
    raise exception '% has only % % free (the rest are riding on bets)', _tname(p_team), greatest(free, 0), _brand_word('{coin,name}', 'coins');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public._item_label(i trade_items)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(_pname(i.player_id),
    (select format('%s R%s pick', season, round) from draft_picks where id = i.pick_id),
    case when i.pickups is not null then format('%s free-agent pickup%s', i.pickups, case when i.pickups > 1 then 's' else '' end) end,
    case when i.coins is not null then format('%s %s', i.coins, _brand_word('{coin,name}', 'coins', i.league_id)) end, 'something')
$function$;

CREATE OR REPLACE FUNCTION public.commish_coins(p_team integer, p_amount integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._in_league('teams', p_team);
  perform _commish();
  insert into coin_ledger (team_id, amount, reason) values (p_team, p_amount, p_reason);
  perform _sys('general', format('%s Commissioner %s %s %s %s %s: %s', _brand_word('{coin,emoji}', '🪙'),
    case when p_amount >= 0 then 'awarded' else 'docked' end, abs(p_amount), _brand_word('{coin,name}', 'coins'),
    case when p_amount >= 0 then 'to' else 'from' end, _tname(p_team), p_reason));
end $function$;

CREATE OR REPLACE FUNCTION public.commish_fund_entry(p_kind text, p_cash numeric, p_shares numeric, p_note text, p_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _commish();
  if coalesce(p_cash, 0) = 0 and coalesce(p_shares, 0) = 0 then raise exception 'Enter cash or shares'; end if;
  insert into fund_ledger (date, kind, cash, shares, note, season) values (coalesce(p_date, today_et()), p_kind, coalesce(p_cash, 0), coalesce(p_shares, 0), p_note, (select season from league));
  perform _sys('general', format('🏦 %s: %s%s%s.', _fund_name(), coalesce(p_note, p_kind),
    case when coalesce(p_cash, 0) <> 0 then format(' (%s$%s cash)', case when p_cash > 0 then '+' else '−' end, abs(p_cash)) else '' end,
    case when coalesce(p_shares, 0) <> 0 then format(' (%s%s shares)', case when p_shares > 0 then '+' else '−' end, abs(p_shares)) else '' end));
end $function$;

CREATE OR REPLACE FUNCTION public.commish_update_league(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
  end if;
  if coalesce((p->>'playoff_share')::numeric, (select playoff_share from league)) + coalesce((p->>'cup_share')::numeric, (select cup_share from league)) > 100 then
    raise exception 'The playoff and % shares can''t add up to more than 100%%', regexp_replace(_brand_word('{trophy}', 'full-year'), '^The ', '');
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
    updated_at = now();
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.create_bet(p_opponent integer, p_title text, p_terms text, p_kind text, p_stake text, p_amount numeric, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_coins integer DEFAULT 0)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me int := _team(); bid bigint;
begin perform _need('bets');
  if p_opponent = me then raise exception 'You can''t bet yourself'; end if;
  if coalesce(p_coins, 0) < 0 then raise exception 'Coins must be positive'; end if;
  if coalesce(p_coins, 0) > _coins_available(me) then
    raise exception 'You only have % % available', _coins_available(me), _brand_word('{coin,name}', 'coins');
  end if;
  insert into bets (creator_team, opponent_team, title, terms, kind, stake, amount, start_date, end_date, coins)
    values (me, p_opponent, p_title, p_terms, coalesce(p_kind, 'custom'), p_stake, p_amount, p_start, p_end, coalesce(p_coins, 0))
    returning id into bid;
  perform _sys('general', format('🎲 %s %s: "%s"%s', _tname(me),
    case when p_opponent is null then 'posted an open challenge' else 'challenged ' || _tname(p_opponent) end,
    p_title, coalesce(' · stakes: ' || nullif(concat_ws(' + ',
      case when p_coins > 0 then p_coins || ' ☘️ coins' end,
      case when p_amount > 0 then '$' || p_amount end, p_stake), ''), '')),
    jsonb_build_object('bet', bid));
  if p_opponent is not null then
    perform _notify(p_opponent, 'bet', format('%s challenged you: %s', _tname(me), p_title), '/bets');
  end if;
  return bid;
end $function$;

CREATE OR REPLACE FUNCTION public.create_bet_v2(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if round(coins * odds) > _coins_available(me) then raise exception 'You only have % % available (you''d be risking %)', _coins_available(me), _brand_word('{coin,name}', 'coins'), round(coins * odds); end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.place_market_bet(p_market bigint, p_pick text, p_coins integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me int := _team(); m markets; g games; o numeric; staked int; lbl text; live boolean := false; why text;
begin
  perform public._in_league('markets', p_market);
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  select * into m from markets where id = p_market for update;
  if m.status <> 'open' then raise exception 'That market is closed'; end if;
  if m.closes_at <= now() then
    if m.game_id is null then raise exception 'That market is closed'; end if;
    select * into g from games where id = m.game_id;
    why := _inplay_block(m, g);
    if why is not null then raise exception '%', why; end if;
    live := true;
  end if;
  o := _live_option_odds(m, p_pick);
  if o is null then raise exception 'Pick one of the options'; end if;
  if p_coins < 5 or p_coins > 500 then raise exception 'Bet between 5 and 500 coins'; end if;
  select coalesce(sum(coins), 0) into staked from market_bets where market_id = p_market and team_id = me;
  if staked + p_coins > 500 then raise exception 'Max 500 coins per market (you have % on it)', staked; end if;
  if p_coins > _coins_available(me) then raise exception 'You only have % % available', _coins_available(me), _brand_word('{coin,name}', 'coins'); end if;
  select o2->>'label' into lbl from jsonb_array_elements(m.options) o2 where o2->>'key' = p_pick;
  insert into market_bets (market_id, team_id, pick, coins, odds, placed_live) values (p_market, me, p_pick, p_coins, o, live)
    on conflict (market_id, team_id, pick) do update set odds = round((market_bets.coins * market_bets.odds + excluded.coins * excluded.odds) / (market_bets.coins + excluded.coins), 2),
      coins = market_bets.coins + excluded.coins, placed_live = market_bets.placed_live or excluded.placed_live;
  insert into coin_ledger (team_id, amount, reason) values (me, -p_coins, format('Book: %s · %s @ %s%s', m.title, lbl, o, case when live then ' (in play)' else '' end));
end $function$;

CREATE OR REPLACE FUNCTION public.open_markets(p_date date DEFAULT today_et())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; n int := 0; fh numeric; fa numeric; ph numeric; pr record; line numeric; first_start timestamptz; ngames int := 0;
  short text := coalesce((select short_name from leagues where id = current_league_id()), 'fantasy');
begin
  for g in select * from games where date = p_date and start_utc > now() and state not in ('PPD', 'CNCL')
             and not exists (select 1 from markets m where m.game_id = games.id and m.created_by is null and m.league_id = current_league_id()) order by start_utc loop
    ngames := ngames + 1;
    first_start := coalesce(first_start, g.start_utc);
    fh := _club_form(g.home); fa := _club_form(g.away);
    ph := least(0.75, greatest(0.25, 0.54 + coalesce(fh - fa, 0) * 0.6));
    if not exists (select 1 from markets where game_id = g.id and kind = 'winner' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('winner', format('%s @ %s: who wins?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph))), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'total' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('total', format('%s @ %s: total goals', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away, 'line', 6.5),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9)), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'ot' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('ot', format('%s @ %s: goes to overtime?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28)), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    -- the league's points over/under on the two best skaters its GMs own in the game
    for pr in
      select p.id, p.name, r.team_id, coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp end, p.proj / 82.0, 0) as avg
      from league_players p join rosters r on r.player_id = p.id and r.league_id = coalesce(current_league_id(), 1) left join player_season ps on ps.player_id = p.id
      where p.nhl_team in (g.home, g.away) and p.pos <> 'G' and p.injury_status is null
      order by avg desc limit 2
    loop
      line := floor(pr.avg * 2) / 2;                       -- to the half point, always ending in .5 so there's no push
      if line = floor(line) then line := line + 0.5; end if;
      line := round(greatest(0.5, line), 1);
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('prop', format('%s: %s points tonight', pr.name, short), g.id, p_date, jsonb_build_object('player_id', pr.id, 'stat', 'fpts', 'line', line, 'owner', pr.team_id),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), g.start_utc, current_league_id());
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then
    perform _sys('general', format('📖 %s''s Book is open: %s game%s %s, %s markets. Moneylines, totals, overtime and player props, %s only. First puck drop %s ET. 👉 #/bets?t=book',
      _brand_word('{bot,name}', 'Garry'), ngames, case when ngames = 1 then '' else 's' end, case when p_date = today_et() then 'tonight' else 'on ' || to_char(p_date, 'FMDay FMMonth FMDD') end, n, _brand_word('{coin,name}', 'coins'), to_char(first_start at time zone 'America/Toronto', 'FMHH:MI am')), jsonb_build_object('book', p_date));
  end if;
  return n;
end $function$;
