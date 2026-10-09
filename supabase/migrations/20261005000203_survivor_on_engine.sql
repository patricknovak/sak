-- Last one standing on the engine (docs/DEVELOPMENT.md §6 item 4, the contraction): a survivor is now a `pool_games` row
-- (kind 'survivor', its first and last rounds in its rules) and each round's pick a `pool_picks` row ('gw:<round>', the
-- club, its match and how it came out), like every other game a pool runs. The rules don't change, nor do the calls the
-- site makes (`survivor_board`, `survivor_pick`, `survivor_host_pick`, `survivor_current`, `pool_game_start`): they read
-- and write the engine's tables through two views in the old tables' shape.
-- * Expand, then contract: the old `survivors` and `survivor_picks` are copied across once and then left as they are,
--   read by nothing; dropping them is a later change, with Patrick's yes.
-- * The scoreboard and the game list keep the survivor on its own branch and page (`survivor:<id>`, `/survivor`).

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket', 'players', 'survivor'));

-- the old shapes over the engine's tables
create or replace view public.pool_survivors with (security_invoker = true) as
  select g.id, g.league_id, g.competition, (g.rules->>'start_gw')::int start_gw, (g.rules->>'end_gw')::int end_gw, g.status, g.winners,
    g.created_by, g.created_at
  from public.pool_games g where g.kind = 'survivor';
create or replace view public.pool_survivor_picks with (security_invoker = true) as
  select pk.id, pk.game_id survivor_id, pk.league_id, pk.team_id, substr(pk.thing, 4)::int gameweek, (pk.pick->>'club')::bigint club_id,
    (pk.pick->>'fixture')::bigint fixture_id, pk.pick->>'result' result, pk.picked_at
  from public.pool_picks pk join public.pool_games g on g.id = pk.game_id and g.kind = 'survivor'
  where pk.thing like 'gw:%';
-- a game is read as pool_games is (the league's own); picks stay hidden until they lock, so members read them
-- through survivor_board and the view is for the functions only
revoke all on public.pool_survivors, public.pool_survivor_picks from public, anon, authenticated;
grant select on public.pool_survivors to authenticated;

-- every survivor and its picks across, once (the new game remembers where it came from)
do $$ declare s record; gid bigint;
begin
  if to_regclass('public.survivors') is null then return; end if;
  for s in select * from survivors sv
           where not exists (select 1 from pool_games g where g.kind = 'survivor' and (g.rules->>'moved_from')::bigint = sv.id) order by sv.id loop
    insert into pool_games (league_id, kind, competition, title, rules, status, winners, created_by, created_at)
    values (s.league_id, 'survivor', s.competition, 'Last one standing', jsonb_build_object('start_gw', s.start_gw, 'end_gw', s.end_gw, 'moved_from', s.id),
      s.status, s.winners, s.created_by, s.created_at)
    returning id into gid;
    insert into pool_picks (game_id, league_id, team_id, thing, pick, picked_at)
    select gid, p.league_id, p.team_id, 'gw:' || p.gameweek, jsonb_build_object('club', p.club_id, 'fixture', p.fixture_id, 'result', p.result), p.picked_at
    from survivor_picks p where p.survivor_id = s.id;
    -- the reminders already sent stay sent
    insert into private.soccer_nudged (game, game_id, team_id, gameweek, at)
    select game, gid, team_id, gameweek, at from private.soccer_nudged where game = 'survivor' and game_id = s.id
    on conflict do nothing;
  end loop;
end $$;

create or replace function public._survivor_end(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(s.end_gw, (select max(f.gameweek) from fixtures f where f.competition = s.competition)) from pool_survivors s where s.id = p_survivor
$$;
revoke execute on function public._survivor_end(bigint) from public, anon, authenticated;


create or replace function public._survivor_week(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select min(f.gameweek) from pool_survivors s
  join fixtures f on f.competition = s.competition and f.gameweek between s.start_gw and _survivor_end(s.id)
  left join pool_result_overrides o on o.league_id = s.league_id and o.fixture_id = f.id
  where s.id = p_survivor and o.fixture_id is null and f.state not in ('final', 'postponed', 'cancelled')
$$;


create or replace function public._survivor_alive(p_survivor bigint, p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team and result in ('out', 'missed'))
    and (select count(*) from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team)
        >= (select count(distinct f.gameweek) from fixtures f join pool_survivors s on s.competition = f.competition
            where s.id = p_survivor and f.gameweek >= s.start_gw
              and f.gameweek < coalesce(_survivor_week(p_survivor), _survivor_end(p_survivor) + 1))
$$;
revoke execute on function public._survivor_week(bigint) from public, anon, authenticated;
revoke execute on function public._survivor_alive(bigint, int) from public, anon, authenticated;


create or replace function public._survivor_create(p_competition text, p_start_gw int, p_end_gw int) returns bigint
language plpgsql security definer set search_path = public as $$
declare c competitions; sid bigint; gw int; last_gw int; end_gw int; w text; club text; draws boolean;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition'; end if;
  if exists (select 1 from series where competition = p_competition) then raise exception 'Last one standing runs on a competition played in rounds'; end if;
  if exists (select 1 from pool_survivors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a survivor running'; end if;
  w := _round_word(p_competition);
  club := _sport_word(p_competition, 'club', 'club');
  draws := coalesce((select (s.config->>'draws')::boolean from sports s where s.id = c.sport), true);
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No % to start from yet', lower(w); end if;
  -- a round with nothing left to kick off can't be picked, so it can't be the first
  if not exists (select 1 from fixtures where competition = p_competition and gameweek = gw and state = 'scheduled' and kickoff > now()) then
    raise exception 'That % is under way; start from the next one', lower(w);
  end if;
  last_gw := (select max(gameweek) from fixtures where competition = p_competition);
  end_gw := coalesce(p_end_gw, last_gw);
  if end_gw < gw or end_gw > last_gw then raise exception 'No such %', lower(w); end if;
  insert into pool_games (kind, competition, title, rules, created_by)
  values ('survivor', p_competition, 'Last one standing', jsonb_build_object('start_gw', gw, 'end_gw', end_gw), my_team()) returning id into sid;
  perform _sys('general', format('🛡️ Last one standing starts in %s %s of the %s: pick one %s to win each %s, never the same %s twice. %s and you''re out.%s',
    lower(w), gw, c.name, club, lower(w), club, case when draws then 'A draw or a loss' else 'A loss or a tie' end,
    case when end_gw > gw then format(' It runs to %s %s; whoever is still in then shares it.', lower(w), end_gw) else '' end),
    jsonb_build_object('survivor', sid));
  return sid;
end $$;
revoke execute on function public._survivor_create(text, int, int) from public, anon, authenticated;


create or replace function public._survivor_pick_as(p_team int, p_survivor bigint, p_club bigint) returns int
language plpgsql security definer set search_path = public as $$
declare s pool_survivors; gw int; fx fixtures; cur pool_survivor_picks; w text; club text; self boolean := p_team = my_team();
begin
  select * into s from pool_survivors where id = p_survivor;
  if s.id is null or s.status <> 'open' then raise exception 'That survivor is over'; end if;
  if p_team is null or not exists (select 1 from teams where id = p_team and league_id = s.league_id and role = 'gm') then
    raise exception '%', case when self then 'Only players pick' else 'Pick for a player in this pool' end;
  end if;
  w := lower(_round_word(s.competition));
  club := _sport_word(s.competition, 'club', 'club');
  if not _survivor_alive(p_survivor, p_team) then
    if not exists (select 1 from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team) then
      raise exception 'This one started before % joined; the next one is %', case when self then 'you' else 'they' end, case when self then 'yours' else 'theirs' end;
    end if;
    raise exception '%', case when self then 'You''re out of this one' else 'They''re out of this one' end;
  end if;
  gw := _survivor_week(p_survivor);
  if gw is null then raise exception 'No % to pick in', w; end if;
  select * into fx from fixtures where competition = s.competition and gameweek = gw and (home_club = p_club or away_club = p_club)
    and state = 'scheduled' order by kickoff limit 1;
  if fx.id is null then raise exception 'That % doesn''t play this %', club, w; end if;
  if fx.kickoff <= now() then raise exception 'That % has kicked off', _sport_word(s.competition, 'match', 'match'); end if;
  select * into cur from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team and gameweek = gw;
  if cur.id is not null and (select kickoff from fixtures where id = cur.fixture_id) <= now() then
    raise exception '%', case when self then 'Your pick has kicked off; it stands' else 'Their pick has kicked off; it stands' end;
  end if;
  if exists (select 1 from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team and club_id = p_club and gameweek <> gw and result is distinct from 'void') then
    raise exception '% used that % already', case when self then 'You''ve' else 'They''ve' end, club;
  end if;
  insert into pool_picks (game_id, league_id, team_id, thing, pick) values (p_survivor, s.league_id, p_team, 'gw:' || gw,
    jsonb_build_object('club', p_club, 'fixture', fx.id, 'result', null))
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return gw;
end $$;
revoke execute on function public._survivor_pick_as(int, bigint, bigint) from public, anon, authenticated;


create or replace function public._survivor_settle(p_league int, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f fixtures; x record; o pool_result_overrides; p record; won boolean; s record; gw_done boolean; alive int; t record;
  opp text; ended boolean; h int; a int;
begin
  select * into f from fixtures where id = p_fixture;
  select * into x from _pool_fixture(p_league, p_fixture);
  if f.id is null or not x.done then return; end if;
  select * into o from pool_result_overrides where league_id = p_league and fixture_id = p_fixture;
  h := case when o.fixture_id is not null then o.home else coalesce(f.home_ft, f.home_score) end;
  a := case when o.fixture_id is not null then o.away else coalesce(f.away_ft, f.away_score) end;
  for p in select sp.*, c.name club from pool_survivor_picks sp join clubs c on c.id = sp.club_id
           where sp.fixture_id = f.id and sp.league_id = p_league and sp.result is null loop
    if x.void then
      update pool_picks set pick = pick || '{"result": "void"}' where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', format('🛡️ %s''s %s was called off, so you''re through and keep %s for later.',
        p.club, _sport_word(f.competition, 'match', 'match'), p.club), '/survivor');
    else
      won := (p.club_id = f.home_club and x.res = 'H') or (p.club_id = f.away_club and x.res = 'A');
      opp := (select name from clubs where id = case when p.club_id = f.home_club then f.away_club else f.home_club end);
      update pool_picks set pick = pick || jsonb_build_object('result', case when won then 'through' else 'out' end) where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', case
        when won and h is not null then format('🛡️ Through: %s beat %s %s-%s.', p.club, opp, greatest(h, a), least(h, a))
        when won then format('🛡️ Through: %s beat %s (settled by the host).', p.club, opp)
        when h is not null then format('💥 Out: %s didn''t beat %s (%s-%s).', p.club, opp, h, a)
        else format('💥 Out: %s didn''t beat %s (settled by the host).', p.club, opp) end, '/survivor');
    end if;
  end loop;
  -- this pool's open survivor on the competition, if this was its round's last match: no pick means out, then is
  -- anyone left?
  for s in select * from pool_survivors where league_id = p_league and competition = f.competition and status = 'open'
             and f.gameweek between start_gw and _survivor_end(id) loop
    gw_done := not exists (select 1 from fixtures ff cross join lateral _pool_fixture(p_league, ff.id) e
                           where ff.competition = s.competition and ff.gameweek = f.gameweek and not e.done);
    if not gw_done then continue; end if;
    for t in select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm'
             and not exists (select 1 from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and result in ('out', 'missed'))
             and (select count(*) from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek < f.gameweek)
                 >= (select count(distinct gameweek) from fixtures where competition = s.competition and gameweek >= s.start_gw and gameweek < f.gameweek)
             and not exists (select 1 from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek = f.gameweek) loop
      insert into pool_picks (game_id, league_id, team_id, thing, pick)
      values (s.id, s.league_id, t.id, 'gw:' || f.gameweek, '{"club": null, "fixture": null, "result": "missed"}');
      perform _pool_alert(t.id, 'survivor', format('💥 Out: no pick in %s %s.', lower(_round_word(s.competition)), f.gameweek), '/survivor');
    end loop;
    alive := (select count(*) from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id));
    ended := f.gameweek >= _survivor_end(s.id);
    if alive <= 1 or ended then
      -- one left wins it; the last round done, those still in share it; nobody left: those who went out this round share it
      update pool_games set status = 'done', winners = case when alive >= 1
          then array(select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id))
          else array(select distinct team_id from pool_survivor_picks where survivor_id = s.id and gameweek = f.gameweek and result in ('out', 'missed')) end
      where id = s.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Last one standing: %s.%s', (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from pool_survivors sv join teams tm on tm.id = any (sv.winners) where sv.id = s.id),
          case when alive > 1 then format(' Still in after %s %s, they share it.', lower(_round_word(s.competition)), f.gameweek) else '' end),
        jsonb_build_object('survivor', s.id), s.league_id);
    end if;
  end loop;
end $$;
revoke execute on function public._survivor_settle(int, bigint) from public, anon, authenticated;


create or replace function public._survivor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare l int;
begin
  if new.state = old.state or new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  for l in select league_id from pool_survivors where competition = new.competition and status = 'open'
           union select league_id from pool_survivor_picks where fixture_id = new.id and result is null loop
    perform _survivor_settle(l, new.id);
  end loop;
  return new;
end $$;
revoke execute on function public._survivor_settle_fixture() from public, anon, authenticated;


create or replace function public.survivor_board(p_survivor bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s pool_survivors; gw int;
begin
  perform _in_league('pool_games', p_survivor);
  select * into s from pool_survivors where id = p_survivor and league_id = current_league_id();
  if s.id is null then return null; end if;
  gw := _survivor_week(p_survivor);
  return jsonb_build_object(
    'id', s.id, 'competition', s.competition, 'competition_name', (select name from competitions where id = s.competition),
    'start_gw', s.start_gw, 'end_gw', _survivor_end(s.id), 'status', s.status, 'winners', to_jsonb(s.winners), 'gameweek', gw,
    'word', _round_word(s.competition), 'club_word', _sport_word(s.competition, 'club', 'club'),
    'match_word', _sport_word(s.competition, 'match', 'match'),
    'draws', coalesce((select (sp.config->>'draws')::boolean from competitions c join sports sp on sp.id = c.sport where c.id = s.competition), true),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state,
        'home', jsonb_build_object('id', h.id, 'name', h.name, 'short', h.short, 'logo', h.logo),
        'away', jsonb_build_object('id', a.id, 'name', a.name, 'short', a.short, 'logo', a.logo),
        'home_score', f.home_ft, 'away_score', f.away_ft) order by f.kickoff)
      from fixtures f join clubs h on h.id = f.home_club join clubs a on a.id = f.away_club
      where f.competition = s.competition and f.gameweek = gw), '[]'),
    'players', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'alive', _survivor_alive(s.id, t.id),
        'out_gw', (select min(p.gameweek) from pool_survivor_picks p where p.survivor_id = s.id and p.team_id = t.id and p.result in ('out', 'missed')),
        'picks', coalesce((select jsonb_agg(jsonb_build_object('gameweek', p.gameweek, 'club_id', p.club_id, 'short', c.short, 'name', c.name, 'logo', c.logo,
            'result', p.result, 'locked', coalesce(f.kickoff <= now(), true)) order by p.gameweek)
          from pool_survivor_picks p left join clubs c on c.id = p.club_id left join fixtures f on f.id = p.fixture_id
          where p.survivor_id = s.id and p.team_id = t.id
            -- another player's pick shows once it has kicked off; your own always
            and (t.id = _team() or f.kickoff <= now() or p.result is not null)), '[]'))
        order by _survivor_alive(s.id, t.id) desc, t.gm_name)
      from teams t where t.league_id = s.league_id and t.role = 'gm'), '[]'));
end $$;
revoke execute on function public.survivor_board(bigint) from public, anon;
grant execute on function public.survivor_board(bigint) to authenticated;


create or replace function public.survivor_current() returns bigint
language sql stable security definer set search_path = public as $$
  select id from pool_survivors where league_id = current_league_id() order by (status = 'open') desc, id desc limit 1
$$;
revoke execute on function public.survivor_current() from public, anon;
grant execute on function public.survivor_current() to authenticated;


create or replace function public.survivor_host_pick(p_survivor bigint, p_team int, p_club bigint) returns int
language plpgsql security definer set search_path = public as $$
declare gw int; s pool_survivors;
begin
  perform _commish();
  perform _in_league('pool_games', p_survivor);
  perform _in_league('teams', p_team);
  gw := _survivor_pick_as(p_team, p_survivor, p_club);
  select * into s from pool_survivors where id = p_survivor;
  perform _pool_alert(p_team, 'survivor', format('📝 The host picked %s for you in %s %s of Last one standing.',
    (select name from clubs where id = p_club), lower(_round_word(s.competition)), gw), '/survivor');
  return gw;
end $$;
revoke execute on function public.survivor_host_pick(bigint, int, bigint) from public, anon;
grant execute on function public.survivor_host_pick(bigint, int, bigint) to authenticated;


create or replace function public.survivor_pick(p_survivor bigint, p_club bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _in_league('pool_games', p_survivor);
  perform _survivor_pick_as(_team(), p_survivor, p_club);
end $$;
revoke execute on function public.survivor_pick(bigint, bigint) from public, anon;
grant execute on function public.survivor_pick(bigint, bigint) to authenticated;


create or replace function public._soccer_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g record; t record; n int := 0; gw int; first_ko timestamptz; last_ko timestamptz; total int; called int; hrs text; w text; club text; started boolean; last_call boolean;
begin
  for g in select 'predictor' game, id, competition, status from predictors where league_id = p_league and status = 'open'
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
        called := (select count(*) from predictor_picks where predictor_id = g.id and team_id = t.id and gameweek = gw);
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
    or exists (select 1 from predictors where league_id = lid and competition = f.competition and status = 'open')
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
    update predictor_picks pp set points = null, void = false from predictors s
      where pp.predictor_id = s.id and s.status = 'open' and pp.league_id = lid and pp.fixture_id = f.id;
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
  for g in select * from pool_games pg where pg.league_id = lid and pg.kind <> 'survivor' order by pg.id loop
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
  for g in select * from predictors s where s.league_id = lid order by s.id loop
    return query
    select 'predictor:' || g.id, 'score'::text, 'Call the score'::text, g.status, '/predictor'::text, x.id,
      x.pts::numeric, null::numeric, null::boolean, (-x.ex)::numeric,
      case when x.rt > 0 then format('%s exact, %s right', x.ex, x.rt) else 'No points yet' end
    from (select tm.id, coalesce(sum(p.points), 0)::int pts,
            count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
            count(*) filter (where p.points > 0)::int rt
          from teams tm
          left join predictor_picks p on p.predictor_id = g.id and p.team_id = tm.id
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
  from pool_games g where g.league_id = current_league_id() and g.kind <> 'survivor'
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;



revoke execute on function public._survivor_end(bigint) from public, anon, authenticated;
revoke execute on function public._survivor_week(bigint) from public, anon, authenticated;
revoke execute on function public._survivor_alive(bigint, int) from public, anon, authenticated;
revoke execute on function public._survivor_create(text, int, int) from public, anon, authenticated;
revoke execute on function public._survivor_pick_as(int, bigint, bigint) from public, anon, authenticated;
revoke execute on function public._survivor_settle(int, bigint) from public, anon, authenticated;
revoke execute on function public._survivor_settle_fixture() from public, anon, authenticated;
revoke execute on function public._soccer_nudge(int) from public, anon, authenticated;
revoke execute on function public._pool_rows() from public, anon, authenticated;
revoke execute on function public.survivor_board(bigint) from public, anon;
grant execute on function public.survivor_board(bigint) to authenticated;
revoke execute on function public.survivor_current() from public, anon;
grant execute on function public.survivor_current() to authenticated;
revoke execute on function public.survivor_host_pick(bigint, int, bigint) from public, anon;
grant execute on function public.survivor_host_pick(bigint, int, bigint) to authenticated;
revoke execute on function public.survivor_pick(bigint, bigint) from public, anon;
grant execute on function public.survivor_pick(bigint, bigint) to authenticated;
revoke execute on function public.pool_fixture_result_set(bigint, text, int, int, text) from public, anon;
grant execute on function public.pool_fixture_result_set(bigint, text, int, int, text) to authenticated;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;
