-- The Eliminator (docs/POOL-TYPES.md §9 item 4): last one standing on a tournament of single games (March Madness, the
-- NFL's playoffs as series): one team to win each round, each team once, a loss and you're out. In such a tournament each
-- series is one game, so the game carries its round (`fixtures.gameweek`, set by `sport_ingest` and filled in here for the
-- games already in), and the survivor runs on it as on any competition played in rounds. It runs to the tournament's last
-- round, whose games come in as their matchups are set. The start page offers it on a single-game tournament with a
-- game still to start in its next round.

-- the games already in carry their round
update public.fixtures f set gameweek = s.round from public.series s
where s.id = f.series_id and s.best_of = 1 and f.gameweek is null;

create or replace function public._survivor_create(p_competition text, p_start_gw int, p_end_gw int) returns bigint
language plpgsql security definer set search_path = public as $$
declare c competitions; sid bigint; gw int; last_gw int; end_gw int; w text; club text; draws boolean;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition'; end if;
  -- a tournament of single games (March Madness, the NFL's playoffs) is played in rounds too: each game carries its round
  if exists (select 1 from series where competition = p_competition and best_of > 1) then raise exception 'Last one standing runs on rounds of single games'; end if;
  if exists (select 1 from pool_survivors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a survivor running'; end if;
  w := _round_word(p_competition);
  club := _sport_word(p_competition, 'club', 'club');
  draws := coalesce((select (s.config->>'draws')::boolean from sports s where s.id = c.sport), true);
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No % to start from yet', lower(w); end if;
  -- a round with nothing left to kick off can't be picked, so it can't be the first
  if not exists (select 1 from fixtures where competition = p_competition and gameweek = gw and state = 'scheduled' and kickoff > now()) then
    raise exception 'That % is under way; start from the next one', lower(w);
  end if;
  -- a tournament's later rounds have no games until their matchups are set, so it runs to its last round
  last_gw := coalesce((select max(round) from series where competition = p_competition), (select max(gameweek) from fixtures where competition = p_competition));
  end_gw := coalesce(p_end_gw, last_gw);
  if end_gw < gw or end_gw > last_gw then raise exception 'No such %', lower(w); end if;
  insert into pool_games (kind, competition, title, rules, created_by)
  values ('survivor', p_competition, 'Last one standing', jsonb_build_object('start_gw', gw, 'end_gw', end_gw), my_team()) returning id into sid;
  perform _sys('general', format('🛡️ Last one standing starts in %s %s of the %s: pick one %s to win each %s, never the same %s twice. %s and you''re out.%s',
    lower(w), gw, c.name, club, lower(w), club, case when draws then 'A draw or a loss' else 'A loss or a tie' end,
    case when end_gw > gw then format(' It runs to %s %s; whoever is still in then shares it.', lower(w), end_gw) else '' end),
    jsonb_build_object('survivor', sid));
  return sid;
end $$;
revoke execute on function public._survivor_create(text, int, int) from public, anon, authenticated;


create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    -- an event played in series offers the bracket where its rounds make one from the next round
    -- and the Stanley Cup playoffs, before the first round with every club in it, the box pool
    select jsonb_set(e || jsonb_build_object('sheets', _props_games(e->>'competition')), '{kinds}', coalesce(e->'kinds', '[]')
             || case when e ? 'open_round' and _bracket_ok(e->>'competition', (e->>'open_round')::int) then '["bracket"]'::jsonb else '[]'::jsonb end
             || case when e->>'sport' = 'nhl' and (e->>'open_round')::int = 1
                       and not exists (select 1 from series s where s.competition = e->>'competition' and s.round = 1 and (s.high_club is null or s.low_club is null))
                     then '["players"]'::jsonb else '[]'::jsonb end
             -- the prop sheet, on its games still to start
             || case when jsonb_array_length(_props_games(e->>'competition')) > 0 then '["props"]'::jsonb else '[]'::jsonb end
             -- the Eliminator: last one standing on a tournament of single games
             || case when not exists (select 1 from series s where s.competition = e->>'competition' and s.best_of > 1)
                      and exists (select 1 from fixtures f where f.competition = e->>'competition' and f.gameweek = (e->>'open_round')::int
                                  and f.state = 'scheduled' and f.kickoff > now())
                     then '["survivor"]'::jsonb else '[]'::jsonb end) e
    from jsonb_array_elements(pool_events()) e
    union all
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack,
      'stage', format('%s %s %s', w.w, r.open_round,
               case when exists (select 1 from fixtures f where f.competition = c.id and f.gameweek = r.open_round and (f.state <> 'scheduled' or f.kickoff <= now()))
                    then 'under way' else 'next' end),
      'open_round', r.open_round, 'open_label', format('%s %s', w.w, r.open_round),
      'next_lock', (select min(kickoff) from fixtures f where f.competition = c.id and f.gameweek = r.open_round and f.state = 'scheduled' and f.kickoff > now()),
      'final_round', r.last_round, 'final_label', format('%s %s', w.w, r.last_round),
      'final_starts', (select min(kickoff) from fixtures f where f.competition = c.id and f.gameweek = r.last_round),
      'word', w.w, 'club_word', _sport_word(c.id, 'club', 'club'), 'kinds', '["pickem", "survivor"]'::jsonb, 'grids', '[]'::jsonb)
    from competitions c cross join lateral _pickem_rounds(c.id) r cross join lateral (select _round_word(c.id) w) w
    where c.active and r.open_round is not null and not exists (select 1 from series s where s.competition = c.id)
    union all
    -- the NHL season: a box pool from the next night with games
    select jsonb_build_object('competition', c.id, 'sport', c.sport, 'name', c.name, 'pack', c.pack, 'stage', 'Regular season',
      'open_round', 0, 'open_label', to_char(n.d, 'FMDay FMMonth FMDD'), 'word', 'From',
      'next_lock', (select min(start_utc) from games where game_type = 2 and date = n.d),
      'final_round', 0, 'final_label', to_char((select max(date) from games where game_type = 2), 'FMMonth FMDD'), 'final_starts', null,
      'club_word', 'team', 'kinds', '["players"]'::jsonb, 'grids', '[]'::jsonb)
    from competitions c cross join lateral (select _box_next_night() d) n
    where c.active and c.format = 'players' and c.sport = 'nhl' and n.d is not null) z
$$;
revoke execute on function public.pool_event_list() from public;
grant execute on function public.pool_event_list() to anon, authenticated;


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
  perform _squares_tick(c.id);
  -- and the prop sheets on its games (migration 208)
  perform _props_tick(c.id);
  return jsonb_build_object('clubs', nc, 'series', ns, 'fixtures', nf);
end $$;
revoke execute on function public.sport_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sport_ingest(text, jsonb) to service_role;


-- a tournament's rounds are rounds, whatever its sport calls a regular season's (the NFL's playoffs aren't weeks)
create or replace function public._round_word(p_competition text) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from series where competition = p_competition) then 'Round'
    else coalesce((select s.config->'words'->>'round' from competitions c join sports s on s.id = c.sport where c.id = p_competition), 'Round') end
$$;
revoke execute on function public._round_word(text) from public, anon, authenticated;
