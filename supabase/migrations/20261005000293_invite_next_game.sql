-- A sports pool's invite shows its next game (15 October 2026): a questions pool's link already asks its first question
-- (migration 252); a pick'em, last one standing or Call the score pool's showed only who invited you. The preview now
-- carries the pool's soonest game still to start ("NFL pick'em", "Week 7: 15 games", when it starts), drawn on the link's
-- card and picture and on the join page.

create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'ok', not i.revoked and i.expires_at >= now() and i.uses < i.max_uses
            and (i.team_id is null or not exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null)),
      'reason', case when i.revoked then 'revoked' when i.expires_at < now() then 'expired' when i.uses >= i.max_uses then 'used'
                     when i.team_id is not null and exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null) then 'taken'
                     else null end,
      'league', l.name, 'short', l.short_name, 'brand', l.brand, 'role', i.role,
      'team', (select t.name from teams t where t.id = i.team_id),
      'expires_at', i.expires_at, 'kind', l.kind)
      || case when l.kind = 'predict' then jsonb_build_object(
           'host', (select t.gm_name from teams t where t.league_id = l.id and t.is_commish and t.user_id is not null order by t.id limit 1),
           'members', (select count(*) from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
           'open_questions', (select count(*) from pool_markets m where m.league_id = l.id and m.status = 'open' and m.closes_at > now()))
           || coalesce((select jsonb_build_object('next_market', m.id, 'next_question', m.title, 'next_closes', m.closes_at,
                 'next_outcomes', (select jsonb_agg(jsonb_build_object('key', o->>'key', 'label', o->>'label',
                                     'pct', round(100 * coalesce((pool_prices(m.q, m.b) ->> (o->>'key'))::numeric, 0))) order by ord)
                                   from jsonb_array_elements(m.outcomes) with ordinality x(o, ord)))
               from pool_markets m where m.league_id = l.id and m.status = 'open' and m.closes_at > now()
               order by m.closes_at, m.sort, m.id limit 1), '{}'::jsonb)
           -- a sports pool's next game (migration 293): its soonest match still to start in an open pick'em, last one
           -- standing or Call the score, as "NFL pick'em" and "Week 7: 15 games"
           || coalesce((select jsonb_build_object('next_game', g.title,
                 'next_game_line', format('%s %s: %s %s', _round_word(f.competition), f.gameweek, n.n,
                                          case when n.n = 1 then _sport_word(f.competition, 'match', 'match') when _sport_word(f.competition, 'match', 'match') = 'match' then 'matches' else _sport_word(f.competition, 'match', 'match') || 's' end),
                 'next_game_at', f.kickoff)
               from pool_games g
               join fixtures f on f.competition = g.competition and f.state = 'scheduled' and f.kickoff > now() and f.gameweek is not null
                 and (g.kind <> 'pickem' or f.gameweek between (g.rules->>'from_round')::int and (g.rules->>'to_round')::int)
               cross join lateral (select count(*)::int n from fixtures x where x.competition = f.competition and x.gameweek = f.gameweek) n
               where g.league_id = l.id and g.status = 'open' and g.kind in ('pickem', 'survivor', 'score')
               order by f.kickoff, g.id limit 1), '{}'::jsonb)
         else '{}'::jsonb end
    from league_invites i join leagues l on l.id = i.league_id
    where i.code = lower(trim(p_code))), jsonb_build_object('ok', false, 'reason', 'unknown'))
$$;
