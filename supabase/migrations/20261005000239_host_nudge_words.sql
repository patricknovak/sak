-- The host's event nudge (migration 230) names the daily streak and the sweepstake beside the other games a pool can add
-- on the event. Wording only. Safe to run twice.

create or replace function public._pool_host_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare e record; h record; n int := 0;
begin
  if p_league is distinct from current_league_id() then return 0; end if;
  for e in select c.id, c.name, x.round, x.label, x.starts_at
           from competitions c
           cross join lateral (select s.round, min(s.label) label, min(s.starts_at) starts_at from series s
                               where s.competition = c.id and s.state = 'scheduled' and s.starts_at > now()
                                 and s.high_club is not null and s.low_club is not null
                               group by s.round order by s.round limit 1) x
           where c.active and c.format = 'series' and c.pack is not null
             and exists (select 1 from pool_markets m where m.league_id = p_league and m.pack = c.pack)
             and not exists (select 1 from pool_games g where g.league_id = p_league and g.competition = c.id and g.status = 'open')
             and x.starts_at <= now() + interval '2 days' loop
    for h in select t.id from teams t where t.league_id = p_league and t.is_commish
               and not exists (select 1 from private.soccer_nudged z where z.game = 'host_event:' || e.id and z.game_id = p_league and z.team_id = t.id and z.gameweek = e.round) loop
      perform _pool_alert(h.id, 'pool_game', format('🎯 The %s starts %s. Add a game on it for the pool: pick the series, a bracket, squares, a prop sheet on every game, the daily streak or the sweepstake, from the Host page.',
        regexp_replace(e.label, '^(AL|NL|AFC|NFC|East|West) ', ''), to_char(e.starts_at at time zone 'America/New_York', 'FMDay')), '/host');
      insert into private.soccer_nudged (game, game_id, team_id, gameweek) values ('host_event:' || e.id, p_league, h.id, e.round) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_host_nudge(int) from public, anon, authenticated;
