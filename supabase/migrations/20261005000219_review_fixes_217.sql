-- Fixes from an independent review of migrations 215 to 217. Safe to run twice.
--  * A grid on a week's game that is postponed waits for its new kickoff (no draw at the old one); one called off hands
--    every square's coins back (what's left of the pot, if a quarter had already paid) and is done.
--  * A grid pays a period only once the feed has sent it, final or not: a game that lands final with no score by period
--    (a feed outage on hockey's separate fetch) no longer pays its periods to the 0-0 square. What a period would have
--    paid rides on to the last final, which takes what's left of the pot as before.
--  * The NFL's playoff weeks in the weekly feed read as ESPN names them ("Wild Card"), not "Week 19": a week's game is
--    labelled from `fixtures.round` where the feed sends one, for squares and prop sheets alike.

create or replace function public._squares_series(p_game bigint) returns series
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; s series; f fixtures;
begin
  select * into g from pool_games where id = p_game;
  if not coalesce(g.rules ? 'fixture', false) then
    select * into s from series where id = (g.rules->>'series')::bigint;
    return s;
  end if;
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  if f.id is null then return s; end if;
  s.sport := (select sport from competitions where id = f.competition);
  s.competition := f.competition;
  s.round := f.gameweek;
  s.label := coalesce(nullif(f.round, ''), format('%s %s', _round_word(f.competition), f.gameweek));
  s.short := format('%s at %s', (select coalesce(short, name) from clubs where id = f.away_club), (select coalesce(short, name) from clubs where id = f.home_club));
  s.best_of := 1;
  s.high_club := f.home_club;
  s.low_club := f.away_club;
  s.high_wins := case when f.state = 'final' and f.home_score > f.away_score then 1 else 0 end;
  s.low_wins := case when f.state = 'final' and f.away_score > f.home_score then 1 else 0 end;
  s.winner := case when s.high_wins = 1 then f.home_club when s.low_wins = 1 then f.away_club end;
  -- postponed and called off pass through, for the tick to wait or hand the coins back
  s.state := case when f.state in ('live', 'final', 'postponed', 'cancelled') then f.state else 'scheduled' end;
  s.starts_at := f.kickoff;
  s.tbd := false;
  return s;
end $$;
revoke execute on function public._squares_series(bigint) from public, anon, authenticated;

create or replace function public._squares_tick(p_competition text, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; f fixtures; i int; pt int; w int; pot int; sz int; top_c bigint; tr int; sr int;
  cell text; own record; amt int; paid int; n int := 0; h record; rem int; nsq int; last_no int; top_name text; side_name text; best record; dname text; moment text;
begin
  for g in select * from pool_games where kind = 'squares' and status = 'open'
             and (p_competition is null or competition = p_competition) and (p_league is null or league_id = p_league) order by id loop
    s := _squares_series(g.id);
    -- a week's game put off waits for its new kickoff; one called off hands back what's left of the pot, square by square
    if s.state = 'postponed' then continue; end if;
    if s.state = 'cancelled' then
      nsq := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
      rem := coalesce((g.draw->>'pot')::int, nsq * (g.rules->>'cost')::int) - coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0);
      for h in select team_id, count(*) k from pool_picks where game_id = g.id and thing like 'sq:%' group by team_id loop
        amt := floor(rem * h.k / nsq::numeric)::int;
        if amt > 0 then
          insert into coin_ledger (team_id, amount, reason) values (h.team_id, amt, format('Squares back: %s · called off', g.title));
          perform _pool_alert(h.team_id, 'pool_game', format('🔲 %s was called off: %s coins back for your square%s.', g.title, amt, case when h.k = 1 then '' else 's' end), '/picks?g=' || g.id);
        end if;
      end loop;
      update pool_games set status = 'done', winners = '{}' where id = g.id;
      if nsq > 0 then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🔲 The game was called off, so %s are done and every square''s coins go back.', g.title), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
      continue;
    end if;
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
    -- a week's game that ends level wins nobody a "game", and is still its grid's last
    last_no := case when s.state = 'final' then greatest(s.high_wins + s.low_wins, 1) end;
    for f in select * from _squares_fixtures(g.id) x where x.state in ('live', 'final') order by x.game_no loop
      for i in 0 .. jsonb_array_length(g.rules->'points') - 1 loop
        pt := (g.rules->'points'->>i)::int; w := (g.rules->'weights'->>i)::int;
        continue when exists (select 1 from pool_square_pays where game_id = g.id and fixture_id = f.id and point = pt);
        if pt = 0 then
          continue when f.state <> 'final';
          tr := case when f.home_club = top_c then f.home_score else f.away_score end;
          sr := case when f.home_club = top_c then f.away_score else f.home_score end;
        else
          -- an inning is in once the next one has begun, or the game is over; either way only once the feed has sent it
          continue when not exists (select 1 from fixture_periods where fixture_id = f.id
                                    and (case when f.state = 'final' then fixture_periods.n >= pt else fixture_periods.n > pt and away is not null end));
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
    if last_no is not null and exists (select 1 from pool_square_pays p where p.game_id = g.id and p.point = 0 and p.game_no = last_no) then
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

create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series or week's game
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or coalesce(rules->>'series', 'f' || (rules->>'fixture')) = coalesce(r->>'series', 'f' || (r->>'fixture'))) and (p_kind <> 'props' or rules->>'fixture' = r->>'fixture')
             -- a second bracket goes on from a later round, once the first has locked
             and (p_kind <> 'bracket' or rules->>'from_round' = r->>'from_round' or not _pool_game_locked(id))) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    if r ? 'fixture' then
      -- a week's game is a series of one: 'Week 6: DAL at PHI squares'
      select format('%s: %s at %s squares', coalesce(nullif(f.round, ''), _round_word(p_competition) || ' ' || f.gameweek), coalesce(ca.short, ca.name), coalesce(ch.short, ch.name))
        into ttl from fixtures f join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club where f.id = (r->>'fixture')::bigint;
      s.best_of := 1;
    else
      select * into s from series where id = (r->>'series')::bigint;
      ttl := s.label || ' squares';
    end if;
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
  if p_kind = 'props' then
    select coalesce(x.short, x.label, nullif(f.round, ''), 'Week ' || f.gameweek) || case when x.best_of > 1 then ' Game ' || f.game_no else '' end
        || ': ' || coalesce(ca.short, ca.name) || ' at ' || coalesce(ch.short, ch.name)
      into ttl from fixtures f left join series x on x.id = f.series_id join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club
      where f.id = (r->>'fixture')::bigint;
    ttl := 'Props · ' || ttl;
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('📋 The prop sheet is open on %s: %s calls on the game, a point each, and the total breaks a tie. It locks at the %s.',
      substr(ttl, 9), jsonb_array_length(r->'questions'), _sport_word(p_competition, 'start', 'start')), jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'players' then
    ttl := 'The box pool';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', case when coalesce((r->>'playoffs')::boolean, false)
      then format('🏒 The playoff box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, all the way to the Cup. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'))
      else format('🏒 The box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, from %s to %s. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'), to_char((r->>'from')::date, 'FMDay FMMonth FMDD'), to_char((r->>'to')::date, 'FMDay FMMonth FMDD')) end,
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
  ttl := case p_kind when 'series' then 'Pick the series'
    when 'bracket' then case when exists (select 1 from pool_games where league_id = current_league_id() and kind = 'bracket' and competition = p_competition
                                           and (rules->>'from_round')::int < (r->>'from_round')::int) then 'Second-chance bracket' else 'The bracket' end
    else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚔️ Pick the series is on, from the %s: call each series%s. Each pick locks at its %s.', fr_label,
      case when (select max(best_of) from series where competition = p_competition) > 1 then ' and how many games it goes' else '' end,
      case when (select max(best_of) from series where competition = p_competition) > 1 then 'Game 1''s ' else 'game''s ' end || _sport_word(p_competition, 'start', 'start'))
    when 'bracket' then case when ttl = 'Second-chance bracket'
      then format('🏆 The second-chance bracket is open, from the %s: a fresh bracket for everyone, busted or not. Pick every winner to the final before its first game.', fr_label)
      else format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label) end
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first %s of the round.', fr_label, _sport_word(p_competition, 'start', 'start')) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;

create or replace function public._props_games(p_competition text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'game_no', case when s.best_of > 1 then f.game_no end,
      'label', coalesce(s.short, s.label, nullif(f.round, ''), 'Week ' || f.gameweek),
      'home', coalesce(ch.short, ch.name), 'away', coalesce(ca.short, ca.name)) order by f.kickoff, f.id), '[]')
  from fixtures f left join series s on s.id = f.series_id join competitions c on c.id = f.competition
  join clubs ch on ch.id = f.home_club join clubs ca on ca.id = f.away_club
  where f.competition = p_competition and c.sport in ('mlb', 'nfl', 'nhl') and f.state = 'scheduled'
    -- a postseason's games while their series is still going, or an NFL week's
    and (coalesce(s.state, '') <> 'final' and (f.series_id is not null or c.sport = 'nfl'))
    and f.kickoff > now() and f.kickoff <= now() + interval '7 days'
$$;
revoke execute on function public._props_games(text) from public, anon, authenticated;

create or replace function public._props_board(p_game bigint, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; locked boolean; ans jsonb;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  locked := f.state <> 'scheduled' or f.kickoff <= now();
  ans := _props_answers(g.id);
  return jsonb_build_object(
    'game', jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
      'home_score', f.home_score, 'away_score', f.away_score,
      'game_no', case when (select best_of from series s where s.id = f.series_id) > 1 then f.game_no end,
      'label', coalesce((select coalesce(s.short, s.label) from series s where s.id = f.series_id), nullif(f.round, ''), 'Week ' || f.gameweek),
      'periods', coalesce((select jsonb_agg(jsonb_build_object('n', p.n, 'home', p.home, 'away', p.away) order by p.n) from fixture_periods p where p.fixture_id = f.id), '[]')),
    'locked', locked, 'questions', g.rules->'questions', -- each call's answer as soon as the game decides it (migration 218)
    'answers', case when f.state in ('final', 'live') then ans end,
    'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'props'),
    'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'props'),
    -- once it starts: how the pool called each one, and everyone's sheet
    'split', case when locked then (select jsonb_object_agg(k.key, k.counts) from (
        select x.key, jsonb_object_agg(x.value, x.n) counts from (
          select a.key, a.value, count(*) n from pool_picks pk cross join lateral jsonb_each_text(pk.pick->'answers') a
          where pk.game_id = g.id and pk.thing = 'props' group by a.key, a.value) x group by x.key) k) end,
    'sheets', case when locked then coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'answers', pk.pick->'answers', 'total', (pk.pick->>'total')::int,
        'right', (select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value)) order by pk.team_id)
      from pool_picks pk where pk.game_id = g.id and pk.thing = 'props'), '[]') end);
end $$;
revoke execute on function public._props_board(bigint, int) from public, anon, authenticated;
