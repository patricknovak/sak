-- Joining a pool with just a name (23 October 2026, the phone review's first recommendation, Patrick: build it). A pool
-- invite asked for a name, an email and a password before anyone saw a question, and every pool outside SaK had one
-- member. The join edge function now makes a guest seat from a name alone (an account on a placeholder address, kept
-- on the phone that joined), and the member adds an email later to keep it everywhere. Open links can be shared
-- anywhere, so name-only joins are limited per connection: ten a day from one address and three hundred a day in all,
-- the rest asked to add an email. Only the function calls this (service role). Safe to run twice.

create table if not exists private.guest_joins (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists guest_joins_ip_at on private.guest_joins (ip, at);

-- null when a name-only join may go ahead (and counts it), else the reason in the member's words
create or replace function public._guest_join_check(p_ip text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.guest_joins where at < now() - interval '2 days';
  if coalesce(p_ip, '') <> '' and (select count(*) from private.guest_joins where ip = p_ip and at > now() - interval '1 day') >= 10 then
    return 'Too many joins from this connection today. Add an email to join.';
  end if;
  if (select count(*) from private.guest_joins where at > now() - interval '1 day') >= 300 then
    return 'Joining without an email is busy right now. Add an email to join.';
  end if;
  insert into private.guest_joins (ip) values (coalesce(p_ip, ''));
  return null;
end $$;
revoke execute on function public._guest_join_check(text) from public, anon, authenticated;
