-- Fixes from a review of migrations 125 to 130.
--
-- * h2h_week_notes: "once each" looked at every alert a team ever had, so next season's identical lines (the schedule
--   is the same circle, "Week 1 starts today: you vs X") would never go out. It looks at the last three days now.
-- * category_values: only players with ten games last season had a value, so a rookie or a star who missed last season
--   sat below every veteran, autodraft included. A player's value now comes from the model's projected season line
--   when there is one (every projected player), last season's pace otherwise; and the rows come back in order.

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
    -- the projection's season line first (every player the model projects, rookies and the injured included: its
    -- totals are already over his projected games); else last season's pace over his projected games
    select p.id, case when p.pos = 'G' then 'G' else 'S' end as grp, p.proj,
      coalesce(p.proj_stats, p.last_stats) as s, p.proj_stats is not null as projected,
      greatest(coalesce((p.last_stats->>'gp')::numeric, 0), 1) as gp,
      coalesce(nullif(p.proj_gp, 0), (p.last_stats->>'gp')::numeric, 0) as pgp
    from league_players p
    where p.proj_stats is not null or (p.last_stats is not null and coalesce((p.last_stats->>'gp')::numeric, 0) >= 10)
  ), pool as (
    -- the players a draft is really choosing between
    select id from (select id, grp, row_number() over (partition by grp order by proj desc nulls last) as n from pl) x
    where (grp = 'S' and n <= 250) or (grp = 'G' and n <= 50)
  ), val as (
    select pl.id, pl.grp, cat.key, cat.low, cat.num is not null as rate,
      case when cat.num is not null
        then (pl.s->>cat.num)::numeric / nullif((pl.s->>cat.den)::numeric, 0)
        when pl.projected then coalesce((pl.s->>cat.key)::numeric, 0)
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
  order by tot.value desc, tot.id
$$;
revoke execute on function public.category_values() from public, anon;
grant execute on function public.category_values() to authenticated, service_role;

create or replace function public.h2h_week_notes() returns integer
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); r league_rules; d date := today_et(); n int := 0; m record; x record; g record;
  cats boolean; rounds int; msg text; t int; opp int; mine numeric; theirs numeric;
begin
  select * into r from league_rules where league_id = lid;
  if r.format is distinct from 'h2h' then return 0; end if;
  cats := r.categories is not null;
  -- last week's results, the morning after it ended
  for m in select * from matchups where league_id = lid and ends = d - 1 and away_team is not null loop
    select * into x from _h2h_result(m.home_team, m.away_team, m.starts, m.ends);
    foreach t in array array[m.home_team, m.away_team] loop
      opp := case when t = m.home_team then m.away_team else m.home_team end;
      mine := case when t = m.home_team then x.a_score else x.b_score end;
      theirs := case when t = m.home_team then x.b_score else x.a_score end;
      msg := format('⚔️ Week %s: %s %s, %s to %s%s.', m.week,
        case when mine > theirs then 'you beat' when mine < theirs then 'you lost to' else 'you tied' end, _tname(opp),
        case when cats then round(mine)::text else round(mine, 1)::text end, case when cats then round(theirs)::text else round(theirs, 1)::text end,
        case when cats then ' in categories' else '' end);
      if not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg and notifications.created_at > now() - interval '3 days') then
        perform _notify(t, 'matchup', msg, '/standings'); n := n + 1;
      end if;
    end loop;
  end loop;
  -- this week's opponent, the morning it starts
  for m in select * from matchups where league_id = lid and starts = d loop
    foreach t in array array_remove(array[m.home_team, m.away_team], null) loop
      opp := case when t = m.home_team then m.away_team else m.home_team end;
      msg := case when opp is null then format('💤 Week %s: you have the week off.', m.week)
                   else format('⚔️ Week %s starts today: you vs %s. Set your lineup.', m.week, _tname(opp)) end;
      if not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg and notifications.created_at > now() - interval '3 days') then
        perform _notify(t, 'matchup', msg, '/standings'); n := n + 1;
      end if;
    end loop;
  end loop;
  -- the playoffs, once the seeds hold: a round starting today, a round that ended yesterday
  if coalesce(r.h2h_playoffs, 0) >= 2 then
    select max(b.round) into rounds from h2h_bracket() b;
    for g in select * from h2h_bracket() b where b.seeded and (b.starts = d or b.ends = d - 1) loop
      foreach t in array array_remove(array[g.high_team, g.low_team], null) loop
        opp := case when t = g.high_team then g.low_team else g.high_team end;
        msg := case
          when g.starts = d and g.status = 'bye' then format('🏆 Playoffs: a bye through the %s.', lower(case rounds - g.round when 0 then 'final' when 1 then 'semifinal' when 2 then 'quarterfinal' else 'round ' || g.round end))
          when g.starts = d then format('🏆 Playoffs, %s starts today: you vs %s.', case rounds - g.round when 0 then 'the final' when 1 then 'semifinal' when 2 then 'quarterfinal' else 'round ' || g.round end, _tname(opp))
          when g.status = 'final' and g.winner = t then format('🏆 You won the %s against %s.', case rounds - g.round when 0 then 'final' when 1 then 'semifinal' when 2 then 'quarterfinal' else 'round ' || g.round end, _tname(opp))
          when g.status = 'final' then format('🏆 Out in the %s: %s went through.', case rounds - g.round when 0 then 'final' when 1 then 'semifinal' when 2 then 'quarterfinal' else 'round ' || g.round end, _tname(opp))
        end;
        if msg is not null and not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg and notifications.created_at > now() - interval '3 days') then
          perform _notify(t, 'matchup', msg, '/standings'); n := n + 1;
        end if;
      end loop;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.h2h_week_notes() from public, anon, authenticated;
