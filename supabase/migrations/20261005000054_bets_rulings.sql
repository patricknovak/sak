-- Side bets settle themselves, the commish can overrule, and every bet shows live odds.
--
-- * Final-standings ("season") bets now settle on their own once the regular season ends: more regular-season
--   points wins, a tie pushes. (Every box-score bet already settled itself the morning after it ends.)
-- * commish_rule_bet: the commissioner's override for any bet, live or already settled. It first undoes every
--   coin that bet moved, then applies the ruling: a winner (or pool winners), a push, or void (all stakes back).
--   The ruling and the commish's note are kept on the bet and announced.

create or replace function public.bet_progress(p_bet bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b bets; s jsonb; out jsonb := '{}'; lg league;
begin
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

create or replace function public._decide_bet(b bets) returns int
language plpgsql stable security definer set search_path = public as $$
declare p jsonb := bet_progress(b.id); a numeric; bb numeric; v numeric; line numeric;
begin
  if b.kind in ('h2h', 'player_vs', 'season') then
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
  for b in select * from bets where status = 'accepted' and kind in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player', 'season')
      and coalesce(case when kind = 'season' then (select season_end from league) end, end_date) < today_et() loop
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
          case when b.kind in ('h2h', 'player_vs', 'season') then format('%s to %s', round((prog->>'a')::numeric, 1), round((prog->>'b')::numeric, 1)) else format('%s vs the line of %s', round((prog->>'value')::numeric, 1), prog->>'line') end,
          coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end, case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', b.id));
        perform _notify(w, 'bet', format('🏆 You won "%s"', b.title), '/bets');
      end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('settled', n, 'at', now());
end $$;
revoke execute on function public.settle_due_bets(), public._decide_bet(bets) from public, anon, authenticated;

create or replace function public.commish_rule_bet(p_bet bigint, p_outcome text, p_winner int default null, p_winners int[] default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b bets; pot int; ws int[];
begin
  perform _commish();
  select * into b from bets where id = p_bet for update;
  if b.id is null then raise exception 'No such bet'; end if;
  if b.status not in ('accepted', 'settled') then raise exception 'Only live or settled bets can be ruled on (this one is %)', b.status; end if;
  if p_outcome not in ('winner', 'push', 'void') then raise exception 'Outcome must be winner, push or void'; end if;
  -- undo whatever this bet has already moved
  delete from coin_ledger where bet_id = p_bet;
  if p_outcome = 'void' then
    update bets set status = 'cancelled', winner_team = null, push = false, settled_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('ruling', jsonb_build_object('outcome', 'void', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: "%s" is void, all stakes returned%s', b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if p_outcome = 'push' then
    update bets set status = 'settled', winner_team = null, push = true, settled_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('ruling', jsonb_build_object('outcome', 'push', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: "%s" is a push, coins back to everyone%s', b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if b.kind like 'pool%' then
    ws := coalesce(p_winners, case when p_winner is not null then array[p_winner] end);
    if ws is null or array_length(ws, 1) is null then raise exception 'Pick the pool winner(s)'; end if;
    if exists (select 1 from unnest(ws) x where not exists (select 1 from bet_entries e where e.bet_id = p_bet and e.team_id = x)) then
      raise exception 'Every winner must have an entry in the pool';
    end if;
    select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = p_bet;
    insert into coin_ledger (team_id, amount, reason, bet_id) select team_id, -coins, 'Pool buy-in: ' || b.title, b.id from bet_entries where bet_id = p_bet;
    insert into coin_ledger (team_id, amount, reason, bet_id) select x, pot / array_length(ws, 1), 'Won the pool: ' || b.title, b.id from unnest(ws) x;
    update bets set status = 'settled', winner_team = ws[1], push = false, settled_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('winners', to_jsonb(ws), 'pot', pot, 'ruling', jsonb_build_object('outcome', 'winner', 'note', p_note, 'at', now())) where id = p_bet;
    perform _sys('general', format('⚖️ Commissioner ruling: %s take%s the pool "%s"%s', (select string_agg(_tname(x), ' and ') from unnest(ws) x),
      case when array_length(ws, 1) = 1 then 's' else '' end, b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
    return;
  end if;
  if p_winner is null or p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  update bets set status = 'settled', winner_team = p_winner, push = false, settled_at = now(),
    result = coalesce(result, '{}'::jsonb) || jsonb_build_object('ruling', jsonb_build_object('outcome', 'winner', 'note', p_note, 'at', now())) where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('⚖️ Commissioner ruling: %s wins "%s"%s', _tname(p_winner), b.title, coalesce('. ' || p_note, '')), jsonb_build_object('bet', p_bet));
  perform _notify(p_winner, 'bet', format('⚖️ The commish ruled you won "%s"', b.title), '/bets');
end $$;
revoke execute on function public.commish_rule_bet(bigint, text, int, int[], text) from public, anon;
grant execute on function public.commish_rule_bet(bigint, text, int, int[], text) to authenticated;
