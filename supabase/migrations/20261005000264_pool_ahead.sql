-- The voice in every pool (docs/DEVELOPMENT.md §8.4 item 3): a pool on games hears from its voice on game days, the
-- way a show pool does on drop days. pool_ahead() is the pool's next day (or any number of hours) on its own events,
-- for Garry's morning post and his chat: the games about to be played on the events the pool follows, and every
-- pick that locks in the window, game by game, with who still hasn't made it. One read for every kind of game:
--   pick'em, last one standing, call the score: the round whose matches are still to kick off (the rest of a round
--     under way counts), locking at its next kick-off; a member is "still to pick" with fewer picks than matches
--     (last one standing: no pick for the round, and only while still in);
--   the daily streak: today's games (Eastern), locking at the first; a member without the day's pick;
--   pick the series: each series set and yet to start; a member without a pick on it;
--   the bracket, rank the teams, the box pool: their one lock; a member with nothing in;
--   the prop sheet: its game's start; a member with no sheet.
-- The grid of squares and the sweepstake have nothing to pick, so nothing to lock. Members are the seated ones (a
-- team with an account), the way the bells go. Security definer so the pool's voice (the service key) and a member
-- (the site) read the same thing; the pool is the caller's, never a parameter.

create or replace function public.pool_ahead(p_hours int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); until timestamptz := now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 30), 24 * 14)));
  g record; r int; at timestamptz; total int; day date; s record; locks jsonb := '[]'; games jsonb; w text; still text[]; of int;
begin
  if lid is null then return null; end if;
  select count(*) into of from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null;

  -- the games about to be played on the pool's events: fixtures (a match, a game of a series) still to start
  select coalesce(jsonb_agg(jsonb_build_object(
    'fixture', x.id, 'competition', x.competition, 'event', x.name, 'home', x.home, 'away', x.away, 'at', x.kickoff,
    'series', x.label, 'game_no', x.game_no, 'round', x.gameweek) order by x.kickoff, x.id), '[]')
  into games
  from (select f.id, f.competition, c.name, hc.name home, ac.name away, f.kickoff, sr.label, f.game_no, f.gameweek
        from fixtures f join pool_competitions() c on c.id = f.competition
        join clubs hc on hc.id = f.home_club join clubs ac on ac.id = f.away_club
        left join series sr on sr.id = f.series_id
        where f.state = 'scheduled' and f.kickoff > now() and f.kickoff <= until
          and not exists (select 1 from pool_result_overrides o where o.league_id = lid and o.fixture_id = f.id)
        order by f.kickoff, f.id limit 40) x;

  for g in select pg.id, pg.kind, pg.competition, pg.title, pg.rules from pool_games pg
           where pg.league_id = lid and pg.status = 'open' and pg.kind not in ('squares', 'sweep') order by pg.id loop
    w := _round_word(g.competition);
    if g.kind in ('pickem', 'survivor', 'score') then
      -- the round still to be played: the first with a match yet to kick off, within the game's rounds
      r := case g.kind when 'survivor' then _survivor_week(g.id) when 'score' then _predictor_week(g.id)
             else (select min(f.gameweek) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
                     and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int) end;
      continue when r is null;
      select min(f.kickoff), count(*) into at, total from fixtures f where f.competition = g.competition and f.gameweek = r
        and f.state = 'scheduled' and f.kickoff > now() and (select e.open from _pool_fixture(lid, f.id) e);
      continue when at is null or at > until;
      if g.kind = 'survivor' then
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and _survivor_alive(g.id, t.id)
          and not exists (select 1 from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = t.id and p.gameweek = r);
      elsif g.kind = 'score' then
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and (select count(*) from pool_predictor_picks p where p.predictor_id = g.id and p.team_id = t.id and p.gameweek = r)
            < (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = r);
      else
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and (select count(*) from pool_picks p join fixtures f on p.thing = 'f:' || f.id where p.game_id = g.id and p.team_id = t.id and f.gameweek = r)
            < (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = r);
      end if;
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', w || ' ' || r, 'at', at,
        'matches', total, 'under_way', exists (select 1 from fixtures f where f.competition = g.competition and f.gameweek = r and f.kickoff <= now()),
        'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    elsif g.kind = 'streak' then
      -- the day's games (Eastern): the pick locks when the first starts
      select min(f.kickoff) into at from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
        and f.home_club is not null and f.away_club is not null and _streak_playable(f.id) and (select e.open from _pool_fixture(lid, f.id) e);
      continue when at is null or at > until;
      day := _streak_day(at);
      select count(*) into total from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
        and _streak_day(f.kickoff) = day and _streak_playable(f.id);
      select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
        and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id and p.thing = 'd:' || to_char(day, 'YYYY-MM-DD'));
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', to_char(day, 'FMDay'), 'at', at,
        'matches', total, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    elsif g.kind = 'series' then
      -- every series set and yet to start in the window, each its own lock
      for s in select x.id, x.label, x.starts_at from series x where x.competition = g.competition and x.state = 'scheduled'
               and x.high_club is not null and x.low_club is not null and x.starts_at > now() and x.starts_at <= until
               and x.round >= (g.rules->>'from_round')::int order by x.starts_at, x.sort, x.id loop
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id and p.thing = 's:' || s.id);
        locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', s.label, 'at', s.starts_at,
          'series', s.id, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
      end loop;
    elsif g.kind in ('bracket', 'rank', 'players', 'props') then
      at := case g.kind when 'players' then _players_lock(g.id) when 'props' then (select f.kickoff from fixtures f where f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled')
              else _rank_lock(g.id) end;
      continue when at is null or at <= now() or at > until;
      select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
        and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id
                        and p.thing = case g.kind when 'players' then 'box' else g.kind end);
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title,
        'round', case g.kind when 'bracket' then 'the bracket' when 'rank' then 'the order' when 'players' then 'the teams' else 'the sheet' end,
        'at', at, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    end if;
  end loop;
  return jsonb_build_object('games', games, 'locks', locks, 'members', of);
end $$;
revoke execute on function public.pool_ahead(int) from public, anon;
grant execute on function public.pool_ahead(int) to authenticated;
