-- Review fixes to migration 295 (15 October 2026).
--
-- 1. A round of only games called off still counted as a round worth nothing in "still possible" and in the chances of a
--    pool that drops its worst rounds, so it was "dropped" there while the table never dropped it. It is no round at all.
-- 2. The last round's wait for a tiebreaker total held the pool open even when nobody was level at the top; it waits only
--    when the leaders are level and one of them made a call.
-- And the table's per-round ceilings are summed once per member and round rather than one lookup each (a full NFL
-- season with thirty members had gone from 90 to 330 ms).

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
  free as (select ou.team_id, ou.gameweek, ou.k, w.w, row_number() over (partition by ou.team_id, ou.gameweek order by w.w desc) r
           from ou join rn on rn.gameweek = ou.gameweek cross join lateral generate_series(1, rn.n) w(w)
           where not exists (select 1 from pk where pk.team_id = ou.team_id and pk.gameweek = ou.gameweek and pk.w = w.w)),
  -- the worst rounds dropped (migration 294, `rules.drop`): each member's lowest finished rounds, once more rounds are
  -- finished than are dropped, come off the points and what's still possible
  -- (a round of only games called off is neither finished nor droppable, migration 295)
  rd as (select fx.gameweek r from fx group by fx.gameweek having bool_and(fx.res is not null or fx.void) and bool_or(fx.res is not null)),
  rp as (select m.id team_id, rd.r, coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.gameweek = rd.r and pk.res is not null and pk.pp = pk.res), 0) pts
         from members m cross join rd),
  dr as (select x.team_id, sum(x.pts) d from (select rp.*, row_number() over (partition by rp.team_id order by rp.pts, rp.r) k,
                                                      count(*) over (partition by rp.team_id) n from rp) x
         where x.k <= coalesce((select (rules->>'drop')::int from g), 0) and x.n > coalesce((select (rules->>'drop')::int from g), 0)
         group by x.team_id),
  -- what each member can still reach, round by round (migration 295): a finished round at its points, the rest at their
  -- points plus every pick still to be decided and every match still open; at its best, the lowest of those ceilings
  -- are the rounds dropped, once the game has more rounds than it drops
  -- (a round of only games called off is no round at all, migration 296; each part summed once per member and round)
  rr as (select fx.gameweek r from fx group by fx.gameweek having bool_or(not fx.void)),
  pka as (select pk.team_id, pk.gameweek r, sum(pk.w) filter (where (pk.res is not null and pk.pp = pk.res) or (pk.res is null and not pk.void)) w
          from pk group by 1, 2),
  opa as (select f.team_id, f.gameweek r, sum(f.w) filter (where f.r <= f.k) w from free f where (select c from conf) group by 1, 2
          union all
          select ou.team_id, ou.gameweek, sum(ou.k) from ou where not (select c from conf) group by 1, 2),
  ceil as (select m.id team_id, rr.r, coalesce(pa.w, 0) + coalesce(oa.w, 0) c
           from members m cross join rr
           left join pka pa on pa.team_id = m.id and pa.r = rr.r
           left join opa oa on oa.team_id = m.id and oa.r = rr.r),
  dc as (select x.team_id, sum(x.c) d from (select ceil.*, row_number() over (partition by ceil.team_id order by ceil.c, ceil.r) k from ceil) x
         where x.k <= coalesce((select (rules->>'drop')::int from g), 0) and (select count(*) from rr) > coalesce((select (rules->>'drop')::int from g), 0)
         group by x.team_id)
  select m.id::int,
    (coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res), 0)
      - coalesce((select dr.d from dr where dr.team_id = m.id), 0))::int,
    -- never below the points already banked
    greatest(coalesce((select sum(ce.c) from ceil ce where ce.team_id = m.id), 0) - coalesce((select dc.d from dc where dc.team_id = m.id), 0),
             coalesce((select sum(pk.w) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res), 0)
               - coalesce((select dr.d from dr where dr.team_id = m.id), 0))::int,
    (select count(*) from pk where pk.team_id = m.id and pk.res is not null and pk.pp = pk.res)::int,
    0,
    (select count(*) from pk where pk.team_id = m.id)::int,
    -- the tiebreaker: how far off the total in the last game of the latest round played (lower is better)
    _pickem_miss(p_game, m.id, (select _pickem_tb_round(p_game)))
  from members m
$$;

create or replace function public._pickem_chances_drop(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'pickem'),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  dn as (select coalesce((select (rules->>'drop')::int from g), 0) d),
  k as (select case when coalesce((select (sp.config->>'draws')::boolean from g join competitions c on c.id = g.competition join sports sp on sp.id = c.sport), false)
                    then 3 else 2 end n),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  allfx as (select f.id, f.gameweek, x.open, x.done, x.res, x.void, x.by_host, _pool_score(g.league_id, f.id, true) h, _pool_score(g.league_id, f.id, false) a
            from g join fixtures f on f.competition = g.competition cross join lateral _pool_fixture(g.league_id, f.id) x
            where f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int),
  rr as (select gameweek r from allfx group by 1 having bool_or(not void)),
  rs as (select gameweek, count(*) n from allfx group by 1),
  fx as (select * from allfx where not done),
  -- what each member has banked, round by round
  banked as (select p.team_id, f.gameweek r, sum(case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end) pts
             from pool_picks p join g on p.game_id = g.id join allfx f on p.thing = 'f:' || f.id
             where f.done and f.res is not null and p.pick->>'pick' = _pick_res(g.rules, p.pick, f.res, f.by_host, f.h, f.a)
             group by 1, 2),
  pk as (select p.team_id, fx.id fid, fx.gameweek r, p.pick->>'pick' side,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  pr as (select x.fid,
           coalesce(case when (select rules->>'ats' = 'true' from g) then 0.5 end, case when (o->>'home') is not null then (o->>'home')::numeric / ((o->>'home')::numeric + (o->>'away')::numeric
                     + case when (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0) else 0 end) end, x.ph) ph,
           coalesce(case when (o->>'home') is not null and (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0)
                     / ((o->>'home')::numeric + (o->>'away')::numeric + coalesce((o->>'draw')::numeric, 0)) end, x.pd) pd
         from (select fx.id fid,
                 (count(pk.side) filter (where pk.side = 'H') + 1.0) / (count(pk.side) + (select n from k)) ph,
                 case when (select n from k) = 3 then (count(pk.side) filter (where pk.side = 'D') + 1.0) / (count(pk.side) + 3) else 0 end pd
               from fx left join pk on pk.fid = fx.id group by fx.id) x
         left join lateral (select fi.detail->'odds' o from fixtures fi where fi.id = x.fid) m on true),
  -- each member's open matches with no pick yet, round by round
  uc as (select m.id team_id, fx.gameweek r, count(*) n,
           sum(case when (select c from conf) then (rs.n + 1) / 2.0 else 1 end) sw,
           sum(power(case when (select c from conf) then (rs.n + 1) / 2.0 else 1 end, 2)) sw2
         from members m cross join fx join rs on rs.gameweek = fx.gameweek
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.fid = fx.id) group by 1, 2),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  outcome as (select r.s, pr.fid, case when x.u < pr.ph then 'H' when x.u < pr.ph + pr.pd then 'D' else 'A' end res
              from runs r cross join pr cross join lateral (select random() + 0 * r.s u) x),
  gain as (select o.s, pk.team_id, pk.r, sum(pk.w) w from outcome o join pk on pk.fid = o.fid and pk.side = o.res group by 1, 2, 3),
  guess as (select r.s, uc.team_id, uc.r, greatest(0, uc.sw / kk.n + sqrt(uc.sw2 * (1.0 / kk.n) * (1 - 1.0 / kk.n))
                                                  * sqrt(-2 * ln(1 - random() + 0 * r.s)) * cos(2 * pi() * random())) w
            from runs r cross join uc cross join k kk),
  rounds as (select r.s, m.id team_id, rr.r,
               coalesce(b.pts, 0) + coalesce(ga.w, 0) + coalesce(gu.w, 0) t
             from runs r cross join members m cross join rr
             left join banked b on b.team_id = m.id and b.r = rr.r
             left join gain ga on ga.s = r.s and ga.team_id = m.id and ga.r = rr.r
             left join guess gu on gu.s = r.s and gu.team_id = m.id and gu.r = rr.r),
  total as (select x.s, x.team_id, sum(x.t) filter (where not (x.k <= (select d from dn) and (select count(*) from rr) > (select d from dn))) t
            from (select rounds.*, row_number() over (partition by rounds.s, rounds.team_id order by rounds.t, rounds.r) k from rounds) x
            group by 1, 2),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select m.id::int, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from members m left join won w on w.team_id = m.id group by m.id
$$;

create or replace function public._pickem_round(p_game bigint, p_round int) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; top record; lead record; word text; last_left boolean; t record; w text;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null or g.kind <> 'pickem' or g.status <> 'open' or p_round is null or p_round::bigint = any (g.posted)
     or p_round not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then return; end if;
  if exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
             where f.competition = g.competition and f.gameweek = p_round and not e.done) then return; end if;
  -- the game's last round settled by hand without a score, with tiebreaker calls on its last game: wait for a total
  -- (the feed's final, or the host's score) before naming the winner, so the tiebreaker can still decide it (migration 295)
  if (p_round >= (g.rules->>'to_round')::int
      or not exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                     where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not e.done))
     -- only when the leaders are level and one of them made a call (migration 296): otherwise the tiebreaker decides nothing
     and exists (select 1 from (select x.team_id, rank() over (order by x.points desc) rk from _pickem_table(g.id) x) lt
                 join pool_picks pk on pk.game_id = g.id and pk.team_id = lt.team_id and pk.thing = 't:' || p_round
                 where lt.rk = 1)
     and (select count(*) from (select rank() over (order by x.points desc) rk from _pickem_table(g.id) x) lt where lt.rk = 1) > 1
     and exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                 where f.id = _pickem_last(g.competition, p_round) and e.done and not e.void and _pool_total(g.league_id, f.id) is null) then
    return;
  end if;
  word := _round_word(g.competition);
  w := case when g.rules->>'preset' = 'confidence' then 'conf' end;
  -- the round's best, on that round's picks alone
  -- a tie on points goes to whoever is closest on the round's tiebreaker (migration 284); no tiebreaker, it's shared
  select string_agg(x.gm_name, ' and ' order by x.gm_name) names, max(x.pts) pts, array_agg(x.id) ids into top
  from (select tm.id, tm.gm_name, sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) pts,
               rank() over (order by sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) desc,
                                     coalesce(_pickem_miss(g.id, tm.id, p_round), 1000000)) rk
        from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id cross join lateral _pool_fixture(g.league_id, f.id) e
        join teams tm on tm.id = pk.team_id
        where pk.game_id = g.id and f.gameweek = p_round and pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, _pool_score(g.league_id, f.id, true), _pool_score(g.league_id, f.id, false))
        group by tm.id, tm.gm_name) x where x.rk = 1;
  -- the leader (and at the end the winner): the most points, then the closest on the latest tiebreaker
  select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t2.points) pts, array_agg(t2.team_id) ids into lead
  from (select x.*, rank() over (order by x.points desc, coalesce(x.tiebreak, 1000000)) rk from _pickem_table(g.id) x) t2
  join teams tm on tm.id = t2.team_id
  where t2.rk = 1 and t2.points > 0;
  update pool_games set posted = posted || p_round::bigint where id = g.id;
  last_left := p_round >= (g.rules->>'to_round')::int
    or not exists (select 1 from fixtures f cross join lateral _pool_fixture(g.league_id, f.id) e
                   where f.competition = g.competition and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not e.done);
  if last_left then
    update pool_games set status = 'done', winners = coalesce(lead.ids, '{}') where id = g.id;
    if lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 %s is done: %s, with %s %s.', g.title, lead.names, lead.pts, case when lead.pts = 1 then 'point' else 'points' end),
        jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
    end if;
  elsif top.names is not null then
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('✅ %s %s is done in %s. Top of the %s: %s with %s %s. Leading: %s on %s.', word, p_round, g.title, lower(word), top.names, top.pts,
             case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
      jsonb_build_object('pool_game', g.id, 'round', p_round), g.league_id);
  end if;
  -- each member hears how their round went
  for t in select pk.team_id id, count(pk.id) picked, count(pk.id) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, _pool_score(g.league_id, f.id, true), _pool_score(g.league_id, f.id, false))) rt,
             coalesce(sum(case when w is not null then coalesce((pk.pick->>'conf')::int, 1) else 1 end) filter (where pk.pick->>'pick' = _pick_res(g.rules, pk.pick, e.res, e.by_host, _pool_score(g.league_id, f.id, true), _pool_score(g.league_id, f.id, false))), 0) pts
           from pool_picks pk join fixtures f on pk.thing = 'f:' || f.id and f.gameweek = p_round
           cross join lateral _pool_fixture(g.league_id, f.id) e
           where pk.game_id = g.id group by pk.team_id loop
    perform _pool_alert(t.id, 'pool_game',
      case when top.names is not null and t.id = any (top.ids) then format('🏅 You won %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end)
           else format('✅ %s %s in %s: %s of %s right, %s %s.', word, p_round, g.title, t.rt, t.picked, t.pts, case when t.pts = 1 then 'point' else 'points' end) end,
      '/picks?g=' || g.id);
  end loop;
end $$;
