-- Two faults read from the live logs on 24 November 2026.
--
-- 1. A pool game that ends with nobody on the board stopped its event's feed. A pick'em whose host never picked
--    finishes with winners = '{}'; scoring the pool's logged chances (_pool_win_score) then divided by the number of
--    winners. The CASE around it doesn't help: PL/pgSQL plans the statement with new.winners as a constant, and
--    Postgres works out 1.0 / cardinality('{}') while planning, before any row is looked at. The error rolled back
--    the whole ingest, every run: MLS's last match of the season sat at "2H" from 8 November, for every reader.
--    The division is guarded, and the prediction log can no longer hold up a settle: its own errors are warnings,
--    like the box pool's goal alert (migration 192).
--
-- 2. Two rebuilds of the stats cache at once. nhl-sync's scores run and the minute's stats-cache job both call
--    refresh_stats_cache() on the same second; the second waited on the first's deletes, then failed on a duplicate
--    key (six times on the night of the 23rd, with an 8-second timeout before them). One rebuild at a time per
--    profile now: whoever comes second leaves it to the first, and the views work the numbers out live meanwhile.
--
-- 3. The season's stats took 3.4 seconds to work out, and a little longer every night. player_season_live asked what
--    day it is (today_et(), which reads the night's games) twice for every game a player has played: 29,000 times
--    on 24 November, 0.11 ms each, against 40 ms for the rest of the query. It is what the rebuild above spends its
--    time on every minute of a game night, what a GM's Players page waits for whenever the kept answer is a minute
--    stale, and what ran into the 8-second limit on the nights of the 19th, 21st, 22nd and 23rd. The day is asked
--    once now; the numbers are the same.
--
-- 4. Nothing noticed the first fault for sixteen days. The health check now flags a match that is still live twelve
--    hours after its kick-off, which is what a feed failing on every run looks like.

create or replace function public._pool_win_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int := coalesce(cardinality(new.winners), 0);
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    begin
      -- a winner 1, shared on a tie; the rest 0; nobody won, the forecasts are void
      update predictions pr set
        outcome = case when n > 0 and (pr.subject->>'team_id')::int = any (new.winners) then round(1.0 / nullif(n, 0), 3) else 0 end,
        error = case when n > 0 and (pr.subject->>'team_id')::int = any (new.winners) then round(1.0 / nullif(n, 0), 3) else 0 end - pr.predicted,
        status = case when n = 0 then 'void' else 'scored' end, scored_at = now()
      where pr.league_id = new.league_id and pr.kind = 'pool_win' and pr.status = 'open' and (pr.subject->>'game')::bigint = new.id;
    exception when others then
      raise warning '_pool_win_score game %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke execute on function public._pool_win_score() from public, anon, authenticated;

create or replace function public._stats_cache_build(p_profile int) returns void
language plpgsql security definer set search_path = public as $$
declare lid int; g bigint;
begin
  -- one rebuild at a time for a profile; the lock goes when this transaction ends
  if not pg_try_advisory_xact_lock(hashtext('stats_cache'), p_profile) then return; end if;
  -- the rebuild that held it a moment ago may have left the answer current
  if _stats_fresh(p_profile) then return; end if;
  select lr.league_id into lid from league_rules lr where coalesce(lr.profile_id, 1) = p_profile order by lr.league_id limit 1;
  if lid is null then return; end if;
  select gen into g from stats_gen where one;
  perform set_config('app.league_id', lid::text, true);
  delete from player_windows_cache where profile_id = p_profile;
  insert into player_windows_cache (profile_id, player_id, win, gp, fpts, totals)
    select p_profile, player_id, win, gp, fpts, totals from player_windows_live;
  delete from player_season_cache where profile_id = p_profile;
  insert into player_season_cache (profile_id, player_id, gp, fpts, fpts14, totals, gp14)
    select p_profile, player_id, gp, fpts, fpts14, totals, gp14 from player_season_live;
  insert into stats_cache_state (profile_id, gen, day, built_at) values (p_profile, g, today_et(), now())
  on conflict (profile_id) do update set gen = excluded.gen, day = excluded.day, built_at = excluded.built_at;
end $$;
revoke execute on function public._stats_cache_build(int) from public, anon, authenticated;

-- the same view as migration 244, with the league day read once for the whole query
create or replace view public.player_season_live with (security_invoker = true) as
SELECT pg.player_id,
    count(*) AS gp,
    round(sum(pg.fpts), 2) AS fpts,
    round(sum(pg.fpts) FILTER (WHERE (pg.date > ((SELECT today_et()) - 14))), 2) AS fpts14,
    jsonb_build_object('g', sum(((pg.stats ->> 'g'::text))::numeric), 'a', sum(((pg.stats ->> 'a'::text))::numeric), 'pm', sum(((pg.stats ->> 'pm'::text))::numeric), 'sog', sum(((pg.stats ->> 'sog'::text))::numeric), 'hit', sum(((pg.stats ->> 'hit'::text))::numeric), 'blk', sum(((pg.stats ->> 'blk'::text))::numeric), 'ppp', sum(((pg.stats ->> 'ppp'::text))::numeric), 'w', sum(((pg.stats ->> 'w'::text))::numeric), 'sv', sum(((pg.stats ->> 'sv'::text))::numeric), 'ga', sum(((pg.stats ->> 'ga'::text))::numeric), 'sho', sum(((pg.stats ->> 'sho'::text))::numeric)) AS totals,
    count(*) FILTER (WHERE (pg.date > ((SELECT today_et()) - 14))) AS gp14
   FROM league_games pg,
    league l
  GROUP BY pg.player_id;
revoke all on public.player_season_live from public, anon;
grant select on public.player_season_live to authenticated;

-- the health check of migration 331, with the stuck match added
create or replace function public.health_check(p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := _health_state(); issues text[] := '{}'; k text; c int; phase text := (select phase from league);
  jobs_bad text; last_scores timestamptz; last_pending timestamptz; lg int; stuck text;
begin
  select id, league_id into c, lg from teams where is_commish order by id limit 1;
  select string_agg(j->>'job', ', ') into jobs_bad from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j
    where j->>'status' not in ('succeeded', 'running', 'starting') and j->>'job' <> 'health-check'
      and (j->>'last')::timestamptz > now() - interval '2 hours';
  if jobs_bad is not null then issues := array_append(issues, 'Scheduled jobs failing: ' || jobs_bad); end if;
  -- the score job runs only while a game is on, so a quiet stretch between games is no fault (migration 331)
  last_scores := (st->>'scores_ok_at')::timestamptz;
  if st ? 'scores_ok_at' and _scores_due() and (last_scores is null or last_scores < now() - interval '15 minutes') then
    issues := array_append(issues, 'NHL score sync has not succeeded in the last 15 minutes');
  end if;
  select max((j->>'last')::timestamptz) into last_pending from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j where j->>'job' = 'process-pending';
  if last_pending is not null and last_pending < now() - interval '5 minutes' then
    issues := array_append(issues, 'The draft clock / trade processor has not run for 5 minutes');
  end if;
  -- the morning post is in the chat or it isn't: pg_net's reply log keeps hours, not a day, and the morning job's reply
  -- times out once it writes for several leagues (migration 331); a morning after a night without games has nothing to say
  if phase in ('keepers', 'predraft', 'season') and (now() at time zone 'utc')::time > time '15:30'
     and exists (select 1 from games where date = (now() at time zone 'America/New_York')::date - 1)
     and not exists (select 1 from messages m where m.league_id = lg and m.kind = 'bot' and m.meta->>'type' = 'recap'
                     and m.created_at >= date_trunc('day', now())) then
    issues := array_append(issues, 'Garry''s morning post did not run today');
  end if;
  -- a match still "live" half a day after kick-off: its results feed is failing on every run (MLS's last match of 2026
  -- sat so for sixteen days, two quiet errors a day, under every other check here; migration 364)
  select string_agg(x.competition, ', ' order by x.competition) into stuck
  from (select distinct f.competition from fixtures f where f.state = 'live' and f.kickoff < now() - interval '12 hours') x;
  if stuck is not null then issues := array_append(issues, 'A match has been live for over 12 hours, so its results feed is failing: ' || stuck); end if;
  if coalesce((st->>'errors_30m')::int, 0) >= 3 then
    issues := array_append(issues, format('%s edge-function errors in the last 30 minutes: %s', st->>'errors_30m', st->>'last_error'));
  end if;
  if p_notify and c is not null then
    foreach k in array issues loop
      if not exists (select 1 from health_alerts where key = left(k, 60) and last_alert > now() - interval '6 hours') then
        perform _notify(c, 'health', '🩺 ' || k, '/commish');
        insert into health_alerts (key, last_alert) values (left(k, 60), now()) on conflict (key) do update set last_alert = now();
      end if;
    end loop;
  end if;
  return st || jsonb_build_object('issues', to_jsonb(issues), 'checked_at', now());
end $$;

