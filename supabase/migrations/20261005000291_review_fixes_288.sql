-- Review fixes to missed picks, the spread and lives (15 October 2026, migrations 285 to 288).
--
-- 1. The pick'em desk's settle (`pool_result_set`) wrote no score over the score the host had given the same match in
--    the match centre, so Call the score fell back to the result alone. A result with no score now keeps the one given.
-- 2. The tiebreaker read only the feed: a last game the host settled by hand scored no call, and a wrong feed score
--    decided it. `_pickem_miss`, `_pickem_tb_round` and the board read the pool's own result and score.
-- 3. The match centre's settle took a spread game with no score, pushing every pick; it now asks for the score.
-- 4. A tied game in a sport with no draws couldn't be settled by hand in a spread pool; with its level score it can.
-- 5. A forgotten pick and a pick with no line waited for the feed to start the game; the host settling it by hand now
--    fills them first (for that pool's league), as the feed's start does.
-- 6. The platform's week counted picks the pool made for people (and a survivor's missed rounds) as their calls.
-- And the survivor's last call tells a member with a life to spare that a missed round costs one, not that they're out.

drop function if exists public._pickem_autopick(bigint);
drop function if exists public._pickem_close_lines(bigint);

create or replace function public._pickem_autopick(p_fixture bigint, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare f fixtures; g pool_games; t record; side text; cf int; n int := 0; o jsonb; ln numeric; size int;
begin
  select * into f from fixtures where id = p_fixture;
  -- the feed's start, or (for one league) the host settling a game the feed never started
  if f.id is null or f.gameweek is null or f.state in ('postponed', 'cancelled') or (f.state = 'scheduled' and p_league is null) then return 0; end if;
  o := f.detail->'odds';
  for g in select * from pool_games pg where pg.kind = 'pickem' and pg.status = 'open' and pg.competition = f.competition
             and pg.rules->>'missed' = 'favourite' and (p_league is null or pg.league_id = p_league)
             and f.gameweek between (pg.rules->>'from_round')::int and (pg.rules->>'to_round')::int loop
    ln := case when g.rules->>'ats' = 'true' then coalesce((o->>'line')::numeric, 0) end;
    side := case when ln is not null then case when ln > 0 then 'A' else 'H' end
                 when (o->>'home') is not null and (o->>'away') is not null and (o->>'away')::numeric > (o->>'home')::numeric then 'A'
                 else 'H' end;
    size := (select count(*) from fixtures where competition = f.competition and gameweek = f.gameweek);
    for t in select tm.id from teams tm where tm.league_id = g.league_id and tm.role = 'gm'
               and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'f:' || f.id) loop
      cf := null;
      if g.rules->>'preset' = 'confidence' then
        select min(x) into cf from generate_series(1, size) x
        where not exists (select 1 from pool_picks pk join fixtures fx on pk.thing = 'f:' || fx.id
                          where pk.game_id = g.id and pk.team_id = t.id and fx.gameweek = f.gameweek and (pk.pick->>'conf')::int = x);
        if cf is null then continue; end if;
      end if;
      insert into pool_picks (game_id, team_id, thing, pick)
      values (g.id, t.id, 'f:' || f.id, jsonb_strip_nulls(jsonb_build_object('pick', side, 'conf', cf, 'line', ln, 'auto', true)))
      on conflict (game_id, team_id, thing) do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pickem_autopick(bigint, int) from public, anon, authenticated;

create or replace function public._pickem_close_lines(p_fixture bigint, p_league int default null) returns int
language plpgsql security definer set search_path = public as $$
declare f fixtures; n int;
begin
  select * into f from fixtures where id = p_fixture;
  if f.id is null then return 0; end if;
  update pool_picks pk set pick = pk.pick || jsonb_build_object('line', coalesce((f.detail->'odds'->>'line')::numeric, 0))
  from pool_games g
  where pk.game_id = g.id and g.kind = 'pickem' and g.competition = f.competition and g.rules->>'ats' = 'true'
    and pk.thing = 'f:' || f.id and not (pk.pick ? 'line') and (p_league is null or g.league_id = p_league);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public._pickem_close_lines(bigint, int) from public, anon, authenticated;

-- the host settles a game the feed hasn't started: that pool's forgotten picks and picks with no line are filled first
create or replace function public._pickem_override_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outcome <> 'void' then
    perform _pickem_close_lines(new.fixture_id, new.league_id);
    perform _pickem_autopick(new.fixture_id, new.league_id);
  end if;
  return null;
end $$;
revoke execute on function public._pickem_override_fill() from public, anon, authenticated;
-- named to fire before the settle and the split on the same row (triggers on one event fire in name order)
drop trigger if exists pool_result_overrides_fill on public.pool_result_overrides;
create trigger pool_result_overrides_fill after insert or update of outcome on public.pool_result_overrides
  for each row execute function public._pickem_override_fill();

create or replace function public.pool_result_set(p_game bigint, p_fixture bigint, p_outcome text, p_reason text default null,
                                                  p_home int default null, p_away int default null) returns text
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; v text := upper(nullif(trim(p_outcome), '')); hn text; an text; ats boolean;
begin
  perform _commish();
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.kind <> 'pickem' then raise exception 'Results by hand are for pick''em matches'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  select * into f from fixtures where id = p_fixture and competition = g.competition
    and gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int;
  if f.id is null then raise exception 'That match isn''t in this game'; end if;
  if f.state = 'scheduled' and f.kickoff > now() then raise exception 'That match hasn''t kicked off yet'; end if;
  if v is null then
    delete from pool_result_overrides where league_id = current_league_id() and fixture_id = f.id;
    return null;
  end if;
  if v not in ('H', 'D', 'A', 'VOID') then raise exception 'Settle it as a home win, an away win, a draw, or void'; end if;
  -- a tie in a sport with no draws can still be settled with its level score (scored against the line)
  if v = 'D' and not coalesce((g.rules->>'draws')::boolean, false) and p_home is null then raise exception 'There are no draws in this sport'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, so the pool can see it'; end if;
  v := case when v = 'VOID' then 'void' else v end;
  ats := g.rules->>'ats' = 'true';
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 then raise exception 'Give both scores'; end if;
  if v = 'void' then p_home := null; p_away := null; end if;
  if ats and v <> 'void' and p_home is null then raise exception 'Against the spread every pick is scored on its own line: give the final score'; end if;
  if p_home is not null and _fixture_result(p_home, p_away) <> v then raise exception 'That score doesn''t match the result'; end if;
  insert into pool_result_overrides (fixture_id, outcome, reason, by_team, home, away)
  values (f.id, v, left(trim(p_reason), 200), my_team(), p_home, p_away)
  on conflict (league_id, fixture_id) do update set outcome = excluded.outcome, reason = excluded.reason, by_team = excluded.by_team,
    -- a result with no score keeps the score the host already gave for it (from the match centre, for Call the score)
    home = case when excluded.outcome = 'void' then null else coalesce(excluded.home, case when pool_result_overrides.outcome = excluded.outcome then pool_result_overrides.home end) end,
    away = case when excluded.outcome = 'void' then null else coalesce(excluded.away, case when pool_result_overrides.outcome = excluded.outcome then pool_result_overrides.away end) end,
    at = now();
  select name into hn from clubs where id = f.home_club;
  select name into an from clubs where id = f.away_club;
  perform _sys('general', format('📝 The host settled %s v %s in %s: %s. %s', hn, an, g.title,
    case v when 'H' then hn || ' win' when 'A' then an || ' win' when 'D' then 'a draw' else 'void, it counts for nobody' end
      || case when p_home is not null then format(', %s-%s', p_home, p_away) else '' end, left(trim(p_reason), 200)),
    jsonb_build_object('pool_game', g.id, 'fixture', f.id));
  perform _pickem_round(g.id, f.gameweek);
  return v;
end $$;

create or replace function public._pickem_miss(p_game bigint, p_team int, p_round int) returns int
language sql stable security definer set search_path = public as $$
  select abs((pk.pick->>'runs')::int - (_pool_score(g.league_id, f.id, true) + _pool_score(g.league_id, f.id, false)))::int
  from pool_games g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_team and pk.thing = 't:' || p_round
  join fixtures f on f.id = coalesce((pk.pick->>'fixture')::bigint, _pickem_last(g.competition, p_round))
  cross join lateral _pool_fixture(g.league_id, f.id) e
  -- the pool's own result and score: the host's when they settled it by hand (migration 291), else the feed's
  where g.id = p_game and e.done and not e.void
$$;

create or replace function public._pickem_tb_round(p_game bigint) returns int
language sql stable security definer set search_path = public as $$
  select max(f.gameweek) from pool_games g join fixtures f on f.competition = g.competition
  cross join lateral _pool_fixture(g.league_id, f.id) e
  where g.id = p_game and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
    and e.done and not e.void and f.id = _pickem_last(g.competition, f.gameweek)
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
    'missed', coalesce(g.rules->>'missed', 'zero'),
    'size', (select count(*) from fixtures where competition = g.competition and gameweek = cur),
    -- the round's tiebreaker: the total in the game it was called on (its last game when called, migration 286), locked
    -- when that game starts; called on a game since put off, a fresh call on the round's last game now
    'tiebreak', (select jsonb_build_object('fixture', f.id, 'kickoff', f.kickoff, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'locked', f.state <> 'scheduled' or f.kickoff <= now(),
        'total', case when (select x.done and not x.void from _pool_fixture(g.league_id, f.id) x)
                      then _pool_score(g.league_id, f.id, true) + _pool_score(g.league_id, f.id, false) end,
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
        'line', case when g.rules->>'ats' = 'true' then coalesce((f.detail->'odds'->>'line')::numeric, 0) end,
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

create or replace function public.pool_fixture_result_set(p_fixture bigint, p_outcome text, p_home int default null, p_away int default null,
  p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); f fixtures; v text := upper(nullif(trim(p_outcome), '')); hn text; an text; draws boolean; g record;
begin
  perform _commish();
  select * into f from fixtures where id = p_fixture;
  if f.id is null or not (
       exists (select 1 from pool_survivors where league_id = lid and competition = f.competition and status = 'open')
    or exists (select 1 from pool_predictors where league_id = lid and competition = f.competition and status = 'open')
    or exists (select 1 from pool_games where league_id = lid and kind = 'pickem' and competition = f.competition and status = 'open'
               and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int)
    -- the daily streak reads the host's word too (migration 231)
    or exists (select 1 from pool_games where league_id = lid and kind = 'streak' and competition = f.competition and status = 'open')) then
    raise exception 'That match isn''t in one of this pool''s games';
  end if;
  if f.state = 'scheduled' and f.kickoff > now() then raise exception 'That match hasn''t kicked off yet'; end if;
  if v is null and p_home is null and p_away is null then
    delete from pool_result_overrides where league_id = lid and fixture_id = f.id;
    -- the picks it settled wait for the feed again (and are settled from it now, if it has the result)
    update pool_picks pk set pick = pk.pick || '{"result": null}' from pool_survivor_picks sp join pool_survivors s on s.id = sp.survivor_id
      where pk.id = sp.id and s.status = 'open' and sp.league_id = lid and sp.fixture_id = f.id and sp.club_id is not null;
    update pool_picks pk set pick = pk.pick || '{"points": null, "void": false}' from pool_predictor_picks pp join pool_predictors s on s.id = pp.predictor_id
      where pk.id = pp.id and s.status = 'open' and pp.league_id = lid and pp.fixture_id = f.id;
    perform _survivor_settle(lid, f.id);
    perform _predictor_settle(lid, f.id);
    return null;
  end if;
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 or p_home > 99 or p_away > 99 then raise exception 'Give both sides a score'; end if;
  if p_home is not null then v := case when p_home > p_away then 'H' when p_home < p_away then 'A' else 'D' end; end if;
  if v not in ('H', 'D', 'A', 'VOID') then raise exception 'Settle it as a home win, an away win, a draw, void, or a score'; end if;
  draws := coalesce((select (sp.config->>'draws')::boolean from sports sp where sp.id = f.sport), true);
  if v = 'D' and not draws and p_home is null then raise exception 'There are no draws in this sport'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, so the pool can see it'; end if;
  -- a pick'em against the spread on it scores every pick on its own line, which needs the score (migration 291)
  if v <> 'VOID' and p_home is null and exists (select 1 from pool_games where league_id = lid and kind = 'pickem' and status = 'open'
       and competition = f.competition and rules->>'ats' = 'true' and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int) then
    raise exception 'Against the spread every pick is scored on its own line: give the final score';
  end if;
  v := case when v = 'VOID' then 'void' else v end;
  insert into pool_result_overrides (fixture_id, outcome, home, away, reason, by_team)
  values (f.id, v, case when v = 'void' then null else p_home end, case when v = 'void' then null else p_away end, left(trim(p_reason), 200), my_team())
  on conflict (league_id, fixture_id) do update set outcome = excluded.outcome, home = excluded.home, away = excluded.away,
    reason = excluded.reason, by_team = excluded.by_team, at = now();
  -- a result replaced: the picks settle again from the new one
  update pool_picks pk set pick = pk.pick || '{"result": null}' from pool_survivor_picks sp join pool_survivors s on s.id = sp.survivor_id
    where pk.id = sp.id and s.status = 'open' and sp.league_id = lid and sp.fixture_id = f.id and sp.club_id is not null;
  select name into hn from clubs where id = f.home_club;
  select name into an from clubs where id = f.away_club;
  perform _sys('general', format('📝 The host settled %s: %s. %s',
    case when p_home is not null then format('%s %s-%s %s', hn, p_home, p_away, an) else format('%s v %s', hn, an) end,
    case v when 'H' then hn || ' win' when 'A' then an || ' win' when 'D' then case when draws then 'a draw' else 'a tie' end else 'void, it counts for nobody' end,
    left(trim(p_reason), 200)), jsonb_build_object('fixture', f.id));
  perform _survivor_settle(lid, f.id);
  perform _predictor_settle(lid, f.id);
  for g in select id from pool_games where league_id = lid and kind = 'pickem' and competition = f.competition and status = 'open'
             and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int loop
    perform _pickem_round(g.id, f.gameweek);
  end loop;
  return v;
end $$;

create or replace function public.platform_week() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '7 days'; out jsonb;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  with real_members as (
    select m.league_id, m.user_id, m.joined_at from league_members m
    left join accounts a on a.user_id = m.user_id where not coalesce(a.is_test, false)
  ),
  -- what people did, leaving out test accounts (migration 268): a test account's calls and chat are testing, not use
  calls as (
    select c.league_id, c.team_id, c.at from (
      select league_id, team_id, created_at as at from pool_trades
      -- a pick the pool made for someone (a forgotten pick on the favourite, migration 285, or a survivor's missed round)
      -- is nobody's call
      union all select league_id, team_id, picked_at from pool_picks where not (pick ? 'auto') and coalesce(pick->>'result', '') <> 'missed'
      union all select league_id, created_by, created_at from pool_markets where created_by is not null) c
    join teams t on t.id = c.team_id left join accounts a on a.user_id = t.user_id
    where not coalesce(a.is_test, false)
  ),
  talk as (
    select x.league_id, x.created_at from messages x join teams t on t.id = x.team_id left join accounts a on a.user_id = t.user_id
    where x.kind = 'user' and not coalesce(a.is_test, false)
  ),
  -- the stranger's path measured (section 8.4 item 4): members whose first call came within fifteen minutes of
  -- joining, which is what the invite's first call and the three-field form are for
  first_calls as (
    select m.league_id, m.user_id, m.joined_at
    from real_members m join teams t on t.league_id = m.league_id and t.user_id = m.user_id
    where exists (select 1 from calls c where c.league_id = m.league_id and c.team_id = t.id and c.at between m.joined_at and m.joined_at + interval '15 minutes')
  ),
  per_league as (
    select l.id, l.name, l.kind, l.status, l.created_at,
      (select count(*) from real_members m where m.league_id = l.id) as members,
      (select count(*) from real_members m where m.league_id = l.id and m.joined_at > since) as joined_7d,
      (select count(*) from calls c where c.league_id = l.id and c.at > since) as calls_7d,
      (select count(distinct c.team_id) from calls c where c.league_id = l.id and c.at > since) as callers_7d,
      (select count(*) from talk x where x.league_id = l.id and x.created_at > since) as messages_7d,
      greatest(l.created_at,
        (select max(c.at) from calls c where c.league_id = l.id),
        (select max(x.created_at) from talk x where x.league_id = l.id),
        (select max(t.last_seen) from teams t where t.league_id = l.id)) as last_alive
    from leagues l where l.status <> 'archived'
  )
  select jsonb_build_object(
    'since', since,
    'week', jsonb_build_object(
      'pools_started', (select count(*) from leagues where created_at > since and kind = 'predict' and id in (select league_id from real_members)),
      'leagues_started', (select count(*) from leagues where created_at > since and kind = 'fantasy' and id in (select league_id from real_members)),
      'people_joined', (select count(distinct user_id) from real_members where joined_at > since),
      'first_calls', (select count(*) from first_calls where joined_at > since),
      'calls', (select count(*) from calls where at > since),
      'messages', (select count(*) from talk where created_at > since),
      'links_made', (select count(*) from league_invites where created_at > since),
      'waitlist', (select count(*) from waitlist where created_at > since)),
    'all_time', jsonb_build_object(
      'pools', (select count(*) from leagues where kind = 'predict' and id in (select league_id from real_members)),
      'leagues', (select count(*) from leagues where kind = 'fantasy' and id in (select league_id from real_members)),
      'people', (select count(distinct user_id) from real_members),
      'first_calls', (select count(*) from first_calls),
      'calls', (select count(*) from calls),
      'messages', (select count(*) from talk),
      'waitlist', (select count(*) from waitlist)),
    'leagues', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'status', status, 'members', members,
        'joined_7d', joined_7d, 'calls_7d', calls_7d, 'callers_7d', callers_7d, 'messages_7d', messages_7d, 'last_alive', last_alive)
        order by last_alive desc nulls last, id), '[]'::jsonb) from per_league))
  into out;
  return out;
end $$;

create or replace function public._soccer_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g record; t record; n int := 0; gw int; first_ko timestamptz; last_ko timestamptz; total int; called int; hrs text; w text; club text; started boolean; last_call boolean;
begin
  for g in select 'predictor' game, id, competition, status from pool_predictors where league_id = p_league and status = 'open'
           union all select 'survivor', id, competition, status from pool_survivors where league_id = p_league and status = 'open' loop
    gw := case when g.game = 'predictor' then _predictor_week(g.id) else _survivor_week(g.id) end;
    if gw is null then continue; end if;
    select min(kickoff), max(kickoff), count(*) into first_ko, last_ko, total from fixtures where competition = g.competition and gameweek = gw and state = 'scheduled' and kickoff > now();
    if first_ko is null then continue; end if;
    w := _round_word(g.competition); club := _sport_word(g.competition, 'club', 'club');
    started := exists (select 1 from fixtures where competition = g.competition and gameweek = gw and kickoff <= now());
    -- the round's first kick-off six hours out; for last one standing, a round already under way (the NFL's Thursday
    -- game) gets a last call six hours before its final kick-off instead, for anyone still without a pick
    last_call := g.game = 'survivor' and started;
    if last_call then
      if last_ko > now() + interval '6 hours' then continue; end if;
      first_ko := last_ko;
    elsif started or first_ko > now() + interval '6 hours' then continue;
    end if;
    hrs := case when first_ko - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from first_ko - now()) / 3600))::int || 'h' end;
    for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
               -- a last call is kept apart from the first reminder (its round as a negative number)
               and not exists (select 1 from private.soccer_nudged x where x.game = g.game and x.game_id = g.id and x.team_id = tm.id
                               and x.gameweek = case when last_call then -gw else gw end) loop
      if g.game = 'predictor' then
        called := (select count(*) from pool_predictor_picks where predictor_id = g.id and team_id = t.id and gameweek = gw);
        if called >= total then continue; end if;
        perform _pool_alert(t.id, 'predictor', format('⏰ %s %s kicks off in %s. %s', w, gw, hrs,
          case when called = 0 then format('Call the score: %s matches to call.', total) else format('You have %s of %s matches still to call.', total - called, total) end), '/predictor');
      else
        if not _survivor_alive(g.id, t.id) or exists (select 1 from pool_survivor_picks where survivor_id = g.id and team_id = t.id and gameweek = gw) then continue; end if;
        perform _pool_alert(t.id, 'survivor', case when last_call
          then format('⏰ Last call for %s %s: its last %s kicks off in %s. Pick your %s or %s.', lower(w), gw, _sport_word(g.competition, 'match', 'match'), hrs, club,
                      -- with a life to spare, a missed round costs one (migration 288)
                      case when _survivor_lives(g.id) - (select count(*) from pool_survivor_picks where survivor_id = g.id and team_id = t.id and result in ('out', 'missed')) > 1
                           then 'it costs a life' else 'you''re out' end)
          else format('⏰ %s %s kicks off in %s. Pick your %s to stay in.', w, gw, hrs, club) end, '/survivor');
      end if;
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.game, g.id, t.id, case when last_call then -gw else gw end) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
