-- A prop sheet scores as the game goes (docs/POOL-TYPES.md §9 item 3). A call the game has already decided counts
-- while it is on: the 1st inning (period, quarter) once the 2nd has begun, the halfway mark once the next period
-- has, the over once the total has passed its line, early scoring as soon as it happens, extra time once it starts, a
-- shutout broken (a side held to 10 passed) once both sides have scored. Who wins and by how much wait for the final,
-- as does every "no" that only the final can prove. The sheet's table counts them live, what's still possible is the
-- calls not yet decided, and the board shows each call's answer as soon as it has one. The final settles as before:
-- at the final whistle the answers are exactly what they were (the same code, the same order).
-- And a chance to win once the sheet locks: each call still open drawn a thousand times from the pool's own split (one
-- more sheet on every answer), who wins from the market's line where the feed has one; a tie on calls shares the win
-- (the tiebreak's total isn't known until the end).
-- Safe to run twice.

create or replace function public._props_answers(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; sp text; reg int; half int; np int; h int; a int; m int; fh int; fa int; hh int; ha int; out jsonb := '{}';
  q jsonb; fin boolean; done1 boolean; doneh boolean; extra boolean;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  if f.id is null or f.state not in ('final', 'live') or f.home_score is null or f.away_score is null then return out; end if;
  fin := f.state = 'final';
  sp := (select sport from competitions where id = f.competition);
  reg := case sp when 'mlb' then 9 when 'nfl' then 4 else 3 end;
  half := case sp when 'mlb' then 5 else 2 end;
  h := f.home_score; a := f.away_score; m := abs(h - a);
  select count(*), sum(home) filter (where n = 1), sum(away) filter (where n = 1), sum(home) filter (where n <= half), sum(away) filter (where n <= half)
    into np, fh, fa, hh, ha from fixture_periods where fixture_id = f.id;
  -- while the game is on, a period is over once the next has begun (as the squares read it, migration 167)
  done1 := exists (select 1 from fixture_periods where fixture_id = f.id and n > 1 and away is not null);
  doneh := exists (select 1 from fixture_periods where fixture_id = f.id and n > half and away is not null);
  extra := exists (select 1 from fixture_periods where fixture_id = f.id and n > reg and away is not null);
  for q in select * from jsonb_array_elements(g.rules->'questions') loop
    out := out || jsonb_build_object(q->>'key', case when fin then case q->>'key'
      when 'winner' then case when h > a then 'H' when a > h then 'A' end
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' when h + a < (q->>'line')::numeric then 'U' end
      when 'margin' then case when m = 0 then null
        when sp = 'mlb' then case when m = 1 then '1' when m <= 3 then '2' else '4' end
        when sp = 'nfl' then case when m <= 7 then '1' when m <= 14 then '8' else '15' end
        else case when m = 1 then '1' when m = 2 then '2' else '3' end end
      when 'first' then case when np < 1 or fh is null and fa is null then null
        when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end
      when 'half' then case when np < half then null
        when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end
      when 'early' then case when np < 1 then null
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' else 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' else 'N' end
      when 'extra' then case when np < reg then null when np > reg then 'Y' else 'N' end
      when 'shutout' then case when h = 0 or a = 0 then 'Y' else 'N' end
      when 'held' then case when least(h, a) <= 10 then 'Y' else 'N' end end
    -- under way: only what can no longer change
    else case q->>'key'
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' end
      when 'first' then case when done1 then case when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end end
      when 'half' then case when doneh then case when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end end
      when 'early' then case
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' when done1 then 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' when done1 then 'N' end
      when 'extra' then case when extra then 'Y' end
      when 'shutout' then case when h > 0 and a > 0 then 'N' end
      when 'held' then case when least(h, a) > 10 then 'N' end end end);
  end loop;
  -- a call with no answer yet is a null, as before (at the final, a null is a void call)
  return out;
end $$;
revoke execute on function public._props_answers(bigint) from public, anon, authenticated;

-- the sheet's table, live: the calls already decided count, and what's still possible is those plus the calls the game
-- hasn't decided yet
create or replace function public._props_table(p_game bigint) returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; ans jsonb; nq int; open_q int;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  if g.id is null then return; end if;
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  ans := _props_answers(g.id);
  nq := jsonb_array_length(g.rules->'questions');
  open_q := nq - (select count(*) from jsonb_each(ans) x where jsonb_typeof(x.value) <> 'null');
  return query
  select tm.id::int,
    coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)::int,
    case when f.state = 'final' then coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)
         -- called off, or locked with no sheet in: nothing more to make
         when f.state = 'cancelled' or (pk.id is null and (f.state <> 'scheduled' or f.kickoff <= now())) then 0
         else coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0) + open_q end::int,
    coalesce((select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value), 0)::int,
    0, (pk.id is not null)::int,
    case when f.state = 'final' and pk.id is not null then abs((pk.pick->>'total')::int - (f.home_score + f.away_score)) end::int
  from teams tm left join pool_picks pk on pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'props'
  where tm.league_id = g.league_id and tm.role = 'gm';
end $$;
revoke execute on function public._props_table(bigint) from public, anon, authenticated;

create or replace function public._props_board(p_game bigint, p_me int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; locked boolean; ans jsonb;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  locked := f.state <> 'scheduled' or f.kickoff <= now();
  ans := _props_answers(g.id);
  return jsonb_build_object(
    'game', jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state, 'home', _club_json(f.home_club), 'away', _club_json(f.away_club),
      'home_score', f.home_score, 'away_score', f.away_score,
      'game_no', case when (select best_of from series s where s.id = f.series_id) > 1 then f.game_no end,
      'label', coalesce((select coalesce(s.short, s.label) from series s where s.id = f.series_id), 'Week ' || f.gameweek),
      'periods', coalesce((select jsonb_agg(jsonb_build_object('n', p.n, 'home', p.home, 'away', p.away) order by p.n) from fixture_periods p where p.fixture_id = f.id), '[]')),
    'locked', locked, 'questions', g.rules->'questions', -- each call's answer as soon as the game decides it (migration 218)
    'answers', case when f.state in ('final', 'live') then ans end,
    'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = p_me and pk.thing = 'props'),
    'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 'props'),
    -- once it starts: how the pool called each one, and everyone's sheet
    'split', case when locked then (select jsonb_object_agg(k.key, k.counts) from (
        select x.key, jsonb_object_agg(x.value, x.n) counts from (
          select a.key, a.value, count(*) n from pool_picks pk cross join lateral jsonb_each_text(pk.pick->'answers') a
          where pk.game_id = g.id and pk.thing = 'props' group by a.key, a.value) x group by x.key) k) end,
    'sheets', case when locked then coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'answers', pk.pick->'answers', 'total', (pk.pick->>'total')::int,
        'right', (select count(*) from jsonb_each_text(pk.pick->'answers') x where ans->>x.key = x.value)) order by pk.team_id)
      from pool_picks pk where pk.game_id = g.id and pk.thing = 'props'), '[]') end);
end $$;
revoke execute on function public._props_board(bigint, int) from public, anon, authenticated;

-- a sheet's chance to win: each call the game hasn't decided drawn a thousand times, from the pool's split with one more
-- sheet on every answer (who wins from the market's line where the feed carries one); a tie on calls shares the win
create or replace function public._props_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'props'),
  fx as (select f.* from fixtures f, g where f.id = (g.rules->>'fixture')::bigint),
  ans as (select _props_answers(p_game) a),
  open_q as (select qq->>'key' k, qq->'options' opts from g cross join lateral jsonb_array_elements(g.rules->'questions') qq, ans
             where (ans.a->>(qq->>'key')) is null),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  pts as (select m.id, coalesce(t.points, 0) points, coalesce(t.picked, 0) picked from members m left join _props_table(p_game) t on t.team_id = m.id),
  sheets as (select pk.team_id, pk.pick->'answers' ans from pool_picks pk, g where pk.game_id = g.id and pk.thing = 'props'),
  opt as (select oq.k, e.x->>'v' v, e.ord, jsonb_array_length(oq.opts) nopt,
            (select count(*) from sheets s where s.ans->>oq.k = e.x->>'v') c
          from open_q oq cross join lateral jsonb_array_elements(oq.opts) with ordinality e(x, ord)),
  mk as (select (o->>'home')::numeric / nullif((o->>'home')::numeric + (o->>'away')::numeric, 0) h
         from (select fx.detail->'odds' o from fx) z where jsonb_typeof(o) = 'object' and (o->>'home') is not null and (o->>'away') is not null),
  pr as (select o.k, o.v, o.ord,
           coalesce(case when o.k = 'winner' then case o.v when 'H' then (select h from mk) when 'A' then 1 - (select h from mk) end end,
                    (o.c + 1.0) / ((select count(*) from sheets) + o.nopt)) p
         from opt o),
  cum as (select k, v, sum(p) over (partition by k order by ord) / sum(p) over (partition by k) hi from pr),
  runs as (select generate_series(1, greatest(p_runs, 1)) s),
  draw as (select r.s, ok.k, random() + 0 * r.s u from runs r cross join (select distinct k from pr) ok),
  outcome as (select d.s, d.k, (select c.v from cum c where c.k = d.k and c.hi >= d.u order by c.hi limit 1) v from draw d),
  gain as (select o.s, sh.team_id, count(*) w from outcome o join sheets sh on sh.ans->>o.k = o.v group by 1, 2),
  total as (select r.s, p.id team_id, p.points + coalesce(ga.w, 0) t from runs r cross join pts p
            left join gain ga on ga.s = r.s and ga.team_id = p.id where p.picked = 1),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t where top.t > 0)
  select p.id::int, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3) from pts p left join won w on w.team_id = p.id group by p.id
$$;
revoke execute on function public._props_chances(bigint, int) from public, anon, authenticated;

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
  elsif g.kind = 'players' then
    -- a team is the member's to change until the first puck drop
    if coalesce(_players_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _players_chances(p_game) c;
    last := (g.rules->>'to')::date + 1;
  elsif g.kind = 'rank' then
    -- the order is the member's to change until the lock; after it, the wins decide
    if coalesce(_rank_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _rank_chances(p_game) c;
    last := coalesce((select max(f.date) from fixtures f join series s on s.id = f.series_id
                      where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition)),
                     today_et() + 30);
  elsif g.kind = 'props' then
    -- a sheet is the member's to change until the game starts (migration 218)
    if not exists (select 1 from fixtures f where f.id = (g.rules->>'fixture')::bigint and (f.state <> 'scheduled' or f.kickoff <= now())) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _props_chances(p_game) c;
    last := (select f.date from fixtures f where f.id = (g.rules->>'fixture')::bigint);
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
