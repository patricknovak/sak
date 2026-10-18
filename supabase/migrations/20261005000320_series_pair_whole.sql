-- A series' clubs never go half-way backwards (18 October 2026, the World Series audit). The feed files a series by Game
-- 1's home and away teams and kept each stored club where the new one was missing. With the World Series filed as
-- Milwaukee at home and the American League champion to be decided, a schedule that moved Milwaukee to the road before
-- the champion was known would have read high = Milwaukee (kept) and low = Milwaukee (new): the same club on both sides,
-- series picks opening on it and a squares grid filling its other side with it. Now a listing with both clubs replaces
-- the pair; a listing with one or none keeps the stored pair whole, unless nothing is stored yet. Safe to run twice.

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
      best_of = excluded.best_of, -- a listing with both clubs replaces the pair; one with a club missing keeps the stored pair whole (migration 320)
      high_club = case when excluded.high_club is not null and excluded.low_club is not null then excluded.high_club
                       when series.high_club is null and series.low_club is null then excluded.high_club else series.high_club end,
      low_club = case when excluded.high_club is not null and excluded.low_club is not null then excluded.low_club
                      when series.high_club is null and series.low_club is null then excluded.low_club else series.low_club end,
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
    values (c.sport, c.id, c.provider, x->>'ext_id', c.season, x->>'round',
      -- a single-game series' game carries its round, so last one standing can run on the tournament (migration 212)
      coalesce(nullif(x->>'gameweek', '')::int, (select z.round from series z where z.id = sid and z.best_of = 1)),
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
  -- a pool game's settlement never stops the feed: a failure is a warning, and the next run tries again
  begin perform _squares_tick(c.id); exception when others then raise warning 'squares on %: %', c.id, sqlerrm; end;
  -- and the prop sheets on its games (migration 208)
  begin perform _props_tick(c.id); exception when others then raise warning 'prop sheets on %: %', c.id, sqlerrm; end;
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;
