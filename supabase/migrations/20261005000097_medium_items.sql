-- The medium SQL items from the expansion review (docs/EXPANSION.md, section 5), closing Phase 1's list.
--
-- * A commissioner's custom Book market names its league outright instead of leaning on the column default.
-- * The system status panel (commish_health) shows the platform's scheduler jobs and its last error, from any
--   league, to every league's commissioner. The whole picture is now for platform admins; a league's commissioner
--   sees their league's part (sync times, games, the last bot post) without the platform's job list or errors.
-- * A row that names a team never moves to a team in another league: rosters and draft picks refuse it (B1 already
--   made a cross-league trade impossible; this makes it impossible for any path).
-- * The scheduler's heavy nhl-sync tasks (players, projections, corrections) send the platform's admin key, read at run
--   time from private.app_keys so it never sits in a job's text or the repo (the jobs move in the _cron file); the
--   function will refuse those tasks to the public key alone.

set client_min_messages = warning;

create or replace function public.commish_market(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare id bigint; opts jsonb := coalesce(p->'options', '[]'::jsonb); o jsonb;
begin
  perform _commish();
  if length(trim(coalesce(p->>'title', ''))) < 3 then raise exception 'Give the market a title'; end if;
  if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'Two to eight options'; end if;
  for o in select * from jsonb_array_elements(opts) loop
    if length(trim(coalesce(o->>'label', ''))) < 1 or (o->>'odds')::numeric < 1.05 or (o->>'odds')::numeric > 50 then raise exception 'Each option needs a label and odds between 1.05 and 50'; end if;
  end loop;
  insert into markets (kind, title, date, subject, options, closes_at, created_by, league_id)
    values ('custom', left(trim(p->>'title'), 140), coalesce(nullif(p->>'date', '')::date, today_et()), jsonb_build_object('terms', p->>'terms'),
      (select jsonb_agg(jsonb_build_object('key', 'o' || (i - 1), 'label', left(trim(x->>'label'), 60), 'odds', round((x->>'odds')::numeric, 2))) from jsonb_array_elements(opts) with ordinality as t(x, i)),
      coalesce(nullif(p->>'closes_at', '')::timestamptz, now() + interval '1 day'), _team(), current_league_id())
    returning markets.id into id;
  perform _sys('general', format('📖 New market from the commish: "%s" · %s 👉 #/bets?t=book', p->>'title',
    (select string_agg(format('%s @ %s', x->>'label', round((x->>'odds')::numeric, 2)), ' · ') from jsonb_array_elements(opts) x)), jsonb_build_object('market', id));
  return id;
end $function$;

create or replace function public.commish_health() returns jsonb
language plpgsql security definer set search_path = public as $$
declare h jsonb;
begin
  perform _commish();
  h := health_check(false);
  if is_platform_admin() then return h; end if;
  -- a league's commissioner: no platform job list, no platform error text
  return (h - 'jobs' - 'last_error') || jsonb_build_object('jobs', '[]'::jsonb, 'last_error', null);
end $$;

-- a team's row stays in its league
create or replace function public._team_stays_in_league() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is distinct from old.team_id and new.team_id is not null
     and (select league_id from teams where id = new.team_id) is distinct from new.league_id then
    raise exception 'That team plays in another league';
  end if;
  return new;
end $$;
create or replace trigger rosters_same_league before update of team_id on public.rosters for each row execute function public._team_stays_in_league();
create or replace trigger draft_picks_same_league before update of team_id on public.draft_picks for each row execute function public._team_stays_in_league();

-- the headers the scheduler sends to an edge function: the public key, plus the platform's admin key for the tasks
-- that need it (read here, at run time, so no job's text holds it)
create or replace function public._edge_headers(p_admin boolean default false) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA')
    || case when p_admin then jsonb_build_object('x-admin-key', (select value from private.app_keys where name = 'admin')) else '{}'::jsonb end
$$;
revoke execute on function public._edge_headers(boolean) from public, anon, authenticated, service_role;
