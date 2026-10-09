-- The box pool (docs/DEVELOPMENT.md §6 item 7, docs/POOL-TYPES.md §2.7): the hockey pool, on the NHL's own box
-- scores. The top players are grouped into evenly matched boxes and each member takes one player from every box, so any
-- number can play and nobody needs a draft night. Goals and assists count, a goalie's wins and shutouts too, from the
-- first night of the pool to its last; the most points wins.
--
-- * The event: `nhl-2026`, the NHL season, a competition of a third format, 'players' (its data is nhl-sync's `games`
--   and `player_games`, not `fixtures`). The playoffs come as their own event in April, with the clubs that go out shaded.
-- * The boxes are made when the game starts (`_players_boxes`) and kept in its rules: forwards, then defence, then the
--   goalies, each ranked by the points they're expected to score in the pool's nights under its scoring (their
--   projection per game, times their club's games in the window, times the share of games they play), and dealt into
--   boxes in that order, so box 1 holds the best six forwards. Players out hurt (injured reserve, out, suspended, unless
--   due back by the first night) are left out. Classic is ten boxes of six (seven of forwards, two of defence, one of
--   goalies); Quick is five boxes of five.
-- * The window: a week, four weeks or the rest of the season, from the first night still to come. A pick is the whole
--   team (`thing = 'box'`, {players: one id per box, in box order}); it locks at the first puck drop of the first night,
--   and the host can enter one for a member who asked. The host's rules can change until the lock, but not the boxes
--   once someone has picked.
-- * The table counts live: `player_games` are written during the game. The pool is done the morning after its last
--   night, when the hourly pool job (`run_pool_drops`) names the winners.
-- * Also here: the host picking a bracket for a member (`pool_host_pick` refused it since migration 185).

alter table public.competitions drop constraint if exists competitions_format_check;
alter table public.competitions add constraint competitions_format_check check (format in ('rounds', 'series', 'players'));

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format)
values ('nhl-2026', 'nhl', 'NHL 2026-27', 'NHL', 'USA', 'America/New_York', '2026', 'nhl', 'nhl', '20262027', true, 2, 'players')
on conflict (id) do update set format = excluded.format, provider = excluded.provider;

alter table public.pool_games drop constraint if exists pool_games_kind_check;
alter table public.pool_games add constraint pool_games_kind_check check (kind in ('series', 'rank', 'squares', 'pickem', 'bracket', 'players'));

-- a player's box pool points in one game, under the pool's scoring
create or replace function public._box_points(p_stats jsonb, p_scoring jsonb) returns int
language sql immutable set search_path = public as $$
  select (coalesce((p_stats->>'g')::int, 0) * coalesce((p_scoring->>'g')::int, 1)
        + coalesce((p_stats->>'a')::int, 0) * coalesce((p_scoring->>'a')::int, 1)
        + coalesce((p_stats->>'w')::int, 0) * coalesce((p_scoring->>'w')::int, 2)
        + coalesce((p_stats->>'sho')::int, 0) * coalesce((p_scoring->>'sho')::int, 1))::int
$$;

-- the games of a box pool's window: every regular-season game from its first night to its last
create or replace function public._box_games(p_from date, p_to date)
returns table (id bigint, date date, start_utc timestamptz, home text, away text, state text)
language sql stable security definer set search_path = public as $$
  select g.id, g.date, g.start_utc, g.home, g.away, g.state from games g where g.game_type = 2 and g.date between p_from and p_to
$$;
revoke execute on function public._box_games(date, date) from public, anon, authenticated;

-- the boxes: forwards, defence and goalies, each ranked by the points they're expected to score in the window, dealt
-- into boxes of `p_size` in that order
create or replace function public._players_boxes(p_from date, p_to date, p_scoring jsonb, p_f int, p_d int, p_g int, p_size int) returns jsonb
language sql stable security definer set search_path = public as $$
  with gm as (select t.team, count(*) n from _box_games(p_from, p_to) b, unnest(array[b.home, b.away]) t(team) group by t.team),
  p as (select pl.id, case when pl.pos = 'G' then 'G' when pl.pos = 'D' then 'D' else 'F' end grp,
          coalesce(gm.n, 0) * least(1.0, coalesce((pl.proj_stats->>'gp')::numeric, 0) / 82.0)
            * case when coalesce((pl.proj_stats->>'gp')::numeric, 0) > 0 then
                (case when pl.pos = 'G'
                   then coalesce((pl.proj_stats->>'w')::numeric, 0) * coalesce((p_scoring->>'w')::numeric, 2)
                      + coalesce((pl.proj_stats->>'sho')::numeric, 0) * coalesce((p_scoring->>'sho')::numeric, 1)
                   else coalesce((pl.proj_stats->>'g')::numeric, 0) * coalesce((p_scoring->>'g')::numeric, 1)
                      + coalesce((pl.proj_stats->>'a')::numeric, 0) * coalesce((p_scoring->>'a')::numeric, 1) end)
                / (pl.proj_stats->>'gp')::numeric
              else 0 end expect
        from players pl left join gm on gm.team = pl.nhl_team
        where pl.status = 'active' and pl.nhl_team is not null and pl.proj_stats is not null
          -- out hurt or suspended, unless due back by the first night
          and (pl.injury_status is null or pl.injury_status = 'Day-To-Day' or (pl.injury_return is not null and pl.injury_return <= p_from))),
  ranked as (select p.*, row_number() over (partition by grp order by expect desc, id) - 1 rk from p),
  boxed as (select r.*, (r.rk / p_size)::int box_no from ranked r
            where r.rk < p_size * case r.grp when 'F' then p_f when 'D' then p_d else p_g end and r.expect > 0)
  select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'pos', x.grp, 'players', x.players) order by x.ord), '[]')
  from (select b.grp, b.box_no, case b.grp when 'F' then 0 when 'D' then 100 else 200 end + b.box_no ord,
          case b.grp when 'F' then 'Forwards' when 'D' then 'Defence' else 'Goalies' end
            || case when (case b.grp when 'F' then p_f when 'D' then p_d else p_g end) > 1 then ' ' || (b.box_no + 1) else '' end label,
          jsonb_agg(b.id order by b.expect desc, b.id) players
        from boxed b group by b.grp, b.box_no) x
$$;
revoke execute on function public._players_boxes(date, date, jsonb, int, int, int, int) from public, anon, authenticated;

-- the first night still to come: the first date none of whose games has started
create or replace function public._box_next_night() returns date
language sql stable security definer set search_path = public as $$
  select min(g.date) from games g where g.game_type = 2 and g.date >= today_et()
    and not exists (select 1 from games y where y.date = g.date and y.game_type = 2 and (y.start_utc <= now() or y.state <> 'FUT'))
$$;
revoke execute on function public._box_next_night() from public, anon, authenticated;

-- a box pool's rules: the preset, the window, the scoring and the boxes (kept as they are while the preset, the window
-- and the scoring are)
create or replace function public._players_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); preset text; len text; d_from date; d_to date; sc jsonb; k text; key text; boxes jsonb;
  nf int; nd int; ng int; sz int; last_night date;
begin
  if (select format from competitions where id = p_competition) is distinct from 'players' then raise exception 'That event has no box pool'; end if;
  preset := coalesce(r->>'preset', 'classic');
  if preset not in ('classic', 'quick') then raise exception 'Pick a size: Classic or Quick'; end if;
  len := coalesce(r->>'length', 'month');
  if len not in ('week', 'month', 'season') then raise exception 'A box pool runs a week, four weeks or the rest of the season'; end if;
  last_night := (select max(date) from games where game_type = 2);
  d_from := coalesce((r->>'from')::date, _box_next_night());
  if d_from is null then raise exception 'The season has no nights left'; end if;
  if d_from < coalesce(_box_next_night(), d_from + 1) then raise exception 'That night has started; start from the next one'; end if;
  d_to := case len when 'week' then d_from + 6 when 'month' then d_from + 27 else last_night end;
  d_to := least(d_to, last_night);
  if not exists (select 1 from _box_games(d_from, d_from)) then raise exception 'No games that night; start from a night with games'; end if;
  sc := jsonb_build_object('g', 1, 'a', 1, 'w', 2, 'sho', 1) || coalesce(r->'scoring', '{}');
  for k in select jsonb_object_keys(sc) loop
    if k not in ('g', 'a', 'w', 'sho') or coalesce((sc->>k)::int, -1) not between 0 and 10 then raise exception 'Points are whole numbers from 0 to 10'; end if;
  end loop;
  select f, d, g, s into nf, nd, ng, sz from (values ('classic', 7, 2, 1, 6), ('quick', 3, 1, 1, 5)) v(p, f, d, g, s) where v.p = preset;
  key := format('%s|%s|%s|%s', preset, d_from, d_to, sc::text);
  boxes := case when r->>'key' = key and jsonb_typeof(r->'boxes') = 'array' then r->'boxes' else _players_boxes(d_from, d_to, sc, nf, nd, ng, sz) end;
  if jsonb_array_length(boxes) < nf + nd + ng then raise exception 'Not enough players with games in that window to fill the boxes'; end if;
  return jsonb_build_object('preset', preset, 'length', len, 'from', d_from, 'to', d_to, 'scoring', sc, 'boxes', boxes, 'key', key);
end $$;
revoke execute on function public._players_rules(text, jsonb) from public, anon, authenticated;

-- when a box pool locks: the first puck drop of its first night
create or replace function public._players_lock(p_game bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(b.start_utc) from pool_games g cross join lateral _box_games((g.rules->>'from')::date, (g.rules->>'from')::date) b
  where g.id = p_game and g.kind = 'players'
$$;
revoke execute on function public._players_lock(bigint) from public, anon, authenticated;

-- every member's team and what each player has scored in the window
create or replace function public._players_scored(p_game bigint)
returns table (team_id int, player_id int, points int, goals int, assists int, gp int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'players'),
  picks as (select pk.team_id, (e #>> '{}')::int player_id from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
            cross join lateral jsonb_array_elements(pk.pick->'players') e)
  select p.team_id, p.player_id,
    coalesce(sum(_box_points(pg.stats, g.rules->'scoring')), 0)::int,
    coalesce(sum((pg.stats->>'g')::int), 0)::int, coalesce(sum((pg.stats->>'a')::int), 0)::int, count(pg.game_id)::int
  from picks p cross join g
  left join player_games pg on pg.player_id = p.player_id and pg.date between (g.rules->>'from')::date and (g.rules->>'to')::date
    and exists (select 1 from games x where x.id = pg.game_id and x.game_type = 2)
  group by p.team_id, p.player_id
$$;
revoke execute on function public._players_scored(bigint) from public, anon, authenticated;

-- the table: points, goals as the right calls and assists as the exact, and whether a team is in
create or replace function public._players_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'players'),
  s as (select x.team_id, sum(x.points) pts, sum(x.goals) gl, sum(x.assists) ast from _players_scored(p_game) x group by x.team_id)
  select tm.id::int, coalesce(s.pts, 0)::int, null::int, coalesce(s.gl, 0)::int, coalesce(s.ast, 0)::int,
    (exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'box'))::int, null::int
  from g join teams tm on tm.league_id = g.league_id and tm.role = 'gm' left join s on s.team_id = tm.id
$$;
revoke execute on function public._players_table(bigint) from public, anon, authenticated;

-- the board: the boxes with each player as he stands, the member's team, and once it locks everyone's
create or replace function public._players_board(p_game bigint, p_me int) returns jsonb
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'players'),
  lk as (select _players_lock(p_game) l),
  win as (select b.* from g cross join lateral _box_games((g.rules->>'from')::date, (g.rules->>'to')::date) b),
  bx as (select (b.ord - 1)::int box, b.v->>'label' label, b.v->>'pos' pos, (pid #>> '{}')::int player_id, p.ord - 1 rk
         from g cross join lateral jsonb_array_elements(g.rules->'boxes') with ordinality b(v, ord)
         cross join lateral jsonb_array_elements(b.v->'players') with ordinality p(pid, ord)),
  pts as (select pg.player_id, sum(_box_points(pg.stats, g.rules->'scoring'))::int pts, sum((pg.stats->>'g')::int)::int gl,
            sum((pg.stats->>'a')::int)::int ast, count(*)::int gp
          from g join player_games pg on pg.date between (g.rules->>'from')::date and (g.rules->>'to')::date
          where pg.player_id in (select player_id from bx) and pg.game_id in (select id from win)
          group by pg.player_id),
  locked as (select coalesce((select l from lk) <= now(), false) v),
  takes as (select (e #>> '{}')::int player_id, count(*)::int n from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
            cross join lateral jsonb_array_elements(pk.pick->'players') e group by 1)
  select jsonb_build_object(
    'locks_at', (select l from lk), 'locked', (select v from locked), 'from', g.rules->'from', 'to', g.rules->'to', 'scoring', g.rules->'scoring',
    'nights', (select count(distinct date) from win), 'nights_left', (select count(distinct date) from win where state = 'FUT'),
    'boxes', coalesce((select jsonb_agg(jsonb_build_object('label', z.label, 'pos', z.pos, 'players', z.players) order by z.box) from (
        select bx.box, bx.label, bx.pos, jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'pos', pl.pos, 'team', pl.nhl_team,
            'headshot', pl.headshot, 'injury', pl.injury_status, 'pts', coalesce(pts.pts, 0), 'g', coalesce(pts.gl, 0), 'a', coalesce(pts.ast, 0),
            'gp', coalesce(pts.gp, 0), 'left', (select count(*) from win w where w.state = 'FUT' and pl.nhl_team in (w.home, w.away)),
            'games', (select count(*) from win w where pl.nhl_team in (w.home, w.away)),
            'season', pl.proj_stats, 'taken', case when (select v from locked) then coalesce(tk.n, 0) end) order by bx.rk) players
        from bx join players pl on pl.id = bx.player_id left join pts on pts.player_id = pl.id left join takes tk on tk.player_id = pl.id
        group by bx.box, bx.label, bx.pos) z), '[]'),
    'mine', (select pk.pick->'players' from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'box'),
    'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'box'),
    -- everyone's team, once it locks
    'teams', case when (select v from locked) then
      coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'players', pk.pick->'players') order by pk.team_id)
                from pool_picks pk where pk.game_id = g.id and pk.thing = 'box'), '[]') end)
  from g
$$;
revoke execute on function public._players_board(bigint, int) from public, anon, authenticated;

-- the morning after its last night: the winners, and the news
create or replace function public._players_settle(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; top record; n int := 0;
begin
  for g in select * from pool_games where league_id = p_league and kind = 'players' and status = 'open'
             and (rules->>'to')::date < today_et() loop
    -- a game still to be played or under way in the window waits (a postponed one counts once it's final)
    if exists (select 1 from _box_games((g.rules->>'from')::date, (g.rules->>'to')::date) b where b.state not in ('OFF', 'FINAL', 'FUT')) then continue; end if;
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.points) pts into top
    from _players_table(g.id) t join teams tm on tm.id = t.team_id
    where t.points = (select max(points) from _players_table(g.id)) and t.points > 0;
    update pool_games set status = 'done', winners = array(select t.team_id from _players_table(g.id) t
                                                             where t.points = (select max(points) from _players_table(g.id)) and t.points > 0)
    where id = g.id;
    if top.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 %s is done: %s, with %s points.', g.title, top.names, top.pts), jsonb_build_object('pool_game', g.id), g.league_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._players_settle(int) from public, anon, authenticated;

-- ───────────── the engine learns the kind ─────────────
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
  s series; sz int; cost int; cap int; pays text; digits text; sid bigint;
begin
  if p_kind = 'pickem' then return _pickem_rules(p_competition, r); end if;
  if p_kind = 'players' then return _players_rules(p_competition, r); end if;
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
  if p_kind = 'players' then
    ttl := 'The box pool';
    insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
    perform _sys('general', format('🏒 The box pool is open: take one player from each of %s boxes. Goals and assists count, and a goalie''s wins and shutouts, from %s to %s. Your team locks at the first puck drop.',
      jsonb_array_length(r->'boxes'), to_char((r->>'from')::date, 'FMDay FMMonth FMDD'), to_char((r->>'to')::date, 'FMDay FMMonth FMDD')),
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
  elsif g.kind = 'players' then
    out := out || jsonb_build_object('players', _players_board(g.id, me));
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
  from pool_games g where g.league_id = current_league_id()
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;


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


create or replace function public._pool_game_locked(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case g.kind
    when 'series' then exists (select 1 from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
                               and (s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now())))
    when 'rank' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'bracket' then coalesce(_rank_lock(g.id) <= now(), false)
    when 'players' then coalesce(_players_lock(g.id) <= now(), false)
    when 'squares' then g.draw is not null or exists (select 1 from pool_picks pk where pk.game_id = g.id)
    when 'pickem' then exists (select 1 from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id
                               where pk.game_id = g.id and (f.state <> 'scheduled' or f.kickoff <= now()))
    else true end
  from pool_games g where g.id = p_game
$$;
revoke execute on function public._pool_game_locked(bigint) from public, anon, authenticated;


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
                                           else pk.thing = case when s.id = 0 then case when g.kind = 'bracket' then 'bracket' else 'rank' end else case when g.kind = 'players' then 'box' else 's:' || s.id end end end)) end)
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
        when 'players' then case when t.right_calls + t.exact > 0 then format('%s goal%s, %s assist%s', t.right_calls, case when t.right_calls = 1 then '' else 's' end,
                                                                   t.exact, case when t.exact = 1 then '' else 's' end)
                                 when t.picked > 0 then 'Team in' else 'No team yet' end
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
revoke execute on function public.pool_event_list() from public;
grant execute on function public.pool_event_list() to anon, authenticated;


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
  if g.kind = 'players' and exists (select 1 from pool_picks where game_id = g.id)
     and _players_rules(g.competition, (g.rules - 'boxes') || coalesce(p_rules, '{}') || jsonb_build_object('boxes', g.rules->'boxes'))->>'key' <> g.rules->>'key' then
    raise exception 'Teams are in, so the boxes stay: the size, the nights and the scoring change only before anyone picks';
  end if;
  if g.kind = 'pickem' and coalesce(p_rules->>'preset', g.rules->>'preset') <> g.rules->>'preset'
     and exists (select 1 from pool_picks where game_id = g.id) then
    raise exception 'Picks are in, so the scoring stays: it changes only before anyone picks';
  end if;
  -- what was worked out from a preset is worked out again from the new one
  base := g.rules - 'points' - 'length' - 'exact_only' - 'weights' - 'draws' - 'per';
  r := _pool_game_rules(g.kind, g.competition, base || coalesce(p_rules, '{}')
         || jsonb_strip_nulls(jsonb_build_object('from_round', g.rules->'from_round', 'series', g.rules->'series')));
  update pool_games set rules = r where id = g.id;
  perform _sys('general', format('📝 The host changed the rules of %s before the first lock.', g.title), jsonb_build_object('pool_game', g.id));
  return r;
end $$;
revoke execute on function public.pool_game_set_rules(bigint, jsonb) from public, anon;
grant execute on function public.pool_game_set_rules(bigint, jsonb) to authenticated;


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
  if g.kind = 'pickem' then
    out := to_jsonb(_pickem_save_as(p_team, g.id, (p_pick->>'round')::int, p_pick->'picks'));
  elsif g.kind in ('series', 'rank', 'bracket', 'players') then
    out := _pool_game_pick_as(p_team, g.id, p_pick->>'thing', p_pick->'pick');
  else
    raise exception 'Squares are claimed by each player, with their own coins';
  end if;
  if p_team <> my_team() then
    perform _pool_alert(p_team, 'pool_game', format('📝 The host entered a pick for you in %s.', g.title), '/picks?g=' || g.id);
  end if;
  return out;
end $$;
revoke execute on function public.pool_host_pick(bigint, int, jsonb) from public, anon;
grant execute on function public.pool_host_pick(bigint, int, jsonb) to authenticated;


create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_settle(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;


create or replace function public.pool_game_chances(p_game bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g pool_games; out jsonb; last date;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return '[]'; end if;
  if g.status = 'done' then
    return coalesce((select jsonb_agg(jsonb_build_object('team_id', w, 'chance', round(1.0 / cardinality(g.winners), 3))) from unnest(g.winners) w), '[]');
  end if;
  if g.kind = 'pickem' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _pickem_chances(p_game) c;
    -- the forecast resolves with the game's last match
    last := (select max(f.date) from fixtures f where f.competition = g.competition and f.gameweek <= (g.rules->>'to_round')::int);
  elsif g.kind = 'series' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _series_chances(p_game) c;
    -- with the last series' last scheduled game, or in a month if its games aren't drawn yet
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'bracket' then
    -- a bracket is the member's to change until it locks
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _bracket_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'rank' then
    -- the order is the member's to change until the lock; after it, the wins decide
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _rank_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  else
    return '[]';
  end if;
  -- the forecast, once a day per member
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'pool_win', jsonb_build_object('game', g.id, 'team_id', (e->>'team_id')::int, 'date', today_et()),
    (e->>'chance')::numeric, g.kind, coalesce(last, today_et()), jsonb_build_object('members', jsonb_array_length(out))
  from jsonb_array_elements(coalesce(out, '[]')) e
  on conflict (league_id, kind, subject) do nothing;
  return coalesce(out, '[]');
end $$;
revoke execute on function public.pool_game_chances(bigint) from public, anon;
grant execute on function public.pool_game_chances(bigint) to authenticated;


