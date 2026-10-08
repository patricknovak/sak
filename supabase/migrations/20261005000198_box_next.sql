-- The next box pool (docs/POOL-TYPES.md §2.7, "a second-half pool keeps them"): when a box pool is done, the host
-- hears it with an invitation to deal the next one, fresh boxes and everyone level, so a group whose players went cold
-- has a reason to come back.

-- a box pool done: the winners, the news, and the host's invitation to deal the next
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
    -- the host: deal the next one
    perform _pool_alert(tm.id, 'pool_game', format('🏒 %s is done. Deal the next one from the Host page: fresh boxes, and everyone starts level.', g.title), '/host')
    from teams tm where tm.league_id = g.league_id and tm.is_commish;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._players_settle(int) from public, anon, authenticated;

