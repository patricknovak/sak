-- Web push: phones get "you're on the clock", trade offers, bets and @mentions even when the
-- site isn't open. The VAPID private key lives in Supabase Vault (name 'vapid_private'), never
-- in the repo; create it once with: select vault.create_secret('<key>', 'vapid_private');

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  team_id int not null references public.teams on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
create index if not exists push_subscriptions_team on public.push_subscriptions (team_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- a GM registers (or refreshes) this device for their own team
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team();
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into push_subscriptions (endpoint, team_id, p256dh, auth, user_agent)
    values (p_endpoint, me, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set team_id = excluded.team_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and team_id = _team();
$$;

-- how many devices does my team have registered?
create or replace function public.push_device_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from push_subscriptions where team_id = _team();
$$;

-- the push edge function reads the private key through this; only the service role may call it
create or replace function public._vapid_private() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private' limit 1
$$;
revoke all on function public._vapid_private() from public, anon, authenticated;

grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_device_count() to authenticated;

-- every notification also goes out as a push (the edge function drops it if nobody subscribed)
create or replace function public._push_on_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_subscriptions where team_id = new.team_id) then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/push',
      body := jsonb_build_object('notification', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 5000);
  end if;
  return new;
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public._push_on_notify();
