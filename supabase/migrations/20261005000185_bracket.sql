-- The bracket (docs/DEVELOPMENT.md §6 item 7, docs/POOL-TYPES.md §2 and §9): a pool game where each member picks the
-- winner of every series from a round through to the final, all before the round's first game, later rounds worth
-- more. Built on `series`, so the NHL playoffs and the MLB postseason have it as their feeds fill; the NFL's playoffs
-- and March Madness come as single games and want an adapter that files each as a best-of-1 series.
--
-- * The tree: within each round the series in their order (`sort`, then id); the winners of a round's first two meet in
--   the next round's first, and so on. A bracket can start from a round only where every round after it halves to a
--   final of one, and that round's clubs are all set (`_bracket_ok`). The MLB postseason has it from the LCS.
-- * A bracket is one pick (`thing = 'bracket'`, {winners: {series id: club id}}): a first-round winner is one of its
--   two clubs, a later one a winner the member picked below it. It locks with the round's first game (`_rank_lock`),
--   and the host can enter one for a member who asked, as for every game.
-- * Points: Classic doubles each round (1, 2, 4, 8 from the starting round), Flat is 1 a series; a right winner scores
--   its round's points. What is still possible counts each pick whose club hasn't been knocked out. The total runs in
--   the final's last game break a tie, as in Pick the series.
-- * The engine knows the kind: the start page and the host's desk offer it on any event whose rounds make a bracket,
--   the table, the board, the reminders, the lock and the menu's "to pick" read it.

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket'));

-- the tree from a round: each series' position in its round and the series its winner goes on to
create or replace function public._bracket_tree(p_competition text, p_from int)
returns table (series_id bigint, round int, pos int, next_id bigint)
language sql stable security definer set search_path = public as $$
  with s as (select id, x.round, (row_number() over (partition by x.round order by x.sort, x.id) - 1)::int pos
             from series x where x.competition = p_competition and x.round >= p_from)
  select a.id, a.round, a.pos, b.id from s a left join s b on b.round = a.round + 1 and b.pos = a.pos / 2
$$;
revoke execute on function public._bracket_tree(text, int) from public, anon, authenticated;

-- can a bracket start from this round: every later round half the one before, down to a final of one, and the
-- starting round's clubs all set
create or replace function public._bracket_ok(p_competition text, p_from int) returns boolean
language sql stable security definer set search_path = public as $$
  with r as (select round, count(*) n from series where competition = p_competition and round >= p_from group by round)
  select p_from is not null and exists (select 1 from r where round = p_from)
    and (select n from r where round = (select max(round) from r)) = 1
    and not exists (select 1 from r a where a.round > p_from and (select n from r b where b.round = a.round - 1) is distinct from a.n * 2)
    and (select count(distinct round) from r) = (select max(round) - p_from + 1 from r)
    and not exists (select 1 from series where competition = p_competition and round = p_from and (high_club is null or low_club is null))
$$;
revoke execute on function public._bracket_ok(text, int) from public, anon, authenticated;

-- the table: points for each right winner, the most still possible (picks whose club is still in), right winners,
-- whether a bracket is in, and the tiebreaker's miss
create or replace function public._bracket_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'bracket'),
  tree as (select t.* from g cross join lateral _bracket_tree(g.competition, (g.rules->>'from_round')::int) t),
  ser as (select s.*, coalesce((g.rules->'points'->>s.round::text)::int, 1) pts from g join tree t on true join series s on s.id = t.series_id),
  locked as (select coalesce(_rank_lock(g.id) <= now(), false) l from g),
  picks as (select pk.team_id, e.key::bigint sid, (e.value #>> '{}')::bigint club
            from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket' cross join lateral jsonb_each(pk.pick->'winners') e),
  -- a club is out once it has lost a series of the event
  gone as (select case when s.winner = s.high_club then s.low_club else s.high_club end club
           from g join series s on s.competition = g.competition where s.state = 'final' and s.winner is not null),
  scored as (select p.team_id, s.pts, s.state = 'final' and s.winner = p.club rt,
               s.state <> 'final' and p.club not in (select club from gone)
                 and (s.high_club is null or s.low_club is null or p.club in (s.high_club, s.low_club)) live
             from picks p join ser s on s.id = p.sid),
  ws as (select f.home_score + f.away_score runs from g join series s on s.competition = g.competition join fixtures f on f.series_id = s.id
         where s.round = (select max(round) from ser) and s.state = 'final' and f.state = 'final' order by f.kickoff desc limit 1)
  select tm.id::int,
    coalesce((select sum(sc.pts) from scored sc where sc.team_id = tm.id and sc.rt), 0)::int,
    (coalesce((select sum(sc.pts) from scored sc where sc.team_id = tm.id and (sc.rt or sc.live)), 0)
      -- no bracket in yet: all of it, until the lock
      + case when not exists (select 1 from picks p where p.team_id = tm.id) and not (select l from locked) then (select coalesce(sum(pts), 0) from ser) else 0 end)::int,
    (select count(*) from scored sc where sc.team_id = tm.id and sc.rt)::int,
    0,
    (exists (select 1 from g join pool_picks pk on pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'bracket'))::int,
    (select abs((pk.pick->>'runs')::int - (select runs from ws)) from g join pool_picks pk on pk.game_id = g.id
     where pk.team_id = tm.id and pk.thing = 'tiebreak' and (select runs from ws) is not null)::int
  from g join teams tm on tm.league_id = g.league_id and tm.role = 'gm'
$$;
revoke execute on function public._bracket_table(bigint) from public, anon, authenticated;

-- the board: the tree with each series as it stands, the member's bracket, and once it locks each member's champion
create or replace function public._bracket_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'bracket'),
  lk as (select _rank_lock(g.id) l from g),
  tree as (select t.* from g cross join lateral _bracket_tree(g.competition, (g.rules->>'from_round')::int) t),
  fin as (select series_id from tree where next_id is null)
  select jsonb_build_object(
    'locks_at', (select l from lk), 'locked', coalesce((select l from lk) <= now(), false),
    'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', regexp_replace(s.label, '^(AL|NL|AFC|NFC) ', ''),
        'short', s.short, 'best_of', s.best_of, 'pos', t.pos, 'next', t.next_id,
        'high', _club_json(s.high_club), 'low', _club_json(s.low_club), 'high_wins', s.high_wins, 'low_wins', s.low_wins,
        'winner', s.winner, 'state', s.state, 'starts_at', s.starts_at, 'points', coalesce((g.rules->'points'->>s.round::text)::int, 1))
        order by s.round, t.pos) from tree t join series s on s.id = t.series_id, g), '[]'),
    'mine', (select pk.pick->'winners' from g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'bracket'),
    'picked', (select count(*) from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket'),
    -- everyone's champion, once the bracket locks
    'champions', case when coalesce((select l from lk) <= now(), false) then
      coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'club', (pk.pick->'winners'->>(select series_id from fin)::text)::bigint) order by pk.team_id)
                from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket'), '[]') end,
    'tiebreak', jsonb_build_object('locks_at', (select l from lk), 'locked', coalesce((select l from lk) <= now(), false),
      'mine', (select (pk.pick->>'runs')::int from g join pool_picks pk on pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'tiebreak'),
      'label', (select regexp_replace(s.label, '^(AL|NL) ', '') from fin join series s on s.id = fin.series_id)))
$$;
revoke execute on function public._bracket_board(bigint, int) from public, anon, authenticated;

-- ───────────── the engine learns the kind ─────────────
-- a game's rules: a bracket's points by round
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
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
    pays := coalesce(r->>'pays', 'innings');
    if pays not in ('innings', 'final') then raise exception 'Pay after the 3rd, the 6th and the final, or the final score only'; end if;
    digits := coalesce(r->>'digits', 'once');
    if digits not in ('once', 'each') then raise exception 'Draw the digits once, or fresh for each game'; end if;
    return jsonb_build_object('series', sid, 'size', sz, 'cost', cost, 'cap', cap, 'pays', pays, 'digits', digits,
      'points', case pays when 'innings' then '[3, 6, 0]'::jsonb else '[0]'::jsonb end,
      'weights', case pays when 'innings' then '[25, 25, 50]'::jsonb else '[100]'::jsonb end);
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

-- a new game: the bracket's title and its news
create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or rules->>'series' = r->>'series')) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    select * into s from series where id = (r->>'series')::bigint;
    ttl := s.label || ' squares';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at the first pitch of Game 1, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when r->>'pays' = 'innings' then 'after the 3rd, the 6th and the final of every game' else 'the final score of every game' end),
      jsonb_build_object('pool_game', gid));
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
  ttl := case p_kind when 'series' then 'Pick the series' when 'bracket' then 'The bracket' else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚾ Pick the series is on, from the %s: call each series and how many games it goes. Each pick locks at its Game 1''s first pitch.', fr_label)
    when 'bracket' then format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label)
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first pitch of the round.', fr_label) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;

-- the table of a game: a bracket's
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

-- the board of a game: a bracket's tree
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

-- the menu: a bracket still to fill in, and when it locks (the round's first game, as a ranking)
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
        when g.kind = 'squares' then
          (select s.starts_at from series s where s.id = (g.rules->>'series')::bigint and g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id()
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;

-- picking: a whole bracket at once, checked round by round
create or replace function public._pool_game_pick_as(p_team int, p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := p_team; s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int; t record; fr int;
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
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first pitch'; end if;
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
    p_pick := jsonb_build_object('winners', ord);
  elsif p_thing = 'tiebreak' and g.kind = 'bracket' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked with the bracket'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and 60 then raise exception 'Total runs: a number from 0 to 60'; end if;
    p_pick := jsonb_build_object('runs', n);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first pitch of the final round'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and 60 then raise exception 'Total runs: a number from 0 to 60'; end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
revoke execute on function public._pool_game_pick_as(int, bigint, text, jsonb) from public, anon, authenticated;

-- the rules freeze when the bracket locks
create or replace function public._pool_game_locked(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case g.kind
    when 'series' then exists (select 1 from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
                               and (s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now())))
    when 'rank' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'bracket' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'squares' then g.draw is not null or exists (select 1 from pool_picks pk where pk.game_id = g.id)
    when 'pickem' then exists (select 1 from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id
                               where pk.game_id = g.id and (f.state <> 'scheduled' or f.kickoff <= now()))
    else true end
  from pool_games g where g.id = p_game
$$;
revoke execute on function public._pool_game_locked(bigint) from public, anon, authenticated;

-- the reminder before the bracket locks
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
             -- pick'em: a round whose first match still to come kicks off within six hours; `st` once the round is under
             -- way (the NFL's Thursday game), for a second reminder before the rest of it
             select f.gameweek, min(f.kickoff), _round_word(g.competition),
               exists (select 1 from fixtures f2 where f2.competition = g.competition and f2.gameweek = f.gameweek and f2.kickoff <= now())
             from fixtures f
             where g.kind = 'pickem' and f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
               and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
             group by f.gameweek having min(f.kickoff) <= now() + interval '6 hours'
             union all
             select x.id, x.starts_at, 'squares', false from series x
             where g.kind = 'squares' and g.draw is null and x.id = (g.rules->>'series')::bigint and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours' loop
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
                                 and (case when g.kind = 'squares' then pk.thing like 'sq:%'
                                           else pk.thing = case when s.id = 0 then case when g.kind = 'bracket' then 'bracket' else 'rank' end else 's:' || s.id end end)) end)
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

-- the pool's table: a bracket's line
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
  for g in select * from pool_games pg where pg.league_id = lid order by pg.id loop
    return query
    select 'game:' || g.id, g.kind, g.title, g.status, '/picks?g=' || g.id, t.team_id, t.points::numeric,
      case when g.kind = 'squares' then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'bracket' then case when t.right_calls > 0 then format('%s right', t.right_calls) when t.picked > 0 then 'Bracket in' else 'No bracket yet' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
  end loop;

  -- last one standing: still in (or the winner, once it's over) first, then the rounds survived, then who went out
  -- latest
  for g in select * from survivors s where s.league_id = lid order by s.id loop
    return query
    select 'survivor:' || g.id, 'survivor'::text, 'Last one standing'::text, g.status, '/survivor'::text, x.id,
      x.through::numeric, null::numeric, x.alive, (-coalesce(x.out_gw, 0))::numeric,
      case when g.status = 'done' and x.alive then 'Won it' when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in %s %s', lower(_round_word(g.competition)), x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            (select min(p.gameweek) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')) out_gw
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

-- the start page and the host's desk
create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    select case when e ? 'open_round' and _bracket_ok(e->>'competition', (e->>'open_round')::int)
                then jsonb_set(e, '{kinds}', coalesce(e->'kinds', '[]') || '["bracket"]') else e end
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
      'word', w.w, 'club_word', _sport_word(c.id, 'club', 'club'), 'kinds', '["pickem", "survivor"]'::jsonb, 'grids', '[]'::jsonb)
    from competitions c cross join lateral _pickem_rounds(c.id) r cross join lateral (select _round_word(c.id) w) w
    where c.active and r.open_round is not null and not exists (select 1 from series s where s.competition = c.id)) z
$$;
revoke execute on function public.pool_event_list() from public;
grant execute on function public.pool_event_list() to anon, authenticated;
