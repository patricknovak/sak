-- A round stays open while any of its series can still be picked (28 October 2026).
-- The old open_round was the earliest round in which NO series had started, so the moment one series of a
-- round tipped off the whole round closed — even though its later series were still pickable. NHL round 1
-- starts across two nights; a pool opened between them jumped to round 2 with no matchups yet.

-- is any series of this round already under way (started, or past scheduled)
create or replace function public._round_under_way(p_competition text, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from series where competition = p_competition and round = p_round
                 and (state <> 'scheduled' or (starts_at is not null and starts_at <= now())))
$$;
revoke execute on function public._round_under_way(text, int) from public, anon, authenticated;

-- the rounds of an event: the first and the last, and the first still holding a series a game can pick from. A round
-- counts as open while any of its series has not started, so a pool started between two nights of a round still runs
-- on that round's later series rather than jumping to a round whose matchups are not set
create or replace function public._event_rounds(p_competition text) returns table (first_round int, last_round int, open_round int)
language sql stable security definer set search_path = public as $$
  select min(round), max(round),
    (select min(s2.round) from series s2 where s2.competition = p_competition
     and exists (select 1 from series s3 where s3.competition = p_competition and s3.round = s2.round
                 and s3.state = 'scheduled' and (s3.starts_at is null or s3.starts_at > now())))
  from series where competition = p_competition
$$;
revoke execute on function public._event_rounds(text) from public, anon, authenticated;

-- next_lock is the first start among the round's series that have not started; kinds drop rank once the round
-- is under way (a ranking locks at the round's first game)
create or replace function public.pool_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by e->>'next_lock'), '[]') from (
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack,
      'stage', (select case when s.state = 'scheduled' then regexp_replace(s.label, '^(AL|NL) ', '') || ' next'
                            else regexp_replace(s.label, '^(AL|NL) ', '') || ' under way' end
                from series s where s.competition = c.id and s.state <> 'final' order by s.round, s.starts_at nulls last limit 1),
      'open_round', r.open_round,
      'open_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = c.id and round = r.open_round),
      'next_lock', (select min(starts_at) from series where competition = c.id and round = r.open_round
                    and state = 'scheduled' and (starts_at is null or starts_at > now())),
      'final_round', r.last_round,
      'final_label', (select min(label) from series where competition = c.id and round = r.last_round),
      'final_starts', (select min(starts_at) from series where competition = c.id and round = r.last_round),
      'kinds', case when _round_under_way(c.id, r.open_round) then '["series"]'::jsonb else '["series", "rank"]'::jsonb end,
      -- squares are offered through their series (the site before squares reads only the kinds)
      'grids', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', s.label, 'short', s.short, 'best_of', s.best_of,
                  'starts_at', s.starts_at, 'tbd', s.tbd, 'high', (select coalesce(short, name) from clubs where id = s.high_club),
                  'low', (select coalesce(short, name) from clubs where id = s.low_club)) order by s.round desc, s.sort, s.id)
                from series s where s.competition = c.id and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())), '[]')) e
    from competitions c cross join lateral _event_rounds(c.id) r
    where c.active and r.open_round is not null) z
$$;
revoke execute on function public.pool_events() from public;
grant execute on function public.pool_events() to anon, authenticated;

-- bracket and the NHL box pool stay off a round that is already under way (they lock at the round's first start)
create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    -- and the Stanley Cup playoffs, before the first round with every club in it, the box pool
    select jsonb_set(e || jsonb_build_object('sheets', _props_games(e->>'competition')), '{kinds}', coalesce(e->'kinds', '[]')
             || case when e ? 'open_round' and not _round_under_way(e->>'competition', (e->>'open_round')::int)
                       and _bracket_ok(e->>'competition', (e->>'open_round')::int) then '["bracket"]'::jsonb else '[]'::jsonb end
             || case when e->>'sport' = 'nhl' and (e->>'open_round')::int = 1
                       and not _round_under_way(e->>'competition', 1)
                       and not exists (select 1 from series s where s.competition = e->>'competition' and s.round = 1 and (s.high_club is null or s.low_club is null))
                     then '["players"]'::jsonb else '[]'::jsonb end
             -- the prop sheet, on its games still to start
             || case when jsonb_array_length(_props_games(e->>'competition')) > 0 then '["props"]'::jsonb else '[]'::jsonb end
             -- the Eliminator: last one standing on a tournament of single games
             || case when not exists (select 1 from series s where s.competition = e->>'competition' and s.best_of > 1)
                      and exists (select 1 from fixtures f where f.competition = e->>'competition' and f.gameweek = (e->>'open_round')::int
                                  and f.state = 'scheduled' and f.kickoff > now())
                     then '["survivor"]'::jsonb else '[]'::jsonb end
             -- the daily streak, while a game is still to come (migration 231)
             || case when _streak_open(e->>'competition') then '["streak"]'::jsonb else '[]'::jsonb end
             -- the sweepstake, while its round's matchups are set and not started (migration 236)
             || case when e ? 'open_round' and _sweep_ok(e->>'competition', (e->>'open_round')::int) then '["sweep"]'::jsonb else '[]'::jsonb end) e
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
      -- an NFL week's games take a prop sheet too (migration 216); soccer's rounds take Call the score (a score line
      -- is soccer's game: an NFL score is a guess at two numbers in the twenties)
      'kinds', '["pickem", "survivor"]'::jsonb
               || case when c.sport = 'soccer' then '["score"]'::jsonb else '[]'::jsonb end
               || case when jsonb_array_length(_props_games(c.id)) > 0 then '["props"]'::jsonb else '[]'::jsonb end
               || case when _streak_open(c.id) then '["streak"]'::jsonb else '[]'::jsonb end
               -- win totals, on a season with lines before its opener (migration 297)
               || case when _wins_ok(c.id) then '["wins"]'::jsonb else '[]'::jsonb end,
      'wins_lock', case when _wins_ok(c.id) then _wins_lock_at(c.id) end,
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

-- a ranking and a bracket lock at the round's first start, so refuse starting one once the round is under way
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint; f fixtures;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
  if p_kind = 'props' then return _props_rules(p_competition, r); end if;
  if p_kind = 'streak' then return _streak_rules(p_competition, r); end if;
  if p_kind = 'sweep' then return _sweep_rules(p_competition, r); end if;
  if p_kind = 'wins' then return _wins_rules(p_competition, r); end if;
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
  if p_kind in ('rank', 'bracket') and _round_under_way(p_competition, fr) then
    raise exception 'That round is under way; a % has to start before its first game', case p_kind when 'rank' then 'ranking' else 'bracket' end;
  end if;
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
