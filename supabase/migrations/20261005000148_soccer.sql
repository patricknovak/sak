-- Soccer, the next sport, step 1 (docs/POOLS.md section 7, docs/EXPANSION.md Phase 4): prediction pools on soccer,
-- which need fixtures and results only.
--
-- * sports: a 'soccer' row (positions GK, DEF, MID, FWD; two halves, extra time and penalties; the provider's match
--   states mapped onto the engine's five; a gameweek lock; the words Garry speaks in).
-- * competitions, clubs, fixtures: provider-neutral and shared by every league, like the NHL's games. A fixture is
--   keyed by (provider, ext_id), so API-Football today and Sportmonks later fill the same rows. Fixtures get their own
--   table, not rows in `games`: every NHL reader of `games` matches on a three-letter code, and MLS shares those with
--   the NHL (TOR, MTL, VAN, SEA, COL, DAL, CHI, MIN, NSH, STL), so soccer rows there would score hockey nights.
-- * soccer_ingest(): the adapter's one write. The edge function (soccer-sync) turns the provider's answer into neutral
--   rows; this upserts the clubs and fixtures and works out each match's state from the sport's own list.
-- * Pool questions from fixtures: pool_markets.source names the fixture a question follows. The host adds a
--   gameweek's matches in one go (pool_add_fixtures), each question closes at kick-off, and the scheduler settles it
--   from the full-time result (run_league_jobs('pool-settle')); a postponed or abandoned match is voided and refunded.
--   pool_resolve keeps its checks and hands the paying out to _pool_settle, which the scheduler shares.

set client_min_messages = warning;

-- ───────────── the sport ─────────────
insert into public.sports (id, name, config) values ('soccer', 'Soccer', $sport${
  "name": "Soccer",
  "positions": [
    { "key": "GK", "label": "Goalkeeper", "group": "K" },
    { "key": "DEF", "label": "Defender", "group": "O" },
    { "key": "MID", "label": "Midfielder", "group": "O" },
    { "key": "FWD", "label": "Forward", "group": "O" }
  ],
  "groups": [
    { "key": "O", "label": "Outfield players", "one": "outfield player" },
    { "key": "K", "label": "Goalkeepers", "one": "keeper" }
  ],
  "slots": [
    { "key": "GK", "label": "GK", "accepts": ["GK"] },
    { "key": "DEF", "label": "DEF", "accepts": ["DEF"] },
    { "key": "MID", "label": "MID", "accepts": ["MID"] },
    { "key": "FWD", "label": "FWD", "accepts": ["FWD"] }
  ],
  "bench": "BN",
  "injured": "IR",
  "stats": [
    { "key": "min", "label": "Minutes", "short": "MIN", "group": "O" },
    { "key": "g", "label": "Goals", "short": "G", "group": "O" },
    { "key": "a", "label": "Assists", "short": "A", "group": "O" },
    { "key": "cs", "label": "Clean sheets", "short": "CS", "group": "O" },
    { "key": "gc", "label": "Goals conceded", "short": "GC", "group": "O", "low": true },
    { "key": "dc", "label": "Defensive contributions", "short": "DC", "group": "O" },
    { "key": "bonus", "label": "Bonus", "short": "BON", "group": "O" },
    { "key": "yc", "label": "Yellow cards", "short": "YC", "group": "O", "low": true },
    { "key": "rc", "label": "Red cards", "short": "RC", "group": "O", "low": true },
    { "key": "og", "label": "Own goals", "short": "OG", "group": "O", "low": true },
    { "key": "pm", "label": "Penalties missed", "short": "PM", "group": "O", "low": true },
    { "key": "sv", "label": "Saves", "short": "SV", "group": "K" },
    { "key": "ps", "label": "Penalties saved", "short": "PS", "group": "K" }
  ],
  "states": {
    "scheduled": ["TBD", "NS"],
    "live": ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"],
    "final": ["FT", "AET", "PEN", "AWD", "WO"],
    "postponed": ["PST"],
    "cancelled": ["CANC", "ABD"]
  },
  "periods": { "1H": "1st half", "HT": "Half-time", "2H": "2nd half", "ET": "Extra time", "BT": "Break", "P": "Penalties" },
  "season": { "games": 38, "starterGames": 38, "playoffs": false },
  "day": { "tz": "Europe/London", "rollover": "06:00" },
  "lock": "week",
  "words": {
    "game": "soccer",
    "rec": "Sunday-league",
    "room": "changing room",
    "voice": "a cheerful, sharp-tongued Sunday-league regular who has watched every match of the weekend",
    "club": "club",
    "start": "kick-off",
    "centre": "Match centre",
    "starter": "starting keeper"
  }
}$sport$::jsonb)
on conflict (id) do update set name = excluded.name, config = excluded.config;

-- a provider's match status as the engine's state ('scheduled', 'live', 'final', 'postponed', 'cancelled'); a status
-- the sport doesn't list counts as under way, the way the site reads an unknown NHL state
create or replace function public._sport_state(p_sport text, p_status text) returns text
language sql stable set search_path = public as $$
  select coalesce((select st.key from sports s, jsonb_each(s.config->'states') st
                   where s.id = p_sport and st.value ? p_status limit 1), 'live')
$$;

-- ───────────── competitions, clubs, fixtures (shared) ─────────────
create table if not exists public.competitions (
  id text primary key,                       -- our key: 'epl', 'mls'
  sport text not null references public.sports (id),
  name text not null,
  short text not null,
  country text,
  tz text not null default 'UTC',            -- a match's date is its date here
  season text not null,                      -- as people say it: '2026-27', '2026'
  provider text not null default 'api-football',
  ext_id text not null,                      -- the provider's league id
  ext_season text not null,                  -- the provider's season key
  active boolean not null default false,     -- the sync pulls only active competitions
  sort int not null default 0
);
alter table public.competitions enable row level security;
drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select using (true);
grant select on public.competitions to anon, authenticated, service_role;

create table if not exists public.clubs (
  id bigint generated always as identity primary key,
  sport text not null references public.sports (id),
  provider text not null,
  ext_id text not null,
  name text not null,
  short text,                                -- 'ARS'
  logo text,
  color text,
  unique (sport, provider, ext_id)
);
alter table public.clubs enable row level security;
drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select using (true);
grant select on public.clubs to anon, authenticated, service_role;

create table if not exists public.fixtures (
  id bigint generated always as identity primary key,
  sport text not null references public.sports (id),
  competition text not null references public.competitions (id),
  provider text not null,
  ext_id text not null,
  season text not null,
  round text,                                -- the provider's words: 'Regular Season - 8'
  gameweek int,                              -- 8
  kickoff timestamptz not null,
  date date not null,                        -- kick-off's date in the competition's time zone
  home_club bigint not null references public.clubs (id),
  away_club bigint not null references public.clubs (id),
  state text not null default 'scheduled' check (state in ('scheduled', 'live', 'final', 'postponed', 'cancelled')),
  status text,                               -- the provider's own: 'NS', '2H', 'FT'
  minute int,
  home_score int, away_score int,            -- the final score, extra time included
  home_ft int, away_ft int,                  -- after ninety minutes and stoppage time: what a result question reads
  home_pens int, away_pens int,
  venue text,
  updated_at timestamptz not null default now(),
  unique (provider, ext_id)
);
create index if not exists fixtures_round on public.fixtures (competition, gameweek, kickoff);
create index if not exists fixtures_kickoff on public.fixtures (kickoff) where state in ('scheduled', 'live');
alter table public.fixtures enable row level security;
drop policy if exists fixtures_read on public.fixtures;
create policy fixtures_read on public.fixtures for select using (true);
grant select on public.fixtures to anon, authenticated, service_role;

insert into public.competitions (id, sport, name, short, country, tz, season, ext_id, ext_season, active, sort) values
  ('epl', 'soccer', 'Premier League', 'EPL', 'England', 'Europe/London', '2026-27', '39', '2026', true, 1),
  ('mls', 'soccer', 'Major League Soccer', 'MLS', 'USA', 'America/New_York', '2026', '253', '2026', true, 2),
  ('ucl', 'soccer', 'Champions League', 'UCL', 'Europe', 'Europe/London', '2026-27', '2', '2026', false, 3),
  ('nwsl', 'soccer', 'NWSL', 'NWSL', 'USA', 'America/New_York', '2026', '254', '2026', false, 4),
  ('wsl', 'soccer', 'Women''s Super League', 'WSL', 'England', 'Europe/London', '2026-27', '44', '2026', false, 5),
  ('ligamx', 'soccer', 'Liga MX', 'LMX', 'Mexico', 'America/Mexico_City', '2026-27', '262', '2026', false, 6)
on conflict (id) do nothing;

-- the adapter's write: p = {clubs: [{ext_id, name, short, logo}], fixtures: [{ext_id, season, round, gameweek, kickoff,
-- status, minute, home, away (club ext_ids), home_score, away_score, home_ft, away_ft, home_pens, away_pens, venue}]}
create or replace function public.soccer_ingest(p_competition text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c competitions; x jsonb; nc int := 0; nf int := 0; hc bigint; ac bigint;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition %', p_competition; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'clubs', '[]')) loop
    insert into clubs (sport, provider, ext_id, name, short, logo)
    values (c.sport, c.provider, x->>'ext_id', left(x->>'name', 80), nullif(left(x->>'short', 5), ''), nullif(x->>'logo', ''))
    on conflict (sport, provider, ext_id) do update set name = excluded.name,
      short = coalesce(excluded.short, clubs.short), logo = coalesce(excluded.logo, clubs.logo);
    nc := nc + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'fixtures', '[]')) loop
    -- a club the provider names only in the fixture (no clubs list sent) is made from the fixture's own words
    insert into clubs (sport, provider, ext_id, name, logo)
    select c.sport, c.provider, s->>'ext_id', left(coalesce(s->>'name', 'Club ' || (s->>'ext_id')), 80), nullif(s->>'logo', '')
    from (values (x->'home_club'), (x->'away_club')) v(s) where s is not null
    on conflict (sport, provider, ext_id) do nothing;
    select id into hc from clubs where sport = c.sport and provider = c.provider and ext_id = coalesce(x->>'home', x->'home_club'->>'ext_id');
    select id into ac from clubs where sport = c.sport and provider = c.provider and ext_id = coalesce(x->>'away', x->'away_club'->>'ext_id');
    if hc is null or ac is null then raise exception 'Fixture % names a club we do not have', x->>'ext_id'; end if;
    insert into fixtures (sport, competition, provider, ext_id, season, round, gameweek, kickoff, date, home_club, away_club,
      state, status, minute, home_score, away_score, home_ft, away_ft, home_pens, away_pens, venue, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', coalesce(x->>'season', c.season), x->>'round', nullif(x->>'gameweek', '')::int,
      (x->>'kickoff')::timestamptz, ((x->>'kickoff')::timestamptz at time zone c.tz)::date, hc, ac,
      _sport_state(c.sport, x->>'status'), x->>'status', nullif(x->>'minute', '')::int,
      nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(x->>'home_ft', '')::int, nullif(x->>'away_ft', '')::int,
      nullif(x->>'home_pens', '')::int, nullif(x->>'away_pens', '')::int, nullif(left(x->>'venue', 120), ''), now())
    on conflict (provider, ext_id) do update set
      round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, minute = excluded.minute,
      home_score = excluded.home_score, away_score = excluded.away_score, home_ft = excluded.home_ft, away_ft = excluded.away_ft,
      home_pens = excluded.home_pens, away_pens = excluded.away_pens, venue = coalesce(excluded.venue, fixtures.venue), updated_at = now();
    nf := nf + 1;
  end loop;
  return jsonb_build_object('clubs', nc, 'fixtures', nf);
end $$;
revoke execute on function public.soccer_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.soccer_ingest(text, jsonb) to service_role;

-- the live pull is due while a match is on or about to start (the scheduler asks every two minutes)
create or replace function public._soccer_due() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fixtures where state in ('scheduled', 'live')
                 and kickoff between now() - interval '4 hours' and now() + interval '5 minutes')
$$;
revoke execute on function public._soccer_due() from public, anon, authenticated;

-- ───────────── pool questions that follow a fixture ─────────────
alter table public.pool_markets add column if not exists source jsonb;   -- {fixture, kind: 'result'}
create unique index if not exists pool_markets_fixture on public.pool_markets (league_id, ((source->>'fixture')::bigint), (source->>'kind'))
  where source is not null and status <> 'void';

-- the paying out (or voiding) of a question, shared by the host's pool_resolve and the scheduler's results
create or replace function public._pool_settle(p_market bigint, p_winner text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m pool_markets; r record; lbl text;
begin
  select * into m from pool_markets where id = p_market for update;
  if m.id is null then raise exception 'No such question'; end if;
  if m.status = 'void' then raise exception 'That question was voided'; end if;
  if m.status = 'resolved' and p_winner is not null then raise exception 'It is settled; void it to start over'; end if;
  if p_winner is not null and not (m.q ? p_winner) then raise exception 'Pick one of the answers, or void it'; end if;
  if p_winner is null then
    -- take back what a resolution paid, then refund what each member still had in
    for r in select team_id, sum(paid) paid, sum(cost) cost from pool_positions where market_id = p_market group by team_id loop
      if r.paid > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, -r.paid, format('Taken back (voided): %s', m.title)); end if;
      if r.cost > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, ceil(r.cost)::int, format('Refund (voided): %s', m.title)); end if;
    end loop;
    update pool_positions set paid = 0 where market_id = p_market;
    update pool_markets set status = 'void', winner_key = null, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('🔮 Voided: "%s"; every stake refunded%s', m.title, coalesce(' · ' || nullif(btrim(p_note), ''), '')), jsonb_build_object('pool_market', p_market), m.league_id);
    return;
  end if;
  lbl := _pool_label(m, p_winner);
  for r in select team_id, shares from pool_positions where market_id = p_market and outcome = p_winner and floor(shares) > 0 loop
    insert into coin_ledger (team_id, amount, reason) values (r.team_id, floor(r.shares)::int, format('Paid: %s · %s', m.title, lbl));
    update pool_positions set paid = floor(r.shares)::int where market_id = p_market and team_id = r.team_id and outcome = p_winner;
  end loop;
  update pool_markets set status = 'resolved', winner_key = p_winner, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('✅ Settled: "%s" → %s%s', m.title, lbl, coalesce(' · ' || nullif(btrim(p_note), ''), '')), jsonb_build_object('pool_market', p_market), m.league_id);
end $$;
revoke execute on function public._pool_settle(bigint, text, text) from public, anon, authenticated;

-- p_winner: an answer's key pays one coin a share; null voids it and refunds every stake. A resolved question can be
-- voided later (the payouts are taken back, then the stakes refunded); a void one stays void.
create or replace function public.pool_resolve(p_market bigint, p_winner text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _in_league('pool_markets', p_market);
  perform _commish();
  perform _pool_settle(p_market, p_winner, p_note);
end $$;

-- a fixture's question in a league: who wins after ninety minutes, the draw in the middle; closes at kick-off
create or replace function public._pool_fixture_market(p_league int, p_fixture bigint, p_by int) returns bigint
language plpgsql security definer set search_path = public as $$
declare f fixtures; c competitions; h clubs; a clubs; mid bigint;
begin
  select * into f from fixtures where id = p_fixture;
  select * into c from competitions where id = f.competition;
  select * into h from clubs where id = f.home_club;
  select * into a from clubs where id = f.away_club;
  if exists (select 1 from pool_markets where league_id = p_league and status <> 'void' and source->>'kind' = 'result'
             and (source->>'fixture')::bigint = p_fixture) then
    return null;
  end if;
  mid := _pool_insert_market(p_league, jsonb_build_object(
    'title', format('%s v %s', h.name, a.name),
    'rule', format('The result after ninety minutes and stoppage time (%s, %s). Extra time and penalties don''t count. '
      'Postponed or abandoned: voided, every stake refunded.', c.name, coalesce(f.round, 'the season')),
    'category', c.short || coalesce(' · Matchweek ' || f.gameweek, ''),
    'outcomes', jsonb_build_array(h.name, 'Draw', a.name),
    'closes_at', f.kickoff,
    'sort', 100 + coalesce(f.gameweek, 0)), p_by, null);
  update pool_markets set source = jsonb_build_object('fixture', p_fixture, 'kind', 'result') where id = mid;
  return mid;
end $$;
revoke execute on function public._pool_fixture_market(int, bigint, int) from public, anon, authenticated;

-- the host adds a gameweek's matches (the next one with matches still to play, unless p_gameweek says which)
create or replace function public.pool_add_fixtures(p_competition text, p_gameweek int default null) returns int
language plpgsql security definer set search_path = public as $$
declare gw int; n int := 0; f record; c competitions;
begin
  perform _commish();
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition'; end if;
  gw := coalesce(p_gameweek, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled'
                                and kickoff > now() + interval '10 minutes'));
  if gw is null then raise exception 'No % matches to add yet', c.name; end if;
  for f in select id from fixtures where competition = p_competition and gameweek = gw and state = 'scheduled'
             and kickoff > now() + interval '10 minutes' order by kickoff loop
    if _pool_fixture_market(current_league_id(), f.id, my_team()) is not null then n := n + 1; end if;
  end loop;
  if n > 0 then
    perform _sys('general', format('⚽ %s, matchweek %s: %s %s to call, each closing at kick-off', c.name, gw, n,
      case when n = 1 then 'match' else 'matches' end), jsonb_build_object('pool_fixtures', p_competition, 'gameweek', gw));
  end if;
  return n;
end $$;

-- what the host can add: each active competition's next gameweek
create or replace function public.soccer_rounds() returns table (competition text, name text, short text, gameweek int,
  first_kickoff timestamptz, matches int, added int)
language sql stable security definer set search_path = public as $$
  with nxt as (
    select f.competition, min(f.gameweek) gw from fixtures f
    where f.state = 'scheduled' and f.kickoff > now() + interval '10 minutes' group by f.competition)
  select c.id, c.name, c.short, n.gw, min(f.kickoff), count(*)::int,
    count(*) filter (where exists (select 1 from pool_markets m where m.league_id = current_league_id() and m.status <> 'void'
                                    and (m.source->>'fixture')::bigint = f.id))::int
  from competitions c join nxt n on n.competition = c.id
  join fixtures f on f.competition = c.id and f.gameweek = n.gw and f.state = 'scheduled' and f.kickoff > now() + interval '10 minutes'
  where c.active
  group by c.id, c.name, c.short, n.gw, c.sort order by c.sort
$$;

-- the scheduler's results pass, one league at a time: a final settles from the ninety-minute score; a postponed or
-- abandoned match voids the question
create or replace function public.run_pool_settle() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; hs int; aws int; w text;
begin
  for r in select m.id, m.outcomes, f.state, f.home_ft, f.away_ft, f.home_score, f.away_score, h.name hn, a.name an
           from pool_markets m join fixtures f on f.id = (m.source->>'fixture')::bigint
           join clubs h on h.id = f.home_club join clubs a on a.id = f.away_club
           where m.league_id = current_league_id() and m.status = 'open' and m.source->>'kind' = 'result'
             and f.state in ('final', 'postponed', 'cancelled') loop
    if r.state = 'final' then
      hs := coalesce(r.home_ft, r.home_score); aws := coalesce(r.away_ft, r.away_score);
      if hs is null or aws is null then continue; end if;
      w := case when hs > aws then 'a1' when hs = aws then 'a2' else 'a3' end;
      perform _pool_settle(r.id, w, format('Full time: %s %s-%s %s', r.hn, hs, aws, r.an));
    else
      perform _pool_settle(r.id, null, case when r.state = 'postponed' then 'The match was postponed' else 'The match was called off' end);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.run_pool_settle() from public, anon, authenticated;

create or replace function public._pool_settle_due() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pool_markets m join fixtures f on f.id = (m.source->>'fixture')::bigint
                 where m.status = 'open' and m.source->>'kind' = 'result' and f.state in ('final', 'postponed', 'cancelled'))
$$;
revoke execute on function public._pool_settle_due() from public, anon, authenticated;

-- the job runner learns 'pool-settle', which runs in every kind of league (SaK can ask soccer questions too)
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions', 'h2h-notes', 'pool-drops', 'pool-settle') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' and (p_job in ('pool-drops', 'pool-settle') or kind = 'fantasy') order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
      r := case p_job
        when 'open-book' then to_jsonb(open_markets())
        when 'open-book-season' then jsonb_build_array(open_season_markets(), open_nhl_markets(), reprice_season_markets())
        when 'settle-book' then settle_markets()
        when 'settle-book-season' then jsonb_build_array(settle_season_markets(), settle_race_markets())
        when 'settle-bets' then settle_due_bets()
        when 'predict' then to_jsonb(predict_tonight())
        when 'score-predictions' then to_jsonb(score_predictions())
        when 'h2h-notes' then to_jsonb(h2h_week_notes())
        when 'pool-drops' then to_jsonb(run_pool_drops())
        when 'pool-settle' then to_jsonb(run_pool_settle())
      end;
      out := out || jsonb_build_object(lid::text, r);
    exception when others then
      raise warning 'run_league_jobs % league %: %', p_job, lid, sqlerrm;
      out := out || jsonb_build_object(lid::text, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return out;
end $$;

grant execute on function public.pool_add_fixtures(text, int), public.soccer_rounds() to authenticated;
revoke execute on function public.pool_add_fixtures(text, int), public.soccer_rounds() from anon;
