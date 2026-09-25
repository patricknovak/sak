-- Spectator accounts: friends who watch the league, chat and bet without a team, as a tryout before joining
-- as a GM. A spectator is a row in teams with role = 'spectator' and no roster, picks or standings entry, so
-- chat, DMs, reactions, notifications, coins, side bets, feature ideas and presence all work unchanged. The
-- commissioner can switch off chat, DMs, bets or ideas per spectator, or pause the whole pass.

alter table public.teams add column if not exists role text not null default 'gm' check (role in ('gm', 'spectator'));
-- {"chat":false,"dm":false,"bets":false,"ideas":false,"active":false}: a missing key means allowed
alter table public.teams add column if not exists perms jsonb not null default '{}'::jsonb;

create or replace function public.is_gm() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'gm' from teams where user_id = auth.uid()), false) $$;

-- may the signed-in account do this? GMs always can; spectators only what the commissioner allows
create or replace function public.can_do(p_what text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'gm' or (coalesce((perms->>'active')::boolean, true) and coalesce((perms->>p_what)::boolean, true))
                    from teams where user_id = auth.uid()), false) $$;

create or replace function public._gm_only() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_gm() then raise exception 'Spectators can watch, chat and bet, but that one is for GMs'; end if;
end $$;
create or replace function public._need(p_what text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_do(p_what) then raise exception 'The commissioner has switched off % for your spectator pass', p_what; end if;
end $$;
grant execute on function public.is_gm(), public.can_do(text) to authenticated;
revoke execute on function public._gm_only(), public._need(text) from public, anon, authenticated;

-- Team-only actions get a guard as their first statement; bets get the "bets" permission check. Patching the
-- live definitions keeps every later fix to these functions intact.
do $$
declare f record; src text;
begin
  for f in
    select p.oid, p.proname,
      case when p.proname in ('create_bet', 'respond_bet', 'claim_bet', 'confirm_bet') then 'perform _need(''bets'');' else 'perform _gm_only();' end as guard
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname = 'plpgsql' and p.proname in (
      'add_player', 'drop_player', 'propose_trade', 'respond_trade', 'cancel_trade', 'set_keepers', 'move_player', 'auto_lineup',
      'set_lineup', 'set_lineup_prefs', 'set_pin', 'draft_pick', 'create_proposal', 'vote_proposal', 'cosponsor_proposal',
      'create_bet', 'respond_bet', 'claim_bet', 'confirm_bet')
  loop
    src := pg_get_functiondef(f.oid);
    if position('_gm_only()' in src) = 0 and position('_need(' in src) = 0 then
      src := regexp_replace(src, '\mbegin\M', 'begin ' || f.guard, 'i');   -- the first "begin" opens the body
      execute src;
    end if;
  end loop;
end $$;

-- the draft and keepers only involve GMs
do $$
declare src text; n int;
begin
  src := pg_get_functiondef('public.draft_set_order(int[])'::regprocedure);
  src := replace(src, '(select count(*) from teams)', '(select count(*) from teams where role = ''gm'')');
  if position('where role = ''gm''' in src) = 0 then raise exception 'draft_set_order: team count not found'; end if;
  execute src;
  src := pg_get_functiondef('public.finalize_keepers()'::regprocedure);
  src := replace(src, 'select id from teams where not keepers_submitted or not exists (select 1 from rosters where team_id = teams.id and keeper)',
                      'select id from teams where role = ''gm'' and (not keepers_submitted or not exists (select 1 from rosters where team_id = teams.id and keeper))');
  src := replace(src, 'select id, name from teams order by id', 'select id, name from teams where role = ''gm'' order by id');
  n := (length(src) - length(replace(src, 'role = ''gm''', ''))) / length('role = ''gm''');
  if n <> 2 then raise exception 'finalize_keepers: expected 2 patches, made %', n; end if;
  execute src;
end $$;
create or replace function public._ensure_picks(p_season text) returns void
language sql security definer set search_path = public as $$
  insert into draft_picks (season, round, original_team, team_id)
  select p_season, r, t.id, t.id from teams t, league l, generate_series(1, l.draft_rounds) r where t.role = 'gm'
  on conflict do nothing;
$$;
create or replace function public.draft_randomize_order() returns int[]
language plpgsql security definer set search_path = public as $$
declare o int[];
begin
  perform _commish();
  select array_agg(id order by random()) into o from teams where role = 'gm';
  perform draft_set_order(o);
  return o;
end $$;

-- standings tables list GMs only; the login screen needs to know who is a spectator
create or replace view public.standings as
  with d as (select team_id, date, points, games from team_daily),
  agg as (
    select t.id as team_id,
      coalesce(sum(d.points), (0)::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), (0)::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), (0)::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), (0)::numeric) as last7,
      coalesce(sum(d.games), (0)::numeric) as games
    from teams t left join d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id)
  select team_id, points, today, yesterday, last7, games, rank() over (order by points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves
  from agg;
create or replace view public.playoff_standings as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), (0)::numeric) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), (0)::numeric) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), (0)::numeric) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), (0)::numeric) as last7,
      coalesce(sum(d.games), (0)::numeric) as games
    from teams t left join playoff_daily d on d.team_id = t.id
    where t.role = 'gm'
    group by t.id)
  select agg.*, rank() over (order by points desc) as rank from agg;
create or replace view public.team_directory as
  select id, name, abbrev, gm_name, login_email, color, emoji, role from teams;
revoke all on public.standings, public.playoff_standings from anon, authenticated;
grant select on public.standings, public.playoff_standings to authenticated;
revoke all on public.team_directory from anon, authenticated;
grant select on public.team_directory to anon, authenticated;

-- chat, reactions and feature ideas honour the spectator's permissions
drop policy if exists post_own on public.messages;
create policy post_own on public.messages for insert to authenticated
  with check (team_id = public.my_team() and kind = 'user' and public.can_do('chat')
    and ((channel not like 'dm:%' and channel not like 'garry:%')
      or (channel like 'dm:%' and public.can_do('dm') and public.my_team()::text = any (string_to_array(substr(channel, 4), '-')))
      or (channel like 'garry:%' and public.my_team()::text = substr(channel, 7))));
drop policy if exists react_own on public.reactions;
create policy react_own on public.reactions for insert to authenticated with check (team_id = public.my_team() and public.can_do('chat'));
drop policy if exists post_own on public.feature_comments;
create policy post_own on public.feature_comments for insert to authenticated with check (team_id = public.my_team() and public.can_do('ideas'));
drop policy if exists post_own on public.feature_ideas;
create policy post_own on public.feature_ideas for insert to authenticated
  with check (team_id = public.my_team() and status = 'new' and commish_note is null and public.can_do('ideas'));
drop policy if exists vote_own on public.feature_votes;
create policy vote_own on public.feature_votes for insert to authenticated with check (team_id = public.my_team() and public.can_do('ideas'));

-- ───────────── commissioner tools ─────────────
-- creates the login and the spectator row, with 1,000 St. Patrick coins to bet
create or replace function public.commish_add_spectator(p_name text, p_email text, p_password text, p_color text default '#64748b', p_emoji text default '🍿') returns int
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); tid int; ab text; em text := lower(trim(p_email));
begin
  perform _commish();
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Give them a name'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn''t look right'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
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
  if exists (select 1 from teams where abbrev = ab) then ab := left(ab, 2) || 'S'; end if;
  insert into teams (id, name, abbrev, gm_name, login_email, user_id, color, emoji, role, joined_season, auto_lineup, perms)
  values ((select coalesce(max(id), 0) + 1 from teams), trim(p_name), ab, trim(p_name), em, uid, coalesce(p_color, '#64748b'), coalesce(nullif(p_emoji, ''), '🍿'),
    'spectator', (select season from league), false, '{}')
  returning id into tid;
  update auth.users set raw_user_meta_data = jsonb_build_object('team_id', tid) where id = uid;
  insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 St. Patrick coins');
  perform _sys('general', format('🍿 %s joins the barn as a spectator. Be nice. Or don''t.', trim(p_name)));
  return tid;
end $$;

-- flip permissions: commish_set_spectator(9, '{"chat": false}')
create or replace function public.commish_set_spectator(p_team int, p_perms jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update teams set perms = perms || p_perms where id = p_team and role = 'spectator';
  if not found then raise exception 'Not a spectator account'; end if;
end $$;
revoke execute on function public.commish_add_spectator(text, text, text, text, text), public.commish_set_spectator(int, jsonb) from public, anon;
grant execute on function public.commish_add_spectator(text, text, text, text, text), public.commish_set_spectator(int, jsonb) to authenticated;
