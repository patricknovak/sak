-- Garry's picks join the prediction log (docs/DEVELOPMENT.md, section 4: "the Book's odds, Garry's picks").
--
-- When a GM asks Garry what to bet on, each pick he hands back (a market and an option) is written as a 'garry_pick'
-- prediction by the garry function: the chance the option's odds gave it at that moment, once per league, market and
-- option however many GMs he tells. score_predictions scores it 1 or 0 when the market settles. Over a season the
-- calibration page shows whether Garry's picks come in more often than the odds said.

set client_min_messages = warning;

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
  -- a draft class or a team's keepers, once the regular season is done: what those players scored from the day after
  -- the draft, in this league's points, whoever they played for by then (the grade is of the picks, not the moves after)
  with done as (
    select pr.id,
      coalesce((select sum(lg.fpts) from league_games lg where lg.player_id in (select jsonb_array_elements_text(pr.subject->'players')::int)
                  and lg.date between (pr.subject->>'from')::date and pr.resolves_on), 0) as pts
    from predictions pr
    where pr.league_id = lid and pr.kind in ('draft_value', 'keeper_value') and pr.status = 'open' and pr.resolves_on <= through)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  -- Garry's picks at the Book: a pick he recommended is 1 if the market went that way and 0 if not, against the chance
  -- its odds gave it when he made it, so the log shows whether his picks beat the Book's own prices. Scored when the
  -- market settles, whatever the date; a void market voids the pick.
  update predictions pr set outcome = case when m.winner_key = pr.subject->>'pick' then 1 else 0 end,
    error = case when m.winner_key = pr.subject->>'pick' then 1 else 0 end - pr.predicted, status = 'scored', scored_at = now()
  from markets m
  where pr.league_id = lid and pr.kind = 'garry_pick' and pr.status = 'open'
    and m.id = (pr.subject->>'market_id')::bigint and m.league_id = pr.league_id and m.status = 'settled' and m.winner_key is not null;
  get diagnostics k = row_count; n := n + k;
  update predictions pr set status = 'void', scored_at = now()
  from markets m
  where pr.league_id = lid and pr.kind = 'garry_pick' and pr.status = 'open'
    and m.id = (pr.subject->>'market_id')::bigint and m.league_id = pr.league_id and m.status = 'void';
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.score_predictions(date) from public, anon, authenticated;
