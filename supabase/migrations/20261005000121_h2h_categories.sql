-- Head-to-head categories (docs/SUPERPOOLS.md section 7, item 8): a head-to-head league can play its weekly matchups
-- for categories instead of points. Each week the two teams' started players are totalled in each of the league's
-- categories (the same categories and the same rule as rotisserie: never the bench or IR); whoever wins more categories
-- wins the week, and the table stays wins, losses and ties, with categories won as the tie-breaker where a points
-- league uses points for. The playoffs are decided the same way, a tie to the higher seed. Points and rotisserie
-- leagues (SaK) are untouched.
--
-- * _h2h_result(a, b, from, to): one pairing over some days: the points each scored, or in a category league the
--   categories each won and every category's values. The weekly scores and the bracket both read it.
-- * h2h_scores() gains each matchup's categories (cats), and its scores are categories won in a category league.
-- * commish_set_format and commish_set_categories no longer refuse the other: categories with head-to-head is this.

set client_min_messages = warning;

create or replace function public._h2h_result(p_a int, p_b int, p_from date, p_to date)
returns table (a_score numeric, b_score numeric, cats jsonb)
language plpgsql stable set search_path = public as $$
declare keys text[];
begin
  select r.categories into keys from league_rules r where r.league_id = current_league_id();
  if keys is null then
    -- a points league: the started players' fantasy points over those days
    return query select
      coalesce((select sum(d.points) from team_daily d where d.team_id = p_a and d.date between p_from and p_to), 0),
      case when p_b is not null then coalesce((select sum(d.points) from team_daily d where d.team_id = p_b and d.date between p_from and p_to), 0) end,
      null::jsonb;
    return;
  end if;
  if p_b is null then
    return query select 0::numeric, null::numeric, null::jsonb;   -- a bye: nothing to count
    return;
  end if;
  return query
    with cat as (
      select x.value as def, x.value->>'key' as key, coalesce((x.value->>'low')::boolean, false) as low, x.o
      from jsonb_array_elements(_category_catalogue()) with ordinality x(value, o)
      where x.value->>'key' = any (keys)
    ), started as (
      select s.team_id, pg.stats
      from lineup_snapshots s
      join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
      join games g on g.id = s.game_id
      where s.league_id = current_league_id() and s.team_id in (p_a, p_b) and s.slot not in ('BN', 'IR') and g.game_type = 2
        and s.date between p_from and p_to
    ), sums as (
      select st.team_id, e.key, sum(e.value::numeric) as v from started st, jsonb_each_text(st.stats) e group by 1, 2
    ), val as (
      -- a rate (goals against per start, save percentage) is a total over a total; with no starts behind it, it's empty
      select cat.key, cat.low, cat.o, tm.team_id,
        case when cat.def ? 'num'
          then round((select v from sums where sums.team_id = tm.team_id and sums.key = cat.def->>'num')
                     / nullif((select v from sums where sums.team_id = tm.team_id and sums.key = cat.def->>'den'), 0), 3)
          else coalesce((select v from sums where sums.team_id = tm.team_id and sums.key = cat.key), 0) end as value
      from cat cross join (values (p_a), (p_b)) tm(team_id)
    ), pair as (
      select a.key, a.o, a.value as va, b.value as vb,
        -- the better value wins the category (lower for a goals-against rate); an empty rate loses to any; equal is a tie
        case when a.value is null and b.value is null then 'tie' when b.value is null then 'a' when a.value is null then 'b'
             when a.value = b.value then 'tie' when (a.value > b.value) <> a.low then 'a' else 'b' end as win
      from val a join val b on b.key = a.key and b.team_id = p_b
      where a.team_id = p_a
    )
    select count(*) filter (where win = 'a')::numeric, count(*) filter (where win = 'b')::numeric,
      jsonb_object_agg(key, jsonb_build_object('a', va, 'b', vb, 'win', win) order by o)
    from pair;
end $$;
revoke execute on function public._h2h_result(int, int, date, date) from public, anon;
grant execute on function public._h2h_result(int, int, date, date) to authenticated, service_role;

-- the weekly scores, now through _h2h_result, with each matchup's categories (null in a points league)
drop function if exists public.h2h_scores();
create function public.h2h_scores()
returns table (id bigint, week int, starts date, ends date, home_team int, away_team int, home_pts numeric, away_pts numeric, status text, cats jsonb)
language sql stable set search_path = public as $$
  select m.id, m.week, m.starts, m.ends, m.home_team, m.away_team, x.a_score, x.b_score,
    case when m.ends < today_et() then 'final' when m.starts <= today_et() then 'live' else 'upcoming' end, x.cats
  from matchups m
  cross join lateral _h2h_result(m.home_team, m.away_team, m.starts, m.ends) x
  where m.league_id = current_league_id()
  order by m.week, m.id
$$;
revoke execute on function public.h2h_scores() from public, anon;
grant execute on function public.h2h_scores() to authenticated, service_role;

-- the bracket scores its meetings the same way (points, or categories won)
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
        select x.a_score, x.b_score into hp, lp from _h2h_result(seed_team[a], seed_team[b], s, e) x;
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

-- head-to-head and categories now go together
create or replace function public.commish_set_format(p_format text) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  if p_format not in ('season', 'h2h') then raise exception 'A league plays the season total or head-to-head'; end if;
  update league_rules set format = p_format, updated_at = now() where league_id = current_league_id();
  return p_format;
end $$;

create or replace function public.commish_set_categories(p_keys text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare keys text[] := (select array_agg(distinct k) from unnest(coalesce(p_keys, '{}')) k where btrim(k) <> '');
begin
  perform _commish();
  if keys is null then
    update league_rules set categories = null, updated_at = now() where league_id = current_league_id();
    return null;
  end if;
  if exists (select 1 from unnest(keys) k where not exists (select 1 from jsonb_array_elements(_category_catalogue()) c where c->>'key' = k)) then
    raise exception 'Pick categories from the list';
  end if;
  if cardinality(keys) not between 3 and 12 then raise exception 'A category league plays 3 to 12 categories'; end if;
  -- kept in the catalogue's order, so every page lists them the same way
  keys := (select array_agg(c->>'key' order by o) from jsonb_array_elements(_category_catalogue()) with ordinality x(c, o) where c->>'key' = any (keys));
  update league_rules set categories = keys, updated_at = now() where league_id = current_league_id();
  return keys;
end $$;
