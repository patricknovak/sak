-- The guillotine starts with the first full week after it's switched on (15 October 2026): switched on midweek, the next
-- hourly run would otherwise have cut the week before, played before anyone knew. The switch records the day
-- (`info.guillotine_from`), and a week is judged only if it starts after it.

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
    info = coalesce(p->'info', info),
    features = features || coalesce(f, '{}'),
    updated_at = now();
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
  if ws < r.season_start or ws <= coalesce((r.info->>'guillotine_from')::date, today_et()) then return 0; end if;
  if exists (select 1 from guillotine_cuts where league_id = r.league_id and week_start >= ws) then return 0; end if;
  select count(*) into alive from teams t where t.league_id = r.league_id and t.role = 'gm'
    and not exists (select 1 from guillotine_cuts c where c.league_id = r.league_id and c.team_id = t.id);
  if alive <= 1 then return 0; end if;
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
