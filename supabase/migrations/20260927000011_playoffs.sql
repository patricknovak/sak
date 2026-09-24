-- SaK keeps going through the NHL playoffs with the same rosters. Regular-season games feed the
-- regular-season standings; playoff games feed a separate playoff table. The prize pool (entry fee
-- minus the SaK Fund share, times the number of teams) is split between the two: by default 60%
-- regular season and 40% playoffs, each paid 1st/2nd/3rd by prize_split.

-- NHL game ids encode the game type: 2026020001 is regular season (02), 2026030111 is playoffs (03)
alter table public.games add column if not exists game_type int
  generated always as (coalesce(nullif(substring(id::text from 5 for 2), '')::int, 2)) stored;

alter table public.league add column if not exists playoff_share numeric not null default 40
  check (playoff_share >= 0 and playoff_share <= 100);

-- every fantasy point, tagged regular season (2) or playoffs (3). Standings stay visible after the
-- season ends (offseason) so the final tables can be settled.
create or replace view public.team_daily_all as
  select s.team_id, s.date, g.game_type, round(sum(pg.fpts), 2) as points, count(*) as games
  from lineup_snapshots s
  join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
  join games g on g.id = s.game_id
  join league l on l.id = 1
  where s.slot not in ('BN', 'IR') and s.date >= coalesce(l.season_start, s.date) and l.phase in ('season', 'offseason')
  group by s.team_id, s.date, g.game_type;

create or replace view public.team_daily as
  select team_id, date, sum(points) as points, sum(games)::bigint as games
  from team_daily_all where game_type = 2 group by team_id, date;

create or replace view public.playoff_daily as
  select team_id, date, sum(points) as points, sum(games)::bigint as games
  from team_daily_all where game_type = 3 group by team_id, date;

create or replace view public.playoff_standings as
  with agg as (
    select t.id as team_id,
      coalesce(sum(d.points), 0) as points,
      coalesce(sum(d.points) filter (where d.date = today_et()), 0) as today,
      coalesce(sum(d.points) filter (where d.date = today_et() - 1), 0) as yesterday,
      coalesce(sum(d.points) filter (where d.date > today_et() - 7), 0) as last7,
      coalesce(sum(d.games), 0) as games
    from teams t left join playoff_daily d on d.team_id = t.id
    group by t.id
  )
  select agg.*, rank() over (order by points desc) as rank from agg;

grant select on public.team_daily_all, public.team_daily, public.playoff_daily, public.playoff_standings to authenticated;

-- the commissioner can now also set the money: entry fee, SaK Fund share, 1st/2nd/3rd split and
-- the playoff share of the pool
create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
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
    extra_acq_fee = coalesce((p->>'extra_acq_fee')::numeric, extra_acq_fee),
    entry_fee = coalesce((p->>'entry_fee')::numeric, entry_fee),
    sak_fee = coalesce((p->>'sak_fee')::numeric, sak_fee),
    prize_split = coalesce(p->'prize_split', prize_split),
    playoff_share = coalesce((p->>'playoff_share')::numeric, playoff_share),
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

-- this season's money: $200 entry, $25 to the SaK Fund, pool paid 60/30/10, 40% of it in the playoffs
update public.league set entry_fee = 200, sak_fee = 25, prize_split = '[60,30,10]', playoff_share = 40 where id = 1;

-- Supabase hands new views to anon with full privileges; views are read-only standings data for
-- signed-in GMs only (team_directory stays public for the login screen)
revoke all on public.team_daily_all, public.team_daily, public.playoff_daily, public.playoff_standings,
  public.player_season, public.standings from anon, authenticated;
grant select on public.team_daily_all, public.team_daily, public.playoff_daily, public.playoff_standings,
  public.player_season, public.standings to authenticated;
revoke all on public.team_directory from anon, authenticated;
grant select on public.team_directory to anon, authenticated;
do $$ begin
  -- a one-off roster backup made during pre-season testing: nobody but the service role needs it
  if to_regclass('public.rosters_2526_backup') is not null then
    execute 'revoke all on public.rosters_2526_backup from anon, authenticated';
    execute 'alter table public.rosters_2526_backup enable row level security';
  end if;
end $$;
