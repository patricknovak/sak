-- B8, alerts and phones (docs/EXPANSION.md). Three things that only mattered once a second league existed:
--
-- * A phone is registered per team, not just per device. push_subscriptions was keyed by the browser's endpoint,
--   so a GM in two leagues got only the alerts of the last league they turned notifications on in. The key is now
--   (endpoint, team): the same phone carries one row per league it plays in. Within one league a phone still
--   belongs to one team: turning alerts on as a different team of the same league moves the phone over, as before.
-- * Only the scheduler starts a push. The notifications trigger called the push function with the public key, and
--   anyone holding that key could replay any notification to its team's phones by id. The trigger now sends the
--   platform's admin key (read at run time through _edge_headers, never written in the text) and the function
--   refuses a replay without it. The GM's own "send me a test" still works on their sign-in.
-- * The push function names the league (title from its brand, link to its site); that part is in the function.

set client_min_messages = warning;

do $$
begin
  if (select array_agg(a.attname::text order by a.attnum)
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = 'public.push_subscriptions'::regclass and c.contype = 'p') = array['endpoint'] then
    alter table public.push_subscriptions drop constraint push_subscriptions_pkey;
    alter table public.push_subscriptions add primary key (endpoint, team_id);
  end if;
end $$;

-- a GM registers (or refreshes) this device for their own team; another team of the same league that had this
-- phone lets go of it
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team();
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from push_subscriptions s using teams t
   where s.endpoint = p_endpoint and t.id = s.team_id and s.team_id <> me
     and t.league_id = (select league_id from teams where id = me);
  insert into push_subscriptions (endpoint, team_id, p256dh, auth, user_agent, league_id)
    values (p_endpoint, me, p_p256dh, p_auth, left(p_ua, 200), (select league_id from teams where id = me))
  on conflict (endpoint, team_id) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

-- every notification also goes out as a push (the edge function drops it if nobody subscribed); the admin key
-- says it came from here
create or replace function public._push_on_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_subscriptions where team_id = new.team_id) then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/push',
      body := jsonb_build_object('notification', new.id),
      headers := _edge_headers(true),
      timeout_milliseconds := 5000);
  end if;
  return new;
end $$;
