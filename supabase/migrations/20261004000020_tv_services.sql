-- Where each GM watches hockey: their TV provider (Telus, Rogers, Bell, ...) and streaming services, so the
-- NHL page can point them at the broadcaster where their login works and flag the games they can watch.
alter table public.teams add column if not exists tv jsonb not null default '{}'::jsonb;
-- {"provider": "telus", "services": ["sn", "tsn", "cbc", "espn", "tnt", "prime", "nhltv"]}
create or replace function public.set_tv(p_tv jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_tv) <> 'object' then raise exception 'Bad TV settings'; end if;
  update teams set tv = p_tv where user_id = auth.uid();
end $$;
revoke execute on function public.set_tv(jsonb) from public, anon;
grant execute on function public.set_tv(jsonb) to authenticated;
