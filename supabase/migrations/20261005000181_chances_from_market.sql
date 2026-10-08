-- Chance to win from the market (docs/DEVELOPMENT.md §6 item 6): a pick'em played out from here (migration 175) drew each
-- match from the pool's own split; where the feed carries the market's line on a match (migration 178), that is the
-- better guess at how it goes, so the run draws from it (renormalised to the sides the sport has: a no-draw sport's two).
-- The pool's split stays the fallback for a match with no line.

create or replace function public._pickem_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'pickem'),
  conf as (select coalesce((select rules->>'preset' = 'confidence' from g), false) c),
  k as (select case when coalesce((select (sp.config->>'draws')::boolean from g join competitions c on c.id = g.competition join sports sp on sp.id = c.sport), false)
                    then 3 else 2 end n),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points from members m left join _pickem_table(p_game) t on t.team_id = m.id),
  -- the matches still to be decided, and each round's size (for the average Confidence number)
  fx as (select f.id, f.gameweek, x.open from g join fixtures f on f.competition = g.competition
           cross join lateral _pool_fixture(g.league_id, f.id) x
         where f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int and not x.done),
  rs as (select f.gameweek, count(*) n from g join fixtures f on f.competition = g.competition
         where f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int group by 1),
  pk as (select p.team_id, fx.id fid, p.pick->>'pick' side,
           case when (select c from conf) then coalesce((p.pick->>'conf')::int, 1) else 1 end w
         from pool_picks p join g on p.game_id = g.id join fx on p.thing = 'f:' || fx.id),
  -- each match's chances: the market's at kick-off where the feed carries a line (migration 178), else the pool's split
  -- with one more pick on every side
  pr as (select x.fid,
           coalesce(case when (o->>'home') is not null then (o->>'home')::numeric / ((o->>'home')::numeric + (o->>'away')::numeric
                                                                                     + case when (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0) else 0 end) end, x.ph) ph,
           coalesce(case when (o->>'home') is not null and (select n from k) = 3 then coalesce((o->>'draw')::numeric, 0)
                           / ((o->>'home')::numeric + (o->>'away')::numeric + coalesce((o->>'draw')::numeric, 0)) end, x.pd) pd
         from (select fx.id fid,
                 (count(pk.side) filter (where pk.side = 'H') + 1.0) / (count(pk.side) + (select n from k)) ph,
                 case when (select n from k) = 3 then (count(pk.side) filter (where pk.side = 'D') + 1.0) / (count(pk.side) + 3) else 0 end pd
               from fx left join pk on pk.fid = fx.id group by fx.id) x
         left join lateral (select fi.detail->'odds' o from fixtures fi where fi.id = x.fid) m on true),
  -- a member's open matches with no pick yet: a guess
  un as (select m.id team_id, case when (select c from conf) then (rs.n + 1) / 2.0 else 1 end w
         from members m cross join fx join rs on rs.gameweek = fx.gameweek
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.fid = fx.id)),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  outcome as (select r.s, pr.fid, case when x.u < pr.ph then 'H' when x.u < pr.ph + pr.pd then 'D' else 'A' end res
              from runs r cross join pr cross join lateral (select random() + 0 * r.s u) x),
  gain as (select o.s, pk.team_id, sum(pk.w) w from outcome o join pk on pk.fid = o.fid and pk.side = o.res group by 1, 2),
  -- up to twenty open matches, each guess drawn; beyond that (a season still to play), the sum of the guesses is
  -- drawn whole from its normal shape (mean and spread of that many coin flips), which keeps a long season quick
  uc as (select team_id, count(*) n, sum(w) sw, sum(w * w) sw2 from un group by 1),
  guess as (select r.s, un.team_id, sum(un.w) filter (where random() + 0 * r.s < 1.0 / (select n from k)) w
            from runs r cross join un join uc on uc.team_id = un.team_id and uc.n <= 20 group by 1, 2
            union all
            select r.s, uc.team_id, greatest(0, uc.sw / kk.n + sqrt(uc.sw2 * (1.0 / kk.n) * (1 - 1.0 / kk.n))
                                                  * sqrt(-2 * ln(1 - random() + 0 * r.s)) * cos(2 * pi() * random()))
            from runs r cross join uc cross join k kk where uc.n > 20),
  total as (select r.s, p.id team_id, p.points + coalesce(ga.w, 0) + coalesce(gu.w, 0) t
            from runs r cross join pts p
            left join gain ga on ga.s = r.s and ga.team_id = p.id
            left join guess gu on gu.s = r.s and gu.team_id = p.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select p.id, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from pts p left join won w on w.team_id = p.id group by p.id
$$;
revoke execute on function public._pickem_chances(bigint, int) from public, anon, authenticated;
