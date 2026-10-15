-- Drop the worst rounds in pick'em (docs/POOL-TYPES.md §2.4, 15 October 2026): Yahoo's knob for a season-long pool,
-- so a member who missed a week, or joined late, is still in it. `rules.drop` (0 to 3, none by default) takes each
-- member's lowest finished rounds off their points and what's still possible, once more rounds are finished than are
-- dropped; the round's own winner is unchanged. The week-by-week grid marks the dropped rounds.

create or replace function public._pickem_rules(p_competition text, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ev record; fr int; tr int; preset text; draws boolean; ats boolean; missed text; drop_n int;
begin
  draws := coalesce((select (s.config->>'draws')::boolean from competitions c join sports s on s.id = c.sport where c.id = p_competition), false);
  -- against the spread: each pick is on a side with the market's line at the moment it is made; a sport with draws
  -- (soccer) plays its own handicaps, so it stays straight up
  ats := coalesce((r->>'ats')::boolean, false);
  if ats and draws then raise exception 'Against the spread is for sports without draws'; end if;
  select * into ev from _pickem_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  if ev.open_round is null then raise exception 'Every round of that event has started'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr < ev.open_round then raise exception 'That round is over; start from the next one'; end if;
  tr := coalesce((r->>'to_round')::int, ev.last_round);
  if fr > ev.last_round or tr < fr or tr > ev.last_round then raise exception 'No such round'; end if;
  preset := coalesce(r->>'preset', 'classic');
  if preset not in ('classic', 'confidence') then raise exception 'Pick a scoring: Classic or Confidence'; end if;
  -- a pick nobody made: zero (the default), or the market's favourite at kick-off (migration 285)
  missed := coalesce(r->>'missed', 'zero');
  if missed not in ('zero', 'favourite') then raise exception 'A missed pick scores zero or takes the favourite'; end if;
  -- the worst rounds dropped from each member's total (migration 294): none by default, up to three
  drop_n := coalesce((r->>'drop')::int, 0);
  if drop_n not between 0 and 3 then raise exception 'Drop none, or up to three of the worst rounds'; end if;
  return jsonb_build_object('preset', preset, 'from_round', fr, 'to_round', tr, 'draws', draws)
    || case when ats then '{"ats": true}'::jsonb else '{}'::jsonb end
    || case when missed = 'favourite' then '{"missed": "favourite"}'::jsonb else '{}'::jsonb end
    || case when drop_n > 0 then jsonb_build_object('drop', drop_n) else '{}'::jsonb end;
end $$;

create or replace function public._pickem_table(p_game bigint)
returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  -- each match as this pool reads it: the host's word (migration 172) before the feed's
  fx as (select f.id, f.gameweek, (o.outcome is null and f.state = 'scheduled' and f.kickoff > now()) open, o.outcome is not null by_host,
           case when o.outcome is not null then o.home else coalesce(f.home_ft, f.home_score) end h,
           case when o.outcome is not null then o.away else coalesce(f.away_ft, f.away_score) end a,
           coalesce(o.outcome = 'void', f.state in ('postponed', 'cancelled')) void,
           case when o.outcome in ('H', 'D', 'A') then o.outcome
                when o.outcome is null and f.state = 'final' then _fixture_result(coalesce(f.home_ft, f.home_score), coalesce(f.away_ft, f.away_score)) end res
         from fixtures f cross join g left join pool_result_overrides o on o.league_id = g.league_id and o.fixture_id = f.id
         where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
  -- each pick's result as it reads it: against the spread, whether its side covered the line it was made at
  pk as (select p.team_id, fx.id, fx.gameweek, fx.void, _pick_res(g.rules, p.pick, fx.res, fx.by_host, fx.h, fx.a) res, p.pick->>'pick' pp,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  rn as (select fx.gameweek, count(*)::int n from fx group by fx.gameweek),
  -- each member's matches still open and not picked, round by round
  ou as (select m.id team_id, fx.gameweek, count(*)::int k from members m cross join fx
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.id = fx.id) group by 1, 2),
  -- in Confidence those matches can still take the highest numbers not yet used that round
  free as (select ou.team_id, ou.k, w.w, row_number() over (partition by ou.team_id, ou.gameweek order by w.w desc) r
           from ou join rn on rn.gameweek = ou.gameweek cross join lateral generate_series(1, rn.n) w(w)
           where not exists (select 1 from pk where pk.team_id = ou.team_id and pk.gameweek = ou.gameweek and pk.w = w.w)),
  -- the worst rounds dropped (migration 294, `rules.drop`): each member's lowest finished rounds, once more rounds are
  -- finished than are dropped, come off the points and what's still possible
  rd as (select fx.gameweek r from fx group by fx.gameweek having bool_and(fx.res is not null or fx.void)),
  rp as (select m.id team_id, rd.r, coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.gameweek = rd.r and pk.res is not null and pk.pp = pk.res), 0) pts
         from members m cross join rd),
  dr as (select x.team_id, sum(x.pts) d from (select rp.*, row_number() over (partition by rp.team_id order by rp.pts, rp.r) k,
                                                      count(*) over (partition by rp.team_id) n from rp) x
         where x.k <= coalesce((select (rules->>'drop')::int from g), 0) and x.n > coalesce((select (rules->>'drop')::int from g), 0)
         group by x.team_id)
  select m.id::int,
    (coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res), 0)
      - coalesce((select dr.d from dr where dr.team_id = m.id), 0))::int,
    (coalesce((select sum(pk.w) from pk where pk.team_id = m.id and ((pk.res is not null and pk.pp = pk.res) or (pk.res is null and not pk.void))), 0)
      + case when (select c from conf) then coalesce((select sum(f.w) from free f where f.team_id = m.id and f.r <= f.k), 0)
             else coalesce((select sum(ou.k) from ou where ou.team_id = m.id), 0) end
      - coalesce((select dr.d from dr where dr.team_id = m.id), 0))::int,
    (select count(*) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res)::int,
    0,
    (select count(*) from pk where pk.team_id = m.id)::int,
    -- the tiebreaker: how far off the total in the last game of the latest round played (lower is better)
    _pickem_miss(p_game, m.id, (select _pickem_tb_round(p_game)))
  from members m
$$;

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
    -- a round shows once one of its games has a result (a game put off alone doesn't start it, migration 292)
    rounds as (select fx.r, bool_and(fx.done) done from fx group by fx.r having bool_or(fx.res is not null)),
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
      'drop', coalesce((g.rules->>'drop')::int, 0),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('team_id', m.id,
          'weeks', coalesce((select jsonb_object_agg(x.r::text, x.pts) from grid x where x.team_id = m.id), '{}'),
          -- the rounds dropped from the total (migration 294): the lowest finished ones, as the table counts them
          'dropped', coalesce((select jsonb_agg(y.r order by y.r) from (
              select x.r, row_number() over (order by x.pts, x.r) k, count(*) over () n from grid x where x.team_id = m.id and x.done) y
            where y.k <= coalesce((g.rules->>'drop')::int, 0) and y.n > coalesce((g.rules->>'drop')::int, 0)), '[]'))) from members m), '[]'))
  );
end $$;
