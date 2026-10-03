-- Email sign-in, step 1 (docs/EXPANSION.md B5; Patrick's call, 3 October 2026): GMs sign in with their own email and
-- the password they have today, instead of picking their team from a list that hands every GM's login address to
-- anyone holding the public key.
--
-- SaK's accounts were made with stand-in addresses (name@sakleague.app) that no GM ever typed. The commissioner puts
-- each GM's real email on their account here; the account, its password and any phone already signed in stay as they
-- are (a session belongs to the account, not the address, so nobody is signed out). Once every GM has a real email the
-- sign-in page drops the team list and team_directory stops showing addresses (step 2, a later migration).
--
-- * commish_accounts(): the commissioner's view of the league's sign-ins: who, the address, whether it is still a
--   stand-in, and when they last signed in.
-- * commish_set_login_email(team, email): puts an address on a GM's account (the auth user, its email identity and the
--   team rows that user has), refused when another account already uses it. No confirmation email: the league sends
--   none yet, and the commissioner is vouching for his GMs.

set client_min_messages = warning;

create or replace function public.commish_accounts()
returns table (team_id int, gm_name text, team_name text, role text, login_email text, stand_in boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _commish();
  return query
    select t.id, t.gm_name, t.name, t.role, t.login_email, coalesce(t.login_email ~* '@sakleague\.app$', true), u.last_sign_in_at
    from teams t left join auth.users u on u.id = t.user_id
    where t.league_id = current_league_id() and t.user_id is not null
    order by t.role, t.id;
end $$;
revoke execute on function public.commish_accounts() from public, anon;
grant execute on function public.commish_accounts() to authenticated;

create or replace function public.commish_set_login_email(p_team int, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); uid uuid;
begin
  perform public._in_league('teams', p_team);
  perform _commish();
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That doesn''t look like an email address'; end if;
  select user_id into uid from teams where id = p_team;
  if uid is null then raise exception 'That team has no sign-in yet'; end if;
  if exists (select 1 from auth.users where lower(email) = em and id <> uid) then
    raise exception 'Another account already signs in with that email';
  end if;
  update auth.users set email = em, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', em), updated_at = now()
    where user_id = uid and provider = 'email';
  update teams set login_email = em where user_id = uid;
end $$;
revoke execute on function public.commish_set_login_email(int, text) from public, anon;
grant execute on function public.commish_set_login_email(int, text) to authenticated;
