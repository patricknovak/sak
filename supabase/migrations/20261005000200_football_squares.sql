-- Squares by the quarter (docs/POOL-TYPES.md §8, Super Bowl squares): the grid pays after each period the sport plays,
-- in its words. Baseball's stays as it was (after the 3rd, the 6th and the final; the first pitch of Game 1); football's
-- pays after the 1st quarter, at the half, after the 3rd quarter and on the final (20, 20, 20 and 40 per cent), drawn at
-- kickoff; hockey's after the 1st and 2nd periods and the final. A single game (the NFL's playoffs are best-of-1 series,
-- each with its score by quarter in `fixture_periods`) drops the "Game 1" from what the chat hears. The final score
-- only stays an option everywhere.

update public.sports set config = jsonb_set(config, '{words,period}', to_jsonb(w.period))
from (values ('mlb', 'inning'), ('nfl', 'quarter'), ('nhl', 'period'), ('soccer', 'half')) w(id, period)
where sports.id = w.id and sports.config->'words'->>'period' is null;

-- a checkpoint in the sport's words: baseball's 'after the 3rd', football's 'after the 1st quarter' and 'at the half',
-- 'the final' everywhere
create or replace function public._squares_moment(p int, p_competition text) returns text
language sql stable security definer set search_path = public as $$
  select case when _sport_word(p_competition, 'period', 'inning') = 'inning' then _squares_point(p)
              when p = 0 then 'the final'
              when _sport_word(p_competition, 'period', 'inning') = 'quarter' and p = 2 then 'at the half'
              else _squares_point(p) || ' ' || _sport_word(p_competition, 'period', 'inning') end
$$;
revoke execute on function public._squares_moment(int, text) from public, anon, authenticated;

-- a grid's rules: each sport's periods
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
  if p_kind = 'squares' then
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
    sz := coalesce((r->>'size')::int, 10);
    if sz not in (5, 10) then raise exception 'A grid is 10 by 10 or 5 by 5'; end if;
    cost := coalesce((r->>'cost')::int, 10);
    if cost not between 1 and 500 then raise exception 'A square costs 1 to 500 coins'; end if;
    cap := coalesce((r->>'cap')::int, 0);
    if cap not between 0 and sz * sz then raise exception 'The cap is up to % squares each (0 for none)', sz * sz; end if;
    -- each sport pays after its own periods, or on the final score only
    pays := coalesce(r->>'pays', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nhl' then 'periods' else 'final' end);
    if pays not in ('final', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nhl' then 'periods' else 'final' end) then
      raise exception '%', case (select sport from competitions where id = p_competition)
        when 'mlb' then 'Pay after the 3rd, the 6th and the final, or the final score only'
        when 'nfl' then 'Pay after every quarter, or the final score only'
        when 'nhl' then 'Pay after every period, or the final score only'
        else 'This sport pays on the final score only' end;
    end if;
    digits := coalesce(r->>'digits', 'once');
    if digits not in ('once', 'each') then raise exception 'Draw the digits once, or fresh for each game'; end if;
    return jsonb_build_object('series', sid, 'size', sz, 'cost', cost, 'cap', cap, 'pays', pays, 'digits', digits,
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
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'tiebreak', true);
  end if;
  raise exception 'No such kind of game';
end $$;
revoke execute on function public._pool_game_rules(text, text, jsonb) from public, anon, authenticated;


-- a grid's news in the sport's words
create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or rules->>'series' = r->>'series')) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    select * into s from series where id = (r->>'series')::bigint;
    ttl := s.label || ' squares';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at %s, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when s.best_of > 1 then format('the %s of Game 1', _sport_word(p_competition, 'start', 'first pitch')) else _sport_word(p_competition, 'start', 'first pitch') end,
      case r->>'pays' when 'innings' then 'after the 3rd, the 6th and the final of every game'
        when 'quarters' then 'after the 1st quarter, at the half, after the 3rd quarter and on the final'
        when 'periods' then 'after the 1st period, the 2nd and the final' || case when s.best_of > 1 then ' of every game' else '' end
        else 'the final score' || case when s.best_of > 1 then ' of every game' else '' end end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'players' then
    ttl := 'The box pool';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🏒 The box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, from %s to %s. Your team locks at the first puck drop.',
      jsonb_array_length(r->'boxes'), to_char((r->>'from')::date, 'FMDay FMMonth FMDD'), to_char((r->>'to')::date, 'FMDay FMMonth FMDD')),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'pickem' then
    ttl := c.name || ' pick''em';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('✅ %s is on from %s %s: pick the winner of every match%s. Each pick locks at its %s.%s',
      ttl, _round_word(p_competition), r->>'from_round', case when (r->>'draws')::boolean then ', or a draw' else '' end,
      coalesce((select sp.config->'words'->>'start' from sports sp where sp.id = c.sport), 'start'),
      case when r->>'preset' = 'confidence' then ' Number each round''s picks by confidence too: your surest is worth the most.' else '' end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  fr_label := (select regexp_replace(min(label), '^(AL|NL|AFC|NFC) ', '') from series where competition = p_competition and round = (r->>'from_round')::int);
  ttl := case p_kind when 'series' then 'Pick the series' when 'bracket' then 'The bracket' else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚔️ Pick the series is on, from the %s: call each series%s. Each pick locks at its %s.', fr_label,
      case when (select max(best_of) from series where competition = p_competition) > 1 then ' and how many games it goes' else '' end,
      case when (select max(best_of) from series where competition = p_competition) > 1 then 'Game 1''s ' else 'game''s ' end || _sport_word(p_competition, 'start', 'start'))
    when 'bracket' then format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label)
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first %s of the round.', fr_label, _sport_word(p_competition, 'start', 'start')) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;


-- paying a grid: the checkpoint in the sport's words, no game number on a single game
create or replace function public._squares_tick(p_competition text, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; f fixtures; i int; pt int; w int; pot int; sz int; top_c bigint; tr int; sr int;
  cell text; own record; amt int; paid int; n int := 0; last_no int; top_name text; side_name text; best record; dname text; moment text;
begin
  for g in select * from pool_games where kind = 'squares' and status = 'open'
             and (p_competition is null or competition = p_competition) and (p_league is null or league_id = p_league) order by id loop
    select * into s from series where id = (g.rules->>'series')::bigint;
    if g.draw is null then
      if s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now()) then continue; end if;
      perform _squares_draw(g.id, _sport_word(g.competition, 'start', 'first pitch'));
      select * into g from pool_games where id = g.id;
      if g.status <> 'open' then continue; end if;
    end if;
    -- the clubs on each side, once the series has them (a grid can fill before its matchup is set)
    if g.draw->>'top' is null and s.high_club is not null then
      update pool_games set draw = draw || jsonb_build_object('top', s.high_club, 'side', s.low_club) where id = g.id returning * into g;
    end if;
    top_c := (g.draw->>'top')::bigint;
    if top_c is null then continue; end if;
    pot := (g.draw->>'pot')::int; sz := (g.rules->>'size')::int;
    top_name := (select coalesce(short, name) from clubs where id = top_c);
    side_name := (select coalesce(short, name) from clubs where id = (g.draw->>'side')::bigint);
    last_no := case when s.state = 'final' then s.high_wins + s.low_wins end;
    for f in select * from fixtures where series_id = s.id and state in ('live', 'final') and game_no is not null order by game_no loop
      for i in 0 .. jsonb_array_length(g.rules->'points') - 1 loop
        pt := (g.rules->'points'->>i)::int; w := (g.rules->'weights'->>i)::int;
        continue when exists (select 1 from pool_square_pays where game_id = g.id and fixture_id = f.id and point = pt);
        if pt = 0 then
          continue when f.state <> 'final';
          tr := case when f.home_club = top_c then f.home_score else f.away_score end;
          sr := case when f.home_club = top_c then f.away_score else f.home_score end;
        else
          -- an inning is in once the next one has begun, or the game is over
          continue when not (f.state = 'final' or exists (select 1 from fixture_periods where fixture_id = f.id and fixture_periods.n > pt and away is not null));
          select sum(case when f.home_club = top_c then home else away end), sum(case when f.home_club = top_c then away else home end)
          into tr, sr from fixture_periods where fixture_id = f.id and fixture_periods.n <= pt;
          tr := coalesce(tr, 0); sr := coalesce(sr, 0);
        end if;
        continue when tr is null or sr is null;
        cell := _squares_cell(g.draw, sz, f.game_no, tr, sr);
        select * into own from _squares_owner(g.id, sz, cell);
        paid := coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0);
        amt := case when pt = 0 and f.game_no = last_no then pot - paid else floor(pot * w / (100.0 * s.best_of))::int end;
        insert into pool_square_pays (game_id, league_id, fixture_id, game_no, point, top_runs, side_runs, cell, paid_cell, team_id, coins)
        values (g.id, g.league_id, f.id, f.game_no, pt, tr, sr, cell, own.cell, own.team_id, greatest(amt, 0));
        dname := (select coalesce(gm_name, name) from teams where id = own.team_id);
        if amt > 0 and own.team_id is not null then
          -- a series names the game; a single game (the Super Bowl) needs no number
          moment := _squares_moment(pt, g.competition);
          insert into coin_ledger (team_id, amount, reason) values (own.team_id, amt,
            case when s.best_of > 1 then format('Squares: %s · Game %s, %s', g.title, f.game_no, moment) else format('Squares: %s · %s', g.title, moment) end);
          perform _pool_alert(own.team_id, 'pool_game', format('🔲 Your square hit: %s %s, %s %s, %s. +%s coins', top_name, tr, side_name, sr,
            case when s.best_of > 1 then format('Game %s %s', f.game_no, moment) else moment end, amt),
            '/picks?g=' || g.id);
          insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
            format('🔲 %s: %s %s, %s %s. %s%s square takes %s coins.',
              case when s.best_of > 1 then format('Game %s, %s', f.game_no, moment) else upper(left(moment, 1)) || substr(moment, 2) end, top_name, tr, side_name, sr, dname,
              case when own.cell is distinct from cell then '''s next' else '''s' end, amt),
            jsonb_build_object('pool_game', g.id, 'fixture', f.id), g.league_id);
        end if;
        n := n + 1;
      end loop;
    end loop;
    -- the series is over and its last final is paid: the grid is done
    if last_no is not null and exists (select 1 from pool_square_pays p join fixtures x on x.id = p.fixture_id
                                       where p.game_id = g.id and p.point = 0 and x.game_no = last_no) then
      select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.coins) coins, array_agg(t.team_id) ids into best
      from (select team_id, sum(coins) coins from pool_square_pays where game_id = g.id and team_id is not null group by team_id) t
      join teams tm on tm.id = t.team_id
      where t.coins = (select max(c) from (select sum(coins) c from pool_square_pays where game_id = g.id and team_id is not null group by team_id) z);
      update pool_games set status = 'done', winners = best.ids where id = g.id;
      if best.names is not null then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏆 %s are done: %s took the most, %s coins.', g.title, best.names, best.coins), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._squares_tick(text, int) from public, anon, authenticated;


-- the board: the sport's words for the page
create or replace function public._squares_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; s series; top_c bigint; side_c bigint; sz int; n int; pot int;
begin
  select * into g from pool_games where id = p_game;
  select * into s from series where id = (g.rules->>'series')::bigint;
  top_c := coalesce((g.draw->>'top')::bigint, s.high_club); side_c := coalesce((g.draw->>'side')::bigint, s.low_club);
  sz := (g.rules->>'size')::int;
  n := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  pot := coalesce((g.draw->>'pot')::int, n * (g.rules->>'cost')::int);
  return jsonb_build_object(
    'series', jsonb_build_object('id', s.id, 'label', s.label, 'short', s.short, 'best_of', s.best_of, 'state', s.state, 'starts_at', s.starts_at,
      'tbd', s.tbd, 'winner', s.winner,
      'top_wins', case when top_c = s.low_club then s.low_wins else s.high_wins end,
      'side_wins', case when top_c = s.low_club then s.high_wins else s.low_wins end),
    'top', _club_json(top_c), 'side', _club_json(side_c),
    -- the sport's words: what starts a game, what the score counts, what its periods are called
    'words', jsonb_build_object('start', _sport_word(g.competition, 'start', 'first pitch'), 'score', _sport_word(g.competition, 'score', 'runs'),
      'period', _sport_word(g.competition, 'period', 'inning')),
    'size', sz, 'cost', (g.rules->>'cost')::int, 'cap', coalesce((g.rules->>'cap')::int, 0), 'pay_when', g.rules->>'pays', 'digits', g.rules->>'digits',
    'points', g.rules->'points', 'weights', g.rules->'weights',
    'locks_at', s.starts_at, 'locked', g.draw is not null or s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()),
    'claimed', n, 'pot', pot,
    'claims', coalesce((select jsonb_agg(jsonb_build_object('cell', thing, 'team_id', team_id) order by thing) from pool_picks where game_id = g.id and thing like 'sq:%'), '[]'),
    'draw', case when g.draw is not null then jsonb_build_object('seed', g.draw->'seed', 'at', g.draw->'at', 'why', g.draw->'why', 'sets', g.draw->'sets') end,
    'games', coalesce((select jsonb_agg(jsonb_build_object('fixture', f.id, 'game_no', f.game_no, 'state', f.state, 'kickoff', f.kickoff, 'detail', f.detail,
        'top_home', f.home_club = top_c,
        'top_runs', case when f.home_club = top_c then f.home_score else f.away_score end,
        'side_runs', case when f.home_club = top_c then f.away_score else f.home_score end,
        'innings', coalesce((select jsonb_agg(jsonb_build_object('n', p.n, 'top', case when f.home_club = top_c then p.home else p.away end,
                     'side', case when f.home_club = top_c then p.away else p.home end) order by p.n) from fixture_periods p where p.fixture_id = f.id), '[]'),
        -- while a game is on, the square its score names right now and who would take it
        'now', case when f.state = 'live' and g.draw is not null and f.home_score is not null then
          (select jsonb_build_object('cell', c.cell, 'to', o.cell, 'team_id', o.team_id)
           from (select _squares_cell(g.draw, sz, f.game_no, case when f.home_club = top_c then f.home_score else f.away_score end,
                                      case when f.home_club = top_c then f.away_score else f.home_score end) cell) c
           left join lateral _squares_owner(g.id, sz, c.cell) o on true) end)
        order by f.game_no)
      from fixtures f where f.series_id = s.id and f.game_no is not null), '[]'),
    'pays', coalesce((select jsonb_agg(jsonb_build_object('game_no', p.game_no, 'point', p.point, 'top_runs', p.top_runs, 'side_runs', p.side_runs,
        'cell', p.cell, 'paid_cell', p.paid_cell, 'team_id', p.team_id, 'coins', p.coins, 'at', p.created_at)
        order by p.game_no, case when p.point = 0 then 99 else p.point end) from pool_square_pays p where p.game_id = g.id), '[]'),
    'paid', coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0));
end $$;
revoke execute on function public._squares_board(bigint) from public, anon, authenticated;

