-- The market beside the crowd (docs/DEVELOPMENT.md §6 item 5): ESPN's scoreboard carries the bookmakers' lines before
-- kick-off, so soccer-sync now sends what the market expected with each match (each side's chance with the margin taken
-- out, the home side's spread and the total; never a bookmaker's name or link, and nothing to bet on), and the match
-- keeps it as it stood at kick-off (`fixtures.detail.odds`, the closing line).
--
-- * The pool's split forecast (migration 174) records what the market gave the pool's favourite, and
--   `crowd_calibration()` reads it beside the crowd: when 70% of a pool agreed, the market said what, and who was right
--   more often?
-- * The centres show the market's view on each match before it starts.

-- the feed's matches, with the market's view before kick-off
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
      state, status, minute, home_score, away_score, home_ft, away_ft, home_pens, away_pens, venue, detail, updated_at)
    values (c.sport, c.id, c.provider, x->>'ext_id', coalesce(x->>'season', c.season), x->>'round', nullif(x->>'gameweek', '')::int,
      (x->>'kickoff')::timestamptz, ((x->>'kickoff')::timestamptz at time zone c.tz)::date, hc, ac,
      _sport_state(c.sport, x->>'status'), x->>'status', nullif(x->>'minute', '')::int,
      nullif(x->>'home_score', '')::int, nullif(x->>'away_score', '')::int, nullif(x->>'home_ft', '')::int, nullif(x->>'away_ft', '')::int,
      nullif(x->>'home_pens', '')::int, nullif(x->>'away_pens', '')::int, nullif(left(x->>'venue', 120), ''),
      case when jsonb_typeof(x->'odds') = 'object' then jsonb_build_object('odds', x->'odds') end, now())
    on conflict (provider, ext_id) do update set
      round = coalesce(excluded.round, fixtures.round), gameweek = coalesce(excluded.gameweek, fixtures.gameweek),
      kickoff = excluded.kickoff, date = excluded.date, home_club = excluded.home_club, away_club = excluded.away_club,
      state = excluded.state, status = excluded.status, minute = excluded.minute,
      home_score = excluded.home_score, away_score = excluded.away_score, home_ft = excluded.home_ft, away_ft = excluded.away_ft,
      home_pens = excluded.home_pens, away_pens = excluded.away_pens, venue = coalesce(excluded.venue, fixtures.venue),
      -- the market's view is kept as it stood at kick-off (the closing line): no update once the match is under way
      detail = case when excluded.detail is null or fixtures.state <> 'scheduled' or excluded.state <> 'scheduled' then fixtures.detail
                    else coalesce(fixtures.detail, '{}') || excluded.detail end,
      updated_at = now();
    nf := nf + 1;
  end loop;
  return jsonb_build_object('clubs', nc, 'fixtures', nf);
end $$;
revoke execute on function public.soccer_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.soccer_ingest(text, jsonb) to service_role;

-- the split on one match for one pool game, with the market's chance for the favourite
create or replace function public._pool_split_write(p_game bigint, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g pool_games; f fixtures; h int; d int; a int; n int; top int; fav text;
begin
  select * into g from pool_games where id = p_game and kind = 'pickem';
  select * into f from fixtures where id = p_fixture;
  if g.id is null or f.id is null or f.competition <> g.competition
     or f.gameweek not between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int then return; end if;
  select count(*) filter (where pick->>'pick' = 'H'), count(*) filter (where pick->>'pick' = 'D'), count(*) filter (where pick->>'pick' = 'A')
    into h, d, a from pool_picks where game_id = g.id and thing = 'f:' || f.id;
  n := h + d + a;
  top := greatest(h, d, a);
  if n < 3 or (h = top)::int + (d = top)::int + (a = top)::int > 1 then return; end if;
  fav := case when h = top then 'H' when a = top then 'A' else 'D' end;
  insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, detail)
  values (g.league_id, 'pool_split', jsonb_build_object('game', g.id, 'fixture', f.id), round(top::numeric / n, 3), f.sport,
    least(f.kickoff, now()), f.date,
    jsonb_build_object('fav', fav, 'H', h, 'D', d, 'A', a, 'picks', n, 'competition', f.competition, 'round', f.gameweek,
      -- what the market gave the pool's favourite at kick-off, when the feed carries it
      'market', case fav when 'H' then f.detail->'odds'->'home' when 'A' then f.detail->'odds'->'away' else f.detail->'odds'->'draw' end))
  on conflict (league_id, kind, subject) do nothing;
end $$;
revoke execute on function public._pool_split_write(bigint, bigint) from public, anon, authenticated;

-- how good the crowd is, beside the market: by sport and by the favourite's share (tenths), how often the favourite was
-- right, and what the market gave it where the feed carried a line. A pool's members see their pool; a platform admin
-- sees every pool
drop function if exists public.crowd_calibration();
create or replace function public.crowd_calibration()
returns table (sport text, bucket numeric, n int, said numeric, right_share numeric, pools int, market numeric, priced int)
language sql stable security definer set search_path = public as $$
  select basis, least(floor(predicted * 10) / 10, 0.9), count(*)::int, round(avg(predicted), 3), round(avg(outcome), 3), count(distinct league_id)::int,
    round(avg((detail->>'market')::numeric), 3), count(detail->>'market')::int
  from predictions
  where kind = 'pool_split' and status = 'scored' and (is_platform_admin() or league_id = current_league_id())
  group by 1, 2 order by 1, 2
$$;
revoke execute on function public.crowd_calibration() from public, anon;
grant execute on function public.crowd_calibration() to authenticated;
