-- Fixes from a seventh review (migration 237), none severe:
-- * A sweepstake drawn before 237 (none on live) reads its number of series from the event, so it can still be crowned.
-- * A streak pick filed under a day whose game the feed moved elsewhere no longer holds that day once its game starts:
--   it moves with its game, and a day with a pick of its own keeps that one.
-- * The streak board shows the pick that counts (the one filed under the day first), as `_streak_picks` does.
-- * The quiet week before a streak closes applies to a season of rounds only; a postseason closes once its one-series
--   last round is decided.
-- * The sweepstake's refusal says why when a later round isn't filed yet, and the game list says whether the hat is drawn.
-- Safe to run twice.

create or replace function public._sweep_champion(p_game bigint) returns bigint
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and rules ? 'deal'),
  done as (select count(*) n from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
           and s.state = 'final' and s.winner is not null),
  open as (select count(*) n from series s, g where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
           and not (s.state = 'final' and s.winner is not null))
  select case when (select n from done) >= (select coalesce((rules->>'series_n')::int, (select sh.series_n from _sweep_shape(g.competition, (g.rules->>'from_round')::int) sh)) from g) and (select n from open) = 0
              and (select count(*) from _sweep_clubs(p_game) c where c.alive) = 1
         then (select c.club from _sweep_clubs(p_game) c where c.alive) end
$$;
revoke execute on function public._sweep_champion(bigint) from public, anon, authenticated;

create or replace function public._pool_game_pick_as(p_team int, p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int; t record; fr int; lens jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if p_thing like 's:%' and g.kind = 'series' then
    select * into s from series where id = substr(p_thing, 3)::bigint and competition = g.competition;
    if s.id is null or s.round < (g.rules->>'from_round')::int then raise exception 'That series isn''t in this game'; end if;
    if s.high_club is null or s.low_club is null then raise exception 'That series isn''t set yet'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; picks are locked'; end if;
    w := (p_pick->>'winner')::bigint; n := (p_pick->>'games')::int;
    if w not in (s.high_club, s.low_club) then raise exception 'Pick one of the two clubs'; end if;
    if n is null or n not between (s.best_of / 2 + 1) and s.best_of then raise exception 'A best-of-% goes % to % games', s.best_of, s.best_of / 2 + 1, s.best_of; end if;
    p_pick := jsonb_build_object('winner', w, 'games', n);
  elsif p_thing = 'rank' and g.kind = 'rank' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first %', _sport_word(g.competition, 'start', 'start'); end if;
    ord := '[]';
    for v in select jsonb_array_elements_text(coalesce(p_pick->'order', '[]')) loop
      if not exists (select 1 from series where competition = g.competition and v::bigint in (high_club, low_club)) then raise exception 'That club isn''t in this event'; end if;
      if ord @> to_jsonb(v::bigint) then raise exception 'Each club once'; end if;
      ord := ord || to_jsonb(v::bigint);
    end loop;
    if jsonb_array_length(ord) < 2 then raise exception 'Put the clubs in order'; end if;
    p_pick := jsonb_build_object('order', ord);
  elsif p_thing = 'bracket' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The bracket locked at the first game'; end if;
    fr := (g.rules->>'from_round')::int;
    -- round by round: a first-round winner is one of its two clubs, a later one a winner picked in a series before it
    ord := '{}';
    for t in select tr.series_id, tr.round, x.high_club, x.low_club from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id
             order by tr.round, tr.pos loop
      w := (p_pick->'winners'->>t.series_id::text)::bigint;
      if w is null then raise exception 'Pick a winner for every series'; end if;
      if t.round = fr then
        if w not in (t.high_club, t.low_club) then raise exception 'Pick one of the two clubs'; end if;
      elsif not exists (select 1 from _bracket_tree(g.competition, fr) b where b.next_id = t.series_id and (ord->>b.series_id::text)::bigint = w) then
        raise exception 'A winner goes on only from a series before it';
      end if;
      ord := ord || jsonb_build_object(t.series_id::text, w);
    end loop;
    -- and, where the host added a bonus for it, how many games each series goes (migration 228)
    lens := '{}';
    if coalesce((g.rules->>'games_bonus')::int, 0) > 0 then
      for t in select x.id, x.best_of from _bracket_tree(g.competition, fr) tr join series x on x.id = tr.series_id where x.best_of > 1 loop
        v := p_pick->'lengths'->>t.id::text;
        continue when v is null;
        if v !~ '^\d+$' or v::int not between t.best_of / 2 + 1 and t.best_of then
          raise exception 'A best-of-% goes % to % games', t.best_of, t.best_of / 2 + 1, t.best_of;
        end if;
        lens := lens || jsonb_build_object(t.id::text, v::int);
      end loop;
    end if;
    p_pick := jsonb_build_object('winners', ord) || case when lens <> '{}' then jsonb_build_object('lengths', lens) else '{}' end;
  elsif p_thing = 'box' and g.kind = 'players' then
    lock_at := _players_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'Teams locked at the first puck drop'; end if;
    -- one player from every box, in box order
    ord := '[]';
    for t in select b.v, (b.ord - 1)::int i from jsonb_array_elements(g.rules->'boxes') with ordinality b(v, ord) order by b.ord loop
      v := p_pick->'players'->>t.i;
      if v is null then raise exception 'Take a player from every box'; end if;
      if not (t.v->'players' @> to_jsonb(v::int)) then raise exception 'That player isn''t in %', t.v->>'label'; end if;
      ord := ord || to_jsonb(v::int);
    end loop;
    if jsonb_array_length(coalesce(p_pick->'players', '[]')) <> jsonb_array_length(ord) then raise exception 'One player from each box'; end if;
    p_pick := jsonb_build_object('players', ord);
  elsif p_thing = 'props' and g.kind = 'props' then
    if exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now())) then
      raise exception 'The sheet locked at the %', _sport_word(g.competition, 'start', 'start');
    end if;
    -- every call answered with one of its options, and the game's total for the tiebreak
    ord := '{}';
    for t in select q from jsonb_array_elements(g.rules->'questions') q loop
      v := p_pick->'answers'->>(t.q->>'key');
      if v is null then raise exception 'Make every call'; end if;
      if not exists (select 1 from jsonb_array_elements(t.q->'options') o where o->>'v' = v) then raise exception 'That isn''t one of the answers'; end if;
      ord := ord || jsonb_build_object(t.q->>'key', v);
    end loop;
    n := (p_pick->>'total')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('answers', ord, 'total', n);
  elsif p_thing = 'streak' and g.kind = 'streak' then
    -- one pick a day, on any game that day still to start; a day's pick moves until its game starts
    select f.id, f.kickoff, f.state, f.home_club, f.away_club into t from fixtures f
    where f.id = (p_pick->>'fixture')::bigint and f.competition = g.competition;
    if t.id is null or t.home_club is null or t.away_club is null then raise exception 'That game isn''t in this event'; end if;
    if t.state <> 'scheduled' or t.kickoff <= now() or not (select e.open from _pool_fixture(g.league_id, t.id) e) then
      raise exception 'That game has started; pick one still to come';
    end if;
    if not _streak_playable(t.id) then raise exception 'That game won''t be played: its series is over'; end if;
    p_thing := 'd:' || to_char(_streak_day(t.kickoff), 'YYYY-MM-DD');
    -- the day is the one the picked game is on now; it locks once that game is under way or over (one put off or
    -- voided frees it)
    if exists (select 1 from pool_picks pk join fixtures f on f.id = (pk.pick->>'fixture')::bigint
               cross join lateral _pool_fixture(g.league_id, f.id) e
               where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%'
                 and _streak_day(f.kickoff) = _streak_day(t.kickoff)
                 -- one under way or over holds the day; one put off, voided or not needed by its series frees it
                 and not (e.open or e.void or (f.state = 'scheduled' and not _streak_playable(f.id)))) then
      raise exception 'Your pick for that day has started; it stays';
    end if;
    -- a pick filed under this day whose game has moved to another goes with its game (unless that day has one)
    update pool_picks pk set thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD') from fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing = p_thing and f.id = (pk.pick->>'fixture')::bigint
      and _streak_day(f.kickoff) <> _streak_day(t.kickoff)
      and not exists (select 1 from pool_picks q where q.game_id = g.id and q.team_id = me and q.thing = 'd:' || to_char(_streak_day(f.kickoff), 'YYYY-MM-DD'));
    -- and a pick filed under another day whose game has moved onto this one gives way to this one
    delete from pool_picks pk using fixtures f
    where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%' and pk.thing <> p_thing
      and f.id = (pk.pick->>'fixture')::bigint and _streak_day(f.kickoff) = _streak_day(t.kickoff);
    v := p_pick->>'pick';
    if v is null or v not in ('H', 'A', 'D') or (v = 'D' and not coalesce((g.rules->>'draws')::boolean, false)) then
      raise exception 'Pick one of the two sides%', case when coalesce((g.rules->>'draws')::boolean, false) then ', or a draw' else '' end;
    end if;
    p_pick := jsonb_build_object('fixture', t.id, 'pick', v);
  elsif p_thing = 'tiebreak' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked with the bracket'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first % of the final round', _sport_word(g.competition, 'start', 'start'); end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
revoke execute on function public._pool_game_pick_as(int, bigint, text, jsonb) from public, anon, authenticated;

create or replace function public._streak_board(p_game bigint, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; t record;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'streak' then return null; end if;
  select * into t from _streak_table(g.id) x where x.team_id = p_me;
  return jsonb_build_object('draws', coalesce((g.rules->>'draws')::boolean, false),
    'best', coalesce(t.points, 0), 'current', coalesce(t.exact, 0), 'right', coalesce(t.right_calls, 0), 'picked', coalesce(t.picked, 0),
    'top', (select max(x.points) from _streak_table(g.id) x),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day,
        'mine', (select pk.pick from pool_picks pk join fixtures pf on pf.id = (pk.pick->>'fixture')::bigint
                 where pk.game_id = g.id and pk.team_id = p_me and pk.thing like 'd:%' and _streak_day(pf.kickoff) = d.day
                 order by (pk.thing = 'd:' || to_char(d.day, 'YYYY-MM-DD')) desc, pk.picked_at desc limit 1),
        'picked', (select count(distinct pk.team_id) from pool_picks pk join fixtures pf on pf.id = (pk.pick->>'fixture')::bigint
                   where pk.game_id = g.id and pk.thing like 'd:%' and _streak_day(pf.kickoff) = d.day),
        'games', (select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'minute', f.minute,
              'label', coalesce(x.short, nullif(f.round, ''), _round_word(g.competition) || ' ' || f.gameweek) || case when x.best_of > 1 then ' · Game ' || f.game_no else '' end,
              'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
              'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score),
              'result', e.res, 'void', e.void, 'locked', not e.open,
              -- who rode which side, once the game has started (never before: the picks would be a copy)
              'calls', case when not e.open then coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'pick', pk.pick->>'pick') order by pk.team_id)
                         from pool_picks pk where pk.game_id = g.id and pk.thing like 'd:%' and (pk.pick->>'fixture')::bigint = f.id), '[]') end)
            order by f.kickoff, f.id)
          from fixtures f left join series x on x.id = f.series_id cross join lateral _pool_fixture(g.league_id, f.id) e
          where f.competition = g.competition and _streak_day(f.kickoff) = d.day and f.home_club is not null and f.away_club is not null
            and (f.state <> 'scheduled' or _streak_playable(f.id))))
        order by d.day)
      from (select distinct _streak_day(f.kickoff) as day from fixtures f
            where f.competition = g.competition and _streak_day(f.kickoff) >= today_et() and f.home_club is not null and f.away_club is not null
              and f.state <> 'cancelled' and (f.state <> 'scheduled' or _streak_playable(f.id))
            order by 1 limit 3) d), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('day', p.day, 'pick', p.pick, 'right', p.is_right, 'void', p.void,
        'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
        'home_score', coalesce(f.home_ft, f.home_score), 'away_score', coalesce(f.away_ft, f.away_score)) order by p.kickoff desc)
      from (select * from _streak_picks(g.id) sp where sp.team_id = p_me and sp.day < today_et() order by sp.kickoff desc limit 30) p
      join fixtures f on f.id = p.fixture), '[]'));
end $$;
revoke execute on function public._streak_board(bigint, int) from public, anon, authenticated;

create or replace function public._streak_close(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; best record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games pg where pg.league_id = p_league and pg.kind = 'streak' and pg.status = 'open'
             and not exists (select 1 from fixtures f where f.competition = pg.competition and f.state in ('scheduled', 'live') and _streak_playable(f.id))
             and not exists (select 1 from series s where s.competition = pg.competition and s.state <> 'final')
             -- a season of rounds waits a quiet week: nothing played for seven days (a gap between matchweeks is shorter)
             and (exists (select 1 from series s where s.competition = pg.competition)
                  or not exists (select 1 from fixtures f where f.competition = pg.competition and f.state = 'final' and f.kickoff > now() - interval '7 days'))
             -- and a postseason ends with a last round of one series, decided
             and (not exists (select 1 from series s where s.competition = pg.competition)
                  or (select count(*) from series s where s.competition = pg.competition
                      and s.round = (select max(round) from series where competition = pg.competition)) = 1)
             and exists (select 1 from fixtures f where f.competition = pg.competition and f.state = 'final') loop
    select array_agg(t.team_id order by t.team_id) ids, string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.points) run into best
    from _streak_table(g.id) t join teams tm on tm.id = t.team_id
    where t.points > 0 and (t.points, -t.tiebreak) = (select x.points, -x.tiebreak from _streak_table(g.id) x order by x.points desc, x.tiebreak limit 1);
    update pool_games set status = 'done', winners = coalesce(best.ids, '{}') where id = g.id and status = 'open';
    if best.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🔥 The daily streak is over: %s won it with a run of %s.', best.names, best.run), jsonb_build_object('pool_game', g.id), g.league_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._streak_close(int) from public, anon, authenticated;

create or replace function public._sweep_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare fr int;
begin
  fr := coalesce((r->>'from_round')::int, (select open_round from _event_rounds(p_competition)));
  if not _sweep_ok(p_competition, fr) then
    raise exception '%', case when coalesce((select complete from _sweep_shape(p_competition, fr)), false)
      then 'The sweepstake needs a round whose matchups are all set and not started'
      else 'The sweepstake waits until every round of the event is on the schedule' end;
  end if;
  return jsonb_build_object('from_round', fr);
end $$;
revoke execute on function public._sweep_rules(text, jsonb) from public, anon, authenticated;

create or replace function public.pool_games_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status, 'competition', g.competition,
      'series', (g.rules->>'series')::bigint,
      'fixture', (g.rules->>'fixture')::bigint,
      'from_round', (g.rules->>'from_round')::int, 'locked', _pool_game_locked(g.id), 'drawn', case when g.kind = 'sweep' then g.rules ? 'deal' end,
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

