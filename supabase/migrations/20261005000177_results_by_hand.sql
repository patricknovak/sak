-- Results by hand for every game on fixtures (docs/DEVELOPMENT.md §6 item 3): pick'em could be settled by the host
-- (migration 172); last one standing and Call the score waited on the feed. Now a pool runs all three with no feed at all.
--
-- * The host's result can carry a score (`pool_result_overrides.home/away`), which Call the score needs; an outcome
--   alone still settles pick'em and last one standing, and gives Call the score's callers the point for the right
--   result (no exact score to match).
-- * Last one standing and Call the score settle per pool, from the pool's own result (`_pool_fixture`: the host's word
--   if given, else the feed's), and their round in play reads it too, so a round the host closed by hand is closed.
--   The feed's triggers call the same per-pool settling for every pool on the match; a pool whose host has spoken keeps
--   the host's result.
-- * `pool_fixture_result_set` settles any match a pool's open games use (a side, a draw, void, or a score), with the
--   reason everyone sees, on the commissioner's log; clearing it hands the match back to the feed (a pick it settled is
--   settled again from the feed, or waits for it).

alter table public.pool_result_overrides add column if not exists home int check (home between 0 and 99);
alter table public.pool_result_overrides add column if not exists away int check (away between 0 and 99);

-- ───────────── last one standing ─────────────

-- the round now in play: the first from the start with a match not yet done for this pool, up to the last
create or replace function public._survivor_week(p_survivor bigint) returns int
language sql stable security definer set search_path = public as $$
  select min(f.gameweek) from fixtures f join survivors s on s.competition = f.competition
  where s.id = p_survivor and f.gameweek between s.start_gw and _survivor_end(p_survivor)
    and not (select x.done from _pool_fixture(s.league_id, f.id) x)
$$;

-- one pool's picks on a match, once the pool's result is in, then the round's close if that was its last match
create or replace function public._survivor_settle(p_league int, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f fixtures; x record; o pool_result_overrides; p record; won boolean; s record; gw_done boolean; alive int; t record;
  opp text; ended boolean; h int; a int;
begin
  select * into f from fixtures where id = p_fixture;
  select * into x from _pool_fixture(p_league, p_fixture);
  if f.id is null or not x.done then return; end if;
  select * into o from pool_result_overrides where league_id = p_league and fixture_id = p_fixture;
  h := case when o.fixture_id is not null then o.home else coalesce(f.home_ft, f.home_score) end;
  a := case when o.fixture_id is not null then o.away else coalesce(f.away_ft, f.away_score) end;
  for p in select sp.*, c.name club from survivor_picks sp join clubs c on c.id = sp.club_id
           where sp.fixture_id = f.id and sp.league_id = p_league and sp.result is null loop
    if x.void then
      update survivor_picks set result = 'void' where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', format('🛡️ %s''s %s was called off, so you''re through and keep %s for later.',
        p.club, _sport_word(f.competition, 'match', 'match'), p.club), '/survivor');
    else
      won := (p.club_id = f.home_club and x.res = 'H') or (p.club_id = f.away_club and x.res = 'A');
      opp := (select name from clubs where id = case when p.club_id = f.home_club then f.away_club else f.home_club end);
      update survivor_picks set result = case when won then 'through' else 'out' end where id = p.id;
      perform _pool_alert(p.team_id, 'survivor', case
        when won and h is not null then format('🛡️ Through: %s beat %s %s-%s.', p.club, opp, greatest(h, a), least(h, a))
        when won then format('🛡️ Through: %s beat %s (settled by the host).', p.club, opp)
        when h is not null then format('💥 Out: %s didn''t beat %s (%s-%s).', p.club, opp, h, a)
        else format('💥 Out: %s didn''t beat %s (settled by the host).', p.club, opp) end, '/survivor');
    end if;
  end loop;
  -- this pool's open survivor on the competition, if this was its round's last match: no pick means out, then is
  -- anyone left?
  for s in select * from survivors where league_id = p_league and competition = f.competition and status = 'open'
             and f.gameweek between start_gw and _survivor_end(id) loop
    gw_done := not exists (select 1 from fixtures ff cross join lateral _pool_fixture(p_league, ff.id) e
                           where ff.competition = s.competition and ff.gameweek = f.gameweek and not e.done);
    if not gw_done then continue; end if;
    for t in select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm'
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and result in ('out', 'missed'))
             and (select count(*) from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek < f.gameweek)
                 >= (select count(distinct gameweek) from fixtures where competition = s.competition and gameweek >= s.start_gw and gameweek < f.gameweek)
             and not exists (select 1 from survivor_picks where survivor_id = s.id and team_id = tm.id and gameweek = f.gameweek) loop
      insert into survivor_picks (survivor_id, league_id, team_id, gameweek, result) values (s.id, s.league_id, t.id, f.gameweek, 'missed');
      perform _pool_alert(t.id, 'survivor', format('💥 Out: no pick in %s %s.', lower(_round_word(s.competition)), f.gameweek), '/survivor');
    end loop;
    alive := (select count(*) from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id));
    ended := f.gameweek >= _survivor_end(s.id);
    if alive <= 1 or ended then
      -- one left wins it; the last round done, those still in share it; nobody left: those who went out this round share it
      update survivors set status = 'done', winners = case when alive >= 1
          then array(select tm.id from teams tm where tm.league_id = s.league_id and tm.role = 'gm' and _survivor_alive(s.id, tm.id))
          else array(select distinct team_id from survivor_picks where survivor_id = s.id and gameweek = f.gameweek and result in ('out', 'missed')) end
      where id = s.id;
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Last one standing: %s.%s', (select string_agg(tm.gm_name, ' and ' order by tm.gm_name) from survivors sv join teams tm on tm.id = any (sv.winners) where sv.id = s.id),
          case when alive > 1 then format(' Still in after %s %s, they share it.', lower(_round_word(s.competition)), f.gameweek) else '' end),
        jsonb_build_object('survivor', s.id), s.league_id);
    end if;
  end loop;
end $$;
revoke execute on function public._survivor_settle(int, bigint) from public, anon, authenticated;

-- the feed's result: every pool with a survivor on it settles from its own result
create or replace function public._survivor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare l int;
begin
  if new.state = old.state or new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  for l in select league_id from survivors where competition = new.competition and status = 'open'
           union select league_id from survivor_picks where fixture_id = new.id and result is null loop
    perform _survivor_settle(l, new.id);
  end loop;
  return new;
end $$;
revoke execute on function public._survivor_settle_fixture() from public, anon, authenticated;

-- ───────────── call the score ─────────────

create or replace function public._predictor_week(p_predictor bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(f.gameweek) from fixtures f join predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw and not (select x.done from _pool_fixture(s.league_id, f.id) x)),
    (select max(f.gameweek) from fixtures f join predictors s on s.competition = f.competition
     where s.id = p_predictor and f.gameweek >= s.start_gw))
$$;

-- one pool's calls on a match, scored from the pool's result (a score scores exactly; an outcome alone, the right
-- result), then the round's news if that was its last match
create or replace function public._predictor_settle(p_league int, p_fixture bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f fixtures; x record; o pool_result_overrides; h int; a int; p record; s record; top record; lead record; last_gw int;
begin
  select * into f from fixtures where id = p_fixture;
  select * into x from _pool_fixture(p_league, p_fixture);
  if f.id is null or not x.done then return; end if;
  select * into o from pool_result_overrides where league_id = p_league and fixture_id = p_fixture;
  if x.void then
    update predictor_picks set points = 0, void = true where fixture_id = f.id and league_id = p_league;
  else
    h := case when o.fixture_id is not null then o.home else coalesce(f.home_ft, f.home_score) end;
    a := case when o.fixture_id is not null then o.away else coalesce(f.away_ft, f.away_score) end;
    if h is null and o.fixture_id is null then return; end if;
    -- a spot-on call hears about it, once (the first time it is scored)
    if h is not null then
      for p in select pp.team_id, pp.banker from predictor_picks pp join predictors pr on pr.id = pp.predictor_id
               where pp.fixture_id = f.id and pp.league_id = p_league and pp.points is null and pp.home = h and pp.away = a and pr.status = 'open' loop
        perform _pool_alert(p.team_id, 'predictor', format('🎯 Spot on: %s %s-%s %s. +%s%s', (select name from clubs where id = f.home_club), h, a,
          (select name from clubs where id = f.away_club), case when p.banker then 6 else 3 end, case when p.banker then ' with your banker' else '' end), '/predictor');
      end loop;
      update predictor_picks set points = _predictor_points(home, away, h, a, banker), void = false where fixture_id = f.id and league_id = p_league;
    else
      update predictor_picks set points = (case when sign(home - away) = case x.res when 'H' then 1 when 'A' then -1 else 0 end then 1 else 0 end)
        * case when banker then 2 else 1 end, void = false
      where fixture_id = f.id and league_id = p_league;
    end if;
  end if;
  -- this pool's open predictor on the competition whose round is now done and not yet announced
  for s in select * from predictors where league_id = p_league and competition = f.competition and status = 'open' and f.gameweek >= start_gw
             and not (f.gameweek = any (posted)) loop
    if exists (select 1 from fixtures ff cross join lateral _pool_fixture(p_league, ff.id) e
               where ff.competition = s.competition and ff.gameweek = f.gameweek and not e.done) then continue; end if;
    select string_agg(z.gm_name, ' and ' order by z.gm_name) names, max(z.pts) pts, count(*) n into top
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id and pp.gameweek = f.gameweek group by tm.id, tm.gm_name) z where z.rk = 1 and z.pts > 0;
    select string_agg(z.gm_name, ' and ' order by z.gm_name) names, max(z.pts) pts into lead
    from (select tm.gm_name, sum(pp.points) pts, rank() over (order by sum(pp.points) desc) rk
          from predictor_picks pp join teams tm on tm.id = pp.team_id
          where pp.predictor_id = s.id group by tm.id, tm.gm_name) z where z.rk = 1 and z.pts > 0;
    last_gw := (select max(gameweek) from fixtures where competition = s.competition);
    update predictors set posted = posted || f.gameweek where id = s.id;
    if f.gameweek >= last_gw and lead.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🏆 Call the score is done: %s, %s points over the season.', lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', f.gameweek), s.league_id);
    elsif top.names is not null then
      insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
        format('🎯 %s %s is done. Top of the week: %s with %s %s. Leading the table: %s on %s.', _round_word(s.competition), f.gameweek, top.names, top.pts,
               case when top.pts = 1 then 'point' else 'points' end, lead.names, lead.pts),
        jsonb_build_object('predictor', s.id, 'gameweek', f.gameweek), s.league_id);
    end if;
    if top.names is not null then
      for p in select pp.team_id from predictor_picks pp where pp.predictor_id = s.id and pp.gameweek = f.gameweek
               group by pp.team_id having sum(pp.points) = top.pts loop
        perform _pool_alert(p.team_id, 'predictor', format('🏅 You won %s %s with %s %s.', lower(_round_word(s.competition)), f.gameweek, top.pts, case when top.pts = 1 then 'point' else 'points' end), '/predictor');
      end loop;
    end if;
    if f.gameweek >= last_gw then
      update predictors set status = 'done', winners = array(
        select team_id from predictor_picks where predictor_id = s.id group by team_id
        having sum(points) = (select max(t) from (select sum(points) t from predictor_picks where predictor_id = s.id group by team_id) z) and sum(points) > 0)
      where id = s.id;
    end if;
  end loop;
end $$;
revoke execute on function public._predictor_settle(int, bigint) from public, anon, authenticated;

-- the feed's result (or a correction): every pool calling the score on it scores from its own result
create or replace function public._predictor_settle_fixture() returns trigger
language plpgsql security definer set search_path = public as $$
declare l int;
begin
  if new.state not in ('final', 'postponed', 'cancelled') then return new; end if;
  if new.state = old.state and new.home_ft is not distinct from old.home_ft and new.away_ft is not distinct from old.away_ft
     and new.home_score is not distinct from old.home_score and new.away_score is not distinct from old.away_score then return new; end if;
  for l in select league_id from predictors where competition = new.competition and status = 'open'
           union select league_id from predictor_picks where fixture_id = new.id loop
    perform _predictor_settle(l, new.id);
  end loop;
  return new;
end $$;
revoke execute on function public._predictor_settle_fixture() from public, anon, authenticated;

-- ───────────── the host's result on any match the pool plays ─────────────

-- the host settles a match for this pool, for every game on it: a home or away win, a draw, void (it counts for
-- nobody), or a score; with the reason everyone sees. Null for both hands it back to the feed. Only a match that has
-- kicked off (or been called off), and only one a game this pool runs is on.
create or replace function public.pool_fixture_result_set(p_fixture bigint, p_outcome text, p_home int default null, p_away int default null,
  p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); f fixtures; v text := upper(nullif(trim(p_outcome), '')); hn text; an text; draws boolean; g record;
begin
  perform _commish();
  select * into f from fixtures where id = p_fixture;
  if f.id is null or not (
       exists (select 1 from survivors where league_id = lid and competition = f.competition and status = 'open')
    or exists (select 1 from predictors where league_id = lid and competition = f.competition and status = 'open')
    or exists (select 1 from pool_games where league_id = lid and kind = 'pickem' and competition = f.competition and status = 'open'
               and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int)) then
    raise exception 'That match isn''t in one of this pool''s games';
  end if;
  if f.state = 'scheduled' and f.kickoff > now() then raise exception 'That match hasn''t kicked off yet'; end if;
  if v is null and p_home is null and p_away is null then
    delete from pool_result_overrides where league_id = lid and fixture_id = f.id;
    -- the picks it settled wait for the feed again (and are settled from it now, if it has the result)
    update survivor_picks sp set result = null from survivors s
      where sp.survivor_id = s.id and s.status = 'open' and sp.league_id = lid and sp.fixture_id = f.id and sp.club_id is not null;
    update predictor_picks pp set points = null, void = false from predictors s
      where pp.predictor_id = s.id and s.status = 'open' and pp.league_id = lid and pp.fixture_id = f.id;
    perform _survivor_settle(lid, f.id);
    perform _predictor_settle(lid, f.id);
    return null;
  end if;
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 or p_home > 99 or p_away > 99 then raise exception 'Give both sides a score'; end if;
  if p_home is not null then v := case when p_home > p_away then 'H' when p_home < p_away then 'A' else 'D' end; end if;
  if v not in ('H', 'D', 'A', 'VOID') then raise exception 'Settle it as a home win, an away win, a draw, void, or a score'; end if;
  draws := coalesce((select (sp.config->>'draws')::boolean from sports sp where sp.id = f.sport), true);
  if v = 'D' and not draws and p_home is null then raise exception 'There are no draws in this sport'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, so the pool can see it'; end if;
  v := case when v = 'VOID' then 'void' else v end;
  insert into pool_result_overrides (fixture_id, outcome, home, away, reason, by_team)
  values (f.id, v, case when v = 'void' then null else p_home end, case when v = 'void' then null else p_away end, left(trim(p_reason), 200), my_team())
  on conflict (league_id, fixture_id) do update set outcome = excluded.outcome, home = excluded.home, away = excluded.away,
    reason = excluded.reason, by_team = excluded.by_team, at = now();
  -- a result replaced: the picks settle again from the new one
  update survivor_picks sp set result = null from survivors s
    where sp.survivor_id = s.id and s.status = 'open' and sp.league_id = lid and sp.fixture_id = f.id and sp.club_id is not null;
  select name into hn from clubs where id = f.home_club;
  select name into an from clubs where id = f.away_club;
  perform _sys('general', format('📝 The host settled %s: %s. %s',
    case when p_home is not null then format('%s %s-%s %s', hn, p_home, p_away, an) else format('%s v %s', hn, an) end,
    case v when 'H' then hn || ' win' when 'A' then an || ' win' when 'D' then case when draws then 'a draw' else 'a tie' end else 'void, it counts for nobody' end,
    left(trim(p_reason), 200)), jsonb_build_object('fixture', f.id));
  perform _survivor_settle(lid, f.id);
  perform _predictor_settle(lid, f.id);
  for g in select id from pool_games where league_id = lid and kind = 'pickem' and competition = f.competition and status = 'open'
             and f.gameweek between (rules->>'from_round')::int and (rules->>'to_round')::int loop
    perform _pickem_round(g.id, f.gameweek);
  end loop;
  return v;
end $$;
revoke execute on function public.pool_fixture_result_set(bigint, text, int, int, text) from public, anon;
grant execute on function public.pool_fixture_result_set(bigint, text, int, int, text) to authenticated;

-- a result set from a pick'em's own card (pool_result_set) settles the pool's other games on that match too
create or replace function public._pool_result_settle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _survivor_settle(new.league_id, new.fixture_id);
  perform _predictor_settle(new.league_id, new.fixture_id);
  return null;
end $$;
revoke execute on function public._pool_result_settle() from public, anon, authenticated;
drop trigger if exists pool_result_overrides_settle on public.pool_result_overrides;
create trigger pool_result_overrides_settle after insert or update on public.pool_result_overrides
  for each row execute function public._pool_result_settle();

-- the commissioner's log keeps it
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
    'pool_game_start', 'pool_set_crown', 'pool_game_set_rules', 'pool_host_pick', 'pool_result_set', 'survivor_start', 'survivor_host_pick',
    'pool_fixture_result_set'])
$$;
