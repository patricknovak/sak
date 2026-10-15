-- The pick'em tiebreaker (docs/POOL-TYPES.md §2.4, 15 October 2026): every round, each player may call the total score
-- in its last game (Monday night's in the NFL), up to that game's start. A tie on points for the round goes to whoever
-- is closest; the table's tiebreak (lower is better, as the scoreboard already ranks it) is the miss on the latest round
-- played, so the game's winner at the end is decided by the last round's. No tiebreaker in, and the tie is shared as
-- before. Picks are `pool_picks` rows 't:<round>' ({"runs": n}, the same shape as a series or bracket tiebreaker).

-- a round's last game: the one that starts last (a game called off doesn't count)
create or replace function public._pickem_last(p_competition text, p_round int) returns bigint
language sql stable security definer set search_path = public as $$
  select id from fixtures where competition = p_competition and gameweek = p_round and state not in ('postponed', 'cancelled')
  order by kickoff desc, id desc limit 1
$$;
revoke execute on function public._pickem_last(text, int) from public, anon, authenticated;

-- the latest round of a pick'em whose last game is over
create or replace function public._pickem_tb_round(p_game bigint) returns int
language sql stable security definer set search_path = public as $$
  select max(f.gameweek) from pool_games g join fixtures f on f.competition = g.competition
  where g.id = p_game and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
    and f.state = 'final' and f.id = _pickem_last(g.competition, f.gameweek)
$$;
revoke execute on function public._pickem_tb_round(bigint) from public, anon, authenticated;

-- how far a player's tiebreaker was off in a round (null without one, or before its last game is over)
create or replace function public._pickem_miss(p_game bigint, p_team int, p_round int) returns int
language sql stable security definer set search_path = public as $$
  select abs((pk.pick->>'runs')::int - (coalesce(f.home_ft, f.home_score) + coalesce(f.away_ft, f.away_score)))::int
  from pool_games g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_team and pk.thing = 't:' || p_round
  join fixtures f on f.id = _pickem_last(g.competition, p_round) and f.state = 'final'
  where g.id = p_game
$$;
revoke execute on function public._pickem_miss(bigint, int, int) from public, anon, authenticated;

create or replace function public._pickem_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  -- each match as this pool reads it: the host's word (migration 172) before the feed's
  fx as (select f.id, f.gameweek, (o.outcome is null and f.state = 'scheduled' and f.kickoff > now()) open, o.outcome is not null by_host,
           coalesce(f.home_ft, f.home_score) h, coalesce(f.away_ft, f.away_score) a,
           coalesce(o.outcome = 'void', f.state in ('postponed', 'cancelled')) void,
           case when o.outcome in ('H', 'D', 'A') then o.outcome
                when o.outcome is null and f.state = 'final' then _fixture_result(coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score)) end res
         from fixtures f cross join g left join pool_result_overrides o on o.league_id = g.league_id and o.fixture_id = f.id
         where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
  -- each pick's result as it reads it: against the spread, whether its side covered the line it was made at
  pk as (select p.team_id, fx.id, fx.gameweek, fx.void, _pick_res(g.rules, p.pick, fx.res, fx.by_host, fx.h, fx.a) res, p.pick->>'pick' pp,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  rn as (select fx.gameweek, count(*)::int n from fx group by fx.gameweek),
  -- each member's matches still open and not picked, round by round
  ou as (select m.id team_id, fx.gameweek, count(*)::int k from members m cross join fx
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.id = fx.id) group by 1, 2),
  -- in Confidence those matches can still take the highest numbers not yet used that round
  free as (select ou.team_id, ou.k, w.w, row_number() over (partition by ou.team_id, ou.gameweek order by w.w desc) r
           from ou join rn on rn.gameweek = ou.gameweek cross join lateral generate_series(1, rn.n) w(w)
           where not exists (select 1 from pk where pk.team_id = ou.team_id and pk.gameweek = ou.gameweek and pk.w = w.w))
  select m.id::int,
    coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res), 0)::int,
    (coalesce((select sum(pk.w) from pk where pk.team_id = m.id and ((pk.res is not null and pk.pp = pk.res) or (pk.res is null and not pk.void))), 0)
      + case when (select c from conf) then coalesce((select sum(f.w) from free f where f.team_id = m.id and f.r <= f.k), 0)
             else coalesce((select sum(ou.k) from ou where ou.team_id = m.id), 0) end)::int,
    (select count(*) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res)::int,
    0,
    (select count(*) from pk where pk.team_id = m.id)::int,
    -- the tiebreaker: how far off the total in the last game of the latest round played (lower is better)
    _pickem_miss(p_game, m.id, (select _pickem_tb_round(p_game)))
  from members m
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
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    -- the round's tiebreaker: the total in its last game, locked when that game starts
    'tiebreak', (select jsonb_build_object('fixture', f.id, 'kickoff', f.kickoff, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'locked', f.state <> 'scheduled' or f.kickoff <= now(),
        'total', case when f.state = 'final' then coalesce(f.home_ft, f.home_score) + coalesce(f.away_ft, f.away_score) end,
        'mine', (select (pk.pick->>'runs')::int from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 't:' || cur),
        'word', _sport_word(g.competition, 'score', 'points'), 'cap', _score_cap(g.competition))
      from fixtures f where f.id = _pickem_last(g.competition, cur)),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', x.gw, 'first', x.first, 'last', x.last, 'matches', x.n, 'done', x.done, 'open', x.open,
        'picked', (select count(*) from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw),
        'points', (select coalesce(sum(case when (g.rules->>'preset') = 'confidence' then coalesce((pk.pick->>'conf')::int, 1) else 1 end), 0)
                   from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
                   where pk.game_id = g.id and pk.team_id = p_me and f.gameweek = x.gw
                     and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))))
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
        'mine_res', case when g.rules->>'ats' = 'true' then (select _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))
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

create or replace function public._pickem_round(p_game bigint, p_round int) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; top record; lead record; word text; last_left boolean; t record; w text;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' or g.status <> 'open' or p_round is null or p_round::bigint = any (g.posted)
     or p_round not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then return; end if;
  if exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
             where f.competition = g.competition and f.gameweek = p_round and not e.done) then return; end if;
  word := _round_word(g.competition);
  w := case when g.rules->>'preset' = 'confidence' then 'conf' end;
  -- the round's best, on that round's picks alone
  -- a tie on points goes to whoever is closest on the round's tiebreaker (migration 284); no tiebreaker, it's shared
  select string_agg(x.gm_name, ' and ' order by x.gm_name) names, max(x.pts) pts, array_agg(x.id) ids into top
  from (select tm.id, tm.gm_name, sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) pts,
               rank() over (order by sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) desc,
                                     coalesce(_pickem_miss(g.id, tm.id, p_round), 1000000)) rk
        from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
        join teams tm on tm.id = pk.team_id
        where pk.game_id = g.id and f.gameweek = p_round and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))
        group by tm.id, tm.gm_name) x where x.rk = 1;
  -- the leader (and at the end the winner): the most points, then the closest on the latest tiebreaker
  select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t2.points) pts, array_agg(t2.team_id) ids into lead
  from (select x.*, rank() over (order by x.points desc, coalesce(x.tiebreak, 1000000)) rk from _pickem_table(g.id) x) t2
  join teams tm on tm.id = t2.team_id
  where t2.rk = 1 and t2.points > 0;
  update pool_games set posted = posted || p_round::bigint where id = g.id;
  last_left := p_round >= (g.rules->>'to_round')::int
    or not exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                   where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not e.done);
  if last_left then
    update pool_games set status = 'done', winners = coalesce(lead.ids, '{}') where id = g.id;
    if lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 %s is done: %s, with %s %s.', g.title, lead.names, lead.pts, case when lead.pts = 1 then 'point' else 'points' end),
        jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
    end if;
  elsif top.names is not null then
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('✅ %s %s is done in %s. Top of the %s: %s with %s %s. Leading: %s on %s.', word, p_round, g.title, lower(word), top.names, top.pts,
             case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
      jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
  end if;
  -- each member hears how their round went
  for t in select pk.team_id id, count(pk.id) picked, count(pk.id) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))) rt,
             coalesce(sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score))), 0) pts
           from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id and f.gameweek = p_round
           cross join lateral _pool_fixture(g.league_id, f.id) e
           where pk.game_id = g.id group by pk.team_id loop
    perform _pool_alert(t.id, 'pool_game',
      case when top.names is not null and t.id = any (top.ids) then format('🏅 You won %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end)
           else format('✅ %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end) end,
      '/picks?g=' || g.id);
  end loop;
end $$;

create or replace function public._pool_game_pick_as(p_team int, p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int; t record; fr int; lens jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if p_thing like 's:%' and g.kind = 'series' then
    select * into s from series where id = substr(p_thing, 3)::bigint and competition = g.competition;
    if s.id is null or s.round < (g.rules->>'from_round')::int then raise exception 'That series isn''t in this game'; end if;
    if s.high_club is null or s.low_club is null then raise exception 'That series isn''t set yet'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; picks are locked'; end if;
    w := (p_pick->>'winner')::bigint; n := (p_pick->>'games')::int;
    if w not in (s.high_club, s.low_club) then raise exception 'Pick one of the two clubs'; end if;
    if n is null or n not between (s.best_of / 2 + 1) and s.best_of then raise exception 'A best-of-% goes % to % games', s.best_of, s.best_of / 2 + 1, s.best_of; end if;
    p_pick := jsonb_build_object('winner', w, 'games', n);
  elsif p_thing = 'rank' and g.kind = 'rank' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first %', _sport_word(g.competition, 'start', 'start'); end if;
    ord := '[]';
    for v in select jsonb_array_elements_text(coalesce(p_pick->'order', '[]')) loop
      if not exists (select 1 from series where competition = g.competition and v::bigint in (high_club, low_club)) then raise exception 'That club isn''t in this event'; end if;
      if ord @> to_jsonb(v::bigint) then raise exception 'Each club once'; end if;
      ord := ord || to_jsonb(v::bigint);
    end loop;
    if jsonb_array_length(ord) < 2 then raise exception 'Put the clubs in order'; end if;
    p_pick := jsonb_build_object('order', ord);
  elsif p_thing = 'bracket' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The bracket locked at the first game'; end if;
    fr := (g.rules->>'from_round')::int;
    -- round by round: a first-round winner is one of its two clubs, a later one a winner picked in a series before it
    ord := '{}';
    for t in select tr.series_id, tr.round, x.high_club, x.low_club from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id
             order by tr.round, tr.pos loop
      w := (p_pick->'winners'->>t.series_id::text)::bigint;
      if w is null then raise exception 'Pick a winner for every series'; end if;
      if t.round = fr then
        if w not in (t.high_club, t.low_club) then raise exception 'Pick one of the two clubs'; end if;
      elsif not exists (select 1 from _bracket_tree(g.competition, fr) b where b.next_id = t.series_id and (ord->>b.series_id::text)::bigint = w) then
        raise exception 'A winner goes on only from a series before it';
      end if;
      ord := ord || jsonb_build_object(t.series_id::text, w);
    end loop;
    -- and, where the host added a bonus for it, how many games each series goes (migration 228)
    lens := '{}';
    if coalesce((g.rules->>'games_bonus')::int, 0) > 0 then
      for t in select x.id, x.best_of from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id where x.best_of > 1 loop
        v := p_pick->'lengths'->>t.id::text;
        continue when v is null;
        if v !~ '^\d+$' or v::int not between t.best_of / 2 + 1 and t.best_of then
          raise exception 'A best-of-% goes % to % games', t.best_of, t.best_of / 2 + 1, t.best_of;
        end if;
        lens := lens || jsonb_build_object(t.id::text, v::int);
      end loop;
    end if;
    p_pick := jsonb_build_object('winners', ord) || case when lens <> '{}' then jsonb_build_object('lengths', lens) else '{}' end;
  elsif p_thing = 'box' and g.kind = 'players' then
    lock_at := _players_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'Teams locked at the first puck drop'; end if;
    -- one player from every box, in box order
    ord := '[]';
    for t in select b.v, (b.ord - 1)::int i from jsonb_array_elements(g.rules->'boxes') with ordinality b(v, ord) order by b.ord loop
      v := p_pick->'players'->>t.i;
      if v is null then raise exception 'Take a player from every box'; end if;
      if not (t.v->'players' @> to_jsonb(v::int)) then raise exception 'That player isn''t in %', t.v->>'label'; end if;
      ord := ord || to_jsonb(v::int);
    end loop;
    if jsonb_array_length(coalesce(p_pick->'players', '[]')) <> jsonb_array_length(ord) then raise exception 'One player from each box'; end if;
    p_pick := jsonb_build_object('players', ord);
  elsif p_thing = 'props' and g.kind = 'props' then
    if exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now())) then
      raise exception 'The sheet locked at the %', _sport_word(g.competition, 'start', 'start');
    end if;
    -- every call answered with one of its options, and the game's total for the tiebreak
    ord := '{}';
    for t in select q from jsonb_array_elements(g.rules->'questions') q loop
      v := p_pick->'answers'->>(t.q->>'key');
      if v is null then raise exception 'Make every call'; end if;
      if not exists (select 1 from jsonb_array_elements(t.q->'options') o where o->>'v' = v) then raise exception 'That isn''t one of the answers'; end if;
      ord := ord || jsonb_build_object(t.q->>'key', v);
    end loop;
    n := (p_pick->>'total')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('answers', ord, 'total', n);
  elsif p_thing = 'streak' and g.kind = 'streak' then
    -- one pick a day, on any game that day still to start; a day's pick moves until its game starts
    select f.id, f.kickoff, f.state, f.home_club, f.away_club into t from fixtures f
    where f.id = (p_pick->>'fixture')::bigint and f.competition = g.competition;
    if t.id is null or t.home_club is null or t.away_club is null then raise exception 'That game isn''t in this event'; end if;
    if t.state <> 'scheduled' or t.kickoff <= now() or not (select e.open from _pool_fixture(g.league_id, t.id) e) then
      raise exception 'That game has started; pick one still to come';
    end if;
    if not _streak_playable(t.id) then raise exception 'That game won''t be played: its series is over'; end if;
    p_thing := 'd:' || to_char(_streak_day(t.kickoff), 'YYYY-MM-DD');
    -- the day is the one the picked game is on now; it locks once that game is under way or over (one put off or
    -- voided frees it)
    if exists (select 1 from pool_picks pk join fixtures f on f.id = (pk.pick->>'fixture')::bigint
               cross join lateral _pool_fixture(g.league_id, f.id) e
               where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%'
                 and _streak_day(f.kickoff) = _streak_day(t.kickoff)
                 -- one under way or over holds the day; one put off, voided or not needed by its series frees it
                 and not (e.open or e.void or (f.state = 'scheduled' and not _streak_playable(f.id)))) then
      raise exception 'Your pick for that day has started; it stays';
    end if;
    -- a pick filed under this day whose game has moved to another goes with its game (unless that day has one)
    update pool_picks pk set thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD') from fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing = p_thing and f.id = (pk.pick->>'fixture')::bigint
      and _streak_day(f.kickoff) <> _streak_day(t.kickoff)
      and not exists (select 1 from pool_picks q where q.game_id = g.id and q.team_id = me and q.thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD'));
    -- and a pick filed under another day whose game has moved onto this one gives way to this one
    delete from pool_picks pk using fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%' and pk.thing <> p_thing
      and f.id = (pk.pick->>'fixture')::bigint and _streak_day(f.kickoff) = _streak_day(t.kickoff);
    v := p_pick->>'pick';
    if v is null or v not in ('H', 'A', 'D') or (v = 'D' and not coalesce((g.rules->>'draws')::boolean, false)) then
      raise exception 'Pick one of the two sides%', case when coalesce((g.rules->>'draws')::boolean, false) then ', or a draw' else '' end;
    end if;
    p_pick := jsonb_build_object('fixture', t.id, 'pick', v);
  elsif p_thing ~ '^t:[0-9]+$' and g.kind = 'pickem' then
    -- a pick'em round's tiebreaker: the total in its last game, until that game starts
    last_r := substr(p_thing, 3)::int;
    if last_r not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then raise exception 'That round isn''t in this game'; end if;
    select * into t from fixtures where id = _pickem_last(g.competition, last_r);
    if t.id is null then raise exception 'That round has no games yet'; end if;
    if t.state <> 'scheduled' or t.kickoff <= now() then raise exception 'The tiebreaker locked when the round''s last game began'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  elsif p_thing = 'tiebreak' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked with the bracket'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first % of the final round', _sport_word(g.competition, 'start', 'start'); end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
