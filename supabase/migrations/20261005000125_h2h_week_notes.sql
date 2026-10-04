-- Head-to-head week alerts. In a head-to-head league the week is the unit: the morning a week starts, every GM hears who
-- they play (or that they have the week off), and the morning after one ends, how it went. The playoffs the same way,
-- round by round. They go through notifications, so they reach phones like every other alert (B8).
--
-- * h2h_week_notes(): the caller's league's alerts for today (Eastern), once each: a GM never hears the same line twice.
--   Nothing in a league that plays the season total. Run every morning for each active league by run_league_jobs.

set client_min_messages = warning;

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
      if not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg) then
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
      if not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg) then
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
        if msg is not null and not exists (select 1 from notifications where team_id = t and kind = 'matchup' and notifications.body = msg) then
          perform _notify(t, 'matchup', msg, '/standings'); n := n + 1;
        end if;
      end loop;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.h2h_week_notes() from public, anon, authenticated;

-- on the morning league pass with the other league jobs
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions', 'h2h-notes') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' order by id loop
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
