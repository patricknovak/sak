-- What you need to win for Pick the series (docs/DEVELOPMENT.md §6 item 6, docs/POOL-TYPES.md §6 and §7): each member's
-- chance of finishing first, for the World Series test, beside pick'em's (migration 175).
--
-- * A series whose matchup is set is played out exactly from where it stands: with p the chance the higher seed takes a
--   game (the pool's split on the series, with a pick added to each side), the chance a side needing a more wins takes
--   it in exactly k more games is C(k-1, a-1) p^a (1-p)^(k-a). Every winner and length it can still end on is listed
--   with its chance, and each run draws one.
-- * A pick on it scores as the table scores it (`_series_pick_points`). A member with no pick on a series still to start,
--   or on a later round whose matchup isn't set, is guessing: the winner one time in two, the length one time in as
--   many lengths as the series can run (4 for a best of seven). A series under way that a member didn't pick scores
--   nothing.
-- * The most points wins a run; a tie shares it (the runs tiebreaker isn't drawn). A thousand runs, a few milliseconds.

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
  unp as (select m.id team_id, s.round, s.need from members m cross join open_s s
          where (s.high_club is null or s.low_club is null or (s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())))
            and not exists (select 1 from pk where pk.team_id = m.id and pk.sid = s.id)),
  guess as (select r.s, u.team_id,
              sum(case when x.w then case when coalesce(((select rules from g)->>'exact_only')::boolean, false)
                                          then case when x.l then coalesce(((select rules from g)->'points'->>u.round::text)::int, 1) else 0 end
                                          else coalesce(((select rules from g)->'points'->>u.round::text)::int, 1)
                                               + case when x.l then coalesce(((select rules from g)->'length'->>u.round::text)::int, 0) else 0 end end
                       else 0 end) w
            from runs r cross join unp u
            cross join lateral (select random() + 0 * r.s < 0.5 w, random() + 0 * r.s < 1.0 / u.need l) x
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
revoke execute on function public._series_chances(bigint, int) from public, anon, authenticated;

-- a member's chances in a game, for the Table: [{team_id, chance}]; an open pick'em or series is played out, a game
-- that's over is its winners, any other kind says nothing yet. The first look each day logs them (`pool_win`).
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
