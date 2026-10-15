-- Review fixes to best ball and the guillotine (15 October 2026, migrations 276 to 281).
--
-- 1. Best ball counted players who joined a team after the night began. Snapshots are written whenever a game has
--    started, so a free agent added the morning after a big night (or a player traded in after puck drop) got a
--    snapshot for that night on the bench, and best ball's re-slot then counted him. A snapshot written more than ten
--    minutes after its game began, for a player the team added or traded for after that, was never on the team at
--    puck drop: best ball leaves him on the bench.
-- 2. The guillotine and the Book could read a night before best ball had re-slotted it (the jobs run at :41, :47 and
--    every half hour). Both now re-slot first in a best-ball league.
-- 3. The guillotine switched on on a Monday skipped that whole week, though all of it came after the switch: a week is
--    judged when it starts on or after the day it was switched on.
--    The same late snapshots counted as a missed start in every league's lineup efficiency; they don't any more.
-- 4. The days best ball and the guillotine began are kept by the server: an editor sending a stale copy of the league's
--    info no longer moves them, and switching an option off forgets the day, so switching it on again starts afresh.

-- a snapshot for a player who wasn't on the team when his game began
create or replace function public._snapshot_late(p_team int, p_player int, p_taken timestamptz, p_start timestamptz) returns boolean
language sql stable security invoker set search_path = public as $$
  select p_taken > p_start + interval '10 minutes' and (
    exists (select 1 from transactions t where t.team_id = p_team and t.player_id = p_player and t.type = 'add' and t.created_at >= p_start)
    or exists (select 1 from trade_items ti join trades tr on tr.id = ti.trade_id
               where ti.to_team = p_team and ti.player_id = p_player and tr.status in ('accepted', 'approved')
                 and coalesce(tr.decided_at, tr.responded_at, tr.created_at) >= p_start))
$$;
revoke execute on function public._snapshot_late(int, int, timestamptz, timestamptz) from public, anon;
grant execute on function public._snapshot_late(int, int, timestamptz, timestamptz) to authenticated, service_role;

-- the bench's regret (Insights, the voice's bench cost) leaves out the same late arrivals: a player who wasn't on the
-- team at puck drop was never a start the GM missed
create or replace function public.lineup_efficiency(p_from date default null, p_to date default null)
returns table (team_id int, date date, game_type int, points numeric, best numeric)
language sql stable security invoker set search_path = public as $$
  with l as (select season_start, roster from league),
  slots as (
    -- the starting slots in the optimizer's order, one entry per spot
    select array_agg(s.slot order by s.ord, g.i) as list
    from l, unnest(array['C', 'LW', 'RW', 'D', 'Util', 'G']) with ordinality as s(slot, ord),
      generate_series(1, greatest(coalesce((l.roster->>s.slot)::int, 0), 0)) as g(i)
  ),
  s as (
    select s.team_id, s.date, g.game_type, s.slot, lg.fpts, p.pos, p.elig,
      -- a player added or traded for after his game began was never a lineup choice that night (checked only for a
      -- snapshot written late, which a puck-drop snapshot never is)
      s.taken_at > g.start_utc + interval '10 minutes' and _snapshot_late(s.team_id, s.player_id, s.taken_at, g.start_utc) as late
    from lineup_snapshots s
    join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
    join games g on g.id = s.game_id
    join players p on p.id = s.player_id
    cross join l
    -- this league's teams only, even for a caller that skips row-level security (the service key)
    where s.league_id = current_league_id()
      and s.date >= coalesce(p_from, l.season_start, s.date)
      and s.date >= coalesce(l.season_start, s.date)
      and s.date <= coalesce(p_to, today_et())
  )
  select s.team_id, s.date, s.game_type,
    round(coalesce(sum(s.fpts) filter (where s.slot not in ('BN', 'IR')), 0), 2) as points,
    -- the lineup that played is one of the possible ones, so the best is never below it (even if the slots changed since)
    round(greatest(coalesce(sum(s.fpts) filter (where s.slot not in ('BN', 'IR')), 0),
      _best_lineup_points(coalesce(jsonb_agg(jsonb_build_object('pts', s.fpts, 'pos', s.pos, 'elig', to_jsonb(s.elig))) filter (where s.slot <> 'IR' and not s.late), '[]'),
                          (select list from slots))), 2) as best
  from s
  group by s.team_id, s.date, s.game_type
$$;

create or replace function public._bestball_day(p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); slots text[]; t record; best jsonb; n int := 0; c int;
begin
  select array_agg(s.slot order by s.ord, g.i) into slots
  from league_rules l, unnest(array['C', 'LW', 'RW', 'D', 'Util', 'G']) with ordinality as s(slot, ord),
    generate_series(1, greatest(coalesce((l.roster->>s.slot)::int, 0), 0)) as g(i)
  where l.league_id = lid;
  for t in select distinct s.team_id from lineup_snapshots s where s.league_id = lid and s.date = p_date loop
    -- the players on the team at puck drop, not on IR
    select _best_lineup_slots(coalesce(jsonb_agg(jsonb_build_object('id', s.player_id, 'pts', coalesce(lg.fpts, 0), 'pos', p.pos, 'elig', to_jsonb(p.elig))), '[]'), slots)
      into best
    from lineup_snapshots s
    join players p on p.id = s.player_id
    join games g on g.id = s.game_id
    left join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
    where s.league_id = lid and s.team_id = t.team_id and s.date = p_date and s.slot <> 'IR'
      and not _snapshot_late(s.team_id, s.player_id, s.taken_at, g.start_utc);
    -- a late arrival isn't in best, so he goes (or stays) to the bench
    update lineup_snapshots s set slot = coalesce(best->>s.player_id::text, 'BN')
    where s.league_id = lid and s.team_id = t.team_id and s.date = p_date and s.slot <> 'IR'
      and s.slot is distinct from coalesce(best->>s.player_id::text, 'BN');
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;
revoke execute on function public._bestball_day(date) from public, anon, authenticated;

create or replace function public._guillotine_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r league_rules; d date := today_et(); ws date; we date; alive int; loser record; p int; n int := 0;
begin
  select * into r from league_rules where league_id = current_league_id();
  if r.league_id is null or not league_has('guillotine') or r.categories is not null or r.format <> 'season'
     or r.phase <> 'season' or r.season_start is null then return 0; end if;
  -- the week that ended last Sunday (the league day is past it)
  we := d - extract(isodow from d)::int;
  ws := we - 6;
  if ws < r.season_start or ws < coalesce((r.info->>'guillotine_from')::date, today_et() + 1) then return 0; end if;
  if exists (select 1 from guillotine_cuts where league_id = r.league_id and week_start >= ws) then return 0; end if;
  select count(*) into alive from teams t where t.league_id = r.league_id and t.role = 'gm'
    and not exists (select 1 from guillotine_cuts c where c.league_id = r.league_id and c.team_id = t.id);
  if alive <= 1 then return 0; end if;
  -- in a best-ball league Sunday's lineups are re-slotted first, so the cut reads the week as best ball counts it
  if league_has('bestball') then perform _bestball_settle(); end if;
  select t.id, t.name, coalesce(w.pts, 0) as pts into loser
  from teams t
  left join (select td.team_id, sum(td.points) as pts from team_daily td where td.date between ws and we group by td.team_id) w on w.team_id = t.id
  left join (select td.team_id, sum(td.points) as pts from team_daily td where td.date >= r.season_start and td.date <= we group by td.team_id) s on s.team_id = t.id
  where t.league_id = r.league_id and t.role = 'gm'
    and not exists (select 1 from guillotine_cuts c where c.league_id = r.league_id and c.team_id = t.id)
  order by coalesce(w.pts, 0), coalesce(s.pts, 0), t.id desc
  limit 1;
  insert into guillotine_cuts (league_id, team_id, week_start, week_end, points, alive) values (r.league_id, loser.id, ws, we, loser.pts, alive);
  -- the roster goes back to free agency, each player a drop in the transactions
  for p in select player_id from rosters where team_id = loser.id loop
    delete from rosters where team_id = loser.id and player_id = p;
    insert into transactions (season, type, team_id, player_id) values (r.season, 'drop', loser.id, p);
    n := n + 1;
  end loop;
  update trades set status = 'cancelled', responded_at = now(), review_note = 'The guillotine cut a team in it'
  where league_id = r.league_id and status in ('proposed', 'accepted') and (from_team = loser.id or to_team = loser.id or loser.id = any (coalesce(parties, '{}')));
  perform _sys('general', format('🪓 The guillotine: %s is cut after the week of %s with %s points, the fewest of the %s teams still in. %s',
    loser.name, to_char(ws, 'FMMonth FMDD'), round(loser.pts, 1), alive,
    case when alive - 1 = 1 then 'One team left: the winner.' else format('Their %s players are free agents now. %s teams left.', n, alive - 1) end));
  perform _notify(t.id, 'guillotine', format('🪓 %s is cut by the guillotine: %s players hit free agency.', loser.name, n), '/players')
    from teams t where t.league_id = r.league_id and t.role = 'gm' and t.id <> loser.id
      and not exists (select 1 from guillotine_cuts c where c.league_id = r.league_id and c.team_id = t.id);
  perform _notify(loser.id, 'guillotine', format('🪓 The guillotine cut your team after the week of %s (%s points). You can still watch, chat and bet.', to_char(ws, 'FMMonth FMDD'), round(loser.pts, 1)), '/');
  return 1;
end $$;
revoke execute on function public._guillotine_tick() from public, anon, authenticated;

-- the hourly runner: in a best-ball league the Book and the side bets settle on the re-slotted nights
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions', 'h2h-notes', 'pool-drops', 'pool-settle', 'bestball', 'guillotine') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' and (p_job in ('pool-drops', 'pool-settle') or kind = 'fantasy') order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
      if p_job in ('settle-book', 'settle-bets') and league_has('bestball') then perform _bestball_settle(); end if;
      r := case p_job
        when 'open-book' then to_jsonb(open_markets())
        when 'open-book-season' then jsonb_build_array(open_season_markets(), open_nhl_markets(), reprice_season_markets())
        when 'settle-book' then settle_markets()
        when 'settle-book-season' then jsonb_build_array(settle_season_markets(), settle_race_markets())
        when 'settle-bets' then settle_due_bets()
        when 'predict' then to_jsonb(predict_tonight())
        when 'score-predictions' then to_jsonb(score_predictions())
        when 'h2h-notes' then to_jsonb(h2h_week_notes())
        when 'pool-drops' then to_jsonb(run_pool_drops())
        when 'pool-settle' then to_jsonb(run_pool_settle())
        when 'bestball' then to_jsonb(_bestball_settle())
        when 'guillotine' then to_jsonb(_guillotine_tick())
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

create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
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
    updated_at = now();
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
end $$;

