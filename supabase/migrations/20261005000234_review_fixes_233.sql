-- Fixes from a fifth independent review (migrations 229 to 233), all on the daily streak but the last two:
-- * A game a series didn't need (an "if necessary" Game 6 still marked scheduled once the series is decided) is never
--   offered, picked, reminded or waited on, and a pick already on one counts for nothing (`_streak_playable`).
-- * A tie in a sport without draws counts for nothing, as the rules say, rather than breaking the run.
-- * A day locks once its picked game is under way or over; a picked game put off or voided frees the day.
-- * A pick belongs to the day its game is on now: a game moved to another day takes its pick with it, and picking
--   that day again replaces it (one pick a day, whatever the feed did). Day keys are built with to_char.
-- * The host settles a game by hand for a pool that runs only the streak.
-- * A new streak isn't "locked" before anyone has picked.
-- * The host's event nudge is kept per event, so round N of one event doesn't silence round N of another.
-- Safe to run twice.

-- a game the streak can still be played on: to come or under way, and not a game its series no longer needs
create or replace function public._streak_playable(p_fixture bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.state in ('scheduled', 'live') and f.home_club is not null and f.away_club is not null
                     and not (f.state = 'scheduled' and exists (select 1 from series s where s.id = f.series_id and s.state = 'final'))
                   from fixtures f where f.id = p_fixture), false)
$$;
revoke execute on function public._streak_playable(bigint) from public, anon, authenticated;

create or replace function public._streak_open(p_competition text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fixtures f where f.competition = p_competition and f.state = 'scheduled' and f.kickoff > now()
                 and _streak_playable(f.id))
$$;
revoke execute on function public._streak_open(text) from public, anon, authenticated;

create or replace function public._streak_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not _streak_open(p_competition) then raise exception 'That event has no games still to come'; end if;
  return jsonb_build_object('draws', coalesce((select (s.config->>'draws')::boolean from competitions c join sports s on s.id = c.sport where c.id = p_competition), false));
end $$;
revoke execute on function public._streak_rules(text, jsonb) from public, anon, authenticated;

-- every pick with its game's result as this pool reads it, on the day its game is on now; `right` is null until the
-- game is decided, and a game called off, voided by the host, not needed by its series or tied where the sport has no
-- draws counts for nothing
create or replace function public._streak_picks(p_game bigint)
returns table (team_id int, day date, fixture bigint, pick text, kickoff timestamptz, res text, void boolean, is_right boolean)
language sql stable security definer set search_path = public as $$
  select x.team_id, x.day, x.fixture, x.pick, x.kickoff, x.res, x.void, case when x.void then null when x.res is not null then x.pick = x.res end
  from (select pk.team_id, _streak_day(f.kickoff) as day, f.id fixture, pk.pick->>'pick' pick, f.kickoff, e.res,
          e.void or (f.state = 'scheduled' and not _streak_playable(f.id))
            or (e.res = 'D' and not coalesce((g.rules->>'draws')::boolean, false)) void
        from pool_picks pk join pool_games g on g.id = pk.game_id
        join fixtures f on f.id = (pk.pick->>'fixture')::bigint
        cross join lateral _pool_fixture(g.league_id, f.id) e
        where pk.game_id = p_game and pk.thing like 'd:%') x
$$;
revoke execute on function public._streak_picks(bigint) from public, anon, authenticated;

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
                 order by pk.picked_at desc limit 1),
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
               where pk.game_id = g.id and pk.team_id = me and pk.thing like 'd:%' and _streak_day(f.kickoff) = _streak_day(t.kickoff)
                 and not (e.open or e.void)) then
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

create or replace function public._pool_game_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g pool_games; s record; t record; n int := 0; lk timestamptz; hrs text; key int; left_n int;
begin
  for g in select * from pool_games where league_id = p_league and status = 'open' loop
    for s in select x.id, x.starts_at, coalesce(x.short, x.label) nm, false st from series x
             where g.kind = 'series' and x.competition = g.competition and x.round >= (g.rules->>'from_round')::int
               and x.high_club is not null and x.low_club is not null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             select 0, _rank_lock(g.id), 'ranking', false where g.kind in ('rank', 'bracket') and _rank_lock(g.id) between now() and now() + interval '6 hours'
             union all
             select 0, _players_lock(g.id), 'box', false where g.kind = 'players' and _players_lock(g.id) between now() and now() + interval '6 hours'
             union all
             select 0, f.kickoff, 'sheet', false from fixtures f
             where g.kind = 'props' and f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled' and f.kickoff between now() and now() + interval '6 hours'
             union all
             -- pick'em: a round whose first match still to come kicks off within six hours; `st` once the round is under
             -- way (the NFL's Thursday game), for a second reminder before the rest of it
             select f.gameweek, min(f.kickoff), _round_word(g.competition),
               exists (select 1 from fixtures f2 where f2.competition = g.competition and f2.gameweek = f.gameweek and f2.kickoff <= now())
             from fixtures f
             where g.kind = 'pickem' and f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
               and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
             group by f.gameweek having min(f.kickoff) <= now() + interval '6 hours'
             union all
             -- a grid on a week's game stands in as a series of one, with no id of its own
             select coalesce(x.id, 0), x.starts_at, 'squares', false from _squares_series(g.id) x
             where g.kind = 'squares' and g.draw is null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             -- the streak: a day's first game still to come within six hours, the day as yyyymmdd
             select to_char(_streak_day(f.kickoff), 'YYYYMMDD')::int, min(f.kickoff), 'streak', false from fixtures f
             where g.kind = 'streak' and f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
               and _streak_playable(f.id)
             group by _streak_day(f.kickoff) having min(f.kickoff) <= now() + interval '6 hours' loop
      lk := s.starts_at;
      -- the second reminder of a round is kept apart from the first (its round as a negative number)
      key := case when s.st then -s.id else s.id end;
      hrs := case when lk - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from lk - now()) / 3600))::int || 'h' end;
      for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
                 and (case when g.kind = 'pickem' then
                        -- a match in the round still to come that they haven't picked
                        exists (select 1 from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                                and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'f:' || f.id))
                      else not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id
                                 and (case when g.kind = 'squares' then pk.thing like 'sq:%' when g.kind = 'props' then pk.thing = 'props'
                                           when g.kind = 'streak' then pk.thing like 'd:%' and exists (select 1 from fixtures pf
                                             where pf.id = (pk.pick->>'fixture')::bigint and to_char(_streak_day(pf.kickoff), 'YYYYMMDD')::int = s.id)
                                           else pk.thing = case when s.id = 0 then case g.kind when 'bracket' then 'bracket' when 'players' then 'box' else 'rank' end else 's:' || s.id end end)) end)
                 and not exists (select 1 from private.soccer_nudged x where x.game = g.kind and x.game_id = g.id and x.team_id = tm.id and x.gameweek = key) loop
        left_n := case when g.kind = 'pickem' then (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = t.id and pk.thing = 'f:' || f.id)) end;
        perform _pool_alert(t.id, 'pool_game', case when g.kind = 'pickem' and s.st
          then format('⏰ The rest of %s %s kicks off in %s. You have %s still to pick in %s.', lower(s.nm), s.id, hrs,
                      case when left_n = 1 then 'one ' || _sport_word(g.competition, 'match', 'match')
                           else left_n || ' ' || case _sport_word(g.competition, 'match', 'match') when 'match' then 'matches' else _sport_word(g.competition, 'match', 'match') || 's' end end, g.title)
          when g.kind = 'pickem'
          then format('⏰ %s %s kicks off in %s. Pick your matches in %s.', s.nm, s.id, hrs, g.title)
          when g.kind = 'squares'
          then format('⏰ %s close in %s. Claim a square before the digits are drawn.', g.title, hrs)
          when g.kind = 'players' then format('⏰ The box pool locks at the first puck drop, in %s. Take one player from every box.', hrs)
          when g.kind = 'props' then format('⏰ %s locks in %s. Make your calls on the game.', g.title, hrs)
          when g.kind = 'streak' then format('🔥 The day''s first game starts in %s. Make your streak pick: one winner from today''s games.', hrs)
          when s.id = 0 and g.kind = 'bracket' then format('⏰ The bracket locks in %s. Fill yours in, all the way to the final.', hrs)
          when s.id = 0 then format('⏰ Rank the teams locks in %s. Put the clubs in order.', hrs)
          else format('⏰ The %s starts in %s. Pick the winner and how many games.', s.nm, hrs) end, '/picks?g=' || g.id);
        insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.kind, g.id, t.id, key) on conflict do nothing;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_game_nudge(int) from public, anon, authenticated;

create or replace function public._streak_close(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; best record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games pg where pg.league_id = p_league and pg.kind = 'streak' and pg.status = 'open'
             and not exists (select 1 from fixtures f where f.competition = pg.competition and f.state in ('scheduled', 'live') and _streak_playable(f.id))
             and not exists (select 1 from series s where s.competition = pg.competition and s.state <> 'final')
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
    else true end
  from pool_games g where g.id = p_game
$$;
revoke execute on function public._pool_game_locked(bigint) from public, anon, authenticated;

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

create or replace function public._pool_host_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare e record; h record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for e in select c.id, c.name, x.round, x.label, x.starts_at
           from competitions c
           cross join lateral (select s.round, min(s.label) label, min(s.starts_at) starts_at from series s
                               where s.competition = c.id and s.state = 'scheduled' and s.starts_at > now()
                                 and s.high_club is not null and s.low_club is not null
                               group by s.round order by s.round limit 1) x
           where c.active and c.format = 'series' and c.pack is not null
             and exists (select 1 from pool_markets m where m.league_id = p_league and m.pack = c.pack)
             and not exists (select 1 from pool_games g where g.league_id = p_league and g.competition = c.id and g.status = 'open')
             and x.starts_at <= now() + interval '2 days' loop
    for h in select t.id from teams t where t.league_id = p_league and t.is_commish
               and not exists (select 1 from private.soccer_nudged z where z.game = 'host_event:' || e.id and z.game_id = p_league and z.team_id = t.id and z.gameweek = e.round) loop
      perform _pool_alert(h.id, 'pool_game', format('🎯 The %s starts %s. Add a game on it for the pool: pick the series, a bracket, squares or a prop sheet on every game, from the Host page.',
        regexp_replace(e.label, '^(AL|NL|AFC|NFC|East|West) ', ''), to_char(e.starts_at at time zone 'America/New_York', 'FMDay')), '/host');
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values ('host_event:' || e.id, p_league, h.id, e.round) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_host_nudge(int) from public, anon, authenticated;

