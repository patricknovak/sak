-- The box pool's morning line (docs/POOL-TYPES.md §2.7): once every game of a night in the window is final, the pool's
-- chat hears who had the night (the most points that night, with their best player's line) and who leads. Posted once
-- a night: the night goes in the game's `posted` list as yyyymmdd. The hourly pool job runs it; a night with no points
-- for anyone passes quietly.

create or replace function public._players_recap(p_league int, p_day date default null) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; d date := coalesce(p_day, today_et() - 1); key bigint := to_char(coalesce(p_day, today_et() - 1), 'YYYYMMDD')::bigint;
  night record; star record; lead record; n int := 0;
begin
  for g in select * from pool_games where league_id = p_league and kind = 'players' and status = 'open'
             and d between (rules->>'from')::date and (rules->>'to')::date
             and coalesce(_players_lock(id) <= now(), false)
             and not (key = any (coalesce(posted, '{}'))) loop
    -- the night is over: it had games, and every one is final
    if not exists (select 1 from _box_games(d, d)) or exists (select 1 from _box_games(d, d) b where b.state not in ('OFF', 'FINAL')) then continue; end if;
    -- each member's points that night, the best first
    select pk.team_id, sum(_box_points(pg.stats, g.rules->'scoring'))::int pts into night
    from pool_picks pk cross join lateral jsonb_array_elements(pk.pick->'players') e
    join player_games pg on pg.player_id = (e #>> '{}')::int and pg.date = d and pg.game_id in (select id from _box_games(d, d))
    where pk.game_id = g.id and pk.thing = 'box'
    group by pk.team_id order by 2 desc, 1 limit 1;
    if coalesce(night.pts, 0) > 0 then
      -- their best player that night
      select pl.name, (pg.stats->>'g')::int gl, (pg.stats->>'a')::int ast, (pg.stats->>'w')::int win, _box_points(pg.stats, g.rules->'scoring') pts into star
      from pool_picks pk cross join lateral jsonb_array_elements(pk.pick->'players') e
      join player_games pg on pg.player_id = (e #>> '{}')::int and pg.date = d and pg.game_id in (select id from _box_games(d, d))
      join players pl on pl.id = pg.player_id
      where pk.game_id = g.id and pk.thing = 'box' and pk.team_id = night.team_id
      order by 5 desc, pl.name limit 1;
      select tm.gm_name, t.points into lead from _players_table(g.id) t join teams tm on tm.id = t.team_id order by t.points desc, tm.gm_name limit 1;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏒 Last night in %s: %s had the night, +%s (%s%s). %s',
          lower(g.title), (select gm_name from teams where id = night.team_id), night.pts, star.name,
          case when coalesce(star.win, 0) > 0 then ' with the win'
               else format(': %s', concat_ws(', ', case when star.gl > 0 then star.gl || ' G' end, case when star.ast > 0 then star.ast || ' A' end)) end,
          case when lead.gm_name = (select gm_name from teams where id = night.team_id) then format('%s leads with %s.', lead.gm_name, lead.points)
               else format('%s still leads, with %s.', lead.gm_name, lead.points) end),
        jsonb_build_object('pool_game', g.id, 'night', d), g.league_id);
      n := n + 1;
    end if;
    update pool_games set posted = coalesce(posted, '{}') || key where id = g.id;
  end loop;
  return n;
end $$;
revoke execute on function public._players_recap(int, date) from public, anon, authenticated;

-- the hourly pool job: the morning line before the settling
create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

