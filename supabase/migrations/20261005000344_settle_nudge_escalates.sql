-- A closed question that waits on the host keeps ringing every three days (28 October 2026). Migration 254 nudged
-- once per question forever; show questions never auto-settle (no fixture, no feed), so one bell then silence left
-- them open for weeks. Same who, same questions, same wording; the dedupe key is still settle:<id>, but its stamp
-- ages out so the same question can nudge again after three days and not every hour.

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
        and not exists (select 1 from private.soccer_nudged z
                          where z.game = 'settle:' || m.id and z.game_id = p_league and z.team_id = h.id
                            and z.at > now() - interval '3 days');
    if ids is null then continue; end if;
    perform _pool_alert(h.id, 'pool_settle',
      case when cardinality(ids) = 1 then format('⚖️ %s closed and waits on you: call the result on the Questions page.', titles)
           else format('⚖️ %s questions closed and wait on you: %s. Call each result on the Questions page.', cardinality(ids), titles) end,
      case when cardinality(ids) = 1 then '/q/' || ids[1] else '/questions' end);
    insert into private.soccer_nudged (game, game_id, team_id, gameweek, at)
      select 'settle:' || x, p_league, h.id, 0, now() from unnest(ids) x
      on conflict (game, game_id, team_id, gameweek) do update set at = excluded.at;
    n := n + cardinality(ids);
  end loop;
  return n;
end $$;
revoke execute on function public._pool_settle_nudge(int) from public, anon, authenticated;
