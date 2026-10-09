-- A postseason game by hand (docs/DEVELOPMENT.md §6 item 3, "settling a series or a grid by hand"): when the feed stalls
-- or reports a game wrong, a platform admin sets its score and state from the Platform page, and everything that reads
-- the series follows as if the feed had sent it (each series' wins and winner, Pick the series, Rank the teams, the
-- bracket, the news, and the squares' draw and pays). A series is shared by every pool on it, so the fix is the
-- platform's, on the shared tables, rather than one pool's.
-- * `platform_game_fix(fixture, home, away, state, periods, reason)` writes the game and marks it by hand
--   (`fixtures.detail.by_hand`: when, who, why); the feed leaves a game marked by hand alone until it is handed back.
-- * `platform_game_fix(fixture, null, null, null, ...)` hands it back: the mark goes and the feed's next run writes it.
-- * `sport_ingest` skips a game marked by hand, and otherwise works as before.

create or replace function public.platform_game_fix(p_fixture bigint, p_home int, p_away int, p_state text default 'final',
  p_periods jsonb default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fixtures; y jsonb; np int := 0;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  select * into f from fixtures where id = p_fixture for update;
  if f.id is null or f.series_id is null then raise exception 'That isn''t a game of a series'; end if;
  if p_home is null and p_away is null and p_state is null then
    update fixtures set detail = detail - 'by_hand', updated_at = now() where id = f.id;
    return jsonb_build_object('handed_back', true);
  end if;
  if p_state not in ('scheduled', 'live', 'final', 'postponed', 'cancelled') then raise exception 'A game is scheduled, live, final, postponed or cancelled'; end if;
  if p_state in ('live', 'final') and (p_home is null or p_away is null) then raise exception 'Give both sides a score'; end if;
  if p_home not between 0 and 300 or p_away not between 0 and 300 then raise exception 'A score is 0 to 300'; end if;
  if p_state = 'final' and p_home = p_away and (select sport from competitions where id = f.competition) <> 'soccer' then
    raise exception 'A playoff game has a winner';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, for the record'; end if;
  update fixtures set home_score = p_home, away_score = p_away, state = p_state, updated_at = now(),
    detail = coalesce(detail, '{}') || jsonb_build_object('by_hand', jsonb_build_object('at', now(), 'by', auth.uid(), 'reason', left(trim(p_reason), 200)))
  where id = f.id;
  -- the score by period, when given (squares pay from it)
  if jsonb_typeof(p_periods) = 'array' then
    for y in select * from jsonb_array_elements(p_periods) loop
      insert into fixture_periods (fixture_id, n, home, away) values (f.id, (y->>'n')::int, nullif(y->>'home', '')::int, nullif(y->>'away', '')::int)
      on conflict (fixture_id, n) do update set home = excluded.home, away = excluded.away;
      np := np + 1;
    end loop;
  end if;
  -- the series, the pools on it and the squares follow, as after a feed run
  perform sport_ingest(f.competition, '{}'::jsonb);
  return jsonb_build_object('fixture', f.id, 'state', p_state, 'periods', np);
end $$;
revoke execute on function public.platform_game_fix(bigint, int, int, text, jsonb, text) from public, anon;
grant execute on function public.platform_game_fix(bigint, int, int, text, jsonb, text) to authenticated;

-- the feed: a game set by hand is skipped
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
    fid := null;
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
    -- a game set by hand stays as set until it is handed back (migration 206)
    where not coalesce(fixtures.detail ? 'by_hand', false)
    returning id into fid;
    if fid is null then continue; end if;
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
  -- the squares on this event: draw at the first pitch, pay what the innings say
  perform _squares_tick(c.id);
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;


