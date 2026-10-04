-- Review fixes 5 (the review of #156 to #163):
--
-- * log_pickup_call took any call a GM sent: any player on the roster as the add, any id as the drop (each a new row),
--   any gain up to 500. Now a call needs the move itself: this team's add of that player in the last ten minutes and,
--   when a drop is named, its drop of that player in the same ten minutes; the gain is held to 30 points a night of the
--   stretch (no player is worth more).
-- * The pickup's outcome skipped the night of the pickup while the promise counted it (the advisor forecasts from
--   today, and the new player can start tonight). Both sides now count the games that start after the call was made.

set client_min_messages = warning;

create or replace function public.log_pickup_call(p_add int, p_drop int, p_gain numeric, p_to date) returns boolean
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); t int := my_team(); r league_rules; upto date; cap numeric;
begin
  if t is null or p_add is null or p_gain is null then return false; end if;
  -- the GM's own pickup, just made: on their roster, and the add (and the drop, if any) in the log minutes ago
  if not exists (select 1 from rosters where team_id = t and player_id = p_add and league_id = lid) then return false; end if;
  if not exists (select 1 from transactions where league_id = lid and team_id = t and type = 'add' and player_id = p_add
                   and created_at > now() - interval '10 minutes') then return false; end if;
  if p_drop is not null and not exists (select 1 from transactions where league_id = lid and team_id = t and type = 'drop'
                   and player_id = p_drop and created_at > now() - interval '10 minutes') then return false; end if;
  select * into r from league_rules where league_id = lid;
  upto := least(coalesce(p_to, today_et() + 14), coalesce(r.season_end, today_et() + 200), today_et() + 200);
  if upto <= today_et() then return false; end if;
  cap := 30 * (upto - today_et() + 1);
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
  values (lid, 'pickup', jsonb_build_object('team_id', t, 'add', p_add, 'drop', p_drop, 'from', today_et()),
          round(greatest(-cap, least(cap, p_gain)), 2), 'advisor', upto)
  on conflict (league_id, kind, subject) do nothing;
  return true;
end $$;
revoke execute on function public.log_pickup_call(int, int, numeric, date) from public, anon;
grant execute on function public.log_pickup_call(int, int, numeric, date) to authenticated;

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
  -- So is a night none of its starters played, or one where a starter's game was postponed (migration 136).
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
      not exists (select 1 from played p where p.id = due.id and p.started <> (p.player_id = any (due.picked)))
        -- somebody it started played (a night of postponements or a missed snapshot isn't a call to score)
        and exists (select 1 from played p where p.id = due.id and p.started)
        -- and none of its starters lost his game to a postponement: the call counted on points that never came
        and not exists (select 1 from players pl join games g on g.date = due.d and pl.nhl_team in (g.home, g.away)
                        where pl.id = any (due.picked) and g.state in ('PPD', 'CNCL')) as same
    from due)
  update predictions pr set
    outcome = case when j.same then j.pts end, error = case when j.same then j.pts - pr.predicted end,
    status = case when j.same then 'scored' else 'void' end, scored_at = now()
  from judged j where pr.id = j.id;
  get diagnostics k = row_count; n := n + k;
  -- a head-to-head win chance (migration 137), once its week is over and that last night is final: 1 if the home side
  -- won, 0 if it lost, a half for a tie, against the chance given; a matchup that's gone (the schedule was remade) voids it
  with due as (
    select pr.id, m.id as mid, m.home_team, m.away_team, m.starts, m.ends
    from predictions pr
    left join matchups m on m.id = (pr.subject->>'matchup_id')::bigint and m.league_id = pr.league_id
    where pr.league_id = lid and pr.kind = 'h2h_win' and pr.status = 'open' and pr.resolves_on <= through
      and not exists (select 1 from games g where g.date = pr.resolves_on and not g.final_synced and g.state not in ('PPD', 'CNCL'))
  ), res as (
    select due.id, due.mid, x.a_score, x.b_score
    from due left join lateral (select * from _h2h_result(due.home_team, due.away_team, due.starts, due.ends) where due.mid is not null) x on true
  )
  update predictions pr set
    outcome = case when res.mid is null then null when res.a_score > res.b_score then 1 when res.a_score < res.b_score then 0 else 0.5 end,
    error = case when res.mid is null then null when res.a_score > res.b_score then 1 when res.a_score < res.b_score then 0 else 0.5 end - pr.predicted,
    status = case when res.mid is null then 'void' else 'scored' end, scored_at = now()
  from res where pr.id = res.id;
  get diagnostics k = row_count; n := n + k;
  -- a pickup the advisor suggested (migrations 138, 139), once its stretch is over: what the player added scored in the
  -- team's starting lineup in games that began after the pickup, less what the player dropped scored in those games
  -- anywhere (as if he'd have started every one: a call that holds up against that is a good one). The promise counted
  -- from the night of the pickup, so a game later that night counts too.
  with done as (
    select pr.id,
      coalesce((select sum(lg.fpts) from lineup_snapshots s join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
                join games g on g.id = s.game_id
                where s.league_id = lid and s.team_id = (pr.subject->>'team_id')::int and s.player_id = (pr.subject->>'add')::int
                  and s.slot not in ('BN', 'IR') and g.start_utc > pr.made_at and s.date <= pr.resolves_on), 0)
      - coalesce((select sum(lg.fpts) from league_games lg join games g on g.id = lg.game_id
                  where lg.player_id = nullif(pr.subject->>'drop', '')::int
                    and g.start_utc > pr.made_at and lg.date <= pr.resolves_on), 0) as pts
    from predictions pr
    where pr.league_id = lid and pr.kind = 'pickup' and pr.status = 'open' and pr.resolves_on <= through
      and not exists (select 1 from games g where g.date = pr.resolves_on and not g.final_synced and g.state not in ('PPD', 'CNCL')))
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.score_predictions(date) from public, anon, authenticated;
