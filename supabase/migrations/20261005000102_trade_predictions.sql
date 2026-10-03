-- Trades join the prediction log (docs/DEVELOPMENT.md, section 4: "next kinds: trade and draft grades").
--
-- When a trade goes through, each team in it gets a 'trade_value' prediction: the points the players it takes in are
-- expected to score over the rest of the regular season, less the points of the players it sends out (each player's
-- per-game rate, _player_rate, times his club's games left). At the end of the regular season score_predictions
-- fills in what those players actually scored from the day after the trade, so every league learns how far its
-- trade values were off and which way. Picks, pickups and coins aren't valued here; the players are.
-- The row is written by a trigger on the trade's approval, so every path that approves a trade logs it.

set client_min_messages = warning;

-- the points a set of players is expected to score from one day to another: rate per game times his club's games
create or replace function public._players_left(p_ids int[], p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(_player_rate(p.id, 'fpts') * (
    select count(*) from games g
    where g.date between p_from and p_to and g.game_type = 2 and p.nhl_team in (g.home, g.away) and g.state not in ('PPD', 'CNCL'))), 0)
  from players p where p.id = any (p_ids)
$$;
revoke execute on function public._players_left(int[], date, date) from public, anon, authenticated;

create or replace function public._predict_trade() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev text := current_setting('app.league_id', true); d date; se date; t int; ins int[]; outs int[];
begin
  perform set_config('app.league_id', new.league_id::text, true);
  d := today_et();
  select season_end into se from league_rules where league_id = new.league_id;
  if se is not null and se > d then
    foreach t in array coalesce(new.parties, array[new.from_team, new.to_team]) loop
      select coalesce(array_agg(i.player_id order by i.player_id) filter (
               where coalesce(i.to_team, case when i.from_team = new.from_team then new.to_team else new.from_team end) = t), '{}'),
             coalesce(array_agg(i.player_id order by i.player_id) filter (where i.from_team = t), '{}')
        into ins, outs
      from trade_items i where i.trade_id = new.id and i.player_id is not null;
      if cardinality(ins) + cardinality(outs) > 0 then
        insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
        values (new.league_id, 'trade_value',
          jsonb_build_object('trade_id', new.id, 'team_id', t, 'in', to_jsonb(ins), 'out', to_jsonb(outs), 'from', d + 1),
          round(_players_left(ins, d + 1, se) - _players_left(outs, d + 1, se), 1), 'season rate x games left', se)
        on conflict (league_id, kind, subject) do nothing;
      end if;
    end loop;
  end if;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return new;
end $$;

create or replace trigger trades_predict after update of status on public.trades
  for each row when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function public._predict_trade();

create or replace function public.score_predictions(p_through date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); through date := coalesce(p_through, today_et() - 1); n int := 0; k int;
begin
  -- a player who dressed: his points that night in this league's scoring
  with done as (
    select pr.id, sum(lg.fpts) as pts
    from predictions pr
    join league_games lg on lg.player_id = (pr.subject->>'player_id')::int and lg.date = (pr.subject->>'date')::date
    join games g on g.id = lg.game_id and g.final_synced
    where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    group by pr.id)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  -- a player who never dressed once his club's games that night are final: void, not a zero
  update predictions pr set status = 'void', scored_at = now()
  where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    and not exists (select 1 from games g join players p on p.id = (pr.subject->>'player_id')::int
                    where g.date = (pr.subject->>'date')::date and p.nhl_team in (g.home, g.away) and not g.final_synced
                      and g.state not in ('PPD', 'CNCL'));
  get diagnostics k = row_count; n := n + k;
  -- a trade, once the regular season it was valued over is done: what the players coming in scored from the day
  -- after it went through, less what the players going out scored, in this league's points
  with done as (
    select pr.id,
      coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'in')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0)
      - coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'out')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0) as pts
    from predictions pr
    where pr.league_id = lid and pr.kind = 'trade_value' and pr.status = 'open' and pr.resolves_on <= through)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
