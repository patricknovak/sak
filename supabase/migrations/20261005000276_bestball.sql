-- Best ball (docs/SUPERPOOLS.md item 10, 15 October 2026): a league option where each night counts the best lineup the
-- team's players allowed, so nobody loses a night to a lineup left unset. Nothing about scoring changes: once a night
-- is over (the league day has moved on), every team's puck-drop snapshots for it are re-slotted to the best lineup in
-- hindsight (every player who played and wasn't on IR, in the league's starting slots, each where he's eligible, the
-- same solver as lineup_efficiency), and the standings, matchups, the Book and the voice read them as they always do.
-- The hourly job does the last three nights each time, so a stat correction re-picks the night; it never touches a
-- night before the commissioner switched it on (`info.bestball_from`). Points leagues only: categories have no single
-- best lineup. SaK doesn't have it.

-- the best lineup itself, not just its total: _best_lineup_points' solver, returning each placed player's slot
create or replace function public._best_lineup_slots(p_players jsonb, p_slots text[]) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  n int := coalesce(jsonb_array_length(p_players), 0); m int := coalesce(array_length(p_slots, 1), 0);
  ids text[]; pts numeric[]; pos text[]; elig jsonb[]; ok boolean[]; holder int[]; parent int[]; seen boolean[]; queue int[];
  i int; j int; k int; q int; head int; free_slot int; x jsonb; out jsonb := '{}';
begin
  if n = 0 or m = 0 then return out; end if;
  -- best first (ties by player, so a re-run picks the same lineup)
  for x in select value from jsonb_array_elements(p_players) order by (value->>'pts')::numeric desc, (value->>'id')::bigint loop
    ids := ids || (x->>'id'); pts := pts || (x->>'pts')::numeric; pos := pos || (x->>'pos'); elig := elig || (x->'elig');
  end loop;
  ok := array_fill(false, array[n * m]);
  for i in 1..n loop
    for j in 1..m loop
      ok[(i - 1) * m + j] := case p_slots[j] when 'G' then pos[i] = 'G' when 'Util' then pos[i] <> 'G'
        else pos[i] <> 'G' and coalesce(elig[i] ? p_slots[j], false) end;
    end loop;
  end loop;
  holder := array_fill(0, array[m]);
  for i in 1..n loop
    exit when pts[i] <= 0;
    parent := array_fill(0, array[m]); seen := array_fill(false, array[m]); queue := '{}'; free_slot := 0;
    for j in 1..m loop
      if ok[(i - 1) * m + j] then seen[j] := true; parent[j] := 0; queue := queue || j; end if;
    end loop;
    head := 1;
    while head <= coalesce(array_length(queue, 1), 0) and free_slot = 0 loop
      j := queue[head]; head := head + 1;
      if holder[j] = 0 then free_slot := j; exit; end if;
      k := holder[j];
      for q in 1..m loop
        if not seen[q] and ok[(k - 1) * m + q] then seen[q] := true; parent[q] := j; queue := queue || q; end if;
      end loop;
    end loop;
    if free_slot > 0 then
      j := free_slot;
      while parent[j] <> 0 loop holder[j] := holder[parent[j]]; j := parent[j]; end loop;
      holder[j] := i;
    end if;
  end loop;
  for j in 1..m loop
    if holder[j] > 0 then out := out || jsonb_build_object(ids[holder[j]], p_slots[j]); end if;
  end loop;
  return out;
end $$;
revoke execute on function public._best_lineup_slots(jsonb, text[]) from public, anon, authenticated;

-- one night, every team in the caller's league: each snapshot not on IR goes to its best slot or the bench
create or replace function public._bestball_day(p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); slots text[]; t record; best jsonb; n int := 0; c int;
begin
  select array_agg(s.slot order by s.ord, g.i) into slots
  from league_rules l, unnest(array['C', 'LW', 'RW', 'D', 'Util', 'G']) with ordinality as s(slot, ord),
    generate_series(1, greatest(coalesce((l.roster->>s.slot)::int, 0), 0)) as g(i)
  where l.league_id = lid;
  for t in select distinct s.team_id from lineup_snapshots s where s.league_id = lid and s.date = p_date loop
    select _best_lineup_slots(coalesce(jsonb_agg(jsonb_build_object('id', s.player_id, 'pts', coalesce(lg.fpts, 0), 'pos', p.pos, 'elig', to_jsonb(p.elig))), '[]'), slots)
      into best
    from lineup_snapshots s
    join players p on p.id = s.player_id
    left join league_games lg on lg.game_id = s.game_id and lg.player_id = s.player_id
    where s.league_id = lid and s.team_id = t.team_id and s.date = p_date and s.slot <> 'IR';
    update lineup_snapshots s set slot = coalesce(best->>s.player_id::text, 'BN')
    where s.league_id = lid and s.team_id = t.team_id and s.date = p_date and s.slot <> 'IR'
      and s.slot is distinct from coalesce(best->>s.player_id::text, 'BN');
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;
revoke execute on function public._bestball_day(date) from public, anon, authenticated;

-- the caller's league's last three finished nights, from the night best ball was switched on
create or replace function public._bestball_settle() returns int
language plpgsql security definer set search_path = public as $$
declare r league_rules; d date; n int := 0;
begin
  select * into r from league_rules where league_id = current_league_id();
  if r.league_id is null or not league_has('bestball') or r.categories is not null then return 0; end if;
  for d in select distinct s.date from lineup_snapshots s
           where s.league_id = r.league_id and s.date < today_et() and s.date >= today_et() - 3
             and s.date >= coalesce((r.info->>'bestball_from')::date, today_et())
           order by 1 loop
    n := n + _bestball_day(d);
  end loop;
  return n;
end $$;
revoke execute on function public._bestball_settle() from public, anon, authenticated;

-- the commissioner's switch: best ball joins money, the fund, the live room and usage
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
    if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_each(f) e where e.key not in ('money', 'fund', 'live_room', 'usage', 'bestball') or jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'Features are money, fund, live_room, usage and bestball, each on or off';
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
    info = coalesce(p->'info', info),
    features = features || coalesce(f, '{}'),
    updated_at = now();
  -- a league that turns its fund on gets its fund row (kept, with its history, if it is turned off again)
  -- best ball starts with the night being played, never re-counting the nights already scored
  if league_has('bestball') and not ((select info from league_rules where league_id = current_league_id()) ? 'bestball_from') then
    update league_rules set info = info || jsonb_build_object('bestball_from', today_et()) where league_id = current_league_id();
  end if;
  if league_has('fund') then
    insert into fund (league_id) values (current_league_id()) on conflict (league_id) do nothing;
  end if;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;

-- the hourly job (its schedule is migration 277)
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions', 'h2h-notes', 'pool-drops', 'pool-settle', 'bestball') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' and (p_job in ('pool-drops', 'pool-settle') or kind = 'fantasy') order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
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
