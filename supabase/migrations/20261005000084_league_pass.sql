-- Super Pools B4: the scheduler works league by league.
--
-- Until now every scheduled job ran as league 1: nothing told the database which league a job was for, so a second
-- league's Book never opened (or opened in SaK), its bets settled on SaK's season end, its lineups were checked
-- against SaK's roster caps, and anything a job wrote without naming a league fell back to the column default of 1.
--
-- Now:
--   * run_league_jobs(job) runs a scheduler job once for every active league, with that league set for the run
--     (app.league_id), and a failure in one league is logged without stopping the others. The Book's daily open,
--     its settling, the season markets and the bet settler go through it (the cron change is in the _cron migration).
--   * The edge functions use the service key, which belongs to no league: they can now name the league a request is
--     for with the x-league header (a GM's x-league still has to be one of their own leagues).
--   * A row written without a league takes the caller's league (current_league_id()), never league 1 by default.
--   * The Book's tonight markets, its settling and the bet settler work on the running league's own rows.
--   * Roster caps are the team's own league's, wherever a lineup is checked: a GM's own moves, the lineup plans
--     applied at puck drop (for every league's teams at once) and the auto-pilot.

set client_min_messages = warning;

-- the service role: the edge functions and the scheduler, never a GM
create or replace function public._is_service() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
                  nullif(current_setting('request.jwt.claim.role', true), '')) is not distinct from 'service_role'
$$;

create or replace function public.current_league_id() returns integer
language sql stable security definer set search_path = public as $$
  with hdr as (
    select nullif(current_setting('request.headers', true), '')::json ->> 'x-league' as v
  )
  select coalesce(
    nullif(current_setting('app.league_id', true), '')::int,
    -- an edge function names the league it is working for
    (select hdr.v::int from hdr where hdr.v ~ '^\d+$' and _is_service()),
    (select m.league_id from hdr, league_members m
      where hdr.v ~ '^\d+$' and m.user_id = auth.uid() and m.league_id = hdr.v::int),
    (select a.active_league_id from accounts a join league_members m on m.user_id = a.user_id and m.league_id = a.active_league_id
      where a.user_id = auth.uid()),
    (select min(league_id) from league_members where user_id = auth.uid()),
    case when auth.uid() is null then 1 end)
$$;

-- a row written without a league is the caller's league's
do $$
declare t record;
begin
  for t in
    select c.relname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attname = 'league_id' and not a.attisdropped
      and pg_get_expr((select d.adbin from pg_attrdef d where d.adrelid = c.oid and d.adnum = a.attnum), c.oid) is distinct from 'current_league_id()'
  loop
    execute format('alter table public.%I alter column league_id set default public.current_league_id()', t.relname);
  end loop;
end $$;

-- a slot's cap in a given league (the one-argument _cap reads the caller's league)
create or replace function public._cap(p_slot text, p_league int) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((roster ->> p_slot)::int, 0) from league_rules where league_id = p_league
$$;
revoke execute on function public._cap(text, int) from public, anon, authenticated;

-- the scheduler's jobs, once per active league
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
      r := case p_job
        when 'open-book' then to_jsonb(open_markets())
        when 'open-book-season' then jsonb_build_array(open_season_markets(), open_nhl_markets(), reprice_season_markets())
        when 'settle-book' then settle_markets()
        when 'settle-book-season' then jsonb_build_array(settle_season_markets(), settle_race_markets())
        when 'settle-bets' then settle_due_bets()
      end;
      out := out || jsonb_build_object(lid::text, r);
    exception when others then
      raise warning 'run_league_jobs % league %: %', p_job, lid, sqlerrm;
      out := out || jsonb_build_object(lid::text, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return out;
end $$;
revoke execute on function public.run_league_jobs(text) from public, anon, authenticated;

-- the old in-database auto-pilot: the running league's teams only
create or replace function public.run_auto_lineups() returns integer
language plpgsql security definer set search_path = public as $$
declare t int; n int := 0;
begin
  if (select phase from league) <> 'season' then return 0; end if;
  for t in select id from teams where auto_lineup and league_id = current_league_id() loop
    perform _auto_lineup(t); n := n + 1;
  end loop;
  return n;
end $$;

-- The rest: the current versions, with the running league's rows only (the Book's tonight markets, its settling,
-- the bet settler) and the team's own league's roster caps (the lineup plans, a lineup change, the auto-pilot).

CREATE OR REPLACE FUNCTION public.open_markets(p_date date DEFAULT today_et())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; n int := 0; fh numeric; fa numeric; ph numeric; pr record; line numeric; first_start timestamptz; ngames int := 0;
  short text := coalesce((select short_name from leagues where id = current_league_id()), 'fantasy');
begin
  for g in select * from games where date = p_date and start_utc > now() and state not in ('PPD', 'CNCL')
             and not exists (select 1 from markets m where m.game_id = games.id and m.created_by is null and m.league_id = current_league_id()) order by start_utc loop
    ngames := ngames + 1;
    first_start := coalesce(first_start, g.start_utc);
    fh := _club_form(g.home); fa := _club_form(g.away);
    ph := least(0.75, greatest(0.25, 0.54 + coalesce(fh - fa, 0) * 0.6));
    if not exists (select 1 from markets where game_id = g.id and kind = 'winner' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('winner', format('%s @ %s: who wins?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph))), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'total' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('total', format('%s @ %s: total goals', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away, 'line', 6.5),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9)), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'ot' and status = 'open' and league_id = current_league_id()) then
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('ot', format('%s @ %s: goes to overtime?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28)), g.start_utc, current_league_id());
      n := n + 1;
    end if;
    -- the league's points over/under on the two best skaters its GMs own in the game
    for pr in
      select p.id, p.name, r.team_id, coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp end, p.proj / 82.0, 0) as avg
      from league_players p join rosters r on r.player_id = p.id and r.league_id = coalesce(current_league_id(), 1) left join player_season ps on ps.player_id = p.id
      where p.nhl_team in (g.home, g.away) and p.pos <> 'G' and p.injury_status is null
      order by avg desc limit 2
    loop
      line := floor(pr.avg * 2) / 2;                       -- to the half point, always ending in .5 so there's no push
      if line = floor(line) then line := line + 0.5; end if;
      line := round(greatest(0.5, line), 1);
      insert into markets (kind, title, game_id, date, subject, options, closes_at, league_id) values
        ('prop', format('%s: %s points tonight', pr.name, short), g.id, p_date, jsonb_build_object('player_id', pr.id, 'stat', 'fpts', 'line', line, 'owner', pr.team_id),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), g.start_utc, current_league_id());
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then
    perform _sys('general', format('📖 Garry''s Book is open: %s game%s %s, %s markets. Moneylines, totals, overtime and player props, St. Patrick coins only. First puck drop %s ET. 👉 #/bets?t=book',
      ngames, case when ngames = 1 then '' else 's' end, case when p_date = today_et() then 'tonight' else 'on ' || to_char(p_date, 'FMDay FMMonth FMDD') end, n, to_char(first_start at time zone 'America/Toronto', 'FMHH:MI am')), jsonb_build_object('book', p_date));
  end if;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.settle_markets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; g games; w text; res jsonb; n int := 0; v int := 0; pg record; summary text;
begin
  for m in select * from markets where status = 'open' and closes_at < now() and kind <> 'custom' and league_id = current_league_id() loop
    select * into g from games where id = m.game_id;
    if g.id is null then continue; end if;
    if g.state in ('PPD', 'CNCL') then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    if g.state not in ('OFF', 'FINAL') or g.home_score is null then continue; end if;
    w := null; res := jsonb_build_object('home', g.home_score, 'away', g.away_score, 'period', g.period);
    if m.kind = 'winner' then
      w := case when g.home_score > g.away_score then 'home' when g.away_score > g.home_score then 'away' end;
    elsif m.kind = 'total' then
      w := case when g.home_score + g.away_score > (m.subject->>'line')::numeric then 'over' else 'under' end;
    elsif m.kind = 'ot' then
      w := case when g.period in ('OT', 'SO') then 'yes' else 'no' end;
    elsif m.kind = 'prop' then
      if not g.final_synced then continue; end if;   -- wait for the box score
      select * into pg from league_games where game_id = g.id and player_id = (m.subject->>'player_id')::int;
      if pg.player_id is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;   -- never dressed: void
      res := res || jsonb_build_object('value', pg.fpts);
      w := case when pg.fpts > (m.subject->>'line')::numeric then 'over' else 'under' end;
    end if;
    if w is null then perform _payout_market(m.id, null); v := v + 1; continue; end if;
    update markets set result = res where id = m.id;
    perform _payout_market(m.id, w);
    n := n + 1;
  end loop;
  -- one chat line per batch: who's up and who's down
  if n > 0 then
    select string_agg(format('%s %s%s', _tname(team_id), case when net >= 0 then '+' else '' end, net), ' · ' order by net desc) into summary
    from (select b.team_id, sum(coalesce(b.payout, 0) - b.coins)::int as net from market_bets b join markets mk on mk.id = b.market_id
          where mk.settled_at > now() - interval '2 minutes' and mk.league_id = current_league_id() group by b.team_id) x;
    if summary is not null then perform _sys('general', format('📖 Book settled %s market%s: %s 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end, summary), jsonb_build_object('book', 'settle')); end if;
  end if;
  return jsonb_build_object('settled', n, 'void', v);
end $function$;

CREATE OR REPLACE FUNCTION public.settle_due_bets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b bets; w int; n int := 0; pot int; best numeric; winners int[]; prog jsonb; e jsonb;
begin
  -- pools close for entries on their own
  update bets set status = 'accepted', accepted_at = now() where kind like 'pool%' and status = 'open' and entry_close < today_et() and league_id = current_league_id();
  for b in select * from bets where league_id = current_league_id() and status = 'accepted' and kind in ('h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player', 'season')
      and coalesce(case when kind = 'season' then (select season_end from league) end, end_date) < today_et() loop
    prog := bet_progress(b.id);
    if b.kind like 'pool%' then
      select max((x->>'value')::numeric) into best from jsonb_array_elements(prog->'entries') x;
      select array_agg((x->>'team_id')::int) into winners from jsonb_array_elements(prog->'entries') x where (x->>'value')::numeric = best;
      select coalesce(sum(coins), 0) into pot from bet_entries where bet_id = b.id;
      if winners is null or array_length(winners, 1) is null then
        update bets set status = 'cancelled' where id = b.id; continue;
      end if;
      insert into coin_ledger (team_id, amount, reason, bet_id) select team_id, -coins, 'Pool buy-in: ' || b.title, b.id from bet_entries where bet_id = b.id;
      insert into coin_ledger (team_id, amount, reason, bet_id) select x, pot / array_length(winners, 1), 'Won the pool: ' || b.title, b.id from unnest(winners) x;
      update bets set status = 'settled', winner_team = winners[1], settled_at = now(), result = prog || jsonb_build_object('winners', to_jsonb(winners), 'pot', pot) where id = b.id;
      perform _sys('general', format('🎰 Pool "%s" is settled: %s take%s the %s ☘️ pot', b.title, (select string_agg(_tname(x), ' and ') from unnest(winners) x), case when array_length(winners, 1) = 1 then 's' else '' end, pot), jsonb_build_object('bet', b.id));
    else
      w := _decide_bet(b);
      if w is null then
        update bets set status = 'settled', push = true, settled_at = now(), result = prog where id = b.id;
        perform _sys('general', format('🤝 Push: "%s" ended dead even. Coins back to both.', b.title), jsonb_build_object('bet', b.id));
      else
        update bets set status = 'settled', winner_team = w, settled_at = now(), result = prog where id = b.id;
        perform _settle_coins(b.id);
        perform _sys('general', format('🏆 %s wins the bet "%s" (%s)%s', _tname(w), b.title,
          case when b.kind in ('h2h', 'player_vs', 'season') then format('%s to %s', round((prog->>'a')::numeric, 1), round((prog->>'b')::numeric, 1)) else format('%s vs the line of %s', round((prog->>'value')::numeric, 1), prog->>'line') end,
          coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end, case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', b.id));
        perform _notify(w, 'bet', format('🏆 You won "%s"', b.title), '/bets');
      end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('settled', n, 'at', now());
end $function$;

CREATE OR REPLACE FUNCTION public.apply_lineup_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t int; d date := today_et(); moved int; total int := 0; s text; over int;
begin
  for t in select distinct lp.team_id from lineup_plans lp
    where lp.date = d and not exists (select 1 from lineup_plan_applied a where a.team_id = lp.team_id and a.date = d) loop
    with target as (
      select r.player_id, r.slot as cur,
        case
          when player_locked(r.player_id) or r.slot = 'IR' then r.slot
          when lp.slot is null or lp.slot = 'IR' then 'BN'
          when not slot_ok(pl.elig, pl.pos, lp.slot) then 'BN'
          else lp.slot end as slot
      from rosters r join league_players pl on pl.id = r.player_id
      left join lineup_plans lp on lp.team_id = r.team_id and lp.date = d and lp.player_id = r.player_id
      where r.team_id = t
    )
    update rosters r set slot = target.slot from target
    where r.player_id = target.player_id and r.team_id = t and r.slot is distinct from target.slot;
    get diagnostics moved = row_count;
    for s in select unnest(array['C','LW','RW','D','Util','G']) loop
      select count(*) - _cap(s, _league_of(t)) into over from rosters where team_id = t and slot = s;
      if over > 0 then
        update rosters set slot = 'BN' where team_id = t and player_id in (
          select r.player_id from rosters r join league_players pl on pl.id = r.player_id
          where r.team_id = t and r.slot = s and not player_locked(r.player_id) order by pl.proj asc limit over);
      end if;
    end loop;
    insert into lineup_plan_applied (team_id, date, moves) values (t, d, moved) on conflict do nothing;
    update teams set lineup_touched = d where id = t;
    total := total + 1;
  end loop;
  delete from lineup_plans where date < d - 7;
  delete from lineup_plan_applied where date < d - 30;
  return total;
end $function$;

CREATE OR REPLACE FUNCTION public._apply_lineup(p_team integer, p_slots jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k text; v text; r rosters; p players; n int := 0; s text;
begin
  perform take_snapshots();
  for k, v in select * from jsonb_each_text(p_slots) loop
    select * into r from rosters where player_id = k::int and team_id = p_team for update;
    if not found then raise exception 'Player % is not on this roster', k; end if;
    if r.slot = v or r.slot = 'IR' or v = 'IR' then continue; end if;
    select * into p from players where id = r.player_id;
    if player_locked(r.player_id) then raise exception '% is locked: his game has started', p.name; end if;
    if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
    update rosters set slot = v where player_id = r.player_id and team_id = p_team;
    n := n + 1;
  end loop;
  for s in select unnest(array['C','LW','RW','D','Util','G','BN','IR']) loop
    if (select count(*) from rosters where team_id = p_team and slot = s) > _cap(s, _league_of(p_team)) then
      raise exception 'Too many players at %', s;
    end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public._auto_lineup(p_team integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  cap jsonb := '{}';
  sl text;
  placed boolean;
begin
  perform take_snapshots();
  for sl in select unnest(array['C','LW','RW','D','Util','G']) loop
    cap := cap || jsonb_build_object(sl, _cap(sl, _league_of(p_team)) - (
      select count(*) from rosters r where r.team_id = p_team and r.slot = sl and player_locked(r.player_id)));
  end loop;

  update rosters r set slot = 'BN'
  where r.team_id = p_team and r.slot not in ('IR', 'BN') and not player_locked(r.player_id);

  for c in
    select r.player_id, p.pos, p.elig,
      exists (select 1 from games g where g.date = today_et() and p.nhl_team in (g.home, g.away)
              and g.state not in ('PPD','CNCL')) as plays,
      coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp * 80 end, p.proj, 0) as val
    from rosters r join league_players p on p.id = r.player_id
    left join player_season ps on ps.player_id = r.player_id
    where r.team_id = p_team and r.slot = 'BN' and not player_locked(r.player_id)
    order by plays desc, val desc
  loop
    placed := false;
    if c.pos = 'G' then
      if (cap ->> 'G')::int > 0 then
        update rosters set slot = 'G' where player_id = c.player_id and team_id = p_team;
        cap := jsonb_set(cap, '{G}', to_jsonb((cap ->> 'G')::int - 1));
      end if;
      continue;
    end if;
    foreach sl in array c.elig loop
      if sl in ('C','LW','RW','D') and (cap ->> sl)::int > 0 then
        update rosters set slot = sl where player_id = c.player_id and team_id = p_team;
        cap := jsonb_set(cap, array[sl], to_jsonb((cap ->> sl)::int - 1));
        placed := true;
        exit;
      end if;
    end loop;
    if not placed and (cap ->> 'Util')::int > 0 then
      update rosters set slot = 'Util' where player_id = c.player_id and team_id = p_team;
      cap := jsonb_set(cap, '{Util}', to_jsonb((cap ->> 'Util')::int - 1));
    end if;
  end loop;
end $function$;
