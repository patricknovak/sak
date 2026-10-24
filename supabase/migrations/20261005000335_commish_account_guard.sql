-- A commissioner changes only the sign-ins the league made (security review, 24 October 2026). commish_reset_password
-- and commish_set_login_email write auth.users for any team in the caller's league, and since one account plays in
-- every pool (migration 151) anyone can start a pool, invite a friend and, once the friend takes the seat, reset that
-- friend's password or move their sign-in email: the whole account, a platform admin's included. Both now refuse
-- unless the account on the team is one this league made and still looks after:
--   * made by the league: still on a stand-in address (name@sakleague.app, the way SaK's accounts were made, migration
--     103), or made by commish_add_spectator for this very team (user_metadata.team_id: nothing else writes it, and
--     the invite, guest and new-pool sign-ups in the join edge function never do). A member can write their own
--     user_metadata, but that only ever opens their own account to their own commissioner;
--   * in no other league: a member who has joined another pool or started one looks after their own sign-in;
--   * not a platform admin, and not a commissioner (co-commissioners can't take over each other; a commissioner's
--     own password is on their Profile).
-- Everyone else resets their password with "Forgot your password?" on the sign-in page (a 6-digit code by email) or
-- changes it on their Profile. The account is read from auth.users, not teams.login_email, which is a copy and can
-- lag behind. The two functions are otherwise as they were: same arguments, security definer, search_path, checks,
-- order and rights. Safe to run twice.

set client_min_messages = warning;

-- refuses unless the account on p_team is one the commissioner may change (above), with p_hint saying what to do
-- instead; a seat with no account passes, and the caller carries on as before
create or replace function public._commish_managed_account(p_team int, p_hint text default '') returns void
language plpgsql stable security definer set search_path = public as $$
declare t teams; em text; meta jsonb;
begin
  select * into t from teams where id = p_team;
  if t.user_id is null then return; end if;
  select u.email, u.raw_user_meta_data into em, meta from auth.users u where u.id = t.user_id;
  if t.is_commish
     or exists (select 1 from ops.platform_admins a where a.user_id = t.user_id)
     or exists (select 1 from league_members m where m.user_id = t.user_id and m.league_id <> t.league_id)
     or exists (select 1 from teams o where o.user_id = t.user_id and o.league_id <> t.league_id)
     or not (coalesce(em, '') ~* '@sakleague\.app$' or coalesce(meta ->> 'team_id', '') = p_team::text)
  then
    raise exception 'That sign-in is their own, not one this league made, so it can''t be changed here.%',
      case when coalesce(p_hint, '') = '' then '' else ' ' || p_hint end;
  end if;
end $$;
revoke execute on function public._commish_managed_account(int, text) from public, anon, authenticated;

create or replace function public.commish_reset_password(p_team int, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._in_league('teams', p_team);
  perform _commish();
  perform public._commish_managed_account(p_team, 'They can reset their password with “Forgot your password?” on the sign-in page.');
  if length(p_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = (select user_id from teams where id = p_team);
end $$;
revoke execute on function public.commish_reset_password(int, text) from public, anon;
grant execute on function public.commish_reset_password(int, text) to authenticated;

create or replace function public.commish_set_login_email(p_team int, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); uid uuid;
begin
  perform public._in_league('teams', p_team);
  perform _commish();
  perform public._commish_managed_account(p_team);
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
