-- The auto-pilot's choices go in the prediction log (docs/DEVELOPMENT.md section 4). Each morning (and again late in the
-- afternoon) the auto-pilot sets the lineup of every team that hands it the job; it now writes down what it expects
-- that lineup to score and which players it started (nhl-sync, `auto_lineup`, one per team and night, the later run
-- replacing the earlier). Once the night's games are final, score_predictions takes what those starters scored. A night
-- the GM changed after the auto-pilot is theirs, not its: void. The Calibration page shows how close the calls run.
--
-- * predictions.detail: what a call was made of (the auto-pilot's starters), beside the number.

set client_min_messages = warning;

alter table public.predictions add column if not exists detail jsonb;

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
  -- the auto-pilot's lineup, once every game that night is final: what its starters scored. A night the GM changed
  -- (the players who started aren't the ones it picked, among those who played) is the GM's, not the auto-pilot's: void.
  with due as (
    select pr.id, (pr.subject->>'team_id')::int as team_id, (pr.subject->>'date')::date as d,
      array(select jsonb_array_elements_text(coalesce(pr.detail->'starters', '[]'))::int) as picked
    from predictions pr
    where pr.league_id = lid and pr.kind = 'auto_lineup' and pr.status = 'open' and pr.resolves_on <= through
      and not exists (select 1 from games g where g.date = (pr.subject->>'date')::date and not g.final_synced and g.state not in ('PPD', 'CNCL'))
  ), played as (
    select due.id, s.player_id, s.slot not in ('BN', 'IR') as started, lg.fpts
    from due
    join lineup_snapshots s on s.team_id = due.team_id and s.date = due.d and s.league_id = lid
    join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
  ), judged as (
    select due.id,
      coalesce((select sum(p.fpts) from played p where p.id = due.id and p.started), 0) as pts,
      not exists (select 1 from played p where p.id = due.id and p.started <> (p.player_id = any (due.picked))) as same
    from due)
  update predictions pr set
    outcome = case when j.same then j.pts end, error = case when j.same then j.pts - pr.predicted end,
    status = case when j.same then 'scored' else 'void' end, scored_at = now()
  from judged j where pr.id = j.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.score_predictions(date) from public, anon, authenticated;
