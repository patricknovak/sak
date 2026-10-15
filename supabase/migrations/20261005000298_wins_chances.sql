-- Win totals' chances (migration 297's kind): each member's chance of finishing first, as the pool's other games have
-- it. Every line still open is played out a thousand times: the club's games left are won at its rate so far, pulled
-- toward the rate its line implies by ten games' worth (so a hot fortnight counts for less than a season of it), and the
-- line goes over, pushes (a whole-number line hit exactly) or goes under. The calls lock at the opener, so before it
-- there are no chances. Safe to run twice.

-- the chance a club ends over its line, and of landing on it exactly: {over, push}
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
  return array[least(1, over), least(1, push)];
end $$;
revoke execute on function public._wins_odds(int, int, int, int, numeric, int) from public, anon, authenticated;

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
            from runs r cross join c cross join lateral (select random() + 0 * r.s u) x),
  pts as (select d.s, k.team_id, count(*) t from drawn d join calls k on k.club = d.club and k.cl = d.res group by 1, 2),
  total as (select r.s, m.id team_id, coalesce(p.t, 0) t from runs r cross join members m left join pts p on p.s = r.s and p.team_id = m.id),
  top as (select s, max(t) t from total group by s),
  won as (select tt.s, tt.team_id, 1.0 / count(*) over (partition by tt.s) credit from total tt join top on top.s = tt.s and top.t = tt.t where top.t > 0)
  select m.id::int, round(coalesce(sum(w.credit), 0) / greatest(p_runs, 1), 3)
  from members m left join won w on w.team_id = m.id group by m.id
$$;
revoke execute on function public._wins_chances(bigint, int) from public, anon, authenticated;

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
  elsif g.kind = 'wins' then
    -- the calls are the member's to change until the opener (migration 298)
    if coalesce(_wins_lock(g.id) > now(), true) then return '[]'; end if;
    select jsonb_agg(jsonb_build_object('team_id', c.team_id, 'chance', c.chance) order by c.chance desc) into out from _wins_chances(p_game) c;
    last := (select max(f.date) from fixtures f where f.competition = g.competition);
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
