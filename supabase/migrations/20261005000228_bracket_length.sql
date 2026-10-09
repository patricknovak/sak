-- The bracket with series length (docs/POOL-TYPES.md §9 item 5, for the NHL and NBA playoffs): a host can add a bonus for
-- calling how many games each series goes (`rules.games_bonus`, 0 to 10 points a series, 0 for none; not `length`, which
-- Pick the series works out from its preset). Each pick may carry the games (`pick.lengths`, from the fewest a series
-- can take to the most), scored when the winner is right and the series went exactly that long; while a series is on,
-- the bonus is still possible as long as the other side hasn't already won too many games for it. A single-game series
-- has no length. The chance to win reads the winners alone. Safe to run twice.

create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint; f fixtures;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
  if p_kind = 'props' then return _props_rules(p_competition, r); end if;
  if p_kind = 'squares' then
    if r ? 'fixture' then
      -- one game of an NFL week (migration 217): Sunday night, Monday night, any game still to come
      select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
      if f.id is null or f.series_id is not null then raise exception 'Pick the game the grid is on'; end if;
      if (select sport from competitions where id = p_competition) is distinct from 'nfl' then raise exception 'A grid on one game is for football weeks'; end if;
      if f.home_club is null or f.away_club is null then raise exception 'That game has no matchup yet'; end if;
      if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
    else
    sid := (r->>'series')::bigint;
    if sid is null then
      if (select count(*) from series where competition = p_competition and round = (select max(round) from series where competition = p_competition)) <> 1 then
        raise exception 'Pick the series the grid is on';
      end if;
      sid := (select id from series where competition = p_competition order by round desc limit 1);
    end if;
    select * into s from series where id = sid and competition = p_competition;
    if s.id is null then raise exception 'Pick the series the grid is on'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; pick one still to come'; end if;
    end if;
    sz := coalesce((r->>'size')::int, 10);
    if sz not in (5, 10) then raise exception 'A grid is 10 by 10 or 5 by 5'; end if;
    cost := coalesce((r->>'cost')::int, 10);
    if cost not between 1 and 500 then raise exception 'A square costs 1 to 500 coins'; end if;
    cap := coalesce((r->>'cap')::int, 0);
    if cap not between 0 and sz * sz then raise exception 'The cap is up to % squares each (0 for none)', sz * sz; end if;
    -- each sport pays after its own periods, or on the final score only
    -- each sport pays after its own periods (hockey's from the Stanley Cup feed's score by period, migration 215)
    pays := coalesce(r->>'pays', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nba' then 'quarters' when 'nhl' then 'periods' else 'final' end);
    if pays not in ('final', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nba' then 'quarters' when 'nhl' then 'periods' else 'final' end) then
      raise exception '%', case (select sport from competitions where id = p_competition)
        when 'mlb' then 'Pay after the 3rd, the 6th and the final, or the final score only'
        when 'nfl' then 'Pay after every quarter, or the final score only'
        when 'nba' then 'Pay after every quarter, or the final score only'
        when 'nhl' then 'Pay after every period, or the final score only'
        else 'This sport pays on the final score only' end;
    end if;
    digits := coalesce(r->>'digits', 'once');
    if digits not in ('once', 'each') then raise exception 'Draw the digits once, or fresh for each game'; end if;
    return case when f.id is not null then jsonb_build_object('fixture', f.id) else jsonb_build_object('series', sid) end || jsonb_build_object('size', sz, 'cost', cost, 'cap', cap, 'pays', pays, 'digits', digits,
      'points', case pays when 'innings' then '[3, 6, 0]'::jsonb when 'quarters' then '[1, 2, 3, 0]'::jsonb when 'periods' then '[1, 2, 0]'::jsonb else '[0]'::jsonb end,
      'weights', case pays when 'innings' then '[25, 25, 50]'::jsonb when 'quarters' then '[20, 20, 20, 40]'::jsonb when 'periods' then '[25, 25, 50]'::jsonb else '[100]'::jsonb end);
  end if;
  select * into ev from _event_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr is null then raise exception 'Every round of that event has started'; end if;
  if fr < ev.first_round or fr > ev.last_round then raise exception 'No such round'; end if;
  if ev.open_round is null or fr < ev.open_round then raise exception 'That round has already started; start from the next one'; end if;
  if p_kind = 'series' then
    preset := coalesce(r->>'preset', 'classic');
    if preset not in ('classic', 'flat', 'exact') then raise exception 'Pick a scoring: Classic, Flat or MLB.com'; end if;
    pts := case preset when 'classic' then '{"1":1,"2":2,"3":4,"4":8}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":1,"2":1,"3":1,"4":1}' end;
    len := case preset when 'classic' then '{"1":1,"2":1,"3":2,"4":3}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":0,"2":0,"3":0,"4":0}' end;
    pts := pts || coalesce(r->'points', '{}'); len := len || coalesce(r->'length', '{}');
    for k in select jsonb_object_keys(pts) union select jsonb_object_keys(len) loop
      if coalesce((pts->>k)::int, 0) not between 0 and 100 or coalesce((len->>k)::int, 0) not between 0 and 100 then
        raise exception 'Points are whole numbers from 0 to 100';
      end if;
    end loop;
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'length', len, 'exact_only', preset = 'exact',
      'tiebreak', coalesce((r->>'tiebreak')::boolean, true));
  elsif p_kind = 'rank' then
    return jsonb_build_object('from_round', fr, 'per', 'game');
  elsif p_kind = 'bracket' then
    if not _bracket_ok(p_competition, fr) then raise exception 'That event''s rounds don''t make a bracket from there'; end if;
    preset := coalesce(r->>'preset', 'classic');
    if preset not in ('classic', 'flat') then raise exception 'Pick a scoring: Classic or Flat'; end if;
    -- Classic doubles each round from the first; Flat is a point a series
    pts := (select jsonb_object_agg(rr::text, case when preset = 'classic' then power(2, rr - fr)::int else 1 end)
            from generate_series(fr, (select max(round) from series where competition = p_competition)) rr);
    if coalesce((r->>'games_bonus')::int, 0) not between 0 and 10 then raise exception 'The bonus for the games is 0 to 10 points'; end if;
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'tiebreak', true, 'games_bonus', coalesce((r->>'games_bonus')::int, 0));
  end if;
  raise exception 'No such kind of game';
end $$;
revoke execute on function public._pool_game_rules(text, text, jsonb) from public, anon, authenticated;

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
revoke execute on function public._pool_game_pick_as(int, bigint, text, jsonb) from public, anon, authenticated;

create or replace function public._bracket_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'bracket'),
  tree as (select t.* from g cross join lateral _bracket_tree(g.competition, (g.rules->>'from_round')::int) t),
  ser as (select s.*, coalesce((g.rules->'points'->>s.round::text)::int, 1) pts from g join tree t on true join series s on s.id = t.series_id),
  -- the bonus for the games (migration 228)
  gb as (select coalesce((g.rules->>'games_bonus')::int, 0) b from g),
  locked as (select coalesce(_rank_lock(g.id) <= now(), false) l from g),
  picks as (select pk.team_id, e.key::bigint sid, (e.value #>> '{}')::bigint club, (pk.pick->'lengths'->>e.key)::int len
            from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket' cross join lateral jsonb_each(pk.pick->'winners') e),
  -- a club is out once it has lost a series of the event
  gone as (select case when s.winner = s.high_club then s.low_club else s.high_club end club
           from g join series s on s.competition = g.competition where s.state = 'final' and s.winner is not null),
  scored as (select p.team_id, s.pts, s.state = 'final' and s.winner = p.club rt,
               s.state <> 'final' and p.club not in (select club from gone)
                 and (s.high_club is null or s.low_club is null or p.club in (s.high_club, s.low_club)) live,
               -- the games called: right once the series went exactly that long; still possible while the other side
               -- hasn't won more games than that length leaves it
               (select b from gb) > 0 and s.best_of > 1 and p.len is not null and s.state = 'final' and s.winner = p.club
                 and p.len = s.high_wins + s.low_wins len_rt,
               (select b from gb) > 0 and s.best_of > 1 and p.len is not null and s.state <> 'final' and p.club not in (select club from gone)
                 and (s.high_club is null or s.low_club is null
                      or (p.club in (s.high_club, s.low_club) and p.len - (s.best_of / 2 + 1) >= case when p.club = s.high_club then s.low_wins else s.high_wins end)) len_live
             from picks p join ser s on s.id = p.sid),
  ws as (select f.home_score + f.away_score runs from g join series s on s.competition = g.competition join fixtures f on f.series_id = s.id
         where s.round = (select max(round) from ser) and s.state = 'final' and f.state = 'final' order by f.kickoff desc limit 1)
  select tm.id::int,
    (coalesce((select sum(sc.pts) from scored sc where sc.team_id = tm.id and sc.rt), 0)
      + (select b from gb) * (select count(*) from scored sc where sc.team_id = tm.id and sc.len_rt))::int,
    (coalesce((select sum(sc.pts) from scored sc where sc.team_id = tm.id and (sc.rt or sc.live)), 0)
      + (select b from gb) * (select count(*) from scored sc where sc.team_id = tm.id and (sc.len_rt or sc.len_live))
      -- no bracket in yet: all of it, until the lock
      + case when not exists (select 1 from picks p where p.team_id = tm.id) and not (select l from locked)
             then (select coalesce(sum(pts), 0) + (select b from gb) * count(*) filter (where best_of > 1) from ser) else 0 end)::int,
    (select count(*) from scored sc where sc.team_id = tm.id and sc.rt)::int,
    -- the series called to the game
    (select count(*) from scored sc where sc.team_id = tm.id and sc.len_rt)::int,
    (exists (select 1 from g join pool_picks pk on pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'bracket'))::int,
    (select abs((pk.pick->>'runs')::int - (select runs from ws)) from g join pool_picks pk on pk.game_id = g.id
     where pk.team_id = tm.id and pk.thing = 'tiebreak' and (select runs from ws) is not null)::int
  from g join teams tm on tm.league_id = g.league_id and tm.role = 'gm'
$$;
revoke execute on function public._bracket_table(bigint) from public, anon, authenticated;

create or replace function public._bracket_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'bracket'),
  lk as (select _rank_lock(g.id) l from g),
  tree as (select t.* from g cross join lateral _bracket_tree(g.competition, (g.rules->>'from_round')::int) t),
  fin as (select series_id from tree where next_id is null)
  select jsonb_build_object(
    'locks_at', (select l from lk), 'locked', coalesce((select l from lk) <= now(), false),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', regexp_replace(s.label, '^(AL|NL|AFC|NFC) ', ''),
        'short', s.short, 'best_of', s.best_of, 'pos', t.pos, 'next', t.next_id,
        'high', _club_json(s.high_club), 'low', _club_json(s.low_club), 'high_wins', s.high_wins, 'low_wins', s.low_wins,
        'winner', s.winner, 'state', s.state, 'starts_at', s.starts_at, 'points', coalesce((g.rules->'points'->>s.round::text)::int, 1))
        order by s.round, t.pos) from tree t join series s on s.id = t.series_id, g), '[]'),
    'mine', (select pk.pick->'winners' from g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'bracket'),
    -- the games called, and what calling them is worth (migration 228)
    'lengths', (select pk.pick->'lengths' from g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'bracket'),
    'games_bonus', (select coalesce((g.rules->>'games_bonus')::int, 0) from g),
    'picked', (select count(*) from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket'),
    -- everyone's champion, once the bracket locks
    'champions', case when coalesce((select l from lk) <= now(), false) then
      coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'club', (pk.pick->'winners'->>(select series_id from fin)::text)::bigint) order by pk.team_id)
                from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket'), '[]') end,
    'tiebreak', jsonb_build_object('locks_at', (select l from lk), 'locked', coalesce((select l from lk) <= now(), false),
      'mine', (select (pk.pick->>'runs')::int from g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'tiebreak'),
      'label', (select regexp_replace(s.label, '^(AL|NL) ', '') from fin join series s on s.id = fin.series_id)))
$$;
revoke execute on function public._bracket_board(bigint, int) from public, anon, authenticated;
