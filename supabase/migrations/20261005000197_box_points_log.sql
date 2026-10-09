-- The box pool in the prediction log (docs/DEVELOPMENT.md §4): once a box pool locks, each team's expected points for
-- the window (every player's projection a game under the pool's scoring, times his club's games in the window, times
-- the share he plays: `_box_rate`) is a forecast, `box_points`, scored when the pool is done on the points the team
-- actually made. Over many pools it says how well the boxes were dealt: a forecast that runs high or low by position
-- shows in the error. The hourly pool job writes it, once per team.

create or replace function public._players_log(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'box_points', jsonb_build_object('game', g.id, 'team_id', pk.team_id),
    round(sum(_box_rate((e #>> '{}')::int, g.rules->'scoring')
      * (select count(*) from _box_games((g.rules->>'from')::date, (g.rules->>'to')::date) b
         join players pl on pl.id = (e #>> '{}')::int where pl.nhl_team in (b.home, b.away))), 1),
    'projection', (g.rules->>'to')::date + 1, jsonb_build_object('players', count(*), 'preset', g.rules->>'preset')
  from pool_games g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
  cross join lateral jsonb_array_elements(pk.pick->'players') e
  where g.league_id = p_league and g.kind = 'players' and g.status = 'open' and coalesce(_players_lock(g.id) <= now(), false)
  group by g.league_id, g.id, pk.team_id, g.rules
  on conflict (league_id, kind, subject) do nothing;
  get diagnostics k = row_count;
  return k;
end $$;
revoke execute on function public._players_log(int) from public, anon, authenticated;

-- a box pool done: each team's forecast against its points
create or replace function public._box_points_score() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'players' and new.status = 'done' and old.status is distinct from 'done' then
    update predictions pr set outcome = t.points, error = t.points - pr.predicted, status = 'scored', scored_at = now()
    from _players_table(new.id) t
    where pr.league_id = new.league_id and pr.kind = 'box_points' and pr.status = 'open'
      and (pr.subject->>'game')::bigint = new.id and (pr.subject->>'team_id')::int = t.team_id;
  end if;
  return new;
end $$;
revoke execute on function public._box_points_score() from public, anon, authenticated;
drop trigger if exists pool_games_box_points_score on public.pool_games;
create trigger pool_games_box_points_score after update of status on public.pool_games
  for each row execute function public._box_points_score();

-- the hourly pool job: the forecast at the lock too
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

