-- Lineup efficiency: the points a team's lineup scored against the most it could have scored that night from the
-- same players (the best lineup in hindsight: every player who played and wasn't on IR, in the league's starting
-- slots, each where he's eligible). The Performance page shows it for every team; a head-to-head league can read it as
-- "max points for".
--
-- * _best_lineup_points(players, slots): the best total. Players are taken best first and kept whenever they still
--   fit, moving the ones already placed between their eligible slots (an augmenting path); because the sets of players
--   that fit form a matroid, best-first is exact. A player who scored nothing or less never helps and isn't placed.
-- * lineup_efficiency(from, to): per team and league day in the caller's league, the points that counted and the best
--   possible, from the puck-drop snapshots and the league's own points (league_games), like performance_days.

set client_min_messages = warning;

create or replace function public._best_lineup_points(p_players jsonb, p_slots text[]) returns numeric
language plpgsql immutable set search_path = public as $$
declare
  n int := coalesce(jsonb_array_length(p_players), 0); m int := coalesce(array_length(p_slots, 1), 0);
  pts numeric[]; pos text[]; elig jsonb[]; ok boolean[]; holder int[]; parent int[]; seen boolean[]; queue int[];
  total numeric := 0; i int; j int; k int; q int; head int; free_slot int; x jsonb;
begin
  if n = 0 or m = 0 then return 0; end if;
  -- best first
  for x in select value from jsonb_array_elements(p_players) order by (value->>'pts')::numeric desc loop
    pts := pts || (x->>'pts')::numeric; pos := pos || (x->>'pos'); elig := elig || (x->'elig');
  end loop;
  -- who can play where (row-major, player by slot): slot_ok's rule, read straight off the jsonb
  ok := array_fill(false, array[n * m]);
  for i in 1..n loop
    for j in 1..m loop
      ok[(i - 1) * m + j] := case p_slots[j] when 'G' then pos[i] = 'G' when 'Util' then pos[i] <> 'G'
        else pos[i] <> 'G' and coalesce(elig[i] ? p_slots[j], false) end;
    end loop;
  end loop;
  holder := array_fill(0, array[m]);
  for i in 1..n loop
    exit when pts[i] <= 0;
    -- breadth first from player i over the slots: a free slot ends the path; a held slot lets its holder move on
    parent := array_fill(0, array[m]); seen := array_fill(false, array[m]); queue := '{}'; free_slot := 0;
    for j in 1..m loop
      if ok[(i - 1) * m + j] then seen[j] := true; parent[j] := 0; queue := queue || j; end if;
    end loop;
    head := 1;
    while head <= coalesce(array_length(queue, 1), 0) and free_slot = 0 loop
      j := queue[head]; head := head + 1;
      if holder[j] = 0 then free_slot := j; exit; end if;
      k := holder[j];
      for q in 1..m loop
        if not seen[q] and ok[(k - 1) * m + q] then seen[q] := true; parent[q] := j; queue := queue || q; end if;
      end loop;
    end loop;
    if free_slot > 0 then
      -- shift each holder along the path into the next slot, then seat player i in the first
      j := free_slot;
      while parent[j] <> 0 loop holder[j] := holder[parent[j]]; j := parent[j]; end loop;
      holder[j] := i;
      total := total + pts[i];
    end if;
  end loop;
  return total;
end $$;

create or replace function public.lineup_efficiency(p_from date default null, p_to date default null)
returns table (team_id int, date date, game_type int, points numeric, best numeric)
language sql stable security invoker set search_path = public as $$
  with l as (select season_start, roster from league),
  slots as (
    -- the starting slots in the optimizer's order, one entry per spot
    select array_agg(s.slot order by s.ord, g.i) as list
    from l, unnest(array['C', 'LW', 'RW', 'D', 'Util', 'G']) with ordinality as s(slot, ord),
      generate_series(1, greatest(coalesce((l.roster->>s.slot)::int, 0), 0)) as g(i)
  ),
  s as (
    select s.team_id, s.date, g.game_type, s.slot, lg.fpts, p.pos, p.elig
    from lineup_snapshots s
    join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
    join games g on g.id = s.game_id
    join players p on p.id = s.player_id
    cross join l
    -- this league's teams only, even for a caller that skips row-level security (the service key)
    where s.league_id = current_league_id()
      and s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  )
  select s.team_id, s.date, s.game_type,
    round(coalesce(sum(s.fpts) filter (where s.slot not in ('BN', 'IR')), 0), 2) as points,
    -- the lineup that played is one of the possible ones, so the best is never below it (even if the slots changed since)
    round(greatest(coalesce(sum(s.fpts) filter (where s.slot not in ('BN', 'IR')), 0),
      _best_lineup_points(coalesce(jsonb_agg(jsonb_build_object('pts', s.fpts, 'pos', s.pos, 'elig', to_jsonb(s.elig))) filter (where s.slot <> 'IR'), '[]'),
                          (select list from slots))), 2) as best
  from s
  group by s.team_id, s.date, s.game_type
$$;
revoke execute on function public.lineup_efficiency(date, date) from public, anon;
grant execute on function public.lineup_efficiency(date, date) to authenticated, service_role;
revoke execute on function public._best_lineup_points(jsonb, text[]) from public, anon;
grant execute on function public._best_lineup_points(jsonb, text[]) to authenticated, service_role;
