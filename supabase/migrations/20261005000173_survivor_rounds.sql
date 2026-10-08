-- Last one standing on any competition played in rounds (docs/DEVELOPMENT.md §6 item 4, docs/POOL-TYPES.md §3): the
-- survivor game of migration 157 was written for soccer's matchweeks; the NFL's weeks are the game's home ground.
--
-- * Words from the sport: a Week or a Matchweek (`_round_word`), a team or a club, a game or a match, and whether a
--   draw is a thing (an NFL tie puts you out the same as a loss).
-- * An end: a survivor runs to a last round (the host's, or the competition's last known round when it starts: an NFL
--   one started in October runs the regular season, since the playoff weeks aren't drawn yet). When that round is
--   done with more than one still in, they share it. Before, a season that ran out with two left never finished.
-- * The engine's ways in: `pool_game_start('survivor', ...)` and a new pool's games start one like any other kind, and
--   the start page lists it beside pick'em for every competition with rounds (`pool_event_list`, kinds).
-- * The host's desk: `survivor_host_pick` enters this round's pick for a member who asked, under their locks, and tells
--   them; it is on the commissioner's log with `survivor_start`.

alter table public.survivors add column if not exists end_gw int;   -- the last round; null: the competition's last

-- one of the sport's words for a competition ('club', 'match'...), or the fallback
create or replace function public._sport_word(p_competition text, p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select s.config->'words'->>p_key from competitions c join sports s on s.id = c.sport where c.id = p_competition), p_default)
$$;
revoke execute on function public._sport_word(text, text, text) from public, anon, authenticated;

-- soccer plays matches, the NFL plays games
update public.sports set config = jsonb_set(config, '{words,match}', '"match"') where id = 'soccer' and config->'words'->>'match' is null;
update public.sports set config = jsonb_set(config, '{words,match}', '"game"') where id = 'nfl' and config->'words'->>'match' is null;

-- the survivors already running keep the end they had in effect: the competition's last round
update public.survivors s set end_gw = (select max(f.gameweek) from fixtures f where f.competition = s.competition)
where s.end_gw is null and s.status = 'open';

-- the last round a survivor runs to
create or replace function public._survivor_end(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(s.end_gw, (select max(f.gameweek) from fixtures f where f.competition = s.competition)) from survivors s where s.id = p_survivor
$$;
revoke execute on function public._survivor_end(bigint) from public, anon, authenticated;

-- the round now in play: the first from the start whose matches are not all done, up to the last
create or replace function public._survivor_week(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select min(f.gameweek) from fixtures f join survivors s on s.competition = f.competition
  where s.id = p_survivor and f.gameweek between s.start_gw and _survivor_end(p_survivor) and f.state not in ('final', 'postponed', 'cancelled')
$$;

-- still in: no pick that put them out, and a pick in every round already played (someone who joined the pool after it
-- started missed those, so the next one is theirs)
create or replace function public._survivor_alive(p_survivor bigint, p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = p_team and result in ('out', 'missed'))
    and (select count(*) from survivor_picks where survivor_id = p_survivor and team_id = p_team)
        >= (select count(distinct f.gameweek) from fixtures f join survivors s on s.competition = f.competition
            where s.id = p_survivor and f.gameweek >= s.start_gw
              and f.gameweek < coalesce(_survivor_week(p_survivor), _survivor_end(p_survivor) + 1))
$$;
revoke execute on function public._survivor_week(bigint) from public, anon, authenticated;
revoke execute on function public._survivor_alive(bigint, int) from public, anon, authenticated;

-- ───────────── starting one ─────────────
-- one at a time per pool, on a competition played in rounds, from the next round with a match to come (or the host's)
-- to the competition's last round (or the host's)
create or replace function public._survivor_create(p_competition text, p_start_gw int, p_end_gw int) returns bigint
language plpgsql security definer set search_path = public as $$
declare c competitions; sid bigint; gw int; last_gw int; end_gw int; w text; club text; draws boolean;
begin
  select * into c from competitions where id = p_competition;
  if c.id is null then raise exception 'No such competition'; end if;
  if exists (select 1 from series where competition = p_competition) then raise exception 'Last one standing runs on a competition played in rounds'; end if;
  if exists (select 1 from survivors where league_id = current_league_id() and status = 'open') then raise exception 'This pool already has a survivor running'; end if;
  w := _round_word(p_competition);
  club := _sport_word(p_competition, 'club', 'club');
  draws := coalesce((select (s.config->>'draws')::boolean from sports s where s.id = c.sport), true);
  gw := coalesce(p_start_gw, (select min(gameweek) from fixtures where competition = p_competition and state = 'scheduled' and kickoff > now()));
  if gw is null then raise exception 'No % to start from yet', lower(w); end if;
  -- a round with nothing left to kick off can't be picked, so it can't be the first
  if not exists (select 1 from fixtures where competition = p_competition and gameweek = gw and state = 'scheduled' and kickoff > now()) then
    raise exception 'That % is under way; start from the next one', lower(w);
  end if;
  last_gw := (select max(gameweek) from fixtures where competition = p_competition);
  end_gw := coalesce(p_end_gw, last_gw);
  if end_gw < gw or end_gw > last_gw then raise exception 'No such %', lower(w); end if;
  insert into survivors (competition, start_gw, end_gw, created_by) values (p_competition, gw, end_gw, my_team()) returning id into sid;
  perform _sys('general', format('🛡️ Last one standing starts in %s %s of the %s: pick one %s to win each %s, never the same %s twice. %s and you''re out.%s',
    lower(w), gw, c.name, club, lower(w), club, case when draws then 'A draw or a loss' else 'A loss or a tie' end,
    case when end_gw > gw then format(' It runs to %s %s; whoever is still in then shares it.', lower(w), end_gw) else '' end),
    jsonb_build_object('survivor', sid));
  return sid;
end $$;
revoke execute on function public._survivor_create(text, int, int) from public, anon, authenticated;

-- the two-argument start is retired by name (a drop would break a call made mid-deploy); the new one takes an end
do $$ begin
  if exists (select 1 from pg_proc where proname = 'survivor_start' and pronamespace = 'public'::regnamespace and pronargs = 2) then
    alter function public.survivor_start(text, int) rename to survivor_start_before_end;
    revoke execute on function public.survivor_start_before_end(text, int) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.survivor_start(p_competition text, p_start_gw int default null, p_end_gw int default null) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  return _survivor_create(p_competition, p_start_gw, p_end_gw);
end $$;
revoke execute on function public.survivor_start(text, int, int) from public, anon;
grant execute on function public.survivor_start(text, int, int) to authenticated;

-- the host adds a game to their pool: last one standing is one of the kinds (rules: from_round, to_round)
create or replace function public.pool_game_start(p_kind text, p_competition text, p_rules jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_kind = 'survivor' then
    return _survivor_create(p_competition, (p_rules->>'from_round')::int, (p_rules->>'to_round')::int);
  end if;
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
    ids := ids || case when x->>'kind' = 'survivor'
      then _survivor_create(x->>'competition', (x->'rules'->>'from_round')::int, (x->'rules'->>'to_round')::int)
      else _pool_game_create(x->>'kind', x->>'competition', x->'rules') end;
  end loop;
  return to_jsonb(ids);
end $$;
revoke execute on function public.pool_start_games(int, jsonb) from public, anon;
grant execute on function public.pool_start_games(int, jsonb) to authenticated;

-- ───────────── picking, for yourself or (the host) for a member ─────────────
-- this round's pick for the team given, until its game kicks off; returns the round
create or replace function public._survivor_pick_as(p_team int, p_survivor bigint, p_club bigint) returns int
language plpgsql security definer set search_path = public as $$
declare s survivors; gw int; fx fixtures; cur survivor_picks; w text; club text; self boolean := p_team = my_team();
begin
  select * into s from survivors where id = p_survivor;
  if s.id is null or s.status <> 'open' then raise exception 'That survivor is over'; end if;
  if p_team is null or not exists (select 1 from teams where id = p_team and league_id = s.league_id and role = 'gm') then
    raise exception '%', case when self then 'Only players pick' else 'Pick for a player in this pool' end;
  end if;
  w := lower(_round_word(s.competition));
  club := _sport_word(s.competition, 'club', 'club');
  if not _survivor_alive(p_survivor, p_team) then
    if not exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = p_team) then
      raise exception 'This one started before % joined; the next one is %', case when self then 'you' else 'they' end, case when self then 'yours' else 'theirs' end;
    end if;
    raise exception '%', case when self then 'You''re out of this one' else 'They''re out of this one' end;
  end if;
  gw := _survivor_week(p_survivor);
  if gw is null then raise exception 'No % to pick in', w; end if;
  select * into fx from fixtures where competition = s.competition and gameweek = gw and (home_club = p_club or away_club = p_club)
    and state = 'scheduled' order by kickoff limit 1;
  if fx.id is null then raise exception 'That % doesn''t play this %', club, w; end if;
  if fx.kickoff <= now() then raise exception 'That % has kicked off', _sport_word(s.competition, 'match', 'match'); end if;
  select * into cur from survivor_picks where survivor_id = p_survivor and team_id = p_team and gameweek = gw;
  if cur.id is not null and (select kickoff from fixtures where id = cur.fixture_id) <= now() then
    raise exception '%', case when self then 'Your pick has kicked off; it stands' else 'Their pick has kicked off; it stands' end;
  end if;
  if exists (select 1 from survivor_picks where survivor_id = p_survivor and team_id = p_team and club_id = p_club and gameweek <> gw and result is distinct from 'void') then
    raise exception '% used that % already', case when self then 'You''ve' else 'They''ve' end, club;
  end if;
  insert into survivor_picks (survivor_id, league_id, team_id, gameweek, club_id, fixture_id) values (p_survivor, s.league_id, p_team, gw, p_club, fx.id)
  on conflict (survivor_id, team_id, gameweek) do update set club_id = excluded.club_id, fixture_id = excluded.fixture_id, picked_at = now();
  return gw;
end $$;
revoke execute on function public._survivor_pick_as(int, bigint, bigint) from public, anon, authenticated;

-- a player's own pick
create or replace function public.survivor_pick(p_survivor bigint, p_club bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _in_league('survivors', p_survivor);
  perform _survivor_pick_as(_team(), p_survivor, p_club);
end $$;
revoke execute on function public.survivor_pick(bigint, bigint) from public, anon;
grant execute on function public.survivor_pick(bigint, bigint) to authenticated;

-- the host enters this round's pick for a member who asked; the member hears it
create or replace function public.survivor_host_pick(p_survivor bigint, p_team int, p_club bigint) returns int
language plpgsql security definer set search_path = public as $$
declare gw int; s survivors;
begin
  perform _commish();
  perform _in_league('survivors', p_survivor);
  perform _in_league('teams', p_team);
  gw := _survivor_pick_as(p_team, p_survivor, p_club);
  select * into s from survivors where id = p_survivor;
  perform _pool_alert(p_team, 'survivor', format('📝 The host picked %s for you in %s %s of Last one standing.',
    (select name from clubs where id = p_club), lower(_round_word(s.competition)), gw), '/survivor');
  return gw;
end $$;
revoke execute on function public.survivor_host_pick(bigint, int, bigint) from public, anon;
grant execute on function public.survivor_host_pick(bigint, int, bigint) to authenticated;

-- the board: every player with their picks, still in or out, and the round's games for picking, in the sport's words
create or replace function public.survivor_board(p_survivor bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s survivors; gw int;
begin
  perform _in_league('survivors', p_survivor);
  select * into s from survivors where id = p_survivor and league_id = current_league_id();
  if s.id is null then return null; end if;
  gw := _survivor_week(p_survivor);
  return jsonb_build_object(
    'id', s.id, 'competition', s.competition, 'competition_name', (select name from competitions where id = s.competition),
    'start_gw', s.start_gw, 'end_gw', _survivor_end(s.id), 'status', s.status, 'winners', to_jsonb(s.winners), 'gameweek', gw,
    'word', _round_word(s.competition), 'club_word', _sport_word(s.competition, 'club', 'club'),
    'match_word', _sport_word(s.competition, 'match', 'match'),
    'draws', coalesce((select (sp.config->>'draws')::boolean from competitions c join sports sp on sp.id = c.sport where c.id = s.competition), true),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'state', f.state,
        'home', jsonb_build_object('id', h.id, 'name', h.name, 'short', h.short, 'logo', h.logo),
        'away', jsonb_build_object('id', a.id, 'name', a.name, 'short', a.short, 'logo', a.logo),
        'home_score', f.home_ft, 'away_score', f.away_ft) order by f.kickoff)
      from fixtures f join clubs h on h.id = f.home_club join clubs a on a.id = f.away_club
      where f.competition = s.competition and f.gameweek = gw), '[]'),
    'players', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'alive', _survivor_alive(s.id, t.id),
        'out_gw', (select min(p.gameweek) from survivor_picks p where p.survivor_id = s.id and p.team_id = t.id and p.result in ('out', 'missed')),
        'picks', coalesce((select jsonb_agg(jsonb_build_object('gameweek', p.gameweek, 'club_id', p.club_id, 'short', c.short, 'name', c.name, 'logo', c.logo,
            'result', p.result, 'locked', coalesce(f.kickoff <= now(), true)) order by p.gameweek)
          from survivor_picks p left join clubs c on c.id = p.club_id left join fixtures f on f.id = p.fixture_id
          where p.survivor_id = s.id and p.team_id = t.id
            -- another player's pick shows once it has kicked off; your own always
            and (t.id = _team() or f.kickoff <= now() or p.result is not null)), '[]'))
        order by _survivor_alive(s.id, t.id) desc, t.gm_name)
      from teams t where t.league_id = s.league_id and t.role = 'gm'), '[]'));
end $$;
revoke execute on function public.survivor_board(bigint) from public, anon;
grant execute on function public.survivor_board(bigint) to authenticated;

-- a result comes in: settle the picks on that game, then close out the round if it is done; the last round done with
-- more than one still in, they share it
create or replace function public._survivor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; won boolean; s record; gw_done boolean; alive int; t record; opp text; ended boolean;
begin
  if new.state = old.state or new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  for p in select sp.*, c.name club from survivor_picks sp join clubs c on c.id = sp.club_id where sp.fixture_id = new.id and sp.result is null loop
    if new.state <> 'final' then
      update survivor_picks set result = 'void' where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', format('🛡️ %s''s %s was called off, so you''re through and keep %s for later.',
        p.club, _sport_word(new.competition, 'match', 'match'), p.club), '/survivor');
    else
      won := case when p.club_id = new.home_club then coalesce(new.home_ft, new.home_score) > coalesce(new.away_ft, new.away_score)
                  else coalesce(new.away_ft, new.away_score) > coalesce(new.home_ft, new.home_score) end;
      opp := (select name from clubs where id = case when p.club_id = new.home_club then new.away_club else new.home_club end);
      update survivor_picks set result = case when won then 'through' else 'out' end where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', case when won
        then format('🛡️ Through: %s beat %s %s-%s.', p.club, opp, greatest(coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)), least(coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)))
        else format('💥 Out: %s didn''t beat %s (%s-%s).', p.club, opp, coalesce(new.home_ft, new.home_score), coalesce(new.away_ft, new.away_score)) end, '/survivor');
    end if;
  end loop;
  -- every open survivor on this competition whose round is now done: no pick means out, then is anyone left?
  for s in select * from survivors where competition = new.competition and status = 'open' and new.gameweek between start_gw and _survivor_end(id) loop
    gw_done := not exists (select 1 from fixtures where competition = s.competition and gameweek = new.gameweek and state not in ('final', 'postponed', 'cancelled'));
    if not gw_done then continue; end if;
    -- those still in going into this round (never out, a pick in every round before it) who made no pick in it
    for t in select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm'
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and result in ('out', 'missed'))
             and (select count(*) from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek < new.gameweek)
                 >= (select count(distinct gameweek) from fixtures where competition = s.competition and gameweek >= s.start_gw and gameweek < new.gameweek)
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek = new.gameweek) loop
      insert into survivor_picks (survivor_id, league_id, team_id, gameweek, result) values (s.id, s.league_id, t.id, new.gameweek, 'missed');
      perform _pool_alert(t.id, 'survivor', format('💥 Out: no pick in %s %s.', lower(_round_word(s.competition)), new.gameweek), '/survivor');
    end loop;
    alive := (select count(*) from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id));
    ended := new.gameweek >= _survivor_end(s.id);
    if alive <= 1 or ended then
      -- one left wins it; the last round done, those still in share it; nobody left: those who went out this round share it
      update survivors set status = 'done', winners = case when alive >= 1
          then array(select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id))
          else array(select distinct team_id from survivor_picks where survivor_id = s.id and gameweek = new.gameweek and result in ('out', 'missed')) end
      where id = s.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Last one standing: %s.%s', (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from survivors sv join teams tm on tm.id = any (sv.winners) where sv.id = s.id),
          case when alive > 1 then format(' Still in after %s %s, they share it.', lower(_round_word(s.competition)), new.gameweek) else '' end),
        jsonb_build_object('survivor', s.id), s.league_id);
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public._survivor_settle_fixture() from public, anon, authenticated;

-- the start page and the host's desk: every competition played in rounds offers last one standing beside pick'em
create or replace function public.pool_event_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(z.e order by z.e->>'next_lock'), '[]') from (
    select e from jsonb_array_elements(pool_events()) e
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
    where c.active and r.open_round is not null and not exists (select 1 from series s where s.competition = c.id)) z
$$;
revoke execute on function public.pool_event_list() from public;
grant execute on function public.pool_event_list() to anon, authenticated;

-- what the commissioner's log keeps: last one standing's host powers join the rest
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status',
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster', 'commish_set_categories', 'commish_set_format', 'commish_make_schedule',
    'pool_game_start', 'pool_set_crown', 'pool_game_set_rules', 'pool_host_pick', 'pool_result_set', 'survivor_start', 'survivor_host_pick'])
$$;

-- the pool's table: who went out, in the sport's own word for a round
create or replace function public._pool_rows()
returns table (game text, kind text, title text, status text, link text, team_id int, score numeric, possible numeric, alive boolean, tiebreak numeric, line text)
language plpgsql stable security definer set search_path = public as $$
declare lid int := current_league_id(); g record;
begin
  if lid is null then return; end if;

  -- the questions: net worth, the coins in hand plus every call at today's price
  if exists (select 1 from pool_markets m where m.league_id = lid) then
    return query
    select 'questions'::text, 'questions'::text, 'The questions'::text,
      case when exists (select 1 from pool_markets m where m.league_id = lid and m.status = 'open') then 'open' else 'done' end,
      '/questions'::text, l.team_id, l.worth, null::numeric, null::boolean, null::numeric,
      case when l.calls > 0 then format('%s of %s called right', l.hits, l.calls) else 'No settled calls yet' end
    from pool_leaders() l;
  end if;

  -- the sports games: pick the series, rank the teams, squares
  for g in select * from pool_games pg where pg.league_id = lid order by pg.id loop
    return query
    select 'game:' || g.id, g.kind, g.title, g.status, '/picks?g=' || g.id, t.team_id, t.points::numeric,
      case when g.kind = 'squares' then null else t.possible::numeric end, null::boolean, t.tiebreak::numeric,
      case g.kind
        when 'series' then case when t.right_calls > 0 then format('%s right, %s with the length', t.right_calls, t.exact)
                                when t.picked > 0 then format('%s series picked', t.picked) else 'Nothing picked yet' end
        when 'pickem' then case when t.picked > 0 then format('%s right from %s picked', t.right_calls, t.picked) else 'Nothing picked yet' end
        when 'squares' then case when t.picked > 0 then format('%s square%s', t.picked, case when t.picked = 1 then '' else 's' end) else 'No squares' end
        else case when t.picked > 0 then 'Ranked' else 'Not ranked yet' end end
    from _pool_game_table(g.id) t;
  end loop;

  -- last one standing: still in (or the winner, once it's over) first, then the rounds survived, then who went out
  -- latest
  for g in select * from survivors s where s.league_id = lid order by s.id loop
    return query
    select 'survivor:' || g.id, 'survivor'::text, 'Last one standing'::text, g.status, '/survivor'::text, x.id,
      x.through::numeric, null::numeric, x.alive, (-coalesce(x.out_gw, 0))::numeric,
      case when g.status = 'done' and x.alive then 'Won it' when x.alive then 'Still in'
           when x.out_gw is not null then format('Out in %s %s', lower(_round_word(g.competition)), x.out_gw) else 'Out' end
    from (select tm.id,
            case when g.status = 'done' then tm.id = any(coalesce(g.winners, '{}')) else _survivor_alive(g.id, tm.id) end alive,
            (select count(*) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result = 'through')::int through,
            (select min(p.gameweek) from survivor_picks p where p.survivor_id = g.id and p.team_id = tm.id and p.result in ('out', 'missed')) out_gw
          from teams tm where tm.league_id = lid and tm.role = 'gm') x;
  end loop;

  -- call the score: points, then exact scores
  for g in select * from predictors s where s.league_id = lid order by s.id loop
    return query
    select 'predictor:' || g.id, 'score'::text, 'Call the score'::text, g.status, '/predictor'::text, x.id,
      x.pts::numeric, null::numeric, null::boolean, (-x.ex)::numeric,
      case when x.rt > 0 then format('%s exact, %s right', x.ex, x.rt) else 'No points yet' end
    from (select tm.id, coalesce(sum(p.points), 0)::int pts,
            count(*) filter (where p.points > 0 and p.home = coalesce(f.home_ft, f.home_score) and p.away = coalesce(f.away_ft, f.away_score))::int ex,
            count(*) filter (where p.points > 0)::int rt
          from teams tm
          left join predictor_picks p on p.predictor_id = g.id and p.team_id = tm.id
          left join fixtures f on f.id = p.fixture_id
          where tm.league_id = lid and tm.role = 'gm'
          group by tm.id) x;
  end loop;
end $$;
revoke execute on function public._pool_rows() from public, anon, authenticated;
