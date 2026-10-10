-- A pool keeps to its own events, a host can delete a pool, and every kind of pool and league starts from one place.
--
-- * pool_competitions(): the events this pool plays on (its games, its automatic prop sheets, the event its question
--   pack rides with). The site reads it to keep a pool's pages to its own events: the centres' switcher, the host's
--   desk, the Call the score and Last one standing starters. Nothing else in a pool has a sport of its own.
-- * Call the score from the start: the three-step start (#/new) and the host's desk offer it on soccer's rounds like
--   the other kinds (pool_event_list), and pool_start_games / pool_game_start start it (predictor_start).
-- * pool_delete(league, name): the host deletes a prediction pool, everything in it, typing its name to be sure. A
--   fantasy league goes only while it is still being set up and only by the one who started it; the platform can
--   delete any but the SaK Superleague. The requests that opened a league keep their history (their link is cleared).
-- * fantasy_start(...): anyone in a pool starts a fantasy league of their own: its name and colour, how many teams,
--   season total or head-to-head (and the playoffs), points or categories, keepers and the draft. It opens in setup,
--   with its starter in the commissioner's seat and the rest of the seats open for invites, on SaK's NHL rules
--   otherwise; commish_go_live() takes it live once the checklist is ticked.
--
-- Safe to run twice.

set client_min_messages = warning;

-- ───────────── the pool's own events ─────────────
create or replace function public.pool_competitions()
returns table (id text, name text, short text, sport text, format text, ext_id text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.short, c.sport, c.format, c.ext_id
  from competitions c
  where c.id in (
    select g.competition from pool_games g where g.league_id = current_league_id() and g.competition is not null
    union select a.competition from pool_auto_sheets a where a.league_id = current_league_id()
    union select c2.id from competitions c2 join pool_markets m on m.pack = c2.pack
          where m.league_id = current_league_id() and c2.pack is not null)
  order by c.sort, c.id
$$;
revoke execute on function public.pool_competitions() from public, anon;
grant execute on function public.pool_competitions() to authenticated;

-- ───────────── Call the score with the other kinds ─────────────
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
                     then '["survivor"]'::jsonb else '[]'::jsonb end
             -- the daily streak, while a game is still to come (migration 231)
             || case when _streak_open(e->>'competition') then '["streak"]'::jsonb else '[]'::jsonb end
             -- the sweepstake, while its round's matchups are set and not started (migration 236)
             || case when e ? 'open_round' and _sweep_ok(e->>'competition', (e->>'open_round')::int) then '["sweep"]'::jsonb else '[]'::jsonb end) e
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
      'word', w.w, 'club_word', _sport_word(c.id, 'club', 'club'),
      -- an NFL week's games take a prop sheet too (migration 216); soccer's rounds take Call the score (a score line
      -- is soccer's game: an NFL score is a guess at two numbers in the twenties)
      'kinds', '["pickem", "survivor"]'::jsonb
               || case when c.sport = 'soccer' then '["score"]'::jsonb else '[]'::jsonb end
               || case when jsonb_array_length(_props_games(c.id)) > 0 then '["props"]'::jsonb else '[]'::jsonb end
               || case when _streak_open(c.id) then '["streak"]'::jsonb else '[]'::jsonb end,
      -- and a grid of squares (migration 217), kept apart from the series grids so a copy of the site from before
      -- never offers one as a series
      'grids', '[]'::jsonb, 'sheets', _props_games(c.id), 'game_grids', case when c.sport = 'nfl' then _props_games(c.id) else '[]'::jsonb end)
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

create or replace function public.pool_game_start(p_kind text, p_competition text, p_rules jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_kind = 'survivor' then
    return _survivor_create(p_competition, (p_rules->>'from_round')::int, (p_rules->>'to_round')::int);
  end if;
  if p_kind = 'score' then return predictor_start(p_competition, (p_rules->>'from_round')::int); end if;
  return _pool_game_create(p_kind, p_competition, p_rules);
end $$;
revoke execute on function public.pool_game_start(text, text, jsonb) from public, anon;
grant execute on function public.pool_game_start(text, text, jsonb) to authenticated;

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
    ids := ids || case
      when x->>'kind' = 'survivor' then _survivor_create(x->>'competition', (x->'rules'->>'from_round')::int, (x->'rules'->>'to_round')::int)
      when x->>'kind' = 'score' then predictor_start(x->>'competition', (x->'rules'->>'from_round')::int)
      else _pool_game_create(x->>'kind', x->>'competition', (x->'rules') - 'auto'::text) end;
    -- a sheet on every game of the event from here on, the ones due now opened at once
    if x->>'kind' = 'props' and coalesce((x->'rules'->>'auto')::boolean, false) then
      insert into pool_auto_sheets (competition, by_team)
      values (x->>'competition', (select id from teams where league_id = p_league and user_id = auth.uid() and is_commish limit 1)) on conflict do nothing;
      perform _props_auto(p_league);
    end if;
  end loop;
  return to_jsonb(ids);
end $$;
revoke execute on function public.pool_start_games(int, jsonb) from public, anon;
grant execute on function public.pool_start_games(int, jsonb) to authenticated;

-- ───────────── deleting a pool ─────────────
-- Every table holding the league's rows (any with a league_id), cleared in as many passes as the foreign keys between
-- them need (a pick before its game, a team's ledger before the team), then the league itself. One transaction: if
-- anything can't go, nothing goes.
create or replace function public.pool_delete(p_league int, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, ops as $$
declare l leagues; t record; n int; total int := 0; stuck text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into l from leagues where id = p_league;
  if l.id is null then raise exception 'No such pool'; end if;
  if p_league = 1 then raise exception 'The SaK Superleague stays as it is'; end if;
  if not (is_platform_admin()
          or (l.kind = 'predict' and (l.owner_user = auth.uid()
              or exists (select 1 from teams where league_id = p_league and user_id = auth.uid() and is_commish)))
          or (l.kind is distinct from 'predict' and l.status = 'setup' and l.owner_user = auth.uid())) then
    raise exception '%', case when l.kind = 'predict' then 'Only the pool''s host can delete it'
      else 'Only the person who started the league can delete it, and only before it goes live' end;
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(l.name)) then raise exception 'Type the name exactly to delete it'; end if;

  update ops.league_requests set league_id = null where league_id = p_league;
  -- anyone whose site opens on it moves to another of their pools (or none)
  update accounts a set active_league_id = (select m.league_id from league_members m
    where m.user_id = a.user_id and m.league_id <> p_league order by m.joined_at desc nulls last limit 1), updated_at = now()
  where a.active_league_id = p_league;

  for i in 1..15 loop
    stuck := '{}';
    for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped
             where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'leagues' order by c.relname loop
      begin
        execute format('delete from public.%I where league_id = $1', t.relname) using p_league;
        get diagnostics n = row_count;
        total := total + n;
      exception when foreign_key_violation then stuck := stuck || t.relname::text;
      end;
    end loop;
    exit when cardinality(stuck) = 0;
  end loop;
  if cardinality(stuck) > 0 then raise exception 'Could not clear %', array_to_string(stuck, ', '); end if;
  delete from leagues where id = p_league;
  return jsonb_build_object('deleted', p_league, 'name', l.name, 'rows', total);
end $$;
revoke execute on function public.pool_delete(int, text) from public, anon;
grant execute on function public.pool_delete(int, text) to authenticated;

-- ───────────── a fantasy league, self-serve ─────────────
create or replace function public.fantasy_start(p_name text, p_color text default null, p_seats int default 8, p_format text default 'season',
  p_categories text[] default null, p_keepers int default 0, p_playoffs int default 0, p_snake boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  col text := lower(coalesce(nullif(btrim(p_color), ''), '#f7c548')); ws text; short text; words text[]; br jsonb;
  nid int; tid int; who text; em text; season text; coin text; k int; cats text[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not (is_platform_admin() or exists (select 1 from league_members where user_id = me)) then raise exception 'Join a pool first; then you can start your own'; end if;
  if length(nm) < 3 then raise exception 'Give the league a name (3 to 40 characters)'; end if;
  if col !~ '^#[0-9a-f]{6}$' then raise exception 'Pick one of the colours'; end if;
  if coalesce(p_seats, 0) not between 4 and 20 then raise exception 'A league takes 4 to 20 teams'; end if;
  if p_format not in ('season', 'h2h') then raise exception 'A league plays the season total or head-to-head'; end if;
  if coalesce(p_keepers, 0) not between 0 and 15 then raise exception 'Keep 0 to 15 players a team'; end if;
  if p_format = 'h2h' and coalesce(p_playoffs, 0) <> 0 and (p_playoffs not between 2 and 16 or p_playoffs > p_seats) then
    raise exception 'The playoffs take 2 to 16 teams (no more than the league has), or none';
  end if;
  if p_categories is not null and cardinality(p_categories) > 0 then
    cats := (select array_agg(c->>'key' order by o) from jsonb_array_elements(_category_catalogue()) with ordinality x(c, o) where c->>'key' = any (p_categories));
    if coalesce(cardinality(cats), 0) <> (select count(distinct k2) from unnest(p_categories) k2) then raise exception 'Pick categories from the list'; end if;
    if cardinality(cats) not between 3 and 12 then raise exception 'A category league plays 3 to 12 categories'; end if;
  end if;
  if (select count(*) from leagues where owner_user = me and kind is distinct from 'predict' and created_at > now() - interval '1 day') >= 2 and not is_platform_admin() then
    raise exception 'That''s two leagues today. Try again tomorrow';
  end if;
  if (select count(*) from leagues where owner_user = me and kind is distinct from 'predict' and status = 'setup') >= 5 and not is_platform_admin() then
    raise exception 'You have five leagues being set up: take one live or delete one first';
  end if;

  ws := _pool_slug(nm);
  words := regexp_split_to_array(upper(nm), '\s+');
  short := left(coalesce(nullif(regexp_replace(array_to_string(array(select left(w, 1) from unnest(words) w), ''), '[^A-Z0-9]', '', 'g'), ''), 'FL'), 4);
  if length(short) < 2 then short := left(regexp_replace(upper(nm), '[^A-Z0-9]', '', 'g'), 3); end if;
  br := jsonb_build_object(
    'wordmark', jsonb_build_object('a', left(words[1], 14), 'b', coalesce(nullif(left(array_to_string(words[2:], ' '), 18), ''), 'LEAGUE')),
    'colors', jsonb_build_object('gold', col), 'coin', jsonb_build_object('name', 'Coins', 'emoji', '🪙'),
    'tagline', 'A Super Pools league', 'trophy', 'The Cup', 'booby', 'The Wooden Spoon');
  insert into leagues (slug, name, short_name, brand, status, sport, owner_user)
  values (ws, nm, short, br, 'setup', 'nhl', me) returning id into nid;
  -- SaK's rules, roster, scoring and calendar, then the choices made at the start
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster,
    scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq,
    season_start, season_end, trade_deadline, playoffs_end)
  select nid, nid, nm, short, r.season, 'predraft', coalesce(p_keepers, 0), coalesce(p_keepers, 0) > 0 and r.top_scorer_rule, r.pick_seconds, r.draft_rounds,
    coalesce(p_snake, true), r.roster, r.scoring, r.trade_review_hours, r.max_acquisitions, r.prize_split, r.playoff_share, r.cup_share, r.playoff_bonus_acq,
    r.season_start, r.season_end, r.trade_deadline, r.playoffs_end
  from league_rules r where r.league_id = 1;
  update league_rules set format = p_format, categories = cats, h2h_playoffs = case when p_format = 'h2h' then coalesce(p_playoffs, 0) else 0 end,
    features = coalesce(features, '{}'::jsonb) - 'money' - 'fund', updated_at = now()
  where league_id = nid;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);

  -- seat 1 is the starter's, as commissioner; the rest wait for invites
  select coalesce(nullif(t.gm_name, 'Open seat'), split_part(u.email, '@', 1)), u.email into who, em
  from auth.users u left join league_members m on m.user_id = u.id left join teams t on t.id = m.team_id
  where u.id = me order by m.joined_at nulls last limit 1;
  season := (select r.season from league_rules r where r.league_id = nid);
  coin := _brand_word('{coin,name}', 'coins', nid);
  for k in 1..p_seats loop
    if k = 1 then
      insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, is_commish, joined_season, auto_lineup, perms)
      values (left(coalesce(who, 'Team 1'), 40), coalesce(nullif(upper(left(regexp_replace(coalesce(who, ''), '[^A-Za-z]', '', 'g'), 3)), ''), 'T01'),
              left(coalesce(who, 'Commissioner'), 40), em, me, nid, col, '👑', 'gm', true, season, false, '{}')
      returning id into tid;
    else
      insert into teams (name, abbrev, gm_name, league_id, role, is_commish, joined_season, auto_lineup, perms)
      values ('Team ' || k, 'T' || lpad(k::text, 2, '0'), 'Open seat', nid, 'gm', false, season, false, '{}')
      returning id into tid;
    end if;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || coin);
  end loop;
  -- head-to-head: the weeks' matchups from the start (the commissioner can make them again on the Commish page)
  if p_format = 'h2h' then
    perform set_config('app.league_id', nid::text, true);
    begin perform commish_make_schedule(coalesce(p_playoffs, 0)); exception when others then null; end;
  end if;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('👑 %s started %s. Invite the GMs from the Commish page, set the draft, and take it live once the checklist is ticked.', coalesce(who, 'The commissioner'), nm),
    jsonb_build_object('fantasy_start', nid), nid);
  insert into accounts (user_id, active_league_id) values (me, nid)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return jsonb_build_object('id', nid, 'slug', ws);
end $$;
revoke execute on function public.fantasy_start(text, text, int, text, text[], int, int, boolean) from public, anon;
grant execute on function public.fantasy_start(text, text, int, text, text[], int, int, boolean) to authenticated;

-- the starter (or the platform) takes a self-started league live once the checklist's required lines are ticked
create or replace function public.commish_go_live() returns text
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); l leagues; missing text;
begin
  perform _commish();
  select * into l from leagues where id = lid;
  if lid = 1 then raise exception 'The SaK Superleague stays as it is'; end if;
  if l.status <> 'setup' then raise exception 'The league is already live'; end if;
  if l.owner_user is distinct from auth.uid() and not is_platform_admin() then raise exception 'Only the person who started the league can take it live'; end if;
  select string_agg(x->>'label', ', ') into missing
  from jsonb_array_elements(league_readiness(lid)) x where (x->>'required')::boolean and not (x->>'ok')::boolean;
  if missing is not null then raise exception 'Not ready to go live: %', missing; end if;
  update leagues set status = 'active', updated_at = now() where id = lid;
  return 'active';
end $$;
revoke execute on function public.commish_go_live() from public, anon;
grant execute on function public.commish_go_live() to authenticated;
