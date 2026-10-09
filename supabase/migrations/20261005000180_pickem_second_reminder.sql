-- A second pick'em reminder (docs/DEVELOPMENT.md §6, beside migration 179's last call for last one standing): the
-- reminder six hours before a round's first kick-off went once a round, so after the NFL's Thursday game nobody with
-- Sunday's games still to pick heard again. Now a round already under way gets one more, before the rest of it, for
-- anyone with matches still to pick ("The rest of week 7 kicks off in 4h. You have 9 games still to pick").
create or replace function public._pool_game_nudge(p_league int) returns int
language plpgsql security definer set search_path = public, private as $$
declare g pool_games; s record; t record; n int := 0; lk timestamptz; hrs text; key int; left_n int;
begin
  for g in select * from pool_games where league_id = p_league and status = 'open' loop
    for s in select x.id, x.starts_at, coalesce(x.short, x.label) nm, false st from series x
             where g.kind = 'series' and x.competition = g.competition and x.round >= (g.rules->>'from_round')::int
               and x.high_club is not null and x.low_club is not null and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours'
             union all
             select 0, _rank_lock(g.id), 'ranking', false where g.kind = 'rank' and _rank_lock(g.id) between now() and now() + interval '6 hours'
             union all
             -- pick'em: a round whose first match still to come kicks off within six hours; `st` once the round is under
             -- way (the NFL's Thursday game), for a second reminder before the rest of it
             select f.gameweek, min(f.kickoff), _round_word(g.competition),
               exists (select 1 from fixtures f2 where f2.competition = g.competition and f2.gameweek = f.gameweek and f2.kickoff <= now())
             from fixtures f
             where g.kind = 'pickem' and f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now()
               and f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int
             group by f.gameweek having min(f.kickoff) <= now() + interval '6 hours'
             union all
             select x.id, x.starts_at, 'squares', false from series x
             where g.kind = 'squares' and g.draw is null and x.id = (g.rules->>'series')::bigint and x.state = 'scheduled'
               and x.starts_at between now() and now() + interval '6 hours' loop
      lk := s.starts_at;
      -- the second reminder of a round is kept apart from the first (its round as a negative number)
      key := case when s.st then -s.id else s.id end;
      hrs := case when lk - now() < interval '1 hour' then 'under an hour' else greatest(1, round(extract(epoch from lk - now()) / 3600))::int || 'h' end;
      for t in select tm.id from teams tm where tm.league_id = p_league and tm.role = 'gm' and tm.user_id is not null
                 and (case when g.kind = 'pickem' then
                        -- a match in the round still to come that they haven't picked
                        exists (select 1 from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                                and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id and pk.thing = 'f:' || f.id))
                      else not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = tm.id
                                 and (case when g.kind = 'squares' then pk.thing like 'sq:%'
                                           else pk.thing = case when s.id = 0 then 'rank' else 's:' || s.id end end)) end)
                 and not exists (select 1 from private.soccer_nudged x where x.game = g.kind and x.game_id = g.id and x.team_id = tm.id and x.gameweek = key) loop
        left_n := case when g.kind = 'pickem' then (select count(*) from fixtures f where f.competition = g.competition and f.gameweek = s.id and f.state = 'scheduled' and f.kickoff > now()
                    and not exists (select 1 from pool_picks pk where pk.game_id = g.id and pk.team_id = t.id and pk.thing = 'f:' || f.id)) end;
        perform _pool_alert(t.id, 'pool_game', case when g.kind = 'pickem' and s.st
          then format('⏰ The rest of %s %s kicks off in %s. You have %s still to pick in %s.', lower(s.nm), s.id, hrs,
                      case when left_n = 1 then 'one ' || _sport_word(g.competition, 'match', 'match')
                           else left_n || ' ' || case _sport_word(g.competition, 'match', 'match') when 'match' then 'matches' else _sport_word(g.competition, 'match', 'match') || 's' end end, g.title)
          when g.kind = 'pickem'
          then format('⏰ %s %s kicks off in %s. Pick your matches in %s.', s.nm, s.id, hrs, g.title)
          when g.kind = 'squares'
          then format('⏰ %s close in %s. Claim a square before the digits are drawn.', g.title, hrs)
          when s.id = 0 then format('⏰ Rank the teams locks in %s. Put the clubs in order.', hrs)
          else format('⏰ The %s starts in %s. Pick the winner and how many games.', s.nm, hrs) end, '/picks?g=' || g.id);
        insert into private.soccer_nudged (game, game_id, team_id, gameweek) values (g.kind, g.id, t.id, key) on conflict do nothing;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public._pool_game_nudge(int) from public, anon, authenticated;
