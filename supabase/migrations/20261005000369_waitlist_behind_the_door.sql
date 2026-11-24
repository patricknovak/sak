-- The waitlist stops taking the public key.
--
-- The landing's "notify me" form wrote straight to public.waitlist with the publishable key (migration 61): the one
-- open door Cloudflare's bot check could not cover, since nothing stood between the internet and the table. The form
-- now goes through the join function's waitlist door (after the check, written with the service key), so the public
-- key's insert is taken away here. The service role keeps writing; nobody reads it through the API, as before.
--
-- Apply only once the join function with the waitlist door is deployed (it deploys on merge): before that the form
-- has no other road. After it, a copy of the landing from before the change answers "email hello@" until it reloads
-- (the landing's pages are cached five minutes).
--
-- Safe to run twice.

drop policy if exists waitlist_signup on public.waitlist;
revoke all on public.waitlist from public, anon, authenticated;
revoke all on sequence public.waitlist_id_seq from public, anon, authenticated;
grant insert, select on public.waitlist to service_role;
grant usage on sequence public.waitlist_id_seq to service_role;
