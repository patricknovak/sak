-- Draft value in a category league (docs/SUPERPOOLS.md section 7, item 8). A rotisserie or head-to-head categories
-- league wins on its categories, not on fantasy points, so ranking its draft by points drafts the wrong players (a
-- big-hitting defenceman is worth far more in a hits league than his points say).
--
-- * category_values(): every player with a recent season, valued on the caller's league's categories: his pace last
--   season (per game) over the games he's projected to play, as a z-score against the draftable pool of his group
--   (the top 250 skaters or top 50 goalies by projection), lower being better for goals against; rates (goals against
--   per start, save percentage) count in proportion to the starts behind them. The value is the sum over the league's
--   categories; a points league gets no rows.
-- * _autopick_player: in a category league the robot drafts by that value; a points league (SaK) picks exactly as before.

set client_min_messages = warning;

create or replace function public.category_values()
returns table (player_id int, value numeric, rank int, z jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select r.categories from league_rules r where r.league_id = current_league_id() and r.categories is not null
  ), cat as (
    select c.value->>'key' as key, coalesce((c.value->>'low')::boolean, false) as low, c.value->>'num' as num, c.value->>'den' as den,
      case when c.value->>'key' in ('w', 'sho', 'sv', 'gaa', 'svp') then 'G' else 'S' end as grp
    from cfg, jsonb_array_elements(_category_catalogue()) c where c.value->>'key' = any (cfg.categories)
  ), pl as (
    select p.id, case when p.pos = 'G' then 'G' else 'S' end as grp, p.last_stats as s, p.proj,
      greatest(coalesce((p.last_stats->>'gp')::numeric, 0), 1) as gp,
      coalesce(nullif(p.proj_gp, 0), (p.last_stats->>'gp')::numeric, 0) as pgp
    from league_players p
    where p.last_stats is not null and coalesce((p.last_stats->>'gp')::numeric, 0) >= 10
  ), pool as (
    -- the players a draft is really choosing between
    select id from (select id, grp, row_number() over (partition by grp order by proj desc nulls last) as n from pl) x
    where (grp = 'S' and n <= 250) or (grp = 'G' and n <= 50)
  ), val as (
    select pl.id, pl.grp, cat.key, cat.low, cat.num is not null as rate,
      case when cat.num is not null
        then (pl.s->>cat.num)::numeric / nullif((pl.s->>cat.den)::numeric, 0)
        else coalesce((pl.s->>cat.key)::numeric, 0) / pl.gp * pl.pgp end as v,
      -- a rate is worth as much as the starts behind it: a full season's starter counts in full
      case when cat.num is not null then least(1, coalesce((pl.s->>'gs')::numeric, 0) / 50) * least(1, pl.pgp / 50) else 1 end as weight
    from pl join cat on cat.grp = pl.grp
  ), stats as (
    select v.key, avg(v.v) as mean, nullif(stddev_pop(v.v), 0) as sd
    from val v join pool on pool.id = v.id where v.v is not null group by v.key
  ), zs as (
    select v.id, v.key, coalesce(round(((v.v - st.mean) / st.sd) * case when v.low then -1 else 1 end * v.weight, 2), 0) as z
    from val v join stats st on st.key = v.key
  ), tot as (
    select id, sum(z) as value, jsonb_object_agg(key, z) as z from zs group by id
  )
  select tot.id, round(tot.value, 2), (rank() over (order by tot.value desc))::int, tot.z from tot
$$;
revoke execute on function public.category_values() from public, anon;
grant execute on function public.category_values() to authenticated, service_role;

-- the robot's pick: queue first, then positions it still needs, by category value in a category league, else points
CREATE OR REPLACE FUNCTION public._autopick_player(p_team integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with have as (select p.pos, count(*) n from rosters r join league_players p on p.id = r.player_id where r.team_id = p_team group by p.pos),
  lim(pos, mx, target) as (values ('C', 7, 4), ('LW', 7, 4), ('RW', 7, 4), ('D', 9, 6), ('G', 4, 3)),
  cv as (select player_id, value from category_values())
  select coalesce(
    (select q.player_id from draft_queue q where q.team_id = p_team
       and not exists (select 1 from rosters r where r.player_id = q.player_id and r.league_id = _league_of(p_team)) order by q.pos, q.player_id limit 1),
    (select p.id from league_players p join lim on lim.pos = p.pos left join have on have.pos = p.pos left join cv on cv.player_id = p.id
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team))
         and coalesce(have.n, 0) < lim.mx
         and coalesce(p.injury_status, '') !~* '^(out|ir\b|injured|suspen|long)'
       order by case when coalesce(have.n, 0) < lim.target then 0 else 1 end, cv.value desc nulls last, p.proj desc, p.last_fp desc limit 1),
    (select p.id from league_players p join lim on lim.pos = p.pos left join have on have.pos = p.pos left join cv on cv.player_id = p.id
       where not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = _league_of(p_team)) and coalesce(have.n, 0) < lim.mx
       order by cv.value desc nulls last, p.proj desc, p.last_fp desc limit 1))
$function$;
