-- Accounts (Super Pools: a person can own teams in several leagues).
--
-- Until now a login was a team: `teams.user_id` was unique, and every "who am I" helper (my_team, _team,
-- is_commish, can_do, is_gm, current_league_id) read it. From here a person is an account with a membership
-- per league:
--
-- * `league_members (user_id, league_id, team_id, role)`: one row per person per league, backfilled from
--   teams and kept in step with it by a trigger, so the SaK logins work exactly as before. `teams.user_id`
--   stays the login on the team (one team per person per league, no longer one per person).
-- * `accounts (user_id, active_league_id)`: the league a person is working in when the request does not say.
-- * current_league_id() now resolves, in order: the scheduler's `app.league_id` setting; the request's
--   `x-league` header when the caller is a member of that league (the site will send it once it has a league
--   switcher); the account's active league when still a member; the person's first membership; league 1.
-- * The identity helpers read the membership for the current league, so a commissioner in one league is a
--   plain GM in another.
-- * Invites: a commissioner mints a code for a seat (an open team) or for a spectator place; a signed-in
--   person accepts it and the seat is theirs. Codes expire, count their uses and can be revoked.
--
-- For the SaK league nothing changes: nine memberships are backfilled from the nine team rows, everyone's
-- active league is 1, and no request carries a header.

set client_min_messages = warning;

-- ───────────── memberships ─────────────
create table if not exists public.league_members (
  user_id uuid not null,
  league_id int not null references public.leagues (id),
  team_id int references public.teams (id) on delete cascade,
  role text not null check (role in ('commish', 'gm', 'spectator')),
  joined_at timestamptz not null default now(),
  primary key (user_id, league_id),
  unique (team_id)
);
create index if not exists league_members_league_idx on public.league_members (league_id);

-- a person may now hold one team per league rather than one team in all
alter table public.teams drop constraint if exists teams_user_id_key;
create unique index if not exists teams_user_league_idx on public.teams (user_id, league_id) where user_id is not null;
alter table public.teams drop constraint if exists teams_login_email_key;
create unique index if not exists teams_login_email_league_idx on public.teams (league_id, lower(login_email)) where login_email is not null;

-- the team row stays the login; its membership follows it
create or replace function public._member_role(t public.teams) returns text
language sql immutable as $$
  select case when t.is_commish then 'commish' when t.role = 'spectator' then 'spectator' else 'gm' end
$$;

create or replace function public._sync_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
    delete from league_members where team_id = old.id;
  end if;
  if new.user_id is not null then
    insert into league_members (user_id, league_id, team_id, role)
    values (new.user_id, new.league_id, new.id, _member_role(new))
    on conflict (user_id, league_id) do update set team_id = excluded.team_id, role = excluded.role;
  end if;
  return new;
end $$;
drop trigger if exists teams_sync_member on public.teams;
create trigger teams_sync_member after insert or update of user_id, is_commish, role, league_id on public.teams
  for each row execute function public._sync_member();

insert into public.league_members (user_id, league_id, team_id, role)
select user_id, league_id, id, _member_role(teams) from public.teams where user_id is not null
on conflict (user_id, league_id) do nothing;

-- ───────────── accounts ─────────────
create table if not exists public.accounts (
  user_id uuid primary key,
  active_league_id int references public.leagues (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── who am I, per league ─────────────
create or replace function public.current_league_id() returns int
language sql stable security definer set search_path = public as $$
  with hdr as (
    select nullif(current_setting('request.headers', true), '')::json ->> 'x-league' as v
  )
  select coalesce(
    nullif(current_setting('app.league_id', true), '')::int,
    (select m.league_id from hdr, league_members m
      where hdr.v ~ '^\d+$' and m.user_id = auth.uid() and m.league_id = hdr.v::int),
    (select a.active_league_id from accounts a join league_members m on m.user_id = a.user_id and m.league_id = a.active_league_id
      where a.user_id = auth.uid()),
    (select min(league_id) from league_members where user_id = auth.uid()),
    1)
$$;

create or replace function public.my_team() returns int
language sql stable security definer set search_path = public as
$$ select team_id from league_members where user_id = auth.uid() and league_id = current_league_id() $$;

create or replace function public._team() returns int
language plpgsql stable security definer set search_path = public as $$
declare t int;
begin
  t := my_team();
  if t is null then raise exception 'Sign in as a GM first'; end if;
  return t;
end $$;

create or replace function public.is_commish() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_commish from teams where id = my_team()), false) $$;

create or replace function public._commish() returns int
language plpgsql stable security definer set search_path = public as $$
declare t int;
begin
  select id into t from teams where id = my_team() and is_commish;
  if t is null then raise exception 'Commissioner only'; end if;
  return t;
end $$;

create or replace function public.is_gm() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'gm' from teams where id = my_team()), false) $$;

create or replace function public.can_do(p_what text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'gm' or (coalesce((perms->>'active')::boolean, true) and coalesce((perms->>p_what)::boolean, true))
                    from teams where id = my_team()), false) $$;

-- the leagues a person belongs to, for the switcher
create or replace function public.my_leagues()
returns table (league_id int, slug text, name text, short_name text, role text, team_id int, active boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.slug, l.name, l.short_name, m.role, m.team_id, l.id = current_league_id()
  from league_members m join leagues l on l.id = m.league_id
  where m.user_id = auth.uid() order by l.id
$$;

create or replace function public.set_active_league(p_league int) returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from league_members where user_id = auth.uid() and league_id = p_league) then
    raise exception 'You are not in that league';
  end if;
  insert into accounts (user_id, active_league_id) values (auth.uid(), p_league)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return p_league;
end $$;

-- ───────────── invites ─────────────
create table if not exists public.league_invites (
  code text primary key,
  league_id int not null references public.leagues (id),
  -- the seat being offered: an open team in the league, or null for a spectator place
  team_id int references public.teams (id) on delete cascade,
  role text not null default 'gm' check (role in ('gm', 'spectator')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null default 1,
  uses int not null default 0,
  revoked boolean not null default false
);
create index if not exists league_invites_league_idx on public.league_invites (league_id);

-- the commissioner offers a seat (an open team) or a spectator place; the code is the invite link
create or replace function public.create_invite(p_team int default null, p_role text default 'gm', p_days int default 14, p_uses int default 1) returns text
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); code text;
begin
  perform _commish();
  if p_role not in ('gm', 'spectator') then raise exception 'Invite a GM or a spectator'; end if;
  if p_role = 'gm' then
    if p_team is null then raise exception 'Pick the open team the invite is for'; end if;
    if not exists (select 1 from teams where id = p_team and league_id = lid and role = 'gm' and user_id is null) then
      raise exception 'That team is not an open seat in this league';
    end if;
  end if;
  code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values (code, lid, case when p_role = 'gm' then p_team end, p_role, auth.uid(), now() + make_interval(days => greatest(p_days, 1)), greatest(p_uses, 1));
  return code;
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update league_invites set revoked = true where code = p_code and league_id = current_league_id();
end $$;

-- a signed-in person takes the seat; their account's active league becomes the one they just joined
create or replace function public.accept_invite(p_code text) returns int
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
    insert into teams (id, name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values ((select coalesce(max(id), 0) + 1 from teams), coalesce(split_part(em, '@', 1), 'Spectator'), ab, coalesce(split_part(em, '@', 1), 'Spectator'), em, uid, inv.league_id,
            '#64748b', '🍿', 'spectator', (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
  end if;
  update league_invites set uses = uses + 1 where code = inv.code;
  insert into accounts (user_id, active_league_id) values (uid, inv.league_id)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return inv.league_id;
end $$;

-- ───────────── access ─────────────
alter table public.league_members enable row level security;
alter table public.accounts enable row level security;
alter table public.league_invites enable row level security;
revoke all on public.league_members, public.accounts, public.league_invites from public, anon, authenticated;
grant select on public.league_members, public.accounts, public.league_invites to authenticated;
drop policy if exists read_mine_or_league on public.league_members;
create policy read_mine_or_league on public.league_members for select to authenticated
  using (user_id = auth.uid() or league_id = (select public.current_league_id()));
drop policy if exists read_own on public.accounts;
create policy read_own on public.accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists commish_reads on public.league_invites;
create policy commish_reads on public.league_invites for select to authenticated
  using (league_id = (select public.current_league_id()) and public.is_commish());

revoke execute on function public._member_role(public.teams), public._sync_member() from public, anon, authenticated;
revoke execute on function public.my_leagues(), public.set_active_league(int), public.create_invite(int, text, int, int), public.revoke_invite(text), public.accept_invite(text) from public, anon;
grant execute on function public.my_leagues(), public.set_active_league(int), public.create_invite(int, text, int, int), public.revoke_invite(text), public.accept_invite(text) to authenticated;
