-- Chance to win for Rank the teams (docs/DEVELOPMENT.md §6 item 6), once the order is locked: every win a club adds
-- pays the number each member gave it, so the rest of the postseason is played out a thousand times.
--
-- * A series with both clubs set is drawn from where it stands, game by game at even odds (the MLB feed carries no
--   line): the chance a side needing a more wins takes it in exactly k more games is C(k-1, a-1) / 2^k, and the loser
--   adds the rest.
-- * The last round, while its clubs aren't set, is formed from the round before it when that round has two series
--   (the World Series from the two LCS winners, decided or drawn), and drawn from 0-0 the same way.
-- * Each run adds each member's value for every win to the points they have; the most points wins it, a tie shares.

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
            cross join lateral (select random() + 0 * r.s u) x
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
revoke execute on function public._rank_chances(bigint, int) from public, anon, authenticated;

-- a member's chances in a game, for the Table: [{team_id, chance}]; an open pick'em, series game or locked ranking is
-- played out, a game that's over is its winners. The first look each day logs them (`pool_win`).
create or replace function public.pool_game_chances(p_game bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g pool_games; out jsonb; last date;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return '[]'; end if;
  if g.status = 'done' then
    return coalesce((select jsonb_agg(jsonb_build_object('team_id', w, 'chance', round(1.0 / cardinality(g.winners), 3))) from unnest(g.winners) w), '[]');
  end if;
  if g.kind = 'pickem' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _pickem_chances(p_game) c;
    -- the forecast resolves with the game's last match
    last := (select max(f.date) from fixtures f where f.competition = g.competition and f.gameweek <= (g.rules->>'to_round')::int);
  elsif g.kind = 'series' then
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _series_chances(p_game) c;
    -- with the last series' last scheduled game, or in a month if its games aren't drawn yet
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'rank' then
    -- the order is the member's to change until the lock; after it, the wins decide
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _rank_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  else
    return '[]';
  end if;
  -- the forecast, once a day per member
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail)
  select g.league_id, 'pool_win', jsonb_build_object('game', g.id, 'team_id', (e->>'team_id')::int, 'date', today_et()),
    (e->>'chance')::numeric, g.kind, coalesce(last, today_et()), jsonb_build_object('members', jsonb_array_length(out))
  from jsonb_array_elements(coalesce(out, '[]')) e
  on conflict (league_id, kind, subject) do nothing;
  return coalesce(out, '[]');
end $$;
revoke execute on function public.pool_game_chances(bigint) from public, anon;
grant execute on function public.pool_game_chances(bigint) to authenticated;
