-- Week by week in pick'em (15 October 2026): every member's points in each round played so far, and each finished
-- round's winner (the most points, the closest tiebreaker breaking a tie, migration 284; nobody with a point, no
-- winner). The office pool's grid, read on the pool's pick'em page beside the table. Worked out on read from the same
-- results as the table (`_pick_res` on the pool's own result and score), so a corrected result corrects the grid.
create or replace function public.pool_pickem_weeks(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id() and kind = 'pickem';
  if g.id is null then return null; end if;
  return (
    with fx as (select f.id, f.gameweek r, e.res, e.by_host, e.done,
                  _pool_score(g.league_id, f.id, true) h, _pool_score(g.league_id, f.id, false) a
                from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
    rounds as (select fx.r, bool_and(fx.done) done from fx group by fx.r having bool_or(fx.done)),
    members as (select tm.id from teams tm where tm.league_id = g.league_id and tm.role = 'gm'),
    pts as (select p.team_id, fx.r,
              sum(case when g.rules->>'preset' = 'confidence' then coalesce((p.pick->>'conf')::int, 1) else 1 end)
                filter (where fx.res is not null and p.pick->>'pick' = _pick_res(g.rules, p.pick, fx.res, fx.by_host, fx.h, fx.a))::int pts
            from pool_picks p join fx on p.thing = 'f:' || fx.id
            where p.game_id = g.id group by 1, 2),
    grid as (select m.id team_id, rd.r, rd.done, coalesce(pt.pts, 0) pts,
               rank() over (partition by rd.r order by coalesce(pt.pts, 0) desc, coalesce(_pickem_miss(g.id, m.id, rd.r), 1000000)) rk
             from members m cross join rounds rd left join pts pt on pt.team_id = m.id and pt.r = rd.r)
    select jsonb_build_object('word', _round_word(g.competition),
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', rd.r, 'done', rd.done,
          'winners', case when rd.done then (select coalesce(jsonb_agg(x.team_id order by x.team_id), '[]') from grid x where x.r = rd.r and x.rk = 1 and x.pts > 0) else '[]' end)
          order by rd.r) from rounds rd), '[]'),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('team_id', m.id,
          'weeks', coalesce((select jsonb_object_agg(x.r::text, x.pts) from grid x where x.team_id = m.id), '{}'))) from members m), '[]'))
  );
end $$;
revoke execute on function public.pool_pickem_weeks(bigint) from public, anon;
grant execute on function public.pool_pickem_weeks(bigint) to authenticated;
