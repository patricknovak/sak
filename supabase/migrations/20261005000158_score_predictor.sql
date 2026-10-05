-- Call the score (docs/POOLS.md section 7, P3): a score predictor inside a prediction pool, coin-free like the survivor.
-- The host starts it on a competition from a matchweek; every player calls the score of every match, each call open
-- until its kick-off. The exact score is 3 points and the right result 1; one banker a matchweek counts double. The
-- score after ninety minutes counts (the way result questions read). A postponed or cancelled match is void (no
-- points) until it is played. Points land the moment the result comes in, through a trigger on fixtures, and when a
-- matchweek is done the pool hears who won it. Everyone else's calls show once their match kicks off.
-- Also: a reminder a few hours before a matchweek's first kick-off, for a player with matches still to call here or no
-- survivor pick yet (run_pool_drops, hourly).

create table if not exists public.predictors (
  id bigint generated always as identity primary key,
  league_id int not null default current_league_id() references public.leagues (id),
  competition text not null references public.competitions (id),
  start_gw int not null,
  status text not null default 'open' check (status in ('open', 'done')),
  posted int[] not null default '{}',                           -- the matchweeks whose winners the pool has heard
  winners int[],
  created_by int references public.teams (id),
  created_at timestamptz not null default now()
);
create index if not exists predictors_league on public.predictors (league_id);

create table if not exists public.predictor_picks (
  id bigint generated always as identity primary key,
  predictor_id bigint not null references public.predictors (id) on delete cascade,
  league_id int not null default current_league_id() references public.leagues (id),
  team_id int not null references public.teams (id),
  fixture_id bigint not null references public.fixtures (id),
  gameweek int not null,
  home int not null check (home between 0 and 20),
  away int not null check (away between 0 and 20),
  banker boolean not null default false,
  points int,                                                   -- null until the result is in
  void boolean not null default false,
  picked_at timestamptz not null default now(),
  unique (predictor_id, team_id, fixture_id)
);
create unique index if not exists predictor_picks_one_banker on public.predictor_picks (predictor_id, team_id, gameweek) where banker;
create index if not exists predictor_picks_fixture on public.predictor_picks (fixture_id);

do $$ declare t text; begin
  foreach t in array array['predictors', 'predictor_picks'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = format('public.%I', t)::regclass and polname = 'league_read') then
      execute format('create policy league_read on public.%I for select to authenticated using (league_id = (select current_league_id()))', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- a pick's numbers stay behind the board until kick-off, so the table itself isn't read directly
    if t = 'predictors' then execute format('grant select on public.%I to authenticated', t); end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.predictors'::regclass and tgname = 'predictors_stamp_league') then
    create trigger predictors_stamp_league before insert on public.predictors for each row execute function public._stamp_league();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.predictor_picks'::regclass and tgname = 'predictor_picks_stamp_league') then
    create trigger predictor_picks_stamp_league before insert on public.predictor_picks for each row execute function public._stamp_league();
  end if;
end $$;

-- a call's points: the exact score 3, the right result 1, nothing else; a banker doubles it
create or replace function public._predictor_points(ph int, pa int, h int, a int, bank boolean) returns int
language sql immutable set search_path = public as $$
  select (case when ph = h and pa = a then 3 when sign(ph - pa) = sign(h - a) then 1 else 0 end) * case when bank then 2 else 1 end
$$;

-- the matchweek in play: the first from the start with a match not yet done; the last one once they all are
create or replace function public._predictor_week(p_predictor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(f.gameweek) from fixtures f join predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw and f.state not in ('final', 'postponed', 'cancelled')),
    (select max(f.gameweek) from fixtures f join predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw))
$$;
revoke execute on function public._predictor_week(bigint) from public, anon, authenticated;

-- the host starts one (one at a time per pool), from the next matchweek by default
create or replace function public.predictor_start(p_competition text, p_start_gw int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare sid bigint; gw int;
begin
  perform _commish();
  if not exists (select 1 from competitions where id = p_competition) then raise exception 'No such competition'; end if;
  if exists (select 1 from predictors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a score predictor running'; end if;
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No matchweek to start from yet'; end if;
  insert into predictors (competition, start_gw, created_by) values (p_competition, gw, my_team()) returning id into sid;
  perform _sys('general', format('🎯 Call the score starts in matchweek %s of the %s: call every match. The exact score is 3 points, the right result 1, and your banker counts double.',
    gw, (select name from competitions where id = p_competition)), jsonb_build_object('predictor', sid));
  return sid;
end $$;
revoke execute on function public.predictor_start(text, int) from public, anon;
grant execute on function public.predictor_start(text, int) to authenticated;

-- a player saves their calls for a matchweek ([{fixture, home, away}]) and, if they say, which one is the banker.
-- A match that has kicked off keeps the call it had; the rest are saved. Returns how many were saved.
create or replace function public.predictor_save(p_predictor bigint, p_gameweek int, p_picks jsonb, p_banker bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare s predictors; me int := _team(); x jsonb; fx fixtures; n int := 0; h int; a int; cur_bank record;
begin
  perform _in_league('predictors', p_predictor);
  select * into s from predictors where id = p_predictor;
  if s.id is null or s.status <> 'open' then raise exception 'That one is over'; end if;
  if me is null or (select role from teams where id = me) <> 'gm' then raise exception 'Only players call scores'; end if;
  if p_gameweek < s.start_gw then raise exception 'That matchweek is before this one started'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_picks, '[]')) loop
    select * into fx from fixtures where id = (x->>'fixture')::bigint and competition = s.competition and gameweek = p_gameweek;
    if fx.id is null then raise exception 'That match isn''t in matchweek %', p_gameweek; end if;
    if fx.kickoff <= now() or fx.state not in ('scheduled', 'postponed') then continue; end if;
    h := (x->>'home')::int; a := (x->>'away')::int;
    if h is null or a is null or h not between 0 and 20 or a not between 0 and 20 then raise exception 'A score is a number from 0 to 20'; end if;
    insert into predictor_picks (predictor_id, team_id, fixture_id, gameweek, home, away)
    values (p_predictor, me, fx.id, p_gameweek, h, a)
    on conflict (predictor_id, team_id, fixture_id) do update set home = excluded.home, away = excluded.away, picked_at = now();
    n := n + 1;
  end loop;
  if p_banker is not null then
    select p.fixture_id, f.kickoff into cur_bank from predictor_picks p join fixtures f on f.id = p.fixture_id
    where p.predictor_id = p_predictor and p.team_id = me and p.gameweek = p_gameweek and p.banker;
    if cur_bank.fixture_id is distinct from p_banker then
      if cur_bank.fixture_id is not null and cur_bank.kickoff <= now() then raise exception 'Your banker has kicked off; it stands'; end if;
      select * into fx from fixtures where id = p_banker and competition = s.competition and gameweek = p_gameweek;
      if fx.id is null or fx.kickoff <= now() then raise exception 'Pick a banker that hasn''t kicked off'; end if;
      if not exists (select 1 from predictor_picks where predictor_id = p_predictor and team_id = me and fixture_id = p_banker) then
        raise exception 'Call that match''s score first';
      end if;
      update predictor_picks set banker = false where predictor_id = p_predictor and team_id = me and gameweek = p_gameweek and banker;
      update predictor_picks set banker = true where predictor_id = p_predictor and team_id = me and fixture_id = p_banker;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.predictor_save(bigint, int, jsonb, bigint) from public, anon;
grant execute on function public.predictor_save(bigint, int, jsonb, bigint) to authenticated;

-- the board for a matchweek (the one in play unless p_gameweek says which): its matches with your calls and, once a
-- match kicks off, everyone's; the season table; and the matchweek's own table
create or replace function public.predictor_board(p_predictor bigint, p_gameweek int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s predictors; gw int; cur int; me int := _team();
begin
  perform _in_league('predictors', p_predictor);
  select * into s from predictors where id = p_predictor and league_id = current_league_id();
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
                 from predictor_picks p where p.predictor_id = s.id and p.team_id = me and p.fixture_id = f.id),
        -- everyone's calls, once the match has kicked off
        'calls', case when f.kickoff <= now() or f.state <> 'scheduled' then coalesce((select jsonb_agg(jsonb_build_object(
            'team_id', p.team_id, 'home', p.home, 'away', p.away, 'banker', p.banker, 'points', p.points) order by p.points desc nulls last, p.team_id)
          from predictor_picks p where p.predictor_id = s.id and p.fixture_id = f.id), '[]') end) order by f.kickoff, f.id)
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
            left join predictor_picks p on p.predictor_id = s.id and p.team_id = tm.id
            left join fixtures f on f.id = p.fixture_id
            where tm.league_id = s.league_id and tm.role = 'gm'
            group by tm.id, tm.gm_name) t), '[]'));
end $$;
revoke execute on function public.predictor_board(bigint, int) from public, anon;
grant execute on function public.predictor_board(bigint, int) to authenticated;

-- the pool's score predictor, if it has one (the newest)
create or replace function public.predictor_current() returns bigint
language sql stable security definer set search_path = public as $$
  select id from predictors where league_id = current_league_id() order by (status = 'open') desc, id desc limit 1
$$;
revoke execute on function public.predictor_current() from public, anon;
grant execute on function public.predictor_current() to authenticated;

-- a result comes in (or is corrected): score every call on that match, then tell the pool when its matchweek is done
create or replace function public._predictor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; s record; h int; a int; top record; lead record; last_gw int;
begin
  if new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  if new.state = old.state and new.home_ft is not distinct from old.home_ft and new.away_ft is not distinct from old.away_ft
     and new.home_score is not distinct from old.home_score and new.away_score is not distinct from old.away_score then return new; end if;
  if new.state = 'final' then
    h := coalesce(new.home_ft, new.home_score); a := coalesce(new.away_ft, new.away_score);
    if h is null or a is null then return new; end if;
    update predictor_picks set points = _predictor_points(home, away, h, a, banker), void = false where fixture_id = new.id;
    -- a spot-on call hears about it, once
    if old.state <> 'final' then
      for p in select pp.team_id, pp.banker from predictor_picks pp join predictors pr on pr.id = pp.predictor_id
               where pp.fixture_id = new.id and pp.home = h and pp.away = a and pr.status = 'open' loop
        perform _pool_alert(p.team_id, 'predictor', format('🎯 Spot on: %s %s-%s %s. +%s%s', (select name from clubs where id = new.home_club), h, a,
          (select name from clubs where id = new.away_club), case when p.banker then 6 else 3 end, case when p.banker then ' with your banker' else '' end), '/predictor');
      end loop;
    end if;
  else
    update predictor_picks set points = 0, void = true where fixture_id = new.id;
  end if;
  -- each open predictor on this competition whose matchweek is now done and not yet announced
  for s in select * from predictors where competition = new.competition and status = 'open' and new.gameweek >= start_gw
             and not (new.gameweek = any (posted)) loop
    if exists (select 1 from fixtures where competition = s.competition and gameweek = new.gameweek and state not in ('final', 'postponed', 'cancelled')) then continue; end if;
    select string_agg(x.gm_name, ' and ' order by x.gm_name) names, max(x.pts) pts, count(*) n into top
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id and pp.gameweek = new.gameweek group by tm.id, tm.gm_name) x where x.rk = 1 and x.pts > 0;
    select string_agg(x.gm_name, ' and ' order by x.gm_name) names, max(x.pts) pts into lead
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id group by tm.id, tm.gm_name) x where x.rk = 1 and x.pts > 0;
    last_gw := (select max(gameweek) from fixtures where competition = s.competition);
    update predictors set posted = posted || new.gameweek where id = s.id;
    if new.gameweek >= last_gw and lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Call the score is done: %s, %s points over the season.', lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', new.gameweek), s.league_id);
    elsif top.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🎯 Matchweek %s is done. Top of the week: %s with %s %s. Leading the table: %s on %s.', new.gameweek, top.names, top.pts,
               case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', new.gameweek), s.league_id);
    end if;
    if top.names is not null then
      for p in select pp.team_id from predictor_picks pp where pp.predictor_id = s.id and pp.gameweek = new.gameweek
               group by pp.team_id having sum(pp.points) = top.pts loop
        perform _pool_alert(p.team_id, 'predictor', format('🏅 You won matchweek %s with %s %s.', new.gameweek, top.pts, case when top.pts = 1 then 'point' else 'points' end), '/predictor');
      end loop;
    end if;
    if new.gameweek >= last_gw then
      update predictors set status = 'done', winners = array(
        select team_id from predictor_picks where predictor_id = s.id group by team_id
        having sum(points) = (select max(t) from (select sum(points) t from predictor_picks where predictor_id = s.id group by team_id) z) and sum(points) > 0)
      where id = s.id;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._predictor_settle_fixture() from public, anon, authenticated;
drop trigger if exists fixtures_predictor_settle on public.fixtures;
create trigger fixtures_predictor_settle after update of state, home_ft, away_ft, home_score, away_score on public.fixtures
  for each row execute function public._predictor_settle_fixture();

-- ───────────── the matchweek reminder ─────────────
-- once per player per game per matchweek, when its first kick-off is under six hours away: matches still to call, or no
-- survivor pick while still in
create table if not exists private.soccer_nudged (
  game text not null,             -- 'predictor' or 'survivor'
  game_id bigint not null,
  team_id int not null,
  gameweek int not null,
  at timestamptz not null default now(),
  primary key (game, game_id, team_id, gameweek)
);
revoke all on private.soccer_nudged from public, anon, authenticated;

create or replace function public._soccer_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g record; t record; n int := 0; gw int; first_ko timestamptz; total int; called int; hrs text;
begin
  for g in select 'predictor' game, id, competition, status from predictors where league_id = p_league and status = 'open'
           union all select 'survivor', id, competition, status from survivors where league_id = p_league and status = 'open' loop
    gw := case when g.game = 'predictor' then _predictor_week(g.id) else _survivor_week(g.id) end;
    if gw is null then continue; end if;
    select min(kickoff), count(*) into first_ko, total from fixtures where competition = g.competition and gameweek = gw and state = 'scheduled' and kickoff > now();
    if first_ko is null or first_ko > now() + interval '6 hours'
       or exists (select 1 from fixtures where competition = g.competition and gameweek = gw and kickoff <= now()) then continue; end if;
    hrs := case when first_ko - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from first_ko - now()) / 3600))::int || 'h' end;
    for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
               and not exists (select 1 from private.soccer_nudged x where x.game = g.game and x.game_id = g.id and x.team_id = tm.id and x.gameweek = gw) loop
      if g.game = 'predictor' then
        called := (select count(*) from predictor_picks where predictor_id = g.id and team_id = t.id and gameweek = gw);
        if called >= total then continue; end if;
        perform _pool_alert(t.id, 'predictor', format('⏰ Matchweek %s kicks off in %s. %s', gw, hrs,
          case when called = 0 then format('Call the score: %s matches to call.', total) else format('You have %s of %s matches still to call.', total - called, total) end), '/predictor');
      else
        if not _survivor_alive(g.id, t.id) or exists (select 1 from survivor_picks where survivor_id = g.id and team_id = t.id and gameweek = gw) then continue; end if;
        perform _pool_alert(t.id, 'survivor', format('⏰ Matchweek %s kicks off in %s. Pick your club to stay in.', gw, hrs), '/survivor');
      end if;
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.game, g.id, t.id, gw) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._soccer_nudge(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
