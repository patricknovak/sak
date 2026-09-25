-- Player alerts (injuries, hat tricks, big nights), chat polls, rest-of-season lineup basis, and health
-- monitoring for the commissioner.

-- ───────────── rest-of-season projections as an auto-pilot basis ─────────────
alter table public.teams drop constraint if exists teams_auto_basis_check;
alter table public.teams add constraint teams_auto_basis_check check (auto_basis in ('proj', 'form', 'season', 'ros'));

-- ───────────── player alerts ─────────────
-- the owner hears when one of his players goes on (or comes off) the injury report
create or replace function public._injury_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare o int;
begin
  if new.injury_status is not distinct from old.injury_status then return new; end if;
  select team_id into o from rosters where player_id = new.id;
  if o is null then return new; end if;
  if new.injury_status is null then
    perform _notify(o, 'injury', format('✅ %s is off the injury report', new.name), '/player/' || new.id);
  else
    perform _notify(o, 'injury', format('🚑 %s: %s%s', new.name, new.injury_status, coalesce(' · ' || left(new.injury_note, 90), '')), '/player/' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists players_injury on public.players;
create trigger players_injury after update of injury_status on public.players for each row execute function public._injury_alert();

-- hat trick, four-point night or shutout: tell whoever has him (each fires once per game)
create or replace function public._big_night_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o int; pname text; what text;
  g int := coalesce((new.stats->>'g')::int, 0); pts int := coalesce((new.stats->>'pts')::int, 0); sho int := coalesce((new.stats->>'sho')::int, 0);
  og int := 0; opts int := 0; osho int := 0;
begin
  if tg_op = 'UPDATE' then
    og := coalesce((old.stats->>'g')::int, 0); opts := coalesce((old.stats->>'pts')::int, 0); osho := coalesce((old.stats->>'sho')::int, 0);
  end if;
  select name into pname from players where id = new.player_id;
  if g >= 3 and og < 3 then what := format('🎩 Hat trick! %s has %s goals tonight', pname, g);
  elsif pts >= 4 and opts < 4 then what := format('🔥 %s has %s points tonight', pname, pts);
  elsif sho = 1 and osho = 0 then what := format('🧱 Shutout for %s', pname);
  else return new; end if;
  select team_id into o from lineup_snapshots where player_id = new.player_id and date = new.date limit 1;
  if o is null then select team_id into o from rosters where player_id = new.player_id; end if;
  if o is not null then perform _notify(o, 'big_night', what, '/player/' || new.player_id); end if;
  return new;
end $$;
drop trigger if exists player_games_big_night on public.player_games;
create trigger player_games_big_night after insert or update of stats on public.player_games for each row execute function public._big_night_alert();
revoke execute on function public._injury_alert(), public._big_night_alert() from public, anon, authenticated;

-- ───────────── polls in chat ─────────────
create table if not exists public.polls (
  id bigint generated always as identity primary key,
  channel text not null check (channel not like 'dm:%' and channel not like 'garry:%'),
  team_id int not null references public.teams(id) on delete cascade,
  question text not null check (length(trim(question)) between 3 and 200),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  closes_at timestamptz,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_votes (
  poll_id bigint not null references public.polls(id) on delete cascade,
  team_id int not null references public.teams(id) on delete cascade,
  choice int not null check (choice >= 0),
  created_at timestamptz not null default now(),
  primary key (poll_id, team_id)
);
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
drop policy if exists read_all on public.polls;
create policy read_all on public.polls for select to authenticated using (true);
drop policy if exists post_own on public.polls;
create policy post_own on public.polls for insert to authenticated with check (team_id = public.my_team() and public.can_do('chat'));
drop policy if exists close_own on public.polls;
create policy close_own on public.polls for update to authenticated using (team_id = public.my_team() or public.is_commish());
drop policy if exists read_all on public.poll_votes;
create policy read_all on public.poll_votes for select to authenticated using (true);
-- vote, change your vote or take it back, while the poll is open
drop policy if exists vote_own on public.poll_votes;
create policy vote_own on public.poll_votes for insert to authenticated
  with check (team_id = public.my_team() and public.can_do('chat')
    and exists (select 1 from polls p where p.id = poll_id and not p.closed and (p.closes_at is null or p.closes_at > now())));
drop policy if exists revote_own on public.poll_votes;
create policy revote_own on public.poll_votes for update to authenticated using (team_id = public.my_team())
  with check (exists (select 1 from polls p where p.id = poll_id and not p.closed and (p.closes_at is null or p.closes_at > now())));
drop policy if exists unvote_own on public.poll_votes;
create policy unvote_own on public.poll_votes for delete to authenticated using (team_id = public.my_team());
revoke all on public.polls, public.poll_votes from anon;
grant select, insert, update on public.polls to authenticated;
grant usage on sequence public.polls_id_seq to authenticated;
grant select, insert, update, delete on public.poll_votes to authenticated;
-- the poll shows up in the chat stream as a card hanging off a system message
create or replace function public._poll_posted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _sys(new.channel, format('📊 %s started a poll: %s', _tname(new.team_id), new.question), jsonb_build_object('poll', new.id));
  return new;
end $$;
drop trigger if exists poll_posted on public.polls;
create trigger poll_posted after insert on public.polls for each row execute function public._poll_posted();
revoke execute on function public._poll_posted() from public, anon, authenticated;

-- ───────────── health monitoring ─────────────
-- one row per issue so the commissioner is told once per six hours, not every half hour
create table if not exists public.health_alerts (key text primary key, last_alert timestamptz not null default now());
alter table public.health_alerts enable row level security;
revoke all on public.health_alerts from anon, authenticated;

-- what the scheduled jobs and edge functions have been doing lately (the tables live in cron/net, which
-- the test database doesn't have, so each read is wrapped)
create or replace function public._health_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := '{}'; v jsonb;
begin
  begin
    select jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'last', d.start_time, 'status', d.status) order by j.jobname) into v
    from cron.job j left join lateral (select start_time, status from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
    where j.active;
    st := st || jsonb_build_object('jobs', coalesce(v, '[]'::jsonb));
  exception when undefined_table or insufficient_privilege then st := st || '{"jobs": []}'; end;
  begin
    select jsonb_build_object(
      'scores_ok_at', (select max(created) from net._http_response where status_code = 200 and content like '%"task":"scores"%' and content like '%"ok":true%'),
      'daily_ok_at', (select max(created) from net._http_response where status_code = 200 and content like '%"task":"daily"%' and content like '%"llm":%' and content like '%"ok":true%'),
      'errors_30m', (select count(*) from net._http_response where created > now() - interval '30 minutes' and (status_code >= 500 or content like '%"ok":false%' or error_msg is not null)),
      'last_error', (select left(coalesce(error_msg, content), 200) from net._http_response where created > now() - interval '6 hours' and (status_code >= 500 or content like '%"ok":false%' or error_msg is not null) order by created desc limit 1))
    into v;
    st := st || v;
  exception when undefined_table or insufficient_privilege then null; end;
  st := st || jsonb_build_object(
    'phase', (select phase from league),
    'last_score_row', (select max(updated_at) from player_games),
    'last_bot_post', (select max(created_at) from messages where kind = 'bot'),
    'games_today', (select count(*) from games where date = today_et()),
    'db_time', now());
  return st;
end $$;

-- runs every 30 minutes: anything stale or failing becomes one notification to the commissioner
create or replace function public.health_check(p_notify boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb := _health_state(); issues text[] := '{}'; k text; c int; phase text := (select phase from league);
  jobs_bad text; last_scores timestamptz; last_pending timestamptz;
begin
  select id into c from teams where is_commish order by id limit 1;
  select string_agg(j->>'job', ', ') into jobs_bad from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j
    where j->>'status' is distinct from 'succeeded' and (j->>'last')::timestamptz > now() - interval '2 hours';
  if jobs_bad is not null then issues := issues || ('Scheduled jobs failing: ' || jobs_bad); end if;
  last_scores := (st->>'scores_ok_at')::timestamptz;
  if st ? 'scores_ok_at' and (last_scores is null or last_scores < now() - interval '15 minutes') then
    issues := issues || 'NHL score sync has not succeeded in the last 15 minutes';
  end if;
  select max((j->>'last')::timestamptz) into last_pending from jsonb_array_elements(coalesce(st->'jobs', '[]'::jsonb)) j where j->>'job' = 'process-pending';
  if last_pending is not null and last_pending < now() - interval '5 minutes' then
    issues := issues || 'The draft clock / trade processor has not run for 5 minutes';
  end if;
  -- garry-daily fires at 14:00 UTC; by 15:30 there should be a successful run today (a skipped day still answers ok)
  if st ? 'daily_ok_at' and phase in ('keepers', 'predraft', 'season') and (now() at time zone 'utc')::time > time '15:30'
     and coalesce((st->>'daily_ok_at')::timestamptz, '2000-01-01') < date_trunc('day', now()) then
    issues := issues || 'Garry''s morning post did not run today';
  end if;
  if coalesce((st->>'errors_30m')::int, 0) >= 3 then
    issues := issues || format('%s edge-function errors in the last 30 minutes: %s', st->>'errors_30m', st->>'last_error');
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

-- the commissioner's System status panel
create or replace function public.commish_health() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  return health_check(false);
end $$;
revoke execute on function public._health_state(), public.health_check(boolean) from public, anon, authenticated;
revoke execute on function public.commish_health() from public, anon;
grant execute on function public.commish_health() to authenticated;
