-- Last one standing (docs/POOLS.md section 7, P3): a survivor game inside a prediction pool. The host starts it on a
-- competition from a matchweek; every matchweek each player still in picks one club to win; a club can be picked only
-- once all season; a draw or a loss puts the player out, and so does a matchweek with no pick. The last one in wins it
-- (if everyone left goes out the same week, they share it). Picks lock at their match's kick-off and settle from the
-- full-time score (ninety minutes, the way result questions read) the moment the result comes in, through a trigger on
-- fixtures, so it needs no schedule of its own. A postponed or cancelled match voids the pick: the player is through
-- and keeps the club unused. Runs on the fixtures soccer-sync keeps, so it starts once the API-Football key is set.

create table if not exists public.survivors (
  id bigint generated always as identity primary key,
  league_id int not null default current_league_id() references public.leagues (id),
  competition text not null references public.competitions (id),
  start_gw int not null,
  status text not null default 'open' check (status in ('open', 'done')),
  winners int[],
  created_by int references public.teams (id),
  created_at timestamptz not null default now()
);
create index if not exists survivors_league on public.survivors (league_id);

create table if not exists public.survivor_picks (
  id bigint generated always as identity primary key,
  survivor_id bigint not null references public.survivors (id) on delete cascade,
  league_id int not null default current_league_id() references public.leagues (id),
  team_id int not null references public.teams (id),
  gameweek int not null,
  club_id bigint references public.clubs (id),                 -- null: the matchweek went by with no pick
  fixture_id bigint references public.fixtures (id),
  result text check (result in ('through', 'out', 'missed', 'void')),
  picked_at timestamptz not null default now(),
  unique (survivor_id, team_id, gameweek)
);
create unique index if not exists survivor_picks_club_once on public.survivor_picks (survivor_id, team_id, club_id) where club_id is not null and result is distinct from 'void';
create index if not exists survivor_picks_fixture on public.survivor_picks (fixture_id) where result is null;

do $$ declare t text; begin
  foreach t in array array['survivors', 'survivor_picks'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = format('public.%I', t)::regclass and polname = 'league_read') then
      execute format('create policy league_read on public.%I for select to authenticated using (league_id = (select current_league_id()))', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.survivors'::regclass and tgname = 'survivors_stamp_league') then
    create trigger survivors_stamp_league before insert on public.survivors for each row execute function public._stamp_league();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.survivor_picks'::regclass and tgname = 'survivor_picks_stamp_league') then
    create trigger survivor_picks_stamp_league before insert on public.survivor_picks for each row execute function public._stamp_league();
  end if;
end $$;

-- the matchweek now in play: the first from the start whose matches are not all done
create or replace function public._survivor_week(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select min(f.gameweek) from fixtures f join survivors s on s.competition = f.competition
  where s.id = p_survivor and f.gameweek >= s.start_gw and f.state not in ('final', 'postponed', 'cancelled')
$$;

-- still in: no pick that put them out, and a pick in every matchweek already played (someone who joined the pool after
-- it started missed those, so the next one is theirs)
create or replace function public._survivor_alive(p_survivor bigint, p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = p_team and result in ('out', 'missed'))
    and (select count(*) from survivor_picks where survivor_id = p_survivor and team_id = p_team)
        >= (select count(distinct f.gameweek) from fixtures f join survivors s on s.competition = f.competition
            where s.id = p_survivor and f.gameweek >= s.start_gw and f.gameweek < coalesce(_survivor_week(p_survivor), 2147483647))
$$;
revoke execute on function public._survivor_week(bigint) from public, anon, authenticated;
revoke execute on function public._survivor_alive(bigint, int) from public, anon, authenticated;

-- the host starts one (one at a time per pool), from the next matchweek by default
create or replace function public.survivor_start(p_competition text, p_start_gw int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare sid bigint; gw int;
begin
  perform _commish();
  if not exists (select 1 from competitions where id = p_competition) then raise exception 'No such competition'; end if;
  if exists (select 1 from survivors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a survivor running'; end if;
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No matchweek to start from yet'; end if;
  insert into survivors (competition, start_gw, created_by) values (p_competition, gw, my_team()) returning id into sid;
  perform _sys('general', format('🛡️ Last one standing starts in matchweek %s of the %s: pick one club to win each week, never the same club twice. A draw or a loss and you''re out.',
    gw, (select name from competitions where id = p_competition)), jsonb_build_object('survivor', sid));
  return sid;
end $$;
revoke execute on function public.survivor_start(text, int) from public, anon;
grant execute on function public.survivor_start(text, int) to authenticated;

-- a player picks (or changes) this matchweek's club, until that club's match kicks off
create or replace function public.survivor_pick(p_survivor bigint, p_club bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s survivors; me int := _team(); gw int; fx fixtures; cur survivor_picks;
begin
  perform _in_league('survivors', p_survivor);
  select * into s from survivors where id = p_survivor;
  if s.id is null or s.status <> 'open' then raise exception 'That survivor is over'; end if;
  if me is null or (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if not _survivor_alive(p_survivor, me) then
    if not exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = me) then raise exception 'This one started before you joined; the next one is yours'; end if;
    raise exception 'You''re out of this one';
  end if;
  gw := _survivor_week(p_survivor);
  if gw is null then raise exception 'No matchweek to pick in'; end if;
  select * into fx from fixtures where competition = s.competition and gameweek = gw and (home_club = p_club or away_club = p_club)
    and state = 'scheduled' order by kickoff limit 1;
  if fx.id is null then raise exception 'That club doesn''t play this matchweek'; end if;
  if fx.kickoff <= now() then raise exception 'That match has kicked off'; end if;
  select * into cur from survivor_picks where survivor_id = p_survivor and team_id = me and gameweek = gw;
  if cur.id is not null and (select kickoff from fixtures where id = cur.fixture_id) <= now() then raise exception 'Your pick has kicked off; it stands'; end if;
  if exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = me and club_id = p_club and gameweek <> gw and result is distinct from 'void') then
    raise exception 'You''ve used that club already';
  end if;
  insert into survivor_picks (survivor_id, team_id, gameweek, club_id, fixture_id) values (p_survivor, me, gw, p_club, fx.id)
  on conflict (survivor_id, team_id, gameweek) do update set club_id = excluded.club_id, fixture_id = excluded.fixture_id, picked_at = now();
end $$;
revoke execute on function public.survivor_pick(bigint, bigint) from public, anon;
grant execute on function public.survivor_pick(bigint, bigint) to authenticated;

-- the board: every player with their picks, still in or out, and the matchweek's fixtures for picking
create or replace function public.survivor_board(p_survivor bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s survivors; gw int;
begin
  perform _in_league('survivors', p_survivor);
  select * into s from survivors where id = p_survivor and league_id = current_league_id();
  if s.id is null then return null; end if;
  gw := _survivor_week(p_survivor);
  return jsonb_build_object(
    'id', s.id, 'competition', s.competition, 'competition_name', (select name from competitions where id = s.competition),
    'start_gw', s.start_gw, 'status', s.status, 'winners', to_jsonb(s.winners), 'gameweek', gw,
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state,
        'home', jsonb_build_object('id', h.id, 'name', h.name, 'short', h.short, 'logo', h.logo),
        'away', jsonb_build_object('id', a.id, 'name', a.name, 'short', a.short, 'logo', a.logo),
        'home_score', f.home_ft, 'away_score', f.away_ft) order by f.kickoff)
      from fixtures f join clubs h on h.id = f.home_club join clubs a on a.id = f.away_club
      where f.competition = s.competition and f.gameweek = gw), '[]'),
    'players', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'alive', _survivor_alive(s.id, t.id),
        'out_gw', (select min(p.gameweek) from survivor_picks p where p.survivor_id = s.id and p.team_id = t.id and p.result in ('out', 'missed')),
        'picks', coalesce((select jsonb_agg(jsonb_build_object('gameweek', p.gameweek, 'club_id', p.club_id, 'short', c.short, 'name', c.name, 'logo', c.logo,
            'result', p.result, 'locked', coalesce(f.kickoff <= now(), true)) order by p.gameweek)
          from survivor_picks p left join clubs c on c.id = p.club_id left join fixtures f on f.id = p.fixture_id
          where p.survivor_id = s.id and p.team_id = t.id
            -- another player's pick shows once it has kicked off; your own always
            and (t.id = _team() or f.kickoff <= now() or p.result is not null)), '[]'))
        order by _survivor_alive(s.id, t.id) desc, t.gm_name)
      from teams t where t.league_id = s.league_id and t.role = 'gm'), '[]'));
end $$;
revoke execute on function public.survivor_board(bigint) from public, anon;
grant execute on function public.survivor_board(bigint) to authenticated;

-- the pool's survivor, if it has one (the newest)
create or replace function public.survivor_current() returns bigint
language sql stable security definer set search_path = public as $$
  select id from survivors where league_id = current_league_id() order by (status = 'open') desc, id desc limit 1
$$;
revoke execute on function public.survivor_current() from public, anon;
grant execute on function public.survivor_current() to authenticated;

-- a result comes in: settle the picks on that match, then close out the matchweek if it is done
create or replace function public._survivor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; won boolean; s record; gw_done boolean; alive int; t record; opp text;
begin
  if new.state = old.state or new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  for p in select sp.*, c.name club from survivor_picks sp join clubs c on c.id = sp.club_id where sp.fixture_id = new.id and sp.result is null loop
    if new.state <> 'final' then
      update survivor_picks set result = 'void' where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', format('🛡️ %s''s match was called off, so you''re through and keep %s for later.', p.club, p.club), '/survivor');
    else
      won := case when p.club_id = new.home_club then coalesce(new.home_ft, new.home_score) > coalesce(new.away_ft, new.away_score)
                  else coalesce(new.away_ft, new.away_score) > coalesce(new.home_ft, new.home_score) end;
      opp := (select name from clubs where id = case when p.club_id = new.home_club then new.away_club else new.home_club end);
      update survivor_picks set result = case when won then 'through' else 'out' end where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', case when won
        then format('🛡️ Through: %s beat %s %s-%s.', p.club, opp, greatest(coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)), least(coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)))
        else format('💥 Out: %s didn''t beat %s (%s-%s).', p.club, opp, coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)) end, '/survivor');
    end if;
  end loop;
  -- every open survivor on this competition whose matchweek is now done: no pick means out, then is anyone left?
  for s in select * from survivors where competition = new.competition and status = 'open' and new.gameweek >= start_gw loop
    gw_done := not exists (select 1 from fixtures where competition = s.competition and gameweek = new.gameweek and state not in ('final', 'postponed', 'cancelled'));
    if not gw_done then continue; end if;
    -- those still in going into this matchweek (never out, a pick in every week before it) who made no pick in it
    for t in select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm'
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and result in ('out', 'missed'))
             and (select count(*) from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek < new.gameweek)
                 >= (select count(distinct gameweek) from fixtures where competition = s.competition and gameweek >= s.start_gw and gameweek < new.gameweek)
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek = new.gameweek) loop
      insert into survivor_picks (survivor_id, league_id, team_id, gameweek, result) values (s.id, s.league_id, t.id, new.gameweek, 'missed');
      perform _pool_alert(t.id, 'survivor', format('💥 Out: no pick in matchweek %s.', new.gameweek), '/survivor');
    end loop;
    alive := (select count(*) from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id));
    if alive <= 1 then
      -- one left wins it; nobody left: those who went out this week share it
      update survivors set status = 'done', winners = case when alive = 1
          then array(select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id))
          else array(select distinct team_id from survivor_picks where survivor_id = s.id and gameweek = new.gameweek and result in ('out', 'missed')) end
      where id = s.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Last one standing: %s.', (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from survivors sv join teams tm on tm.id = any (sv.winners) where sv.id = s.id)),
        jsonb_build_object('survivor', s.id), s.league_id);
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._survivor_settle_fixture() from public, anon, authenticated;
drop trigger if exists fixtures_survivor_settle on public.fixtures;
create trigger fixtures_survivor_settle after update of state on public.fixtures
  for each row execute function public._survivor_settle_fixture();
