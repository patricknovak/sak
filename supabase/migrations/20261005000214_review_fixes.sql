-- Fixes from the review of migrations 200 to 212 (9 October 2026):
-- * A prop sheet's calls are always made by the server (`_props_sheet`), never taken from the caller's rules: a host
--   could otherwise hand in calls the settlement can't read, and the error would stop the feed. A sheet has no rules to
--   change.
-- * `sport_ingest` can't be stopped by a pool game's settlement: squares and prop sheets run in their own exception
--   blocks, a failure a warning, so the series and every other pool on the event keep updating.
-- * Hockey: the Stanley Cup feed (nhlPlayoffs.ts) has no score by period yet, so a hockey grid pays on the final score
--   (periods would have paid the 0-0 square) and prop sheets run on baseball and football only, until it does.
-- * Two messages: the host's pick on a game it can't take says where to go, and a sheet nobody filled in says so.

create or replace function public._props_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f fixtures; r jsonb := coalesce(p_rules, '{}');
begin
  select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
  if f.id is null or f.series_id is null then raise exception 'Pick a game of this event'; end if;
  -- the feed keeps the score by period for baseball and football; hockey's playoff feed doesn't yet
  if (select sport from competitions where id = p_competition) not in ('mlb', 'nfl') then raise exception 'Prop sheets run on baseball and football'; end if;
  if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
  if (select state from series where id = f.series_id) = 'final' then raise exception 'That series is over, so the game won''t be played'; end if;
  -- the sheet stays as it was made while the game is the same (a rules change before the lock keeps its lines)
  -- the sheet is always made here, never taken from the caller (the settlement reads its keys, lines and options)
  return jsonb_build_object('fixture', f.id, 'questions', _props_sheet(f.id));
end $$;
revoke execute on function public._props_rules(text, jsonb) from public, anon, authenticated;


create or replace function public._props_games(p_competition text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'game_no', f.game_no, 'label', coalesce(s.short, s.label),
      'home', coalesce(ch.short, ch.name), 'away', coalesce(ca.short, ca.name)) order by f.kickoff, f.id), '[]')
  from fixtures f join series s on s.id = f.series_id join competitions c on c.id = f.competition
  join clubs ch on ch.id = f.home_club join clubs ca on ca.id = f.away_club
  where f.competition = p_competition and c.sport in ('mlb', 'nfl') and f.state = 'scheduled' and s.state <> 'final'
    and f.kickoff > now() and f.kickoff <= now() + interval '7 days'
$$;
revoke execute on function public._props_games(text) from public, anon, authenticated;


create or replace function public._props_tick(p_competition text) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; top record; t record; n int := 0; nq int; match text; w int[];
begin
  -- a sheet under way: the pool's split on each call goes in the log, once (made at the start)
  for g in select pg.* from pool_games pg join fixtures fx on fx.id = (pg.rules->>'fixture')::bigint
           where pg.kind = 'props' and pg.status = 'open' and pg.competition = p_competition and (fx.state <> 'scheduled' or fx.kickoff <= now()) loop
    perform _props_split_write(g.id);
  end loop;
  for g in select pg.* from pool_games pg join fixtures fx on fx.id = (pg.rules->>'fixture')::bigint
           where pg.kind = 'props' and pg.status = 'open' and pg.competition = p_competition
             and (fx.state in ('final', 'cancelled') or (fx.state = 'scheduled' and exists (select 1 from series s where s.id = fx.series_id and s.state = 'final'))) loop
    select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
    match := format('%s at %s', (select coalesce(short, name) from clubs where id = f.away_club), (select coalesce(short, name) from clubs where id = f.home_club));
    if f.state <> 'final' then
      update predictions set status = 'void', scored_at = now() where kind = 'pool_split' and (subject->>'game')::bigint = g.id and status = 'open';
      update pool_games set status = 'done', winners = '{}' where id = g.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format(case when f.state = 'cancelled' then '📋 %s was called off, so its prop sheet counts for nobody.'
                    else '📋 The series ended before %s, so its prop sheet counts for nobody.' end, match), jsonb_build_object('pool_game', g.id), g.league_id);
      n := n + 1;
      continue;
    end if;
    nq := jsonb_array_length(g.rules->'questions');
    -- each call's split is scored on its answer; one the score couldn't settle is void
    update predictions p set status = case when a.v is null then 'void' else 'scored' end,
      outcome = case when a.v is not null then (a.v = p.detail->>'fav')::int end,
      error = case when a.v is not null then (a.v = p.detail->>'fav')::int - p.predicted end, scored_at = now()
    from (select key, value v from jsonb_each_text(_props_answers(g.id))) a
    where p.kind = 'pool_split' and (p.subject->>'game')::bigint = g.id and p.subject->>'call' = a.key and p.status = 'open';
    select max(points) pts into top from _props_table(g.id) where picked = 1;
    update pool_games set status = 'done', winners = coalesce(array(
        select x.team_id from _props_table(g.id) x where x.picked = 1 and x.points = top.pts
          and coalesce(x.tiebreak, 999) = (select min(coalesce(y.tiebreak, 999)) from _props_table(g.id) y where y.picked = 1 and y.points = top.pts)
          and top.pts > 0), '{}')
    where id = g.id;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when top.pts > 0 then format('📋 The prop sheet on %s is done: %s, with %s of %s right.', match,
        (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from pool_games x join teams tm on tm.id = any (x.winners) where x.id = g.id), top.pts, nq)
      when exists (select 1 from pool_picks where game_id = g.id and thing = 'props') then format('📋 The prop sheet on %s is done, and nobody called one right.', match)
      else format('📋 The prop sheet on %s is done; nobody filled one in.', match) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    w := (select winners from pool_games where id = g.id);
    for t in select x.team_id, x.points from _props_table(g.id) x where x.picked = 1 loop
      perform _pool_alert(t.team_id, 'pool_game', format('📋 %s: you called %s of %s.%s', match, t.points, nq,
        case when t.team_id = any (w) then ' You won the sheet.' else '' end), '/picks?g=' || g.id);
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._props_tick(text) from public, anon, authenticated;


create or replace function public.pool_game_set_rules(p_game bigint, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; r jsonb; base jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if _pool_game_locked(g.id) then raise exception 'The rules froze at the first lock'; end if;
  if g.kind = 'props' then raise exception 'The sheet has no rules to change: every call is a point, settled from the score'; end if;
  if g.kind = 'pickem' and coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
     and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Picks are in, so the scoring stays: it changes only before anyone picks';
  end if;
  -- what was worked out from a preset is worked out again from the new one
  base := case when g.kind = 'players' then g.rules else g.rules - 'points' - 'length' - 'exact_only' - 'weights' - 'draws' - 'per' end;
  r := _pool_game_rules(g.kind, g.competition, base || coalesce(p_rules, '{}')
         || jsonb_strip_nulls(jsonb_build_object('from_round', g.rules->'from_round', 'series', g.rules->'series', 'fixture', g.rules->'fixture')));
  -- a box pool's boxes stay once a team is in
  if g.kind = 'players' and r->>'key' is distinct from g.rules->>'key' and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Teams are in, so the boxes stay: the size, the nights and the scoring change only before anyone picks';
  end if;
  update pool_games set rules = r where id = g.id;
  perform _sys('general', format('📝 The host changed the rules of %s before the first lock.', g.title), jsonb_build_object('pool_game', g.id));
  return r;
end $$;
revoke execute on function public.pool_game_set_rules(bigint, jsonb) from public, anon;
grant execute on function public.pool_game_set_rules(bigint, jsonb) to authenticated;


create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
  if p_kind = 'props' then return _props_rules(p_competition, r); end if;
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
    -- hockey's playoff feed has no score by period yet, so its grids pay on the final score
    pays := coalesce(r->>'pays', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' else 'final' end);
    if pays not in ('final', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' else 'final' end) then
      raise exception '%', case (select sport from competitions where id = p_competition)
        when 'mlb' then 'Pay after the 3rd, the 6th and the final, or the final score only'
        when 'nfl' then 'Pay after every quarter, or the final score only'
        when 'nhl' then 'Hockey grids pay on the final score for now'
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


create or replace function public.pool_host_pick(p_game bigint, p_team int, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; out jsonb;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if not exists (select 1 from teams where id = p_team and league_id = current_league_id() and role = 'gm') then
    raise exception 'Pick for a player in this pool';
  end if;
  if g.kind = 'pickem' then
    out := to_jsonb(_pickem_save_as(p_team, g.id, (p_pick->>'round')::int, p_pick->'picks'));
  elsif g.kind in ('series', 'rank', 'bracket', 'players', 'props') then
    out := _pool_game_pick_as(p_team, g.id, p_pick->>'thing', p_pick->'pick');
  else
    raise exception '%', case g.kind when 'squares' then 'Squares are claimed by each player, with their own coins'
      when 'survivor' then 'Pick for them on the Last one standing page' else 'The host can''t pick for a member in this game' end;
  end if;
  if p_team <> my_team() then
    perform _pool_alert(p_team, 'pool_game', format('📝 The host entered a pick for you in %s.', g.title), '/picks?g=' || g.id);
  end if;
  return out;
end $$;
revoke execute on function public.pool_host_pick(bigint, int, jsonb) from public, anon;
grant execute on function public.pool_host_pick(bigint, int, jsonb) to authenticated;


create or replace function public.sport_ingest(p_competition text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c competitions; x jsonb; y jsonb; nc int := 0; ns int := 0; nf int := 0; hc bigint; ac bigint; sid bigint; fid bigint; s record; need int;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition %', p_competition; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'clubs', '[]')) loop
    insert into clubs (sport, provider, ext_id, name, short, logo, color)
    values (c.sport, c.provider, x->>'ext_id', left(x->>'name', 80), nullif(left(x->>'short', 5), ''), nullif(x->>'logo', ''), nullif(x->>'color', ''))
    on conflict (sport, provider, ext_id) do update set name = excluded.name, short = coalesce(excluded.short, clubs.short),
      logo = coalesce(excluded.logo, clubs.logo), color = coalesce(excluded.color, clubs.color);
    nc := nc + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'series', '[]')) loop
    insert into series (sport, competition, provider, ext_id, round, label, short, best_of, high_club, low_club, starts_at, tbd, sort, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', (x->>'round')::int, left(x->>'label', 80), nullif(left(x->>'short', 12), ''), (x->>'best_of')::int,
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'high'),
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'low'),
      nullif(x->>'starts_at', '')::timestamptz, coalesce((x->>'tbd')::boolean, false), coalesce((x->>'sort')::int, 0), now())
    on conflict (provider, ext_id) do update set round = excluded.round, label = excluded.label, short = coalesce(excluded.short, series.short),
      best_of = excluded.best_of, high_club = coalesce(excluded.high_club, series.high_club), low_club = coalesce(excluded.low_club, series.low_club),
      starts_at = coalesce(excluded.starts_at, series.starts_at), tbd = excluded.tbd, sort = excluded.sort, updated_at = now();
    ns := ns + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'fixtures', '[]')) loop
    fid := null;
    select id into hc from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'home';
    select id into ac from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'away';
    if hc is null or ac is null then continue; end if;
    sid := (select id from series where provider = c.provider and ext_id = x->>'series');
    insert into fixtures (sport, competition, provider, ext_id, season, round, gameweek, kickoff, date, home_club, away_club,
      state, status, home_score, away_score, venue, series_id, game_no, detail, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', c.season, x->>'round',
      -- a single-game series' game carries its round, so last one standing can run on the tournament (migration 212)
      coalesce(nullif(x->>'gameweek', '')::int, (select z.round from series z where z.id = sid and z.best_of = 1)),
      (x->>'kickoff')::timestamptz, coalesce(nullif(x->>'date', '')::date, ((x->>'kickoff')::timestamptz at time zone c.tz)::date), hc, ac,
      x->>'state', x->>'status', nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(left(x->>'venue', 120), ''),
      sid, nullif(x->>'game_no', '')::int, x->'detail', now())
    on conflict (provider, ext_id) do update set round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
      venue = coalesce(excluded.venue, fixtures.venue), series_id = coalesce(excluded.series_id, fixtures.series_id),
      game_no = coalesce(excluded.game_no, fixtures.game_no), detail = coalesce(excluded.detail, fixtures.detail), updated_at = now()
    -- a game set by hand stays as set until it is handed back (migration 206)
    where not coalesce(fixtures.detail ? 'by_hand', false)
    returning id into fid;
    if fid is null then continue; end if;
    for y in select * from jsonb_array_elements(coalesce(x->'periods', '[]')) loop
      insert into fixture_periods (fixture_id, n, home, away) values (fid, (y->>'n')::int, nullif(y->>'home', '')::int, nullif(y->>'away', '')::int)
      on conflict (fixture_id, n) do update set home = excluded.home, away = excluded.away;
    end loop;
    nf := nf + 1;
  end loop;
  -- every series of the competition from its games: wins, the winner once a club has enough, live once a game is played
  for s in select * from series where competition = c.id loop
    need := s.best_of / 2 + 1;
    update series z set
      high_wins = w.hw, low_wins = w.lw,
      winner = case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end,
      state = case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
      starts_at = coalesce(w.first_ko, z.starts_at),
      updated_at = now()
    from (select
            count(*) filter (where f.state = 'final' and ((f.home_club = s.high_club and f.home_score > f.away_score) or (f.away_club = s.high_club and f.away_score > f.home_score)))::int hw,
            count(*) filter (where f.state = 'final' and ((f.home_club = s.low_club and f.home_score > f.away_score) or (f.away_club = s.low_club and f.away_score > f.home_score)))::int lw,
            count(*) filter (where f.state = 'final')::int played,
            count(*) filter (where f.state = 'live')::int live,
            min(f.kickoff) filter (where f.game_no = 1) first_ko
          from fixtures f where f.series_id = s.id) w
    where z.id = s.id and s.high_club is not null and s.low_club is not null
      and (z.high_wins, z.low_wins, z.state, z.winner, z.starts_at) is distinct from
          (w.hw, w.lw, case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
           case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end, coalesce(w.first_ko, z.starts_at));
  end loop;
  -- the squares on this event: draw at the first pitch, pay what the innings say
  -- a pool game's settlement never stops the feed: a failure is a warning, and the next run tries again
  begin perform _squares_tick(c.id); exception when others then raise warning 'squares on %: %', c.id, sqlerrm; end;
  -- and the prop sheets on its games (migration 208)
  begin perform _props_tick(c.id); exception when others then raise warning 'prop sheets on %: %', c.id, sqlerrm; end;
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;


