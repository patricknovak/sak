-- health_check: appending an issue text with `issues || 'text'` made Postgres parse the text as an array
-- literal, so any message with an apostrophe (Garry's morning post did not run today) crashed the whole
-- check and the monitor went dark. array_append is unambiguous.
create or replace function public.health_check(p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := _health_state(); issues text[] := '{}'; k text; c int; phase text := (select phase from league);
  jobs_bad text; last_scores timestamptz; last_pending timestamptz;
begin
  select id into c from teams where is_commish order by id limit 1;
  select string_agg(j->>'job', ', ') into jobs_bad from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j
    where j->>'status' is distinct from 'succeeded' and (j->>'last')::timestamptz > now() - interval '2 hours';
  if jobs_bad is not null then issues := array_append(issues, 'Scheduled jobs failing: ' || jobs_bad); end if;
  last_scores := (st->>'scores_ok_at')::timestamptz;
  if st ? 'scores_ok_at' and (last_scores is null or last_scores < now() - interval '15 minutes') then
    issues := array_append(issues, 'NHL score sync has not succeeded in the last 15 minutes');
  end if;
  select max((j->>'last')::timestamptz) into last_pending from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j where j->>'job' = 'process-pending';
  if last_pending is not null and last_pending < now() - interval '5 minutes' then
    issues := array_append(issues, 'The draft clock / trade processor has not run for 5 minutes');
  end if;
  if st ? 'daily_ok_at' and phase in ('keepers', 'predraft', 'season') and (now() at time zone 'utc')::time > time '15:30'
     and coalesce((st->>'daily_ok_at')::timestamptz, '2000-01-01') < date_trunc('day', now()) then
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
