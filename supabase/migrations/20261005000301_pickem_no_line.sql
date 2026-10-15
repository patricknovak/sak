-- Against the spread, a game with no line out yet showed "even" on both sides: the board sent a missing line as 0, the
-- same as a real pick'em line. It sends none now, and the board says the line is set at the start (a pick saved before
-- a line is out takes the line at kick-off, migration 286). Safe to run twice.

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
        -- no line out yet is no line (a pick saved now takes the line at kick-off), not a pick'em at even
        'line', case when g.rules->>'ats' = 'true' then (f.detail->'odds'->>'line')::numeric end,
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
