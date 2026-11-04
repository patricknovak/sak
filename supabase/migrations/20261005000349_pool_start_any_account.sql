-- Any signed-in account can start a pool, not only one already seated in a pool.
--
-- pool_start (migration 153) refused an account with no seat ("Join a pool first"): the door for someone new was the
-- join function's `pool` body, which makes the account and the pool together under the door's limits. That left two
-- accounts with no way to host: a fan who joined the fan zones with just a name (migration 337), and someone whose last
-- pool was deleted. Both now start one here. _pool_open keeps its own caps (five a day and 25 in all per account); a
-- name-only account (an @guest.superpoolsai.com address, made five a day from one connection by the fan or guest door)
-- adds one more: a hundred pools a day across every name-only host, so the cheap door can't fill the platform. The
-- host's name for a fan is the name they gave the fan zones. Safe to run twice.

create or replace function public.pool_start(p_name text, p_color text default null, p_pack text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare fan text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from league_members where user_id = auth.uid()) then
    if (select email from auth.users where id = auth.uid()) like '%@guest.superpoolsai.com'
       and (select count(*) from leagues l join auth.users u on u.id = l.owner_user
            where l.created_at > now() - interval '1 day' and u.email like '%@guest.superpoolsai.com') >= 100 then
      raise exception 'Lots of pools started today. Add an email to your name, or try again tomorrow';
    end if;
    fan := (select nullif(btrim(f.name), '') from private.fan_people f where f.user_id = auth.uid());
  end if;
  return _pool_open(auth.uid(), p_name, p_color, p_pack, fan);
end $$;
revoke execute on function public.pool_start(text, text, text) from public, anon;
grant execute on function public.pool_start(text, text, text) to authenticated;
