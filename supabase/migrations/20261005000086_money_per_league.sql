-- Super Pools B6 (money) and two medium items from the expansion review.
--
-- * Billing and payouts are the caller's league's. commish_bill_entries billed every league's GMs and
--   commish_post_payouts counted every league's GMs into the prize pool and ranked teams from every league (both run
--   with the owner's rights, which see past row-level security). Both now work on the commissioner's league only.
-- * The words on the ledger come from the league's brand: its trophy, its last-place prize, its regular-season and
--   playoff prizes and its fund. SaK's read exactly as before ("The Johnson (regular season)", "SAK Cup (full year)",
--   "Peter Punishment ... to the SaK Fund").
-- * teams.id takes the next number from a sequence; accept_invite and commish_add_spectator took max(id) + 1, which
--   two sign-ups at once could both take. A spectator lands in the commissioner's league, with a short name unique in
--   that league and the league's coin name on the opening balance.
-- The Fund itself (one row, SaK's) waits on Patrick's decision: per league, or SaK's own (docs/EXPANSION.md, B6).

set client_min_messages = warning;

-- a league's word for something, from its brand, with a default for leagues that haven't named it
create or replace function public._brand_word(p_path text[], p_default text, p_league int default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select brand #>> p_path from leagues where id = coalesce(p_league, current_league_id())), ''), p_default)
$$;

-- the league's fund, named by its brand or after the league ("SaK Fund")
create or replace function public._fund_name(p_league int default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(l.brand ->> 'fund', ''), l.short_name || ' Fund', 'the Fund')
  from leagues l where l.id = coalesce(p_league, current_league_id())
$$;

-- SaK's prizes by name, so the brand carries them like the trophy and the last-place prize
update public.leagues set brand = brand || jsonb_build_object('regular', 'The Johnson', 'playoff', 'The Playoff Cup')
where id = 1 and not (brand ? 'regular');

-- teams.id from a sequence
do $$ begin
  if not exists (select 1 from pg_class where relname = 'teams_id_seq' and relnamespace = 'public'::regnamespace) then
    create sequence public.teams_id_seq owned by public.teams.id;
  end if;
  perform setval('public.teams_id_seq', greatest(coalesce((select max(id) from public.teams), 0), 1));
  alter table public.teams alter column id set default nextval('public.teams_id_seq');
end $$;

create or replace function public.commish_bill_entries(p_season text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare lg league; s text; n int; lid int := current_league_id();
begin
  perform _commish();
  select * into lg from league;
  s := coalesce(p_season, lg.season);
  insert into ledger (season, team_id, kind, amount, description)
    select s, t.id, 'entry', lg.entry_fee, format('%s entry: $%s to the prize pool, $%s to the %s', s, lg.entry_fee - lg.sak_fee, lg.sak_fee, _fund_name(lid))
    from teams t where t.role = 'gm' and t.league_id = lid
      and not exists (select 1 from ledger l where l.team_id = t.id and l.season = s and l.kind = 'entry');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.commish_post_payouts(p_pot text) returns integer
language plpgsql security definer set search_path = public as $$
declare lg league; lid int := current_league_id(); pool numeric; share numeric; label text; r record; n int := 0;
  last_t int; second_pts numeric; last_pts numeric; mine int[];
begin
  perform _commish();
  select * into lg from league;
  if p_pot not in ('regular', 'playoffs', 'cup') then raise exception 'Pot is regular, playoffs or cup'; end if;
  label := case p_pot
    when 'regular' then _brand_word('{regular}', 'Regular season champion') || ' (regular season)'
    when 'playoffs' then regexp_replace(_brand_word('{playoff}', 'Playoff champion'), '^The ', '')
    else regexp_replace(_brand_word('{trophy}', 'The Cup'), '^The ', '') || ' (full year)' end;
  if exists (select 1 from ledger where league_id = lid and season = lg.season and kind = 'payout' and description like '%' || label || '%') then
    raise exception 'Those payouts are already posted';
  end if;
  -- this league's GMs only: the standings views run with the owner's rights here and would rank every league's teams
  select array_agg(id) into mine from teams where role = 'gm' and league_id = lid;
  pool := (lg.entry_fee - lg.sak_fee) * coalesce(array_length(mine, 1), 0);
  share := case p_pot when 'playoffs' then lg.playoff_share when 'cup' then lg.cup_share else 100 - lg.playoff_share - lg.cup_share end / 100;
  for r in execute format('select team_id, rank, points from %I where team_id = any($1) order by rank, team_id limit 3',
      case p_pot when 'regular' then 'standings' when 'playoffs' then 'playoff_standings' else 'sak_cup_standings' end) using mine loop
    n := n + 1;
    insert into ledger (season, team_id, kind, amount, description)
      values (lg.season, r.team_id, 'payout', -round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2),
              format('%s %s: %s place', lg.season, label, case n when 1 then '1st' when 2 then '2nd' else '3rd' end));
    perform _notify(r.team_id, 'money', format('🏆 %s: $%s coming your way.', label, round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2)), '/money');
  end loop;
  if p_pot = 'regular' then
    select team_id, points into last_t, last_pts from standings where team_id = any(mine) order by points asc, team_id limit 1;
    select points into second_pts from standings where team_id = any(mine) order by points asc, team_id offset 1 limit 1;
    if last_t is not null and second_pts > last_pts then
      insert into ledger (season, team_id, kind, amount, description)
        values (lg.season, last_t, 'peter', round(second_pts - last_pts, 2),
                format('%s %s Punishment: $1 a point behind second-last, to the %s', lg.season,
                       regexp_replace(_brand_word('{booby}', 'Last place'), '^The ', ''), _fund_name(lid)));
    end if;
  end if;
  perform _sys('general', format('💰 %s payouts posted. See the Money page.', label));
  return n;
end $$;

create or replace function public.commish_add_spectator(p_name text, p_email text, p_password text, p_color text default '#64748b', p_emoji text default '🍿')
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); tid int; ab text; em text := lower(trim(p_email)); lid int := current_league_id();
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

create or replace function public.accept_invite(p_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare inv league_invites; uid uuid := auth.uid(); em text; ab text; tid int;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into inv from league_invites where code = lower(trim(p_code)) for update;
  if inv.code is null or inv.revoked or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'That invite is no longer good';
  end if;
  if exists (select 1 from league_members where user_id = uid and league_id = inv.league_id) then
    raise exception 'You are already in this league';
  end if;
  select email into em from auth.users where id = uid;
  if inv.team_id is not null then
    if exists (select 1 from teams where id = inv.team_id and user_id is not null) then
      raise exception 'That seat has been taken';
    end if;
    update teams set user_id = uid, login_email = coalesce(login_email, em) where id = inv.team_id;
    tid := inv.team_id;
  else
    -- a spectator place: a team row with no roster, the way commish_add_spectator makes one
    ab := coalesce(nullif(upper(left(regexp_replace(coalesce(split_part(em, '@', 1), 'spectator'), '[^A-Za-z]', '', 'g'), 3)), ''), 'SPC');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (coalesce(split_part(em, '@', 1), 'Spectator'), ab, coalesce(split_part(em, '@', 1), 'Spectator'), em, uid, inv.league_id,
            '#64748b', '🍿', 'spectator', (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
  end if;
  update league_invites set uses = uses + 1 where code = inv.code;
  insert into accounts (user_id, active_league_id) values (uid, inv.league_id)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return inv.league_id;
end $$;

revoke execute on function public._brand_word(text[], text, int), public._fund_name(int) from public, anon, authenticated;
