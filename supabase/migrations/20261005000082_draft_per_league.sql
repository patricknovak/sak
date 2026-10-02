-- B2 (docs/EXPANSION.md): the draft per league. There was one draft row in the whole database (id = 1), pick numbers
-- were unique across every league, and every draft function read "the" draft, counted every league's teams and
-- updated row 1, so a second league's draft would have run SaK's. Now each league has its own draft row (made on first
-- use), pick numbers are unique within a league, and every draft function works on the caller's league. The draft
-- clock and the trade-review timer run league by league from the scheduler, each with that league's own rules, and one
-- league's failure no longer stops the others. Garry's draft recap is told which league it's for.

-- one draft row per league
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'draft_state_id_check' and conrelid = 'public.draft_state'::regclass) then
    alter table public.draft_state drop constraint draft_state_id_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'draft_picks_season_overall_key' and conrelid = 'public.draft_picks'::regclass) then
    alter table public.draft_picks drop constraint draft_picks_season_overall_key;
  end if;
end $$;
create sequence if not exists public.draft_state_id_seq owned by public.draft_state.id;
select setval('public.draft_state_id_seq', greatest((select max(id) from public.draft_state), 1));
alter table public.draft_state alter column id set default nextval('public.draft_state_id_seq');
create unique index if not exists draft_state_league_key on public.draft_state (league_id);
-- pick numbers count within a league (a pick's original team already names its league)
create unique index if not exists draft_picks_league_season_overall_key on public.draft_picks (league_id, season, overall);

-- a league's draft row, made the first time anything asks for it
create or replace function public._draft_row(p_league int) returns void
language sql security definer set search_path = public as $$
  insert into draft_state (league_id, season)
  select p_league, coalesce((select season from league_rules where league_id = p_league), '2026-27')
  where p_league is not null and not exists (select 1 from draft_state where league_id = p_league)
  on conflict do nothing
$$;
revoke execute on function public._draft_row(int) from public, anon, authenticated;
select public._draft_row(id) from public.leagues;

CREATE OR REPLACE FUNCTION public._advance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
    update league set phase = 'season', updated_at = now();
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
    deadline = now() + make_interval(secs => case when (select autodraft from teams where id = nxt.team_id) then 4 else l.pick_seconds end),
    updated_at = now()
  where league_id = lid;
  perform _notify(nxt.team_id, 'draft', format('You''re on the clock! Pick #%s', nxt.overall), '/draft');
end $$;

CREATE OR REPLACE FUNCTION public._ensure_picks(p_season text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  insert into draft_picks (season, round, original_team, team_id)
  select p_season, r, t.id, t.id from teams t, league l, generate_series(1, l.draft_rounds) r where t.role = 'gm' and t.league_id = l.league_id
  on conflict do nothing;
$$;

CREATE OR REPLACE FUNCTION public.commish_set_pick_owner(p_pick integer, p_team integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare d draft_picks; st draft_state;
begin
  perform public._in_league('draft_picks', p_pick); perform public._in_league('teams', p_team);
  perform _commish();
  select * into st from draft_state where league_id = current_league_id();
  if st.status in ('live', 'paused') then raise exception 'Draft is in progress'; end if;
  select * into d from draft_picks where id = p_pick;
  if d.id is null then raise exception 'No such pick'; end if;
  if d.player_id is not null then raise exception 'That pick has already been used'; end if;
  if not exists (select 1 from teams where id = p_team and role = 'gm') then raise exception 'Not a GM team'; end if;
  update draft_picks set team_id = p_team, note = nullif(left(coalesce(p_note, ''), 120), '') where id = p_pick;
  perform _sys('draft', format('✏️ The commish moved the %s round %s pick (originally %s) to %s%s.', d.season, d.round, _tname(d.original_team), _tname(p_team),
    case when p_team = d.original_team then ' (back to its original owner)' else '' end));
end $$;

CREATE OR REPLACE FUNCTION public.draft_pause()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  perform _commish();
  update draft_state set status = 'paused',
    paused_remaining = greatest(5, extract(epoch from deadline - now())::int), updated_at = now()
  where status = 'live' and league_id = current_league_id();
  perform _sys('draft', '⏸️ Draft paused by the commissioner.');
end $$;

CREATE OR REPLACE FUNCTION public.draft_pick(p_player integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare me int := _team(); st draft_state; pk draft_picks;
begin perform _gm_only();
  perform _draft_row(current_league_id());
  select * into st from draft_state where league_id = current_league_id() for update;
  if st.status <> 'live' then raise exception 'The draft is not live'; end if;
  select * into pk from draft_picks where league_id = st.league_id and season = st.season and overall = st.current_overall;
  if pk.team_id <> me and not is_commish() then raise exception 'It''s not your pick'; end if;
  perform _do_pick(pk, p_player, false);
end $$;

CREATE OR REPLACE FUNCTION public.draft_reset()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare st draft_state; lid int := current_league_id();
begin
  perform _commish();
  perform _draft_row(lid);
  select * into st from draft_state where league_id = lid for update;
  delete from rosters where acquired = 'draft' and league_id = current_league_id();
  delete from transactions where type = 'draft' and season = st.season and league_id = lid;
  update draft_picks set player_id = null, picked_at = null, auto = false where season = st.season and league_id = lid;
  update draft_state set status = 'scheduled', current_overall = case when order_set then 1 end,
    deadline = null, paused_remaining = null, started_at = null, updated_at = now()
  where league_id = lid;
  update league set phase = 'predraft' where phase in ('draft', 'season');
  perform _sys('draft', '🔄 Draft board reset by the commissioner.');
end $$;

CREATE OR REPLACE FUNCTION public.draft_resume()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  perform _commish();
  update draft_state set status = 'live', deadline = now() + make_interval(secs => coalesce(paused_remaining, 60)),
    paused_remaining = null, updated_at = now()
  where status = 'paused' and league_id = current_league_id();
  perform _sys('draft', '▶️ Draft resumed.');
end $$;

CREATE OR REPLACE FUNCTION public.draft_set_order(p_order integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  l league; st draft_state;
  n int := array_length(p_order, 1);
  r int; i int; t int; lid int := current_league_id();
begin
  perform _commish();
  select * into l from league;
  perform _draft_row(lid);
  select * into st from draft_state where league_id = lid;
  if st.status in ('live', 'paused') then raise exception 'Draft is in progress'; end if;
  if n <> (select count(*) from teams where role = 'gm' and league_id = lid) or exists (select 1 from unnest(p_order) x where not exists (select 1 from teams where id = x and role = 'gm' and league_id = lid)) or (select count(distinct x) from unnest(p_order) x) <> n then
    raise exception 'Order must list every team once';
  end if;
  perform _ensure_picks(st.season);
  update draft_picks set overall = null where season = st.season and player_id is null and league_id = lid;
  for r in 1 .. l.draft_rounds loop
    for i in 1 .. n loop
      t := case when l.snake and r % 2 = 0 then p_order[n - i + 1] else p_order[i] end;
      update draft_picks set overall = (r - 1) * n + i
      where season = st.season and round = r and original_team = t and player_id is null and league_id = lid;
    end loop;
  end loop;
  update draft_state set order_set = true, current_overall = 1, updated_at = now()
  where league_id = lid;
  perform _sys('draft', '🎲 Draft order set: ' || (
    select string_agg(format('%s. %s', o, _tname(x)), '  ' order by o) from unnest(p_order) with ordinality u(x, o)),
    jsonb_build_object('order', to_jsonb(p_order)));
end $$;

CREATE OR REPLACE FUNCTION public.draft_start()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare st draft_state; lid int := current_league_id();
begin
  perform _commish();
  perform _draft_row(lid);
  select * into st from draft_state where league_id = lid for update;
  if not st.order_set then raise exception 'Set the draft order first'; end if;
  if st.status = 'live' then return; end if;
  update league set phase = 'draft', updated_at = now();
  update draft_state set status = 'live', started_at = coalesce(started_at, now()), updated_at = now()
  where league_id = lid;
  perform _sys('draft', '🟢 THE DRAFT IS LIVE! Good luck, and may the best GM win.');
  perform _sys('general', '🟢 The draft is live. Get in the draft room!');
  -- _advance() sets the clock for the first open pick
  update draft_state set current_overall = null
  where league_id = lid;
  perform _advance();
end $$;

CREATE OR REPLACE FUNCTION public.draft_undo()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare st draft_state; pk draft_picks; l league; lid int := current_league_id();
begin
  perform _commish();
  select * into l from league;
  select * into st from draft_state where league_id = lid for update;
  select * into pk from draft_picks where league_id = lid and season = st.season and player_id is not null and overall is not null
    order by overall desc limit 1;
  if not found then raise exception 'No picks to undo'; end if;
  delete from rosters where player_id = pk.player_id and team_id = pk.team_id and acquired = 'draft';
  delete from transactions where type = 'draft' and player_id = pk.player_id and season = pk.season and league_id = lid;
  update draft_picks set player_id = null, picked_at = null, auto = false where id = pk.id;
  update draft_state set status = case when status = 'done' then 'live' else status end,
    current_overall = pk.overall, deadline = now() + make_interval(secs => l.pick_seconds), updated_at = now()
  where league_id = lid;
  update league set phase = 'draft' where phase = 'season';
  perform _sys('draft', format('↩️ Commissioner undid pick #%s (%s).', pk.overall, _pname(pk.player_id)));
end $$;

-- the draft clock, from the scheduler: every league whose pick is overdue gets its autopick, run as that league (its
-- rules, its rosters); one league's trouble is logged and the others go on
create or replace function public.draft_tick() returns void
language plpgsql security definer set search_path = public as $$
declare st draft_state; pk draft_picks; prev text := current_setting('app.league_id', true);
begin
  for st in select * from draft_state where status = 'live' and deadline is not null and deadline <= now() order by league_id loop
    begin
      perform set_config('app.league_id', st.league_id::text, true);
      select * into st from draft_state where id = st.id for update skip locked;
      if found and st.status = 'live' and st.deadline <= now() then
        select * into pk from draft_picks where league_id = st.league_id and season = st.season and overall = st.current_overall;
        perform _do_pick(pk, _autopick_player(pk.team_id), true);
      end if;
    exception when others then
      raise warning 'draft_tick league %: %', st.league_id, sqlerrm;
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
end $$;

-- every 10 seconds: accepted trades whose review window has run out go through, each league on its own review
-- hours; then the draft clocks. A trade that can't go through is logged and doesn't hold up the rest.
create or replace function public.process_pending() returns void
language plpgsql security definer set search_path = public as $$
declare t record; prev text := current_setting('app.league_id', true);
begin
  for t in select tr.id, tr.league_id from trades tr join league_rules r on r.league_id = tr.league_id
           where tr.status = 'accepted' and tr.responded_at < now() - make_interval(hours => r.trade_review_hours) order by tr.id loop
    begin
      perform set_config('app.league_id', t.league_id::text, true);
      perform _execute_trade(t.id);
    exception when others then
      raise warning 'process_pending trade %: %', t.id, sqlerrm;
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  perform draft_tick();
end $$;

-- a new league gets its draft row with its rules and its Garry
create or replace function public.create_league(p_slug text, p_name text, p_short text, p_brand jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare nid int;
begin
  perform _commish();
  insert into leagues (slug, name, short_name, brand, status) values (p_slug, p_name, p_short, coalesce(p_brand, '{}'::jsonb), 'setup') returning id into nid;
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq)
  select nid, nid, p_name, p_short, season, 'keepers', keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq
  from league_rules where league_id = 1;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);
  return nid;
end $$;
