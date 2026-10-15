-- Season win totals (docs/POOL-TYPES.md §2.11): a `pool_games` kind ('wins') on a regular season. Every club has a
-- line, its wins for the season; each member calls over or under on as many as they like before the season's first
-- game, and each right call is a point. A call is decided the moment it can't change: an over once the club has won
-- more games than its line, an under once it can't get there with the games it has left. Whole-number lines can push,
-- and a push counts for nobody. The most right calls wins; a tie is shared.
-- * The lines: ESPN's BPI preseason projection, kept on the competition (`detail.win_lines`, ESPN's team id to
--   projected wins), rounded to the half-win so nothing pushes; the host can set any line before the opener
--   (`pool_game_set_rules` with `lines`, club id to wins).
-- * A member's calls are one pick, 'wins' {"calls": {club id: 'O' or 'U'}}; everyone's show once the calls lock.
-- * Results come from the season's games, the pool's own result first (`pool_result_overrides`).
-- * The hourly pool job writes the pool's split on each line to the prediction log at the lock, and closes the game
--   once every call is decided, scoring the splits (`_wins_tick`). Safe to run twice.

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check
  check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket', 'players', 'survivor', 'score', 'props', 'streak', 'sweep', 'wins'));

-- the NBA's 2026-27 lines: BPI's projected wins as ESPN published them before the season (run 30 September 2026)
update public.competitions
set detail = coalesce(detail, '{}') || jsonb_build_object('win_lines', '{"25": 60.7, "24": 59.1, "18": 51.7, "2": 51.3, "8": 49.4, "20": 47.5, "7": 48.7, "16": 47.8, "5": 47.9, "10": 46.7, "28": 45.5, "14": 45.6, "13": 45.4, "19": 42.9, "1": 42.2, "22": 41.4, "11": 42.0, "30": 39.9, "21": 40.4, "9": 43.6, "26": 35.4, "6": 33.8, "27": 32.4, "29": 29.4, "4": 28.2, "12": 30.1, "3": 28.1, "15": 26.3, "17": 25.0, "23": 21.7}'::jsonb,
  'win_lines_source', 'ESPN''s BPI projection', 'games', 82)
where id = 'nba-2026-27' and not coalesce(detail ? 'win_lines', false);

-- a host's score by hand goes to 999: a basketball score passes 99
alter table public.pool_result_overrides drop constraint if exists pool_result_overrides_home_check;
alter table public.pool_result_overrides add constraint pool_result_overrides_home_check check (home between 0 and 999);
alter table public.pool_result_overrides drop constraint if exists pool_result_overrides_away_check;
alter table public.pool_result_overrides add constraint pool_result_overrides_away_check check (away between 0 and 999);

-- the calls lock at the season's first game
create or replace function public._wins_lock_at(p_competition text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(kickoff) from fixtures where competition = p_competition and state <> 'cancelled'
$$;
revoke execute on function public._wins_lock_at(text) from public, anon, authenticated;

-- a game's lock: the season's first game, kept once it has passed (the hourly job writes `rules.locked_at`), so an
-- opening slate called off later never re-opens calls everyone has seen
create or replace function public._wins_lock(p_game bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((rules->>'locked_at')::timestamptz, _wins_lock_at(competition)) from pool_games where id = p_game
$$;
revoke execute on function public._wins_lock(bigint) from public, anon, authenticated;

-- how many games each club plays: the competition's own count, else the sport's, else the most any club has filed
create or replace function public._wins_season_games(p_competition text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((c.detail->>'games')::int,
    case c.sport when 'nba' then 82 when 'nhl' then 82 when 'nfl' then 17 when 'mlb' then 162 end,
    (select max(n) from (select x, count(*) n from fixtures f cross join unnest(array[f.home_club, f.away_club]) x
                         where f.competition = c.id group by x) z)::int)
  from competitions c where c.id = p_competition
$$;
revoke execute on function public._wins_season_games(text) from public, anon, authenticated;

-- a season takes win totals while it has lines and its first game is still to come
create or replace function public._wins_ok(p_competition text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select detail ? 'win_lines' from competitions where id = p_competition), false)
    and not exists (select 1 from series where competition = p_competition)
    and coalesce(_wins_lock_at(p_competition) > now(), false)
$$;
revoke execute on function public._wins_ok(text) from public, anon, authenticated;

-- every club in the season gets a line: the host's where given, the projection's otherwise
create or replace function public._wins_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c competitions; games int; lines jsonb := '{}'; x record; v numeric; dflt numeric; edited boolean := false; given jsonb;
begin
  select * into c from competitions where id = p_competition;
  if exists (select 1 from series where competition = p_competition) then raise exception 'Win totals are for a regular season'; end if;
  if not coalesce(_wins_lock_at(p_competition) > now(), false) then raise exception 'Win totals lock at the season''s first game, and it has started'; end if;
  games := _wins_season_games(p_competition);
  for x in select cl.id, cl.ext_id, cl.provider from clubs cl
           where cl.id in (select unnest(array[f.home_club, f.away_club]) from fixtures f where f.competition = p_competition) order by cl.id loop
    dflt := case when x.provider = 'espn' and c.detail->'win_lines' ? x.ext_id then floor((c.detail->'win_lines'->>x.ext_id)::numeric) + 0.5 end;
    given := r->'lines'->x.id::text;
    if given is not null and jsonb_typeof(given) <> 'number' then raise exception 'A line is a number of wins'; end if;
    v := coalesce(given::text::numeric, dflt);
    if v is null then raise exception 'Give every % a line', _sport_word(p_competition, 'club', 'club'); end if;
    if v <= 0 or v >= games or v * 2 <> round(v * 2) then raise exception 'A line is a number of wins from 0.5 to %, in halves', games - 0.5; end if;
    if v is distinct from dflt then edited := true; end if;
    lines := lines || jsonb_build_object(x.id::text, v);
  end loop;
  if (select count(*) from jsonb_object_keys(lines)) < 2 then raise exception 'That season has no games yet'; end if;
  return jsonb_build_object('lines', lines, 'games', games, 'edited', edited, 'source', c.detail->>'win_lines_source');
end $$;
revoke execute on function public._wins_rules(text, jsonb) from public, anon, authenticated;

-- each club's record so far, the games it has left, and its line's verdict once it can't change ('O', 'U', or 'P' for
-- a whole-number line hit exactly at the end)
create or replace function public._wins_clubs(p_game bigint)
returns table (club bigint, line numeric, w int, l int, d int, left_n int, decided text)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  fx as materialized (
    select f.home_club, f.away_club, f.kickoff,
      coalesce(o.outcome, case when f.state = 'final' and coalesce(f.home_ft, f.home_score) is not null and coalesce(f.away_ft, f.away_score) is not null then
        case when coalesce(f.home_ft, f.home_score) > coalesce(f.away_ft, f.away_score) then 'H'
             when coalesce(f.home_ft, f.home_score) < coalesce(f.away_ft, f.away_score) then 'A' else 'D' end end) res,
      -- still to be played: not called off, and not a postponement left a fortnight behind
      (f.state in ('scheduled', 'live') or (f.state = 'postponed' and f.kickoff > now() - interval '14 days')) open
    from g join fixtures f on f.competition = g.competition
    left join pool_result_overrides o on o.league_id = g.league_id and o.fixture_id = f.id),
  -- every game from both sides, once
  side as (select s.club, fx.res is null and fx.open pend,
             case when fx.res = 'D' then 'd' when fx.res in ('H', 'A') and (fx.res = 'H') = s.home then 'w' when fx.res in ('H', 'A') then 'l' end r
           from fx cross join lateral (values (fx.home_club, true), (fx.away_club, false)) s(club, home)),
  per as (select s.club, count(*) filter (where s.r = 'w')::int w, count(*) filter (where s.r = 'l')::int l,
            count(*) filter (where s.r = 'd')::int d, count(*) filter (where s.pend)::int sched
          from side s group by s.club),
  lin as (select x.key::bigint club, x.value::numeric line, coalesce(per.w, 0) w, coalesce(per.l, 0) l, coalesce(per.d, 0) d, coalesce(per.sched, 0) sched
          from g cross join jsonb_each_text(g.rules->'lines') x left join per on per.club = x.key::bigint),
  -- the season is over when nothing filed is left to play and every club has played its season, or a week has passed
  -- since the last game (a game called off and never replayed)
  ended as (select not exists (select 1 from fx where fx.res is null and fx.open) and exists (select 1 from fx where fx.res is not null)
              and ((select max(kickoff) from fx) < now() - interval '7 days'
                   or not exists (select 1 from lin where lin.w + lin.l + lin.d < (select (g.rules->>'games')::int from g))) done),
  -- the games left: those on the schedule, or what the season's length says, whichever is more (a season's last
  -- games can be filed late, as the NBA Cup's are)
  lft as (select lin.*, case when (select done from ended) then 0
                             else greatest(lin.sched, (select (g.rules->>'games')::int from g) - lin.w - lin.l - lin.d) end left_n from lin)
  select lft.club, lft.line, lft.w, lft.l, lft.d, lft.left_n,
    case when lft.w > lft.line then 'O'
         when lft.w + lft.left_n < lft.line then 'U'
         when (select done from ended) then 'P' end
  from lft
$$;
revoke execute on function public._wins_clubs(bigint) from public, anon, authenticated;

-- the table: right calls (points), right or still open (possible; every club while the calls are open), calls made
create or replace function public._wins_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  c as materialized (select * from _wins_clubs(p_game)),
  calls as (select pk.team_id, x.key::bigint club, x.value cl from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
            cross join jsonb_each_text(pk.pick->'calls') x),
  sc as (select k.team_id, count(*) filter (where k.cl = c.decided) rt, count(*) filter (where c.decided is null) op, count(*) n
         from calls k join c on c.club = k.club group by k.team_id),
  opn as (select coalesce(_wins_lock(g.id) > now(), true) o from g)
  select tm.id::int, coalesce(sc.rt, 0)::int,
    (coalesce(sc.rt, 0) + coalesce(sc.op, 0) + case when (select o from opn) then (select count(*) from c) - coalesce(sc.n, 0) else 0 end)::int,
    coalesce(sc.rt, 0)::int, 0, coalesce(sc.n, 0)::int, null::int
  from g join teams tm on tm.league_id = g.league_id and tm.role = 'gm' left join sc on sc.team_id = tm.id
$$;
revoke execute on function public._wins_table(bigint) from public, anon, authenticated;

create or replace function public._wins_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'wins'),
  lk as (select _wins_lock(g.id) at, coalesce(_wins_lock(g.id) <= now(), false) locked from g),
  c as materialized (select * from _wins_clubs(p_game))
  select jsonb_build_object('locks_at', lk.at, 'locked', lk.locked, 'games', (g.rules->>'games')::int,
    'edited', coalesce((g.rules->>'edited')::boolean, false), 'source', g.rules->>'source',
    'players', (select count(*) from teams where league_id = g.league_id and role = 'gm'),
    'called', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins'),
    'decided', (select count(*) from c where c.decided is not null),
    'mine', coalesce((select pk.pick->'calls' from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'wins'), '{}'),
    'clubs', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('line', c.line, 'w', c.w, 'l', c.l, 'd', c.d, 'left', c.left_n, 'decided', c.decided,
        -- the pool's calls on it, once they lock
        'over', case when lk.locked then (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls'->>c.club::text = 'O') end,
        'under', case when lk.locked then (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls'->>c.club::text = 'U') end,
        'calls', case when lk.locked then coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'call', pk.pick->'calls'->>c.club::text) order by pk.team_id)
                   from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls' ? c.club::text), '[]') end)
      order by c.line desc, c.club) from c), '[]'))
  from g cross join lk
$$;
revoke execute on function public._wins_board(bigint, int) from public, anon, authenticated;

-- the hourly pool job: the pool's split on every line into the prediction log once the calls lock, and the game
-- closed once every call is decided
create or replace function public._wins_tick(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; n int := 0; top int; w int[]; names text; lk timestamptz;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games where league_id = p_league and kind = 'wins' and status = 'open' loop
    lk := _wins_lock(g.id);
    continue when lk is null or lk > now();
    -- the lock is kept from here on
    if not g.rules ? 'locked_at' then update pool_games set rules = rules || jsonb_build_object('locked_at', lk) where id = g.id; end if;
    insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
    select g.league_id, 'pool_wins_split', jsonb_build_object('game', g.id, 'club', s.key::bigint), round(s.o::numeric / (s.o + s.u), 3),
      (select sport from competitions where id = g.competition), lk,
      coalesce((select max(f.date) from fixtures f where f.competition = g.competition), today_et() + 200),
      jsonb_build_object('line', s.value::numeric, 'O', s.o, 'U', s.u, 'competition', g.competition)
    from (select x.key, x.value, count(*) filter (where pk.pick->'calls'->>x.key = 'O') o, count(*) filter (where pk.pick->'calls'->>x.key = 'U') u
          from jsonb_each_text(g.rules->'lines') x left join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
          group by x.key, x.value) s
    where s.o + s.u > 0
    on conflict (league_id, kind, subject) do nothing;
    continue when exists (select 1 from _wins_clubs(g.id) c where c.decided is null);
    select max(t.points) into top from _pool_game_table(g.id) t;
    select coalesce(array_agg(t.team_id order by t.team_id), '{}') into w from _pool_game_table(g.id) t where t.points = top and top > 0;
    update pool_games set status = 'done', winners = w where id = g.id and status = 'open';
    continue when not found;
    -- each line's split scored: 1 when it went over, 0 under, void on a push
    update predictions p set outcome = case c.decided when 'O' then 1 when 'U' then 0 end,
      error = case c.decided when 'O' then 1 - p.predicted when 'U' then 0 - p.predicted end,
      status = case when c.decided = 'P' then 'void' else 'scored' end, scored_at = now()
    from _wins_clubs(g.id) c
    where p.league_id = g.league_id and p.kind = 'pool_wins_split' and p.subject = jsonb_build_object('game', g.id, 'club', c.club) and p.status = 'open';
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) into names from teams tm where tm.id = any (w);
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when names is null then '📈 Win totals are settled, and nobody called one right.'
           else format('🏆 Win totals are settled: %s called %s of %s right.', names, top, (select count(*) from jsonb_object_keys(g.rules->'lines'))) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._wins_tick(int) from public, anon, authenticated;

-- the shared pool functions, each with its branch for win totals
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint; f fixtures;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
  if p_kind = 'props' then return _props_rules(p_competition, r); end if;
  if p_kind = 'streak' then return _streak_rules(p_competition, r); end if;
  if p_kind = 'sweep' then return _sweep_rules(p_competition, r); end if;
  if p_kind = 'wins' then return _wins_rules(p_competition, r); end if;
  if p_kind = 'squares' then
    if r ? 'fixture' then
      -- one game of an NFL week (migration 217): Sunday night, Monday night, any game still to come
      select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
      if f.id is null or f.series_id is not null then raise exception 'Pick the game the grid is on'; end if;
      if (select sport from competitions where id = p_competition) is distinct from 'nfl' then raise exception 'A grid on one game is for football weeks'; end if;
      if f.home_club is null or f.away_club is null then raise exception 'That game has no matchup yet'; end if;
      if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
    else
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
    end if;
    sz := coalesce((r->>'size')::int, 10);
    if sz not in (5, 10) then raise exception 'A grid is 10 by 10 or 5 by 5'; end if;
    cost := coalesce((r->>'cost')::int, 10);
    if cost not between 1 and 500 then raise exception 'A square costs 1 to 500 coins'; end if;
    cap := coalesce((r->>'cap')::int, 0);
    if cap not between 0 and sz * sz then raise exception 'The cap is up to % squares each (0 for none)', sz * sz; end if;
    -- each sport pays after its own periods, or on the final score only
    -- each sport pays after its own periods (hockey's from the Stanley Cup feed's score by period, migration 215)
    pays := coalesce(r->>'pays', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nba' then 'quarters' when 'nhl' then 'periods' else 'final' end);
    if pays not in ('final', case (select sport from competitions where id = p_competition) when 'mlb' then 'innings' when 'nfl' then 'quarters' when 'nba' then 'quarters' when 'nhl' then 'periods' else 'final' end) then
      raise exception '%', case (select sport from competitions where id = p_competition)
        when 'mlb' then 'Pay after the 3rd, the 6th and the final, or the final score only'
        when 'nfl' then 'Pay after every quarter, or the final score only'
        when 'nba' then 'Pay after every quarter, or the final score only'
        when 'nhl' then 'Pay after every period, or the final score only'
        else 'This sport pays on the final score only' end;
    end if;
    digits := coalesce(r->>'digits', 'once');
    if digits not in ('once', 'each') then raise exception 'Draw the digits once, or fresh for each game'; end if;
    return case when f.id is not null then jsonb_build_object('fixture', f.id) else jsonb_build_object('series', sid) end || jsonb_build_object('size', sz, 'cost', cost, 'cap', cap, 'pays', pays, 'digits', digits,
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
    if coalesce((r->>'games_bonus')::int, 0) not between 0 and 10 then raise exception 'The bonus for the games is 0 to 10 points'; end if;
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'tiebreak', true, 'games_bonus', coalesce((r->>'games_bonus')::int, 0));
  end if;
  raise exception 'No such kind of game';
end $$;
create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions; s series;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  -- one game of each kind on an event; squares, one grid on each series or week's game
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open'
             and (p_kind <> 'squares' or coalesce(rules->>'series', 'f' || (rules->>'fixture')) = coalesce(r->>'series', 'f' || (r->>'fixture'))) and (p_kind <> 'props' or rules->>'fixture' = r->>'fixture')
             -- a second bracket goes on from a later round, once the first has locked
             and (p_kind <> 'bracket' or rules->>'from_round' = r->>'from_round' or not _pool_game_locked(id))) then
    raise exception 'This pool already runs that game';
  end if;
  if p_kind = 'squares' then
    if r ? 'fixture' then
      -- a week's game is a series of one: 'Week 6: DAL at PHI squares'
      select format('%s: %s at %s squares', coalesce(nullif(f.round, ''), _round_word(p_competition) || ' ' || f.gameweek), coalesce(ca.short, ca.name), coalesce(ch.short, ch.name))
        into ttl from fixtures f join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club where f.id = (r->>'fixture')::bigint;
      s.best_of := 1;
    else
      select * into s from series where id = (r->>'series')::bigint;
      ttl := s.label || ' squares';
    end if;
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at %s, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when s.best_of > 1 then format('the %s of Game 1', _sport_word(p_competition, 'start', 'first pitch')) else _sport_word(p_competition, 'start', 'first pitch') end,
      case r->>'pays' when 'innings' then 'after the 3rd, the 6th and the final of every game'
        when 'quarters' then 'after the 1st quarter, at the half, after the 3rd quarter and on the final' || case when s.best_of > 1 then ' of every game' else '' end
        when 'periods' then 'after the 1st period, the 2nd and the final' || case when s.best_of > 1 then ' of every game' else '' end
        else 'the final score' || case when s.best_of > 1 then ' of every game' else '' end end),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'props' then
    select coalesce(x.short, x.label, nullif(f.round, ''), 'Week ' || f.gameweek) || case when x.best_of > 1 then ' Game ' || f.game_no else '' end
        || ': ' || coalesce(ca.short, ca.name) || ' at ' || coalesce(ch.short, ch.name)
      into ttl from fixtures f left join series x on x.id = f.series_id join clubs ca on ca.id = f.away_club join clubs ch on ch.id = f.home_club
      where f.id = (r->>'fixture')::bigint;
    ttl := 'Props · ' || ttl;
    begin
      insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    exception when unique_violation then
      raise exception 'This pool already runs that game';
    end;
    perform _sys('general', format('📋 The prop sheet is open on %s: %s calls on the game, a point each, and the total breaks a tie. It locks at the %s.',
      substr(ttl, 9), jsonb_array_length(r->'questions'), _sport_word(p_competition, 'start', 'start')), jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'players' then
    ttl := 'The box pool';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', case when coalesce((r->>'playoffs')::boolean, false)
      then format('🏒 The playoff box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, all the way to the Cup. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'))
      else format('🏒 The box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, from %s to %s. Your team locks at the first puck drop.',
        jsonb_array_length(r->'boxes'), to_char((r->>'from')::date, 'FMDay FMMonth FMDD'), to_char((r->>'to')::date, 'FMDay FMMonth FMDD')) end,
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'sweep' then
    ttl := 'The sweepstake';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🎩 The sweepstake is on: at the %s of the %s''s first game, everyone in the pool is dealt clubs from the hat. Hold the champion and you win it. Nothing to pick, just luck.',
      _sport_word(p_competition, 'start', 'start'),
      (select regexp_replace(min(label), '^(AL|NL|AFC|NFC|East|West) ', '') from series where competition = p_competition and round = (r->>'from_round')::int)),
      jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'wins' then
    ttl := 'Win totals';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('📈 Win totals are on for %s: over or under on every %s''s wins, a point for each right call. Your calls lock at the season''s first %s, %s.',
      c.name, _sport_word(p_competition, 'club', 'club'), _sport_word(p_competition, 'start', 'start'),
      to_char(_wins_lock_at(p_competition) at time zone 'America/New_York', 'FMDay FMMonth FMDD')), jsonb_build_object('pool_game', gid));
    return gid;
  end if;
  if p_kind = 'streak' then
    ttl := 'The daily streak';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🔥 The daily streak is on for %s: pick the winner of one game each day there are games%s. A right pick adds one to your run, a wrong one starts it again, and a day off breaks nothing. The longest run wins.',
      c.name, case when (r->>'draws')::boolean then ', or a draw' else '' end), jsonb_build_object('pool_game', gid));
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
  ttl := case p_kind when 'series' then 'Pick the series'
    when 'bracket' then case when exists (select 1 from pool_games where league_id = current_league_id() and kind = 'bracket' and competition = p_competition
                                           and (rules->>'from_round')::int < (r->>'from_round')::int) then 'Second-chance bracket' else 'The bracket' end
    else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚔️ Pick the series is on, from the %s: call each series%s. Each pick locks at its %s.', fr_label,
      case when (select max(best_of) from series where competition = p_competition) > 1 then ' and how many games it goes' else '' end,
      case when (select max(best_of) from series where competition = p_competition) > 1 then 'Game 1''s ' else 'game''s ' end || _sport_word(p_competition, 'start', 'start'))
    when 'bracket' then case when ttl = 'Second-chance bracket'
      then format('🏆 The second-chance bracket is open, from the %s: a fresh bracket for everyone, busted or not. Pick every winner to the final before its first game.', fr_label)
      else format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label) end
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first %s of the round.', fr_label, _sport_word(p_competition, 'start', 'start')) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
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
  if g.kind = 'players' then
    return query select * from _players_table(g.id);
    return;
  end if;
  if g.kind = 'props' then
    return query select * from _props_table(g.id);
    return;
  end if;
  if g.kind = 'streak' then
    return query select * from _streak_table(g.id);
    return;
  end if;
  if g.kind = 'sweep' then
    return query select * from _sweep_table(g.id);
    return;
  end if;
  if g.kind = 'wins' then
    return query select * from _wins_table(g.id);
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
    -- the sport's words: what starts a game, what a tiebreaker counts and how high it goes
    'words', jsonb_build_object('start', _sport_word(g.competition, 'start', 'start'), 'score', _sport_word(g.competition, 'score', 'runs'), 'cap', _score_cap(g.competition)),
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
  elsif g.kind = 'players' then
    out := out || jsonb_build_object('players', _players_board(g.id, me));
  elsif g.kind = 'props' then
    out := out || jsonb_build_object('props', _props_board(g.id, me));
  elsif g.kind = 'streak' then
    out := out || jsonb_build_object('streak', _streak_board(g.id, me));
  elsif g.kind = 'sweep' then
    out := out || jsonb_build_object('sweep', _sweep_board(g.id, me));
  elsif g.kind = 'wins' then
    out := out || jsonb_build_object('wins', _wins_board(g.id, me));
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
    when 'sweep' then g.rules ? 'deal' or coalesce(_rank_lock(g.id) <= now(), false)
    when 'wins' then coalesce(_wins_lock(g.id) <= now(), true)
    else true end
  from pool_games g where g.id = p_game
$$;
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
        -- win totals: no calls in yet before the opener
        when g.kind = 'wins' then
          case when coalesce(_wins_lock(g.id) > now(), false)
                 and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'wins') then 1 else 0 end
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
        when g.kind = 'wins' then (select l from (select _wins_lock(g.id) l) z where l > now())
        when g.kind = 'streak' then (select min(f.kickoff) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
                                       and _streak_playable(f.id))
        when g.kind = 'props' then (select f.kickoff from fixtures f where f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled' and f.kickoff > now())
        when g.kind = 'squares' then
          (select s.starts_at from _squares_series(g.id) s where g.draw is null and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id() and g.kind not in ('survivor', 'score')
$$;
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
        when 'wins' then case when t.picked = 0 then 'Nothing called yet' when t.right_calls = 0 and t.possible >= t.picked then format('%s called', t.picked) else format('%s right from %s called', t.right_calls, t.picked) end
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
create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    -- and the Stanley Cup playoffs, before the first round with every club in it, the box pool
    select jsonb_set(e || jsonb_build_object('sheets', _props_games(e->>'competition')), '{kinds}', coalesce(e->'kinds', '[]')
             || case when e ? 'open_round' and _bracket_ok(e->>'competition', (e->>'open_round')::int) then '["bracket"]'::jsonb else '[]'::jsonb end
             || case when e->>'sport' = 'nhl' and (e->>'open_round')::int = 1
                       and not exists (select 1 from series s where s.competition = e->>'competition' and s.round = 1 and (s.high_club is null or s.low_club is null))
                     then '["players"]'::jsonb else '[]'::jsonb end
             -- the prop sheet, on its games still to start
             || case when jsonb_array_length(_props_games(e->>'competition')) > 0 then '["props"]'::jsonb else '[]'::jsonb end
             -- the Eliminator: last one standing on a tournament of single games
             || case when not exists (select 1 from series s where s.competition = e->>'competition' and s.best_of > 1)
                      and exists (select 1 from fixtures f where f.competition = e->>'competition' and f.gameweek = (e->>'open_round')::int
                                  and f.state = 'scheduled' and f.kickoff > now())
                     then '["survivor"]'::jsonb else '[]'::jsonb end
             -- the daily streak, while a game is still to come (migration 231)
             || case when _streak_open(e->>'competition') then '["streak"]'::jsonb else '[]'::jsonb end
             -- the sweepstake, while its round's matchups are set and not started (migration 236)
             || case when e ? 'open_round' and _sweep_ok(e->>'competition', (e->>'open_round')::int) then '["sweep"]'::jsonb else '[]'::jsonb end) e
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
      'word', w.w, 'club_word', _sport_word(c.id, 'club', 'club'),
      -- an NFL week's games take a prop sheet too (migration 216); soccer's rounds take Call the score (a score line
      -- is soccer's game: an NFL score is a guess at two numbers in the twenties)
      'kinds', '["pickem", "survivor"]'::jsonb
               || case when c.sport = 'soccer' then '["score"]'::jsonb else '[]'::jsonb end
               || case when jsonb_array_length(_props_games(c.id)) > 0 then '["props"]'::jsonb else '[]'::jsonb end
               || case when _streak_open(c.id) then '["streak"]'::jsonb else '[]'::jsonb end
               -- win totals, on a season with lines before its opener (migration 297)
               || case when _wins_ok(c.id) then '["wins"]'::jsonb else '[]'::jsonb end,
      'wins_lock', case when _wins_ok(c.id) then _wins_lock_at(c.id) end,
      -- and a grid of squares (migration 217), kept apart from the series grids so a copy of the site from before
      -- never offers one as a series
      'grids', '[]'::jsonb, 'sheets', _props_games(c.id), 'game_grids', case when c.sport = 'nfl' then _props_games(c.id) else '[]'::jsonb end)
    from competitions c cross join lateral _pickem_rounds(c.id) r cross join lateral (select _round_word(c.id) w) w
    where c.active and r.open_round is not null and not exists (select 1 from series s where s.competition = c.id)
    union all
    -- the NHL season: a box pool from the next night with games
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack, 'stage', 'Regular season',
      'open_round', 0, 'open_label', to_char(n.d, 'FMDay FMMonth FMDD'), 'word', 'From',
      'next_lock', (select min(start_utc) from games where game_type = 2 and date = n.d),
      'final_round', 0, 'final_label', to_char((select max(date) from games where game_type = 2), 'FMMonth FMDD'), 'final_starts', null,
      'club_word', 'team', 'kinds', '["players"]'::jsonb, 'grids', '[]'::jsonb)
    from competitions c cross join lateral (select _box_next_night() d) n
    where c.active and c.format = 'players' and c.sport = 'nhl' and n.d is not null) z
$$;
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
  if g.kind = 'pickem' and not (p_pick ? 'thing') then
    out := to_jsonb(_pickem_save_as(p_team, g.id, (p_pick->>'round')::int, p_pick->'picks'));
  -- a pick'em round's tiebreaker ('t:<round>', migration 289) goes the way a series or bracket tiebreaker does
  elsif g.kind in ('series', 'rank', 'bracket', 'players', 'props', 'streak', 'pickem', 'wins') then
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
  elsif p_thing = 'wins' and g.kind = 'wins' then
    -- win totals: over or under on each club's line, until the season's first game; the calls sent are the member's
    -- whole set, so a call left out is taken back
    lock_at := _wins_lock(g.id);
    if lock_at is null or lock_at <= now() then raise exception 'Win totals locked at the season''s first %', _sport_word(g.competition, 'start', 'start'); end if;
    ord := '{}';
    for t in select x.key, x.value from jsonb_each_text(coalesce(p_pick->'calls', '{}')) x loop
      if not (g.rules->'lines' ? t.key) then raise exception 'That % isn''t in this game', _sport_word(g.competition, 'club', 'club'); end if;
      if t.value not in ('O', 'U') then raise exception 'Call each one over or under'; end if;
      ord := ord || jsonb_build_object(t.key, t.value);
    end loop;
    -- the host entering calls for a member adds them to the member's own, which the host can't see
    if coalesce((p_pick->>'merge')::boolean, false) then
      ord := coalesce((select pk.pick->'calls' from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'wins'), '{}') || ord;
    end if;
    -- no calls at all takes the pick back
    if ord = '{}' then
      delete from pool_picks where game_id = g.id and team_id = me and thing = 'wins';
      return jsonb_build_object('calls', '{}'::jsonb);
    end if;
    p_pick := jsonb_build_object('calls', ord);
  elsif p_thing ~ '^t:[0-9]+$' and g.kind = 'pickem' then
    -- a pick'em round's tiebreaker: the total in its last game, until that game starts; the call keeps its game, so a
    -- game moved later or put off never re-opens or re-aims a call already locked (migration 286)
    last_r := substr(p_thing, 3)::int;
    if last_r not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then raise exception 'That round isn''t in this game'; end if;
    if exists (select 1 from pool_picks pk join fixtures x on x.id = (pk.pick->>'fixture')::bigint
               where pk.game_id = g.id and pk.team_id = me and pk.thing = p_thing
                 and x.state not in ('postponed', 'cancelled') and (x.state <> 'scheduled' or x.kickoff <= now())) then
      raise exception 'The tiebreaker locked when the round''s last game began';
    end if;
    select * into t from fixtures where id = _pickem_last(g.competition, last_r);
    if t.id is null then raise exception 'That round has no games yet'; end if;
    if t.state <> 'scheduled' or t.kickoff <= now() then raise exception 'The tiebreaker locked when the round''s last game began'; end if;
    n := round((p_pick->>'runs')::numeric)::int;
    if n is null or n not between 0 and _score_cap(g.competition) then
      raise exception 'Total %: a number from 0 to %', _sport_word(g.competition, 'score', 'runs'), _score_cap(g.competition);
    end if;
    p_pick := jsonb_build_object('runs', n, 'fixture', t.id);
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
             select 0, _wins_lock(g.id), 'wins', false where g.kind = 'wins' and _wins_lock(g.id) between now() and now() + interval '6 hours'
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
                                           else pk.thing = case when s.id = 0 then case g.kind when 'bracket' then 'bracket' when 'players' then 'box' when 'wins' then 'wins' else 'rank' end else 's:' || s.id end end)) end)
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
          when g.kind = 'wins' then format('⏰ Win totals lock at the opener, in %s. Call over or under on every team.', hrs)
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
  if g.kind in ('sweep', 'streak') then raise exception '% has no rules to change', g.title; end if;
  -- win totals: the lines given join the ones already set
  if g.kind = 'wins' and jsonb_typeof(p_rules->'lines') = 'object' then
    -- a line someone has called stays as it was called
    if exists (select 1 from jsonb_each(p_rules->'lines') x where x.value is distinct from g.rules->'lines'->x.key
               and exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls' ? x.key)) then
      raise exception 'Calls are in on %, so those lines stay', (select string_agg(coalesce(c.short, c.name), ', ' order by c.name) from jsonb_each(p_rules->'lines') x join clubs c on c.id::text = x.key
        where x.value is distinct from g.rules->'lines'->x.key and exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls' ? x.key));
    end if;
    p_rules := p_rules || jsonb_build_object('lines', coalesce(g.rules->'lines', '{}') || (p_rules->'lines'));
  end if;
  -- the scoring and against the spread change only before anyone picks: Confidence numbers picks, and a pick against
  -- the spread carries its line
  if g.kind = 'pickem' and (coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
                            or coalesce(p_rules->>'ats', g.rules->>'ats', 'false') <> coalesce(g.rules->>'ats', 'false'))
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
create or replace function public.pool_ahead(p_hours int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); until timestamptz := now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 30), 24 * 14)));
  g record; r int; at timestamptz; total int; day date; s record; locks jsonb := '[]'; games jsonb; w text; still text[]; of int;
begin
  if lid is null then return null; end if;
  select count(*) into of from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null;

  -- the games about to be played on the pool's events: fixtures (a match, a game of a series) still to start
  select coalesce(jsonb_agg(jsonb_build_object(
    'fixture', x.id, 'competition', x.competition, 'event', x.name, 'home', x.home, 'away', x.away, 'at', x.kickoff,
    'series', x.label, 'game_no', x.game_no, 'round', x.gameweek) order by x.kickoff, x.id), '[]')
  into games
  from (select f.id, f.competition, c.name, hc.name home, ac.name away, f.kickoff, sr.label, f.game_no, f.gameweek
        from fixtures f join pool_competitions() c on c.id = f.competition
        join clubs hc on hc.id = f.home_club join clubs ac on ac.id = f.away_club
        left join series sr on sr.id = f.series_id
        where f.state = 'scheduled' and f.kickoff > now() and f.kickoff <= until
          and not exists (select 1 from pool_result_overrides o where o.league_id = lid and o.fixture_id = f.id)
        order by f.kickoff, f.id limit 40) x;

  for g in select pg.id, pg.kind, pg.competition, pg.title, pg.rules from pool_games pg
           where pg.league_id = lid and pg.status = 'open' and pg.kind not in ('squares', 'sweep') order by pg.id loop
    w := _round_word(g.competition);
    if g.kind in ('pickem', 'survivor', 'score') then
      -- the round still to be played: the first with a match yet to kick off, within the game's rounds
      r := case g.kind when 'survivor' then _survivor_week(g.id) when 'score' then _predictor_week(g.id)
             else (select min(f.gameweek) from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
                     and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int) end;
      continue when r is null;
      select min(f.kickoff), count(*) into at, total from fixtures f where f.competition = g.competition and f.gameweek = r
        and f.state = 'scheduled' and f.kickoff > now() and (select e.open from _pool_fixture(lid, f.id) e);
      continue when at is null or at > until;
      if g.kind = 'survivor' then
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and _survivor_alive(g.id, t.id)
          and not exists (select 1 from pool_survivor_picks p where p.survivor_id = g.id and p.team_id = t.id and p.gameweek = r);
      elsif g.kind = 'score' then
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and (select count(*) from pool_predictor_picks p where p.predictor_id = g.id and p.team_id = t.id and p.gameweek = r)
            < (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = r);
      else
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and (select count(*) from pool_picks p join fixtures f on p.thing = 'f:' || f.id where p.game_id = g.id and p.team_id = t.id and f.gameweek = r)
            < (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = r);
      end if;
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', w || ' ' || r, 'at', at,
        'matches', total, 'under_way', exists (select 1 from fixtures f where f.competition = g.competition and f.gameweek = r and f.kickoff <= now()),
        'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    elsif g.kind = 'streak' then
      -- the day's games (Eastern): the pick locks when the first starts
      select min(f.kickoff) into at from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
        and f.home_club is not null and f.away_club is not null and _streak_playable(f.id) and (select e.open from _pool_fixture(lid, f.id) e);
      continue when at is null or at > until;
      day := _streak_day(at);
      select count(*) into total from fixtures f where f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
        and _streak_day(f.kickoff) = day and _streak_playable(f.id);
      select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
        and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id and p.thing = 'd:' || to_char(day, 'YYYY-MM-DD'));
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', to_char(day, 'FMDay'), 'at', at,
        'matches', total, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    elsif g.kind = 'series' then
      -- every series set and yet to start in the window, each its own lock
      for s in select x.id, x.label, x.starts_at from series x where x.competition = g.competition and x.state = 'scheduled'
               and x.high_club is not null and x.low_club is not null and x.starts_at > now() and x.starts_at <= until
               and x.round >= (g.rules->>'from_round')::int order by x.starts_at, x.sort, x.id loop
        select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
          and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id and p.thing = 's:' || s.id);
        locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title, 'round', s.label, 'at', s.starts_at,
          'series', s.id, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
      end loop;
    elsif g.kind in ('bracket', 'rank', 'players', 'props', 'wins') then
      at := case g.kind when 'players' then _players_lock(g.id) when 'wins' then _wins_lock(g.id) when 'props' then (select f.kickoff from fixtures f where f.id = (g.rules->>'fixture')::bigint and f.state = 'scheduled')
              else _rank_lock(g.id) end;
      continue when at is null or at <= now() or at > until;
      select array_agg(t.gm_name order by t.gm_name) into still from teams t where t.league_id = lid and t.role = 'gm' and t.user_id is not null
        and not exists (select 1 from pool_picks p where p.game_id = g.id and p.team_id = t.id
                        and p.thing = case g.kind when 'players' then 'box' else g.kind end);
      locks := locks || jsonb_build_object('game', g.id, 'kind', g.kind, 'title', g.title,
        'round', case g.kind when 'bracket' then 'the bracket' when 'rank' then 'the order' when 'players' then 'the teams' when 'wins' then 'the calls' else 'the sheet' end,
        'at', at, 'still_to_pick', coalesce(to_jsonb(still), '[]'), 'of', of);
    end if;
  end loop;
  return jsonb_build_object('games', games, 'locks', locks, 'members', of);
end $$;
create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'ok', not i.revoked and i.expires_at >= now() and i.uses < i.max_uses
            and (i.team_id is null or not exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null)),
      'reason', case when i.revoked then 'revoked' when i.expires_at < now() then 'expired' when i.uses >= i.max_uses then 'used'
                     when i.team_id is not null and exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null) then 'taken'
                     else null end,
      'league', l.name, 'short', l.short_name, 'brand', l.brand, 'role', i.role,
      'team', (select t.name from teams t where t.id = i.team_id),
      'expires_at', i.expires_at, 'kind', l.kind)
      || case when l.kind = 'predict' then jsonb_build_object(
           'host', (select t.gm_name from teams t where t.league_id = l.id and t.is_commish and t.user_id is not null order by t.id limit 1),
           'members', (select count(*) from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
           'open_questions', (select count(*) from pool_markets m where m.league_id = l.id and m.status = 'open' and m.closes_at > now()))
           || coalesce((select jsonb_build_object('next_market', m.id, 'next_question', m.title, 'next_closes', m.closes_at,
                 'next_outcomes', (select jsonb_agg(jsonb_build_object('key', o->>'key', 'label', o->>'label',
                                     'pct', round(100 * coalesce((pool_prices(m.q, m.b) ->> (o->>'key'))::numeric, 0))) order by ord)
                                   from jsonb_array_elements(m.outcomes) with ordinality x(o, ord)))
               from pool_markets m where m.league_id = l.id and m.status = 'open' and m.closes_at > now()
               order by m.closes_at, m.sort, m.id limit 1), '{}'::jsonb)
           -- a sports pool's next game (migration 293): its soonest match still to start in an open pick'em, last one
           -- standing or Call the score, as "NFL pick'em" and "Week 7: 15 games"
           -- or win totals before the opener (migration 297), whichever locks first
           || coalesce((select v.x from (select (select jsonb_build_object('next_game', g.title,
                 'next_game_line', format('%s %s: %s %s', _round_word(f.competition), f.gameweek, n.n,
                                          case when n.n = 1 then _sport_word(f.competition, 'match', 'match') when _sport_word(f.competition, 'match', 'match') = 'match' then 'matches' else _sport_word(f.competition, 'match', 'match') || 's' end),
                 'next_game_at', f.kickoff)
               from pool_games g
               join fixtures f on f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now() and f.gameweek is not null
                 -- each game's own rounds: a pick'em's from and to, last one standing's and Call the score's start and end
                 and f.gameweek >= coalesce((g.rules->>'from_round')::int, (g.rules->>'start_gw')::int, f.gameweek)
                 and f.gameweek <= coalesce((g.rules->>'to_round')::int, (g.rules->>'end_gw')::int, f.gameweek)
               cross join lateral (select count(*)::int n from fixtures x where x.competition = f.competition and x.gameweek = f.gameweek) n
               where g.league_id = l.id and g.status = 'open' and g.kind in ('pickem', 'survivor', 'score')
               order by f.kickoff, g.id limit 1) x
             union all
             select (select jsonb_build_object('next_game', g.title,
                 'next_game_line', format('%s %ss, over or under', (select count(*) from jsonb_object_keys(g.rules->'lines')), _sport_word(g.competition, 'club', 'club')),
                 'next_game_at', _wins_lock(g.id))
               from pool_games g where g.league_id = l.id and g.status = 'open' and g.kind = 'wins' and _wins_lock(g.id) > now()
               order by g.id limit 1)) v where v.x is not null order by (v.x->>'next_game_at')::timestamptz limit 1), '{}'::jsonb)
         else '{}'::jsonb end
    from league_invites i join leagues l on l.id = i.league_id
    where i.code = lower(trim(p_code))), jsonb_build_object('ok', false, 'reason', 'unknown'))
$$;
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
    or exists (select 1 from pool_games where league_id = lid and kind = 'streak' and competition = f.competition and status = 'open')
    -- and win totals counts every game of its season (migration 297)
    or exists (select 1 from pool_games where league_id = lid and kind = 'wins' and competition = f.competition and status = 'open')) then
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
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 or p_home > 999 or p_away > 999 then raise exception 'Give both sides a score'; end if;
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
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pack_refresh(current_league_id()) + _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _pool_settle_nudge(current_league_id()) + _pool_feed_nudge(current_league_id()) + _streak_close(current_league_id()) + _sweep_tick(current_league_id()) + _wins_tick(current_league_id()) + _pool_mark()
$$;
