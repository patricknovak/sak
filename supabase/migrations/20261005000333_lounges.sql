-- Lounges: one chat per sports league or show, shared by everyone in Super Pools who follows it (23 October 2026,
-- Patrick: "chats for all individual sports leagues or pool types such as Love is Blind that extend across pools ...
-- shared within all players in superpools for that league or pool but can be filtered to just include the information
-- that members of your pool or league are sharing").
--
-- * lounges: the rooms (the NHL, the NFL, the Premier League, Love Is Blind...). An event (competitions.lounge) and a
--   question pack (pool_packs.lounge) name the room they belong to; a fantasy league's is its sport.
-- * _league_lounges(league): the rooms a pool or league is in, read from what it plays: its games' events, its
--   automatic prop sheets, its questions' packs. A pool of its own questions has no room beyond its own chat.
-- * lounge_messages: shared across pools on purpose (no league_id; tenancy.sql lists it). A member reads the rooms of
--   every pool they're in; each post carries the pool it came from (from_league), so the site can show only the posts
--   from the caller's own pool. Who wrote it stays out of the shared row (private.lounge_posts): a stranger sees a first
--   name and an initial, never an account, a team or another pool's name.
-- * lounge_post(room, body): from the pool the caller is in now, into one of its rooms; a post every 5 seconds and 20
--   in 10 minutes at most.
-- * lounge_remove(id): the writer takes their own post down, a platform admin any post. lounge_report(id): three
--   different members reporting a post take it down, and the first report bells the platform admins. A removed post is
--   kept in private.lounge_removed and deleted from the room, so realtime tells every open screen it's gone.
-- Safe to run twice.

create table if not exists public.lounges (
  key text primary key,
  name text not null,
  emoji text not null default '💬',
  sort int not null default 100
);
alter table public.lounges enable row level security;
drop policy if exists lounges_read on public.lounges;
create policy lounges_read on public.lounges for select using (true);
grant select on public.lounges to anon, authenticated;

insert into public.lounges (key, name, emoji, sort) values
  ('nhl', 'NHL', '🏒', 10), ('nfl', 'NFL', '🏈', 20), ('nba', 'NBA', '🏀', 30), ('mlb', 'MLB', '⚾', 40),
  ('ncaab', 'College basketball', '🏀', 50), ('epl', 'Premier League', '⚽', 60), ('mls', 'MLS', '⚽', 70),
  ('ligamx', 'Liga MX', '⚽', 80), ('nwsl', 'NWSL', '⚽', 90), ('ucl', 'Champions League', '⚽', 100),
  ('wsl', 'Women''s Super League', '⚽', 110), ('womens-world-cup', 'Women''s World Cup', '🏆', 120),
  ('love-is-blind', 'Love Is Blind', '💍', 200), ('traitors', 'The Traitors', '🗡️', 210)
on conflict (key) do update set name = excluded.name, emoji = excluded.emoji, sort = excluded.sort;

alter table public.competitions add column if not exists lounge text references public.lounges(key);
alter table public.pool_packs add column if not exists lounge text references public.lounges(key);
-- every sport but soccer is one league; soccer's room is the competition itself
update public.competitions set lounge = case when sport = 'soccer' then id else sport end
  where lounge is null and (case when sport = 'soccer' then id else sport end) in (select key from public.lounges);
update public.pool_packs p set lounge = x.lounge from (values
  ('love-is-blind-s11', 'love-is-blind'), ('traitors-new-blood', 'traitors'), ('womens-world-cup-2027', 'womens-world-cup'),
  ('world-series-2026', 'mlb'), ('mls-cup-2026', 'mls'), ('nba-2026-27', 'nba'), ('nfl-2026', 'nfl'),
  ('nhl-2026-27', 'nhl'), ('premier-league-2026-27', 'epl')) as x(slug, lounge)
  where p.slug = x.slug and p.lounge is null;

-- the rooms a league is in, from what it plays
create or replace function public._league_lounges(p_league int) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct k from (
    select c.lounge from pool_games g join competitions c on c.id = g.competition where g.league_id = p_league
    union all select c.lounge from pool_auto_sheets a join competitions c on c.id = a.competition where a.league_id = p_league
    union all select pk.lounge from pool_markets m join pool_packs pk on pk.slug = m.pack where m.league_id = p_league
    union all select c.lounge from pool_markets m join competitions c on c.pack = m.pack where m.league_id = p_league
    union all select lo.key from leagues l join lounges lo on lo.key = l.sport where l.id = p_league and l.kind = 'fantasy'
  ) x(k) where k is not null
$$;
revoke execute on function public._league_lounges(int) from public, anon, authenticated;

-- the rooms the caller can read: those of every pool and league they're in
create or replace function public._my_lounge_keys() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct k from league_members m cross join lateral _league_lounges(m.league_id) k where m.user_id = auth.uid()
$$;
revoke execute on function public._my_lounge_keys() from public, anon;
grant execute on function public._my_lounge_keys() to authenticated;

create table if not exists public.lounge_messages (
  id bigint generated always as identity primary key,
  lounge text not null references public.lounges(key),
  from_league int not null references public.leagues(id) on delete cascade,
  author text not null,
  body text not null check (char_length(body) between 1 and 800),
  created_at timestamptz not null default now()
);
create index if not exists lounge_messages_room on public.lounge_messages (lounge, id desc);
alter table public.lounge_messages enable row level security;
drop policy if exists lounge_messages_read on public.lounge_messages;
create policy lounge_messages_read on public.lounge_messages for select to authenticated
  using (lounge in (select public._my_lounge_keys()));
revoke all on public.lounge_messages from anon, authenticated;
grant select on public.lounge_messages to authenticated;
do $$ begin alter publication supabase_realtime add table public.lounge_messages; exception when others then null; end $$;

create table if not exists private.lounge_posts (
  id bigint primary key references public.lounge_messages(id) on delete cascade,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists lounge_posts_user on private.lounge_posts (user_id, at desc);
create table if not exists private.lounge_reports (
  message_id bigint not null,
  user_id uuid not null,
  at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create table if not exists private.lounge_removed (
  id bigint primary key,
  lounge text not null,
  from_league int,
  user_id uuid,
  author text,
  body text,
  created_at timestamptz,
  removed_at timestamptz not null default now(),
  removed_by uuid,
  why text not null
);

-- a first name and an initial: what a stranger in the room sees of a member
create or replace function public._lounge_name(p_name text) returns text
language sql immutable set search_path = public as $$
  select case when array_length(w, 1) > 1 then w[1] || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.' else coalesce(nullif(w[1], ''), 'A member') end
  from (select regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ') w) x
$$;

-- the rooms of the caller's pools: the ones this pool is in first, then the rest, with how busy each is
create or replace function public.my_lounges() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', lo.key, 'name', lo.name, 'emoji', lo.emoji,
      'here', lo.key in (select _league_lounges(current_league_id())),
      'pools', (select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.id) from league_members m join leagues l on l.id = m.league_id
                where m.user_id = auth.uid() and lo.key in (select _league_lounges(m.league_id))),
      'today', (select count(*) from lounge_messages x where x.lounge = lo.key and x.created_at > now() - interval '24 hours'),
      'last_at', (select max(x.created_at) from lounge_messages x where x.lounge = lo.key))
    order by lo.key not in (select _league_lounges(current_league_id())), lo.sort), '[]')
  from lounges lo where lo.key in (select _my_lounge_keys())
$$;
revoke execute on function public.my_lounges() from public, anon;
grant execute on function public.my_lounges() to authenticated;

-- a post into one of the rooms of the pool the caller is in now
create or replace function public.lounge_post(p_lounge text, p_body text) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare lg int := current_league_id(); who text; body text := btrim(coalesce(p_body, '')); nid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select coalesce(nullif(btrim(t.gm_name), ''), 'A member') into who
    from league_members m left join teams t on t.id = m.team_id where m.user_id = auth.uid() and m.league_id = lg;
  if not found then raise exception 'Join this pool first'; end if;
  if p_lounge not in (select _league_lounges(lg)) then raise exception 'This pool isn''t in that lounge'; end if;
  if body = '' then raise exception 'Write something first'; end if;
  if char_length(body) > 800 then raise exception 'Keep it under 800 characters'; end if;
  if exists (select 1 from lounge_posts where user_id = auth.uid() and at > now() - interval '5 seconds') then
    raise exception 'Easy, one at a time'; end if;
  if (select count(*) from lounge_posts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 20 then
    raise exception 'That''s a lot of posts. Take a breather and come back in a few minutes'; end if;
  insert into lounge_messages (lounge, from_league, author, body) values (p_lounge, lg, _lounge_name(who), body) returning id into nid;
  insert into lounge_posts (id, user_id) values (nid, auth.uid());
  return nid;
end $$;
revoke execute on function public.lounge_post(text, text) from public, anon;
grant execute on function public.lounge_post(text, text) to authenticated;

-- takes a post out of its room and keeps a copy
create or replace function public._lounge_take_down(p_id bigint, p_why text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into lounge_removed (id, lounge, from_league, user_id, author, body, created_at, removed_by, why)
    select x.id, x.lounge, x.from_league, p.user_id, x.author, x.body, x.created_at, auth.uid(), p_why
    from lounge_messages x left join lounge_posts p on p.id = x.id where x.id = p_id
    on conflict (id) do nothing;
  delete from lounge_messages where id = p_id;
end $$;
revoke execute on function public._lounge_take_down(bigint, text) from public, anon, authenticated;

-- the writer takes their own post down, a platform admin any
create or replace function public.lounge_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from lounge_posts where id = p_id and user_id = auth.uid()) and not is_platform_admin() then
    raise exception 'Only the one who wrote it can take it down'; end if;
  perform _lounge_take_down(p_id, case when is_platform_admin() and not exists (select 1 from lounge_posts where id = p_id and user_id = auth.uid()) then 'platform' else 'writer' end);
end $$;
revoke execute on function public.lounge_remove(bigint) from public, anon;
grant execute on function public.lounge_remove(bigint) to authenticated;

-- a member who can read the room reports a post: the first report bells the platform admins, the third takes it down
create or replace function public.lounge_report(p_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare m record; n int; a record; t record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from lounge_messages where id = p_id;
  if m.id is null then return 'gone'; end if;
  if m.lounge not in (select _my_lounge_keys()) then raise exception 'You can''t see that lounge'; end if;
  if exists (select 1 from lounge_posts where id = p_id and user_id = auth.uid()) then raise exception 'That''s your own post'; end if;
  insert into lounge_reports (message_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  select count(*) into n from lounge_reports where message_id = p_id;
  if n >= 3 then perform _lounge_take_down(p_id, 'reports'); return 'removed'; end if;
  if n = 1 then
    for a in select user_id from ops.platform_admins loop
      select tm.id, tm.league_id into t from teams tm join leagues l on l.id = tm.league_id
        where tm.user_id = a.user_id and l.status = 'active' order by l.id limit 1;
      continue when t.id is null;
      insert into notifications (league_id, team_id, kind, body, link)
      values (t.league_id, t.id, 'lounge_report', format('🚩 A post in the %s lounge was reported: "%s" (%s)',
        (select name from lounges where key = m.lounge), left(m.body, 120), m.author), '/chat?lounge=' || m.lounge);
    end loop;
  end if;
  return 'reported';
end $$;
revoke execute on function public.lounge_report(bigint) from public, anon;
grant execute on function public.lounge_report(bigint) to authenticated;
