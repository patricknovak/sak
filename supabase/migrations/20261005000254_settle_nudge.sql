-- The host hears when a question has closed and waits on them (the 13 October 2026 review: a premiere's questions
-- close at 3 am and the host settles them that evening; nothing said so). Eight hours after a question closes with no
-- result, the host (every commissioner) gets one bell for it, the questions folded into one line per run, each
-- question nudging once (private.soccer_nudged keeps the record, as the other nudges do). The pool's morning post
-- names them too; this is the bell on the phone.
create or replace function public._pool_settle_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare h record; ids bigint[]; titles text; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for h in select t.id from teams t where t.league_id = p_league and t.is_commish and t.user_id is not null loop
    select array_agg(m.id order by m.closes_at, m.id), string_agg(format('"%s"', left(m.title, 80)), ' · ' order by m.closes_at, m.id)
      into ids, titles
      from pool_markets m
      where m.league_id = p_league and m.status = 'open' and m.closes_at <= now() - interval '8 hours'
        and not exists (select 1 from private.soccer_nudged z where z.game = 'settle:' || m.id and z.game_id = p_league and z.team_id = h.id);
    if ids is null then continue; end if;
    perform _pool_alert(h.id, 'pool_settle',
      case when cardinality(ids) = 1 then format('⚖️ %s closed and waits on you: call the result on the Questions page.', titles)
           else format('⚖️ %s questions closed and wait on you: %s. Call each result on the Questions page.', cardinality(ids), titles) end,
      case when cardinality(ids) = 1 then '/q/' || ids[1] else '/questions' end);
    insert into private.soccer_nudged (game, game_id, team_id, gameweek)
      select 'settle:' || x, p_league, h.id, 0 from unnest(ids) x on conflict do nothing;
    n := n + cardinality(ids);
  end loop;
  return n;
end $$;
revoke execute on function public._pool_settle_nudge(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pack_refresh(current_league_id()) + _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _pool_settle_nudge(current_league_id()) + _streak_close(current_league_id()) + _sweep_tick(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;
