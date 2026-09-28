-- Daily lineups set ahead of time (Yahoo-style), side bets that expire, stored projections and league reports.

-- ───────────── lineups planned by date ─────────────
-- A GM can set the lineup for any day up to 60 days out. On the morning of that day the plan becomes the live
-- lineup (and counts as a manual lineup, so the auto-pilot leaves it alone). Today is still edited live.
create table if not exists public.lineup_plans (
  team_id int not null references public.teams on delete cascade,
  date date not null,
  player_id int not null references public.players on delete cascade,
  slot text not null check (slot in ('C','LW','RW','D','Util','G','BN','IR')),
  set_at timestamptz not null default now(),
  primary key (team_id, date, player_id)
);
create index if not exists lineup_plans_date_idx on public.lineup_plans (date);
create table if not exists public.lineup_plan_applied (
  team_id int not null references public.teams on delete cascade,
  date date not null,
  moves int not null default 0,
  applied_at timestamptz not null default now(),
  primary key (team_id, date)
);
alter table public.lineup_plans enable row level security;
alter table public.lineup_plan_applied enable row level security;
revoke all on public.lineup_plans, public.lineup_plan_applied from anon, authenticated;
grant select on public.lineup_plans, public.lineup_plan_applied to authenticated;
grant all on public.lineup_plans, public.lineup_plan_applied to service_role;
drop policy if exists read_own on public.lineup_plans;
create policy read_own on public.lineup_plans for select to authenticated using (team_id = public.my_team() or public.is_commish());
drop policy if exists read_own on public.lineup_plan_applied;
create policy read_own on public.lineup_plan_applied for select to authenticated using (team_id = public.my_team() or public.is_commish());

-- save one or many days at once: {"2026-10-14": {"8478402": "C", "8477934": "BN", ...}, ...}.
-- Each day replaces whatever was planned for it. An empty object for a day clears that day's plan.
create or replace function public.set_lineup_plans(p_plans jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); d text; plan jsonb; dt date; k text; v text; p players; n int := 0; s text; cnt int;
  lg league;
begin
  perform _gm_only();
  if me is null then raise exception 'Not signed in'; end if;
  select * into lg from league;
  if jsonb_typeof(p_plans) <> 'object' then raise exception 'Plans must be an object of dates'; end if;
  for d, plan in select * from jsonb_each(p_plans) loop
    dt := d::date;
    if dt <= today_et() then raise exception 'Today''s lineup is set live on the lineup page (% is not in the future)', dt; end if;
    if dt > today_et() + 60 then raise exception 'Lineups can be set up to 60 days ahead'; end if;
    if lg.season_end is not null and dt > lg.season_end then raise exception '% is after the season ends', dt; end if;
    delete from lineup_plans where team_id = me and date = dt;
    if plan is null or plan = '{}'::jsonb then n := n + 1; continue; end if;
    for k, v in select * from jsonb_each_text(plan) loop
      if not exists (select 1 from rosters where player_id = k::int and team_id = me) then
        raise exception 'Player % is not on your roster', k;
      end if;
      select * into p from players where id = k::int;
      if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
      insert into lineup_plans (team_id, date, player_id, slot) values (me, dt, k::int, v);
    end loop;
    for s in select unnest(array['C','LW','RW','D','Util','G','IR']) loop
      select count(*) into cnt from lineup_plans where team_id = me and date = dt and slot = s;
      if cnt > _cap(s) then raise exception 'Too many players at % on %', s, to_char(dt, 'Mon DD'); end if;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.clear_lineup_plans(p_dates date[]) returns int
language plpgsql security definer set search_path = public as $$
declare me int := _team(); n int;
begin
  perform _gm_only();
  delete from lineup_plans where team_id = me and date = any (p_dates) and date > today_et();
  get diagnostics n = row_count;
  return n;
end $$;

-- turn today's plans into the live lineup. Idempotent: each team's plan is applied once per day. Players who
-- left the roster are ignored; players the plan doesn't mention sit on the bench (or stay on IR). A slot that
-- became invalid (IR for a player who got healthy, a position he lost) falls back to the bench.
create or replace function public.apply_lineup_plans() returns int
language plpgsql security definer set search_path = public as $$
declare t int; d date := today_et(); moved int; total int := 0; s text; over int;
begin
  for t in select distinct lp.team_id from lineup_plans lp
    where lp.date = d and not exists (select 1 from lineup_plan_applied a where a.team_id = lp.team_id and a.date = d) loop
    with target as (
      select r.player_id, r.slot as cur,
        case
          when player_locked(r.player_id) then r.slot
          when lp.slot is null then case when r.slot = 'IR' and pl.injury_status is not null then 'IR' else 'BN' end
          when not slot_ok(pl.elig, pl.pos, lp.slot) then 'BN'
          when lp.slot = 'IR' and pl.injury_status is null then 'BN'
          else lp.slot end as slot
      from rosters r join players pl on pl.id = r.player_id
      left join lineup_plans lp on lp.team_id = r.team_id and lp.date = d and lp.player_id = r.player_id
      where r.team_id = t
    )
    update rosters r set slot = target.slot from target
    where r.player_id = target.player_id and r.team_id = t and r.slot is distinct from target.slot;
    get diagnostics moved = row_count;
    -- never leave a starting slot over its cap (a trade or roster move since the plan was saved)
    for s in select unnest(array['C','LW','RW','D','Util','G','IR']) loop
      select count(*) - _cap(s) into over from rosters where team_id = t and slot = s;
      if over > 0 then
        update rosters set slot = 'BN' where player_id in (
          select r.player_id from rosters r join players pl on pl.id = r.player_id
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
end $$;

-- plans land before the first lineup freeze of the day: every snapshot (the scores task runs each minute, and
-- every lineup change calls it) applies any plan that's due first
create or replace function public.take_snapshots() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if exists (select 1 from lineup_plans lp where lp.date = today_et()
             and not exists (select 1 from lineup_plan_applied a where a.team_id = lp.team_id and a.date = lp.date)) then
    perform apply_lineup_plans();
  end if;
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

revoke execute on function public.apply_lineup_plans(), public.take_snapshots() from public, anon, authenticated;
revoke execute on function public.set_lineup_plans(jsonb), public.clear_lineup_plans(date[]) from public, anon;
grant execute on function public.set_lineup_plans(jsonb), public.clear_lineup_plans(date[]) to authenticated;
grant execute on function public.apply_lineup_plans() to service_role;

-- ───────────── side bets expire after 7 days if nobody takes them ─────────────
alter table public.bets drop constraint if exists bets_status_check;
alter table public.bets add constraint bets_status_check
  check (status in ('open', 'accepted', 'declined', 'cancelled', 'settled', 'expired'));

-- an open challenge or offer nobody accepted in 7 days, or a pool nobody else joined, expires. Coins held in
-- escrow are released automatically (escrow only counts open and accepted bets).
create or replace function public.expire_stale_bets() returns int
language plpgsql security definer set search_path = public as $$
declare b bets; n int := 0;
begin
  for b in select * from bets x where x.status = 'open' and x.created_at < now() - interval '7 days'
    and (x.kind not like 'pool%' or not exists (select 1 from bet_entries e where e.bet_id = x.id and e.team_id <> x.creator_team))
  loop
    update bets set status = 'expired' where id = b.id;
    delete from bet_entries where bet_id = b.id;
    perform _notify(b.creator_team, 'bet', format('⌛ Your bet "%s" expired: nobody took it within 7 days.%s', b.title,
      case when b.coins > 0 then ' Your coins are free again.' else '' end), '/bets');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_stale_bets() from public, anon, authenticated;
grant execute on function public.expire_stale_bets() to service_role;

-- ───────────── projections ─────────────
-- The projection model (nhl-sync?task=projections) stores a projected stat line per player; the fantasy
-- projection is that line priced under the league's scoring, so a scoring change reprices it at once.
alter table public.players add column if not exists proj_stats jsonb;   -- projected season totals (g, a, sog … / gs, w, sv …)
alter table public.players add column if not exists proj_gp numeric;     -- projected games played (starts for goalies)
alter table public.players add column if not exists proj_meta jsonb;     -- range, age, trend, factors, 3-season history

create or replace function public.recompute_player_values() returns void
language plpgsql security definer set search_path = public as $$
begin
  update players p set last_fp = calc_fpts(p.last_stats) where p.last_stats is not null;
  -- model projections where we have them; last season's pace otherwise
  update players p set proj = calc_fpts(p.proj_stats) where p.proj_stats is not null;
  update players p set
    proj = round(
      case when coalesce((p.last_stats->>'gp')::numeric, 0) = 0 then 0
      else calc_fpts(p.last_stats)
             / greatest(1, case when p.pos = 'G' then coalesce(nullif((p.last_stats->>'gs')::numeric, 0), (p.last_stats->>'gp')::numeric)
                                else (p.last_stats->>'gp')::numeric end)
             * (case when p.pos = 'G' then 58 else 78 end) * least((p.last_stats->>'gp')::numeric, 40) / 40
           + calc_fpts(p.last_stats) * (1 - least((p.last_stats->>'gp')::numeric, 40) / 40)
      end, 2)
  where p.last_stats is not null and p.proj_stats is null;
  with r as (select id, row_number() over (order by proj desc, last_fp desc, id) rn from players)
  update players p set rank = r.rn from r where r.id = p.id;
end $$;

-- the model hands over every player's projection in one call: [{id, stats, gp, meta}, ...]
create or replace function public.set_projections(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update players pl set proj_stats = x.stats, proj_gp = x.gp, proj_meta = x.meta, updated_at = now()
  from jsonb_to_recordset(p) as x(id int, stats jsonb, gp numeric, meta jsonb)
  where pl.id = x.id;
  get diagnostics n = row_count;
  perform recompute_player_values();
  return n;
end $$;
revoke execute on function public.set_projections(jsonb) from public, anon, authenticated;
grant execute on function public.set_projections(jsonb) to service_role;

-- ───────────── league reports (the draft analysis and anything like it) ─────────────
create table if not exists public.league_reports (
  id text primary key,                 -- e.g. 'draft-2026-27'
  kind text not null,
  season text not null,
  title text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.league_reports enable row level security;
revoke all on public.league_reports from anon, authenticated;
grant select on public.league_reports to authenticated;
grant all on public.league_reports to service_role;
drop policy if exists read_all on public.league_reports;
create policy read_all on public.league_reports for select to authenticated using (true);
