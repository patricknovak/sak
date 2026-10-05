-- Pool games (docs/POOL-TYPES.md §3, SUPERPOOLS P6 and P9): the kinds of sports pool, one engine. A pool runs one or
-- more games; each is a kind (series pick'em, rank the teams; squares, pick'em, the bracket and the player pool come
-- next), an event it runs on (a competition), and its rules (a preset and its knobs, frozen once anything locks).
--
-- * The events: baseball's postseason arrives on the shared event tables beside soccer's (`competitions`, `clubs`,
--   `fixtures`, migration 148), with two new ones: `series` (a best-of-N between two clubs, its round and wins) and
--   `fixture_periods` (a game's score by inning, for the line score and squares). `sport_ingest` is the one write any
--   adapter makes; mlb-sync reads MLB's public Stats API into it (for testing; a licensed feed replaces it, §8).
-- * The picks: `pool_picks`, one row per member per thing to pick (a series, the ranking, the tiebreaker), hidden from
--   the rest of the pool until it locks. Points are worked out on read from the series and games, so a corrected result
--   corrects every table at once and nothing has to be settled.
-- * Pick the series: each series' winner and its length, open until its Game 1's first pitch; points by round and a
--   bonus for the length with the right winner (Classic 1-2-4-8 with 1-1-2-3; Flat; MLB.com's, both or nothing).
-- * Rank the teams: order the clubs still in; at the lock (the first pitch of the round the game starts from) the
--   clubs in that round are ranked N down to 1 in your order, and every game a club wins from then on pays its rank.
-- * The tiebreaker: total runs in the final game of the last round.

set client_min_messages = warning;

-- ───────────── baseball ─────────────
insert into public.sports (id, name, config) values ('mlb', 'MLB baseball', $sport${
  "name": "Baseball",
  "positions": [
    { "key": "SP", "label": "Starting pitcher", "group": "P" },
    { "key": "RP", "label": "Relief pitcher", "group": "P" },
    { "key": "C", "label": "Catcher", "group": "B" },
    { "key": "1B", "label": "First base", "group": "B" },
    { "key": "2B", "label": "Second base", "group": "B" },
    { "key": "3B", "label": "Third base", "group": "B" },
    { "key": "SS", "label": "Shortstop", "group": "B" },
    { "key": "OF", "label": "Outfield", "group": "B" },
    { "key": "DH", "label": "Designated hitter", "group": "B" }
  ],
  "groups": [
    { "key": "B", "label": "Batters", "one": "batter" },
    { "key": "P", "label": "Pitchers", "one": "pitcher" }
  ],
  "slots": [],
  "bench": "BN",
  "injured": "IL",
  "stats": [
    { "key": "r", "label": "Runs", "short": "R", "group": "B" },
    { "key": "hr", "label": "Home runs", "short": "HR", "group": "B" },
    { "key": "rbi", "label": "Runs batted in", "short": "RBI", "group": "B" },
    { "key": "sb", "label": "Stolen bases", "short": "SB", "group": "B" },
    { "key": "k", "label": "Strikeouts", "short": "K", "group": "P" },
    { "key": "w", "label": "Wins", "short": "W", "group": "P" },
    { "key": "sv", "label": "Saves", "short": "SV", "group": "P" }
  ],
  "states": {
    "scheduled": ["Preview", "Scheduled", "Pre-Game", "Warmup"],
    "live": ["Live", "In Progress", "Manager challenge", "Delayed"],
    "final": ["Final", "Game Over", "Completed Early"],
    "postponed": ["Postponed", "Suspended"],
    "cancelled": ["Cancelled"]
  },
  "periods": { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "5": "5th", "6": "6th", "7": "7th", "8": "8th", "9": "9th" },
  "season": { "games": 162, "playoffs": true },
  "day": { "tz": "America/New_York", "rollover": "06:00" },
  "lock": "game",
  "words": {
    "game": "baseball",
    "rec": "beer-league softball",
    "room": "dugout",
    "voice": "a dry, knowing baseball lifer who has kept score by hand since he was nine",
    "start": "first pitch",
    "centre": "MLB centre"
  }
}$sport$::jsonb)
on conflict (id) do nothing;

-- an event can bring its question pack along (the World Series pack rides with the MLB postseason)
alter table public.competitions add column if not exists pack text;

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, pack)
values ('mlb-post-2026', 'mlb', 'MLB Postseason 2026', 'MLB', 'USA', 'America/New_York', '2026', 'mlb-statsapi', '1', '2026', true, 1, 'world-series-2026')
on conflict (id) do nothing;

-- ───────────── series, and a game's score by period ─────────────
create table if not exists public.series (
  id bigint generated always as identity primary key,
  sport text not null references public.sports (id),
  competition text not null references public.competitions (id),
  provider text not null,
  ext_id text not null,                          -- the provider's key: 'D_1'
  round int not null,                            -- 1 the first round of the playoffs, up to the final
  label text not null,                           -- 'AL Division Series'
  short text,                                    -- 'ALDS'
  best_of int not null check (best_of between 1 and 9),
  high_club bigint references public.clubs (id), -- the club with home field in Game 1 (the higher seed); null until known
  low_club bigint references public.clubs (id),
  high_wins int not null default 0,
  low_wins int not null default 0,
  winner bigint references public.clubs (id),
  state text not null default 'scheduled' check (state in ('scheduled', 'live', 'final')),
  starts_at timestamptz,                         -- Game 1's first pitch: when picks on it lock
  tbd boolean not null default true,             -- Game 1's time isn't set yet
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  unique (provider, ext_id)
);
create index if not exists series_competition on public.series (competition, round);
alter table public.series enable row level security;
drop policy if exists series_read on public.series;
create policy series_read on public.series for select using (true);
grant select on public.series to anon, authenticated, service_role;

alter table public.fixtures add column if not exists series_id bigint references public.series (id);
alter table public.fixtures add column if not exists game_no int;          -- Game 3 of its series
alter table public.fixtures add column if not exists detail jsonb;         -- the sport's extras: hits, errors, the inning, probables
create index if not exists fixtures_series on public.fixtures (series_id) where series_id is not null;

create table if not exists public.fixture_periods (
  fixture_id bigint not null references public.fixtures (id) on delete cascade,
  n int not null,                                -- the inning (or quarter, or half)
  home int,
  away int,
  primary key (fixture_id, n)
);
alter table public.fixture_periods enable row level security;
drop policy if exists fixture_periods_read on public.fixture_periods;
create policy fixture_periods_read on public.fixture_periods for select using (true);
grant select on public.fixture_periods to anon, authenticated, service_role;

-- ───────────── the adapters' one write ─────────────
-- Clubs, series and games in the provider's ids, already in our words (the adapter maps the provider's states). A game
-- whose clubs aren't known yet (a later round) waits until they are; its series is kept with its clubs unknown. Each
-- series' wins, winner and state are then worked out from its games, so they never disagree.
create or replace function public.sport_ingest(p_competition text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c competitions; x jsonb; y jsonb; nc int := 0; ns int := 0; nf int := 0; hc bigint; ac bigint; sid bigint; fid bigint; s record; need int;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition %', p_competition; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'clubs', '[]')) loop
    insert into clubs (sport, provider, ext_id, name, short, logo, color)
    values (c.sport, c.provider, x->>'ext_id', left(x->>'name', 80), nullif(left(x->>'short', 5), ''), nullif(x->>'logo', ''), nullif(x->>'color', ''))
    on conflict (sport, provider, ext_id) do update set name = excluded.name, short = coalesce(excluded.short, clubs.short),
      logo = coalesce(excluded.logo, clubs.logo), color = coalesce(excluded.color, clubs.color);
    nc := nc + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'series', '[]')) loop
    insert into series (sport, competition, provider, ext_id, round, label, short, best_of, high_club, low_club, starts_at, tbd, sort, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', (x->>'round')::int, left(x->>'label', 80), nullif(left(x->>'short', 12), ''), (x->>'best_of')::int,
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'high'),
      (select id from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'low'),
      nullif(x->>'starts_at', '')::timestamptz, coalesce((x->>'tbd')::boolean, false), coalesce((x->>'sort')::int, 0), now())
    on conflict (provider, ext_id) do update set round = excluded.round, label = excluded.label, short = coalesce(excluded.short, series.short),
      best_of = excluded.best_of, high_club = coalesce(excluded.high_club, series.high_club), low_club = coalesce(excluded.low_club, series.low_club),
      starts_at = coalesce(excluded.starts_at, series.starts_at), tbd = excluded.tbd, sort = excluded.sort, updated_at = now();
    ns := ns + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'fixtures', '[]')) loop
    select id into hc from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'home';
    select id into ac from clubs where sport = c.sport and provider = c.provider and ext_id = x->>'away';
    if hc is null or ac is null then continue; end if;
    sid := (select id from series where provider = c.provider and ext_id = x->>'series');
    insert into fixtures (sport, competition, provider, ext_id, season, round, gameweek, kickoff, date, home_club, away_club,
      state, status, home_score, away_score, venue, series_id, game_no, detail, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', c.season, x->>'round', nullif(x->>'gameweek', '')::int,
      (x->>'kickoff')::timestamptz, coalesce(nullif(x->>'date', '')::date, ((x->>'kickoff')::timestamptz at time zone c.tz)::date), hc, ac,
      x->>'state', x->>'status', nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(left(x->>'venue', 120), ''),
      sid, nullif(x->>'game_no', '')::int, x->'detail', now())
    on conflict (provider, ext_id) do update set round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
      venue = coalesce(excluded.venue, fixtures.venue), series_id = coalesce(excluded.series_id, fixtures.series_id),
      game_no = coalesce(excluded.game_no, fixtures.game_no), detail = coalesce(excluded.detail, fixtures.detail), updated_at = now()
    returning id into fid;
    for y in select * from jsonb_array_elements(coalesce(x->'periods', '[]')) loop
      insert into fixture_periods (fixture_id, n, home, away) values (fid, (y->>'n')::int, nullif(y->>'home', '')::int, nullif(y->>'away', '')::int)
      on conflict (fixture_id, n) do update set home = excluded.home, away = excluded.away;
    end loop;
    nf := nf + 1;
  end loop;
  -- every series of the competition from its games: wins, the winner once a club has enough, live once a game is played
  for s in select * from series where competition = c.id loop
    need := s.best_of / 2 + 1;
    update series z set
      high_wins = w.hw, low_wins = w.lw,
      winner = case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end,
      state = case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
      starts_at = coalesce(w.first_ko, z.starts_at),
      updated_at = now()
    from (select
            count(*) filter (where f.state = 'final' and ((f.home_club = s.high_club and f.home_score > f.away_score) or (f.away_club = s.high_club and f.away_score > f.home_score)))::int hw,
            count(*) filter (where f.state = 'final' and ((f.home_club = s.low_club and f.home_score > f.away_score) or (f.away_club = s.low_club and f.away_score > f.home_score)))::int lw,
            count(*) filter (where f.state = 'final')::int played,
            count(*) filter (where f.state = 'live')::int live,
            min(f.kickoff) filter (where f.game_no = 1) first_ko
          from fixtures f where f.series_id = s.id) w
    where z.id = s.id and s.high_club is not null and s.low_club is not null
      and (z.high_wins, z.low_wins, z.state, z.winner, z.starts_at) is distinct from
          (w.hw, w.lw, case when w.hw >= need or w.lw >= need then 'final' when w.played > 0 or w.live > 0 then 'live' else 'scheduled' end,
           case when w.hw >= need then s.high_club when w.lw >= need then s.low_club end, coalesce(w.first_ko, z.starts_at));
  end loop;
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;

-- MLB's pull is due while a game is on or about to start, and for an hour after one ends (corrections)
create or replace function public._mlb_due() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fixtures f join competitions c on c.id = f.competition
                 where c.provider = 'mlb-statsapi' and c.active
                   and ((f.state in ('scheduled', 'live') and f.kickoff between now() - interval '7 hours' and now() + interval '10 minutes')
                        or (f.state = 'final' and f.updated_at > now() - interval '1 hour' and f.kickoff > now() - interval '12 hours')))
$$;
revoke execute on function public._mlb_due() from public, anon, authenticated;

-- ───────────── the games inside a pool ─────────────
create table if not exists public.pool_games (
  id bigint generated always as identity primary key,
  league_id int not null default current_league_id() references public.leagues (id),
  kind text not null check (kind in ('series', 'rank')),
  competition text not null references public.competitions (id),
  title text not null,
  rules jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'done')),
  winners int[],
  posted bigint[] not null default '{}',          -- the series whose results the pool has heard
  created_by int references public.teams (id),
  created_at timestamptz not null default now()
);
create index if not exists pool_games_league on public.pool_games (league_id);

create table if not exists public.pool_picks (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.pool_games (id) on delete cascade,
  league_id int not null default current_league_id() references public.leagues (id),
  team_id int not null references public.teams (id),
  thing text not null,                            -- 's:<series id>', 'rank', 'tiebreak'
  pick jsonb not null,
  picked_at timestamptz not null default now(),
  unique (game_id, team_id, thing)
);
create index if not exists pool_picks_game on public.pool_picks (game_id, thing);

do $$ declare t text; begin
  foreach t in array array['pool_games', 'pool_picks'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polrelid = format('public.%I', t)::regclass and polname = 'league_read') then
      execute format('create policy league_read on public.%I for select to authenticated using (league_id = (select current_league_id()))', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- a pick stays hidden until it locks, so the picks are read only through the board
    if t = 'pool_games' then execute format('grant select on public.%I to authenticated', t); end if;
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = t || '_stamp_league') then
      execute format('create trigger %I before insert on public.%I for each row execute function public._stamp_league()', t || '_stamp_league', t);
    end if;
  end loop;
end $$;

-- the rounds of an event: the first and the last, and the first whose series haven't all started (where a game picked
-- up today can still begin)
create or replace function public._event_rounds(p_competition text) returns table (first_round int, last_round int, open_round int)
language sql stable security definer set search_path = public as $$
  select min(round), max(round),
    (select min(s2.round) from series s2 where s2.competition = p_competition
     and not exists (select 1 from series s3 where s3.competition = p_competition and s3.round = s2.round
                     and (s3.state <> 'scheduled' or (s3.starts_at is not null and s3.starts_at <= now()))))
  from series where competition = p_competition
$$;
revoke execute on function public._event_rounds(text) from public, anon, authenticated;

-- a game's rules: the preset, then any knob given, checked; the starting round defaults to the next one to start
create or replace function public._pool_game_rules(p_kind text, p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(p_rules, '{}'); ev record; fr int; preset text; pts jsonb; len jsonb; k text;
begin
  select * into ev from _event_rounds(p_competition);
  if ev.last_round is null then raise exception 'That event has no rounds yet'; end if;
  fr := coalesce((r->>'from_round')::int, ev.open_round);
  if fr is null then raise exception 'Every round of that event has started'; end if;
  if fr < ev.first_round or fr > ev.last_round then raise exception 'No such round'; end if;
  if ev.open_round is null or fr < ev.open_round then raise exception 'That round has already started; start from the next one'; end if;
  if p_kind = 'series' then
    preset := coalesce(r->>'preset', 'classic');
    if preset not in ('classic', 'flat', 'exact') then raise exception 'Pick a scoring: Classic, Flat or MLB.com'; end if;
    pts := case preset when 'classic' then '{"1":1,"2":2,"3":4,"4":8}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":1,"2":1,"3":1,"4":1}' end;
    len := case preset when 'classic' then '{"1":1,"2":1,"3":2,"4":3}' when 'flat' then '{"1":1,"2":1,"3":1,"4":1}' else '{"1":0,"2":0,"3":0,"4":0}' end;
    pts := pts || coalesce(r->'points', '{}'); len := len || coalesce(r->'length', '{}');
    for k in select jsonb_object_keys(pts) union select jsonb_object_keys(len) loop
      if coalesce((pts->>k)::int, 0) not between 0 and 100 or coalesce((len->>k)::int, 0) not between 0 and 100 then
        raise exception 'Points are whole numbers from 0 to 100';
      end if;
    end loop;
    return jsonb_build_object('preset', preset, 'from_round', fr, 'points', pts, 'length', len, 'exact_only', preset = 'exact',
      'tiebreak', coalesce((r->>'tiebreak')::boolean, true));
  elsif p_kind = 'rank' then
    return jsonb_build_object('from_round', fr, 'per', 'game');
  end if;
  raise exception 'No such kind of game';
end $$;
revoke execute on function public._pool_game_rules(text, text, jsonb) from public, anon, authenticated;

-- a series pick's points: the winner's points for its round, plus the length bonus with the right winner; MLB.com's
-- rules pay only when both are right
create or replace function public._series_pick_points(p_rules jsonb, p_round int, p_pick_winner bigint, p_pick_games int, p_winner bigint, p_games int)
returns int language sql immutable set search_path = public as $$
  select case
    when p_winner is null or p_pick_winner is distinct from p_winner then 0
    when coalesce((p_rules->>'exact_only')::boolean, false) then case when p_pick_games = p_games then coalesce((p_rules->'points'->>p_round::text)::int, 1) else 0 end
    else coalesce((p_rules->'points'->>p_round::text)::int, 1)
         + case when p_pick_games = p_games then coalesce((p_rules->'length'->>p_round::text)::int, 0) else 0 end
  end
$$;

-- can a series still end with this club winning in this many games, from where it stands?
create or replace function public._series_can_end(p_best_of int, p_pick_wins int, p_other_wins int, p_games int) returns boolean
language sql immutable set search_path = public as $$
  select p_pick_wins < (p_best_of / 2 + 1) and p_other_wins < (p_best_of / 2 + 1)
     and (p_games is null or (p_other_wins <= p_games - (p_best_of / 2 + 1) and p_games between (p_best_of / 2 + 1) and p_best_of))
$$;

-- when the ranking locks: the first pitch of the round the game starts from
create or replace function public._rank_lock(p_game bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(s.starts_at) from pool_games g join series s on s.competition = g.competition and s.round = (g.rules->>'from_round')::int
  where g.id = p_game
$$;
revoke execute on function public._rank_lock(bigint) from public, anon, authenticated;

-- the most wins a club can still add from today: the rest of its series, then every later round
create or replace function public._club_wins_left(p_competition text, p_club bigint) returns int
language plpgsql stable security definer set search_path = public as $$
declare cur series; n int := 0; last_r int;
begin
  select * into cur from series where competition = p_competition and p_club in (high_club, low_club) order by round desc limit 1;
  if cur.id is null then return 0; end if;
  if cur.state = 'final' and cur.winner is distinct from p_club then return 0; end if;
  select max(round) into last_r from series where competition = p_competition;
  if cur.state <> 'final' then n := (cur.best_of / 2 + 1) - case when cur.high_club = p_club then cur.high_wins else cur.low_wins end; end if;
  n := n + coalesce((select sum(b.best_of / 2 + 1) from (select round, max(best_of) best_of from series
                      where competition = p_competition and round > cur.round and round <= last_r group by round) b), 0);
  return n;
end $$;
revoke execute on function public._club_wins_left(text, bigint) from public, anon, authenticated;

-- a member's ranking as values: the clubs of the starting round, in their order (clubs they left out are worth 0)
create or replace function public._rank_values(p_game bigint, p_order jsonb) returns table (club bigint, value int)
language sql stable security definer set search_path = public as $$
  with g as (select * from pool_games where id = p_game),
  field as (select distinct unnest(array[s.high_club, s.low_club]) club from series s, g
            where s.competition = g.competition and s.round = (g.rules->>'from_round')::int),
  ordered as (select (o.v)::bigint club, o.i from jsonb_array_elements_text(coalesce(p_order, '[]')) with ordinality o(v, i)
              where (o.v)::bigint in (select club from field where club is not null)),
  ranked as (select club, row_number() over (order by i) rn from ordered)
  select r.club, ((select count(*) from field where club is not null) - r.rn + 1)::int from ranked r
$$;
revoke execute on function public._rank_values(bigint, jsonb) from public, anon, authenticated;

-- the table of a game: points, the most still possible, right calls and exact lengths, and how many picks are in
create or replace function public._pool_game_table(p_game bigint) returns table (team_id int, points int, possible int, right_calls int, exact int, picked int, tiebreak int)
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; fr int; lock_at timestamptz; ws_runs int;
begin
  select * into g from pool_games where id = p_game;
  if g.id is null then return; end if;
  fr := (g.rules->>'from_round')::int;
  -- the final game's total runs, for the tiebreaker
  select f.home_score + f.away_score into ws_runs from fixtures f join series s on s.id = f.series_id
  where s.competition = g.competition and s.round = (select max(round) from series where competition = g.competition) and s.state = 'final' and f.state = 'final'
  order by f.kickoff desc limit 1;
  if g.kind = 'series' then
    return query
    with s as (select * from series where competition = g.competition and round >= fr),
    p as (select pk.team_id, s.*, (pk.pick->>'winner')::bigint pw, (pk.pick->>'games')::int pn
          from pool_picks pk join s on pk.thing = 's:' || s.id where pk.game_id = g.id),
    full_value as (select s.id, coalesce((g.rules->'points'->>s.round::text)::int, 1)
                     + case when coalesce((g.rules->>'exact_only')::boolean, false) then 0 else coalesce((g.rules->'length'->>s.round::text)::int, 0) end v
                   from s),
    scored as (
      select p.team_id,
        _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, case when p.state = 'final' then p.high_wins + p.low_wins end) pts,
        case when p.state = 'final' then _series_pick_points(g.rules, p.round, p.pw, p.pn, p.winner, p.high_wins + p.low_wins)
             -- still open: the winner's points if that club can still take it, the length too if it can still end that way
             when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                  case when p.pw = p.high_club then p.low_wins else p.high_wins end, null) then
               case when _series_can_end(p.best_of, case when p.pw = p.high_club then p.high_wins else p.low_wins end,
                                         case when p.pw = p.high_club then p.low_wins else p.high_wins end, p.pn)
                    then (select v from full_value fv where fv.id = p.id)
                    when coalesce((g.rules->>'exact_only')::boolean, false) then 0
                    else coalesce((g.rules->'points'->>p.round::text)::int, 1) end
             else 0 end poss,
        (p.state = 'final' and p.pw = p.winner) rt,
        (p.state = 'final' and p.pw = p.winner and p.pn = p.high_wins + p.low_wins) ex
      from p),
    -- a series still open to pick, and not picked yet, is all still possible
    unpicked as (select tm.id team_id, sum(fv.v)::int v from teams tm cross join s join full_value fv on fv.id = s.id
                 where tm.league_id = g.league_id and tm.role = 'gm' and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
                   and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 's:' || s.id)
                 group by tm.id)
    select tm.id::int, coalesce(sum(sc.pts), 0)::int, (coalesce(sum(sc.poss), 0) + coalesce(max(u.v), 0))::int,
      count(*) filter (where sc.rt)::int, count(*) filter (where sc.ex)::int,
      (select count(*) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing like 's:%')::int,
      (select abs((pk.pick->>'runs')::int - ws_runs) from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'tiebreak' and ws_runs is not null)::int
    from teams tm left join scored sc on sc.team_id = tm.id left join unpicked u on u.team_id = tm.id
    where tm.league_id = g.league_id and tm.role = 'gm'
    group by tm.id;
  else
    lock_at := _rank_lock(g.id);
    return query
    with mine as (select pk.team_id, pk.pick->'order' ord from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'),
    vals as (select m.team_id, v.club, v.value from mine m cross join lateral _rank_values(g.id, m.ord) v),
    wins as (select case when f.home_score > f.away_score then f.home_club else f.away_club end club, count(*)::int n
             from fixtures f join series s on s.id = f.series_id
             where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
             group by 1)
    select tm.id::int,
      coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)::int,
      (coalesce((select sum(v.value * coalesce(w.n, 0)) from vals v left join wins w on w.club = v.club where v.team_id = tm.id), 0)
       + coalesce((select sum(v.value * _club_wins_left(g.competition, v.club)) from vals v where v.team_id = tm.id), 0)
       + case when not exists (select 1 from mine m where m.team_id = tm.id) and (lock_at is null or lock_at > now()) then
           (select coalesce(sum(x.v * _club_wins_left(g.competition, x.club)), 0) from (
              select c.club, (count(*) over () - row_number() over (order by _club_wins_left(g.competition, c.club) desc) + 1) v
              from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition and s.round = fr) c
              where c.club is not null) x)
         else 0 end)::int,
      0, 0, (select count(*) from mine m where m.team_id = tm.id)::int, null::int
    from teams tm where tm.league_id = g.league_id and tm.role = 'gm';
  end if;
end $$;
revoke execute on function public._pool_game_table(bigint) from public, anon, authenticated;

-- ───────────── starting a game ─────────────
create or replace function public._pool_game_create(p_kind text, p_competition text, p_rules jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r jsonb; gid bigint; ttl text; fr_label text; c competitions;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such event'; end if;
  if exists (select 1 from pool_games where league_id = current_league_id() and kind = p_kind and competition = p_competition and status = 'open') then
    raise exception 'This pool already runs that game';
  end if;
  r := _pool_game_rules(p_kind, p_competition, p_rules);
  fr_label := (select regexp_replace(min(label), '^(AL|NL|AFC|NFC) ', '') from series where competition = p_competition and round = (r->>'from_round')::int);
  ttl := case p_kind when 'series' then 'Pick the series' else 'Rank the teams' end;
  insert into pool_games (kind, competition, title, rules, created_by) values (p_kind, p_competition, ttl, r, my_team()) returning id into gid;
  perform _sys('general', case p_kind
    when 'series' then format('⚾ Pick the series is on, from the %s: call each series and how many games it goes. Each pick locks at its Game 1''s first pitch.', fr_label)
    else format('📊 Rank the teams is on: put the clubs in the %s in order. Your top club is worth the most for every game it wins. Your order locks at the first pitch of the round.', fr_label) end,
    jsonb_build_object('pool_game', gid));
  return gid;
end $$;
revoke execute on function public._pool_game_create(text, text, jsonb) from public, anon, authenticated;

-- the host adds a game to their pool
create or replace function public.pool_game_start(p_kind text, p_competition text, p_rules jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  return _pool_game_create(p_kind, p_competition, p_rules);
end $$;
revoke execute on function public.pool_game_start(text, text, jsonb) from public, anon;
grant execute on function public.pool_game_start(text, text, jsonb) to authenticated;

-- a pool just opened takes its games ([{kind, competition, rules}]); only its host, and only while the pool is new
create or replace function public.pool_start_games(p_league int, p_games jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; ids bigint[] := '{}';
begin
  if auth.uid() is null or not exists (select 1 from teams where league_id = p_league and user_id = auth.uid() and is_commish) then
    raise exception 'Only the pool''s host starts its games';
  end if;
  if (select created_at from leagues where id = p_league) < now() - interval '1 day' then raise exception 'Add games from the Host page'; end if;
  perform set_config('app.league_id', p_league::text, true);
  if current_league_id() <> p_league then raise exception 'Could not open that pool'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_games, '[]')) loop
    ids := ids || _pool_game_create(x->>'kind', x->>'competition', x->'rules');
  end loop;
  return to_jsonb(ids);
end $$;
revoke execute on function public.pool_start_games(int, jsonb) from public, anon;
grant execute on function public.pool_start_games(int, jsonb) to authenticated;

-- ───────────── picking ─────────────
-- p_thing: 's:<series id>' with {winner, games}; 'rank' with {order: [club ids]}; 'tiebreak' with {runs}
create or replace function public.pool_game_pick(p_game bigint, p_thing text, p_pick jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pool_games; me int := _team(); s series; w bigint; n int; lock_at timestamptz; ord jsonb; v text; last_r int;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then raise exception 'No such game here'; end if;
  if g.status <> 'open' then raise exception 'That one is over'; end if;
  if (select role from teams where id = me) <> 'gm' then raise exception 'Only players pick'; end if;
  if p_thing like 's:%' and g.kind = 'series' then
    select * into s from series where id = substr(p_thing, 3)::bigint and competition = g.competition;
    if s.id is null or s.round < (g.rules->>'from_round')::int then raise exception 'That series isn''t in this game'; end if;
    if s.high_club is null or s.low_club is null then raise exception 'That series isn''t set yet'; end if;
    if s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then raise exception 'That series has started; picks are locked'; end if;
    w := (p_pick->>'winner')::bigint; n := (p_pick->>'games')::int;
    if w not in (s.high_club, s.low_club) then raise exception 'Pick one of the two clubs'; end if;
    if n is null or n not between (s.best_of / 2 + 1) and s.best_of then raise exception 'A best-of-% goes % to % games', s.best_of, s.best_of / 2 + 1, s.best_of; end if;
    p_pick := jsonb_build_object('winner', w, 'games', n);
  elsif p_thing = 'rank' and g.kind = 'rank' then
    lock_at := _rank_lock(g.id);
    if lock_at is not null and lock_at <= now() then raise exception 'The ranking locked at the first pitch'; end if;
    ord := '[]';
    for v in select jsonb_array_elements_text(coalesce(p_pick->'order', '[]')) loop
      if not exists (select 1 from series where competition = g.competition and v::bigint in (high_club, low_club)) then raise exception 'That club isn''t in this event'; end if;
      if ord @> to_jsonb(v::bigint) then raise exception 'Each club once'; end if;
      ord := ord || to_jsonb(v::bigint);
    end loop;
    if jsonb_array_length(ord) < 2 then raise exception 'Put the clubs in order'; end if;
    p_pick := jsonb_build_object('order', ord);
  elsif p_thing = 'tiebreak' and g.kind = 'series' then
    select max(round) into last_r from series where competition = g.competition;
    lock_at := (select min(starts_at) from series where competition = g.competition and round = last_r);
    if lock_at is not null and lock_at <= now() then raise exception 'The tiebreaker locked at the first pitch of the final round'; end if;
    n := (p_pick->>'runs')::int;
    if n is null or n not between 0 and 60 then raise exception 'Total runs: a number from 0 to 60'; end if;
    p_pick := jsonb_build_object('runs', n);
  else
    raise exception 'Nothing to pick there';
  end if;
  insert into pool_picks (game_id, team_id, thing, pick) values (g.id, me, p_thing, p_pick)
  on conflict (game_id, team_id, thing) do update set pick = excluded.pick, picked_at = now();
  return p_pick;
end $$;
revoke execute on function public.pool_game_pick(bigint, text, jsonb) from public, anon;
grant execute on function public.pool_game_pick(bigint, text, jsonb) to authenticated;

-- ───────────── reading ─────────────
create or replace function public._club_json(p_club bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'short', c.short, 'logo', c.logo, 'color', c.color) from clubs c where c.id = p_club
$$;
revoke execute on function public._club_json(bigint) from public, anon, authenticated;

-- the board of a game: every series (or the ranking) with your pick, everyone's once it locks, and the table
create or replace function public.pool_game_board(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; me int := my_team(); fr int; last_r int; lock_at timestamptz; tb_lock timestamptz; out jsonb;
begin
  perform _in_league('pool_games', p_game);
  select * into g from pool_games where id = p_game and league_id = current_league_id();
  if g.id is null then return null; end if;
  fr := (g.rules->>'from_round')::int;
  select max(round) into last_r from series where competition = g.competition;
  out := jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'rules', g.rules, 'status', g.status, 'winners', to_jsonb(g.winners),
    'competition', g.competition, 'competition_name', (select name from competitions where id = g.competition), 'me', me,
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round', r.round, 'label', r.label, 'best_of', r.best_of) order by r.round)
       from (select round, max(regexp_replace(label, '^(AL|NL|AFC|NFC) ', '')) label, max(best_of) best_of from series
             where competition = g.competition and round >= fr group by round) r), '[]'),
    'table', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.team_id, 'points', t.points, 'possible', t.possible, 'right', t.right_calls,
        'exact', t.exact, 'picked', t.picked, 'tiebreak', t.tiebreak) order by t.points desc, t.tiebreak nulls last, t.possible desc, t.team_id)
      from _pool_game_table(g.id) t), '[]'));
  if g.kind = 'series' then
    tb_lock := (select min(starts_at) from series where competition = g.competition and round = last_r);
    out := out || jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'round', s.round, 'label', s.label, 'short', s.short, 'best_of', s.best_of,
          'high', _club_json(s.high_club), 'low', _club_json(s.low_club), 'high_wins', s.high_wins, 'low_wins', s.low_wins,
          'winner', s.winner, 'state', s.state, 'starts_at', s.starts_at, 'tbd', s.tbd,
          'locked', s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()),
          'next', (select jsonb_build_object('kickoff', f.kickoff, 'game_no', f.game_no, 'state', f.state, 'home', f.home_club,
                     'home_score', f.home_score, 'away_score', f.away_score, 'detail', f.detail)
                   from fixtures f where f.series_id = s.id and f.state in ('scheduled', 'live') order by (f.state = 'live') desc, f.kickoff limit 1),
          'mine', (select pk.pick from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id),
          'points', (select _series_pick_points(g.rules, s.round, (pk.pick->>'winner')::bigint, (pk.pick->>'games')::int, s.winner,
                       case when s.state = 'final' then s.high_wins + s.low_wins end)
                     from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 's:' || s.id and s.state = 'final'),
          -- everyone's picks, once the series has started
          'calls', case when s.state <> 'scheduled' or (s.starts_at is not null and s.starts_at <= now()) then
            coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'winner', (pk.pick->>'winner')::bigint, 'games', (pk.pick->>'games')::int)
                        order by pk.team_id) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id), '[]') end,
          'picked', (select count(*) from pool_picks pk where pk.game_id = g.id and pk.thing = 's:' || s.id))
        order by s.round, s.sort, s.id)
        from series s where s.competition = g.competition and s.round >= fr), '[]'),
      'tiebreak', jsonb_build_object('locks_at', tb_lock, 'locked', tb_lock is not null and tb_lock <= now(),
        'mine', (select (pk.pick->>'runs')::int from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'tiebreak'),
        'label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = last_r)));
  else
    lock_at := _rank_lock(g.id);
    out := out || jsonb_build_object('rank', jsonb_build_object(
      'locks_at', lock_at, 'locked', lock_at is not null and lock_at <= now(),
      'round_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = g.competition and round = fr),
      'field', (select count(distinct c) from series s, unnest(array[s.high_club, s.low_club]) c where s.competition = g.competition and s.round = fr and c is not null),
      -- the clubs still in (or every club in the event, out ones last), with what each has won since the lock
      'clubs', coalesce((select jsonb_agg(_club_json(c.club) || jsonb_build_object('alive', _club_wins_left(g.competition, c.club) > 0,
            'in_field', c.club in (select unnest(array[s.high_club, s.low_club]) from series s where s.competition = g.competition and s.round = fr),
            'wins', (select count(*) from fixtures f join series s on s.id = f.series_id
                     where s.competition = g.competition and s.round >= fr and f.state = 'final' and lock_at is not null and f.kickoff >= lock_at
                       and c.club = case when f.home_score > f.away_score then f.home_club else f.away_club end),
            'left', _club_wins_left(g.competition, c.club))
          order by (_club_wins_left(g.competition, c.club) > 0) desc, c.club)
        from (select distinct unnest(array[s.high_club, s.low_club]) club from series s where s.competition = g.competition) c where c.club is not null), '[]'),
      'mine', (select pk.pick->'order' from pool_picks pk where pk.game_id = g.id and pk.team_id = me and pk.thing = 'rank'),
      'orders', case when lock_at is not null and lock_at <= now() then
        coalesce((select jsonb_agg(jsonb_build_object('team_id', pk.team_id, 'order', pk.pick->'order') order by pk.team_id)
                  from pool_picks pk where pk.game_id = g.id and pk.thing = 'rank'), '[]') end));
  end if;
  return out;
end $$;
revoke execute on function public.pool_game_board(bigint) from public, anon;
grant execute on function public.pool_game_board(bigint) to authenticated;

-- the pool's games, for its menu and home: what each needs from the caller now
create or replace function public.pool_games_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'status', g.status, 'competition', g.competition,
      'to_pick', case when g.kind = 'series' then
          (select count(*) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.low_club is not null and s.state = 'scheduled' and (s.starts_at is null or s.starts_at > now())
             and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 's:' || s.id))
        else case when (_rank_lock(g.id) is null or _rank_lock(g.id) > now())
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = my_team() and pk.thing = 'rank') then 1 else 0 end end,
      'next_lock', case when g.kind = 'series' then
          (select min(s.starts_at) from series s where s.competition = g.competition and s.round >= (g.rules->>'from_round')::int
             and s.high_club is not null and s.state = 'scheduled' and s.starts_at > now())
        else (select l from (select _rank_lock(g.id) l) z where l > now()) end)
    order by g.id), '[]')
  from pool_games g where g.league_id = current_league_id()
$$;
revoke execute on function public.pool_games_list() from public, anon;
grant execute on function public.pool_games_list() to authenticated;

-- the sports events a new pool can run on today, for the start page (open to anyone): the stage it is at and the kinds
-- of game that can still start, with when each locks
create or replace function public.pool_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(e order by e->>'next_lock'), '[]') from (
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack,
      'stage', (select case when s.state = 'scheduled' then regexp_replace(s.label, '^(AL|NL) ', '') || ' next'
                            else regexp_replace(s.label, '^(AL|NL) ', '') || ' under way' end
                from series s where s.competition = c.id and s.state <> 'final' order by s.round, s.starts_at nulls last limit 1),
      'open_round', r.open_round,
      'open_label', (select regexp_replace(min(label), '^(AL|NL) ', '') from series where competition = c.id and round = r.open_round),
      'next_lock', (select min(starts_at) from series where competition = c.id and round = r.open_round),
      'final_round', r.last_round,
      'final_label', (select min(label) from series where competition = c.id and round = r.last_round),
      'final_starts', (select min(starts_at) from series where competition = c.id and round = r.last_round),
      'kinds', jsonb_build_array('series', 'rank')) e
    from competitions c cross join lateral _event_rounds(c.id) r
    where c.active and r.open_round is not null) z
$$;
revoke execute on function public.pool_events() from public;
grant execute on function public.pool_events() to anon, authenticated;

-- ───────────── results, alerts and the reminder ─────────────
-- a series ends (or a correction changes its winner): every pool game on it hears who called it, and a game whose last
-- round is done names its winners
create or replace function public._pool_game_series_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare g pool_games; p record; n int; total int; exact_n int; wname text; games int; last_r int; top record;
begin
  if new.state <> 'final' or new.winner is null then return new; end if;
  if old.state = 'final' and old.winner is not distinct from new.winner and old.high_wins = new.high_wins and old.low_wins = new.low_wins then return new; end if;
  wname := (select name from clubs where id = new.winner);
  games := new.high_wins + new.low_wins;
  select max(round) into last_r from series where competition = new.competition;
  for g in select * from pool_games where competition = new.competition and status = 'open' and new.round >= (rules->>'from_round')::int loop
    if g.kind = 'series' and not (new.id = any (g.posted)) then
      select count(*), count(*) filter (where (pick->>'winner')::bigint = new.winner), count(*) filter (where (pick->>'winner')::bigint = new.winner and (pick->>'games')::int = games)
      into total, n, exact_n from pool_picks where game_id = g.id and thing = 's:' || new.id;
      if total > 0 then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏁 %s win the %s in %s. %s of %s called it%s.', wname, coalesce(new.short, new.label), games, n, total,
                 case when exact_n > 0 then format(', %s with the length', exact_n) else '' end),
          jsonb_build_object('pool_game', g.id, 'series', new.id), g.league_id);
        for p in select team_id, (pick->>'winner')::bigint w, (pick->>'games')::int k from pool_picks where game_id = g.id and thing = 's:' || new.id loop
          perform _pool_alert(p.team_id, 'pool_game', case when p.w = new.winner
            then format('✅ You called it: %s in %s%s. +%s', wname, games, case when p.k = games then ', length and all' else '' end,
                        _series_pick_points(g.rules, new.round, p.w, p.k, new.winner, games))
            else format('❌ %s win the %s in %s.', wname, coalesce(new.short, new.label), games) end, '/picks?g=' || g.id);
        end loop;
      end if;
      update pool_games set posted = posted || new.id where id = g.id;
    end if;
    -- the last round is done: the game's winners
    if new.round = last_r and not exists (select 1 from series where competition = new.competition and round = last_r and state <> 'final') then
      select string_agg(tm.gm_name, ' and ' order by tm.gm_name) names, max(t.points) pts into top
      from _pool_game_table(g.id) t join teams tm on tm.id = t.team_id
      where t.points = (select max(points) from _pool_game_table(g.id)) and t.points > 0;
      update pool_games set status = 'done', winners = array(select t.team_id from _pool_game_table(g.id) t
                                                               where t.points = (select max(points) from _pool_game_table(g.id)) and t.points > 0)
      where id = g.id;
      if top.names is not null then
        insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
          format('🏆 %s is done: %s, with %s points.', g.title, top.names, top.pts), jsonb_build_object('pool_game', g.id), g.league_id);
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._pool_game_series_done() from public, anon, authenticated;
drop trigger if exists series_pool_games on public.series;
create trigger series_pool_games after update of state, winner, high_wins, low_wins on public.series
  for each row execute function public._pool_game_series_done();

-- once per member per series (or per ranking), when the lock is under six hours away and they haven't picked
create or replace function public._pool_game_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g pool_games; s record; t record; n int := 0; lk timestamptz; hrs text;
begin
  for g in select * from pool_games where league_id = p_league and status = 'open' loop
    for s in select x.id, x.starts_at, coalesce(x.short, x.label) nm from series x
             where g.kind = 'series' and x.competition = g.competition and x.round >= (g.rules->>'from_round')::int
               and x.high_club is not null and x.low_club is not null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             select 0, _rank_lock(g.id), 'ranking' where g.kind = 'rank' and _rank_lock(g.id) between now() and now() + interval '6 hours' loop
      lk := s.starts_at;
      hrs := case when lk - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from lk - now()) / 3600))::int || 'h' end;
      for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
                 and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id
                                 and pk.thing = case when s.id = 0 then 'rank' else 's:' || s.id end)
                 and not exists (select 1 from private.soccer_nudged x where x.game = g.kind and x.game_id = g.id and x.team_id = tm.id and x.gameweek = s.id) loop
        perform _pool_alert(t.id, 'pool_game', case when s.id = 0
          then format('⏰ Rank the teams locks in %s. Put the clubs in order.', hrs)
          else format('⏰ The %s starts in %s. Pick the winner and how many games.', s.nm, hrs) end, '/picks?g=' || g.id);
        insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.kind, g.id, t.id, s.id) on conflict do nothing;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_game_nudge(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id())
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
