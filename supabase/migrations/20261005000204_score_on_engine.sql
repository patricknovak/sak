-- Call the score on the engine (docs/DEVELOPMENT.md §6 item 4, the contraction's second half; migration 203 moved Last one
-- standing): a score predictor is now a `pool_games` row (kind 'score', its first round in its rules, the rounds the
-- pool has heard in `posted`) and each call a `pool_picks` row ('f:<match>', the round, the score, the banker and its
-- points once settled). The rules and the site's calls (`predictor_board`, `predictor_save`, `predictor_current`,
-- `predictor_start`) don't change: they go through two views in the old tables' shape.
-- * Expand, then contract: `predictors` and `predictor_picks` are copied across once and left as they are, read by
--   nothing; dropping them is a later change, with Patrick's yes.
-- * The scoreboard and the game list keep Call the score on its own branch and page (`predictor:<id>`, `/predictor`).

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket', 'players', 'survivor', 'score'));

create or replace view public.pool_predictors with (security_invoker = true) as
  select g.id, g.league_id, g.competition, (g.rules->>'start_gw')::int start_gw, g.status, g.posted, g.winners, g.created_by, g.created_at
  from public.pool_games g where g.kind = 'score';
create or replace view public.pool_predictor_picks with (security_invoker = true) as
  select pk.id, pk.game_id predictor_id, pk.league_id, pk.team_id, substr(pk.thing, 3)::bigint fixture_id, (pk.pick->>'gw')::int gameweek,
    (pk.pick->>'home')::int home, (pk.pick->>'away')::int away, coalesce((pk.pick->>'banker')::boolean, false) banker,
    (pk.pick->>'points')::int points, coalesce((pk.pick->>'void')::boolean, false) void, pk.picked_at
  from public.pool_picks pk join public.pool_games g on g.id = pk.game_id and g.kind = 'score'
  where pk.thing like 'f:%';
-- a game is read as pool_games is; calls stay hidden until their match kicks off, so members read them through
-- predictor_board and the view is for the functions only
revoke all on public.pool_predictors, public.pool_predictor_picks from public, anon, authenticated;
grant select on public.pool_predictors to authenticated;

-- every predictor and its calls across, once
do $$ declare s record; gid bigint;
begin
  if to_regclass('public.predictors') is null then return; end if;
  for s in select * from predictors pr
           where not exists (select 1 from pool_games g where g.kind = 'score' and (g.rules->>'moved_from')::bigint = pr.id) order by pr.id loop
    insert into pool_games (league_id, kind, competition, title, rules, status, posted, winners, created_by, created_at)
    values (s.league_id, 'score', s.competition, 'Call the score', jsonb_build_object('start_gw', s.start_gw, 'moved_from', s.id),
      s.status, s.posted::bigint[], s.winners, s.created_by, s.created_at)
    returning id into gid;
    insert into pool_picks (game_id, league_id, team_id, thing, pick, picked_at)
    select gid, p.league_id, p.team_id, 'f:' || p.fixture_id,
      jsonb_build_object('gw', p.gameweek, 'home', p.home, 'away', p.away, 'banker', p.banker, 'points', p.points, 'void', p.void), p.picked_at
    from predictor_picks p where p.predictor_id = s.id;
    insert into private.soccer_nudged (game, game_id, team_id, gameweek, at)
    select game, gid, team_id, gameweek, at from private.soccer_nudged where game = 'predictor' and game_id = s.id
    on conflict do nothing;
  end loop;
end $$;

create or replace function public._predictor_week(p_predictor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(f.gameweek) from pool_predictors s
     join fixtures f on f.competition = s.competition and f.gameweek >= s.start_gw
     left join pool_result_overrides o on o.league_id = s.league_id and o.fixture_id = f.id
     where s.id = p_predictor and o.fixture_id is null and f.state not in ('final', 'postponed', 'cancelled')),
    (select max(f.gameweek) from fixtures f join pool_predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw))
$$;


create or replace function public._predictor_settle(p_league int, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f fixtures; x record; o pool_result_overrides; h int; a int; p record; s record; top record; lead record; last_gw int;
begin
  select * into f from fixtures where id = p_fixture;
  select * into x from _pool_fixture(p_league, p_fixture);
  if f.id is null or not x.done then return; end if;
  select * into o from pool_result_overrides where league_id = p_league and fixture_id = p_fixture;
  if x.void then
    update pool_picks pk set pick = pk.pick || '{"points": 0, "void": true}' from pool_predictor_picks v
    where pk.id = v.id and v.fixture_id = f.id and v.league_id = p_league;
  else
    h := case when o.fixture_id is not null then o.home else coalesce(f.home_ft, f.home_score) end;
    a := case when o.fixture_id is not null then o.away else coalesce(f.away_ft, f.away_score) end;
    if h is null and o.fixture_id is null then return; end if;
    -- a spot-on call hears about it, once (the first time it is scored)
    if h is not null then
      for p in select pp.team_id, pp.banker from pool_predictor_picks pp join pool_predictors pr on pr.id = pp.predictor_id
               where pp.fixture_id = f.id and pp.league_id = p_league and pp.points is null and pp.home = h and pp.away = a and pr.status = 'open' loop
        perform _pool_alert(p.team_id, 'predictor', format('🎯 Spot on: %s %s-%s %s. +%s%s', (select name from clubs where id = f.home_club), h, a,
          (select name from clubs where id = f.away_club), case when p.banker then 6 else 3 end, case when p.banker then ' with your banker' else '' end), '/predictor');
      end loop;
      update pool_picks pk set pick = pk.pick || jsonb_build_object('points', _predictor_points(v.home, v.away, h, a, v.banker), 'void', false)
      from pool_predictor_picks v where pk.id = v.id and v.fixture_id = f.id and v.league_id = p_league;
    else
      update pool_picks pk set pick = pk.pick || jsonb_build_object('points', (case when sign(v.home - v.away) = case x.res when 'H' then 1 when 'A' then -1 else 0 end then 1 else 0 end)
        * case when v.banker then 2 else 1 end, 'void', false)
      from pool_predictor_picks v where pk.id = v.id and v.fixture_id = f.id and v.league_id = p_league;
    end if;
  end if;
  -- this pool's open predictor on the competition whose round is now done and not yet announced
  for s in select * from pool_predictors where league_id = p_league and competition = f.competition and status = 'open' and f.gameweek >= start_gw
             and not (f.gameweek = any (posted)) loop
    if exists (select 1 from fixtures ff cross join lateral _pool_fixture(p_league, ff.id) e
               where ff.competition = s.competition and ff.gameweek = f.gameweek and not e.done) then continue; end if;
    select string_agg(z.gm_name, ' and ' order by z.gm_name) names, max(z.pts) pts, count(*) n into top
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from pool_predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id and pp.gameweek = f.gameweek group by tm.id, tm.gm_name) z where z.rk = 1 and z.pts > 0;
    select string_agg(z.gm_name, ' and ' order by z.gm_name) names, max(z.pts) pts into lead
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from pool_predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id group by tm.id, tm.gm_name) z where z.rk = 1 and z.pts > 0;
    last_gw := (select max(gameweek) from fixtures where competition = s.competition);
    update pool_games set posted = posted || f.gameweek::bigint where id = s.id;
    if f.gameweek >= last_gw and lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Call the score is done: %s, %s points over the season.', lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', f.gameweek), s.league_id);
    elsif top.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🎯 %s %s is done. Top of the week: %s with %s %s. Leading the table: %s on %s.', _round_word(s.competition), f.gameweek, top.names, top.pts,
               case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', f.gameweek), s.league_id);
    end if;
    if top.names is not null then
      for p in select pp.team_id from pool_predictor_picks pp where pp.predictor_id = s.id and pp.gameweek = f.gameweek
               group by pp.team_id having sum(pp.points) = top.pts loop
        perform _pool_alert(p.team_id, 'predictor', format('🏅 You won %s %s with %s %s.', lower(_round_word(s.competition)), f.gameweek, top.pts, case when top.pts = 1 then 'point' else 'points' end), '/predictor');
      end loop;
    end if;
    if f.gameweek >= last_gw then
      update pool_games set status = 'done', winners = array(
        select team_id from pool_predictor_picks where predictor_id = s.id group by team_id
        having sum(points) = (select max(t) from (select sum(points) t from pool_predictor_picks where predictor_id = s.id group by team_id) z) and sum(points) > 0)
      where id = s.id;
    end if;
  end loop;
end $$;
revoke execute on function public._predictor_settle(int, bigint) from public, anon, authenticated;


create or replace function public._predictor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare l int;
begin
  if new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  if new.state = old.state and new.home_ft is not distinct from old.home_ft and new.away_ft is not distinct from old.away_ft
     and new.home_score is not distinct from old.home_score and new.away_score is not distinct from old.away_score then return new; end if;
  for l in select league_id from pool_predictors where competition = new.competition and status = 'open'
           union select league_id from pool_predictor_picks where fixture_id = new.id loop
    perform _predictor_settle(l, new.id);
  end loop;
  return new;
end $$;
revoke execute on function public._predictor_settle_fixture() from public, anon, authenticated;


create or replace function public.predictor_board(p_predictor bigint, p_gameweek int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s pool_predictors; gw int; cur int; me int := _team();
begin
  perform _in_league('pool_games', p_predictor);
  select * into s from pool_predictors where id = p_predictor and league_id = current_league_id();
  if s.id is null then return null; end if;
  cur := _predictor_week(p_predictor);
  gw := greatest(s.start_gw, coalesce(p_gameweek, cur));
  return jsonb_build_object(
    'id', s.id, 'competition', s.competition, 'competition_name', (select name from competitions where id = s.competition),
    'start_gw', s.start_gw, 'status', s.status, 'winners', to_jsonb(s.winners), 'current_gw', cur, 'gameweek', gw,
    'last_gw', (select max(gameweek) from fixtures where competition = s.competition),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'minute', f.minute,
        'home', jsonb_build_object('id', h.id, 'name', h.name, 'short', h.short, 'logo', h.logo),
        'away', jsonb_build_object('id', a.id, 'name', a.name, 'short', a.short, 'logo', a.logo),
        'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score),
        'mine', (select jsonb_build_object('home', p.home, 'away', p.away, 'banker', p.banker, 'points', p.points, 'void', p.void)
                 from pool_predictor_picks p where p.predictor_id = s.id and p.team_id = me and p.fixture_id = f.id),
        -- everyone's calls, once the match has kicked off
        'calls', case when f.kickoff <= now() or f.state <> 'scheduled' then coalesce((select jsonb_agg(jsonb_build_object(
            'team_id', p.team_id, 'home', p.home, 'away', p.away, 'banker', p.banker, 'points', p.points) order by p.points desc nulls last, p.team_id)
          from pool_predictor_picks p where p.predictor_id = s.id and p.fixture_id = f.id), '[]') end) order by f.kickoff, f.id)
      from fixtures f join clubs h on h.id = f.home_club join clubs a on a.id = f.away_club
      where f.competition = s.competition and f.gameweek = gw), '[]'),
    'table', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'points', t.pts, 'week', t.wk, 'exact', t.ex, 'right', t.rt, 'called', t.called)
        order by t.pts desc, t.ex desc, t.gm_name)
      from (select tm.id, tm.gm_name,
              coalesce(sum(p.points), 0)::int pts,
              coalesce(sum(p.points) filter (where p.gameweek = gw), 0)::int wk,
              count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
              count(*) filter (where p.points > 0)::int rt,
              count(p.id) filter (where p.gameweek = gw)::int called
            from teams tm
            left join pool_predictor_picks p on p.predictor_id = s.id and p.team_id = tm.id
            left join fixtures f on f.id = p.fixture_id
            where tm.league_id = s.league_id and tm.role = 'gm'
            group by tm.id, tm.gm_name) t), '[]'));
end $$;
revoke execute on function public.predictor_board(bigint, int) from public, anon;
grant execute on function public.predictor_board(bigint, int) to authenticated;


create or replace function public.predictor_current() returns bigint
language sql stable security definer set search_path = public as $$
  select id from pool_predictors where league_id = current_league_id() order by (status = 'open') desc, id desc limit 1
$$;
revoke execute on function public.predictor_current() from public, anon;
grant execute on function public.predictor_current() to authenticated;


create or replace function public.predictor_save(p_predictor bigint, p_gameweek int, p_picks jsonb, p_banker bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare s pool_predictors; me int := _team(); x jsonb; fx fixtures; n int := 0; h int; a int; cur_bank record;
begin
  perform _in_league('pool_games', p_predictor);
  select * into s from pool_predictors where id = p_predictor;
  if s.id is null or s.status <> 'open' then raise exception 'That one is over'; end if;
  if me is null or (select role from teams where id = me) <> 'gm' then raise exception 'Only players call scores'; end if;
  if p_gameweek < s.start_gw then raise exception 'That matchweek is before this one started'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_picks, '[]')) loop
    select * into fx from fixtures where id = (x->>'fixture')::bigint and competition = s.competition and gameweek = p_gameweek;
    if fx.id is null then raise exception 'That match isn''t in matchweek %', p_gameweek; end if;
    if fx.kickoff <= now() or fx.state not in ('scheduled', 'postponed') then continue; end if;
    h := (x->>'home')::int; a := (x->>'away')::int;
    if h is null or a is null or h not between 0 and 20 or a not between 0 and 20 then raise exception 'A score is a number from 0 to 20'; end if;
    insert into pool_picks (game_id, league_id, team_id, thing, pick)
    values (p_predictor, s.league_id, me, 'f:' || fx.id, jsonb_build_object('gw', p_gameweek, 'home', h, 'away', a, 'banker', false, 'points', null, 'void', false))
    on conflict (game_id, team_id, thing) do update set pick = pool_picks.pick || jsonb_build_object('home', h, 'away', a), picked_at = now();
    n := n + 1;
  end loop;
  if p_banker is not null then
    select p.fixture_id, f.kickoff into cur_bank from pool_predictor_picks p join fixtures f on f.id = p.fixture_id
    where p.predictor_id = p_predictor and p.team_id = me and p.gameweek = p_gameweek and p.banker;
    if cur_bank.fixture_id is distinct from p_banker then
      if cur_bank.fixture_id is not null and cur_bank.kickoff <= now() then raise exception 'Your banker has kicked off; it stands'; end if;
      select * into fx from fixtures where id = p_banker and competition = s.competition and gameweek = p_gameweek;
      if fx.id is null or fx.kickoff <= now() then raise exception 'Pick a banker that hasn''t kicked off'; end if;
      if not exists (select 1 from pool_predictor_picks where predictor_id = p_predictor and team_id = me and fixture_id = p_banker) then
        raise exception 'Call that match''s score first';
      end if;
      update pool_picks pk set pick = pk.pick || '{"banker": false}' from pool_predictor_picks v
      where pk.id = v.id and v.predictor_id = p_predictor and v.team_id = me and v.gameweek = p_gameweek and v.banker;
      update pool_picks pk set pick = pk.pick || '{"banker": true}' from pool_predictor_picks v
      where pk.id = v.id and v.predictor_id = p_predictor and v.team_id = me and v.fixture_id = p_banker;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.predictor_save(bigint, int, jsonb, bigint) from public, anon;
grant execute on function public.predictor_save(bigint, int, jsonb, bigint) to authenticated;


create or replace function public.predictor_start(p_competition text, p_start_gw int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare sid bigint; gw int;
begin
  perform _commish();
  if not exists (select 1 from competitions where id = p_competition) then raise exception 'No such competition'; end if;
  if exists (select 1 from pool_predictors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a score predictor running'; end if;
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No matchweek to start from yet'; end if;
  insert into pool_games (kind, competition, title, rules, created_by)
  values ('score', p_competition, 'Call the score', jsonb_build_object('start_gw', gw), my_team()) returning id into sid;
  perform _sys('general', format('🎯 Call the score starts in matchweek %s of the %s: call every match. The exact score is 3 points, the right result 1, and your banker counts double.',
    gw, (select name from competitions where id = p_competition)), jsonb_build_object('predictor', sid));
  return sid;
end $$;
revoke execute on function public.predictor_start(text, int) from public, anon;
grant execute on function public.predictor_start(text, int) to authenticated;


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
          then format('⏰ Last call for %s %s: its last %s kicks off in %s. Pick your %s or you''re out.', lower(w), gw, _sport_word(g.competition, 'match', 'match'), hrs, club)
          else format('⏰ %s %s kicks off in %s. Pick your %s to stay in.', w, gw, hrs, club) end, '/survivor');
      end if;
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.game, g.id, t.id, case when last_call then -gw else gw end) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._soccer_nudge(int) from public, anon, authenticated;


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
               and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int)) then
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
revoke execute on function public.pool_fixture_result_set(bigint, text, int, int, text) from public, anon;
grant execute on function public.pool_fixture_result_set(bigint, text, int, int, text) to authenticated;


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
      case when g.kind = 'squares' then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'bracket' then case when t.right_calls > 0 then format('%s right', t.right_calls) when t.picked > 0 then 'Bracket in' else 'No bracket yet' end
        when 'players' then case when t.right_calls + t.exact > 0 then format('%s goal%s, %s assist%s', t.right_calls, case when t.right_calls = 1 then '' else 's' end,
                                                                   t.exact, case when t.exact = 1 then '' else 's' end)
                                 when t.picked > 0 then 'Team in' else 'No team yet' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
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


create or replace function public.pool_games_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status, 'competition', g.competition,
      'series', (g.rules->>'series')::bigint,
      'to_pick', case when g.kind = 'series' then
          (select count(*) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.low_club is not null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 's:' || s.id))
        when g.kind = 'pickem' then
          (select count(*) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
             and f.gameweek = (select min(f2.gameweek) from fixtures f2 where f2.competition = g.competition and f2.state = 'scheduled' and f2.kickoff > now()
                               and f2.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int)
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'f:' || f.id))
        when g.kind = 'players' then
          case when coalesce(_players_lock(g.id) > now(), false)
                 and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'box') then 1 else 0 end
        when g.kind = 'squares' then
          (select case when g.draw is null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                         and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing like 'sq:%') then 1 else 0 end
           from series s where s.id = (g.rules->>'series')::bigint)
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
        when g.kind = 'squares' then
          (select s.starts_at from series s where s.id = (g.rules->>'series')::bigint and g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id() and g.kind not in ('survivor', 'score')
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;



revoke execute on function public._predictor_week(bigint) from public, anon, authenticated;
revoke execute on function public._predictor_settle(int, bigint) from public, anon, authenticated;
revoke execute on function public._predictor_settle_fixture() from public, anon, authenticated;
revoke execute on function public._soccer_nudge(int) from public, anon, authenticated;
revoke execute on function public._pool_rows() from public, anon, authenticated;
revoke execute on function public.predictor_board(bigint, int) from public, anon;
grant execute on function public.predictor_board(bigint, int) to authenticated;
revoke execute on function public.predictor_current() from public, anon;
grant execute on function public.predictor_current() to authenticated;
revoke execute on function public.predictor_save(bigint, int, jsonb, bigint) from public, anon;
grant execute on function public.predictor_save(bigint, int, jsonb, bigint) to authenticated;
revoke execute on function public.predictor_start(text, int) from public, anon;
grant execute on function public.predictor_start(text, int) to authenticated;
revoke execute on function public.pool_fixture_result_set(bigint, text, int, int, text) from public, anon;
grant execute on function public.pool_fixture_result_set(bigint, text, int, int, text) to authenticated;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;
