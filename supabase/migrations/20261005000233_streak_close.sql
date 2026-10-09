-- The daily streak ends with its event (migration 231): once the event has no game still to come (and, played in
-- series, every series is decided, so the wait between rounds never ends it), the hourly pool job marks the streak done,
-- crowns the longest run (the run going at the end breaking a tie, then shared) and tells the pool. Safe to run twice.

create or replace function public._streak_close(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; best record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games pg where pg.league_id = p_league and pg.kind = 'streak' and pg.status = 'open'
             and not exists (select 1 from fixtures f where f.competition = pg.competition and f.state in ('scheduled', 'live'))
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

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _streak_close(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
