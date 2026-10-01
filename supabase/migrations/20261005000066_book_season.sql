-- Garry's Book, season edition: futures and season-long props, and the coin races.
--   * Futures: who wins the regular season, who finishes last (the booby prize), who wins the Playoff Cup and
--     who takes the full-year trophy. One option per GM team, priced from how the teams look right now (points
--     banked plus what the starters project to score over the games left) and re-priced every morning while
--     the market is open; a ticket keeps the odds it was placed at. Betting closes at the trade deadline.
--   * Season props: every team's season points over/under the Book's projection, and the biggest names'
--     season fantasy points (and goals, for the snipers) over/under their projection. Fixed lines at 1.9.
--   * Settlement: regular-season markets the day after the season ends from the standings and the season
--     stats; the playoff and full-year futures once the playoffs are over. Missing data refunds the market.
--   * Coin races: every GM's net coins this week, this month and this season, for the race leaderboards.
-- Everything reads the caller's league; the kinds and subjects are sport-agnostic (a stat key and a line).
set client_min_messages = warning;

do $$ begin
  alter table public.markets drop constraint if exists markets_kind_check;
  alter table public.markets add constraint markets_kind_check check (kind in ('winner', 'total', 'ot', 'prop', 'custom', 'future', 'season_prop'));
end $$;

-- long-shot odds for a many-way market: 8% house edge, between 1.1 and 30
create or replace function public._odds_long(p numeric) returns numeric
language sql immutable as $$ select least(30, greatest(1.1, round(0.92 / greatest(0.02, least(0.98, p)), 2))) $$;

-- how strong each team looks for the regular season: points banked plus what the starters project to score
-- over the share of the season still to play
create or replace function public._season_ratings() returns table (team_id int, points numeric, proj numeric, rating numeric, remaining numeric)
language sql stable security definer set search_path = public as $$
  with l as (select season_start, season_end from league),
  rem as (select case when l.season_start is null or l.season_end is null or l.season_end <= l.season_start then 1
                      else greatest(0, least(1, (l.season_end - greatest(today_et(), l.season_start))::numeric / (l.season_end - l.season_start))) end as remaining from l),
  tm as (select id from teams where role = 'gm' and league_id = current_league_id()),
  pr as (select r.team_id, sum(p.proj) as proj from rosters r join tm on tm.id = r.team_id join players p on p.id = r.player_id where r.slot not in ('BN', 'IR') group by r.team_id)
  select tm.id, coalesce(s.points, 0)::numeric, coalesce(pr.proj, 0)::numeric,
         round(coalesce(s.points, 0) + coalesce(pr.proj, 0) * rem.remaining, 1), rem.remaining
  from tm cross join rem left join standings s on s.team_id = tm.id left join pr on pr.team_id = tm.id
$$;

-- each team's chance at a future: a softmax over the ratings whose spread tightens as the season runs down.
-- The playoffs are a fresh table, so only roster strength counts there.
create or replace function public._future_probs(p_what text) returns table (team_id int, p numeric)
language sql stable security definer set search_path = public as $$
  with r as (select * from _season_ratings()),
  base as (
    select team_id,
      case p_what when 'johnson' then rating when 'peter' then -rating when 'playoffs' then proj * 0.25 else rating + proj * 0.25 end as x,
      case p_what when 'playoffs' then 20 else 25 + 120 * sqrt(remaining) end as sigma
    from r),
  e as (select team_id, exp((x - (select max(x) from base)) / sigma) as w from base)
  select team_id, round(w / (select sum(w) from e), 4) from e
$$;

create or replace function public._future_options(p_what text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('key', 't' || f.team_id, 'label', t.name, 'odds', _odds_long(f.p)) order by f.p desc, t.id)
  from _future_probs(p_what) f join teams t on t.id = f.team_id
$$;

-- open the season's futures and props once (idempotent per season); runs every morning with the Book
create or replace function public.open_season_markets() returns int
language plpgsql security definer set search_path = public as $$
declare l league; b jsonb; n int := 0; closes timestamptz; what text; t record; pr record; line numeric; booby text; trophy text;
begin
  select * into l from league;
  if l.id is null or l.phase <> 'season' or l.season_start is null or l.season_end is null then return 0; end if;
  if exists (select 1 from markets where kind = 'future' and subject->>'season' = l.season and league_id = current_league_id()) then return 0; end if;
  closes := coalesce(l.trade_deadline, (l.season_end - 30)::timestamptz);
  if closes <= now() then return 0; end if;
  select brand into b from leagues where id = current_league_id();
  booby := coalesce(b->>'booby', 'the booby prize'); trophy := coalesce(b->>'trophy', 'the Cup');
  foreach what in array array['johnson', 'peter', 'playoffs', 'cup'] loop
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('future',
      case what when 'johnson' then 'Regular season champion' when 'peter' then format('Last place: who holds %s?', booby)
                when 'playoffs' then 'Playoff Cup winner' else format('%s: the full-year winner', trophy) end,
      today_et(), jsonb_build_object('what', what, 'season', l.season), _future_options(what), closes, current_league_id());
    n := n + 1;
  end loop;
  -- every team's season points, over or under what the Book projects
  for t in select r.*, tm.name from _season_ratings() r join teams tm on tm.id = r.team_id order by r.rating desc loop
    line := floor(t.rating) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: season points', t.name), today_et(),
      jsonb_build_object('scope', 'team', 'team_id', t.team_id, 'stat', 'fpts', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  -- the biggest names: season fantasy points, and goals for the snipers (over or under last season's count)
  for pr in select id, name, proj from players where pos <> 'G' and proj > 0 order by proj desc limit 8 loop
    line := floor(pr.proj) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: season fantasy points', pr.name), today_et(),
      jsonb_build_object('scope', 'player', 'player_id', pr.id, 'stat', 'fpts', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  for pr in select id, name, (last_stats->>'g')::numeric as g from players
            where pos <> 'G' and last_stats ? 'g' and coalesce((last_stats->>'gp')::int, 0) >= 60 and (last_stats->>'g')::numeric >= 30
            order by (last_stats->>'g')::numeric desc limit 4 loop
    line := floor(pr.g) + 0.5;
    insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('season_prop', format('%s: goals this season', pr.name), today_et(),
      jsonb_build_object('scope', 'player', 'player_id', pr.id, 'stat', 'g', 'line', line, 'season', l.season),
      jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), closes, current_league_id());
    n := n + 1;
  end loop;
  perform _sys('general', format('🔮 The Book, season edition: futures on the champion, %s, the Playoff Cup and %s, plus season-long props on every team and the biggest names. Odds move with the standings; your ticket keeps the odds you took. Open until %s. 👉 #/bets?t=book',
    booby, trophy, to_char(closes at time zone 'America/Toronto', 'FMMonth FMDD')), jsonb_build_object('book', 'season'));
  return n;
end $$;

-- the futures move with the standings every morning; props keep their lines
create or replace function public.reprice_season_markets() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  update markets m set options = _future_options(m.subject->>'what')
  where m.kind = 'future' and m.status = 'open' and m.closes_at > now() and m.league_id = current_league_id();
  get diagnostics n = row_count;
  return n;
end $$;

-- pay the season markets once the answer is in: the regular-season ones the day after the season ends, the
-- playoff and full-year futures once the playoffs are over
create or replace function public.settle_season_markets() returns int
language plpgsql security definer set search_path = public as $$
declare l league; m markets; w text; v numeric; n int := 0; done_reg boolean; done_po boolean; mine int[];
begin
  select * into l from league;
  if l.id is null then return 0; end if;
  done_reg := l.season_end is not null and today_et() > l.season_end;
  done_po := l.playoffs_end is not null and today_et() > l.playoffs_end;
  if not done_reg and not done_po then return 0; end if;
  select array_agg(id) into mine from teams where role = 'gm' and league_id = current_league_id();
  for m in select * from markets where status = 'open' and kind in ('future', 'season_prop') and league_id = current_league_id() loop
    w := null;
    if m.kind = 'future' then
      if m.subject->>'what' = 'johnson' and done_reg then select 't' || team_id into w from standings where team_id = any(mine) order by rank, team_id limit 1;
      elsif m.subject->>'what' = 'peter' and done_reg then select 't' || team_id into w from standings where team_id = any(mine) order by rank desc, team_id limit 1;
      elsif m.subject->>'what' = 'playoffs' and done_po then select 't' || team_id into w from playoff_standings where team_id = any(mine) order by rank, team_id limit 1;
      elsif m.subject->>'what' = 'cup' and done_po then select 't' || team_id into w from sak_cup_standings where team_id = any(mine) order by rank, team_id limit 1;
      end if;
      if w is not null and _market_option_odds(m, w) is null then w := null; end if;
    elsif done_reg then
      if m.subject->>'scope' = 'team' then
        select points into v from standings where team_id = (m.subject->>'team_id')::int;
      else
        select case when m.subject->>'stat' = 'fpts' then fpts else (totals->>(m.subject->>'stat'))::numeric end into v
        from player_season where player_id = (m.subject->>'player_id')::int;
      end if;
      if v is null then perform _payout_market(m.id, null); continue; end if;   -- nothing to settle on: refund
      update markets set result = jsonb_build_object('value', v) where id = m.id;
      w := case when v > (m.subject->>'line')::numeric then 'over' else 'under' end;
    end if;
    if w is not null then perform _payout_market(m.id, w); n := n + 1; end if;
  end loop;
  if n > 0 then perform _sys('general', format('🔮 The Book settled %s season market%s. 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end), jsonb_build_object('book', 'season-settle')); end if;
  return n;
end $$;

-- the coin races: net coins per GM this week (from Monday), this month and this season (the opening grant aside)
create or replace view public.coin_races with (security_invoker = true) as
  with wk as (select date_trunc('week', now() at time zone 'America/New_York')::date as mon, date_trunc('month', now() at time zone 'America/New_York')::date as first)
  select t.id as team_id,
    coalesce(sum(c.amount) filter (where (c.created_at at time zone 'America/New_York')::date >= wk.mon), 0)::int as week,
    coalesce(sum(c.amount) filter (where (c.created_at at time zone 'America/New_York')::date >= wk.first), 0)::int as month,
    coalesce(sum(c.amount) filter (where c.reason not like 'Opening balance%'), 0)::int as season
  from teams t cross join wk left join coin_ledger c on c.team_id = t.id
  where t.role = 'gm'
  group by t.id, wk.mon, wk.first;
grant select on public.coin_races to authenticated;
