-- Head-to-head playoffs (docs/SUPERPOOLS.md section 7, item 8: "a head-to-head playoff bracket"). A head-to-head league
-- can end its season with a bracket: the top teams of the table meet one a week, the winner going on, until one is left.
--
-- * league_rules.h2h_playoffs: how many teams make the playoffs (0: none, the table decides it; else 2 to 16).
-- * commish_make_schedule(playoffs): the round robin now stops early enough to leave the bracket its weeks at the end
--   of the season (one a round: 2 teams take 1 week, 3 or 4 take 2, 5 to 8 take 3, 9 to 16 take 4). Without the
--   number it keeps the league's.
-- * h2h_bracket(): the bracket, worked out on read from the table and the weeks' points, never stored. The seeds are
--   the table's order (wins, ties as a half, then points for); before the regular season ends they are the seeds
--   "if it ended today". When the bracket isn't a power of two, the top seeds sit out the first round. A tie goes to
--   the higher seed. The weeks follow the schedule's last regular week, Monday to Sunday like every other.
-- SaK plays the season total and is untouched.

set client_min_messages = warning;

alter table public.league_rules add column if not exists h2h_playoffs int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'league_rules_h2h_playoffs_check') then
    alter table public.league_rules add constraint league_rules_h2h_playoffs_check check (h2h_playoffs = 0 or h2h_playoffs between 2 and 16);
  end if;
end $$;

-- the caller's league, now with its playoff spots (columns as before, h2h_playoffs added at the end)
create or replace view public.league with (security_invoker = true) as
  select id, name, short_name, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds, draft_rounds,
    snake, season_start, season_end, trade_deadline, trade_review_hours, max_acquisitions, extra_acq_fee, entry_fee, sak_fee,
    prize_split, roster, scoring, commish_note, info, updated_at, playoff_share, playoffs_end, cup_share, playoff_bonus_acq,
    league_id, features, categories, format, h2h_playoffs
  from league_rules where league_id = current_league_id();

-- the rounds a bracket of n teams takes: 2 -> 1, 3..4 -> 2, 5..8 -> 3, 9..16 -> 4
create or replace function public._bracket_rounds(n int) returns int
language sql immutable as $$
  select case when coalesce(n, 0) < 2 then 0 else ceil(log(2, n::numeric))::int end
$$;

-- the week that starts on a given day: to the Sunday, or the season's last day
create or replace function public._h2h_week_end(p_start date, p_last date) returns date
language sql immutable as $$
  select least(p_start + (7 - extract(isodow from p_start)::int), p_last)
$$;

-- the schedule now takes the playoff spots; the no-argument call (the site before this change) keeps the league's
drop function if exists public.commish_make_schedule();
create or replace function public.commish_make_schedule(p_playoffs int default null) returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); r league_rules; ids int[]; n int; rounds int; wk int := 0; s date; e date; i int; rd int[];
        a int; b int; flip boolean; po int; total int := 0; regular int;
begin
  perform _commish();
  select * into r from league_rules where league_id = lid;
  if r.format <> 'h2h' then raise exception 'The league plays the season total: switch it to head-to-head first'; end if;
  if r.season_start is null or r.season_end is null or r.season_end <= r.season_start then raise exception 'Set the season''s first and last days first'; end if;
  if exists (select 1 from matchups where league_id = lid and starts <= today_et()) then raise exception 'The schedule is set once its first week starts'; end if;
  select array_agg(id order by id) into ids from teams where league_id = lid and role = 'gm';
  if coalesce(cardinality(ids), 0) < 2 then raise exception 'Head-to-head needs two teams at least'; end if;
  po := coalesce(p_playoffs, r.h2h_playoffs);
  if po <> 0 and po not between 2 and 16 then raise exception 'The playoffs take 2 to 16 teams, or none'; end if;
  if po > cardinality(ids) then raise exception 'The league has % teams: the playoffs can take that many at most', cardinality(ids); end if;
  -- the season's weeks, then the last ones kept for the bracket
  s := r.season_start;
  while s <= r.season_end loop
    total := total + 1;
    s := _h2h_week_end(s, r.season_end) + 1;
  end loop;
  regular := total - _bracket_rounds(po);
  if regular < 1 then raise exception 'The season has % weeks: too few for % playoff rounds and a regular season', total, _bracket_rounds(po); end if;
  update league_rules set h2h_playoffs = po, updated_at = now() where league_id = lid;
  if cardinality(ids) % 2 = 1 then ids := ids || array[null::int]; end if;   -- a bye
  n := cardinality(ids); rounds := n - 1;
  delete from matchups where league_id = lid;
  s := r.season_start;
  while wk < regular loop
    e := _h2h_week_end(s, r.season_end);
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
revoke execute on function public.commish_make_schedule(int) from public, anon;
grant execute on function public.commish_make_schedule(int) to authenticated;

-- the bracket: one row a meeting, round by round, slot by slot (slot 1 holds the top seed's side of the draw)
create or replace function public.h2h_bracket()
returns table (round int, slot int, week int, starts date, ends date, high_seed int, high_team int, low_seed int, low_team int,
               high_pts numeric, low_pts numeric, status text, winner int, seeded boolean)
language plpgsql stable set search_path = public as $$
declare lid int := current_league_id(); po int; last_day date; reg_end date; reg_weeks int; nrounds int; size int;
        seeds int[]; seed_team int[]; cur int[]; nxt int[]; rd int; i int; a int; b int; s date; e date; hp numeric; lp numeric;
        st text; w int; is_seeded boolean;
begin
  select r.h2h_playoffs, r.season_end into po, last_day from league_rules r where r.league_id = lid and r.format = 'h2h';
  if coalesce(po, 0) < 2 then return; end if;
  select max(m.ends), max(m.week) into reg_end, reg_weeks from matchups m where m.league_id = lid;
  if reg_end is null then return; end if;
  is_seeded := reg_end < today_et();
  -- the seeds: the table's order, ties on record and points for going to the lower team id
  select array_agg(x.team_id order by x.rank, x.pf desc, x.team_id) into seed_team
  from h2h_standings() x;
  po := least(po, coalesce(cardinality(seed_team), 0));
  if po < 2 then return; end if;
  nrounds := _bracket_rounds(po);
  size := power(2, nrounds)::int;
  -- the draw: 1 v 8, 4 v 5, 2 v 7, 3 v 6 for eight; each seed s takes size + 1 - s next to it, so 1 and 2 meet last
  seeds := array[1];
  while cardinality(seeds) < size loop
    seeds := (select array_agg(v order by o, k) from unnest(seeds) with ordinality u(x, o), lateral (values (1, x), (2, cardinality(seeds) * 2 + 1 - x)) p(k, v));
  end loop;
  -- a seed past the field is an empty place (0); its opponent goes through. null: not decided yet
  cur := (select array_agg(case when x <= po then x else 0 end order by o) from unnest(seeds) with ordinality u(x, o));
  s := reg_end + 1;
  for rd in 1 .. nrounds loop
    -- a round past the season's last day (its dates moved after the schedule was made) still runs a full week
    e := _h2h_week_end(s, case when s > last_day then s + 6 else last_day end);
    nxt := '{}';
    for i in 1 .. cardinality(cur) / 2 loop
      a := cur[2 * i - 1]; b := cur[2 * i];
      -- the higher seed (lower number) is the high side
      if a is not null and b is not null and a <> 0 and b <> 0 and b < a then a := cur[2 * i]; b := cur[2 * i - 1]; end if;
      if b = 0 or a = 0 then
        -- a bye: the one in the field goes through
        w := nullif(greatest(a, b), 0);
        if a = 0 then a := b; end if;
        round := rd; slot := i; week := reg_weeks + rd; starts := s; ends := e;
        high_seed := a; high_team := case when a is not null then seed_team[a] end; low_seed := null; low_team := null;
        high_pts := null; low_pts := null; status := 'bye'; winner := high_team; seeded := is_seeded;
        return next;
        nxt := nxt || w;
        continue;
      end if;
      st := case when not is_seeded or a is null or b is null then 'upcoming'
                 when e < today_et() then 'final' when s <= today_et() then 'live' else 'upcoming' end;
      hp := null; lp := null;
      if st in ('live', 'final') then
        hp := coalesce((select sum(d.points) from team_daily d where d.team_id = seed_team[a] and d.date between s and e), 0);
        lp := coalesce((select sum(d.points) from team_daily d where d.team_id = seed_team[b] and d.date between s and e), 0);
      end if;
      -- a tie goes to the higher seed
      w := case when st = 'final' then case when lp > hp then b else a end end;
      round := rd; slot := i; week := reg_weeks + rd; starts := s; ends := e;
      high_seed := a; high_team := case when a is not null then seed_team[a] end;
      low_seed := b; low_team := case when b is not null then seed_team[b] end;
      high_pts := hp; low_pts := lp; status := st; winner := case when w is not null then seed_team[w] end; seeded := is_seeded;
      return next;
      nxt := nxt || w;
    end loop;
    cur := nxt;
    s := e + 1;
  end loop;
end $$;
revoke execute on function public.h2h_bracket() from public, anon;
grant execute on function public.h2h_bracket() to authenticated, service_role;
