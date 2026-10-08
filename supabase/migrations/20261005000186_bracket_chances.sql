-- Chance to win for the bracket (docs/DEVELOPMENT.md §6 items 6 and 7, beside migrations 175, 176 and 182), once it
-- locks: the rest of the tree is played out a thousand times.
--
-- * Each run settles the series round by round: one that's over keeps its winner; one with both clubs set is decided
--   from where it stands at even odds a game (the higher seed's chance to take it is the sum over k of
--   C(k-1, a-1) / 2^k, for a wins it still needs); one not yet set is played between the winners drawn below it, even.
-- * Each member scores their round's points for every series whose drawn winner they picked, on top of what they have;
--   the most wins the run, a tie shares it.

-- one run's winners, round by round (a few dozen series, so a loop)
create or replace function public._bracket_runs(p_game bigint, p_runs int default 1000)
returns table (s int, sid bigint, winner bigint)
language plpgsql volatile security definer set search_path = public as $$
declare g pool_games; ids bigint[] := '{}'; nexts bigint[] := '{}'; hi bigint[] := '{}'; lo bigint[] := '{}'; win bigint[] := '{}';
  ph numeric[] := '{}'; f1 int[] := '{}'; f2 int[] := '{}'; wv bigint[]; n int; i int; j int; r int; k int; a int; b int; p numeric; x record;
begin
  select * into g from pool_games where id = p_game and kind = 'bracket';
  if g.id is null then return; end if;
  for x in select t.series_id, t.next_id, se.high_club, se.low_club, se.winner, se.state, se.best_of / 2 + 1 need, se.high_wins, se.low_wins
           from _bracket_tree(g.competition, (g.rules->>'from_round')::int) t join series se on se.id = t.series_id order by t.round, t.pos loop
    ids := ids || x.series_id; nexts := nexts || x.next_id; hi := hi || x.high_club; lo := lo || x.low_club;
    win := win || case when x.state = 'final' then x.winner end;
    -- the higher seed's chance to take a set series from where it stands, at even odds a game
    p := 0.5;
    if x.high_club is not null and x.low_club is not null and x.state <> 'final' then
      a := x.need - x.high_wins; b := x.need - x.low_wins; p := 0;
      if a <= 0 then p := 1; elsif b <= 0 then p := 0;
      else for k in a .. a + b - 1 loop p := p + (factorial(k - 1) / (factorial(a - 1) * factorial(k - a)))::numeric / power(2, k); end loop; end if;
    end if;
    ph := ph || p;
  end loop;
  n := coalesce(array_length(ids, 1), 0);
  -- each series' two feeders, once (the tree's order puts them before it)
  for i in 1 .. n loop
    f1 := f1 || null::int; f2 := f2 || null::int;
    for j in 1 .. n loop
      if nexts[j] = ids[i] then
        if f1[i] is null then f1[i] := j; else f2[i] := j; end if;
      end if;
    end loop;
  end loop;
  for r in 1 .. greatest(p_runs, 1) loop
    wv := win;
    for i in 1 .. n loop
      if wv[i] is null then
        -- its own clubs once set, else the winners drawn below it
        wv[i] := case when random() < ph[i] then coalesce(hi[i], wv[f1[i]]) else coalesce(lo[i], wv[f2[i]]) end;
      end if;
      s := r; sid := ids[i]; winner := wv[i];
      return next;
    end loop;
  end loop;
end $$;
revoke execute on function public._bracket_runs(bigint, int) from public, anon, authenticated;

create or replace function public._bracket_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'bracket'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points from members m left join _bracket_table(p_game) t on t.team_id = m.id),
  open_s as (select se.id, coalesce((g.rules->'points'->>se.round::text)::int, 1) v from g
             cross join lateral _bracket_tree(g.competition, (g.rules->>'from_round')::int) t join series se on se.id = t.series_id
             where se.state <> 'final'),
  picks as (select pk.team_id, e.key::bigint sid, (e.value #>> '{}')::bigint club
            from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'bracket' cross join lateral jsonb_each(pk.pick->'winners') e),
  runs as (select * from _bracket_runs(p_game, p_runs)),
  gain as (select r.s, p.team_id, sum(o.v) w from runs r join open_s o on o.id = r.sid join picks p on p.sid = r.sid and p.club = r.winner group by 1, 2),
  total as (select r.s, p.id team_id, p.points + coalesce(ga.w, 0) t
            from (select distinct s from runs) r cross join pts p left join gain ga on ga.s = r.s and ga.team_id = p.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t)
  select p.id, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from pts p left join won w on w.team_id = p.id group by p.id
$$;
revoke execute on function public._bracket_chances(bigint, int) from public, anon, authenticated;

-- a member's chances in a game, for the Table: [{team_id, chance}]; an open pick'em, series game, locked ranking or
-- locked bracket is played out, a game that's over is its winners. The first look each day logs them (`pool_win`).
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
  elsif g.kind = 'bracket' then
    -- a bracket is the member's to change until it locks
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _bracket_chances(p_game) c;
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
