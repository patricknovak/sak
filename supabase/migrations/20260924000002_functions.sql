-- SaK League: server-side rules. Every function that changes the league validates who is
-- calling and whether the move is legal, so a GM can't cheat by poking the API directly.

-- ───────────────────────────── internals ─────────────────────────────
create or replace function public._team() returns int
language plpgsql stable security definer set search_path = public as $$
declare t int;
begin
  select id into t from teams where user_id = auth.uid();
  if t is null then raise exception 'Sign in as a GM first'; end if;
  return t;
end $$;

create or replace function public._commish() returns int
language plpgsql stable security definer set search_path = public as $$
declare t int;
begin
  select id into t from teams where user_id = auth.uid() and is_commish;
  if t is null then raise exception 'Commissioner only'; end if;
  return t;
end $$;

create or replace function public._sys(p_channel text, p_body text, p_meta jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into messages (channel, kind, body, meta) values (p_channel, 'system', p_body, p_meta);
$$;

create or replace function public._notify(p_team int, p_kind text, p_body text, p_link text default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (team_id, kind, body, link) values (p_team, p_kind, p_body, p_link);
$$;

create or replace function public._tname(p_team int) returns text
language sql stable security definer set search_path = public as $$ select name from teams where id = p_team $$;

create or replace function public._pname(p_player int) returns text
language sql stable security definer set search_path = public as $$
  select name || ' (' || pos || coalesce(' · ' || nhl_team, '') || ')' from players where id = p_player
$$;

create or replace function public._cap(p_slot text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((roster ->> p_slot)::int, 0) from league where id = 1
$$;

-- max players outside IR (sum of every non-IR slot)
create or replace function public._roster_max() returns int
language sql stable security definer set search_path = public as $$
  select sum(value::int)::int from league, jsonb_each_text(roster) where key <> 'IR'
$$;

create or replace function public.slot_ok(p_elig text[], p_pos text, p_slot text) returns boolean
language sql immutable as $$
  select case p_slot
    when 'BN' then true
    when 'IR' then true
    when 'Util' then p_pos <> 'G'
    when 'G' then p_pos = 'G'
    else p_pos <> 'G' and p_slot = any (p_elig)
  end
$$;

-- has this player's NHL game today already started? (then his slot is frozen until tomorrow)
create or replace function public.player_locked(p_player int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from games g join players p on p.id = p_player and p.nhl_team in (g.home, g.away)
    where g.date = today_et() and g.start_utc <= now() and g.state not in ('PPD','CNCL')
  )
$$;

-- freeze the lineup for every game that has started: this is what scoring reads
create or replace function public.take_snapshots() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into lineup_snapshots (game_id, date, team_id, player_id, slot)
  select g.id, g.date, r.team_id, r.player_id, r.slot
  from games g
  join players p on p.nhl_team in (g.home, g.away)
  join rosters r on r.player_id = p.id
  where g.start_utc <= now() and g.date >= today_et() - 1 and g.state not in ('PPD','CNCL')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────────── scoring ─────────────────────────────
create or replace function public.calc_fpts(p_stats jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(w.value::numeric * coalesce((p_stats ->> w.key)::numeric, 0)), 2), 0)
  from league l,
       jsonb_each_text(case when p_stats ? 'sv' or p_stats ? 'gs' then l.scoring -> 'goalie' else l.scoring -> 'skater' end) w
  where l.id = 1
$$;

create or replace function public._player_games_fpts() returns trigger
language plpgsql as $$
begin
  new.fpts := public.calc_fpts(new.stats);
  new.updated_at := now();
  return new;
end $$;
create trigger player_games_fpts before insert or update of stats on public.player_games
  for each row execute function public._player_games_fpts();

-- re-score everything (after a scoring-settings change)
create or replace function public.rescore_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update player_games set fpts = calc_fpts(stats)
  where true;
end $$;

create or replace view public.team_daily as
  select s.team_id, s.date, round(sum(pg.fpts), 2) as points, count(*) as games
  from lineup_snapshots s
  join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join league l on l.id = 1
  where s.slot not in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase = 'season'
  group by s.team_id, s.date;

create or replace view public.standings as
  with d as (select * from team_daily),
  agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0) as last7,
      coalesce(sum(d.games), 0) as games
    from teams t left join d on d.team_id = t.id
    group by t.id
  )
  select agg.*, rank() over (order by points desc) as rank,
    (select count(*) from transactions x, league l where x.team_id = agg.team_id and x.type = 'add' and x.season = l.season) as moves
  from agg;

create or replace view public.player_season as
  select pg.player_id, count(*) as gp, round(sum(pg.fpts), 2) as fpts,
    round(sum(pg.fpts) filter (where pg.date > today_et() - 14), 2) as fpts14,
    jsonb_build_object(
      'g', sum((stats->>'g')::numeric), 'a', sum((stats->>'a')::numeric), 'pm', sum((stats->>'pm')::numeric),
      'sog', sum((stats->>'sog')::numeric), 'hit', sum((stats->>'hit')::numeric), 'blk', sum((stats->>'blk')::numeric),
      'ppp', sum((stats->>'ppp')::numeric), 'w', sum((stats->>'w')::numeric), 'sv', sum((stats->>'sv')::numeric),
      'ga', sum((stats->>'ga')::numeric), 'sho', sum((stats->>'sho')::numeric)) as totals
  from player_games pg, league l
  group by pg.player_id;

grant select on public.team_daily, public.standings, public.player_season to authenticated;

-- ───────────────────────────── lineups ─────────────────────────────
create or replace function public.move_player(p_player int, p_slot text, p_swap int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team();
  r rosters; s rosters; p players; q players;
  s_new text;
begin
  perform take_snapshots();
  select * into r from rosters where player_id = p_player and team_id = me for update;
  if not found then raise exception 'That player is not on your roster'; end if;
  select * into p from players where id = p_player;
  if player_locked(p_player) then raise exception '% is locked: his game has started', p.name; end if;
  if not slot_ok(p.elig, p.pos, p_slot) then raise exception '% can''t play %', p.name, p_slot; end if;

  if p_swap is not null then
    select * into s from rosters where player_id = p_swap and team_id = me for update;
    if not found or s.slot <> p_slot then raise exception 'Swap target is not in that slot'; end if;
    select * into q from players where id = p_swap;
    if player_locked(p_swap) then raise exception '% is locked: his game has started', q.name; end if;
    s_new := case when slot_ok(q.elig, q.pos, r.slot) then r.slot else 'BN' end;
    if s_new = 'BN' and r.slot <> 'BN' and (select count(*) from rosters where team_id = me and slot = 'BN') >= _cap('BN') then
      raise exception 'Bench is full';
    end if;
    update rosters set slot = s_new where player_id = p_swap;
    update rosters set slot = p_slot where player_id = p_player;
  else
    if r.slot = p_slot then return; end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player;
  end if;
end $$;

-- fill starting slots with the best available players who have a game today
create or replace function public._auto_lineup(p_team int) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
  cap jsonb := '{}';
  sl text;
  placed boolean;
begin
  perform take_snapshots();
  for sl in select unnest(array['C','LW','RW','D','Util','G']) loop
    cap := cap || jsonb_build_object(sl, _cap(sl) - (
      select count(*) from rosters r where r.team_id = p_team and r.slot = sl and player_locked(r.player_id)));
  end loop;

  update rosters r set slot = 'BN'
  where r.team_id = p_team and r.slot not in ('IR', 'BN') and not player_locked(r.player_id);

  for c in
    select r.player_id, p.pos, p.elig,
      exists (select 1 from games g where g.date = today_et() and p.nhl_team in (g.home, g.away)
              and g.state not in ('PPD','CNCL')) as plays,
      coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp * 80 end, p.proj, 0) as val
    from rosters r join players p on p.id = r.player_id
    left join player_season ps on ps.player_id = r.player_id
    where r.team_id = p_team and r.slot = 'BN' and not player_locked(r.player_id)
    order by plays desc, val desc
  loop
    placed := false;
    if c.pos = 'G' then
      if (cap ->> 'G')::int > 0 then
        update rosters set slot = 'G' where player_id = c.player_id;
        cap := jsonb_set(cap, '{G}', to_jsonb((cap ->> 'G')::int - 1));
      end if;
      continue;
    end if;
    foreach sl in array c.elig loop
      if sl in ('C','LW','RW','D') and (cap ->> sl)::int > 0 then
        update rosters set slot = sl where player_id = c.player_id;
        cap := jsonb_set(cap, array[sl], to_jsonb((cap ->> sl)::int - 1));
        placed := true;
        exit;
      end if;
    end loop;
    if not placed and (cap ->> 'Util')::int > 0 then
      update rosters set slot = 'Util' where player_id = c.player_id;
      cap := jsonb_set(cap, '{Util}', to_jsonb((cap ->> 'Util')::int - 1));
    end if;
  end loop;
end $$;

create or replace function public.auto_lineup() returns void
language plpgsql security definer set search_path = public as $$
begin perform _auto_lineup(_team()); end $$;

create or replace function public.run_auto_lineups() returns int
language plpgsql security definer set search_path = public as $$
declare t int; n int := 0;
begin
  if (select phase from league) <> 'season' then return 0; end if;
  for t in select id from teams where auto_lineup loop
    perform _auto_lineup(t); n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────────────────────── keepers ─────────────────────────────
create or replace function public.top_scorer(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select player_id from rosters where team_id = p_team and prev_fp is not null order by prev_fp desc limit 1
$$;

create or replace function public.set_keepers(p_players int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team();
  l league;
  n int := coalesce(array_length(p_players, 1), 0);
begin
  select * into l from league;
  if l.phase <> 'keepers' then raise exception 'Keeper selection is closed'; end if;
  if l.keeper_deadline is not null and now() > l.keeper_deadline and not is_commish() then
    raise exception 'The keeper deadline has passed';
  end if;
  if n > l.keepers then raise exception 'You can keep at most % players', l.keepers; end if;
  if exists (select 1 from unnest(p_players) x where not exists (select 1 from rosters where player_id = x and team_id = me)) then
    raise exception 'You can only keep players on your own roster';
  end if;
  if l.top_scorer_rule and top_scorer(me) = any (p_players) then
    raise exception '% was your top scorer last season and goes back in the draft pool', _pname(top_scorer(me));
  end if;
  update rosters set keeper = (player_id = any (p_players)) where team_id = me;
  update teams set keepers_submitted = n > 0 where id = me;
  perform _sys('general', format('🔒 %s locked in %s keeper%s.', _tname(me), n, case when n = 1 then '' else 's' end));
end $$;

create or replace function public.finalize_keepers() returns void
language plpgsql security definer set search_path = public as $$
declare
  l league;
  t record;
  msg text := '';
begin
  perform _commish();
  select * into l from league;
  if l.phase <> 'keepers' then raise exception 'Keepers already finalized'; end if;
  -- teams that never submitted keep their best eligible players automatically
  for t in select id from teams where not keepers_submitted or not exists (select 1 from rosters where team_id = teams.id and keeper) loop
    update rosters set keeper = true where player_id in (
      select player_id from rosters r where r.team_id = t.id
        and (not l.top_scorer_rule or r.player_id is distinct from top_scorer(t.id))
      order by prev_fp desc nulls last limit l.keepers);
  end loop;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'release', team_id, player_id, 'Not kept' from rosters where not keeper;
  insert into transactions (season, type, team_id, player_id, note)
    select l.season, 'keeper', team_id, player_id, 'Kept for ' || l.season from rosters where keeper;
  delete from rosters where not keeper;
  update rosters set acquired = 'keeper', slot = 'BN', keeper = false
  where true;
  update league set phase = 'predraft', updated_at = now()
  where id = 1;
  for t in select id, name from teams order by id loop
    msg := msg || E'\n' || t.name || ': ' || coalesce((
      select string_agg(p.name, ', ' order by r.prev_fp desc nulls last)
      from rosters r join players p on p.id = r.player_id where r.team_id = t.id), '—');
  end loop;
  perform _sys('general', '📋 Keepers are final! Everyone else is back in the pool.' || msg);
end $$;

-- ───────────────────────────── draft ─────────────────────────────
create or replace function public._ensure_picks(p_season text) returns void
language sql security definer set search_path = public as $$
  insert into draft_picks (season, round, original_team, team_id)
  select p_season, r, t.id, t.id from teams t, league l, generate_series(1, l.draft_rounds) r
  on conflict do nothing;
$$;

create or replace function public.draft_set_order(p_order int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  l league; st draft_state;
  n int := array_length(p_order, 1);
  r int; i int; t int;
begin
  perform _commish();
  select * into l from league;
  select * into st from draft_state;
  if st.status in ('live', 'paused') then raise exception 'Draft is in progress'; end if;
  if n <> (select count(*) from teams) or (select count(distinct x) from unnest(p_order) x) <> n then
    raise exception 'Order must list every team once';
  end if;
  perform _ensure_picks(st.season);
  update draft_picks set overall = null where season = st.season and player_id is null;
  for r in 1 .. l.draft_rounds loop
    for i in 1 .. n loop
      t := case when l.snake and r % 2 = 0 then p_order[n - i + 1] else p_order[i] end;
      update draft_picks set overall = (r - 1) * n + i
      where season = st.season and round = r and original_team = t and player_id is null;
    end loop;
  end loop;
  update draft_state set order_set = true, current_overall = 1, updated_at = now()
  where id = 1;
  perform _sys('draft', '🎲 Draft order set: ' || (
    select string_agg(format('%s. %s', o, _tname(x)), '  ' order by o) from unnest(p_order) with ordinality u(x, o)),
    jsonb_build_object('order', to_jsonb(p_order)));
end $$;

create or replace function public.draft_randomize_order() returns int[]
language plpgsql security definer set search_path = public as $$
declare o int[];
begin
  perform _commish();
  select array_agg(id order by random()) into o from teams;
  perform draft_set_order(o);
  return o;
end $$;

create or replace function public._advance() returns void
language plpgsql security definer set search_path = public as $$
declare
  st draft_state; nxt draft_picks; l league; t int;
begin
  select * into st from draft_state for update;
  select * into l from league;
  select * into nxt from draft_picks where season = st.season and player_id is null and overall is not null
    order by overall limit 1;
  if not found then
    update draft_state set status = 'done', current_overall = null, deadline = null, updated_at = now()
  where id = 1;
    update league set phase = 'season', updated_at = now()
  where id = 1;
    for t in select id from teams loop perform _auto_lineup(t); end loop;
    perform _sys('draft', '🏁 The draft is complete! Lineups have been auto-set; tweak yours on My Team. Let the chirping begin.');
    perform _sys('general', '🏁 The draft is complete! Rosters are live.');
    return;
  end if;
  update draft_state set current_overall = nxt.overall,
    deadline = now() + make_interval(secs => case when (select autodraft from teams where id = nxt.team_id) then 4 else l.pick_seconds end),
    updated_at = now()
  where id = 1;
  perform _notify(nxt.team_id, 'draft', format('You''re on the clock! Pick #%s', nxt.overall), '/draft');
end $$;

create or replace function public._do_pick(p_pick draft_picks, p_player int, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n int := (select count(*) from teams); rp int;
begin
  if not exists (select 1 from players where id = p_player) then raise exception 'Unknown player'; end if;
  if exists (select 1 from rosters where player_id = p_player) then raise exception 'That player is already taken'; end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_player, p_pick.team_id, 'BN', 'draft');
  update draft_picks set player_id = p_player, picked_at = now(), auto = p_auto where id = p_pick.id;
  delete from draft_queue where player_id = p_player;
  insert into transactions (season, type, team_id, player_id, note)
    values (p_pick.season, 'draft', p_pick.team_id, p_player, format('Round %s, pick %s', p_pick.round, p_pick.overall));
  rp := (p_pick.overall - 1) % n + 1;
  perform _sys('draft', format('%s%s.%s (#%s) %s select %s', case when p_auto then '🤖 ' else '🚨 ' end,
      p_pick.round, lpad(rp::text, 2, '0'), p_pick.overall, _tname(p_pick.team_id), _pname(p_player)),
    jsonb_build_object('pick', p_pick.overall, 'player', p_player, 'team', p_pick.team_id, 'auto', p_auto));
  perform _advance();
end $$;

create or replace function public.draft_pick(p_player int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); st draft_state; pk draft_picks;
begin
  select * into st from draft_state for update;
  if st.status <> 'live' then raise exception 'The draft is not live'; end if;
  select * into pk from draft_picks where season = st.season and overall = st.current_overall;
  if pk.team_id <> me and not is_commish() then raise exception 'It''s not your pick'; end if;
  perform _do_pick(pk, p_player, false);
end $$;

-- best player for a team: queue first, then best projected player at a position they still need
create or replace function public._autopick_player(p_team int) returns int
language sql stable security definer set search_path = public as $$
  with have as (select p.pos, count(*) n from rosters r join players p on p.id = r.player_id where r.team_id = p_team group by p.pos),
  lim(pos, mx) as (values ('C', 7), ('LW', 7), ('RW', 7), ('D', 9), ('G', 4))
  select coalesce(
    (select q.player_id from draft_queue q where q.team_id = p_team
       and not exists (select 1 from rosters r where r.player_id = q.player_id) order by q.pos, q.player_id limit 1),
    (select p.id from players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id)
         and coalesce(have.n, 0) < lim.mx
       order by p.proj desc, p.last_fp desc limit 1))
$$;

-- anyone may call this; it only acts once the pick clock has actually expired
create or replace function public.draft_tick() returns void
language plpgsql security definer set search_path = public as $$
declare st draft_state; pk draft_picks;
begin
  select * into st from draft_state for update skip locked;
  if not found or st.status <> 'live' or st.deadline is null or now() < st.deadline then return; end if;
  select * into pk from draft_picks where season = st.season and overall = st.current_overall;
  perform _do_pick(pk, _autopick_player(pk.team_id), true);
end $$;

create or replace function public.draft_start() returns void
language plpgsql security definer set search_path = public as $$
declare st draft_state;
begin
  perform _commish();
  select * into st from draft_state for update;
  if not st.order_set then raise exception 'Set the draft order first'; end if;
  if st.status = 'live' then return; end if;
  update league set phase = 'draft', updated_at = now()
  where id = 1;
  update draft_state set status = 'live', started_at = coalesce(started_at, now()), updated_at = now()
  where id = 1;
  perform _sys('draft', '🟢 THE DRAFT IS LIVE! Good luck, and may the best GM win.');
  perform _sys('general', '🟢 The draft is live. Get in the draft room!');
  -- _advance() sets the clock for the first open pick
  update draft_state set current_overall = null
  where id = 1;
  perform _advance();
end $$;

create or replace function public.draft_pause() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update draft_state set status = 'paused',
    paused_remaining = greatest(5, extract(epoch from deadline - now())::int), updated_at = now()
  where status = 'live';
  perform _sys('draft', '⏸️ Draft paused by the commissioner.');
end $$;

create or replace function public.draft_resume() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update draft_state set status = 'live', deadline = now() + make_interval(secs => coalesce(paused_remaining, 60)),
    paused_remaining = null, updated_at = now()
  where status = 'paused';
  perform _sys('draft', '▶️ Draft resumed.');
end $$;

create or replace function public.draft_undo() returns void
language plpgsql security definer set search_path = public as $$
declare st draft_state; pk draft_picks; l league;
begin
  perform _commish();
  select * into l from league;
  select * into st from draft_state for update;
  select * into pk from draft_picks where season = st.season and player_id is not null and overall is not null
    order by overall desc limit 1;
  if not found then raise exception 'No picks to undo'; end if;
  delete from rosters where player_id = pk.player_id and team_id = pk.team_id and acquired = 'draft';
  delete from transactions where type = 'draft' and player_id = pk.player_id and season = pk.season;
  update draft_picks set player_id = null, picked_at = null, auto = false where id = pk.id;
  update draft_state set status = case when status = 'done' then 'live' else status end,
    current_overall = pk.overall, deadline = now() + make_interval(secs => l.pick_seconds), updated_at = now()
  where id = 1;
  update league set phase = 'draft' where phase = 'season';
  perform _sys('draft', format('↩️ Commissioner undid pick #%s (%s).', pk.overall, _pname(pk.player_id)));
end $$;

-- wipe draft results (mock drafts / testing); keepers are untouched
create or replace function public.draft_reset() returns void
language plpgsql security definer set search_path = public as $$
declare st draft_state;
begin
  perform _commish();
  select * into st from draft_state for update;
  delete from rosters where acquired = 'draft';
  delete from transactions where type = 'draft' and season = st.season;
  update draft_picks set player_id = null, picked_at = null, auto = false where season = st.season;
  update draft_state set status = 'scheduled', current_overall = case when order_set then 1 end,
    deadline = null, paused_remaining = null, started_at = null, updated_at = now()
  where id = 1;
  update league set phase = 'predraft' where phase in ('draft', 'season');
  perform _sys('draft', '🔄 Draft board reset by the commissioner.');
end $$;

create or replace function public.set_autodraft(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update teams set autodraft = p_on where id = _team();
$$;

create or replace function public.commish_set_pick_owner(p_pick int, p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update draft_picks set team_id = p_team where id = p_pick and player_id is null;
  perform _sys('draft', format('📝 Pick %s now belongs to %s.', (select format('R%s (orig. %s)', round, _tname(original_team)) from draft_picks where id = p_pick), _tname(p_team)));
end $$;

-- ───────────────────────────── free agents ─────────────────────────────
create or replace function public.add_player(p_add int, p_drop int default null, p_accept_fee boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); l league; used int; fee numeric := 0; cnt int;
begin
  select * into l from league;
  if l.phase <> 'season' then raise exception 'Free agency opens after the draft'; end if;
  perform take_snapshots();
  if exists (select 1 from rosters where player_id = p_add) then raise exception 'That player is already on a roster'; end if;
  if not exists (select 1 from players where id = p_add) then raise exception 'Unknown player'; end if;
  select count(*) into used from transactions where team_id = me and type = 'add' and season = l.season;
  if used >= l.max_acquisitions then
    if l.season_end is not null and today_et() > l.season_end - 7 then
      raise exception 'No extra pickups in the final week of the season';
    end if;
    if not p_accept_fee then raise exception 'ACQ_LIMIT: You''ve used all % free pickups. Extra pickups cost $%.', l.max_acquisitions, l.extra_acq_fee; end if;
    fee := l.extra_acq_fee;
  end if;
  if p_drop is not null then
    if not exists (select 1 from rosters where player_id = p_drop and team_id = me) then raise exception 'You can only drop your own players'; end if;
    delete from rosters where player_id = p_drop;
    insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_drop);
  end if;
  select count(*) into cnt from rosters where team_id = me and slot <> 'IR';
  if cnt >= _roster_max() then raise exception 'Roster is full (% players). Choose someone to drop.', _roster_max(); end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_add, me, 'BN', 'fa');
  insert into transactions (season, type, team_id, player_id, fee) values (l.season, 'add', me, p_add, fee);
  if fee > 0 then
    insert into ledger (season, team_id, kind, amount, description)
      values (l.season, me, 'acq_fee', fee, 'Extra pickup: ' || _pname(p_add));
  end if;
  perform _sys('general', format('➕ %s add %s%s%s', _tname(me), _pname(p_add),
    case when p_drop is not null then ', drop ' || _pname(p_drop) else '' end,
    case when fee > 0 then format(' ($%s extra pickup fee)', fee) else '' end));
end $$;

create or replace function public.drop_player(p_player int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league;
begin
  select * into l from league;
  if l.phase not in ('season', 'predraft') then raise exception 'Drops are closed right now'; end if;
  perform take_snapshots();
  if not exists (select 1 from rosters where player_id = p_player and team_id = me) then raise exception 'Not your player'; end if;
  delete from rosters where player_id = p_player;
  insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_player);
  perform _sys('general', format('➖ %s drop %s', _tname(me), _pname(p_player)));
end $$;

-- ───────────────────────────── trades ─────────────────────────────
create or replace function public.propose_trade(p_to int, p_give int[], p_get int[],
  p_give_picks int[] default '{}', p_get_picks int[] default '{}', p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); l league; tid bigint;
begin
  select * into l from league;
  if l.trade_deadline is not null and now() > l.trade_deadline then raise exception 'The trade deadline has passed'; end if;
  if l.phase = 'draft' then raise exception 'No trades during the live draft'; end if;
  if p_to = me then raise exception 'You can''t trade with yourself'; end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_get, 1), 0)
     + coalesce(array_length(p_give_picks, 1), 0) + coalesce(array_length(p_get_picks, 1), 0) = 0 then
    raise exception 'Add something to the trade';
  end if;
  if exists (select 1 from unnest(p_give) x where not exists (select 1 from rosters where player_id = x and team_id = me))
    or exists (select 1 from unnest(p_get) x where not exists (select 1 from rosters where player_id = x and team_id = p_to))
    or exists (select 1 from unnest(p_give_picks) x where not exists (select 1 from draft_picks where id = x and team_id = me and player_id is null))
    or exists (select 1 from unnest(p_get_picks) x where not exists (select 1 from draft_picks where id = x and team_id = p_to and player_id is null)) then
    raise exception 'Some of those assets aren''t owned by the right team';
  end if;
  insert into trades (season, from_team, to_team, note) values (l.season, me, p_to, p_note) returning id into tid;
  insert into trade_items (trade_id, from_team, player_id) select tid, me, x from unnest(p_give) x;
  insert into trade_items (trade_id, from_team, player_id) select tid, p_to, x from unnest(p_get) x;
  insert into trade_items (trade_id, from_team, pick_id) select tid, me, x from unnest(p_give_picks) x;
  insert into trade_items (trade_id, from_team, pick_id) select tid, p_to, x from unnest(p_get_picks) x;
  perform _notify(p_to, 'trade', format('%s sent you a trade offer', _tname(me)), '/trades');
  return tid;
end $$;

create or replace function public._execute_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades; it record; a text; b text;
begin
  select * into tr from trades where id = p_trade for update;
  perform take_snapshots();
  -- everything must still be owned by the same side
  if exists (select 1 from trade_items i where i.trade_id = p_trade and i.player_id is not null
               and not exists (select 1 from rosters r where r.player_id = i.player_id and r.team_id = i.from_team))
     or exists (select 1 from trade_items i where i.trade_id = p_trade and i.pick_id is not null
               and not exists (select 1 from draft_picks d where d.id = i.pick_id and d.team_id = i.from_team and d.player_id is null)) then
    update trades set status = 'failed', decided_at = now(), review_note = 'Assets changed hands before approval' where id = p_trade;
    perform _notify(tr.from_team, 'trade', 'A trade failed: assets changed hands', '/trades');
    perform _notify(tr.to_team, 'trade', 'A trade failed: assets changed hands', '/trades');
    return;
  end if;
  for it in select * from trade_items where trade_id = p_trade loop
    if it.player_id is not null then
      update rosters set team_id = case when it.from_team = tr.from_team then tr.to_team else tr.from_team end,
        slot = 'BN', acquired = 'trade', acquired_at = now()
      where player_id = it.player_id;
      insert into transactions (season, type, team_id, player_id, other_team, note)
        values (tr.season, 'trade', case when it.from_team = tr.from_team then tr.to_team else tr.from_team end,
                it.player_id, it.from_team, 'Trade #' || p_trade);
    else
      update draft_picks set team_id = case when it.from_team = tr.from_team then tr.to_team else tr.from_team end
      where id = it.pick_id;
    end if;
  end loop;
  update trades set status = 'approved', decided_at = now() where id = p_trade;
  select string_agg(coalesce(_pname(player_id), (select format('%s R%s pick', season, round) from draft_picks where id = pick_id)), ', ')
    into a from trade_items where trade_id = p_trade and from_team = tr.from_team;
  select string_agg(coalesce(_pname(player_id), (select format('%s R%s pick', season, round) from draft_picks where id = pick_id)), ', ')
    into b from trade_items where trade_id = p_trade and from_team = tr.to_team;
  perform _sys('general', format('🔄 TRADE! %s send %s to %s for %s', _tname(tr.from_team), coalesce(a, 'nothing'), _tname(tr.to_team), coalesce(b, 'nothing')),
    jsonb_build_object('trade', p_trade));
  perform _notify(tr.from_team, 'trade', 'Your trade with ' || _tname(tr.to_team) || ' went through', '/trades');
  perform _notify(tr.to_team, 'trade', 'Your trade with ' || _tname(tr.from_team) || ' went through', '/trades');
end $$;

create or replace function public.respond_trade(p_trade bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); tr trades; c int;
begin
  select * into tr from trades where id = p_trade for update;
  if tr.to_team <> me or tr.status <> 'proposed' then raise exception 'You can''t respond to that trade'; end if;
  if not p_accept then
    update trades set status = 'declined', responded_at = now() where id = p_trade;
    perform _notify(tr.from_team, 'trade', _tname(me) || ' declined your trade offer', '/trades');
    return;
  end if;
  update trades set status = 'accepted', responded_at = now() where id = p_trade;
  perform _notify(tr.from_team, 'trade', _tname(me) || ' accepted your trade. Waiting on commissioner review.', '/trades');
  for c in select id from teams where is_commish loop
    perform _notify(c, 'trade', format('Trade to review: %s ↔ %s', _tname(tr.from_team), _tname(tr.to_team)), '/trades');
  end loop;
  perform _sys('general', format('🤝 %s and %s agreed to a trade. Pending commissioner review.', _tname(tr.from_team), _tname(tr.to_team)));
end $$;

create or replace function public.cancel_trade(p_trade bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update trades set status = 'cancelled', responded_at = now()
  where id = p_trade and from_team = _team() and status = 'proposed';
end $$;

create or replace function public.review_trade(p_trade bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare tr trades;
begin
  perform _commish();
  select * into tr from trades where id = p_trade;
  if tr.status <> 'accepted' then raise exception 'That trade isn''t waiting on review'; end if;
  if p_approve then
    update trades set review_note = p_note where id = p_trade;
    perform _execute_trade(p_trade);
  else
    update trades set status = 'vetoed', decided_at = now(), review_note = p_note where id = p_trade;
    perform _sys('general', format('🚫 Commissioner vetoed the %s ↔ %s trade.%s', _tname(tr.from_team), _tname(tr.to_team),
      coalesce(' "' || p_note || '"', '')));
    perform _notify(tr.from_team, 'trade', 'Your trade was vetoed', '/trades');
    perform _notify(tr.to_team, 'trade', 'Your trade was vetoed', '/trades');
  end if;
end $$;

-- ───────────────────────────── side bets ─────────────────────────────
create or replace function public.create_bet(p_opponent int, p_title text, p_terms text, p_kind text,
  p_stake text, p_amount numeric, p_start date default null, p_end date default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); bid bigint;
begin
  if p_opponent = me then raise exception 'You can''t bet yourself'; end if;
  insert into bets (creator_team, opponent_team, title, terms, kind, stake, amount, start_date, end_date)
    values (me, p_opponent, p_title, p_terms, coalesce(p_kind, 'custom'), p_stake, p_amount, p_start, p_end)
    returning id into bid;
  perform _sys('general', format('🎲 %s %s: "%s"%s', _tname(me),
    case when p_opponent is null then 'posted an open challenge' else 'challenged ' || _tname(p_opponent) end,
    p_title, coalesce(' · stakes: ' || nullif(concat_ws(' + ', case when p_amount > 0 then '$' || p_amount end, p_stake), ''), '')),
    jsonb_build_object('bet', bid));
  if p_opponent is not null then
    perform _notify(p_opponent, 'bet', format('%s challenged you: %s', _tname(me), p_title), '/bets');
  end if;
  return bid;
end $$;

create or replace function public.respond_bet(p_bet bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'open' or b.creator_team = me or (b.opponent_team is not null and b.opponent_team <> me) then
    raise exception 'You can''t respond to that bet';
  end if;
  if p_accept then
    update bets set status = 'accepted', opponent_team = me, accepted_at = now() where id = p_bet;
    perform _sys('general', format('✅ Bet on! %s vs %s: "%s"', _tname(b.creator_team), _tname(me), b.title), jsonb_build_object('bet', p_bet));
    perform _notify(b.creator_team, 'bet', _tname(me) || ' accepted your bet: ' || b.title, '/bets');
  else
    if b.opponent_team is null then raise exception 'Just ignore open challenges you don''t want'; end if;
    update bets set status = 'declined' where id = p_bet;
    perform _sys('general', format('🐔 %s declined %s''s bet: "%s"', _tname(me), _tname(b.creator_team), b.title));
    perform _notify(b.creator_team, 'bet', _tname(me) || ' declined your bet', '/bets');
  end if;
end $$;

create or replace function public.cancel_bet(p_bet bigint) returns void
language sql security definer set search_path = public as $$
  update bets set status = 'cancelled' where id = p_bet and creator_team = _team() and status = 'open';
$$;

create or replace function public.claim_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets; other int;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'accepted' or me not in (b.creator_team, b.opponent_team) then raise exception 'Not your bet'; end if;
  if p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  other := case when me = b.creator_team then b.opponent_team else b.creator_team end;
  if p_winner = other then
    -- conceding settles it immediately
    update bets set status = 'settled', winner_team = p_winner, settled_at = now(), proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _sys('general', format('🏆 %s concedes: %s wins "%s"', _tname(me), _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
  else
    update bets set proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _notify(other, 'bet', format('%s says they won "%s". Confirm or dispute.', _tname(me), b.title), '/bets');
  end if;
end $$;

create or replace function public.confirm_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'accepted' or b.proposed_winner is null or b.proposed_by = me or me not in (b.creator_team, b.opponent_team) then
    raise exception 'Nothing to confirm';
  end if;
  update bets set status = 'settled', winner_team = b.proposed_winner, settled_at = now() where id = p_bet;
  perform _sys('general', format('🏆 %s wins the bet "%s"%s', _tname(b.proposed_winner), b.title,
    coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', p_bet));
end $$;

create or replace function public.commish_settle_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  perform _commish();
  select * into b from bets where id = p_bet;
  update bets set status = 'settled', winner_team = p_winner, settled_at = now() where id = p_bet;
  perform _sys('general', format('⚖️ Commissioner ruling: %s wins "%s"', _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
end $$;

create or replace function public.mark_bet_paid(p_bet bigint) returns void
language sql security definer set search_path = public as $$
  update bets set paid = true where id = p_bet and status = 'settled' and (winner_team = _team() or is_commish());
$$;

-- ───────────────────────────── proposals + votes ─────────────────────────────
create or replace function public.create_proposal(p_title text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); pid bigint;
begin
  insert into proposals (title, body, sponsor_team, closes_at) values (p_title, p_body, me, now() + interval '7 days') returning id into pid;
  perform _sys('general', format('🗳️ New rule proposal from %s: "%s". Needs a co-sponsor to go to a vote.', _tname(me), p_title));
  return pid;
end $$;

create or replace function public.cosponsor_proposal(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); pr proposals;
begin
  select * into pr from proposals where id = p_id for update;
  if pr.sponsor_team = me or pr.cosponsor_team is not null or pr.status <> 'open' then raise exception 'Can''t co-sponsor that'; end if;
  update proposals set cosponsor_team = me where id = p_id;
  perform _sys('general', format('🗳️ "%s" has a co-sponsor (%s). Voting is open!', pr.title, _tname(me)));
end $$;

create or replace function public.vote_proposal(p_id bigint, p_vote text) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); pr proposals;
begin
  select * into pr from proposals where id = p_id;
  if pr.status <> 'open' or pr.cosponsor_team is null then raise exception 'Voting isn''t open on that proposal'; end if;
  if (select joined_season from teams where id = me) = (select season from league) then
    raise exception 'Expansion GMs don''t vote in their first season (your opinion still counts with the commish)';
  end if;
  insert into proposal_votes (proposal_id, team_id, vote) values (p_id, me, p_vote)
    on conflict (proposal_id, team_id) do update set vote = excluded.vote, created_at = now();
end $$;

create or replace function public.close_proposal(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare pr proposals;
begin
  perform _commish();
  select * into pr from proposals where id = p_id;
  update proposals set status = p_status, decided_at = now() where id = p_id;
  perform _sys('general', format('🗳️ Proposal "%s": %s', pr.title, upper(p_status)));
end $$;

-- ───────────────────────────── profile ─────────────────────────────
create or replace function public.update_my_team(p_name text, p_motto text, p_color text, p_emoji text,
  p_fav_nhl text, p_auto_lineup boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); old text;
begin
  select name into old from teams where id = me;
  update teams set name = coalesce(nullif(trim(p_name), ''), name), motto = p_motto,
    color = coalesce(p_color, color), emoji = coalesce(nullif(p_emoji, ''), emoji),
    fav_nhl = p_fav_nhl, auto_lineup = coalesce(p_auto_lineup, auto_lineup)
  where id = me;
  if old <> coalesce(nullif(trim(p_name), ''), old) then
    perform _sys('general', format('🪪 %s are now known as %s', old, trim(p_name)));
  end if;
end $$;

create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update teams set last_seen = now() where user_id = auth.uid();
$$;

-- ───────────────────────────── commissioner tools ─────────────────────────────
create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
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
    extra_acq_fee = coalesce((p->>'extra_acq_fee')::numeric, extra_acq_fee),
    phase = coalesce(p->>'phase', phase),
    commish_note = case when p ? 'commish_note' then p->>'commish_note' else commish_note end,
    scoring = coalesce(p->'scoring', scoring),
    info = coalesce(p->'info', info),
    updated_at = now()
  where id = 1;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;

create or replace function public.commish_move_player(p_player int, p_team int, p_slot text default 'BN') returns void
language plpgsql security definer set search_path = public as $$
declare l league; prev int;
begin
  perform _commish();
  select * into l from league;
  perform take_snapshots();
  select team_id into prev from rosters where player_id = p_player;
  if p_team is null then
    delete from rosters where player_id = p_player;
  else
    insert into rosters (player_id, team_id, slot, acquired) values (p_player, p_team, coalesce(p_slot, 'BN'), 'commish')
    on conflict (player_id) do update set team_id = excluded.team_id, slot = excluded.slot, acquired = 'commish', acquired_at = now();
  end if;
  insert into transactions (season, type, team_id, player_id, other_team, note)
    values (l.season, 'commish', p_team, p_player, prev, 'Commissioner roster move');
  perform _sys('general', format('🛠️ Commissioner moved %s %s', _pname(p_player),
    case when p_team is null then 'to free agency' else 'to ' || _tname(p_team) end));
end $$;

create or replace function public.commish_set_keeper(p_player int, p_keep boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update rosters set keeper = p_keep where player_id = p_player;
end $$;

create or replace function public.commish_reset_password(p_team int, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _commish();
  if length(p_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = (select user_id from teams where id = p_team);
end $$;

create or replace function public.commish_ledger(p_team int, p_kind text, p_amount numeric, p_desc text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  insert into ledger (season, team_id, kind, amount, description)
    values ((select season from league), p_team, p_kind, p_amount, p_desc);
  if p_kind = 'fine' then
    perform _sys('general', format('💸 %s fined $%s: %s', _tname(p_team), p_amount, p_desc));
  end if;
end $$;

create or replace function public.commish_mark_paid(p_id bigint, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update ledger set paid = p_paid where id = p_id;
end $$;

-- ───────────────────────────── scheduled work ─────────────────────────────
-- called by pg_cron: auto-approve trades after the review window, keep the draft clock honest
create or replace function public.process_pending() returns void
language plpgsql security definer set search_path = public as $$
declare t bigint; hrs int := (select trade_review_hours from league);
begin
  for t in select id from trades where status = 'accepted' and responded_at < now() - make_interval(hours => hrs) loop
    perform _execute_trade(t);
  end loop;
  perform draft_tick();
end $$;

-- chat @mentions -> notifications
create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.kind <> 'user' then return new; end if;
  for t in select id, gm_name from teams where id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), '/chat?c=' || new.channel);
  end loop;
  return new;
end $$;
create trigger messages_mentions after insert on public.messages for each row execute function public._mention_notify();

-- ───────────────────────────── grants ─────────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.my_team(), public.is_commish(), public.today_et(), public.slot_ok(text[], text, text),
  public.player_locked(int), public.take_snapshots(), public.calc_fpts(jsonb), public.rescore_all(),
  public.move_player(int, text, int), public.auto_lineup(), public.top_scorer(int), public.set_keepers(int[]),
  public.finalize_keepers(), public.draft_set_order(int[]), public.draft_randomize_order(), public.draft_pick(int),
  public.draft_tick(), public.draft_start(), public.draft_pause(), public.draft_resume(), public.draft_undo(),
  public.draft_reset(), public.set_autodraft(boolean), public.commish_set_pick_owner(int, int),
  public.add_player(int, int, boolean), public.drop_player(int),
  public.propose_trade(int, int[], int[], int[], int[], text), public.respond_trade(bigint, boolean),
  public.cancel_trade(bigint), public.review_trade(bigint, boolean, text),
  public.create_bet(int, text, text, text, text, numeric, date, date), public.respond_bet(bigint, boolean),
  public.cancel_bet(bigint), public.claim_bet(bigint, int), public.confirm_bet(bigint),
  public.commish_settle_bet(bigint, int), public.mark_bet_paid(bigint),
  public.create_proposal(text, text), public.cosponsor_proposal(bigint), public.vote_proposal(bigint, text),
  public.close_proposal(bigint, text), public.update_my_team(text, text, text, text, text, boolean),
  public.touch_seen(), public.commish_update_league(jsonb), public.commish_move_player(int, int, text),
  public.commish_set_keeper(int, boolean), public.commish_reset_password(int, text),
  public.commish_ledger(int, text, numeric, text), public.commish_mark_paid(bigint, boolean)
to authenticated;
grant execute on all functions in schema public to service_role;
