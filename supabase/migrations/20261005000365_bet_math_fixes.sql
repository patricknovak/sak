-- Side bets and the Book: the settling errors found while the bets' math sheet was built (docs/DEVELOPMENT.md §9.40),
-- and what turned up beside them.
--
--  1. A pool that ends level pays out its whole pot. The split was in whole coins and the odd ones vanished (100 three
--     ways paid 99); now the coins left over go one each to the winners who got in first (_pool_pay).
--  2. bet_progress checks the bet is in the caller's league before it reads it.
--  3. A bet counts one kind of game on both sides of the house: the regular season, or, when its window starts after
--     the regular season is over, the playoffs. A player bet used to count every game in its window (playoffs too)
--     while a team bet counted regular-season nights only.
--  4. A pool can't be cancelled or left once its games are under way. It stayed 'open' until the next morning's job,
--     so its creator could call it off (and a joiner could walk away) after watching the first night go wrong.
--  5. Conceding, confirming and the commissioner's quick settle are for two-sided bets; on a pool they fell through a
--     null opponent to a database error. They say so now.
--  6. A pool nobody else joined is called off rather than "won" by its own creator.
--  7. The settle job locks each bet before it pays, so a ruling made in the same moment can't pay it twice.
--  8. The Book: a result dead on the line is a push and the stakes go back. It paid the under (a 2.5 line, a player
--     who finished on exactly 2.5), on the belief that a half-point line can't be hit; fantasy points can land on it.
--
-- (The cards' odds reading the calendar day rather than the league day is fixed on the site, same pull request.)
-- Safe to run twice.

-- which kind of NHL game a bet's window counts: 2 the regular season, 3 the playoffs (a window that starts after the
-- regular season is over); a window that straddles the two stays a regular-season bet
create or replace function public._bet_game_type(p_start date) returns int
language sql stable security definer set search_path = public as $$
  select case when p_start > (select season_end from league) then 3 else 2 end
$$;
revoke execute on function public._bet_game_type(date) from public, anon, authenticated;

create or replace function public._stat_sum(p_player int, p_stat text, p_start date, p_end date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when p_stat = 'fpts' then lg.fpts else coalesce((lg.stats->>p_stat)::numeric, 0) end), 0)
  from league_games lg join games g on g.id = lg.game_id
  where lg.player_id = p_player and lg.date >= coalesce(p_start, lg.date) and lg.date <= coalesce(p_end, lg.date)
    and g.game_type = _bet_game_type(p_start)
$$;

-- team_daily is team_daily_all's regular-season nights; the same rows, with the playoff nights for a playoff bet
create or replace function public._team_sum(p_team int, p_start date, p_end date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0) from team_daily_all
  where team_id = p_team and date >= coalesce(p_start, date) and date <= coalesce(p_end, date) and game_type = _bet_game_type(p_start)
$$;

create or replace function public.bet_progress(p_bet bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b bets; s jsonb; out jsonb := '{}'; lg league;
begin
  perform _in_league('bets', p_bet);
  select * into b from bets where id = p_bet;
  if b.id is null then return null; end if;
  s := coalesce(b.subject, '{}'::jsonb);
  select * into lg from league;
  if b.kind = 'h2h' then
    out := jsonb_build_object('a', _team_sum(b.creator_team, b.start_date, b.end_date), 'b', _team_sum(b.opponent_team, b.start_date, b.end_date));
  elsif b.kind = 'player_ou' then
    out := jsonb_build_object('value', _stat_sum((s->>'player_id')::int, s->>'stat', b.start_date, b.end_date), 'line', (s->>'line')::numeric, 'side', s->>'side');
  elsif b.kind = 'player_vs' then
    out := jsonb_build_object('a', _stat_sum((s->>'player_a')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date), 'b', _stat_sum((s->>'player_b')::int, coalesce(s->>'stat', 'fpts'), b.start_date, b.end_date));
  elsif b.kind = 'team_ou' then
    out := jsonb_build_object('value', _team_sum(b.creator_team, b.start_date, b.end_date), 'line', (s->>'line')::numeric, 'side', s->>'side');
  elsif b.kind = 'season' then
    -- final regular-season standings: points over the whole regular season
    out := jsonb_build_object('a', _team_sum(b.creator_team, lg.season_start, lg.season_end), 'b', _team_sum(b.opponent_team, lg.season_start, lg.season_end));
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

-- pays a pool: every entry's buy-in comes off, and the whole pot goes to the winners. Coins don't split, so when the
-- pot doesn't divide evenly the ones left over go one each to the winners who entered first. Answers what each winner
-- was paid ({team: coins}), kept on the bet so every page shows the same split.
create or replace function public._pool_pay(p_bet bigint, p_winners int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bets; pot int; n int := coalesce(array_length(p_winners, 1), 0); shares jsonb;
begin
  select * into b from bets where id = p_bet;
  if n = 0 then raise exception 'A pool needs a winner to be paid'; end if;
  select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = p_bet;
  insert into coin_ledger (team_id, amount, reason, bet_id) select team_id, -coins, 'Pool buy-in: ' || b.title, b.id from bet_entries where bet_id = p_bet;
  with w as (
    select e.team_id, pot / n + case when row_number() over (order by e.created_at, e.team_id) <= pot % n then 1 else 0 end as share
    from bet_entries e where e.bet_id = p_bet and e.team_id = any(p_winners)
  ), paid as (
    insert into coin_ledger (team_id, amount, reason, bet_id) select team_id, share, 'Won the pool: ' || b.title, b.id from w returning team_id, amount
  )
  select jsonb_object_agg(team_id, amount) into shares from paid;
  return shares;
end $$;
revoke execute on function public._pool_pay(bigint, int[]) from public, anon, authenticated;

create or replace function public.settle_due_bets() returns jsonb
language plpgsql security definer set search_path = public as $$
declare due bets; b bets; w int; n int := 0; pot int; best numeric; winners int[]; prog jsonb; shares jsonb;
begin
  -- pools close for entries on their own
  update bets set status = 'accepted', accepted_at = now() where kind like 'pool%' and status = 'open' and entry_close < today_et() and league_id = current_league_id();
  for due in select * from bets where league_id = current_league_id() and status = 'accepted' and kind in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player', 'season')
      and coalesce(case when kind = 'season' then (select season_end from league) end, end_date) < today_et() order by id loop
    -- hold the bet while it's paid: a ruling or a concession made this very moment waits, and one already made is left alone
    select * into b from bets where id = due.id and status = 'accepted' for update;
    if not found then continue; end if;
    prog := bet_progress(b.id);
    if b.kind like 'pool%' then
      -- nobody else got in: there's no pool to win, the creator's coins are simply free again
      if (select count(*) from bet_entries where bet_id = b.id) < 2 then
        update bets set status = 'cancelled' where id = b.id;
        perform _notify(b.creator_team, 'bet', format('🎰 Nobody joined your pool "%s", so it''s off. Your coins are free again.', b.title), '/bets');
        continue;
      end if;
      select max((x->>'value')::numeric) into best from jsonb_array_elements(prog->'entries') x;
      select array_agg((x->>'team_id')::int) into winners from jsonb_array_elements(prog->'entries') x where (x->>'value')::numeric = best;
      select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = b.id;
      if winners is null or array_length(winners, 1) is null then
        update bets set status = 'cancelled' where id = b.id; continue;
      end if;
      shares := _pool_pay(b.id, winners);
      update bets set status = 'settled', winner_team = winners[1], settled_at = now(), result = prog || jsonb_build_object('winners', to_jsonb(winners), 'pot', pot, 'shares', shares) where id = b.id;
      perform _sys('general', format('🎰 Pool "%s" is settled: %s %s the %s ☘️ pot', b.title, (select string_agg(_tname(x), ' and ') from unnest(winners) x), case when array_length(winners, 1) = 1 then 'takes' else 'split' end, pot), jsonb_build_object('bet', b.id));
    else
      w := _decide_bet(b);
      if w is null then
        update bets set status = 'settled', push = true, settled_at = now(), result = prog where id = b.id;
        perform _sys('general', format('🤝 Push: "%s" ended dead even. Coins back to both.', b.title), jsonb_build_object('bet', b.id));
      else
        update bets set status = 'settled', winner_team = w, settled_at = now(), result = prog where id = b.id;
        perform _settle_coins(b.id);
        perform _sys('general', format('🏆 %s wins the bet "%s" (%s)%s', _tname(w), b.title,
          case when b.kind in ('h2h', 'player_vs', 'season') then format('%s to %s', round((prog->>'a')::numeric, 1), round((prog->>'b')::numeric, 1)) else format('%s vs the line of %s', round((prog->>'value')::numeric, 1), prog->>'line') end,
          coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end, case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', b.id));
        perform _notify(w, 'bet', format('🏆 You won "%s"', b.title), '/bets');
      end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('settled', n, 'at', now());
end $$;

create or replace function public.commish_rule_bet(p_bet bigint, p_outcome text, p_winner int default null, p_winners int[] default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b bets; pot int; ws int[]; shares jsonb;
begin
  perform public._in_league('bets', p_bet);
  perform _commish();
  select * into b from bets where id = p_bet for update;
  if b.id is null then raise exception 'No such bet'; end if;
  if b.status not in ('accepted', 'settled') then raise exception 'Only live or settled bets can be ruled on (this one is %)', b.status; end if;
  if p_outcome not in ('winner', 'push', 'void') then raise exception 'Outcome must be winner, push or void'; end if;
  -- undo whatever this bet has already moved
  delete from coin_ledger where bet_id = p_bet;
  if p_outcome = 'void' then
    update bets set status = 'cancelled', winner_team = null, push = false, settled_at = now(),
      result = (coalesce(result, '{}'::jsonb) - 'shares') || jsonb_build_object('ruling', jsonb_build_object('outcome', 'void', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: "%s" is void, all stakes returned%s', b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if p_outcome = 'push' then
    update bets set status = 'settled', winner_team = null, push = true, settled_at = now(),
      result = (coalesce(result, '{}'::jsonb) - 'shares') || jsonb_build_object('ruling', jsonb_build_object('outcome', 'push', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: "%s" is a push, coins back to everyone%s', b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if b.kind like 'pool%' then
    -- each winner once, however the list was sent
    select array_agg(distinct x) into ws from unnest(coalesce(p_winners, case when p_winner is not null then array[p_winner] end)) x where x is not null;
    if ws is null or array_length(ws, 1) is null then raise exception 'Pick the pool winner(s)'; end if;
    if exists (select 1 from unnest(ws) x where not exists (select 1 from bet_entries e where e.bet_id = p_bet and e.team_id = x)) then
      raise exception 'Every winner must have an entry in the pool';
    end if;
    select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = p_bet;
    shares := _pool_pay(p_bet, ws);
    update bets set status = 'settled', winner_team = ws[1], push = false, settled_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('winners', to_jsonb(ws), 'pot', pot, 'shares', shares, 'ruling', jsonb_build_object('outcome', 'winner', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: %s %s the pool "%s"%s', (select string_agg(_tname(x), ' and ') from unnest(ws) x),
      case when array_length(ws, 1) = 1 then 'takes' else 'split' end, b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if p_winner is null or p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  update bets set status = 'settled', winner_team = p_winner, push = false, settled_at = now(),
    result = coalesce(result, '{}'::jsonb) || jsonb_build_object('ruling', jsonb_build_object('outcome', 'winner', 'note', p_note, 'at', now())) where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('⚖️ Commissioner ruling: %s wins "%s"%s', _tname(p_winner), b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
  perform _notify(p_winner, 'bet', format('⚖️ The commish ruled you won "%s"', b.title), '/bets');
end $$;

-- a pool is cancelled or left before its games start, never after: it stays 'open' until the morning job closes it,
-- and by then its first night has been played
create or replace function public.cancel_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  perform public._in_league('bets', p_bet);
  select * into b from bets where id = p_bet for update;
  if b.id is null or b.creator_team <> me or b.status <> 'open' then raise exception 'Only your own open bets can be cancelled'; end if;
  if b.kind like 'pool%' and _bet_underway(b.start_date) and exists (select 1 from bet_entries where bet_id = p_bet and team_id <> me) then
    raise exception 'Too late to cancel: this pool''s games have started and others are in it';
  end if;
  update bets set status = 'cancelled' where id = p_bet;
  delete from bet_entries where bet_id = p_bet;
end $$;

create or replace function public.leave_pool(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  perform public._in_league('bets', p_bet);
  select * into b from bets where id = p_bet for update;
  if b.id is null or b.kind not like 'pool%' then raise exception 'That isn''t a pool'; end if;
  if b.status <> 'open' or b.entry_close < today_et() or _bet_underway(b.start_date) then raise exception 'Too late to back out'; end if;
  if b.creator_team = me then raise exception 'Cancel the pool instead'; end if;
  delete from bet_entries where bet_id = p_bet and team_id = me;
end $$;

-- conceding and confirming are between the two sides of a bet; a pool pays from its entries
create or replace function public.claim_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets; other int;
begin perform _need('bets');
  perform public._in_league('bets', p_bet);
  select * into b from bets where id = p_bet for update;
  if b.kind like 'pool%' then raise exception 'A pool settles itself from its entries; the commissioner can rule on it'; end if;
  if b.status <> 'accepted' or b.opponent_team is null or me not in (b.creator_team, b.opponent_team) then raise exception 'Not your bet'; end if;
  if p_winner is null or p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  other := case when me = b.creator_team then b.opponent_team else b.creator_team end;
  if p_winner = other then
    update bets set status = 'settled', winner_team = p_winner, settled_at = now(), proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _settle_coins(p_bet);
    perform _sys('general', format('🏆 %s concedes: %s wins "%s"', _tname(me), _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
  else
    update bets set proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _notify(other, 'bet', format('%s says they won "%s". Confirm or dispute.', _tname(me), b.title), '/bets');
  end if;
end $$;

create or replace function public.confirm_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin perform _need('bets');
  perform public._in_league('bets', p_bet);
  select * into b from bets where id = p_bet for update;
  if b.kind like 'pool%' then raise exception 'A pool settles itself from its entries; the commissioner can rule on it'; end if;
  if b.status <> 'accepted' or b.opponent_team is null or b.proposed_winner is null or b.proposed_by = me or me not in (b.creator_team, b.opponent_team) then
    raise exception 'Nothing to confirm';
  end if;
  update bets set status = 'settled', winner_team = b.proposed_winner, settled_at = now() where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('🏆 %s wins the bet "%s"%s', _tname(b.proposed_winner), b.title,
    coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end,
      case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', p_bet));
end $$;

create or replace function public.commish_settle_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  perform public._in_league('bets', p_bet);
  perform _commish();
  select * into b from bets where id = p_bet for update;
  if b.kind like 'pool%' then raise exception 'Rule on a pool with its winner(s) instead'; end if;
  if b.status <> 'accepted' then raise exception 'Only live bets can be settled'; end if;
  if p_winner is null or b.opponent_team is null or p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  update bets set status = 'settled', winner_team = p_winner, settled_at = now() where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('⚖️ Commissioner ruling: %s wins "%s"', _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
end $$;

-- ───────────── the Book: dead on the line is a push ─────────────
CREATE OR REPLACE FUNCTION public.settle_markets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; g games; w text; res jsonb; n int := 0; v int := 0; pg record; summary text;
begin
  for m in select * from markets where status = 'open' and closes_at < now() and kind <> 'custom' and league_id = current_league_id() loop
    select * into g from games where id = m.game_id;
    if g.id is null then continue; end if;
    if g.state in ('PPD', 'CNCL') then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    if g.state not in ('OFF', 'FINAL') or g.home_score is null then continue; end if;
    w := null; res := jsonb_build_object('home', g.home_score, 'away', g.away_score, 'period', g.period);
    if m.kind = 'winner' then
      w := case when g.home_score > g.away_score then 'home' when g.away_score > g.home_score then 'away' end;
    elsif m.kind = 'total' then
      -- dead on the line is a push: nobody called it, so the stakes go back (w stays null)
      w := case when g.home_score + g.away_score > (m.subject->>'line')::numeric then 'over' when g.home_score + g.away_score < (m.subject->>'line')::numeric then 'under' end;
    elsif m.kind = 'ot' then
      w := case when g.period in ('OT', 'SO') then 'yes' else 'no' end;
    elsif m.kind = 'prop' then
      if not g.final_synced then continue; end if;   -- wait for the box score
      select * into pg from league_games where game_id = g.id and player_id = (m.subject->>'player_id')::int;
      if pg.player_id is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;   -- never dressed: void
      res := res || jsonb_build_object('value', pg.fpts);
      w := case when pg.fpts > (m.subject->>'line')::numeric then 'over' when pg.fpts < (m.subject->>'line')::numeric then 'under' end;
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
          where mk.settled_at > now() - interval '2 minutes' and mk.league_id = current_league_id() group by b.team_id) x;
    if summary is not null then perform _sys('general', format('📖 Book settled %s market%s: %s 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end, summary), jsonb_build_object('book', 'settle')); end if;
  end if;
  return jsonb_build_object('settled', n, 'void', v);
end $function$

;

CREATE OR REPLACE FUNCTION public.settle_race_markets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m markets; s jsonb; d_from date; d_to date; w text; val numeric; n int := 0; ids int[]; clubs text[]; grp text[]; top record; second record; stat text; alive int;
begin
  for m in select * from markets where status = 'open' and kind = 'race' and closes_at < now() and league_id = current_league_id() order by id loop
    s := m.subject; w := null; val := null;
    if s->>'template' in ('player_race', 'player_line', 'club_race') and s ? 'to' then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      if d_to >= today_et() then continue; end if;                                             -- the window is still running
      -- every game in the window final and, for players, in the box scores
      if exists (select 1 from games where date between d_from and d_to and game_type = 2 and (state not in ('OFF', 'FINAL', 'PPD', 'CNCL') or (state in ('OFF', 'FINAL') and not final_synced))) then continue; end if;
    end if;
    stat := s->>'stat';
    if s->>'template' = 'player_race' and s ? 'group' then
      -- against the field: the league-wide leader at the stat over the window (one position, goalies, or every skater)
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into top from league_games pg join league_players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last limit 1;
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into second from league_games pg join league_players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last offset 1 limit 1;
      if top.player_id is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- no box scores at all: refund
      if second.v is not null and second.v = top.v then continue; end if;                                -- the NHL tiebreakers: the commish settles
      update markets set result = jsonb_build_object('winner', top.player_id, 'value', top.v) where id = m.id;
      w := case when _market_option_odds(m, 'p' || top.player_id) is not null then 'p' || top.player_id else 'field' end;
    elsif s->>'template' = 'player_race' then
      select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e;
      with tot as (
        select i as player_id, coalesce((select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end)
                                        from league_games pg where pg.player_id = i and pg.date between d_from and d_to), 0) as v
        from unnest(ids) i)
      select jsonb_object_agg(player_id, v) into s from tot;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- a tie refunds everyone
      w := 'p' || top.key;
    elsif s->>'template' = 'player_line' then
      select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) into val
      from league_games pg where pg.player_id = (s->>'player_id')::int and pg.date between d_from and d_to;
      if val is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;    -- never dressed: refund
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      if val = (s->>'line')::numeric then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- dead on the line: a push, stakes back
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    elsif s->>'template' = 'club_race' and s->>'what' = 'points' then
      select array_agg(e) into clubs from jsonb_array_elements_text(s->'clubs') e;
      with pts as (
        select c, coalesce((select sum(case when (g.home = c and g.home_score > g.away_score) or (g.away = c and g.away_score > g.home_score) then 2 when g.period in ('OT', 'SO') then 1 else 0 end)
                            from games g where c in (g.home, g.away) and g.date between d_from and d_to and g.game_type = 2 and g.state in ('OFF', 'FINAL') and g.home_score is not null), 0) as v
        from unnest(clubs) c)
      select jsonb_object_agg(c, v) into s from pts;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;
      w := 'c' || top.key;
    elsif s->>'template' = 'club_race' and s->>'what' in ('division', 'conference', 'president') then
      select array_agg(e) into grp from jsonb_array_elements_text(s->'group') e;
      if (select bool_and(gp >= 82) from nhl_teams where abbrev = any(grp)) is not true then continue; end if;
      select abbrev, pts into top from nhl_teams where abbrev = any(grp) order by pts desc limit 1;
      select abbrev, pts into second from nhl_teams where abbrev = any(grp) order by pts desc offset 1 limit 1;
      if second.pts = top.pts then continue; end if;                                          -- the NHL tiebreakers: the commish settles
      w := case when _market_option_odds(m, 'c' || top.abbrev) is not null then 'c' || top.abbrev else 'field' end;
      update markets set result = jsonb_build_object('winner', top.abbrev, 'value', top.pts) where id = m.id;
    elsif s->>'template' = 'club_race' and s->>'what' = 'playoffs' then
      select count(*) into alive from nhl_teams where po_status = 'alive';
      if alive <> 16 then continue; end if;                                                   -- the bracket isn't set
      w := case when exists (select 1 from nhl_teams where abbrev = s->'clubs'->>0 and po_status = 'alive') then 'yes' else 'no' end;
    elsif s->>'template' = 'club_line' then
      select pts into val from nhl_teams where abbrev = s->>'club' and gp >= 82;
      if val is null then continue; end if;
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      if val = (s->>'line')::numeric then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- dead on the line: a push, stakes back
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    else
      continue;                                                                               -- the Cup: the commish
    end if;
    if w is not null then perform _payout_market(m.id, w); n := n + 1; end if;
  end loop;
  if n > 0 then perform _sys('general', format('🏁 The Book settled %s requested market%s. 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end), jsonb_build_object('book', 'race-settle')); end if;
  return n;
end $function$

;

CREATE OR REPLACE FUNCTION public.settle_season_markets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l league; m markets; w text; v numeric; n int := 0; done_reg boolean; done_po boolean; mine int[];
begin
  select * into l from league;
  if l.id is null then return 0; end if;
  done_reg := l.season_end is not null and today_et() > l.season_end;
  done_po := l.playoffs_end is not null and today_et() > l.playoffs_end;
  if not done_reg and not done_po then return 0; end if;
  select array_agg(id) into mine from teams where role = 'gm' and league_id = current_league_id();
  for m in select * from markets where status = 'open' and kind in ('future', 'season_prop') and league_id = current_league_id() loop
    w := null;
    if m.kind = 'future' then
      if m.subject->>'what' = 'johnson' and done_reg then select 't' || team_id into w from standings where team_id = any(mine) order by rank, team_id limit 1;
      elsif m.subject->>'what' = 'peter' and done_reg then select 't' || team_id into w from standings where team_id = any(mine) order by rank desc, team_id limit 1;
      elsif m.subject->>'what' = 'playoffs' and done_po then select 't' || team_id into w from playoff_standings where team_id = any(mine) order by rank, team_id limit 1;
      elsif m.subject->>'what' = 'cup' and done_po then select 't' || team_id into w from sak_cup_standings where team_id = any(mine) order by rank, team_id limit 1;
      end if;
      if w is not null and _market_option_odds(m, w) is null then w := null; end if;
    elsif done_reg then
      if m.subject->>'scope' = 'team' then
        select points into v from standings where team_id = (m.subject->>'team_id')::int;
      else
        select case when m.subject->>'stat' = 'fpts' then fpts else (totals->>(m.subject->>'stat'))::numeric end into v
        from player_season where player_id = (m.subject->>'player_id')::int;
      end if;
      if v is null then perform _payout_market(m.id, null); continue; end if;   -- nothing to settle on: refund
      update markets set result = jsonb_build_object('value', v) where id = m.id;
      if v = (m.subject->>'line')::numeric then perform _payout_market(m.id, null); continue; end if;   -- dead on the line: a push, stakes back
      w := case when v > (m.subject->>'line')::numeric then 'over' else 'under' end;
    end if;
    if w is not null then perform _payout_market(m.id, w); n := n + 1; end if;
  end loop;
  if n > 0 then perform _sys('general', format('🔮 The Book settled %s season market%s. 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end), jsonb_build_object('book', 'season-settle')); end if;
  return n;
end $function$

;

