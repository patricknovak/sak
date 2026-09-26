-- Daily lineups, spelled out:
--   * a GM scores only the players who were in a starting slot when that player's game started (lineup_snapshots);
--     bench and IR points show but never count, and trades / pickups / drops take effect from the next game on
--     (each snapshot names the team the player was on at puck drop, so a traded player's earlier points stay
--     with the old team).
--   * bench points are now tracked too: what a team could have had, per day and for the season.
--   * IR is for injured players only (Out, Day-to-Day, Injured Reserve, IR-LT, suspended...), not a 3rd and
--     4th bench spot.

create or replace view public.team_bench_daily as
  select s.team_id, s.date, round(sum(pg.fpts), 2) as points, count(*) as games
  from lineup_snapshots s
  join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join league l on l.id = 1
  where s.slot in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase = 'season'
  group by s.team_id, s.date;
grant select on public.team_bench_daily to authenticated;

create or replace view public.standings as
  with d as (select team_id, date, points, games from team_daily),
  b as (select team_id, date, points from team_bench_daily),
  agg as (
    select t.id as team_id,
      coalesce(sum(d.points), (0)::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), (0)::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), (0)::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), (0)::numeric) as last7,
      coalesce(sum(d.games), (0)::numeric) as games
    from teams t left join d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id),
  bench as (
    select t.id as team_id,
      coalesce(sum(b.points), (0)::numeric) as bench,
      coalesce(sum(b.points) filter (where b.date = today_et()), (0)::numeric) as bench_today
    from teams t left join b on b.team_id = t.id
    where t.role = 'gm'
    group by t.id)
  select agg.team_id, agg.points, agg.today, agg.yesterday, agg.last7, agg.games, rank() over (order by agg.points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves,
    bench.bench, bench.bench_today
  from agg join bench on bench.team_id = agg.team_id;

-- IR: injured players only
create or replace function public.move_player(p_player int, p_slot text, p_swap int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team();
  r rosters; s rosters; p players; q players;
  s_new text;
begin
  perform take_snapshots();
  select * into r from rosters where player_id = p_player and team_id = me for update;
  if not found then raise exception 'That player is not on your roster'; end if;
  select * into p from players where id = p_player;
  if player_locked(p_player) then raise exception '% is locked: his game has started', p.name; end if;
  if not slot_ok(p.elig, p.pos, p_slot) then raise exception '% can''t play %', p.name, p_slot; end if;
  if p_slot = 'IR' and p.injury_status is null then
    raise exception '% isn''t on the injury report: IR is for injured players only (IR, IR-LT, IR-NR, Out, Day-to-Day)', p.name;
  end if;

  if p_swap is not null then
    select * into s from rosters where player_id = p_swap and team_id = me for update;
    if not found or s.slot <> p_slot then raise exception 'Swap target is not in that slot'; end if;
    select * into q from players where id = p_swap;
    if player_locked(p_swap) then raise exception '% is locked: his game has started', q.name; end if;
    s_new := case when slot_ok(q.elig, q.pos, r.slot) and not (r.slot = 'IR' and q.injury_status is null) then r.slot else 'BN' end;
    if s_new = 'BN' and r.slot <> 'BN' and (select count(*) from rosters where team_id = me and slot = 'BN') >= _cap('BN') then
      raise exception 'Bench is full';
    end if;
    update rosters set slot = s_new where player_id = p_swap;
    update rosters set slot = p_slot where player_id = p_player;
  else
    if r.slot = p_slot then return; end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player;
  end if;
end $$;
