-- The chances to win drew one random number per simulated run and shared it across every match, series or line in
-- that run: a draw in a lateral subquery that names only the run is worked out once per run by the planner. So in a run
-- every favourite won together (pick'em), every open series went the same way (Pick the series, Rank the teams), or
-- every line went over together (win totals), and members who leaned all one way took nearly all the credit. Each draw
-- now names its own match, series or line too, so every one is drawn on its own (checked: 30,000 draws, 30,000
-- values). The chances written to the prediction log before today carry the old error.
-- Win totals' hourly run also takes the game's row first, so two runs at once can't tell the pool anything twice; "the
-- surest" call is the widest margin, not the highest share of a few; a pool nobody called anything in hears nothing; the
-- decided line stays inside a message's length. Safe to run twice.

create or replace function public._pickem_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- a pick'em that drops its worst rounds plays each run round by round (migration 295)
  if coalesce((select (rules->>'drop')::int from pool_games where id = p_game), 0) > 0 then
    return query select * from _pickem_chances_drop(p_game, p_runs);
    return;
  end if;
  return query
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
  -- against the spread each pick is on a line set to make it even: a coin flip either way
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
  -- a member's open matches with no pick yet: a guess
  un as (select m.id team_id, case when (select c from conf) then (rs.n + 1) / 2.0 else 1 end w
         from members m cross join fx join rs on rs.gameweek = fx.gameweek
         where fx.open and not exists (select 1 from pk where pk.team_id = m.id and pk.fid = fx.id)),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  outcome as (select r.s, pr.fid, case when x.u < pr.ph then 'H' when x.u < pr.ph + pr.pd then 'D' else 'A' end res
              from runs r cross join pr cross join lateral (select random() + 0 * r.s + 0 * pr.fid u) x),
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
  from pts p left join won w on w.team_id = p.id group by p.id;
end $$;

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
              from runs r cross join pr cross join lateral (select random() + 0 * r.s + 0 * pr.fid u) x),
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

create or replace function public._rank_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'rank'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points from members m left join _pool_game_table(p_game) t on t.team_id = m.id),
  vals as (select pk.team_id, v.club, v.value from pool_picks pk join g on pk.game_id = g.id
           cross join lateral _rank_values(g.id, pk.pick->'order') v where pk.thing = 'rank'),
  ser as (select s.*, s.best_of / 2 + 1 need from g join series s on s.competition = g.competition where s.round >= (g.rules->>'from_round')::int),
  known as (select * from ser where state <> 'final' and high_club is not null and low_club is not null),
  -- every way each set series can still end: the winner, the loser, the games each adds, and its chance
  ends as (select k.id sid, side.club, side.other, side.a add_w, n.k - side.a add_l,
             (factorial(n.k - 1) / (factorial(side.a - 1) * factorial(n.k - side.a)))::numeric / power(2, n.k) pr
           from known k
           cross join lateral (values (k.high_club, k.low_club, k.need - k.high_wins, k.need - k.low_wins),
                                      (k.low_club, k.high_club, k.need - k.low_wins, k.need - k.high_wins)) side(club, other, a, b)
           cross join lateral generate_series(side.a, side.a + side.b - 1) n(k)
           where side.a > 0 and side.b > 0),
  cum as (select e.*, sum(e.pr) over (partition by e.sid order by e.club, e.add_l) hi from ends e),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  drawn as (select r.s, k.id sid, c.club, c.other, c.add_w, c.add_l
            from runs r cross join known k
            cross join lateral (select random() + 0 * r.s + 0 * k.id u) x
            cross join lateral (select c.* from cum c where c.sid = k.id and c.hi >= x.u order by c.hi limit 1) c),
  -- the last round still to be set, formed from the two series before it
  fin as (select f.* from ser f where (f.high_club is null or f.low_club is null) and f.state <> 'final'
            and f.round = (select max(round) from ser) and (select count(*) from ser where round = f.round) = 1
            and (select count(*) from ser p where p.round = f.round - 1) = 2),
  feeders as (select p.id, p.winner, row_number() over (order by p.id) n from ser p, fin where p.round = fin.round - 1),
  fw as (select r.s, max(case when fe.n = 1 then coalesce(fe.winner, d.club) end) w1, max(case when fe.n = 2 then coalesce(fe.winner, d.club) end) w2
         from runs r cross join feeders fe left join drawn d on d.s = r.s and d.sid = fe.id group by r.s),
  -- a best-of from 0-0: the chance it goes k games, either side winning
  len as (select fin.need, n.k, sum(2 * (factorial(n.k - 1) / (factorial(fin.need - 1) * factorial(n.k - fin.need)))::numeric / power(2, n.k))
             over (order by n.k) hi
          from fin cross join lateral generate_series(fin.need, 2 * fin.need - 1) n(k)),
  final as (select fw.s, case when x.u1 < 0.5 then fw.w1 else fw.w2 end club, case when x.u1 < 0.5 then fw.w2 else fw.w1 end other,
              (select need from fin) add_w, l.k - (select need from fin) add_l
            from fw cross join lateral (select random() + 0 * fw.s u1, random() + 0 * fw.s u2) x
            cross join lateral (select l.k from len l where l.hi >= x.u2 order by l.hi limit 1) l
            where fw.w1 is not null and fw.w2 is not null),
  adds as (select s, club, add_w n from drawn union all select s, other, add_l from drawn
           union all select s, club, add_w from final union all select s, other, add_l from final),
  gain as (select a.s, v.team_id, sum(v.value * a.n) w from adds a join vals v on v.club = a.club group by 1, 2),
  total as (select r.s, p.id team_id, p.points + coalesce(ga.w, 0) t
            from runs r cross join pts p left join gain ga on ga.s = r.s and ga.team_id = p.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select p.id, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from pts p left join won w on w.team_id = p.id group by p.id
$$;

create or replace function public._series_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'series'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points from members m left join _pool_game_table(p_game) t on t.team_id = m.id),
  open_s as (select s.*, s.best_of / 2 + 1 need from g join series s on s.competition = g.competition
             where s.round >= (g.rules->>'from_round')::int and s.state <> 'final'),
  pk as (select p.team_id, s.id sid, (p.pick->>'winner')::bigint pw, (p.pick->>'games')::int pn
         from pool_picks p join g on p.game_id = g.id join open_s s on p.thing = 's:' || s.id),
  -- the set matchups, each side's chance to take a game from the pool's split
  split as (select s.id, (count(pk.pw) filter (where pk.pw = s.high_club) + 1.0) / (count(pk.pw) + 2) p
            from open_s s left join pk on pk.sid = s.id group by s.id, s.high_club),
  known as (select s.*, sp.p from open_s s join split sp on sp.id = s.id where s.high_club is not null and s.low_club is not null),
  -- every way each can still end: (winner, games, chance), then laid end to end from 0 to 1 to draw from
  ends as (select k.id sid, side.club, k.high_wins + k.low_wins + n.k games,
             (factorial(n.k - 1) / (factorial(side.a - 1) * factorial(n.k - side.a)))::numeric * power(side.q, side.a) * power(1 - side.q, n.k - side.a) pr
           from known k
           cross join lateral (values (k.high_club, k.need - k.high_wins, k.need - k.low_wins, k.p), (k.low_club, k.need - k.low_wins, k.need - k.high_wins, 1 - k.p)) side(club, a, b, q)
           cross join lateral generate_series(side.a, side.a + side.b - 1) n(k)
           where side.a > 0 and side.b > 0),
  cum as (select e.*, sum(e.pr) over (partition by e.sid order by e.club, e.games) hi from ends e),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  draw as (select r.s, k.id sid, random() + 0 * r.s u from runs r cross join known k),
  outcome as (select d.s, d.sid, c.club, c.games from draw d
              cross join lateral (select c.club, c.games from cum c where c.sid = d.sid and c.hi >= d.u order by c.hi limit 1) c),
  picked as (select o.s, pk.team_id, sum(_series_pick_points((select rules from g), k.round, pk.pw, pk.pn, o.club, o.games)) w
             from outcome o join pk on pk.sid = o.sid join known k on k.id = o.sid group by 1, 2),
  -- a series still to start that a member hasn't picked, or one whose matchup isn't set: a guess
  unp as (select m.id team_id, s.id sid, s.round, s.need from members m cross join open_s s
          where (s.high_club is null or s.low_club is null or (s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())))
            and not exists (select 1 from pk where pk.team_id = m.id and pk.sid = s.id)),
  guess as (select r.s, u.team_id,
              sum(case when x.w then case when coalesce(((select rules from g)->>'exact_only')::boolean, false)
                                          then case when x.l then coalesce(((select rules from g)->'points'->>u.round::text)::int, 1) else 0 end
                                          else coalesce(((select rules from g)->'points'->>u.round::text)::int, 1)
                                               + case when x.l then coalesce(((select rules from g)->'length'->>u.round::text)::int, 0) else 0 end end
                       else 0 end) w
            from runs r cross join unp u
            cross join lateral (select random() + 0 * r.s + 0 * u.sid < 0.5 w, random() + 0 * r.s + 0 * u.sid < 1.0 / u.need l) x
            group by 1, 2),
  total as (select r.s, p.id team_id, p.points + coalesce(pi.w, 0) + coalesce(gu.w, 0) t
            from runs r cross join pts p
            left join picked pi on pi.s = r.s and pi.team_id = p.id
            left join guess gu on gu.s = r.s and gu.team_id = p.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select p.id, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from pts p left join won w on w.team_id = p.id group by p.id
$$;

create or replace function public._wins_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'wins'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  c as materialized (select c.club, c.decided, case when c.decided is null then _wins_odds(c.w, c.l, c.d, c.left_n, c.line, (g.rules->>'games')::int) end o
                     from g cross join _wins_clubs(p_game) c),
  calls as (select pk.team_id, x.key::bigint club, x.value cl from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
            cross join jsonb_each_text(pk.pick->'calls') x),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  drawn as (select r.s, c.club, coalesce(c.decided, case when x.u < c.o[1] then 'O' when x.u < c.o[1] + c.o[2] then 'P' else 'U' end) res
            from runs r cross join c cross join lateral (select random() + 0 * r.s + 0 * c.club u) x),
  pts as (select d.s, k.team_id, count(*) t from drawn d join calls k on k.club = d.club and k.cl = d.res group by 1, 2),
  total as (select r.s, m.id team_id, coalesce(p.t, 0) t from runs r cross join members m left join pts p on p.s = r.s and p.team_id = m.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t where top.t > 0)
  select m.id::int, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from members m left join won w on w.team_id = m.id group by m.id
$$;

create or replace function public._wins_odds(p_w int, p_l int, p_d int, p_left int, p_line numeric, p_games int) returns numeric[]
language plpgsql immutable set search_path = public as $$
declare gp int := p_w + p_l + p_d; p numeric; need int; exact int; pmf numeric; over numeric := 0; push numeric := 0; i int;
begin
  if p_w > p_line then return array[1, 0]::numeric[]; end if;
  if p_left <= 0 then return array[0, case when p_w = p_line then 1 else 0 end]::numeric[]; end if;
  need := floor(p_line - p_w)::int + 1;
  exact := case when p_line = floor(p_line) then (p_line - p_w)::int end;
  p := least(0.99, greatest(0.01, (p_w + (p_line / greatest(p_games, 1)) * 10) / (gp + 10)));
  pmf := power(1 - p, p_left);
  for i in 0..p_left loop
    if i >= need then over := over + pmf; end if;
    if i = exact then push := pmf; end if;
    exit when i = p_left;
    pmf := pmf * (p_left - i) / (i + 1) * p / (1 - p);
  end loop;
  return array[round(least(1, over), 12), round(least(1, push), 12)];
end $$;

create or replace function public._wins_tick(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare g pool_games; n int := 0; top int; w int[]; names text; lk timestamptz; np int; nc int; sure text; split text; told jsonb;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for g in select * from pool_games where league_id = p_league and kind = 'wins' and status = 'open' loop
    -- one run at a time on a game: a second waits here, then reads what the first wrote
    select * into g from pool_games where id = g.id and status = 'open' for update;
    continue when g.id is null;
    lk := _wins_lock(g.id);
    continue when lk is null or lk > now();
    -- the lock is kept from here on, and the pool hears how it split, once
    if not g.rules ? 'locked_at' then
      update pool_games set rules = rules || jsonb_build_object('locked_at', lk) where id = g.id;
      select count(*), coalesce(sum((select count(*) from jsonb_object_keys(pk.pick->'calls'))), 0) into np, nc
        from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins';
      if np > 0 then
        -- the surest call (the most players on one side of a line) and the line that split the pool most
        select format('%s %s %s (%s of %s)', coalesce(c.short, c.name), case when x.o >= x.u then 'over' else 'under' end, x.line, greatest(x.o, x.u), x.o + x.u)
          into sure from (select k.key, k.value::numeric line,
                            count(*) filter (where pk.pick->'calls'->>k.key = 'O') o, count(*) filter (where pk.pick->'calls'->>k.key = 'U') u
                          from jsonb_each_text(g.rules->'lines') k join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
                          group by k.key, k.value) x join clubs c on c.id = x.key::bigint
          where x.o + x.u >= 2 and x.o <> x.u order by abs(x.o - x.u) desc, greatest(x.o, x.u)::numeric / (x.o + x.u) desc, x.line desc limit 1;
        select format('%s at %s (%s over, %s under)', coalesce(c.short, c.name), x.line, x.o, x.u)
          into split from (select k.key, k.value::numeric line,
                             count(*) filter (where pk.pick->'calls'->>k.key = 'O') o, count(*) filter (where pk.pick->'calls'->>k.key = 'U') u
                           from jsonb_each_text(g.rules->'lines') k join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
                           group by k.key, k.value) x join clubs c on c.id = x.key::bigint
          where x.o > 0 and x.u > 0 order by abs(x.o - x.u), x.o + x.u desc, x.line desc limit 1;
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🔒 Win totals are locked: %s %s made %s calls.%s%s Everyone''s calls are on the board.',
            np, case when np = 1 then 'player' else 'players' end, nc,
            case when sure is not null then format(' The surest: %s.', sure) else '' end,
            case when split is not null then format(' Split down the middle: %s.', split) else '' end),
          jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
    insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
    select g.league_id, 'pool_wins_split', jsonb_build_object('game', g.id, 'club', s.key::bigint), round(s.o::numeric / (s.o + s.u), 3),
      (select sport from competitions where id = g.competition), lk,
      coalesce((select max(f.date) from fixtures f where f.competition = g.competition), today_et() + 200),
      jsonb_build_object('line', s.value::numeric, 'O', s.o, 'U', s.u, 'competition', g.competition)
    from (select x.key, x.value, count(*) filter (where pk.pick->'calls'->>x.key = 'O') o, count(*) filter (where pk.pick->'calls'->>x.key = 'U') u
          from jsonb_each_text(g.rules->'lines') x left join pool_picks pk on pk.game_id = g.id and pk.thing = 'wins'
          group by x.key, x.value) s
    where s.o + s.u > 0
    on conflict (league_id, kind, subject) do nothing;
    -- every line decided since the last run, told once, in one line: who went over, who can't get there, and how many
    -- called it
    select string_agg(case when c.decided = 'P' then format('%s right on %s, a push', cl.name, c.line)
             else format('%s %s %s, %s of %s called it', cl.name, case c.decided when 'O' then 'over' else 'under' end, c.line,
               (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls'->>c.club::text = c.decided),
               (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins' and pk.pick->'calls' ? c.club::text)) end,
             '; ' order by c.line desc),
           coalesce(jsonb_agg(to_jsonb(c.club::text)), '[]')
      into names, told
      from _wins_clubs(g.id) c join clubs cl on cl.id = c.club
      where c.decided is not null and not coalesce(g.rules->'told', '[]') ? c.club::text;
    if names is not null then
      update pool_games set rules = rules || jsonb_build_object('told', coalesce(rules->'told', '[]') || told) where id = g.id;
      -- a pool nobody called anything in hears nothing
      if exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.thing = 'wins') then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('📈 Decided in win totals: %s.', left(names, 1900)), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
    continue when exists (select 1 from _wins_clubs(g.id) c where c.decided is null);
    select max(t.points) into top from _pool_game_table(g.id) t;
    select coalesce(array_agg(t.team_id order by t.team_id), '{}') into w from _pool_game_table(g.id) t where t.points = top and top > 0;
    update pool_games set status = 'done', winners = w where id = g.id and status = 'open';
    continue when not found;
    -- each line's split scored: 1 when it went over, 0 under, void on a push
    update predictions p set outcome = case c.decided when 'O' then 1 when 'U' then 0 end,
      error = case c.decided when 'O' then 1 - p.predicted when 'U' then 0 - p.predicted end,
      status = case when c.decided = 'P' then 'void' else 'scored' end, scored_at = now()
    from _wins_clubs(g.id) c
    where p.league_id = g.league_id and p.kind = 'pool_wins_split' and p.subject = jsonb_build_object('game', g.id, 'club', c.club) and p.status = 'open';
    select string_agg(tm.gm_name, ' and ' order by tm.gm_name) into names from teams tm where tm.id = any (w);
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      case when names is null then '📈 Win totals are settled, and nobody called one right.'
           else format('🏆 Win totals are settled: %s called %s of %s right.', names, top, (select count(*) from jsonb_object_keys(g.rules->'lines'))) end,
      jsonb_build_object('pool_game', g.id), g.league_id);
    n := n + 1;
  end loop;
  return n;
end $$;

