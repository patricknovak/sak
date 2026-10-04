-- Head-to-head (docs/SUPERPOOLS.md section 7, item 8, and docs/MARKET.md: the format most pools play). A league can play
-- weekly matchups instead of one season-long total: each week (Monday to Sunday, Eastern; the first week runs from
-- the season's first day to its first Sunday) every team meets one other, the one whose started players score more
-- fantasy points that week wins, and the table is wins, losses and ties, then points for. SaK plays the season total
-- and is untouched: league_rules.format stays 'season'.
--
-- * matchups: the schedule, a round robin over the regular season's weeks (an odd team count gives a bye each week).
--   Written only by commish_make_schedule; every member reads their own league's.
-- * h2h_scores(): every matchup with both teams' points that week (the same started-player points as the season
--   table) and whether it is upcoming, live or final.
-- * h2h_standings(): wins, losses, ties, points for and against from the final weeks.
-- * commish_set_format(format) and commish_make_schedule(): the commissioner's switch and the schedule, which can be
--   made again until the first week starts. Head-to-head plays for points; head-to-head categories come next.

set client_min_messages = warning;

alter table public.league_rules add column if not exists format text not null default 'season';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'league_rules_format_check') then
    alter table public.league_rules add constraint league_rules_format_check check (format in ('season', 'h2h'));
  end if;
end $$;

-- the caller's league, now with its format (columns as before, format added at the end)
create or replace view public.league with (security_invoker = true) as
  select id, name, short_name, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds, draft_rounds,
    snake, season_start, season_end, trade_deadline, trade_review_hours, max_acquisitions, extra_acq_fee, entry_fee, sak_fee,
    prize_split, roster, scoring, commish_note, info, updated_at, playoff_share, playoffs_end, cup_share, playoff_bonus_acq,
    league_id, features, categories, format
  from league_rules where league_id = current_league_id();

create table if not exists public.matchups (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  week int not null,
  starts date not null,
  ends date not null,
  home_team int not null references public.teams (id) on delete cascade,
  away_team int references public.teams (id) on delete cascade,      -- null: a bye
  unique (league_id, week, home_team)
);
create index if not exists matchups_league_week on public.matchups (league_id, week);
alter table public.matchups enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.matchups'::regclass and polname = 'read_league') then
    create policy read_league on public.matchups for select to authenticated using (league_id = (select current_league_id()));
  end if;
end $$;
revoke all on public.matchups from anon, authenticated;
grant select on public.matchups to authenticated;

create or replace function public.commish_set_format(p_format text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_format not in ('season', 'h2h') then raise exception 'A league plays the season total or head-to-head'; end if;
  if p_format = 'h2h' and (select categories from league_rules where league_id = current_league_id()) is not null then
    raise exception 'Head-to-head plays for points: switch rotisserie off first (head-to-head categories come next)';
  end if;
  update league_rules set format = p_format, updated_at = now() where league_id = current_league_id();
  return p_format;
end $$;
revoke execute on function public.commish_set_format(text) from public, anon;
grant execute on function public.commish_set_format(text) to authenticated;

-- a round robin over the regular season's weeks, by the circle method; made again freely until the first week starts
create or replace function public.commish_make_schedule() returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); r league_rules; ids int[]; n int; rounds int; wk int := 0; s date; e date; i int; rd int[];
        a int; b int; flip boolean;
begin
  perform _commish();
  select * into r from league_rules where league_id = lid;
  if r.format <> 'h2h' then raise exception 'The league plays the season total: switch it to head-to-head first'; end if;
  if r.season_start is null or r.season_end is null or r.season_end <= r.season_start then raise exception 'Set the season''s first and last days first'; end if;
  if exists (select 1 from matchups where league_id = lid and starts <= today_et()) then raise exception 'The schedule is set once its first week starts'; end if;
  select array_agg(id order by id) into ids from teams where league_id = lid and role = 'gm';
  if coalesce(cardinality(ids), 0) < 2 then raise exception 'Head-to-head needs two teams at least'; end if;
  if cardinality(ids) % 2 = 1 then ids := ids || array[null::int]; end if;   -- a bye
  n := cardinality(ids); rounds := n - 1;
  delete from matchups where league_id = lid;
  s := r.season_start;
  while s <= r.season_end loop
    -- the week runs to Sunday (isodow 7), or the season's last day
    e := least(s + (7 - extract(isodow from s)::int), r.season_end);
    wk := wk + 1;
    -- round (wk - 1) of the circle: the first team stays put, the rest turn one place each round
    rd := array[ids[1]] || (select array_agg(ids[2 + ((k - 2 + (wk - 1)) % (n - 1))] order by k) from generate_series(2, n) k);
    flip := ((wk - 1) / rounds) % 2 = 1;   -- the second time round, home and away swap
    for i in 1 .. n / 2 loop
      a := rd[i]; b := rd[n + 1 - i];
      if flip then a := rd[n + 1 - i]; b := rd[i]; end if;
      if a is null then a := b; b := null; end if;
      if a is not null then
        insert into matchups (league_id, week, starts, ends, home_team, away_team) values (lid, wk, s, e, a, b);
      end if;
    end loop;
    s := e + 1;
  end loop;
  return wk;
end $$;
revoke execute on function public.commish_make_schedule() from public, anon;
grant execute on function public.commish_make_schedule() to authenticated;

create or replace function public.h2h_scores()
returns table (id bigint, week int, starts date, ends date, home_team int, away_team int, home_pts numeric, away_pts numeric, status text)
language sql stable set search_path = public as $$
  select m.id, m.week, m.starts, m.ends, m.home_team, m.away_team,
    coalesce((select sum(d.points) from team_daily d where d.team_id = m.home_team and d.date between m.starts and m.ends), 0),
    case when m.away_team is not null then coalesce((select sum(d.points) from team_daily d where d.team_id = m.away_team and d.date between m.starts and m.ends), 0) end,
    case when m.ends < today_et() then 'final' when m.starts <= today_et() then 'live' else 'upcoming' end
  from matchups m where m.league_id = current_league_id()
  order by m.week, m.id
$$;
revoke execute on function public.h2h_scores() from public, anon;
grant execute on function public.h2h_scores() to authenticated, service_role;

create or replace function public.h2h_standings()
returns table (team_id int, w int, l int, t int, pf numeric, pa numeric, rank int)
language sql stable set search_path = public as $$
  with res as (
    select home_team as team, home_pts as f, away_pts as a from h2h_scores() where status = 'final' and away_team is not null
    union all
    select away_team, away_pts, home_pts from h2h_scores() where status = 'final' and away_team is not null
  ), agg as (
    select tm.id as team_id,
      count(*) filter (where r.f > r.a)::int as w, count(*) filter (where r.f < r.a)::int as l, count(*) filter (where r.f = r.a)::int as t,
      coalesce(sum(r.f), 0) as pf, coalesce(sum(r.a), 0) as pa
    from teams tm left join res r on r.team = tm.id
    where tm.league_id = current_league_id() and tm.role = 'gm'
    group by tm.id
  )
  select agg.*, (rank() over (order by agg.w + agg.t / 2.0 desc, agg.pf desc))::int from agg
$$;
revoke execute on function public.h2h_standings() from public, anon;
grant execute on function public.h2h_standings() to authenticated, service_role;

-- rotisserie and head-to-head don't mix yet
create or replace function public.commish_set_categories(p_keys text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare keys text[] := (select array_agg(distinct k) from unnest(coalesce(p_keys, '{}')) k where btrim(k) <> '');
begin
  perform _commish();
  if keys is not null and (select format from league_rules where league_id = current_league_id()) = 'h2h' then
    raise exception 'Rotisserie plays the season total: switch head-to-head off first (head-to-head categories come next)';
  end if;
  if keys is null then
    update league_rules set categories = null, updated_at = now() where league_id = current_league_id();
    return null;
  end if;
  if exists (select 1 from unnest(keys) k where not exists (select 1 from jsonb_array_elements(_category_catalogue()) c where c->>'key' = k)) then
    raise exception 'Pick categories from the list';
  end if;
  if cardinality(keys) not between 3 and 12 then raise exception 'A rotisserie league plays 3 to 12 categories'; end if;
  -- kept in the catalogue's order, so every page lists them the same way
  keys := (select array_agg(c->>'key' order by o) from jsonb_array_elements(_category_catalogue()) with ordinality x(c, o) where c->>'key' = any (keys));
  update league_rules set categories = keys, updated_at = now() where league_id = current_league_id();
  return keys;
end $$;

-- on the commissioner's log with the rest
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status',
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster', 'commish_set_categories', 'commish_set_format', 'commish_make_schedule'])
$$;
