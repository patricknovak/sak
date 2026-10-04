-- The Love Is Blind test's scoreboard (docs/POOLS.md section 6), for the Platform page. The test passes if, by the
-- finale on 4 November 2026: three pools or more are running, thirty players or more have joined, two thirds of them
-- call in three of the four drop weeks, and the median player makes five calls a week. This reads those numbers live
-- from every prediction pool, so the platform can see the gate filling in drop by drop.
--
-- A drop week runs from one Wednesday drop (3 am ET, 07:00 UTC) to the next: 14, 21 and 28 October and 4 November,
-- the last one to the reunion week. A pool is running once it is live with three players or more; a player is a
-- member with a seat in a pool (the host counts); a call is a trade (buy or sell).
create or replace function public.platform_pool_test() returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
declare
  wk timestamptz[] := array['2026-10-14 07:00+00', '2026-10-21 07:00+00', '2026-10-28 07:00+00', '2026-11-04 07:00+00', '2026-11-11 07:00+00']::timestamptz[];
  labels text[] := array['Premiere, episodes 1-5', 'Episodes 6-8', 'Episodes 9-11', 'The weddings'];
  weeks jsonb := '[]'; pools jsonb; i int; players int; running int; steady int; started int; cur int;
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  -- the players: every seat with an account in a live prediction pool
  create temp table if not exists _pt_players (team_id int primary key, league_id int, user_id uuid) on commit drop;
  truncate _pt_players;
  insert into _pt_players select t.id, t.league_id, t.user_id from teams t join leagues l on l.id = t.league_id
    where l.kind = 'predict' and l.status = 'active' and t.role = 'gm' and t.user_id is not null;
  players := (select count(distinct user_id) from _pt_players);
  running := (select count(*) from (select league_id from _pt_players group by league_id having count(*) >= 3) x);
  started := (select count(*) from private.pool_signups);
  cur := null;
  for i in 1..4 loop
    if now() >= wk[i] and now() < wk[i + 1] then cur := i; end if;
    weeks := weeks || jsonb_build_object(
      'week', i, 'label', labels[i], 'from', wk[i], 'to', wk[i + 1], 'started', now() >= wk[i], 'done', now() >= wk[i + 1],
      'callers', (select count(distinct p.user_id) from pool_trades tr join _pt_players p on p.team_id = tr.team_id where tr.created_at >= wk[i] and tr.created_at < wk[i + 1]),
      'calls', (select count(*) from pool_trades tr join _pt_players p on p.team_id = tr.team_id where tr.created_at >= wk[i] and tr.created_at < wk[i + 1]),
      -- the median player that week: every player counted, those who didn't call as zero
      'median', coalesce((select percentile_cont(0.5) within group (order by n) from (
          select p.user_id, count(tr.id) n from (select distinct user_id from _pt_players) p
          left join _pt_players pt on pt.user_id = p.user_id
          left join pool_trades tr on tr.team_id = pt.team_id and tr.created_at >= wk[i] and tr.created_at < wk[i + 1]
          group by p.user_id) m), 0));
  end loop;
  -- steady callers: players who called in three of the four weeks
  steady := (select count(*) from (
      select p.user_id from _pt_players p join pool_trades tr on tr.team_id = p.team_id
      where tr.created_at >= wk[1] and tr.created_at < wk[5]
      group by p.user_id having count(distinct width_bucket(extract(epoch from tr.created_at), array[extract(epoch from wk[1]), extract(epoch from wk[2]), extract(epoch from wk[3]), extract(epoch from wk[4])])) >= 3) s);
  pools := coalesce((select jsonb_agg(x order by (x->>'players')::int desc, x->>'name') from (
      select jsonb_build_object('league_id', l.id, 'name', l.name, 'slug', l.slug, 'color', l.brand #>> '{colors,gold}', 'created_at', l.created_at,
        'players', (select count(*) from _pt_players p where p.league_id = l.id),
        'calls', (select count(*) from pool_trades tr where tr.league_id = l.id),
        'calls_7d', (select count(*) from pool_trades tr where tr.league_id = l.id and tr.created_at > now() - interval '7 days'),
        'callers_7d', (select count(distinct tr.team_id) from pool_trades tr where tr.league_id = l.id and tr.created_at > now() - interval '7 days'),
        'open', (select count(*) from pool_markets m where m.league_id = l.id and m.status = 'open' and m.closes_at > now()),
        'settled', (select count(*) from pool_markets m where m.league_id = l.id and m.status = 'resolved'),
        'last_call', (select max(tr.created_at) from pool_trades tr where tr.league_id = l.id),
        'self_started', exists (select 1 from private.pool_signups s where s.league_id = l.id)) x
      from leagues l where l.kind = 'predict' and l.status = 'active') q), '[]');
  return jsonb_build_object('players', players, 'running', running, 'pools_live', jsonb_array_length(pools), 'steady', steady,
    'self_started', started, 'current_week', cur, 'finale', wk[4], 'weeks', weeks, 'pools', pools);
end $$;
revoke execute on function public.platform_pool_test() from public, anon;
grant execute on function public.platform_pool_test() to authenticated;
