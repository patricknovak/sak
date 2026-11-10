-- The commissioner's two password doors ask for 8 characters, like every other place a password is set
-- (sign-up, join, reset by code, Profile) and like the Commish page's own buttons. They still took 6 when the
-- page was bypassed. Same functions otherwise, word for word (086 and 335). Safe to run twice.

create or replace function public.commish_add_spectator(p_name text, p_email text, p_password text, p_color text default '#64748b', p_emoji text default '🍿')
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); tid int; ab text; em text := lower(trim(p_email)); lid int := current_league_id();
begin
  perform _commish();
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Give them a name'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if exists (select 1 from auth.users where lower(email) = em) or exists (select 1 from teams where lower(login_email) = em) then
    raise exception 'That email already has a login';
  end if;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', em, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, em, 'email', jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), now(), now(), now());
  ab := coalesce(nullif(upper(left(regexp_replace(p_name, '[^A-Za-z]', '', 'g'), 3)), ''), 'SPC');
  if exists (select 1 from teams where abbrev = ab and league_id = lid) then ab := left(ab, 2) || 'S'; end if;
  insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
  values (trim(p_name), ab, trim(p_name), em, uid, lid, coalesce(p_color, '#64748b'), coalesce(nullif(p_emoji, ''), '🍿'),
    'spectator', (select season from league), false, '{}')
  returning id into tid;
  update auth.users set raw_user_meta_data = jsonb_build_object('team_id', tid) where id = uid;
  insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || _brand_word('{coin,name}', 'coins', lid));
  perform _sys('general', format('🍿 %s joins the barn as a spectator. Be nice. Or don''t.', trim(p_name)));
  return tid;
end $$;

create or replace function public.commish_reset_password(p_team int, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._in_league('teams', p_team);
  perform _commish();
  perform public._commish_managed_account(p_team, 'They can reset their password with “Forgot your password?” on the sign-in page.');
  if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = (select user_id from teams where id = p_team);
end $$;
revoke execute on function public.commish_reset_password(int, text) from public, anon;
grant execute on function public.commish_reset_password(int, text) to authenticated;
