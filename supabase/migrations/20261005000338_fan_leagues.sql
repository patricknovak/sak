-- The fan zones for more leagues (25 October 2026, Patrick: "I would like to include Premier League, NFL and NBA with
-- the possibility of adding other leagues"). The fans' voice (migration 337) was the NHL's alone, keyed by its club codes;
-- it now belongs to a league:
-- * fan_leagues: the leagues with a fan zone, each with its sport (which decides the calls, the topics and the
--   analysis: hockey, football, basketball, soccer), its ESPN feed, and the month its season starts. Adding a league of a
--   sport already here (MLS, the WNBA, La Liga) is a row here; its clubs follow on their own.
-- * fan_clubs: each league's clubs (the NHL's 32 by the NHL's own codes; the rest by ESPN's), seeded from the clubs the
--   pools engine already plays, kept up to date (names, colours, logos, conference, division) by nhl-hub's fan-sport-league
--   task with the service key.
-- * fan_athletes: the ESPN leagues' players (rosters and leaders, synced the same way), so a call can only name a real
--   player of the club and the pulse can name him. The NHL's are the players table, as before.
-- * fan_posts, private.fan_calls and private.fan_people carry their league ('nhl' for everything already there); a
--   league's own board is club = its key in capitals (NHL, NFL, NBA, EPL), as the NHL's was.
-- * Every fan function takes p_league as its last argument, 'nhl' when it isn't given, so a copy of the site from before
--   this keeps working for the NHL. p_league here is a sports league's key, never a Super Pools league's id (tenancy.sql
--   lists the functions). Calls and topics are checked per sport (src/lib/fanLists.ts, kept equal by
--   supabase/tests/fan-voice.test.mjs).
-- * fan_leagues_index(): every league's activity for the fan zones' front page.
-- Safe to run twice.

-- ───────────── the leagues ─────────────
create table if not exists public.fan_leagues (
  key text primary key check (key ~ '^[a-z][a-z0-9-]{1,11}$'),
  name text not null,
  sport text not null check (sport in ('hockey', 'football', 'basketball', 'soccer')),
  espn text check (espn is null or espn ~ '^[a-z]+/[a-z0-9.-]+$'),
  season_start int not null default 8 check (season_start between 1 and 12),
  sort int not null default 100,
  active boolean not null default true
);
alter table public.fan_leagues enable row level security;
drop policy if exists fan_leagues_read on public.fan_leagues;
create policy fan_leagues_read on public.fan_leagues for select using (true);
revoke all on public.fan_leagues from anon, authenticated;
grant select on public.fan_leagues to anon, authenticated;
insert into public.fan_leagues (key, name, sport, espn, season_start, sort) values
  ('nhl', 'NHL', 'hockey', 'hockey/nhl', 8, 10),
  ('nfl', 'NFL', 'football', 'football/nfl', 8, 20),
  ('nba', 'NBA', 'basketball', 'basketball/nba', 8, 30),
  ('epl', 'Premier League', 'soccer', 'soccer/eng.1', 7, 40)
on conflict (key) do update set name = excluded.name, sport = excluded.sport, espn = excluded.espn,
  season_start = excluded.season_start, sort = excluded.sort;

-- ───────────── the clubs ─────────────
create table if not exists public.fan_clubs (
  league text not null references public.fan_leagues(key),
  code text not null check (code ~ '^[A-Z0-9]{2,5}$'),
  name text not null,
  short text,
  logo text check (logo is null or logo ~* '^https://'),
  color text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  alt_color text check (alt_color is null or alt_color ~ '^#[0-9a-f]{6}$'),
  espn_id text,
  conference text,
  division text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (league, code)
);
alter table public.fan_clubs enable row level security;
drop policy if exists fan_clubs_read on public.fan_clubs;
create policy fan_clubs_read on public.fan_clubs for select using (true);
revoke all on public.fan_clubs from anon, authenticated;
grant select on public.fan_clubs to anon, authenticated;

-- the NHL's 32, by the NHL's own codes (the ones its posts already carry)
insert into public.fan_clubs (league, code, name) values
  ('nhl', 'ANA', 'Anaheim Ducks'), ('nhl', 'BOS', 'Boston Bruins'), ('nhl', 'BUF', 'Buffalo Sabres'),
  ('nhl', 'CAR', 'Carolina Hurricanes'), ('nhl', 'CBJ', 'Columbus Blue Jackets'), ('nhl', 'CGY', 'Calgary Flames'),
  ('nhl', 'CHI', 'Chicago Blackhawks'), ('nhl', 'COL', 'Colorado Avalanche'), ('nhl', 'DAL', 'Dallas Stars'),
  ('nhl', 'DET', 'Detroit Red Wings'), ('nhl', 'EDM', 'Edmonton Oilers'), ('nhl', 'FLA', 'Florida Panthers'),
  ('nhl', 'LAK', 'Los Angeles Kings'), ('nhl', 'MIN', 'Minnesota Wild'), ('nhl', 'MTL', 'Montréal Canadiens'),
  ('nhl', 'NJD', 'New Jersey Devils'), ('nhl', 'NSH', 'Nashville Predators'), ('nhl', 'NYI', 'New York Islanders'),
  ('nhl', 'NYR', 'New York Rangers'), ('nhl', 'OTT', 'Ottawa Senators'), ('nhl', 'PHI', 'Philadelphia Flyers'),
  ('nhl', 'PIT', 'Pittsburgh Penguins'), ('nhl', 'SEA', 'Seattle Kraken'), ('nhl', 'SJS', 'San Jose Sharks'),
  ('nhl', 'STL', 'St. Louis Blues'), ('nhl', 'TBL', 'Tampa Bay Lightning'), ('nhl', 'TOR', 'Toronto Maple Leafs'),
  ('nhl', 'UTA', 'Utah Mammoth'), ('nhl', 'VAN', 'Vancouver Canucks'), ('nhl', 'VGK', 'Vegas Golden Knights'),
  ('nhl', 'WPG', 'Winnipeg Jets'), ('nhl', 'WSH', 'Washington Capitals')
on conflict (league, code) do nothing;

-- the season's competition a league's games come from (the pools engine's): its latest season of weekly or nightly games
create or replace function public._fan_competition(p_league text) returns text
language sql stable set search_path = public as $$
  select c.id from competitions c where c.lounge = p_league and c.format = 'rounds' order by c.season desc, c.id limit 1
$$;

-- every other league's clubs, from the clubs its season's games are played by (ESPN's codes)
insert into public.fan_clubs (league, code, name, short, logo, espn_id)
select distinct on (l.key, c.short) l.key, c.short, c.name, c.short, case when c.logo ~* '^https://' then c.logo end, c.ext_id
from public.fan_leagues l
join public.fixtures f on f.competition = public._fan_competition(l.key)
join public.clubs c on c.id in (f.home_club, f.away_club)
where l.key <> 'nhl' and c.short ~ '^[A-Z0-9]{2,5}$'
on conflict (league, code) do nothing;

-- ───────────── the players of the ESPN leagues ─────────────
create table if not exists public.fan_athletes (
  league text not null references public.fan_leagues(key),
  id text not null check (id ~ '^[0-9]{1,12}$'),
  name text not null,
  club text,
  pos text,
  updated_at timestamptz not null default now(),
  primary key (league, id)
);
create index if not exists fan_athletes_club on public.fan_athletes (league, club);
alter table public.fan_athletes enable row level security;
drop policy if exists fan_athletes_read on public.fan_athletes;
create policy fan_athletes_read on public.fan_athletes for select using (true);
revoke all on public.fan_athletes from anon, authenticated;
grant select on public.fan_athletes to anon, authenticated;

-- ───────────── every post, call and fan has a league ─────────────
alter table public.fan_posts add column if not exists league text not null default 'nhl';
alter table public.fan_posts drop constraint if exists fan_posts_club_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fan_posts_league_fkey') then
    alter table public.fan_posts add constraint fan_posts_league_fkey foreign key (league) references public.fan_leagues(key);
  end if;
end $$;
create index if not exists fan_posts_league_club on public.fan_posts (league, club, kind, id desc);
drop index if exists public.fan_posts_club;

alter table private.fan_calls add column if not exists league text not null default 'nhl';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'private.fan_calls'::regclass and contype = 'p'
                 and pg_get_constraintdef(oid) like '%league%') then
    alter table private.fan_calls drop constraint if exists fan_calls_pkey;
    alter table private.fan_calls add primary key (league, club, season, topic, user_id);
  end if;
end $$;
alter table private.fan_people add column if not exists league text;
alter table private.fan_removed add column if not exists league text;

-- ───────────── what a league, a club, a topic and a call may be ─────────────
-- a league's sport, while it has a fan zone (null for one that doesn't)
create or replace function public._fan_sport(p_league text) returns text
language sql stable security definer set search_path = public as $$
  select sport from fan_leagues where key = p_league and active
$$;
revoke execute on function public._fan_sport(text) from public, anon, authenticated;

-- one of the league's clubs, or the league's own board (its key in capitals)
create or replace function public._fan_club_ok(p_league text, p_club text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(_fan_sport(p_league) is not null and (p_club = upper(p_league)
    or exists (select 1 from fan_clubs c where c.league = p_league and c.code = p_club and c.active)), false)
$$;
revoke execute on function public._fan_club_ok(text, text) from public, anon, authenticated;

-- the season a day belongs to in a league (the NHL's id, 20262027, for every league: a new season from its start month)
create or replace function public._fan_season(p_league text) returns int
language sql stable security definer set search_path = public as $$
  select case when extract(month from d) >= m then extract(year from d)::int * 10001 + 1
    else (extract(year from d)::int - 1) * 10001 + 1 end
  from (select today_et() d, coalesce((select season_start from fan_leagues where key = p_league), 8) m) x
$$;
revoke execute on function public._fan_season(text) from public, anon, authenticated;

-- the topics a post is filed under, the sport's own and the ones every sport shares (src/lib/fanLists.ts TOPICS_BY_SPORT)
create or replace function public._fan_topic_ok(p_league text, p_topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case _fan_sport(p_league)
    when 'hockey' then p_topic = any (array['goaltending', 'defence', 'forwards', 'special-teams', 'coaching', 'roster', 'prospects',
      'history', 'analytics', 'culture', 'league', 'other'])
    when 'football' then p_topic = any (array['quarterback', 'offence', 'defence', 'special-teams', 'coaching', 'roster', 'draft',
      'history', 'analytics', 'culture', 'league', 'other'])
    when 'basketball' then p_topic = any (array['guards', 'wings', 'bigs', 'offence', 'defence', 'coaching', 'roster', 'draft',
      'history', 'analytics', 'culture', 'league', 'other'])
    when 'soccer' then p_topic = any (array['goalkeeping', 'defence', 'midfield', 'attack', 'set-pieces', 'manager', 'transfers',
      'academy', 'history', 'analytics', 'culture', 'league', 'other'])
    else false end, false)
$$;
revoke execute on function public._fan_topic_ok(text, text) from public, anon, authenticated;

-- a fan's call and the answers each question takes, by sport (src/lib/fanLists.ts CALLS_BY_SPORT): a player of the club
-- where the question names one (the NHL's from players, the rest from fan_athletes, so a name can't be made up), a club
-- of the league, or one of a fixed few
create or replace function public._fan_call_ok(p_league text, p_club text, p_topic text, p_choice text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := _fan_sport(p_league); whole boolean := p_club = upper(p_league);
  -- a player of the club (or of the league, on its own board)
  is_athlete boolean := exists (select 1 from fan_athletes a where a.league = p_league and a.id = p_choice and (whole or a.club = p_club));
  -- one of the league's clubs
  is_club boolean := p_choice <> upper(p_league) and exists (select 1 from fan_clubs c where c.league = p_league and c.code = p_choice and c.active);
begin
  if s is null or not _fan_club_ok(p_league, p_club) or p_choice is null then return false; end if;
  -- the analysis's bigger questions, in every sport: the fan's own verdict on each
  if p_topic in ('q-window', 'q-stars', 'q-crease', 'q-system', 'q-kill', 'q-special', 'q-blue', 'q-pipeline', 'q-identity',
                 'q-attack', 'q-defence', 'q-record', 'q-ahead', 'q-discipline', 'q-depth') then
    return p_choice in ('keep', 'adjust', 'rethink');
  end if;
  if whole then
    return case
      when p_topic in ('cup', 'surprise', 'letdown') then is_club
      when s = 'hockey' and p_topic = 'hart' then exists (select 1 from players where id::text = p_choice and pos <> 'G' and coalesce(status, '') <> 'unrostered')
      when s = 'hockey' and p_topic = 'vezina' then exists (select 1 from players where id::text = p_choice and pos = 'G' and coalesce(status, '') <> 'unrostered')
      when s = 'hockey' and p_topic = 'norris' then exists (select 1 from players where id::text = p_choice and pos = 'D' and coalesce(status, '') <> 'unrostered')
      when s in ('football', 'basketball') and p_topic in ('mvp', 'dpoy') then is_athlete
      when s = 'soccer' and p_topic in ('scorer', 'poty') then is_athlete
      when s = 'soccer' and p_topic = 'down' then is_club
      else false end;
  end if;
  return case
    -- the NHL's players are the players table's
    when s = 'hockey' and p_topic = 'goalie' then exists (select 1 from players where id::text = p_choice and nhl_team = p_club and pos = 'G')
    when s = 'hockey' and p_topic in ('mvp', 'move') then exists (select 1 from players where id::text = p_choice and nhl_team = p_club)
    when s <> 'hockey' and p_topic in ('mvp', 'move') then is_athlete
    when s = 'football' and p_topic = 'qb' then is_athlete and exists (select 1 from fan_athletes a where a.league = p_league and a.id = p_choice and a.pos = 'QB')
    when s = 'soccer' and p_topic = 'goalie' then is_athlete and exists (select 1 from fan_athletes a where a.league = p_league and a.id = p_choice and a.pos in ('G', 'GK'))
    when s = 'hockey' and p_topic = 'need' then p_choice in ('goalie', 'defence', 'scoring', 'centre', 'power-play', 'kill', 'toughness', 'depth')
    when s = 'football' and p_topic = 'need' then p_choice in ('quarterback', 'offensive-line', 'pass-rush', 'secondary', 'receivers', 'running-back', 'linebackers', 'depth')
    when s = 'basketball' and p_topic = 'need' then p_choice in ('star', 'shooting', 'rim-protection', 'playmaking', 'defence', 'rebounding', 'bench', 'health')
    when s = 'soccer' and p_topic = 'need' then p_choice in ('goalkeeper', 'centre-back', 'full-back', 'midfield', 'winger', 'striker', 'depth', 'manager')
    when p_topic = 'window' then p_choice in ('win-now', 'retool', 'rebuild')
    when s = 'hockey' and p_topic = 'spring' then p_choice in ('miss', 'first', 'second', 'conference', 'final', 'cup')
    when s = 'football' and p_topic = 'spring' then p_choice in ('miss', 'first', 'second', 'conference', 'final', 'cup')
    when s = 'basketball' and p_topic = 'spring' then p_choice in ('miss', 'play-in', 'first', 'second', 'conference', 'final', 'cup')
    when s = 'soccer' and p_topic = 'finish' then p_choice in ('title', 'top-four', 'europe', 'mid-table', 'relegation-fight', 'relegated')
    when p_topic in ('gm', 'coach') then p_choice in ('a', 'b', 'c', 'd', 'f')
    else false end;
end $$;
revoke execute on function public._fan_call_ok(text, text, text, text) from public, anon, authenticated;

-- ───────────── the functions, each with its league ─────────────
drop function if exists public.fan_board(text, text, text, int, int);
drop function if exists public.fan_pulse(text, int);
drop function if exists public.fan_index();
drop function if exists public.fan_export(text);
drop function if exists public.fan_set_me(text, text);
drop function if exists public.fan_post(text, text, text, text, text, text);
drop function if exists public.fan_call(text, text, text);
drop function if exists public._fan_person(uuid, text, text);
drop function if exists public._fan_call_ok(text, text, text);
drop function if exists public._fan_topic_ok(text);

-- a club's posts of one kind (or every kind): what's rising ('hot', the default), the best ('top') or the newest ('new')
create or replace function public.fan_board(p_club text, p_kind text default null, p_sort text default 'hot',
  p_limit int default 30, p_offset int default 0, p_league text default 'nhl') returns jsonb
language sql stable security definer set search_path = public, private as $$
  with me as (select auth.uid() uid, is_platform_admin() admin),
  ranked as (
    select p.*, row_number() over (order by
      case when p_sort = 'new' then p.id end desc nulls last,
      case when p_sort = 'top' then p.ups - p.downs end desc nulls last,
      case when coalesce(p_sort, 'hot') not in ('new', 'top')
        then (p.ups - p.downs + 1) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.5) end desc nulls last,
      p.id desc) n
    from fan_posts p where p.league = p_league and p.club = p_club and (p_kind is null or p.kind = p_kind))
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'league', r.league, 'club', r.club, 'kind', r.kind, 'topic', r.topic,
      'title', r.title, 'body', r.body, 'source', r.source, 'author', r.author, 'season', r.season, 'ups', r.ups, 'downs', r.downs,
      'status', r.status, 'note', r.note, 'at', r.created_at,
      'mine', (select v.value from fan_votes v where v.post_id = r.id and v.user_id = me.uid),
      'own', exists (select 1 from fan_authors a where a.id = r.id and a.user_id = me.uid),
      'reports', case when me.admin then (select count(*) from fan_reports x where x.post_id = r.id) end) order by r.n), '[]'::jsonb)
  from ranked r cross join me
  where r.n > greatest(coalesce(p_offset, 0), 0) and r.n <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function public.fan_board(text, text, text, int, int, text) from public;
grant execute on function public.fan_board(text, text, text, int, int, text) to anon, authenticated;

-- what the fans think of a club (or a league, on its own board) this season or another: how many took part, every
-- call's split with the players and clubs named, the top posts of each kind, who added the most, the caller's own calls
create or replace function public.fan_pulse(p_club text, p_season int default null, p_league text default 'nhl') returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare s int := coalesce(p_season, _fan_season(p_league)); out jsonb;
begin
  if not _fan_club_ok(p_league, p_club) then raise exception 'Pick a club'; end if;
  select jsonb_build_object(
    'league', p_league, 'club', p_club, 'season', s, 'at', now(),
    'people', (select count(distinct u) from (
        select a.user_id u from fan_authors a join fan_posts p on p.id = a.id where p.league = p_league and p.club = p_club and p.season = s
        union all select c.user_id from fan_calls c where c.league = p_league and c.club = p_club and c.season = s
        union all select v.user_id from fan_votes v join fan_posts p on p.id = v.post_id
          where p.league = p_league and p.club = p_club and p.season = s) x),
    'calls', coalesce((select jsonb_object_agg(t.topic, jsonb_build_object('total', t.total, 'choices', t.choices)) from (
        select c.topic, sum(c.n)::int total, jsonb_agg(jsonb_build_object('choice', c.choice, 'n', c.n,
          'name', coalesce(pl.name, fa.name, fc.name), 'team', coalesce(pl.nhl_team, fa.club), 'pos', coalesce(pl.pos, fa.pos)) order by c.n desc, c.choice) choices
        from (select topic, choice, count(*)::int n from fan_calls where league = p_league and club = p_club and season = s group by topic, choice) c
        left join players pl on p_league = 'nhl' and pl.id::text = c.choice
        left join fan_athletes fa on p_league <> 'nhl' and fa.league = p_league and fa.id = c.choice
        left join fan_clubs fc on fc.league = p_league and fc.code = c.choice
        group by c.topic) t), '{}'::jsonb),
    'counts', coalesce((select jsonb_object_agg(k.kind, k.n) from (
        select kind, count(*)::int n from fan_posts where league = p_league and club = p_club group by kind) k), '{}'::jsonb),
    'week', (select count(*) from fan_posts where league = p_league and club = p_club and created_at > now() - interval '7 days'),
    'top', coalesce((select jsonb_object_agg(t.kind, t.posts) from (
        select x.kind, jsonb_agg(jsonb_build_object('id', x.id, 'league', x.league, 'club', x.club, 'kind', x.kind, 'topic', x.topic,
          'title', x.title, 'body', left(x.body, 400), 'source', x.source, 'author', x.author, 'ups', x.ups, 'downs', x.downs,
          'status', x.status, 'note', x.note, 'at', x.created_at) order by x.r) posts
        from (select p.*, row_number() over (partition by p.kind order by p.ups - p.downs desc, p.id desc) r from fan_posts p
              where p.league = p_league and p.club = p_club and (p.kind = 'fact' or p.season = s)) x
        where x.r <= 5 group by x.kind) t), '{}'::jsonb),
    'contributors', coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'posts', c.posts, 'score', c.score)
        order by c.score desc, c.posts desc) from (
        select (array_agg(p.author order by p.id desc))[1] author, count(*)::int posts, sum(p.ups - p.downs)::int score
        from fan_posts p join fan_authors a on a.id = p.id where p.league = p_league and p.club = p_club and p.season = s
        group by a.user_id order by sum(p.ups - p.downs) desc, count(*) desc limit 10) c), '[]'::jsonb),
    'mine', case when auth.uid() is null then null else coalesce((select jsonb_object_agg(topic, choice) from fan_calls
        where league = p_league and club = p_club and season = s and user_id = auth.uid()), '{}'::jsonb) end
  ) into out;
  return out;
end $$;
revoke execute on function public.fan_pulse(text, int, text) from public;
grant execute on function public.fan_pulse(text, int, text) to anon, authenticated;

-- a league's clubs and their activity: the fans who took part this season, the posts in all and this week, the latest,
-- and the top idea, question or insight this season
create or replace function public.fan_index(p_league text default 'nhl') returns jsonb
language sql stable security definer set search_path = public, private as $$
  with s as (select _fan_season(p_league) season),
  people as (
    select x.club, count(distinct x.u)::int n from (
      select p.club, a.user_id u from fan_posts p join fan_authors a on a.id = p.id cross join s where p.league = p_league and p.season = s.season
      union all select c.club, c.user_id from fan_calls c cross join s where c.league = p_league and c.season = s.season) x group by x.club),
  posts as (
    select club, count(*)::int n, (count(*) filter (where created_at > now() - interval '7 days'))::int week, max(created_at) last
    from fan_posts where league = p_league group by club),
  tops as (
    select distinct on (p.club) p.club, jsonb_build_object('id', p.id, 'kind', p.kind, 'title', p.title, 'score', p.ups - p.downs) top
    from fan_posts p cross join s where p.league = p_league and p.kind in ('idea', 'ask', 'insight') and p.season = s.season
    order by p.club, p.ups - p.downs desc, p.id desc)
  select coalesce(jsonb_object_agg(k.club, jsonb_build_object('people', coalesce(pe.n, 0), 'posts', coalesce(po.n, 0),
    'week', coalesce(po.week, 0), 'last', po.last, 'top', t.top)), '{}'::jsonb)
  from (select club from people union select club from posts) k
  left join people pe on pe.club = k.club left join posts po on po.club = k.club left join tops t on t.club = k.club
$$;
revoke execute on function public.fan_index(text) from public;
grant execute on function public.fan_index(text) to anon, authenticated;

-- every league's activity, for the fan zones' front page
create or replace function public.fan_leagues_index() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_object_agg(l.key, jsonb_build_object(
    'people', (select count(distinct u) from (
        select a.user_id u from fan_posts p join fan_authors a on a.id = p.id where p.league = l.key and p.season = _fan_season(l.key)
        union all select c.user_id from fan_calls c where c.league = l.key and c.season = _fan_season(l.key)) x),
    'posts', (select count(*) from fan_posts p where p.league = l.key),
    'week', (select count(*) from fan_posts p where p.league = l.key and p.created_at > now() - interval '7 days'),
    'clubs', (select count(*) from fan_clubs c where c.league = l.key and c.active))), '{}'::jsonb)
  from fan_leagues l where l.active
$$;
revoke execute on function public.fan_leagues_index() from public;
grant execute on function public.fan_leagues_index() to anon, authenticated;

-- a club's open data in one piece: the pulse and every post (the newest 2,000), with no account behind any of it
create or replace function public.fan_export(p_club text, p_league text default 'nhl') returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('league', p_league, 'club', p_club, 'pulse', fan_pulse(p_club, null, p_league) - 'mine', 'posts', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'topic', p.topic, 'title', p.title, 'body', p.body,
      'source', p.source, 'author', p.author, 'season', p.season, 'ups', p.ups, 'downs', p.downs, 'status', p.status,
      'note', p.note, 'at', p.created_at) order by p.id desc)
    from (select * from fan_posts where league = p_league and club = p_club order by id desc limit 2000) p), '[]'::jsonb))
$$;
revoke execute on function public.fan_export(text, text) from public;
grant execute on function public.fan_export(text, text) to anon, authenticated;

-- the caller as the fan zones know them: the name strangers see, the name and club they gave, what they've added and
-- whether they look after the boards
create or replace function public.fan_me() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'name', _fan_who(),
    'given', (select f.name from fan_people f where f.user_id = auth.uid()),
    'club', (select f.club from fan_people f where f.user_id = auth.uid()),
    'league', (select coalesce(f.league, case when f.club is not null then 'nhl' end) from fan_people f where f.user_id = auth.uid()),
    'posts', (select count(*) from fan_authors a where a.user_id = auth.uid()),
    'score', (select coalesce(sum(p.ups - p.downs), 0) from fan_authors a join fan_posts p on p.id = a.id where a.user_id = auth.uid()),
    'calls', (select count(*) from fan_calls c where c.user_id = auth.uid()),
    'admin', is_platform_admin()) end
$$;
revoke execute on function public.fan_me() from public;
grant execute on function public.fan_me() to anon, authenticated;

-- the name strangers see (as a first name and an initial) and the club the fan follows
create or replace function public.fan_set_me(p_name text, p_club text default null, p_league text default 'nhl') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(n) < 2 or char_length(n) > 40 then raise exception 'Your name, please (2 to 40 letters)'; end if;
  if p_club is not null and not _fan_club_ok(p_league, p_club) then raise exception 'Pick a club'; end if;
  insert into fan_people (user_id, name, club, league) values (auth.uid(), n, p_club, case when p_club is not null then p_league end)
    on conflict (user_id) do update set name = excluded.name, club = coalesce(excluded.club, fan_people.club),
      league = case when excluded.club is not null then excluded.league else fan_people.league end;
  return fan_me();
end $$;
revoke execute on function public.fan_set_me(text, text, text) from public, anon;
grant execute on function public.fan_set_me(text, text, text) to authenticated;

-- a post on a club's board: a post every 20 seconds, 10 an hour and 30 a day at most, no more than three links
create or replace function public.fan_post(p_club text, p_kind text, p_topic text, p_title text, p_body text default '',
  p_source text default null, p_league text default 'nhl') returns bigint
language plpgsql security definer set search_path = public, private as $$
declare t text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')); b text := btrim(coalesce(p_body, ''));
  src text := nullif(btrim(coalesce(p_source, '')), ''); nid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to post'; end if;
  if not _fan_club_ok(p_league, p_club) then raise exception 'Pick a club'; end if;
  if p_kind is null or p_kind not in ('idea', 'ask', 'insight', 'fact', 'fix') then raise exception 'Pick what kind of post this is'; end if;
  if not _fan_topic_ok(p_league, p_topic) then raise exception 'Pick a topic'; end if;
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
             where a.user_id = auth.uid() and p.league = p_league and p.club = p_club and lower(p.title) = lower(t)) then
    raise exception 'You''ve posted that one already'; end if;
  insert into fan_posts (league, club, kind, topic, title, body, source, author, season)
    values (p_league, p_club, p_kind, p_topic, t, b, src, _fan_who(), _fan_season(p_league)) returning id into nid;
  insert into fan_authors (id, user_id) values (nid, auth.uid());
  return nid;
end $$;
revoke execute on function public.fan_post(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.fan_post(text, text, text, text, text, text, text) to authenticated;

-- a fan's call on one of a club's questions this season (an empty choice takes it back), and the question's split now
create or replace function public.fan_call(p_club text, p_topic text, p_choice text, p_league text default 'nhl') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c text := nullif(btrim(coalesce(p_choice, '')), ''); s int := _fan_season(p_league);
begin
  if auth.uid() is null then raise exception 'Sign in to make your call'; end if;
  if not _fan_club_ok(p_league, p_club) then raise exception 'Pick a club'; end if;
  if c is null then
    delete from fan_calls where league = p_league and club = p_club and season = s and topic = p_topic and user_id = auth.uid();
  else
    if not _fan_call_ok(p_league, p_club, p_topic, c) then raise exception 'That isn''t one of the answers'; end if;
    if (select count(*) from fan_calls where user_id = auth.uid() and at > now() - interval '1 hour') >= 120 then
      raise exception 'That''s a lot of calls for one hour. Come back in a while'; end if;
    insert into fan_calls (league, club, season, topic, user_id, choice) values (p_league, p_club, s, p_topic, auth.uid(), c)
      on conflict (league, club, season, topic, user_id) do update set choice = excluded.choice, at = now();
  end if;
  return (select jsonb_build_object('topic', p_topic, 'mine', c, 'total', coalesce(sum(x.n), 0),
      'choices', coalesce(jsonb_agg(jsonb_build_object('choice', x.choice, 'n', x.n, 'name', coalesce(pl.name, fa.name, fc.name),
        'team', coalesce(pl.nhl_team, fa.club), 'pos', coalesce(pl.pos, fa.pos)) order by x.n desc, x.choice), '[]'::jsonb))
    from (select choice, count(*)::int n from fan_calls where league = p_league and club = p_club and season = s and topic = p_topic group by choice) x
    left join players pl on p_league = 'nhl' and pl.id::text = x.choice
    left join fan_athletes fa on p_league <> 'nhl' and fa.league = p_league and fa.id = x.choice
    left join fan_clubs fc on fc.league = p_league and fc.code = x.choice);
end $$;
revoke execute on function public.fan_call(text, text, text, text) from public, anon;
grant execute on function public.fan_call(text, text, text, text) to authenticated;

-- takes a post off its board and keeps a copy
create or replace function public._fan_take_down(p_post bigint, p_why text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into fan_removed (id, league, club, kind, topic, title, body, source, author, user_id, created_at, removed_by, why)
    select p.id, p.league, p.club, p.kind, p.topic, p.title, p.body, p.source, p.author, a.user_id, p.created_at, auth.uid(), p_why
    from fan_posts p left join fan_authors a on a.id = p.id where p.id = p_post
    on conflict (id) do nothing;
  delete from fan_posts where id = p_post;
end $$;
revoke execute on function public._fan_take_down(bigint, text) from public, anon, authenticated;

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
        case when m.club = upper(m.league) then m.club else upper(m.league) || ' ' || m.club end, left(m.title, 120), m.author), '/fans/' || case when m.league = 'nhl' then '' else m.league || '/' end || m.club || '?post=' || m.id);
    end loop;
  end if;
  return 'reported';
end $$;
revoke execute on function public.fan_report(bigint) from public, anon;
grant execute on function public.fan_report(bigint) to authenticated;

-- the name and club a new fan account was made with (the join function, service role only)
create or replace function public._fan_person(p_user uuid, p_name text, p_club text, p_league text default 'nhl') returns void
language plpgsql security definer set search_path = public, private as $$
declare ok boolean := p_club is not null and _fan_club_ok(coalesce(p_league, 'nhl'), p_club);
begin
  insert into private.fan_people (user_id, name, club, league)
    values (p_user, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), case when ok then p_club end, case when ok then coalesce(p_league, 'nhl') end)
    on conflict (user_id) do update set name = excluded.name, club = coalesce(excluded.club, fan_people.club),
      league = coalesce(excluded.league, fan_people.league);
end $$;
revoke execute on function public._fan_person(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public._fan_person(uuid, text, text, text) to service_role;

-- the NHL's checks from migration 337, now that every caller passes a league
drop function if exists public._fan_club_ok(text);
drop function if exists public._fan_season();
