-- Review fixes to the tiebreaker and week by week (15 October 2026, migrations 290 and 291).
--
-- 1. A round's last game settled by hand with no score (the straight-up desk sends none) gave the tiebreaker no total,
--    so every tie was shared, even once the feed went final. The total is now the host's score when they gave one, else
--    the feed's final score (`_pool_total`); a round with no total yet isn't the tiebreak round.
-- 2. A round with only a game put off showed in the week-by-week grid as being played; a round shows once a game in it
--    has a result.

-- the total score of a match as a pool reads it: the host's, when they gave a score, else the feed's once final
create or replace function public._pool_total(p_league int, p_fixture bigint) returns int
language sql stable security definer set search_path = public as $$
  select case when o.home is not null and o.away is not null then o.home + o.away
              when f.state = 'final' then coalesce(f.home_ft, f.home_score) + coalesce(f.away_ft, f.away_score) end
  from fixtures f left join pool_result_overrides o on o.league_id = p_league and o.fixture_id = f.id
  where f.id = p_fixture
$$;
revoke execute on function public._pool_total(int, bigint) from public, anon, authenticated;

create or replace function public._pickem_miss(p_game bigint, p_team int, p_round int) returns int
language sql stable security definer set search_path = public as $$
  select abs((pk.pick->>'runs')::int - _pool_total(g.league_id, f.id))::int
  from pool_games g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_team and pk.thing = 't:' || p_round
  join fixtures f on f.id = coalesce((pk.pick->>'fixture')::bigint, _pickem_last(g.competition, p_round))
  cross join lateral _pool_fixture(g.league_id, f.id) e
  -- the pool's own result and score: the host's when they settled it by hand (migration 291), else the feed's
  where g.id = p_game and e.done and not e.void
$$;

create or replace function public._pickem_tb_round(p_game bigint) returns int
language sql stable security definer set search_path = public as $$
  select max(f.gameweek) from pool_games g join fixtures f on f.competition = g.competition
  cross join lateral _pool_fixture(g.league_id, f.id) e
  where g.id = p_game and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
    and e.done and not e.void and f.id = _pickem_last(g.competition, f.gameweek)
    -- a round counts for the tiebreak only once its last game has a total (migration 292)
    and _pool_total(g.league_id, f.id) is not null
$$;

create or replace function public._pickem_board(p_game bigint, p_round int, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; tr int; cur int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' then return null; end if;
  fr := (g.rules->>'from_round')::int; tr := (g.rules->>'to_round')::int;
  cur := coalesce(p_round, (select min(gameweek) from fixtures where competition = g.competition and gameweek between fr and tr and state in ('scheduled', 'live')), tr);
  cur := greatest(fr, least(tr, cur));
  return jsonb_build_object('round', cur, 'from_round', fr, 'to_round', tr, 'word', _round_word(g.competition),
    'confidence', g.rules->>'preset' = 'confidence', 'draws', coalesce((g.rules->>'draws')::boolean, false),
    'ats', coalesce((g.rules->>'ats')::boolean, false),
    'missed', coalesce(g.rules->>'missed', 'zero'),
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    -- the round's tiebreaker: the total in the game it was called on (its last game when called, migration 286), locked
    -- when that game starts; called on a game since put off, a fresh call on the round's last game now
    'tiebreak', (select jsonb_build_object('fixture', f.id, 'kickoff', f.kickoff, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'locked', f.state <> 'scheduled' or f.kickoff <= now(),
        'total', case when (select x.done and not x.void from _pool_fixture(g.league_id, f.id) x)
                      then _pool_total(g.league_id, f.id) end,
        'mine', case when tp.fixture is null or tp.fixture = f.id then tp.runs end,
        'word', _sport_word(g.competition, 'score', 'points'), 'cap', _score_cap(g.competition))
      from fixtures f
      left join (select (pk.pick->>'runs')::int runs, (pk.pick->>'fixture')::bigint fixture from pool_picks pk
                 where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 't:' || cur) tp on true
      where f.id = coalesce((select x.id from fixtures x where x.id = tp.fixture and x.state not in ('postponed', 'cancelled')),
                            _pickem_last(g.competition, cur))),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', x.gw, 'first', x.first, 'last', x.last, 'matches', x.n, 'done', x.done, 'open', x.open,
        'picked', (select count(*) from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw),
        'points', (select coalesce(sum(case when (g.rules->>'preset') = 'confidence' then coalesce((pk.pick->>'conf')::int, 1) else 1 end), 0)
                   from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
                   where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw
                     and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, _pool_score(g.league_id, f.id, true), _pool_score(g.league_id, f.id, false))))
        order by x.gw)
      from (select gameweek gw, min(kickoff) first, max(kickoff) last, count(*)::int n,
              bool_and(state in ('final', 'postponed', 'cancelled')) done, count(*) filter (where state = 'scheduled' and kickoff > now())::int open
            from fixtures where competition = g.competition and gameweek between fr and tr group by gameweek) x), '[]'),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'minute', f.minute,
        'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score),
        'result', e.res, 'void', e.void,
        -- the host's word on a match the feed got wrong or never finished, and why
        'host', case when e.by_host then jsonb_build_object('reason', e.reason) end,
        'locked', f.state <> 'scheduled' or f.kickoff <= now() or e.by_host,
        'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id),
        -- against the spread: the home side's line now (what a pick made now is made at), and what my pick's own line
        -- made of the result
        'line', case when g.rules->>'ats' = 'true' then coalesce((f.detail->'odds'->>'line')::numeric, 0) end,
        'mine_res', case when g.rules->>'ats' = 'true' then (select _pick_res(g.rules, pk.pick, e.res, e.by_host, _pool_score(g.league_id, f.id, true), _pool_score(g.league_id, f.id, false))
                                                            from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'f:' || f.id) end,
        'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id),
        -- the pool's split and everyone's picks, once the match has kicked off (never before: the picks would be a copy)
        'split', case when f.state <> 'scheduled' or f.kickoff <= now() then
            (select jsonb_build_object('H', count(*) filter (where pk.pick->>'pick' = 'H'), 'D', count(*) filter (where pk.pick->>'pick' = 'D'),
                                       'A', count(*) filter (where pk.pick->>'pick' = 'A'))
             from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id) end,
        'calls', case when f.state <> 'scheduled' or f.kickoff <= now() then
            coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('team_id', pk.team_id, 'pick', pk.pick->>'pick', 'conf', (pk.pick->>'conf')::int,
                        'line', (pk.pick->>'line')::numeric)) order by pk.team_id)
                      from pool_picks pk where pk.game_id = g.id and pk.thing = 'f:' || f.id), '[]') end)
      order by f.kickoff, f.id)
      from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e where f.competition = g.competition and f.gameweek = cur), '[]'));
end $$;

create or replace function public.pool_pickem_weeks(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() and kind = 'pickem';
  if g.id is null then return null; end if;
  return (
    with fx as (select f.id, f.gameweek r, e.res, e.by_host, e.done,
                  _pool_score(g.league_id, f.id, true) h, _pool_score(g.league_id, f.id, false) a
                from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
    -- a round shows once one of its games has a result (a game put off alone doesn't start it, migration 292)
    rounds as (select fx.r, bool_and(fx.done) done from fx group by fx.r having bool_or(fx.res is not null)),
    members as (select tm.id from teams tm where tm.league_id = g.league_id and tm.role = 'gm'),
    pts as (select p.team_id, fx.r,
              sum(case when g.rules->>'preset' = 'confidence' then coalesce((p.pick->>'conf')::int, 1) else 1 end)
                filter (where fx.res is not null and p.pick->>'pick' = _pick_res(g.rules, p.pick, fx.res, fx.by_host, fx.h, fx.a))::int pts
            from pool_picks p join fx on p.thing = 'f:' || fx.id
            where p.game_id = g.id group by 1, 2),
    grid as (select m.id team_id, rd.r, rd.done, coalesce(pt.pts, 0) pts,
               rank() over (partition by rd.r order by coalesce(pt.pts, 0) desc, coalesce(_pickem_miss(g.id, m.id, rd.r), 1000000)) rk
             from members m cross join rounds rd left join pts pt on pt.team_id = m.id and pt.r = rd.r)
    select jsonb_build_object('word', _round_word(g.competition),
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', rd.r, 'done', rd.done,
          'winners', case when rd.done then (select coalesce(jsonb_agg(x.team_id order by x.team_id), '[]') from grid x where x.r = rd.r and x.rk = 1 and x.pts > 0) else '[]' end)
          order by rd.r) from rounds rd), '[]'),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('team_id', m.id,
          'weeks', coalesce((select jsonb_object_agg(x.r::text, x.pts) from grid x where x.team_id = m.id), '{}'))) from members m), '[]'))
  );
end $$;
