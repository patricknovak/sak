-- The first call before the account (the 13 October 2026 review, docs/DEVELOPMENT.md §8.4 item 4): the invite's
-- preview carries the first question's answers with the pool's prices, so the join page can let a stranger pick one
-- and place it the moment they are in. The prices are the pool's (pool_prices), read as chances; nobody's own calls
-- are shown.
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
         else '{}'::jsonb end
    from league_invites i join leagues l on l.id = i.league_id
    where i.code = lower(trim(p_code))), jsonb_build_object('ok', false, 'reason', 'unknown'))
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
