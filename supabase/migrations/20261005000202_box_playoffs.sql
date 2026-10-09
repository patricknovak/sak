-- The box pool on the Stanley Cup playoffs (docs/DEVELOPMENT.md §6 item 7, the design of 8 October 2026): the same game
-- on an NHL series competition (`nhl-post-2027`, filled by mlb-sync from the NHL's bracket, migration 191).
-- * The window runs from the first round's first puck drop to the Cup final; playoff games (type 3) count as regular
--   ones do (a regular-season window ends before the playoffs, so nothing changes for it).
-- * The boxes are dealt from the sixteen clubs in the first round, on each club's expected playoff games
--   (`nhl_teams.exp_po_games`, kept by nhl-sync's standings task) where the regular season counts the window's schedule.
-- * A club that loses a series is out: its players are shaded and have nothing still to come. A club still in has the
--   more of its scheduled games and its expected games less those it has played (`_box_team_games`, read by the board,
--   the chance to win and the forecast).
-- * It locks at the first puck drop of the first round and is done when the final series is.
-- * The start page and the host's desk offer it on an NHL series event before its first round starts.

-- has a club lost a series of this postseason
create or replace function public._box_club_out(p_competition text, p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from series s join clubs c on c.id = case when s.winner = s.high_club then s.low_club else s.high_club end
                 where s.competition = p_competition and s.state = 'final' and s.winner is not null and c.short = p_team)
$$;

-- a club's games in a box pool (all of them, or those still to come): the window's schedule in the regular season; in the
-- playoffs, the games played and, for a club still in, the more of its scheduled games and the games it's expected to
-- play from here (nhl_teams.exp_po_games, which already counts the series as they stand)
create or replace function public._box_team_games(p_game bigint, p_team text, p_left boolean) returns numeric
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  win as (select b.* from g cross join lateral _box_games((g.rules->>'from')::date, (g.rules->>'to')::date) b where p_team in (b.home, b.away))
  select case when not coalesce((g.rules->>'playoffs')::boolean, false) then
      (select count(*) from win where not p_left or state = 'FUT')::numeric
    else case when p_left then 0 else (select count(*) from win where state in ('OFF', 'FINAL')) end
      + case when _box_club_out(g.competition, p_team) then 0
          else greatest((select count(*) from win where state = 'FUT'), coalesce((select exp_po_games from nhl_teams where abbrev = p_team), 8)) end end
  from g
$$;
revoke execute on function public._box_club_out(text, text) from public, anon, authenticated;
revoke execute on function public._box_team_games(bigint, text, boolean) from public, anon, authenticated;

-- the playoffs' boxes: the first round's clubs, each player ranked by his rate a game times his club's expected playoff
-- games, dealt in order as the season's boxes are
create or replace function public._players_boxes_po(p_clubs text[], p_scoring jsonb, p_f int, p_d int, p_g int, p_size int) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select pl.id, case when pl.pos = 'G' then 'G' when pl.pos = 'D' then 'D' else 'F' end grp,
          coalesce((select exp_po_games from nhl_teams where abbrev = pl.nhl_team), 8) * coalesce(_box_rate(pl.id, p_scoring), 0) expect
        from players pl
        where pl.status = 'active' and pl.nhl_team = any (p_clubs) and pl.proj_stats is not null
          and (pl.injury_status is null or pl.injury_status = 'Day-To-Day')),
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
revoke execute on function public._players_boxes_po(text[], jsonb, int, int, int, int) from public, anon, authenticated;

-- a box pool's games: the playoffs' too
create or replace function public._box_games(p_from date, p_to date)
returns table (id bigint, date date, start_utc timestamptz, home text, away text, state text)
language sql stable security definer set search_path = public as $$
  select g.id, g.date, g.start_utc, g.home, g.away, g.state from games g where g.game_type in (2, 3) and g.date between p_from and p_to
$$;
revoke execute on function public._box_games(date, date) from public, anon, authenticated;


-- what each player scored: playoff games too
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
    and exists (select 1 from games x where x.id = pg.game_id and x.game_type in (2, 3))
  group by p.team_id, p.player_id
$$;
revoke execute on function public._players_scored(bigint) from public, anon, authenticated;


-- a box pool's rules: the playoffs' branch
create or replace function public._players_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); preset text; len text; d_from date; d_to date; sc jsonb; k text; key text; boxes jsonb;
  nf int; nd int; ng int; sz int; last_night date;
begin
  preset := coalesce(r->>'preset', 'classic');
  if preset not in ('classic', 'quick') then raise exception 'Pick a size: Classic or Quick'; end if;
  -- the Stanley Cup playoffs: the first round's clubs, from its first puck drop to the final
  if (select format = 'series' and sport = 'nhl' from competitions where id = p_competition) then
    if not exists (select 1 from series where competition = p_competition and round = 1)
       or exists (select 1 from series where competition = p_competition and round = 1 and (high_club is null or low_club is null)) then
      raise exception 'The first round isn''t set yet';
    end if;
    if exists (select 1 from series where competition = p_competition and round = 1 and (state <> 'scheduled' or starts_at <= now())) then
      raise exception 'The playoffs have started';
    end if;
    d_from := ((select min(starts_at) from series where competition = p_competition and round = 1) at time zone 'America/New_York')::date;
    d_to := d_from + 75;
    sc := jsonb_build_object('g', 1, 'a', 1, 'w', 2, 'sho', 1) || coalesce(r->'scoring', '{}');
    for k in select jsonb_object_keys(sc) loop
      if k not in ('g', 'a', 'w', 'sho') or coalesce((sc->>k)::int, -1) not between 0 and 10 then raise exception 'Points are whole numbers from 0 to 10'; end if;
    end loop;
    select f, d, g, s into nf, nd, ng, sz from (values ('classic', 7, 2, 1, 6), ('quick', 3, 1, 1, 5)) v(p, f, d, g, s) where v.p = preset;
    key := format('po|%s|%s|%s', preset, d_from, sc::text);
    boxes := case when r->>'key' = key and jsonb_typeof(r->'boxes') = 'array' then r->'boxes'
      else _players_boxes_po((select array_agg(distinct c.short) from series x join clubs c on c.id in (x.high_club, x.low_club)
                              where x.competition = p_competition and x.round = 1), sc, nf, nd, ng, sz) end;
    if jsonb_array_length(boxes) < nf + nd + ng then raise exception 'Not enough players in the playoffs to fill the boxes'; end if;
    return jsonb_build_object('preset', preset, 'length', 'playoffs', 'playoffs', true, 'from', d_from, 'to', d_to, 'scoring', sc, 'boxes', boxes, 'key', key);
  end if;
  if (select format from competitions where id = p_competition) is distinct from 'players' then raise exception 'That event has no box pool'; end if;
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


-- the lock: the first round's first puck drop until the night's games are in
create or replace function public._players_lock(p_game bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(min(b.start_utc), (select min(s.starts_at) from series s where s.competition = g.competition and s.round = 1))
  from pool_games g left join lateral _box_games((g.rules->>'from')::date, (g.rules->>'from')::date) b on true
  where g.id = p_game and g.kind = 'players'
  group by g.competition
$$;
revoke execute on function public._players_lock(bigint) from public, anon, authenticated;


-- the board: each club's games, and who's out
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
    'playoffs', coalesce((g.rules->>'playoffs')::boolean, false),
    'clubs_left', case when coalesce((g.rules->>'playoffs')::boolean, false) then
      (select count(distinct c.short) from series x join clubs c on c.id in (x.high_club, x.low_club)
       where x.competition = g.competition and x.round = 1 and not _box_club_out(g.competition, c.short)) end,
    'boxes', coalesce((select jsonb_agg(jsonb_build_object('label', z.label, 'pos', z.pos, 'players', z.players) order by z.box) from (
        select bx.box, bx.label, bx.pos, jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'pos', pl.pos, 'team', pl.nhl_team,
            'headshot', pl.headshot, 'injury', pl.injury_status, 'pts', coalesce(pts.pts, 0), 'g', coalesce(pts.gl, 0), 'a', coalesce(pts.ast, 0),
            'gp', coalesce(pts.gp, 0), 'left', round(_box_team_games(g.id, pl.nhl_team, true))::int,
            'games', round(_box_team_games(g.id, pl.nhl_team, false))::int,
            -- in the playoffs, a player whose club lost a series is out
            'out', coalesce((g.rules->>'playoffs')::boolean, false) and _box_club_out(g.competition, pl.nhl_team),
            -- what he's expected to add in his club's games still to come
            'to_come', round(_box_rate(pl.id, g.rules->'scoring') * _box_team_games(g.id, pl.nhl_team, true), 1),
            -- his next game in the window: under way first, else the next to start
            'next', (select jsonb_build_object('start', w.start_utc, 'state', w.state, 'home', w.home = pl.nhl_team,
                       'opp', case when w.home = pl.nhl_team then w.away else w.home end,
                       'for', case when w.home = pl.nhl_team then x.home_score else x.away_score end,
                       'against', case when w.home = pl.nhl_team then x.away_score else x.home_score end,
                       'line', (select pg.stats from player_games pg where pg.player_id = pl.id and pg.game_id = w.id))
                     from win w join games x on x.id = w.id
                     where pl.nhl_team in (w.home, w.away) and w.state not in ('OFF', 'FINAL')
                     order by (w.state in ('LIVE', 'CRIT')) desc, w.start_utc limit 1),
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


-- done: a playoff pool with its final
create or replace function public._players_settle(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; top record; n int := 0;
begin
  for g in select * from pool_games where league_id = p_league and kind = 'players' and status = 'open'
             and ((rules->>'to')::date < today_et()
                  or (coalesce((rules->>'playoffs')::boolean, false) and exists (select 1 from series s where s.competition = pool_games.competition
                        and s.round = (select max(round) from series x where x.competition = pool_games.competition) and s.state = 'final'))) loop
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
    -- the host: deal the next one
    perform _pool_alert(tm.id, 'pool_game', format('🏒 %s is done. Deal the next one from the Host page: fresh boxes, and everyone starts level.', g.title), '/host')
    from teams tm where tm.league_id = g.league_id and tm.is_commish;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._players_settle(int) from public, anon, authenticated;


-- the chance to win: each club's games still to come
create or replace function public._players_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'players'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  picks as (select pk.team_id, (e #>> '{}')::int player_id from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
            cross join lateral jsonb_array_elements(pk.pick->'players') e),
  now_pts as (select s.team_id, sum(s.points)::numeric pts from _players_scored(p_game) s group by s.team_id),
  -- what each player taken is expected to add: his rate a game times his club's games still to come
  lam as (select pl.id player_id,
            _box_team_games(p_game, pl.nhl_team, true)
            * least(1.0, coalesce((pl.proj_stats->>'gp')::numeric, 0) / 82.0)
            * case when coalesce((pl.proj_stats->>'gp')::numeric, 0) > 0 then
                (case when pl.pos = 'G'
                   then coalesce((pl.proj_stats->>'w')::numeric, 0) * coalesce((g.rules->'scoring'->>'w')::numeric, 2)
                      + coalesce((pl.proj_stats->>'sho')::numeric, 0) * coalesce((g.rules->'scoring'->>'sho')::numeric, 1)
                   else coalesce((pl.proj_stats->>'g')::numeric, 0) * coalesce((g.rules->'scoring'->>'g')::numeric, 1)
                      + coalesce((pl.proj_stats->>'a')::numeric, 0) * coalesce((g.rules->'scoring'->>'a')::numeric, 1) end)
                / (pl.proj_stats->>'gp')::numeric
              else 0 end lam
          from players pl, g where pl.id in (select player_id from picks)),
  runs as (select generate_series(1, p_runs) r),
  draws as (select r.r, l.player_id,
              greatest(0, round(l.lam + sqrt(l.lam) * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()))) pts
            from runs r cross join lam l),
  totals as (select d.r, p.team_id, sum(d.pts) + coalesce(max(n.pts), 0) total
             from picks p join draws d on d.player_id = p.player_id left join now_pts n on n.team_id = p.team_id
             group by d.r, p.team_id),
  best as (select r, max(total) top from totals group by r),
  wins as (select t.team_id, 1.0 / count(*) over (partition by t.r) share
           from totals t join best b on b.r = t.r and t.total = b.top)
  select m.id::int, round(coalesce((select sum(share) from wins w where w.team_id = m.id), 0) / p_runs, 3)
  from members m
$$;
revoke execute on function public._players_chances(bigint, int) from public, anon, authenticated;


-- the forecast: each club's games
create or replace function public._players_log(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'box_points', jsonb_build_object('game', g.id, 'team_id', pk.team_id),
    round(sum(_box_rate((e #>> '{}')::int, g.rules->'scoring')
      * _box_team_games(g.id, (select nhl_team from players where id = (e #>> '{}')::int), false)), 1),
    'projection', (g.rules->>'to')::date + 1, jsonb_build_object('players', count(*), 'preset', g.rules->>'preset')
  from pool_games g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
  cross join lateral jsonb_array_elements(pk.pick->'players') e
  where g.league_id = p_league and g.kind = 'players' and g.status = 'open' and coalesce(_players_lock(g.id) <= now(), false)
  group by g.league_id, g.id, pk.team_id, g.rules
  on conflict (league_id, kind, subject) do nothing;
  get diagnostics k = row_count;
  return k;
end $$;
revoke execute on function public._players_log(int) from public, anon, authenticated;


-- the start page: the box pool on the NHL playoffs
create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    -- and the Stanley Cup playoffs, before the first round with every club in it, the box pool
    select jsonb_set(e, '{kinds}', coalesce(e->'kinds', '[]')
             || case when e ? 'open_round' and _bracket_ok(e->>'competition', (e->>'open_round')::int) then '["bracket"]'::jsonb else '[]'::jsonb end
             || case when e->>'sport' = 'nhl' and (e->>'open_round')::int = 1
                       and not exists (select 1 from series s where s.competition = e->>'competition' and s.round = 1 and (s.high_club is null or s.low_club is null))
                     then '["players"]'::jsonb else '[]'::jsonb end) e
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


-- the news: the playoff box pool
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
    perform _sys('general', format('🔲 %s are open: %s coins a square, %s. The digits are drawn when the grid fills or at %s, and the pot pays %s.',
      ttl, r->>'cost', case when (r->>'size')::int = 10 then '100 squares' else '25 squares with two digits a side' end,
      case when s.best_of > 1 then format('the %s of Game 1', _sport_word(p_competition, 'start', 'first pitch')) else _sport_word(p_competition, 'start', 'first pitch') end,
      case r->>'pays' when 'innings' then 'after the 3rd, the 6th and the final of every game'
        when 'quarters' then 'after the 1st quarter, at the half, after the 3rd quarter and on the final'
        when 'periods' then 'after the 1st period, the 2nd and the final' || case when s.best_of > 1 then ' of every game' else '' end
        else 'the final score' || case when s.best_of > 1 then ' of every game' else '' end end),
      jsonb_build_object('pool_game', gid));
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
    when 'series' then format('⚔️ Pick the series is on, from the %s: call each series%s. Each pick locks at its %s.', fr_label,
      case when (select max(best_of) from series where competition = p_competition) > 1 then ' and how many games it goes' else '' end,
      case when (select max(best_of) from series where competition = p_competition) > 1 then 'Game 1''s ' else 'game''s ' end || _sport_word(p_competition, 'start', 'start'))
    when 'bracket' then format('🏆 The bracket is open, from the %s: pick the winner of every series through to the final, all before the first game. Later rounds are worth more.', fr_label)
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first %s of the round.', fr_label, _sport_word(p_competition, 'start', 'start')) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;


