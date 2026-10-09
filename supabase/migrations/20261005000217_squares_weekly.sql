-- Squares on one game of an NFL week (docs/POOL-TYPES.md §2): Sunday night, Monday night, any game of the week still to
-- come, not only a postseason series. A grid's rules name a series (the World Series, the Super Bowl) or, now, a fixture
-- of a competition played in weeks. The grid reads its game through a series either way: a week's game stands in as a
-- series of one (_squares_series) with itself as Game 1 (_squares_fixtures), so the claims, the draw, the board and the
-- payouts by quarter run the same code as before. soccer_ingest, which brings the NFL's weeks in, now settles the grids
-- after each write as sport_ingest does for a postseason. The start page and the host's desk find the games in
-- pool_event_list's `game_grids`, kept apart from `grids` so a copy of the site from before never offers one as a series.
-- Safe to run twice.

-- the series a grid is on, or its week's game as a series of one: the home club on top, a level final wins nobody
-- the "series", and the round is the week
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
  s.label := format('%s %s', _round_word(f.competition), f.gameweek);
  s.short := format('%s at %s', (select coalesce(short, name) from clubs where id = f.away_club), (select coalesce(short, name) from clubs where id = f.home_club));
  s.best_of := 1;
  s.high_club := f.home_club;
  s.low_club := f.away_club;
  s.high_wins := case when f.state = 'final' and f.home_score > f.away_score then 1 else 0 end;
  s.low_wins := case when f.state = 'final' and f.away_score > f.home_score then 1 else 0 end;
  s.winner := case when s.high_wins = 1 then f.home_club when s.low_wins = 1 then f.away_club end;
  s.state := case when f.state in ('live', 'final') then f.state else 'scheduled' end;
  s.starts_at := f.kickoff;
  s.tbd := false;
  return s;
end $$;
revoke execute on function public._squares_series(bigint) from public, anon, authenticated;

-- the games a grid pays on, in order: a series' numbered games, or the one week's game as Game 1
create or replace function public._squares_fixtures(p_game bigint) returns setof fixtures
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures;
begin
  select * into g from pool_games where id = p_game;
  for f in select * from fixtures x
           where case when coalesce(g.rules ? 'fixture', false) then x.id = (g.rules->>'fixture')::bigint
                      else x.series_id = (g.rules->>'series')::bigint and x.game_no is not null end
           order by x.game_no, x.id loop
    f.game_no := coalesce(f.game_no, 1);
    return next f;
  end loop;
end $$;
revoke execute on function public._squares_fixtures(bigint) from public, anon, authenticated;

create or replace function public._squares_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; s series; top_c bigint; side_c bigint; sz int; n int; pot int;
begin
  select * into g from pool_games where id = p_game;
  s := _squares_series(g.id);
  top_c := coalesce((g.draw->>'top')::bigint, s.high_club); side_c := coalesce((g.draw->>'side')::bigint, s.low_club);
  sz := (g.rules->>'size')::int;
  n := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  pot := coalesce((g.draw->>'pot')::int, n * (g.rules->>'cost')::int);
  return jsonb_build_object(
    'series', jsonb_build_object('id', s.id, 'fixture', (g.rules->>'fixture')::bigint, 'label', s.label, 'short', s.short, 'best_of', s.best_of, 'state', s.state, 'starts_at', s.starts_at,
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
      from _squares_fixtures(g.id) f), '[]'),
    'pays', coalesce((select jsonb_agg(jsonb_build_object('game_no', p.game_no, 'point', p.point, 'top_runs', p.top_runs, 'side_runs', p.side_runs,
        'cell', p.cell, 'paid_cell', p.paid_cell, 'team_id', p.team_id, 'coins', p.coins, 'at', p.created_at)
        order by p.game_no, case when p.point = 0 then 99 else p.point end) from pool_square_pays p where p.game_id = g.id), '[]'),
    'paid', coalesce((select sum(coins) from pool_square_pays where game_id = g.id), 0));
end $$;
revoke execute on function public._squares_board(bigint) from public, anon, authenticated;

create or replace function public._squares_draw(p_game bigint, p_why text) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; seed text; sets jsonb := '[]'; i int; n int; pot int; h record;
begin
  select * into g from pool_games where id = p_game for update;
  if g.id is null or g.kind <> 'squares' or g.draw is not null then return; end if;
  s := _squares_series(g.id);
  seed := replace(gen_random_uuid()::text, '-', '');
  for i in 1 .. case when g.rules->>'digits' = 'each' then s.best_of else 1 end loop
    sets := sets || jsonb_build_array(jsonb_build_object('top', to_jsonb(_squares_digits(seed, i, 'top')), 'side', to_jsonb(_squares_digits(seed, i, 'side'))));
  end loop;
  n := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  pot := n * (g.rules->>'cost')::int;
  update pool_games set draw = jsonb_build_object('seed', seed, 'at', now(), 'why', p_why, 'sets', sets, 'pot', pot, 'squares', n,
      'top', s.high_club, 'side', s.low_club),
    status = case when n = 0 then 'done' else status end
  where id = g.id;
  if n = 0 then return; end if;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('🎲 The digits are drawn for %s%s: %s squares, a pot of %s coins. Find your numbers on the grid.', g.title,
      case when p_why = 'full' then ', the grid is full' else '' end, n, pot),
    jsonb_build_object('pool_game', g.id), g.league_id);
  for h in select team_id, count(*) k from pool_picks where game_id = g.id and thing like 'sq:%' group by team_id loop
    perform _pool_alert(h.team_id, 'pool_game', format('🎲 Your %s square%s in %s have their numbers.', h.k, case when h.k = 1 then '' else 's' end, g.title), '/picks?g=' || g.id);
  end loop;
end $$;
revoke execute on function public._squares_draw(bigint, text) from public, anon, authenticated;

create or replace function public.pool_squares_claim(p_game bigint, p_cells text[], p_random int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := _team(); s series; sz int; cost int; cap int; held int; want text[] := '{}'; c text; n int; free int; total int;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() for update;
  if g.id is null or g.kind <> 'squares' then raise exception 'No such grid here'; end if;
  if (select role from teams where id = me) is distinct from 'gm' then raise exception 'Only players claim squares'; end if;
  if g.status <> 'open' or g.draw is not null then raise exception 'The digits are drawn; the grid is closed'; end if;
  s := _squares_series(g.id);
  if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'The grid closed at the first pitch'; end if;
  sz := (g.rules->>'size')::int; cost := (g.rules->>'cost')::int; cap := coalesce((g.rules->>'cap')::int, 0);
  foreach c in array coalesce(p_cells, '{}') loop
    if c !~ '^sq:\d{1,2}:\d{1,2}$' or split_part(c, ':', 2)::int >= sz or split_part(c, ':', 3)::int >= sz then raise exception 'No such square'; end if;
    if c = any (want) then continue; end if;
    if exists (select 1 from pool_picks where game_id = g.id and thing = c) then raise exception 'Someone has that square already'; end if;
    want := want || c;
  end loop;
  if coalesce(p_random, 0) > 0 then
    want := want || array(select x from (select format('sq:%s:%s', i / sz, i % sz) x from generate_series(0, sz * sz - 1) i) q
                          where x <> all (want) and not exists (select 1 from pool_picks where game_id = g.id and thing = q.x)
                          order by random() limit p_random);
  end if;
  n := coalesce(cardinality(want), 0);
  if n = 0 then raise exception '%', case when coalesce(p_random, 0) > 0 then 'The grid is full' else 'Pick a square' end; end if;
  held := (select count(*) from pool_picks where game_id = g.id and team_id = me and thing like 'sq:%');
  if cap > 0 and held + n > cap then raise exception 'Up to % squares each (you have %)', cap, held; end if;
  free := _coins_free(me);
  if n * cost > free then raise exception 'You have % coins to spend', greatest(free, 0); end if;
  insert into pool_picks (game_id, team_id, thing, pick) select g.id, me, x, '{}'::jsonb from unnest(want) x;
  insert into coin_ledger (team_id, amount, reason) values (me, -n * cost, format('Squares: %s · %s square%s', g.title, n, case when n = 1 then '' else 's' end));
  total := (select count(*) from pool_picks where game_id = g.id and thing like 'sq:%');
  if total >= sz * sz then perform _squares_draw(g.id, 'full'); end if;
  return jsonb_build_object('claimed', to_jsonb(want), 'coins', n * cost, 'full', total >= sz * sz);
end $$;
revoke execute on function public.pool_squares_claim(bigint, text[], int) from public, anon;
grant execute on function public.pool_squares_claim(bigint, text[], int) to authenticated;

create or replace function public.pool_squares_release(p_game bigint, p_cells text[]) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := _team(); s series; n int;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() for update;
  if g.id is null or g.kind <> 'squares' then raise exception 'No such grid here'; end if;
  if g.status <> 'open' or g.draw is not null then raise exception 'The digits are drawn; the squares are set'; end if;
  s := _squares_series(g.id);
  if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'The grid closed at the first pitch'; end if;
  with gone as (delete from pool_picks where game_id = g.id and team_id = me and thing like 'sq:%' and thing = any (coalesce(p_cells, '{}')) returning 1)
  select count(*) into n from gone;
  if n > 0 then
    insert into coin_ledger (team_id, amount, reason) values (me, n * (g.rules->>'cost')::int,
      format('Squares back: %s · %s square%s', g.title, n, case when n = 1 then '' else 's' end));
  end if;
  return n;
end $$;
revoke execute on function public.pool_squares_release(bigint, text[]) from public, anon;
grant execute on function public.pool_squares_release(bigint, text[]) to authenticated;

create or replace function public._squares_tick(p_competition text, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; s series; f fixtures; i int; pt int; w int; pot int; sz int; top_c bigint; tr int; sr int;
  cell text; own record; amt int; paid int; n int := 0; last_no int; top_name text; side_name text; best record; dname text; moment text;
begin
  for g in select * from pool_games where kind = 'squares' and status = 'open'
             and (p_competition is null or competition = p_competition) and (p_league is null or league_id = p_league) order by id loop
    s := _squares_series(g.id);
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
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'tiebreak', true);
  end if;
  raise exception 'No such kind of game';
end $$;
revoke execute on function public._pool_game_rules(text, text, jsonb) from public, anon, authenticated;

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
      select format('%s %s: %s at %s squares', _round_word(p_competition), f.gameweek, coalesce(ca.short, ca.name), coalesce(ch.short, ch.name))
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
    select coalesce(x.short, x.label, 'Week ' || f.gameweek) || case when x.best_of > 1 then ' Game ' || f.game_no else '' end
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

create or replace function public.pool_games_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status, 'competition', g.competition,
      'series', (g.rules->>'series')::bigint,
      'fixture', (g.rules->>'fixture')::bigint,
      'from_round', (g.rules->>'from_round')::int, 'locked', _pool_game_locked(g.id),
      'to_pick', case when g.kind = 'series' then
          (select count(*) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.low_club is not null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 's:' || s.id))
        when g.kind = 'pickem' then
          (select count(*) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
             and f.gameweek = (select min(f2.gameweek) from fixtures f2 where f2.competition = g.competition and f2.state = 'scheduled' and f2.kickoff > now()
                               and f2.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int)
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'f:' || f.id))
        when g.kind = 'props' then
          (select case when f.state = 'scheduled' and f.kickoff > now()
                         and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'props') then 1 else 0 end
           from fixtures f where f.id = (g.rules->>'fixture')::bigint)
        when g.kind = 'players' then
          case when coalesce(_players_lock(g.id) > now(), false)
                 and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'box') then 1 else 0 end
        when g.kind = 'squares' then
          (select case when g.draw is null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                         and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing like 'sq:%') then 1 else 0 end
           from _squares_series(g.id) s)
        else case when (_rank_lock(g.id) is null or _rank_lock(g.id) > now())
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team()
                                    and pk.thing = case when g.kind = 'bracket' then 'bracket' else 'rank' end) then 1 else 0 end end,
      'next_lock', case when g.kind = 'series' then
          (select min(s.starts_at) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.state = 'scheduled' and s.starts_at > now())
        when g.kind = 'pickem' then
          (select min(f.kickoff) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
             and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int)
        when g.kind = 'players' then (select l from (select _players_lock(g.id) l) z where l > now())
        when g.kind = 'props' then (select f.kickoff from fixtures f where f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled' and f.kickoff > now())
        when g.kind = 'squares' then
          (select s.starts_at from _squares_series(g.id) s where g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id() and g.kind not in ('survivor', 'score')
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;

create or replace function public._pool_game_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g pool_games; s record; t record; n int := 0; lk timestamptz; hrs text; key int; left_n int;
begin
  for g in select * from pool_games where league_id = p_league and status = 'open' loop
    for s in select x.id, x.starts_at, coalesce(x.short, x.label) nm, false st from series x
             where g.kind = 'series' and x.competition = g.competition and x.round >= (g.rules->>'from_round')::int
               and x.high_club is not null and x.low_club is not null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             select 0, _rank_lock(g.id), 'ranking', false where g.kind in ('rank', 'bracket') and _rank_lock(g.id) between now() and now() + interval '6 hours'
             union all
             select 0, _players_lock(g.id), 'box', false where g.kind = 'players' and _players_lock(g.id) between now() and now() + interval '6 hours'
             union all
             select 0, f.kickoff, 'sheet', false from fixtures f
             where g.kind = 'props' and f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled' and f.kickoff between now() and now() + interval '6 hours'
             union all
             -- pick'em: a round whose first match still to come kicks off within six hours; `st` once the round is under
             -- way (the NFL's Thursday game), for a second reminder before the rest of it
             select f.gameweek, min(f.kickoff), _round_word(g.competition),
               exists (select 1 from fixtures f2 where f2.competition = g.competition and f2.gameweek = f.gameweek and f2.kickoff <= now())
             from fixtures f
             where g.kind = 'pickem' and f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
               and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
             group by f.gameweek having min(f.kickoff) <= now() + interval '6 hours'
             union all
             -- a grid on a week's game stands in as a series of one, with no id of its own
             select coalesce(x.id, 0), x.starts_at, 'squares', false from _squares_series(g.id) x
             where g.kind = 'squares' and g.draw is null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours' loop
      lk := s.starts_at;
      -- the second reminder of a round is kept apart from the first (its round as a negative number)
      key := case when s.st then -s.id else s.id end;
      hrs := case when lk - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from lk - now()) / 3600))::int || 'h' end;
      for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
                 and (case when g.kind = 'pickem' then
                        -- a match in the round still to come that they haven't picked
                        exists (select 1 from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                                and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'f:' || f.id))
                      else not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id
                                 and (case when g.kind = 'squares' then pk.thing like 'sq:%' when g.kind = 'props' then pk.thing = 'props'
                                           else pk.thing = case when s.id = 0 then case g.kind when 'bracket' then 'bracket' when 'players' then 'box' else 'rank' end else 's:' || s.id end end)) end)
                 and not exists (select 1 from private.soccer_nudged x where x.game = g.kind and x.game_id = g.id and x.team_id = tm.id and x.gameweek = key) loop
        left_n := case when g.kind = 'pickem' then (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = t.id and pk.thing = 'f:' || f.id)) end;
        perform _pool_alert(t.id, 'pool_game', case when g.kind = 'pickem' and s.st
          then format('⏰ The rest of %s %s kicks off in %s. You have %s still to pick in %s.', lower(s.nm), s.id, hrs,
                      case when left_n = 1 then 'one ' || _sport_word(g.competition, 'match', 'match')
                           else left_n || ' ' || case _sport_word(g.competition, 'match', 'match') when 'match' then 'matches' else _sport_word(g.competition, 'match', 'match') || 's' end end, g.title)
          when g.kind = 'pickem'
          then format('⏰ %s %s kicks off in %s. Pick your matches in %s.', s.nm, s.id, hrs, g.title)
          when g.kind = 'squares'
          then format('⏰ %s close in %s. Claim a square before the digits are drawn.', g.title, hrs)
          when g.kind = 'players' then format('⏰ The box pool locks at the first puck drop, in %s. Take one player from every box.', hrs)
          when g.kind = 'props' then format('⏰ %s locks in %s. Make your calls on the game.', g.title, hrs)
          when s.id = 0 and g.kind = 'bracket' then format('⏰ The bracket locks in %s. Fill yours in, all the way to the final.', hrs)
          when s.id = 0 then format('⏰ Rank the teams locks in %s. Put the clubs in order.', hrs)
          else format('⏰ The %s starts in %s. Pick the winner and how many games.', s.nm, hrs) end, '/picks?g=' || g.id);
        insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.kind, g.id, t.id, key) on conflict do nothing;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_game_nudge(int) from public, anon, authenticated;

create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    -- and the Stanley Cup playoffs, before the first round with every club in it, the box pool
    select jsonb_set(e || jsonb_build_object('sheets', _props_games(e->>'competition')), '{kinds}', coalesce(e->'kinds', '[]')
             || case when e ? 'open_round' and _bracket_ok(e->>'competition', (e->>'open_round')::int) then '["bracket"]'::jsonb else '[]'::jsonb end
             || case when e->>'sport' = 'nhl' and (e->>'open_round')::int = 1
                       and not exists (select 1 from series s where s.competition = e->>'competition' and s.round = 1 and (s.high_club is null or s.low_club is null))
                     then '["players"]'::jsonb else '[]'::jsonb end
             -- the prop sheet, on its games still to start
             || case when jsonb_array_length(_props_games(e->>'competition')) > 0 then '["props"]'::jsonb else '[]'::jsonb end
             -- the Eliminator: last one standing on a tournament of single games
             || case when not exists (select 1 from series s where s.competition = e->>'competition' and s.best_of > 1)
                      and exists (select 1 from fixtures f where f.competition = e->>'competition' and f.gameweek = (e->>'open_round')::int
                                  and f.state = 'scheduled' and f.kickoff > now())
                     then '["survivor"]'::jsonb else '[]'::jsonb end) e
    from jsonb_array_elements(pool_events()) e
    union all
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack,
      'stage', format('%s %s %s', w.w, r.open_round,
               case when exists (select 1 from fixtures f where f.competition = c.id and f.gameweek = r.open_round and (f.state <> 'scheduled' or f.kickoff <= now()))
                    then 'under way' else 'next' end),
      'open_round', r.open_round, 'open_label', format('%s %s', w.w, r.open_round),
      'next_lock', (select min(kickoff) from fixtures f where f.competition = c.id and f.gameweek = r.open_round and f.state = 'scheduled' and f.kickoff > now()),
      'final_round', r.last_round, 'final_label', format('%s %s', w.w, r.last_round),
      'final_starts', (select min(kickoff) from fixtures f where f.competition = c.id and f.gameweek = r.last_round),
      'word', w.w, 'club_word', _sport_word(c.id, 'club', 'club'),
      -- an NFL week's games take a prop sheet too (migration 216)
      'kinds', '["pickem", "survivor"]'::jsonb || case when jsonb_array_length(_props_games(c.id)) > 0 then '["props"]'::jsonb else '[]'::jsonb end,
      -- and a grid of squares (migration 217), kept apart from the series grids so a copy of the site from before
      -- never offers one as a series
      'grids', '[]'::jsonb, 'sheets', _props_games(c.id), 'game_grids', case when c.sport = 'nfl' then _props_games(c.id) else '[]'::jsonb end)
    from competitions c cross join lateral _pickem_rounds(c.id) r cross join lateral (select _round_word(c.id) w) w
    where c.active and r.open_round is not null and not exists (select 1 from series s where s.competition = c.id)
    union all
    -- the NHL season: a box pool from the next night with games
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack, 'stage', 'Regular season',
      'open_round', 0, 'open_label', to_char(n.d, 'FMDay FMMonth FMDD'), 'word', 'From',
      'next_lock', (select min(start_utc) from games where game_type = 2 and date = n.d),
      'final_round', 0, 'final_label', to_char((select max(date) from games where game_type = 2), 'FMMonth FMDD'), 'final_starts', null,
      'club_word', 'team', 'kinds', '["players"]'::jsonb, 'grids', '[]'::jsonb)
    from competitions c cross join lateral (select _box_next_night() d) n
    where c.active and c.format = 'players' and c.sport = 'nhl' and n.d is not null) z
$$;
revoke execute on function public.pool_event_list() from public;
grant execute on function public.pool_event_list() to anon, authenticated;

create or replace function public.soccer_ingest(p_competition text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c competitions; x jsonb; y jsonb; nc int := 0; nf int := 0; hc bigint; ac bigint; fid bigint;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition %', p_competition; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'clubs', '[]')) loop
    insert into clubs (sport, provider, ext_id, name, short, logo)
    values (c.sport, c.provider, x->>'ext_id', left(x->>'name', 80), nullif(left(x->>'short', 5), ''), nullif(x->>'logo', ''))
    on conflict (sport, provider, ext_id) do update set name = excluded.name,
      short = coalesce(excluded.short, clubs.short), logo = coalesce(excluded.logo, clubs.logo);
    nc := nc + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'fixtures', '[]')) loop
    -- a club the provider names only in the fixture (no clubs list sent) is made from the fixture's own words
    insert into clubs (sport, provider, ext_id, name, logo)
    select c.sport, c.provider, s->>'ext_id', left(coalesce(s->>'name', 'Club ' || (s->>'ext_id')), 80), nullif(s->>'logo', '')
    from (values (x->'home_club'), (x->'away_club')) v(s) where s is not null
    on conflict (sport, provider, ext_id) do nothing;
    select id into hc from clubs where sport = c.sport and provider = c.provider and ext_id = coalesce(x->>'home', x->'home_club'->>'ext_id');
    select id into ac from clubs where sport = c.sport and provider = c.provider and ext_id = coalesce(x->>'away', x->'away_club'->>'ext_id');
    if hc is null or ac is null then raise exception 'Fixture % names a club we do not have', x->>'ext_id'; end if;
    insert into fixtures (sport, competition, provider, ext_id, season, round, gameweek, kickoff, date, home_club, away_club,
      state, status, minute, home_score, away_score, home_ft, away_ft, home_pens, away_pens, venue, detail, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', coalesce(x->>'season', c.season), x->>'round', nullif(x->>'gameweek', '')::int,
      (x->>'kickoff')::timestamptz, ((x->>'kickoff')::timestamptz at time zone c.tz)::date, hc, ac,
      _sport_state(c.sport, x->>'status'), x->>'status', nullif(x->>'minute', '')::int,
      nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(x->>'home_ft', '')::int, nullif(x->>'away_ft', '')::int,
      nullif(x->>'home_pens', '')::int, nullif(x->>'away_pens', '')::int, nullif(left(x->>'venue', 120), ''),
      case when jsonb_typeof(x->'odds') = 'object' then jsonb_build_object('odds', x->'odds') end, now())
    on conflict (provider, ext_id) do update set
      round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, minute = excluded.minute,
      home_score = excluded.home_score, away_score = excluded.away_score, home_ft = excluded.home_ft, away_ft = excluded.away_ft,
      home_pens = excluded.home_pens, away_pens = excluded.away_pens, venue = coalesce(excluded.venue, fixtures.venue),
      -- the market's view is kept as it stood at kick-off (the closing line): no update once the match is under way
      detail = case when excluded.detail is null or fixtures.state <> 'scheduled' or excluded.state <> 'scheduled' then fixtures.detail
                    else coalesce(fixtures.detail, '{}') || excluded.detail end,
      updated_at = now()
    returning id into fid;
    -- the score by period, once it has started (migration 216: prop sheets and squares on a week's games)
    for y in select * from jsonb_array_elements(coalesce(x->'periods', '[]')) loop
      insert into fixture_periods (fixture_id, n, home, away) values (fid, (y->>'n')::int, nullif(y->>'home', '')::int, nullif(y->>'away', '')::int)
      on conflict (fixture_id, n) do update set home = excluded.home, away = excluded.away;
    end loop;
    nf := nf + 1;
  end loop;
  -- the prop sheets on this competition's games; a failure is a warning, never a stopped feed
  begin perform _props_tick(c.id); exception when others then raise warning 'prop sheets on %: %', c.id, sqlerrm; end;
  -- and the grids of squares on a week's games (migration 217), the same way
  begin perform _squares_tick(c.id); exception when others then raise warning 'squares on %: %', c.id, sqlerrm; end;
  return jsonb_build_object('clubs', nc, 'fixtures', nf);
end $$;
revoke execute on function public.soccer_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.soccer_ingest(text, jsonb) to service_role;
