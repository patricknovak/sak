-- A head-to-head matchup, player by player: each side's started players that week, their points and games. The site
-- opens it from a matchup card. It reads as the caller (row-level security) and only the caller's league's matchups.

set client_min_messages = warning;

create or replace function public.h2h_matchup_players(p_matchup bigint)
returns table (team_id int, player_id int, pts numeric, games int)
language sql stable set search_path = public as $$
  -- a started player's points that week, counted exactly as the week's score is (team_daily: never the bench or IR,
  -- regular-season games, from the season's first day, while the league is in season)
  select s.team_id, s.player_id, sum(lg.fpts), count(*)::int
  from matchups m
  join lineup_snapshots s on s.league_id = m.league_id and s.team_id in (m.home_team, m.away_team) and s.date between m.starts and m.ends
  join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
  join games g on g.id = s.game_id and g.game_type = 2
  cross join league l
  where m.id = p_matchup and m.league_id = current_league_id() and s.slot not in ('BN', 'IR')
    and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.player_id
$$;
revoke execute on function public.h2h_matchup_players(bigint) from public, anon;
grant execute on function public.h2h_matchup_players(bigint) to authenticated, service_role;
