-- The prop sheet on an NFL week (migration 208's follow-up): ESPN's weekly scoreboard carries each team's score by quarter
-- (`espnFixture` sends it as `periods` once a game starts), `soccer_ingest` writes it to `fixture_periods` and settles
-- the competition's prop sheets at the end of each run (in its own exception block, as `sport_ingest` does since 214),
-- and a sheet can go on any NFL game in the next week, not only a postseason's: "Week 6: KC at JAX". The rounds events on
-- the start page and the host's desk offer it with their games.

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
  return jsonb_build_object('clubs', nc, 'fixtures', nf);
end $$;
revoke execute on function public.soccer_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.soccer_ingest(text, jsonb) to service_role;


create or replace function public._props_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f fixtures; r jsonb := coalesce(p_rules, '{}');
begin
  select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
  -- a postseason's game, or a game of an NFL week (its feed keeps the quarters too, migration 216)
  if f.id is null or (f.series_id is null and (select sport from competitions where id = p_competition) <> 'nfl') then raise exception 'Pick a game of this event'; end if;
  -- the feeds keep the score by period for baseball, football and hockey (the Stanley Cup's since migration 215)
  if (select sport from competitions where id = p_competition) not in ('mlb', 'nfl', 'nhl') then raise exception 'Prop sheets run on baseball, football and hockey'; end if;
  if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
  if (select state from series where id = f.series_id) = 'final' then raise exception 'That series is over, so the game won''t be played'; end if;
  -- the sheet stays as it was made while the game is the same (a rules change before the lock keeps its lines)
  -- the sheet is always made here, never taken from the caller (the settlement reads its keys, lines and options)
  return jsonb_build_object('fixture', f.id, 'questions', _props_sheet(f.id));
end $$;
revoke execute on function public._props_rules(text, jsonb) from public, anon, authenticated;


create or replace function public._props_games(p_competition text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'game_no', case when s.best_of > 1 then f.game_no end,
      'label', coalesce(s.short, s.label, 'Week ' || f.gameweek),
      'home', coalesce(ch.short, ch.name), 'away', coalesce(ca.short, ca.name)) order by f.kickoff, f.id), '[]')
  from fixtures f left join series s on s.id = f.series_id join competitions c on c.id = f.competition
  join clubs ch on ch.id = f.home_club join clubs ca on ca.id = f.away_club
  where f.competition = p_competition and c.sport in ('mlb', 'nfl', 'nhl') and f.state = 'scheduled'
    -- a postseason's games while their series is still going, or an NFL week's
    and (coalesce(s.state, '') <> 'final' and (f.series_id is not null or c.sport = 'nfl'))
    and f.kickoff > now() and f.kickoff <= now() + interval '7 days'
$$;
revoke execute on function public._props_games(text) from public, anon, authenticated;


create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or rules->>'series' = r->>'series') and (p_kind <> 'props' or rules->>'fixture' = r->>'fixture')
             -- a second bracket goes on from a later round, once the first has locked
             and (p_kind <> 'bracket' or rules->>'from_round' = r->>'from_round' or not _pool_game_locked(id))) then
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
      'label', coalesce((select coalesce(s.short, s.label) from series s where s.id = f.series_id), 'Week ' || f.gameweek),
      'periods', coalesce((select jsonb_agg(jsonb_build_object('n', p.n, 'home', p.home, 'away', p.away) order by p.n) from fixture_periods p where p.fixture_id = f.id), '[]')),
    'locked', locked, 'questions', g.rules->'questions', 'answers', case when f.state = 'final' then ans end,
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
      'grids', '[]'::jsonb, 'sheets', _props_games(c.id))
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


