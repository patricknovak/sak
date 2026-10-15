-- Lives in last one standing (docs/POOL-TYPES.md §2.5, 15 October 2026): the survivor knob Yahoo and ESPN offer as
-- strikes. A survivor started with `lives` 2 or 3 costs a life for each loss, tie (or draw) or round with no pick, and
-- a member is out only when the last is gone; one life stays the default, as before. Everything that asked "has this
-- member lost?" now asks "has this member lost them all?" (`_survivor_alive`, the settle, the board, the scoreboard),
-- and the round a member went out is the round of their last life (`_survivor_out_gw`).

-- a survivor's lives (one unless it says)
create or replace function public._survivor_lives(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (rules->>'lives')::int from pool_games where id = p_survivor), 1)
$$;
revoke execute on function public._survivor_lives(bigint) from public, anon, authenticated;

-- the round a member's last life went (null while they have one)
create or replace function public._survivor_out_gw(p_survivor bigint, p_team int) returns int
language sql stable security definer set search_path = public as $$
  select gameweek from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team and result in ('out', 'missed')
  order by gameweek offset _survivor_lives(p_survivor) - 1 limit 1
$$;
revoke execute on function public._survivor_out_gw(bigint, int) from public, anon, authenticated;

-- a survivor started with its lives: the old three-argument start goes (its callers below pass the lives)
drop function if exists public._survivor_create(text, int, int);
create or replace function public._survivor_create(p_competition text, p_start_gw int, p_end_gw int, p_lives int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare c competitions; sid bigint; gw int; last_gw int; end_gw int; w text; club text; draws boolean; lives int := coalesce(p_lives, 1);
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition'; end if;
  -- a tournament of single games (March Madness, the NFL's playoffs) is played in rounds too: each game carries its round
  if exists (select 1 from series where competition = p_competition and best_of > 1) then raise exception 'Last one standing runs on rounds of single games'; end if;
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
  -- a tournament's later rounds have no games until their matchups are set, so it runs to its last round
  last_gw := coalesce((select max(round) from series where competition = p_competition), (select max(gameweek) from fixtures where competition = p_competition));
  end_gw := coalesce(p_end_gw, last_gw);
  if end_gw < gw or end_gw > last_gw then raise exception 'No such %', lower(w); end if;
  -- lives (migration 288): out on the first loss by default, or the second or third
  if lives not between 1 and 3 then raise exception 'One, two or three lives'; end if;
  insert into pool_games (kind, competition, title, rules, created_by)
  values ('survivor', p_competition, 'Last one standing', jsonb_build_object('start_gw', gw, 'end_gw', end_gw)
            || case when lives > 1 then jsonb_build_object('lives', lives) else '{}'::jsonb end, my_team()) returning id into sid;
  perform _sys('general', format('🛡️ Last one standing starts in %s %s of the %s: pick one %s to win each %s, never the same %s twice. %s.%s',
    lower(w), gw, c.name, club, lower(w), club,
    case when lives > 1 then format('%s, or no pick, costs one of your %s lives; lose them all and you''re out', case when draws then 'A draw or a loss' else 'A loss or a tie' end, lives)
         else format('%s and you''re out', case when draws then 'A draw or a loss' else 'A loss or a tie' end) end,
    case when end_gw > gw then format(' It runs to %s %s; whoever is still in then shares it.', lower(w), end_gw) else '' end),
    jsonb_build_object('survivor', sid));
  return sid;
end $$;
revoke execute on function public._survivor_create(text, int, int, int) from public, anon, authenticated;

create or replace function public._survivor_alive(p_survivor bigint, p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  -- still has a life (migration 288: one by default), and a pick in every round played since the start
  select (select count(*) from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team and result in ('out', 'missed'))
         < _survivor_lives(p_survivor)
    and (select count(*) from pool_survivor_picks where survivor_id = p_survivor and team_id = p_team)
        >= (select count(distinct f.gameweek) from fixtures f join pool_survivors s on s.competition = f.competition
            where s.id = p_survivor and f.gameweek >= s.start_gw
              and f.gameweek < coalesce(_survivor_week(p_survivor), _survivor_end(p_survivor) + 1))
$$;

create or replace function public._survivor_settle(p_league int, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f fixtures; x record; o pool_result_overrides; p record; won boolean; s record; gw_done boolean; alive int; t record;
  opp text; ended boolean; h int; a int; left_ int;
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
      -- with lives to spare a loss costs one (migration 288)
      left_ := _survivor_lives(p.survivor_id) - (select count(*) from pool_survivor_picks where survivor_id = p.survivor_id and team_id = p.team_id and result in ('out', 'missed'));
      perform _pool_alert(p.team_id, 'survivor', case
        when won and h is not null then format('🛡️ Through: %s beat %s %s-%s.', p.club, opp, greatest(h, a), least(h, a))
        when won then format('🛡️ Through: %s beat %s (settled by the host).', p.club, opp)
        when left_ > 0 and h is not null then format('💔 A life gone: %s didn''t beat %s (%s-%s). %s left.', p.club, opp, h, a, case when left_ = 1 then 'One life' else left_ || ' lives' end)
        when left_ > 0 then format('💔 A life gone: %s didn''t beat %s (settled by the host). %s left.', p.club, opp, case when left_ = 1 then 'One life' else left_ || ' lives' end)
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
             and (select count(*) from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and result in ('out', 'missed')) < _survivor_lives(s.id)
             and (select count(*) from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek < f.gameweek)
                 >= (select count(distinct gameweek) from fixtures where competition = s.competition and gameweek >= s.start_gw and gameweek < f.gameweek)
             and not exists (select 1 from pool_survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek = f.gameweek) loop
      insert into pool_picks (game_id, league_id, team_id, thing, pick)
      values (s.id, s.league_id, t.id, 'gw:' || f.gameweek, '{"club": null, "fixture": null, "result": "missed"}');
      left_ := _survivor_lives(s.id) - (select count(*) from pool_survivor_picks where survivor_id = s.id and team_id = t.id and result in ('out', 'missed'));
      perform _pool_alert(t.id, 'survivor', case when left_ > 0
        then format('💔 No pick in %s %s cost a life. %s left.', lower(_round_word(s.competition)), f.gameweek, case when left_ = 1 then 'One life' else left_ || ' lives' end)
        else format('💥 Out: no pick in %s %s.', lower(_round_word(s.competition)), f.gameweek) end, '/survivor');
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
    'lives', _survivor_lives(s.id),
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
        'out_gw', _survivor_out_gw(s.id, t.id),
        'lives_left', greatest(0, _survivor_lives(s.id) - (select count(*) from pool_survivor_picks p where p.survivor_id = s.id and p.team_id = t.id and p.result in ('out', 'missed')))::int,
        'picks', coalesce((select jsonb_agg(jsonb_build_object('gameweek', p.gameweek, 'club_id', p.club_id, 'short', c.short, 'name', c.name, 'logo', c.logo,
            'result', p.result, 'locked', coalesce(f.kickoff <= now(), true)) order by p.gameweek)
          from pool_survivor_picks p left join clubs c on c.id = p.club_id left join fixtures f on f.id = p.fixture_id
          where p.survivor_id = s.id and p.team_id = t.id
            -- another player's pick shows once it has kicked off; your own always
            and (t.id = _team() or f.kickoff <= now() or p.result is not null)), '[]'))
        order by _survivor_alive(s.id, t.id) desc, t.gm_name)
      from teams t where t.league_id = s.league_id and t.role = 'gm'), '[]'));
end $$;

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
        when 'sweep' then case when t.picked = 0 and g.rules ? 'deal' then 'Joined after the draw' when t.picked = 0 then 'In the hat' when t.right_calls > 0 then format('%s of %s club%s still in', t.right_calls, t.picked, case when t.picked = 1 then '' else 's' end)
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
      case when g.status = 'done' and x.alive then 'Won it'
           when x.alive and _survivor_lives(g.id) > 1 then format('Still in, %s', case when x.lives_left = 1 then 'one life left' else x.lives_left || ' lives left' end)
           when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in %s %s', lower(_round_word(g.competition)), x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            _survivor_out_gw(g.id, tm.id) out_gw,
            greatest(0, _survivor_lives(g.id) - (select count(*) from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')))::int lives_left
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

create or replace function public.pool_game_start(p_kind text, p_competition text, p_rules jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_kind = 'survivor' then
    return _survivor_create(p_competition, (p_rules->>'from_round')::int, (p_rules->>'to_round')::int, (p_rules->>'lives')::int);
  end if;
  if p_kind = 'score' then return predictor_start(p_competition, (p_rules->>'from_round')::int); end if;
  return _pool_game_create(p_kind, p_competition, p_rules);
end $$;

create or replace function public.pool_start_games(p_league int, p_games jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; ids bigint[] := '{}';
begin
  if auth.uid() is null or not exists (select 1 from teams where league_id = p_league and user_id = auth.uid() and is_commish) then
    raise exception 'Only the pool''s host starts its games';
  end if;
  if (select created_at from leagues where id = p_league) < now() - interval '1 day' then raise exception 'Add games from the Host page'; end if;
  perform set_config('app.league_id', p_league::text, true);
  if current_league_id() <> p_league then raise exception 'Could not open that pool'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_games, '[]')) loop
    ids := ids || case
      when x->>'kind' = 'survivor' then _survivor_create(x->>'competition', (x->'rules'->>'from_round')::int, (x->'rules'->>'to_round')::int, (x->'rules'->>'lives')::int)
      when x->>'kind' = 'score' then predictor_start(x->>'competition', (x->'rules'->>'from_round')::int)
      else _pool_game_create(x->>'kind', x->>'competition', (x->'rules') - 'auto'::text) end;
    -- a sheet on every game of the event from here on, the ones due now opened at once
    if x->>'kind' = 'props' and coalesce((x->'rules'->>'auto')::boolean, false) then
      insert into pool_auto_sheets (competition, by_team)
      values (x->>'competition', (select id from teams where league_id = p_league and user_id = auth.uid() and is_commish limit 1)) on conflict do nothing;
      perform _props_auto(p_league);
    end if;
  end loop;
  return to_jsonb(ids);
end $$;
