-- Who plays tonight in the box pool: the board sends each player's next game in the window (its puck drop, whether
-- it's on, the club he faces and the score so far), so a member sees which of theirs are on tonight and how it's going.

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
            -- what he's expected to add in his club's games still to come
            'to_come', round(_box_rate(pl.id, g.rules->'scoring') * (select count(*) from win w where w.state = 'FUT' and pl.nhl_team in (w.home, w.away)), 1),
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

