-- Confirming a new email with a code (9 November 2026, docs/LAUNCH-READINESS-2026-10-28.md item 4, Patrick's yes).
-- The join function makes a stranger's account unconfirmed and has Auth email it a code; the same address typed again
-- before the code was used (another try, another phone) must not read as "already has an account". This finds that
-- pending account: unconfirmed, in no league, owning none, so nothing with a seat is ever handed back. Service role only.
create or replace function public._signup_pending(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
    and u.email_confirmed_at is null
    and not exists (select 1 from league_members m where m.user_id = u.id)
    and not exists (select 1 from leagues l where l.owner_user = u.id)
  limit 1
$$;
revoke execute on function public._signup_pending(text) from public, anon, authenticated;
grant execute on function public._signup_pending(text) to service_role;
