-- Fewer bells that aren't news (23 October 2026, Patrick: "I am being notified of things when it is not true or not an
-- issue"). A week of the commissioner's bells, read against what happened:
--   * "NHL score sync has not succeeded in the last 15 minutes", 20 times: the score job only runs while a game is on
--     (`_scores_due()`), so between games its last success is always more than 15 minutes old. It now rings only while
--     scores are due.
--   * "Garry's morning post did not run today", 10 times, on days it ran: the check read the job's reply from pg_net's
--     response log, which keeps about six hours, and the morning job's own reply times out once it writes for several
--     leagues. It now looks for the morning post itself in the league's chat, after a night with NHL games.
--   * Stat corrections: 46 of the last month's 47 moved a total by less than a point, three by nothing at all. A GM hears
--     one when it moves their total by a point or more; the smaller ones still count, quietly.
--   * Injuries, about one bell a GM a day: ESPN marks a player Out on a game day and Day-To-Day the next morning, and
--     each flip rang every team that has him (Markstrom seven times in a week). A move between Day-To-Day and Out no
--     longer rings, and the same status for the same player doesn't ring the same team twice in three days. New to the
--     report, onto injured reserve and off the report still ring.
-- Safe to run twice.

create or replace function public.health_check(p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := _health_state(); issues text[] := '{}'; k text; c int; phase text := (select phase from league);
  jobs_bad text; last_scores timestamptz; last_pending timestamptz; lg int;
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

-- a stat correction tells each GM what it did to their total, in their own league's points, when it moved it by a point
-- or more (migration 331); every correction still counts and is marked heard
create or replace function public.notify_corrections() returns integer
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in
    select s.team_id,
      round(sum(x.d), 2) as delta,
      string_agg(format('%s %s%s (%s, %s)', (select name from players where id = c.player_id), case when x.d >= 0 then '+' else '' end,
        round(x.d, 2), _stat_diff(c.old_stats, c.new_stats), to_char(c.date, 'Mon DD')), '; ' order by c.id) as what
    from stat_corrections c
    join lineup_snapshots s on s.game_id = c.game_id and s.player_id = c.player_id and s.slot not in ('BN', 'IR')
    join league_rules lr on lr.league_id = s.league_id
    join scoring_profiles sp on sp.id = lr.profile_id
    cross join lateral (select _score(sp.scoring, c.new_stats) - _score(sp.scoring, c.old_stats) as d) x
    where not c.notified and x.d <> 0
    group by s.team_id
    having abs(round(sum(x.d), 2)) >= 1
  loop
    perform _notify(t.team_id, 'correction', format('📝 Stat correction%s: %s. Your total %s%s.',
      case when position(';' in t.what) > 0 then 's' else '' end, t.what, case when t.delta >= 0 then '+' else '' end, t.delta), '/standings');
    n := n + 1;
  end loop;
  update stat_corrections set notified = true where not notified;
  return n;
end $$;

-- injury news, minus ESPN's game-day flips (migration 331): Day-To-Day and Out swap on game days, so a move between the
-- two doesn't ring, and a team that heard the same status for the same player in the last three days doesn't hear it again
create or replace function public._injury_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare o int; msg text; head text;
begin
  if new.injury_status is not distinct from old.injury_status then return new; end if;
  if new.injury_status in ('Day-To-Day', 'Out') and old.injury_status in ('Day-To-Day', 'Out') then return new; end if;
  msg := case when new.injury_status is null then format('✅ %s is off the injury report', new.name)
              else format('🚑 %s: %s%s', new.name, new.injury_status, coalesce(' · ' || left(new.injury_note, 90), '')) end;
  head := case when new.injury_status is null then msg else format('🚑 %s: %s', new.name, new.injury_status) end;
  -- the team that has him, in every league that does
  for o in select team_id from rosters where player_id = new.id loop
    continue when exists (select 1 from notifications n where n.team_id = o and n.kind = 'injury' and n.link = '/player/' || new.id
                          and n.created_at > now() - interval '3 days' and left(n.body, length(head)) = head);
    perform _notify(o, 'injury', msg, '/player/' || new.id);
  end loop;
  -- the teams watching him that don't have him
  for o in select w.team_id from watchlist w
           where w.player_id = new.id and not exists (select 1 from rosters r where r.player_id = new.id and r.team_id = w.team_id) loop
    continue when exists (select 1 from notifications n where n.team_id = o and n.kind = 'injury' and n.link = '/player/' || new.id
                          and n.created_at > now() - interval '3 days' and left(n.body, length(head)) = head);
    perform _notify(o, 'injury', msg || ' (on your watch list)', '/player/' || new.id);
  end loop;
  return new;
end $$;
