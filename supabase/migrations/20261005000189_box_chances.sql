-- The box pool's chance to win (docs/DEVELOPMENT.md §6 item 6): once teams lock, the rest of the pool played out a
-- thousand times. Each player's points in each run are drawn around what he's expected to score in his club's games
-- still to come in the window (his projection per game under the pool's scoring, times the share of games he plays),
-- spread as goals and assists are (a Poisson count, drawn here as a rounded normal of the same mean and variance, never
-- below zero). A player on several teams scores the same in a run for all of them, so two members who took the same
-- star rise and fall together. Ties on the most points share the run. Logged once a day like every other chance
-- (`pool_win`), resolving the day after the last night.

create or replace function public._players_chances(p_game bigint, p_runs int default 1000)
returns table (team_id int, chance numeric)
language sql volatile security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game and kind = 'players'),
  members as (select tm.id from teams tm, g where tm.league_id = g.league_id and tm.role = 'gm'),
  picks as (select pk.team_id, (e #>> '{}')::int player_id from g join pool_picks pk on pk.game_id = g.id and pk.thing = 'box'
            cross join lateral jsonb_array_elements(pk.pick->'players') e),
  now_pts as (select s.team_id, sum(s.points)::numeric pts from _players_scored(p_game) s group by s.team_id),
  -- what each player taken is expected to add: his rate a game times his club's games still to come
  lam as (select pl.id player_id,
            (select count(*) from g cross join lateral _box_games((g.rules->>'from')::date, (g.rules->>'to')::date) b
             where b.state = 'FUT' and pl.nhl_team in (b.home, b.away))
            * least(1.0, coalesce((pl.proj_stats->>'gp')::numeric, 0) / 82.0)
            * case when coalesce((pl.proj_stats->>'gp')::numeric, 0) > 0 then
                (case when pl.pos = 'G'
                   then coalesce((pl.proj_stats->>'w')::numeric, 0) * coalesce((g.rules->'scoring'->>'w')::numeric, 2)
                      + coalesce((pl.proj_stats->>'sho')::numeric, 0) * coalesce((g.rules->'scoring'->>'sho')::numeric, 1)
                   else coalesce((pl.proj_stats->>'g')::numeric, 0) * coalesce((g.rules->'scoring'->>'g')::numeric, 1)
                      + coalesce((pl.proj_stats->>'a')::numeric, 0) * coalesce((g.rules->'scoring'->>'a')::numeric, 1) end)
                / (pl.proj_stats->>'gp')::numeric
              else 0 end lam
          from players pl, g where pl.id in (select player_id from picks)),
  runs as (select generate_series(1, p_runs) r),
  draws as (select r.r, l.player_id,
              greatest(0, round(l.lam + sqrt(l.lam) * sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random()))) pts
            from runs r cross join lam l),
  totals as (select d.r, p.team_id, sum(d.pts) + coalesce(max(n.pts), 0) total
             from picks p join draws d on d.player_id = p.player_id left join now_pts n on n.team_id = p.team_id
             group by d.r, p.team_id),
  best as (select r, max(total) top from totals group by r),
  wins as (select t.team_id, 1.0 / count(*) over (partition by t.r) share
           from totals t join best b on b.r = t.r and t.total = b.top)
  select m.id::int, round(coalesce((select sum(share) from wins w where w.team_id = m.id), 0) / p_runs, 3)
  from members m
$$;
revoke execute on function public._players_chances(bigint, int) from public, anon, authenticated;

-- the chances the Table reads: a locked box pool's too
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

