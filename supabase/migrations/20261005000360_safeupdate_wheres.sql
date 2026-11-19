-- Migration 360: every update and delete the site can reach carries a WHERE.
--
-- The app's API connections (PostgREST's authenticator role) load Postgres's safeupdate guard, which refuses any
-- UPDATE or DELETE without a WHERE clause, even one inside a function. The first versions of these functions knew it
-- (`where id = 1`, `where true`); the per-league rewrites (migrations 81 and 82, then 108 and 282) dropped those
-- clauses because the `league` view already keeps to the caller's league. Nothing caught it: the local test database
-- and pg_cron don't load safeupdate, so the same functions worked in tests and on the hourly jobs.
--
-- What it broke on the live site, 19 November 2026: the commissioner's Approve on trade #94, "DELETE requires a
-- WHERE clause" from `delete from _moving` in _execute_trade (the first trade SaK ever accepted; the 24-hour auto
-- approval runs from cron, where it would have gone through). The same guard would refuse the Commish page's league
-- settings (commish_update_league), the draft's start (draft_start), the last pick ending the draft (_advance) and
-- finalising keepers (finalize_keepers).
--
-- The fix: each statement names its rows. `where league_id = current_league_id()` is what the `league` view already
-- filters on, so no row changes that didn't before; `delete from _moving where true` empties this transaction's own
-- scratch table as before. The bodies are otherwise exactly what is live (fingerprints checked 19 November 2026).
-- supabase/tests/security.sql now fails on any update or delete without a WHERE in public or private functions.

CREATE OR REPLACE FUNCTION public._advance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st draft_state; nxt draft_picks; l league; t int; lid int := current_league_id();
begin
  select * into st from draft_state where league_id = lid for update;
  select * into l from league;
  select * into nxt from draft_picks where league_id = lid and season = st.season and player_id is null and overall is not null
    order by overall limit 1;
  if not found then
    update draft_state set status = 'done', current_overall = null, deadline = null, updated_at = now()
  where league_id = lid;
    update league set phase = 'season', updated_at = now()
      where league_id = current_league_id();
    for t in select id from teams where league_id = lid and role = 'gm' loop perform _auto_lineup(t); end loop;
    perform _sys('draft', '🏁 The draft is complete! Lineups have been auto-set; tweak yours on My Team. Let the chirping begin.');
    perform _sys('general', '🏁 The draft is complete! Rosters are live.');
    -- Garry grades everyone's draft
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=draft&league=' || lid,
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 5000);
    return;
  end if;
  update draft_state set current_overall = nxt.overall,
    deadline = now() + make_interval(secs => case when (select autodraft or user_id is null from teams where id = nxt.team_id) then 4 else l.pick_seconds end),
    updated_at = now()
  where league_id = lid;
  perform _notify(nxt.team_id, 'draft', format('You''re on the clock! Pick #%s', nxt.overall), '/draft');
end $function$
;
CREATE OR REPLACE FUNCTION public._execute_trade(p_trade bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tr trades; it record; dest int; parts int[]; t int; summary text; n int; drops text;
begin
  select * into tr from trades where id = p_trade for update;
  parts := coalesce(tr.parties, array[tr.from_team, tr.to_team]);
  perform take_snapshots();
  if exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id is not null
               and not exists (select 1 from rosters r where r.player_id = i.player_id and r.team_id = i.from_team))
     or exists (select 1 from trade_items i where i.trade_id = p_trade and i.pick_id is not null
               and not exists (select 1 from draft_picks d where d.id = i.pick_id and d.team_id = i.from_team and d.player_id is null)) then
    update trades set status = 'failed', decided_at = now(), review_note = 'Assets changed hands before approval' where id = p_trade;
    for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'A trade failed: assets changed hands', '/trades'); end loop;
    return;
  end if;
  for t in select x from unnest(parts) x loop
    n := _trade_active_after(p_trade, t);
    if n > _roster_max() then
      update trades set status = 'failed', decided_at = now(),
        review_note = format('%s would have %s active players (max %s): rosters changed after the deal was agreed', _tname(t), n, _roster_max()) where id = p_trade;
      perform _notify(x, 'trade', format('A trade failed: %s would be over the roster limit', _tname(t)), '/trades') from unnest(parts) x;
      return;
    end if;
    perform _check_trade_extras(t,
      (select coalesce(sum(pickups), 0) from trade_items where trade_id = p_trade and from_team = t)::int,
      (select coalesce(sum(coins), 0) from trade_items where trade_id = p_trade and from_team = t)::int);
  end loop;
  -- the drops that make room
  for it in select * from trade_items where trade_id = p_trade and release loop
    delete from rosters where player_id = it.player_id and team_id = it.from_team;
    insert into transactions (season, type, team_id, player_id, note) values (tr.season, 'drop', it.from_team, it.player_id, 'To make room for trade #' || p_trade);
  end loop;
  create temp table if not exists _moving (player_id int, dest int, was_ir boolean, ir_ok boolean) on commit drop;
  delete from _moving where true;
  for it in select * from trade_items where trade_id = p_trade and not release loop
    dest := coalesce(it.to_team, case when it.from_team = tr.from_team then tr.to_team else tr.from_team end);
    if it.player_id is not null then
      insert into _moving select it.player_id, dest, r.slot = 'IR', _ir_ok(pl.injury_status)
        from rosters r join players pl on pl.id = r.player_id where r.player_id = it.player_id and r.team_id = it.from_team;
      update rosters set team_id = dest, slot = 'BN', acquired = 'trade', acquired_at = now() where player_id = it.player_id and team_id = it.from_team;
      insert into transactions (season, type, team_id, player_id, other_team, note) values (tr.season, 'trade', dest, it.player_id, it.from_team, 'Trade #' || p_trade);
    elsif it.pick_id is not null then
      update draft_picks set team_id = dest where id = it.pick_id;
    elsif it.pickups is not null then
      insert into acq_transfers (season, from_team, to_team, n, trade_id) values (tr.season, it.from_team, dest, it.pickups, p_trade);
    elsif it.coins is not null then
      insert into coin_ledger (team_id, amount, reason) values
        (it.from_team, -it.coins, format('Trade #%s to %s', p_trade, _tname(dest))),
        (dest, it.coins, format('Trade #%s from %s', p_trade, _tname(it.from_team)));
    end if;
  end loop;
  for it in select * from _moving where was_ir and ir_ok loop
    if (select count(*) from rosters where team_id = it.dest and slot = 'IR') < _cap('IR') then
      update rosters set slot = 'IR' where player_id = it.player_id and team_id = it.dest;
    end if;
  end loop;
  update trades set status = 'approved', decided_at = now() where id = p_trade;
  if tr.parties is null then
    select format('%s send %s to %s for %s', _tname(tr.from_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.from_team and not release), 'nothing'),
      _tname(tr.to_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = p_trade and from_team = tr.to_team and not release), 'nothing'))
    into summary;
  else
    select string_agg(format('%s send %s to %s', _tname(g.from_team), g.what, _tname(g.to_team)), '; ' order by g.from_team, g.to_team) into summary
    from (select from_team, to_team, string_agg(_item_label(i), ', ') as what from trade_items i where trade_id = p_trade and not release group by from_team, to_team) g;
    summary := format('%s-team deal: %s', array_length(tr.parties, 1), summary);
  end if;
  select string_agg(format('%s drop %s', _tname(from_team), _pname(player_id)), '; ') into drops from trade_items where trade_id = p_trade and release;
  if drops is not null then summary := summary || '. To make room: ' || drops; end if;
  perform _sys('general', '🔄 TRADE! ' || summary, jsonb_build_object('trade', p_trade));
  for t in select x from unnest(parts) x loop perform _notify(t, 'trade', 'Your trade went through: ' || left(summary, 140), '/trades'); end loop;
  update trade_block b set offering = array(select x from unnest(b.offering) x where not exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id = x))
    where b.team_id = any (parts);
end $function$
;
CREATE OR REPLACE FUNCTION public.commish_update_league(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare f jsonb;
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
  end if;
  if coalesce((p->>'playoff_share')::numeric, (select playoff_share from league)) + coalesce((p->>'cup_share')::numeric, (select cup_share from league)) > 100 then
    raise exception 'The playoff and % shares can''t add up to more than 100%%', regexp_replace(_brand_word('{trophy}', 'full-year'), '^The ', '');
  end if;
  if p ? 'features' then
    f := p->'features';
    if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_each(f) e where e.key not in ('money', 'fund', 'live_room', 'usage', 'bestball', 'guillotine') or jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'Features are money, fund, live_room, usage, bestball and guillotine, each on or off';
    end if;
    -- the guillotine cuts the week's lowest points total, which needs a points league played for the season total
    if (f->>'guillotine')::boolean and exists (select 1 from league_rules where league_id = current_league_id() and (categories is not null or format <> 'season')) then
      raise exception 'The guillotine needs a points league played for the season total';
    end if;
    -- best ball counts each night's best lineup, which only a points league has: categories have no one best lineup
    if (f->>'bestball')::boolean and (select categories from league_rules where league_id = current_league_id()) is not null then
      raise exception 'Best ball needs a points league: categories have no single best lineup';
    end if;
  end if;
  update league set
    keepers = coalesce((p->>'keepers')::int, keepers),
    top_scorer_rule = coalesce((p->>'top_scorer_rule')::boolean, top_scorer_rule),
    keeper_deadline = case when p ? 'keeper_deadline' then (p->>'keeper_deadline')::timestamptz else keeper_deadline end,
    draft_at = case when p ? 'draft_at' then (p->>'draft_at')::timestamptz else draft_at end,
    pick_seconds = coalesce((p->>'pick_seconds')::int, pick_seconds),
    draft_rounds = coalesce((p->>'draft_rounds')::int, draft_rounds),
    snake = coalesce((p->>'snake')::boolean, snake),
    trade_deadline = case when p ? 'trade_deadline' then (p->>'trade_deadline')::timestamptz else trade_deadline end,
    max_acquisitions = coalesce((p->>'max_acquisitions')::int, max_acquisitions),
    playoff_bonus_acq = coalesce((p->>'playoff_bonus_acq')::int, playoff_bonus_acq),
    extra_acq_fee = coalesce((p->>'extra_acq_fee')::numeric, extra_acq_fee),
    entry_fee = coalesce((p->>'entry_fee')::numeric, entry_fee),
    sak_fee = coalesce((p->>'sak_fee')::numeric, sak_fee),
    prize_split = coalesce(p->'prize_split', prize_split),
    playoff_share = coalesce((p->>'playoff_share')::numeric, playoff_share),
    cup_share = coalesce((p->>'cup_share')::numeric, cup_share),
    phase = coalesce(p->>'phase', phase),
    commish_note = case when p ? 'commish_note' then p->>'commish_note' else commish_note end,
    scoring = coalesce(p->'scoring', scoring),
    -- the days best ball and the guillotine began are the server's to keep: an editor sending a stale copy of info
    -- (the call link, the pay note, the X feed) never moves them
    info = case when p ? 'info' then (p->'info') - 'bestball_from' - 'guillotine_from'
             || jsonb_strip_nulls(jsonb_build_object('bestball_from', info->'bestball_from', 'guillotine_from', info->'guillotine_from'))
           else info end,
    features = features || coalesce(f, '{}'),
    updated_at = now()
  where league_id = current_league_id();
  -- switched off, an option forgets its first day, so switching it on again starts afresh rather than judging the
  -- weeks (or re-slotting the nights) played while it was off
  if f ? 'bestball' and not (f->>'bestball')::boolean then
    update league_rules set info = info - 'bestball_from' where league_id = current_league_id();
  end if;
  if f ? 'guillotine' and not (f->>'guillotine')::boolean then
    update league_rules set info = info - 'guillotine_from' where league_id = current_league_id();
  end if;
  -- a league that turns its fund on gets its fund row (kept, with its history, if it is turned off again)
  -- best ball starts with the night being played, never re-counting the nights already scored
  if league_has('bestball') and not ((select info from league_rules where league_id = current_league_id()) ? 'bestball_from') then
    update league_rules set info = info || jsonb_build_object('bestball_from', today_et()) where league_id = current_league_id();
  end if;
  -- the guillotine judges the first full week after it's switched on, never a week played before anyone knew
  if league_has('guillotine') and not ((select info from league_rules where league_id = current_league_id()) ? 'guillotine_from') then
    update league_rules set info = info || jsonb_build_object('guillotine_from', today_et()) where league_id = current_league_id();
  end if;
  if league_has('fund') then
    insert into fund (league_id) values (current_league_id()) on conflict (league_id) do nothing;
  end if;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.draft_start()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare st draft_state; lid int := current_league_id();
begin
  perform _commish();
  perform _draft_row(lid);
  select * into st from draft_state where league_id = lid for update;
  if not st.order_set then raise exception 'Set the draft order first'; end if;
  if st.status = 'live' then return; end if;
  update league set phase = 'draft', updated_at = now()
  where league_id = current_league_id();
  update draft_state set status = 'live', started_at = coalesce(started_at, now()), updated_at = now()
  where league_id = lid;
  perform _sys('draft', '🟢 THE DRAFT IS LIVE! Good luck, and may the best GM win.');
  perform _sys('general', '🟢 The draft is live. Get in the draft room!');
  -- _advance() sets the clock for the first open pick
  update draft_state set current_overall = null
  where league_id = lid;
  perform _advance();
end $function$
;
CREATE OR REPLACE FUNCTION public.finalize_keepers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l league;
  lid int := current_league_id();
  t record;
  msg text := '';
begin
  perform _commish();
  select * into l from league;
  if l.phase <> 'keepers' then raise exception 'Keepers already finalized'; end if;
  -- teams that never submitted keep their best eligible players automatically
  for t in select id from teams where league_id = lid and role = 'gm' and (not keepers_submitted or not exists (select 1 from rosters where team_id = teams.id and keeper)) loop
    update rosters set keeper = true where team_id = t.id and player_id in (
      select player_id from rosters r where r.team_id = t.id
        and (not l.top_scorer_rule or r.player_id is distinct from top_scorer(t.id))
      order by prev_fp desc nulls last limit l.keepers);
  end loop;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'release', team_id, player_id, 'Not kept' from rosters where league_id = lid and not keeper;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'keeper', team_id, player_id, 'Kept for ' || l.season from rosters where league_id = lid and keeper;
  delete from rosters where league_id = lid and not keeper;
  update rosters set acquired = 'keeper', slot = 'BN', keeper = false
  where league_id = lid;
  update league set phase = 'predraft', updated_at = now()
  where league_id = current_league_id();
  for t in select id, name from teams where league_id = lid and role = 'gm' order by id loop
    msg := msg || E'\n' || t.name || ': ' || coalesce((
      select string_agg(p.name, ', ' order by r.prev_fp desc nulls last)
      from rosters r join players p on p.id = r.player_id where r.team_id = t.id), '—');
  end loop;
  perform _sys('general', '📋 Keepers are final! Everyone else is back in the pool.' || msg);
end $function$
;
