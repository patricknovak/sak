-- The sweepstake (docs/POOL-TYPES.md §9 item 7): a `pool_games` kind ('sweep') on any event played in series (a
-- postseason, March Madness, the World Cup's knockouts later). At the first game of its round (or sooner, when the host
-- draws), every player in the pool is dealt clubs from the hat at random: an equal share each where the field is
-- bigger than the pool (the odd ones left in the hat, held by nobody), one each and shared where it is smaller. No
-- picks, no skill: whoever holds the champion wins it; the table ranks by how far a player's best club has gone.
-- * The deal is kept in the game's rules (`rules.deal`: team id to its clubs; `rules.unheld`; `rules.drawn_at`).
-- * `_sweep_tick` (the hourly pool job) draws at the lock and closes the game when the last series is decided.
-- * Each player hears what they drew. Safe to run twice.

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check
  check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket', 'players', 'survivor', 'score', 'props', 'streak', 'sweep'));

-- a round makes a sweepstake when every one of its series has both clubs and none has started
create or replace function public._sweep_ok(p_competition text, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_round is not null
    and exists (select 1 from series where competition = p_competition and round = p_round)
    and not exists (select 1 from series where competition = p_competition and round = p_round
                    and (high_club is null or low_club is null or state <> 'scheduled' or (starts_at is not null and starts_at <= now())))
$$;
revoke execute on function public._sweep_ok(text, int) from public, anon, authenticated;

create or replace function public._sweep_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare fr int;
begin
  fr := coalesce((r->>'from_round')::int, (select open_round from _event_rounds(p_competition)));
  if not _sweep_ok(p_competition, fr) then raise exception 'The sweepstake needs a round whose matchups are all set and not started'; end if;
  return jsonb_build_object('from_round', fr);
end $$;
revoke execute on function public._sweep_rules(text, jsonb) from public, anon, authenticated;

-- deal the field: every player in the pool, in a random order, the clubs shuffled
create or replace function public._sweep_draw(p_game bigint) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; ms int[]; cs bigint[]; n int; m int; per int; deal jsonb := '{}'; i int; mine bigint[]; unheld bigint[] := '{}'; t int;
begin
  select * into g from pool_games where id = p_game for update;
  if g.id is null or g.kind <> 'sweep' or g.status <> 'open' or g.rules ? 'deal' then return 0; end if;
  select array_agg(id order by random()) into ms from teams where league_id = g.league_id and role = 'gm';
  select array_agg(c order by random()) into cs from (select distinct unnest(array[s.high_club, s.low_club]) c from series s
    where s.competition = g.competition and s.round = (g.rules->>'from_round')::int) x where c is not null;
  n := coalesce(cardinality(ms), 0); m := coalesce(cardinality(cs), 0);
  if n = 0 or m = 0 then return 0; end if;
  if m >= n then
    per := m / n;
    for i in 1..n loop
      deal := deal || jsonb_build_object(ms[i]::text, to_jsonb(cs[(i - 1) * per + 1 : i * per]));
    end loop;
    unheld := cs[n * per + 1 : m];
  else
    for i in 1..n loop
      deal := deal || jsonb_build_object(ms[i]::text, jsonb_build_array(cs[((i - 1) % m) + 1]));
    end loop;
  end if;
  update pool_games set rules = rules || jsonb_build_object('deal', deal, 'unheld', to_jsonb(coalesce(unheld, '{}')), 'drawn_at', now()) where id = g.id;
  foreach t in array ms loop
    select array_agg(x::bigint) into mine from jsonb_array_elements_text(deal->t::text) x;
    perform _pool_alert(t, 'pool_game', format('🎩 You drew %s in the sweepstake.',
      (select string_agg(coalesce(c.name, c.short), ' and ' order by c.name) from clubs c where c.id = any (mine))), '/picks?g=' || g.id);
  end loop;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('🎩 The sweepstake is drawn: %s clubs dealt to %s players. Hold the champion and you win it.', m - coalesce(cardinality(unheld), 0), n),
    jsonb_build_object('pool_game', g.id), g.league_id);
  return 1;
end $$;
revoke execute on function public._sweep_draw(bigint) from public, anon, authenticated;

-- the host can draw before the first game, once two players are in
create or replace function public.pool_sweep_draw(p_game bigint) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  if not exists (select 1 from pool_games where id = p_game and league_id = current_league_id() and kind = 'sweep' and status = 'open') then
    raise exception 'No sweepstake to draw here';
  end if;
  if (select count(*) from teams where league_id = current_league_id() and role = 'gm') < 2 then raise exception 'Get two players in first'; end if;
  if (select rules ? 'deal' from pool_games where id = p_game) then raise exception 'The hat is already drawn'; end if;
  return _sweep_draw(p_game);
end $$;
revoke execute on function public.pool_sweep_draw(bigint) from public, anon;
grant execute on function public.pool_sweep_draw(bigint) to authenticated;

-- how far each club has gone: series won from the sweepstake's round, and whether it is still in
create or replace function public._sweep_clubs(p_game bigint)
returns table (club bigint, won int, alive boolean, holders int[])
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  field as (select distinct unnest(array[s.high_club, s.low_club]) club from series s, g
            where s.competition = g.competition and s.round = (g.rules->>'from_round')::int)
  select f.club,
    (select count(*) from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int and s.winner = f.club)::int,
    (select _club_wins_left(g.competition, f.club) > 0 from g),
    coalesce((select array_agg(d.key::int order by d.key::int) from g, jsonb_each(coalesce(g.rules->'deal', '{}')) d where d.value @> to_jsonb(f.club)), '{}')
  from field f where f.club is not null
$$;
revoke execute on function public._sweep_clubs(bigint) from public, anon, authenticated;

-- the table: a player's best club, how far it has gone (points) and could go (possible); clubs still in (right), clubs
-- held (picked); more series won across their clubs breaks a tie
create or replace function public._sweep_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  rounds as (select max(s.round) - (g.rules->>'from_round')::int + 1 n from series s, g where s.competition = g.competition group by g.rules),
  c as (select * from _sweep_clubs(p_game)),
  held as (select tm.id team_id, c.* from teams tm, g, c where tm.league_id = g.league_id and tm.role = 'gm' and tm.id = any (c.holders))
  select tm.id::int,
    coalesce((select max(h.won) from held h where h.team_id = tm.id), 0)::int,
    coalesce((select max(case when h.alive then (select n from rounds) else h.won end) from held h where h.team_id = tm.id), 0)::int,
    (select count(*) from held h where h.team_id = tm.id and h.alive)::int,
    0,
    (select count(*) from held h where h.team_id = tm.id)::int,
    (-coalesce((select sum(h.won) from held h where h.team_id = tm.id), 0))::int
  from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'
$$;
revoke execute on function public._sweep_table(bigint) from public, anon, authenticated;

create or replace function public._sweep_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('drawn', g.rules ? 'deal', 'drawn_at', g.rules->'drawn_at', 'locks_at', _rank_lock(g.id),
    'round_label', (select regexp_replace(min(label), '^(AL|NL|AFC|NFC|East|West) ', '') from series where competition = g.competition and round = (g.rules->>'from_round')::int),
    'players', (select count(*) from teams where league_id = g.league_id and role = 'gm'),
    'mine', coalesce(g.rules->'deal'->(p_me::text), '[]'), 'unheld', coalesce(g.rules->'unheld', '[]'),
    'champion', (select s.winner from series s where s.competition = g.competition and s.state = 'final'
                 and s.round = (select max(round) from series where competition = g.competition) limit 1),
    'field', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('won', c.won, 'alive', c.alive, 'holders', to_jsonb(c.holders))
                        order by c.alive desc, c.won desc, c.club) from _sweep_clubs(g.id) c), '[]'))
  from pool_games g where g.id = p_game and g.kind = 'sweep'
$$;
revoke execute on function public._sweep_board(bigint, int) from public, anon, authenticated;

-- the hourly pool job: draw at the lock, and close once the last series is decided
create or replace function public._sweep_tick(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; n int := 0; champ bigint; w int[]; names text;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games where league_id = p_league and kind = 'sweep' and status = 'open' loop
    if not g.rules ? 'deal' then
      if _rank_lock(g.id) <= now() then n := n + _sweep_draw(g.id); end if;
      continue;
    end if;
    select s.winner into champ from series s where s.competition = g.competition and s.state = 'final' and s.winner is not null
      and s.round = (select max(round) from series where competition = g.competition);
    continue when champ is null;
    select coalesce(array_agg(d.key::int order by d.key::int), '{}') into w from jsonb_each(g.rules->'deal') d where d.value @> to_jsonb(champ);
    update pool_games set status = 'done', winners = w where id = g.id and status = 'open';
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) into names from teams tm where tm.id = any (w);
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when names is null then format('🎩 The sweepstake is over: %s won it, and nobody held them.', (select coalesce(name, short) from clubs where id = champ))
           else format('🏆 The sweepstake is won: %s held %s.', names, (select coalesce(name, short) from clubs where id = champ)) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._sweep_tick(int) from public, anon, authenticated;

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
        when 'quarters' then 'after the 1st quarter, at the half, after the 3rd quarter and on the final' || case when s.best_of > 1 then ' of every game' else '' end
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
    begin
      insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    exception when unique_violation then
      raise exception 'This pool already runs that game';
    end;
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
  if p_kind = 'sweep' then
    ttl := 'The sweepstake';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🎩 The sweepstake is on: at the %s of the %s''s first game, everyone in the pool is dealt clubs from the hat. Hold the champion and you win it. Nothing to pick, just luck.',
      _sport_word(p_competition, 'start', 'start'),
      (select regexp_replace(min(label), '^(AL|NL|AFC|NFC|East|West) ', '') from series where competition = p_competition and round = (r->>'from_round')::int)),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'streak' then
    ttl := 'The daily streak';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔥 The daily streak is on for %s: pick the winner of one game each day there are games%s. A right pick adds one to your run, a wrong one starts it again, and a day off breaks nothing. The longest run wins.',
      c.name, case when (r->>'draws')::boolean then ', or a draw' else '' end), jsonb_build_object('pool_game', gid));
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

create or replace function public._pool_game_table(p_game bigint) returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; lock_at timestamptz; ws_runs int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null then return; end if;
  if g.kind = 'pickem' then
    return query select * from _pickem_table(g.id);
    return;
  end if;
  if g.kind = 'squares' then
    return query
    select tm.id::int, coalesce(sum(p.coins), 0)::int, coalesce(sum(p.coins), 0)::int, count(p.id)::int, 0,
      (select count(*) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing like 'sq:%')::int, null::int
    from teams tm left join pool_square_pays p on p.game_id = g.id and p.team_id = tm.id and p.coins > 0
    where tm.league_id = g.league_id and tm.role = 'gm'
    group by tm.id;
    return;
  end if;
  if g.kind = 'bracket' then
    return query select * from _bracket_table(g.id);
    return;
  end if;
  if g.kind = 'players' then
    return query select * from _players_table(g.id);
    return;
  end if;
  if g.kind = 'props' then
    return query select * from _props_table(g.id);
    return;
  end if;
  if g.kind = 'streak' then
    return query select * from _streak_table(g.id);
    return;
  end if;
  if g.kind = 'sweep' then
    return query select * from _sweep_table(g.id);
    return;
  end if;
  fr := (g.rules->>'from_round')::int;
  -- the final game's total runs, for the tiebreaker
  select f.home_score + f.away_score into ws_runs from fixtures f join series s on s.id = f.series_id
  where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition) and s.state = 'final' and f.state = 'final'
  order by f.kickoff desc limit 1;
  if g.kind = 'series' then
    return query
    with s as (select * from series where competition = g.competition and round >= fr),
    p as (select pk.team_id, s.*, (pk.pick->>'winner')::bigint pw, (pk.pick->>'games')::int pn
          from pool_picks pk join s on pk.thing = 's:' || s.id where pk.game_id = g.id),
    full_value as (select s.id, coalesce((g.rules->'points'->>s.round::text)::int, 1)
                     + case when coalesce((g.rules->>'exact_only')::boolean, false) then 0 else coalesce((g.rules->'length'->>s.round::text)::int, 0) end v
                   from s),
    scored as (
      select p.team_id,
        _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, case when p.state = 'final' then p.high_wins + p.low_wins end) pts,
        case when p.state = 'final' then _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, p.high_wins + p.low_wins)
             -- still open: the winner's points if that club can still take it, the length too if it can still end that way
             when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                  case when p.pw = p.high_club then p.low_wins else p.high_wins end, null) then
               case when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                         case when p.pw = p.high_club then p.low_wins else p.high_wins end, p.pn)
                    then (select v from full_value fv where fv.id = p.id)
                    when coalesce((g.rules->>'exact_only')::boolean, false) then 0
                    else coalesce((g.rules->'points'->>p.round::text)::int, 1) end
             else 0 end poss,
        (p.state = 'final' and p.pw = p.winner) rt,
        (p.state = 'final' and p.pw = p.winner and p.pn = p.high_wins + p.low_wins) ex
      from p),
    -- a series still open to pick, and not picked yet, is all still possible
    unpicked as (select tm.id team_id, sum(fv.v)::int v from teams tm cross join s join full_value fv on fv.id = s.id
                 where tm.league_id = g.league_id and tm.role = 'gm' and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                   and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 's:' || s.id)
                 group by tm.id)
    select tm.id::int, coalesce(sum(sc.pts), 0)::int, (coalesce(sum(sc.poss), 0) + coalesce(max(u.v), 0))::int,
      count(*) filter (where sc.rt)::int, count(*) filter (where sc.ex)::int,
      (select count(*) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing like 's:%')::int,
      (select abs((pk.pick->>'runs')::int - ws_runs) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'tiebreak' and ws_runs is not null)::int
    from teams tm left join scored sc on sc.team_id = tm.id left join unpicked u on u.team_id = tm.id
    where tm.league_id = g.league_id and tm.role = 'gm'
    group by tm.id;
  else
    lock_at := _rank_lock(g.id);
    return query
    with mine as (select pk.team_id, pk.pick->'order' ord from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'),
    vals as (select m.team_id, v.club, v.value from mine m cross join lateral _rank_values(g.id, m.ord) v),
    wins as (select case when f.home_score > f.away_score then f.home_club else f.away_club end club, count(*)::int n
             from fixtures f join series s on s.id = f.series_id
             where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
             group by 1)
    select tm.id::int,
      coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)::int,
      (coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)
       + coalesce((select sum(v.value * _club_wins_left(g.competition, v.club)) from vals v where v.team_id = tm.id), 0)
       + case when not exists (select 1 from mine m where m.team_id = tm.id) and (lock_at is null or lock_at > now()) then
           (select coalesce(sum(x.v * _club_wins_left(g.competition, x.club)), 0) from (
              select c.club, (count(*) over () - row_number() over (order by _club_wins_left(g.competition, c.club) desc) + 1) v
              from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition and s.round = fr) c
              where c.club is not null) x)
         else 0 end)::int,
      0, 0, (select count(*) from mine m where m.team_id = tm.id)::int, null::int
    from teams tm where tm.league_id = g.league_id and tm.role = 'gm';
  end if;
end $$;
revoke execute on function public._pool_game_table(bigint) from public, anon, authenticated;

create or replace function public.pool_game_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; me int := my_team(); fr int; last_r int; lock_at timestamptz; tb_lock timestamptz; out jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return null; end if;
  fr := (g.rules->>'from_round')::int;
  select max(round) into last_r from series where competition = g.competition;
  out := jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'rules', g.rules, 'status', g.status, 'winners', to_jsonb(g.winners),
    'competition', g.competition, 'competition_name', (select name from competitions where id = g.competition), 'me', me,
    -- the sport's words: what starts a game, what a tiebreaker counts and how high it goes
    'words', jsonb_build_object('start', _sport_word(g.competition, 'start', 'start'), 'score', _sport_word(g.competition, 'score', 'runs'), 'cap', _score_cap(g.competition)),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', r.round, 'label', r.label, 'best_of', r.best_of) order by r.round)
       from (select round, max(regexp_replace(label, '^(AL|NL|AFC|NFC) ', '')) label, max(best_of) best_of from series
             where competition = g.competition and round >= fr group by round) r), '[]'),
    'table', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.team_id, 'points', t.points, 'possible', t.possible, 'right', t.right_calls,
        'exact', t.exact, 'picked', t.picked, 'tiebreak', t.tiebreak) order by t.points desc, t.tiebreak nulls last, t.possible desc, t.picked desc, t.team_id)
      from _pool_game_table(g.id) t), '[]'));
  if g.kind = 'pickem' then
    out := out || jsonb_build_object('pickem', _pickem_board(g.id, null, me));
  elsif g.kind = 'squares' then
    out := out || jsonb_build_object('squares', _squares_board(g.id));
  elsif g.kind = 'bracket' then
    out := out || jsonb_build_object('bracket', _bracket_board(g.id, me));
  elsif g.kind = 'players' then
    out := out || jsonb_build_object('players', _players_board(g.id, me));
  elsif g.kind = 'props' then
    out := out || jsonb_build_object('props', _props_board(g.id, me));
  elsif g.kind = 'streak' then
    out := out || jsonb_build_object('streak', _streak_board(g.id, me));
  elsif g.kind = 'sweep' then
    out := out || jsonb_build_object('sweep', _sweep_board(g.id, me));
  elsif g.kind = 'series' then
    tb_lock := (select min(starts_at) from series where competition = g.competition and round = last_r);
    out := out || jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', s.label, 'short', s.short, 'best_of', s.best_of,
          'high', _club_json(s.high_club), 'low', _club_json(s.low_club), 'high_wins', s.high_wins, 'low_wins', s.low_wins,
          'winner', s.winner, 'state', s.state, 'starts_at', s.starts_at, 'tbd', s.tbd,
          'locked', s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()),
          'next', (select jsonb_build_object('kickoff', f.kickoff, 'game_no', f.game_no, 'state', f.state, 'home', f.home_club,
                     'home_score', f.home_score, 'away_score', f.away_score, 'detail', f.detail)
                   from fixtures f where f.series_id = s.id and f.state in ('scheduled', 'live') order by (f.state = 'live') desc, f.kickoff limit 1),
          'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id),
          'points', (select _series_pick_points(g.rules, s.round, (pk.pick->>'winner')::bigint, (pk.pick->>'games')::int, s.winner,
                       case when s.state = 'final' then s.high_wins + s.low_wins end)
                     from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id and s.state = 'final'),
          -- everyone's picks, once the series has started
          'calls', case when s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then
            coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'winner', (pk.pick->>'winner')::bigint, 'games', (pk.pick->>'games')::int)
                        order by pk.team_id) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id), '[]') end,
          'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id))
        order by s.round, s.sort, s.id)
        from series s where s.competition = g.competition and s.round >= fr), '[]'),
      'tiebreak', jsonb_build_object('locks_at', tb_lock, 'locked', tb_lock is not null and tb_lock <= now(),
        'mine', (select (pk.pick->>'runs')::int from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'tiebreak'),
        'label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = last_r)));
  else
    lock_at := _rank_lock(g.id);
    out := out || jsonb_build_object('rank', jsonb_build_object(
      'locks_at', lock_at, 'locked', lock_at is not null and lock_at <= now(),
      'round_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = fr),
      'field', (select count(distinct c) from series s, unnest(array[s.high_club, s.low_club]) c where s.competition = g.competition and s.round = fr and c is not null),
      -- the clubs still in (or every club in the event, out ones last), with what each has won since the lock
      'clubs', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('alive', _club_wins_left(g.competition, c.club) > 0,
            'in_field', c.club in (select unnest(array[s.high_club, s.low_club]) from series s where s.competition = g.competition and s.round = fr),
            'wins', (select count(*) from fixtures f join series s on s.id = f.series_id
                     where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
                       and c.club = case when f.home_score > f.away_score then f.home_club else f.away_club end),
            'left', _club_wins_left(g.competition, c.club))
          order by (_club_wins_left(g.competition, c.club) > 0) desc, c.club)
        from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition) c where c.club is not null), '[]'),
      'mine', (select pk.pick->'order' from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'rank'),
      'orders', case when lock_at is not null and lock_at <= now() then
        coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'order', pk.pick->'order') order by pk.team_id)
                  from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'), '[]') end));
  end if;
  return out;
end $$;
revoke execute on function public.pool_game_board(bigint) from public, anon;
grant execute on function public.pool_game_board(bigint) to authenticated;

create or replace function public._pool_game_locked(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case g.kind
    when 'series' then exists (select 1 from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
                               and (s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now())))
    when 'rank' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'bracket' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'players' then coalesce(_players_lock(g.id) <= now(), false)
    when 'props' then exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now()))
    when 'squares' then g.draw is not null or exists (select 1 from pool_picks pk where pk.game_id = g.id)
    when 'pickem' then exists (select 1 from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id
                               where pk.game_id = g.id and (f.state <> 'scheduled' or f.kickoff <= now()))
    -- the streak has no rules to change, and reads as locked once anyone has picked
    when 'streak' then exists (select 1 from pool_picks pk where pk.game_id = g.id)
    when 'sweep' then g.rules ? 'deal' or coalesce(_rank_lock(g.id) <= now(), false)
    else true end
  from pool_games g where g.id = p_game
$$;
revoke execute on function public._pool_game_locked(bigint) from public, anon, authenticated;

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
        -- the sweepstake asks nothing of anyone
        when g.kind = 'sweep' then 0
        when g.kind = 'streak' then
          -- today's pick (or the next day with games), while it is still to make
          (select case when not exists (select 1 from pool_picks pk join fixtures pf on pf.id = (pk.pick->>'fixture')::bigint
                                      where pk.game_id = g.id and pk.team_id = my_team() and pk.thing like 'd:%' and _streak_day(pf.kickoff) = d) then 1 else 0 end
           from (select min(_streak_day(f.kickoff)) d from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
                   and _streak_playable(f.id)) z where d is not null)
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
        when g.kind = 'sweep' then (select l from (select _rank_lock(g.id) l) z where l > now() and not g.rules ? 'deal')
        when g.kind = 'streak' then (select min(f.kickoff) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
                                       and _streak_playable(f.id))
        when g.kind = 'props' then (select f.kickoff from fixtures f where f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled' and f.kickoff > now())
        when g.kind = 'squares' then
          (select s.starts_at from _squares_series(g.id) s where g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id() and g.kind not in ('survivor', 'score')
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;

create or replace function public._pool_rows()
returns table (game text, kind text, title text, status text, link text, team_id int, score numeric, possible numeric, alive boolean, tiebreak numeric, line text)
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); g record;
begin
  if lid is null then return; end if;

  -- the questions: net worth, the coins in hand plus every call at today's price
  if exists (select 1 from pool_markets m where m.league_id = lid) then
    return query
    select 'questions'::text, 'questions'::text, 'The questions'::text,
      case when exists (select 1 from pool_markets m where m.league_id = lid and m.status = 'open') then 'open' else 'done' end,
      '/questions'::text, l.team_id, l.worth, null::numeric, null::boolean, null::numeric,
      case when l.calls > 0 then format('%s of %s called right', l.hits, l.calls) else 'No settled calls yet' end
    from pool_leaders() l;
  end if;

  -- the sports games: pick the series, rank the teams, squares
  for g in select * from pool_games pg where pg.league_id = lid and pg.kind not in ('survivor', 'score') order by pg.id loop
    return query
    select 'game:' || g.id, g.kind, g.title, g.status, '/picks?g=' || g.id, t.team_id, t.points::numeric,
      case when g.kind in ('squares', 'streak') then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'bracket' then case when t.right_calls > 0 then format('%s right', t.right_calls) when t.picked > 0 then 'Bracket in' else 'No bracket yet' end
        when 'players' then case when t.right_calls + t.exact > 0 then format('%s goal%s, %s assist%s', t.right_calls, case when t.right_calls = 1 then '' else 's' end,
                                                                   t.exact, case when t.exact = 1 then '' else 's' end)
                                 when t.picked > 0 then 'Team in' else 'No team yet' end
        when 'props' then case when t.picked > 0 then format('%s right', t.right_calls) else 'No sheet yet' end
        when 'streak' then case when t.picked > 0 then format('Best run %s, %s now', t.points, t.exact) else 'Nothing picked yet' end
        when 'sweep' then case when t.picked = 0 then 'In the hat' when t.right_calls > 0 then format('%s of %s club%s still in', t.right_calls, t.picked, case when t.picked = 1 then '' else 's' end)
                          else 'All out' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
  end loop;

  -- every prop sheet on an event, added up: the calls right across them, then the sheets won
  for g in select pg.competition, max(pg.id) latest, bool_or(pg.status = 'open') going, min(c.name) cname
           from pool_games pg join competitions c on c.id = pg.competition
           where pg.league_id = lid and pg.kind = 'props' group by pg.competition having count(*) >= 2 order by pg.competition loop
    return query
    select 'props:' || g.competition, 'props_all'::text, 'Every prop sheet · ' || g.cname, case when g.going then 'open' else 'done' end,
      '/picks?g=' || g.latest, x.team_id, x.pts::numeric, x.poss::numeric, null::boolean, (-x.wins)::numeric,
      case when x.sheets > 0 then format('%s right on %s sheet%s%s', x.pts, x.sheets, case when x.sheets = 1 then '' else 's' end,
                                         case when x.wins > 0 then format(', %s won', x.wins) else '' end)
           else 'No sheets yet' end
    from (select t.team_id, sum(t.points)::int pts, sum(t.possible)::int poss, sum(t.picked)::int sheets,
            count(*) filter (where t.team_id = any (coalesce(pg.winners, '{}')))::int wins
          from pool_games pg cross join lateral _pool_game_table(pg.id) t
          where pg.league_id = lid and pg.kind = 'props' and pg.competition = g.competition
          group by t.team_id) x;
  end loop;

  -- last one standing: still in (or the winner, once it's over) first, then the rounds survived, then who went out
  -- latest
  for g in select * from pool_survivors s where s.league_id = lid order by s.id loop
    return query
    select 'survivor:' || g.id, 'survivor'::text, 'Last one standing'::text, g.status, '/survivor'::text, x.id,
      x.through::numeric, null::numeric, x.alive, (-coalesce(x.out_gw, 0))::numeric,
      case when g.status = 'done' and x.alive then 'Won it' when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in %s %s', lower(_round_word(g.competition)), x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            (select min(p.gameweek) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')) out_gw
          from teams tm where tm.league_id = lid and tm.role = 'gm') x;
  end loop;

  -- call the score: points, then exact scores
  for g in select * from pool_predictors s where s.league_id = lid order by s.id loop
    return query
    select 'predictor:' || g.id, 'score'::text, 'Call the score'::text, g.status, '/predictor'::text, x.id,
      x.pts::numeric, null::numeric, null::boolean, (-x.ex)::numeric,
      case when x.rt > 0 then format('%s exact, %s right', x.ex, x.rt) else 'No points yet' end
    from (select tm.id, coalesce(sum(p.points), 0)::int pts,
            count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
            count(*) filter (where p.points > 0)::int rt
          from teams tm
          left join pool_predictor_picks p on p.predictor_id = g.id and p.team_id = tm.id
          left join fixtures f on f.id = p.fixture_id
          where tm.league_id = lid and tm.role = 'gm'
          group by tm.id) x;
  end loop;
end $$;
revoke execute on function public._pool_rows() from public, anon, authenticated;

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
      -- an NFL week's games take a prop sheet too (migration 216)
      'kinds', '["pickem", "survivor"]'::jsonb || case when jsonb_array_length(_props_games(c.id)) > 0 then '["props"]'::jsonb else '[]'::jsonb end
               || case when _streak_open(c.id) then '["streak"]'::jsonb else '[]'::jsonb end,
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

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _streak_close(current_league_id()) + _sweep_tick(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

create or replace function public._pool_game_series_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare g pool_games; p record; n int; total int; exact_n int; wname text; games int; last_r int; top record;
begin
  if new.state <> 'final' or new.winner is null then return new; end if;
  if old.state = 'final' and old.winner is not distinct from new.winner and old.high_wins = new.high_wins and old.low_wins = new.low_wins then return new; end if;
  wname := (select name from clubs where id = new.winner);
  games := new.high_wins + new.low_wins;
  select max(round) into last_r from series where competition = new.competition;
  -- the sweepstake is crowned by who holds the champion, not by points (`_sweep_tick`)
  for g in select * from pool_games where competition = new.competition and status = 'open' and new.round >= (rules->>'from_round')::int and kind <> 'sweep' loop
    if g.kind = 'series' and not (new.id = any (g.posted)) then
      select count(*), count(*) filter (where (pick->>'winner')::bigint = new.winner), count(*) filter (where (pick->>'winner')::bigint = new.winner and (pick->>'games')::int = games)
      into total, n, exact_n from pool_picks where game_id = g.id and thing = 's:' || new.id;
      if total > 0 then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏁 %s win the %s in %s. %s of %s called it%s.', wname, coalesce(new.short, new.label), games, n, total,
                 case when exact_n > 0 then format(', %s with the length', exact_n) else '' end),
          jsonb_build_object('pool_game', g.id, 'series', new.id), g.league_id);
        for p in select team_id, (pick->>'winner')::bigint w, (pick->>'games')::int k from pool_picks where game_id = g.id and thing = 's:' || new.id loop
          perform _pool_alert(p.team_id, 'pool_game', case when p.w = new.winner
            then format('✅ You called it: %s in %s%s. +%s', wname, games, case when p.k = games then ', length and all' else '' end,
                        _series_pick_points(g.rules, new.round, p.w, p.k, new.winner, games))
            else format('❌ %s win the %s in %s.', wname, coalesce(new.short, new.label), games) end, '/picks?g=' || g.id);
        end loop;
      end if;
      update pool_games set posted = posted || new.id where id = g.id;
    end if;
    -- the last round is done: the game's winners
    if new.round = last_r and not exists (select 1 from series where competition = new.competition and round = last_r and state <> 'final') then
      select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.points) pts into top
      from _pool_game_table(g.id) t join teams tm on tm.id = t.team_id
      where t.points = (select max(points) from _pool_game_table(g.id)) and t.points > 0;
      update pool_games set status = 'done', winners = array(select t.team_id from _pool_game_table(g.id) t
                                                               where t.points = (select max(points) from _pool_game_table(g.id)) and t.points > 0)
      where id = g.id;
      if top.names is not null then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏆 %s is done: %s, with %s points.', g.title, top.names, top.pts), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._pool_game_series_done() from public, anon, authenticated;
