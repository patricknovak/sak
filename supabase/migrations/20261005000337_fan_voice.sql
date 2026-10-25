-- The fans' voice (25 October 2026, Patrick: "make the new fan page and analysis an open source type project on the
-- homepage for all the different NHL teams ... start some form of crowdsourcing from the fans that helps their team and
-- that team management could see directly from the fans what they think and ideally contribute to a knowledge base of
-- information that can help their team one team or league in general").
--
-- The fan zones are open to everyone, so what fans add is shared across the platform on purpose: keyed by club (one of
-- the 32, or 'NHL' for the league as a whole), never by league (tenancy.sql lists fan_posts as shared).
-- * fan_posts: the board and the knowledge base in one. An idea (a move or a change), an ask (a question for the club),
--   an insight, a fact (the knowledge base) or a fix (something the analysis or the data got wrong), each on a topic and
--   voted up or down. The author shows as a first name and an initial; who wrote it stays in private.fan_authors.
-- * private.fan_calls: a fan's answer to a club's questions for the season (who starts in goal, the MVP so far, the one
--   to move, the biggest need, the window, how far this spring, grades for the GM and the coach, and a verdict on each
--   of the analysis's bigger questions; for the league, the Cup, the Hart, the Vezina, the Norris, the surprise and the
--   letdown). Only the totals are ever shown.
-- * fan_pulse(club): what the fans think, for anyone to read and share, management included. fan_board lists a club's
--   posts, fan_index every club's activity, fan_export a club's open data in one piece.
-- * Writing needs an account (a fan makes one from just a name through the join function, limited per connection by
--   _fan_join_check) and is limited per account. The first report on a post bells the platform admins and the third
--   takes it down (more for a post voted well up), kept in private.fan_removed; the writer or a platform admin takes a
--   post down at any time, and a platform admin marks a fact checked or a fix made, with a note (fan_moderate).
-- Safe to run twice.

-- ───────────── what a club is, and the season a day belongs to ─────────────
create or replace function public._fan_club_ok(p_club text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_club = any (array['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK',
    'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG',
    'WSH', 'NHL']), false)
$$;

-- the NHL's season id (20262027): a new season from August, on the league's own day
create or replace function public._fan_season() returns int
language sql stable set search_path = public as $$
  select case when extract(month from d) >= 8 then extract(year from d)::int * 10001 + 1
    else (extract(year from d)::int - 1) * 10001 + 1 end
  from (select today_et() d) x
$$;

-- ───────────── the tables ─────────────
create table if not exists public.fan_posts (
  id bigint generated always as identity primary key,
  club text not null check (public._fan_club_ok(club)),
  kind text not null check (kind in ('idea', 'ask', 'insight', 'fact', 'fix')),
  topic text not null,
  title text not null check (char_length(title) between 3 and 140),
  body text not null default '' check (char_length(body) <= 2000),
  source text check (source is null or (char_length(source) <= 400 and source ~* '^https?://')),
  author text not null,
  season int not null,
  ups int not null default 0,
  downs int not null default 0,
  status text not null default 'open' check (status in ('open', 'checked')),
  note text check (note is null or char_length(note) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists fan_posts_club on public.fan_posts (club, kind, id desc);
alter table public.fan_posts enable row level security;
drop policy if exists fan_posts_read on public.fan_posts;
create policy fan_posts_read on public.fan_posts for select using (true);
revoke all on public.fan_posts from anon, authenticated;
grant select on public.fan_posts to anon, authenticated;

-- a fan's name and club, when they gave one (a fan account's, or one set in the fan zone)
create table if not exists private.fan_people (
  user_id uuid primary key,
  name text not null check (char_length(name) between 2 and 40),
  club text,
  created_at timestamptz not null default now()
);
create table if not exists private.fan_authors (
  id bigint primary key references public.fan_posts(id) on delete cascade,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists fan_authors_user on private.fan_authors (user_id, at desc);
create table if not exists private.fan_votes (
  post_id bigint not null references public.fan_posts(id) on delete cascade,
  user_id uuid not null,
  value smallint not null check (value in (-1, 1)),
  at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists fan_votes_user on private.fan_votes (user_id, at desc);
create table if not exists private.fan_calls (
  club text not null,
  season int not null,
  topic text not null,
  user_id uuid not null,
  choice text not null,
  at timestamptz not null default now(),
  primary key (club, season, topic, user_id)
);
create index if not exists fan_calls_user on private.fan_calls (user_id, at desc);
create table if not exists private.fan_reports (
  post_id bigint not null,
  user_id uuid not null,
  at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists private.fan_removed (
  id bigint primary key,
  club text,
  kind text,
  topic text,
  title text,
  body text,
  source text,
  author text,
  user_id uuid,
  created_at timestamptz,
  removed_at timestamptz not null default now(),
  removed_by uuid,
  why text not null
);
create table if not exists private.fan_joins (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists fan_joins_ip_at on private.fan_joins (ip, at);

-- ───────────── what a post and a call may be ─────────────
-- the topics a post is filed under (src/lib/fanVoice.ts TOPICS; supabase/tests/fan-voice.test.mjs keeps them the same)
create or replace function public._fan_topic_ok(p_topic text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_topic = any (array['goaltending', 'defence', 'forwards', 'special-teams', 'coaching', 'roster', 'prospects',
    'history', 'analytics', 'culture', 'league', 'other']), false)
$$;

-- a fan's call and the answers each question takes (src/lib/fanVoice.ts CALLS): a player of the club where the question
-- names one (from the shared players table, so a name can't be made up), else one of a fixed few
create or replace function public._fan_call_ok(p_club text, p_topic text, p_choice text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case
    when p_club = 'NHL' then case
      when p_topic in ('cup', 'surprise', 'letdown') then p_choice <> 'NHL' and _fan_club_ok(p_choice)
      when p_topic = 'hart' then exists (select 1 from players where id::text = p_choice and pos <> 'G' and coalesce(status, '') <> 'unrostered')
      when p_topic = 'vezina' then exists (select 1 from players where id::text = p_choice and pos = 'G' and coalesce(status, '') <> 'unrostered')
      when p_topic = 'norris' then exists (select 1 from players where id::text = p_choice and pos = 'D' and coalesce(status, '') <> 'unrostered')
      else false end
    when not _fan_club_ok(p_club) then false
    when p_topic = 'goalie' then exists (select 1 from players where id::text = p_choice and nhl_team = p_club and pos = 'G')
    when p_topic in ('mvp', 'move') then exists (select 1 from players where id::text = p_choice and nhl_team = p_club)
    when p_topic = 'need' then p_choice in ('goalie', 'defence', 'scoring', 'centre', 'power-play', 'kill', 'toughness', 'depth')
    when p_topic = 'window' then p_choice in ('win-now', 'retool', 'rebuild')
    when p_topic = 'spring' then p_choice in ('miss', 'first', 'second', 'conference', 'final', 'cup')
    when p_topic in ('gm', 'coach') then p_choice in ('a', 'b', 'c', 'd', 'f')
    -- the analysis's bigger questions (src/lib/fanOffice.ts questions()): the fan's own verdict on each
    when p_topic in ('q-window', 'q-stars', 'q-crease', 'q-system', 'q-kill', 'q-special', 'q-blue', 'q-pipeline', 'q-identity')
      then p_choice in ('keep', 'adjust', 'rethink')
    else false end, false)
$$;
revoke execute on function public._fan_call_ok(text, text, text) from public, anon, authenticated;

-- what a stranger sees of the caller: a first name and an initial, from the name they gave the fan zone, their seat's
-- name, or their account's
create or replace function public._fan_who() returns text
language sql stable security definer set search_path = public, private as $$
  select case when n is null then 'A fan' else _lounge_name(n) end from (select coalesce(
    (select nullif(btrim(f.name), '') from private.fan_people f where f.user_id = auth.uid()),
    (select nullif(btrim(t.gm_name), '') from league_members m join teams t on t.id = m.team_id
      where m.user_id = auth.uid() and nullif(btrim(t.gm_name), '') is not null order by m.league_id limit 1),
    (select nullif(btrim(u.raw_user_meta_data->>'name'), '') from auth.users u where u.id = auth.uid())) n) x
$$;
revoke execute on function public._fan_who() from public, anon, authenticated;

-- ───────────── reading: open to everyone ─────────────
-- a club's posts of one kind (or every kind): what's rising ('hot', the default), the best ('top') or the newest ('new')
create or replace function public.fan_board(p_club text, p_kind text default null, p_sort text default 'hot',
  p_limit int default 30, p_offset int default 0) returns jsonb
language sql stable security definer set search_path = public, private as $$
  with me as (select auth.uid() uid, is_platform_admin() admin),
  ranked as (
    select p.*, row_number() over (order by
      case when p_sort = 'new' then p.id end desc nulls last,
      case when p_sort = 'top' then p.ups - p.downs end desc nulls last,
      case when coalesce(p_sort, 'hot') not in ('new', 'top')
        then (p.ups - p.downs + 1) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.5) end desc nulls last,
      p.id desc) n
    from fan_posts p where p.club = p_club and (p_kind is null or p.kind = p_kind))
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'club', r.club, 'kind', r.kind, 'topic', r.topic, 'title', r.title,
      'body', r.body, 'source', r.source, 'author', r.author, 'season', r.season, 'ups', r.ups, 'downs', r.downs,
      'status', r.status, 'note', r.note, 'at', r.created_at,
      'mine', (select v.value from fan_votes v where v.post_id = r.id and v.user_id = me.uid),
      'own', exists (select 1 from fan_authors a where a.id = r.id and a.user_id = me.uid),
      'reports', case when me.admin then (select count(*) from fan_reports x where x.post_id = r.id) end) order by r.n), '[]'::jsonb)
  from ranked r cross join me
  where r.n > greatest(coalesce(p_offset, 0), 0) and r.n <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function public.fan_board(text, text, text, int, int) from public;
grant execute on function public.fan_board(text, text, text, int, int) to anon, authenticated;

-- what the fans think of a club this season (or another): how many took part, every call's split, the top posts of
-- each kind, the people who added the most, and the caller's own calls
create or replace function public.fan_pulse(p_club text, p_season int default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare s int := coalesce(p_season, _fan_season()); out jsonb;
begin
  if not _fan_club_ok(p_club) then raise exception 'Pick a club'; end if;
  select jsonb_build_object(
    'club', p_club, 'season', s, 'at', now(),
    'people', (select count(distinct u) from (
        select a.user_id u from fan_authors a join fan_posts p on p.id = a.id where p.club = p_club and p.season = s
        union all select c.user_id from fan_calls c where c.club = p_club and c.season = s
        union all select v.user_id from fan_votes v join fan_posts p on p.id = v.post_id where p.club = p_club and p.season = s) x),
    'calls', coalesce((select jsonb_object_agg(t.topic, jsonb_build_object('total', t.total, 'choices', t.choices)) from (
        select c.topic, sum(c.n)::int total, jsonb_agg(jsonb_build_object('choice', c.choice, 'n', c.n, 'name', pl.name,
          'team', pl.nhl_team, 'pos', pl.pos) order by c.n desc, c.choice) choices
        from (select topic, choice, count(*)::int n from fan_calls where club = p_club and season = s group by topic, choice) c
        left join players pl on pl.id::text = c.choice
        group by c.topic) t), '{}'::jsonb),
    'counts', coalesce((select jsonb_object_agg(k.kind, k.n) from (
        select kind, count(*)::int n from fan_posts where club = p_club group by kind) k), '{}'::jsonb),
    'week', (select count(*) from fan_posts where club = p_club and created_at > now() - interval '7 days'),
    'top', coalesce((select jsonb_object_agg(t.kind, t.posts) from (
        select x.kind, jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'topic', x.topic, 'title', x.title,
          'body', left(x.body, 400), 'source', x.source, 'author', x.author, 'ups', x.ups, 'downs', x.downs,
          'status', x.status, 'note', x.note, 'at', x.created_at) order by x.r) posts
        from (select p.*, row_number() over (partition by p.kind order by p.ups - p.downs desc, p.id desc) r from fan_posts p
              where p.club = p_club and (p.kind = 'fact' or p.season = s)) x
        where x.r <= 5 group by x.kind) t), '{}'::jsonb),
    'contributors', coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'posts', c.posts, 'score', c.score)
        order by c.score desc, c.posts desc) from (
        select (array_agg(p.author order by p.id desc))[1] author, count(*)::int posts, sum(p.ups - p.downs)::int score
        from fan_posts p join fan_authors a on a.id = p.id where p.club = p_club and p.season = s
        group by a.user_id order by sum(p.ups - p.downs) desc, count(*) desc limit 10) c), '[]'::jsonb),
    'mine', case when auth.uid() is null then null else coalesce((select jsonb_object_agg(topic, choice) from fan_calls
        where club = p_club and season = s and user_id = auth.uid()), '{}'::jsonb) end
  ) into out;
  return out;
end $$;
revoke execute on function public.fan_pulse(text, int) from public;
grant execute on function public.fan_pulse(text, int) to anon, authenticated;

-- every club's activity: the fans who took part this season, the posts in all and this week, the latest, and the top
-- idea, question or insight this season
create or replace function public.fan_index() returns jsonb
language sql stable security definer set search_path = public, private as $$
  with s as (select _fan_season() season),
  people as (
    select x.club, count(distinct x.u)::int n from (
      select p.club, a.user_id u from fan_posts p join fan_authors a on a.id = p.id cross join s where p.season = s.season
      union all select c.club, c.user_id from fan_calls c cross join s where c.season = s.season) x group by x.club),
  posts as (
    select club, count(*)::int n, (count(*) filter (where created_at > now() - interval '7 days'))::int week, max(created_at) last
    from fan_posts group by club),
  tops as (
    select distinct on (p.club) p.club, jsonb_build_object('id', p.id, 'kind', p.kind, 'title', p.title, 'score', p.ups - p.downs) top
    from fan_posts p cross join s where p.kind in ('idea', 'ask', 'insight') and p.season = s.season
    order by p.club, p.ups - p.downs desc, p.id desc)
  select coalesce(jsonb_object_agg(k.club, jsonb_build_object('people', coalesce(pe.n, 0), 'posts', coalesce(po.n, 0),
    'week', coalesce(po.week, 0), 'last', po.last, 'top', t.top)), '{}'::jsonb)
  from (select club from people union select club from posts) k
  left join people pe on pe.club = k.club left join posts po on po.club = k.club left join tops t on t.club = k.club
$$;
revoke execute on function public.fan_index() from public;
grant execute on function public.fan_index() to anon, authenticated;

-- a club's open data in one piece: the pulse and every post (the newest 2,000), with no account behind any of it
create or replace function public.fan_export(p_club text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('club', p_club, 'pulse', fan_pulse(p_club) - 'mine', 'posts', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'topic', p.topic, 'title', p.title, 'body', p.body,
      'source', p.source, 'author', p.author, 'season', p.season, 'ups', p.ups, 'downs', p.downs, 'status', p.status,
      'note', p.note, 'at', p.created_at) order by p.id desc)
    from (select * from fan_posts where club = p_club order by id desc limit 2000) p), '[]'::jsonb))
$$;
revoke execute on function public.fan_export(text) from public;
grant execute on function public.fan_export(text) to anon, authenticated;

-- the caller as the fan zone knows them: the name strangers see, the name and club they gave, what they've added and
-- whether they look after the boards
create or replace function public.fan_me() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'name', _fan_who(),
    'given', (select f.name from fan_people f where f.user_id = auth.uid()),
    'club', (select f.club from fan_people f where f.user_id = auth.uid()),
    'posts', (select count(*) from fan_authors a where a.user_id = auth.uid()),
    'score', (select coalesce(sum(p.ups - p.downs), 0) from fan_authors a join fan_posts p on p.id = a.id where a.user_id = auth.uid()),
    'calls', (select count(*) from fan_calls c where c.user_id = auth.uid()),
    'admin', is_platform_admin()) end
$$;
revoke execute on function public.fan_me() from public;
grant execute on function public.fan_me() to anon, authenticated;

-- ───────────── writing: an account, within limits ─────────────
-- the name strangers see (as a first name and an initial) and the club the fan follows
create or replace function public.fan_set_me(p_name text, p_club text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(n) < 2 or char_length(n) > 40 then raise exception 'Your name, please (2 to 40 letters)'; end if;
  if p_club is not null and not _fan_club_ok(p_club) then raise exception 'Pick a club'; end if;
  insert into fan_people (user_id, name, club) values (auth.uid(), n, p_club)
    on conflict (user_id) do update set name = excluded.name, club = coalesce(excluded.club, fan_people.club);
  return fan_me();
end $$;
revoke execute on function public.fan_set_me(text, text) from public, anon;
grant execute on function public.fan_set_me(text, text) to authenticated;

-- a post on a club's board: a post every 20 seconds, 10 an hour and 30 a day at most, no more than three links
create or replace function public.fan_post(p_club text, p_kind text, p_topic text, p_title text, p_body text default '',
  p_source text default null) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare t text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')); b text := btrim(coalesce(p_body, ''));
  src text := nullif(btrim(coalesce(p_source, '')), ''); nid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to post'; end if;
  if not _fan_club_ok(p_club) then raise exception 'Pick a club'; end if;
  if p_kind is null or p_kind not in ('idea', 'ask', 'insight', 'fact', 'fix') then raise exception 'Pick what kind of post this is'; end if;
  if not _fan_topic_ok(p_topic) then raise exception 'Pick a topic'; end if;
  if char_length(t) < 3 then raise exception 'Give it a title'; end if;
  if char_length(t) > 140 then raise exception 'Keep the title under 140 characters'; end if;
  if char_length(b) > 2000 then raise exception 'Keep it under 2,000 characters'; end if;
  if src is not null and (src !~* '^https?://[^\s]+$' or char_length(src) > 400) then raise exception 'The source should be a web link'; end if;
  if (select count(*) from regexp_matches(t || ' ' || b, 'https?://', 'gi')) > 3 then raise exception 'Three links at most'; end if;
  if exists (select 1 from fan_authors where user_id = auth.uid() and at > now() - interval '20 seconds') then
    raise exception 'Easy, one at a time'; end if;
  if (select count(*) from fan_authors where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'That''s a lot of posts for one hour. Come back in a while'; end if;
  if (select count(*) from fan_authors where user_id = auth.uid() and at > now() - interval '1 day') >= 30 then
    raise exception 'That''s a lot of posts for one day. Come back tomorrow'; end if;
  if exists (select 1 from fan_authors a join fan_posts p on p.id = a.id
             where a.user_id = auth.uid() and p.club = p_club and lower(p.title) = lower(t)) then
    raise exception 'You''ve posted that one already'; end if;
  insert into fan_posts (club, kind, topic, title, body, source, author, season)
    values (p_club, p_kind, p_topic, t, b, src, _fan_who(), _fan_season()) returning id into nid;
  insert into fan_authors (id, user_id) values (nid, auth.uid());
  return nid;
end $$;
revoke execute on function public.fan_post(text, text, text, text, text, text) from public, anon;
grant execute on function public.fan_post(text, text, text, text, text, text) to authenticated;

-- a vote up (1), down (-1) or back to none (0) on someone else's post; the counts are worked out again from the votes,
-- so two taps at once can't count twice
create or replace function public.fan_vote(p_post bigint, p_value int) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v smallint := sign(coalesce(p_value, 0))::smallint; r record;
begin
  if auth.uid() is null then raise exception 'Sign in to vote'; end if;
  if not exists (select 1 from fan_posts where id = p_post) then raise exception 'That post is gone'; end if;
  if exists (select 1 from fan_authors where id = p_post and user_id = auth.uid()) then raise exception 'That''s your own post'; end if;
  if v <> 0 and (select count(*) from fan_votes where user_id = auth.uid() and at > now() - interval '1 hour') >= 300 then
    raise exception 'That''s a lot of votes for one hour. Come back in a while'; end if;
  if v = 0 then
    delete from fan_votes where post_id = p_post and user_id = auth.uid();
  else
    insert into fan_votes (post_id, user_id, value) values (p_post, auth.uid(), v)
      on conflict (post_id, user_id) do update set value = excluded.value, at = now();
  end if;
  update fan_posts set ups = (select count(*) from fan_votes where post_id = p_post and value = 1),
                       downs = (select count(*) from fan_votes where post_id = p_post and value = -1)
    where id = p_post returning ups, downs into r;
  return jsonb_build_object('id', p_post, 'ups', r.ups, 'downs', r.downs, 'mine', nullif(v, 0));
end $$;
revoke execute on function public.fan_vote(bigint, int) from public, anon;
grant execute on function public.fan_vote(bigint, int) to authenticated;

-- a fan's call on one of a club's questions this season (an empty choice takes it back), and the question's split now
create or replace function public.fan_call(p_club text, p_topic text, p_choice text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c text := nullif(btrim(coalesce(p_choice, '')), ''); s int := _fan_season();
begin
  if auth.uid() is null then raise exception 'Sign in to make your call'; end if;
  if not _fan_club_ok(p_club) then raise exception 'Pick a club'; end if;
  if c is null then
    delete from fan_calls where club = p_club and season = s and topic = p_topic and user_id = auth.uid();
  else
    if not _fan_call_ok(p_club, p_topic, c) then raise exception 'That isn''t one of the answers'; end if;
    if (select count(*) from fan_calls where user_id = auth.uid() and at > now() - interval '1 hour') >= 120 then
      raise exception 'That''s a lot of calls for one hour. Come back in a while'; end if;
    insert into fan_calls (club, season, topic, user_id, choice) values (p_club, s, p_topic, auth.uid(), c)
      on conflict (club, season, topic, user_id) do update set choice = excluded.choice, at = now();
  end if;
  return (select jsonb_build_object('topic', p_topic, 'mine', c, 'total', coalesce(sum(x.n), 0),
      'choices', coalesce(jsonb_agg(jsonb_build_object('choice', x.choice, 'n', x.n, 'name', pl.name, 'team', pl.nhl_team, 'pos', pl.pos)
        order by x.n desc, x.choice), '[]'::jsonb))
    from (select choice, count(*)::int n from fan_calls where club = p_club and season = s and topic = p_topic group by choice) x
    left join players pl on pl.id::text = x.choice);
end $$;
revoke execute on function public.fan_call(text, text, text) from public, anon;
grant execute on function public.fan_call(text, text, text) to authenticated;

-- ───────────── keeping the boards clean ─────────────
-- takes a post off its board and keeps a copy
create or replace function public._fan_take_down(p_post bigint, p_why text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into fan_removed (id, club, kind, topic, title, body, source, author, user_id, created_at, removed_by, why)
    select p.id, p.club, p.kind, p.topic, p.title, p.body, p.source, p.author, a.user_id, p.created_at, auth.uid(), p_why
    from fan_posts p left join fan_authors a on a.id = p.id where p.id = p_post
    on conflict (id) do nothing;
  delete from fan_posts where id = p_post;
end $$;
revoke execute on function public._fan_take_down(bigint, text) from public, anon, authenticated;

-- the writer takes their own post down, a platform admin any
create or replace function public.fan_remove(p_post bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare own boolean := exists (select 1 from fan_authors where id = p_post and user_id = auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not own and not is_platform_admin() then raise exception 'Only the one who wrote it can take it down'; end if;
  perform _fan_take_down(p_post, case when own then 'writer' else 'platform' end);
end $$;
revoke execute on function public.fan_remove(bigint) from public, anon;
grant execute on function public.fan_remove(bigint) to authenticated;

-- a fan reports a post: the first report bells the platform admins, the third takes it down. A post the fans have
-- voted well up takes more (half its net votes), so a few new accounts can't silence one the board stands behind.
create or replace function public.fan_report(p_post bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare m record; n int; a record; t record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from fan_posts where id = p_post;
  if m.id is null then return 'gone'; end if;
  if exists (select 1 from fan_authors where id = p_post and user_id = auth.uid()) then raise exception 'That''s your own post'; end if;
  insert into fan_reports (post_id, user_id) values (p_post, auth.uid()) on conflict do nothing;
  select count(*) into n from fan_reports where post_id = p_post;
  if n >= greatest(3, (m.ups - m.downs) / 2) then perform _fan_take_down(p_post, 'reports'); return 'removed'; end if;
  if n = 1 then
    for a in select user_id from ops.platform_admins loop
      select tm.id, tm.league_id into t from teams tm join leagues l on l.id = tm.league_id
        where tm.user_id = a.user_id and l.status = 'active' order by l.id limit 1;
      continue when t.id is null;
      insert into notifications (league_id, team_id, kind, body, link)
      values (t.league_id, t.id, 'fan_report', format('🚩 A post on the %s fan board was reported: "%s" (%s)',
        m.club, left(m.title, 120), m.author), '/fans/' || m.club || '?post=' || m.id);
    end loop;
  end if;
  return 'reported';
end $$;
revoke execute on function public.fan_report(bigint) from public, anon;
grant execute on function public.fan_report(bigint) to authenticated;

-- a platform admin marks a fact checked or a fix made (or back to open), with a note the board shows
create or replace function public.fan_moderate(p_post bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform''s admins look after the boards'; end if;
  if p_status not in ('open', 'checked') then raise exception 'Open or checked'; end if;
  update fan_posts set status = p_status, note = nullif(btrim(left(coalesce(p_note, ''), 400)), '') where id = p_post;
  if not found then raise exception 'That post is gone'; end if;
end $$;
revoke execute on function public.fan_moderate(bigint, text, text) from public, anon;
grant execute on function public.fan_moderate(bigint, text, text) to authenticated;

-- ───────────── a fan's account (the join function, service role only) ─────────────
-- null when a name-only fan account may be made (and counts it), else the reason in the fan's words: five a day from
-- one connection and a thousand a day in all, apart from the pools' own guest seats
create or replace function public._fan_join_check(p_ip text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  delete from private.fan_joins where at < now() - interval '2 days';
  if coalesce(p_ip, '') <> '' and (select count(*) from private.fan_joins where ip = p_ip and at > now() - interval '1 day') >= 5 then
    return 'Too many new fans from this connection today. Sign in with an email instead.';
  end if;
  if (select count(*) from private.fan_joins where at > now() - interval '1 day') >= 1000 then
    return 'Joining with just a name is busy right now. Sign in with an email instead.';
  end if;
  insert into private.fan_joins (ip) values (coalesce(p_ip, ''));
  return null;
end $$;
revoke execute on function public._fan_join_check(text) from public, anon, authenticated;
grant execute on function public._fan_join_check(text) to service_role;

-- the name and club a new fan account was made with
create or replace function public._fan_person(p_user uuid, p_name text, p_club text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.fan_people (user_id, name, club)
    values (p_user, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), case when _fan_club_ok(p_club) then p_club end)
    on conflict (user_id) do update set name = excluded.name, club = coalesce(excluded.club, fan_people.club);
end $$;
revoke execute on function public._fan_person(uuid, text, text) from public, anon, authenticated;
grant execute on function public._fan_person(uuid, text, text) to service_role;
