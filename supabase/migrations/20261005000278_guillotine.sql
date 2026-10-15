-- The guillotine (docs/SUPERPOOLS.md item 10, 15 October 2026): a league option where, every week, the team with the
-- fewest points is cut. Its players go back to free agency (each a drop, in the transactions like any other), its open
-- trades are called off, and from then on it can watch, chat and bet but never make a roster move. The last team
-- standing wins. A week is Monday to Sunday by the league day; the first full week of the season is the first one
-- judged, and its cut comes once Sunday's games are final (the hourly job). A tie goes against the lower season total.
-- Points leagues played for the season total only. SaK doesn't have it.

create table if not exists public.guillotine_cuts (
  league_id int not null default public.current_league_id() references public.leagues (id),
  team_id int not null references public.teams (id),
  week_start date not null,
  week_end date not null,
  points numeric not null,
  alive int not null,          -- teams still in when this one was cut, it included
  cut_at timestamptz not null default now(),
  primary key (league_id, team_id),
  unique (league_id, week_start)
);
alter table public.guillotine_cuts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.guillotine_cuts'::regclass and polname = 'league_reads') then
    create policy league_reads on public.guillotine_cuts for select to authenticated using (league_id = (select current_league_id()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.guillotine_cuts'::regclass and tgname = 'guillotine_cuts_stamp_league') then
    create trigger guillotine_cuts_stamp_league before insert on public.guillotine_cuts for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.guillotine_cuts from anon;
revoke insert, update, delete on public.guillotine_cuts from authenticated;
grant select on public.guillotine_cuts to authenticated;

-- a cut team's GM can still watch, chat and bet; the roster is done
create or replace function public._not_cut() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from guillotine_cuts where league_id = current_league_id() and team_id = my_team()) then
    raise exception 'The guillotine cut your team: you can still watch, chat and bet, but your roster is done';
  end if;
end $$;
revoke execute on function public._not_cut() from public, anon, authenticated;

-- every roster and trade move checks it, right after the GM check (the live definitions are patched, as the
-- spectator guard was in migration 16, so every later fix to them stays)
do $$
declare f record; src text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('add_player', 'propose_trade', 'propose_multi_trade', 'respond_trade',
      'set_lineup', 'move_player', 'set_lineup_plans', 'set_trade_block')
  loop
    src := pg_get_functiondef(f.oid);
    if position('_not_cut()' in src) = 0 then
      if position('perform _gm_only();' in src) > 0 then
        src := regexp_replace(src, 'perform _gm_only\(\);', 'perform _gm_only(); perform _not_cut();');
      else
        src := regexp_replace(src, '\mbegin\M', 'begin perform _not_cut();', 'i');   -- the first "begin" opens the body
      end if;
      execute src;
    end if;
  end loop;
end $$;

-- the caller's league's week to judge, if one is due: the last Monday-to-Sunday week that is over and starts on or
-- after the season's first day, with no cut yet; then its lowest team goes
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
  if ws < r.season_start then return 0; end if;
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

-- the commissioner's switch: the guillotine joins best ball
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
  if league_has('fund') then
    insert into fund (league_id) values (current_league_id()) on conflict (league_id) do nothing;
  end if;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;

-- the hourly job (its schedule is migration 279)
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
