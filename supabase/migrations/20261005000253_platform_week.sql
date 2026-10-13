-- The week's numbers for the people who run Super Pools (the 13 October 2026 review, docs/DEVELOPMENT.md §8.4 item 2:
-- the numbers decide what's next). One read, platform admins only: the last seven days against all time (pools
-- started, people joined, calls made, chat messages, links shared), and every league with its members, its week's calls
-- and messages and when it was last alive, the quietest last. Calls are a question traded, a pick made or a lineup set;
-- test accounts (accounts.is_test) are left out of the people counts.
create or replace function public.platform_week() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '7 days'; out jsonb;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  with real_members as (
    select m.league_id, m.user_id, m.joined_at from league_members m
    left join accounts a on a.user_id = m.user_id where not coalesce(a.is_test, false)
  ),
  calls as (
    select league_id, team_id, created_at as at from pool_trades
    union all select league_id, team_id, picked_at from pool_picks
    union all select league_id, created_by, created_at from pool_markets where created_by is not null
  ),
  per_league as (
    select l.id, l.name, l.kind, l.status, l.created_at,
      (select count(*) from real_members m where m.league_id = l.id) as members,
      (select count(*) from real_members m where m.league_id = l.id and m.joined_at > since) as joined_7d,
      (select count(*) from calls c where c.league_id = l.id and c.at > since) as calls_7d,
      (select count(distinct c.team_id) from calls c where c.league_id = l.id and c.at > since) as callers_7d,
      (select count(*) from messages x where x.league_id = l.id and x.kind = 'user' and x.created_at > since) as messages_7d,
      greatest(l.created_at,
        (select max(c.at) from calls c where c.league_id = l.id),
        (select max(x.created_at) from messages x where x.league_id = l.id and x.kind = 'user'),
        (select max(t.last_seen) from teams t where t.league_id = l.id)) as last_alive
    from leagues l where l.status <> 'archived'
  )
  select jsonb_build_object(
    'since', since,
    'week', jsonb_build_object(
      'pools_started', (select count(*) from leagues where created_at > since and kind = 'predict'),
      'leagues_started', (select count(*) from leagues where created_at > since and kind = 'fantasy'),
      'people_joined', (select count(distinct user_id) from real_members where joined_at > since),
      'calls', (select count(*) from calls where at > since),
      'messages', (select count(*) from messages where kind = 'user' and created_at > since),
      'links_made', (select count(*) from league_invites where created_at > since),
      'waitlist', (select count(*) from waitlist where created_at > since)),
    'all_time', jsonb_build_object(
      'pools', (select count(*) from leagues where kind = 'predict'),
      'leagues', (select count(*) from leagues where kind = 'fantasy'),
      'people', (select count(distinct user_id) from real_members),
      'calls', (select count(*) from calls),
      'messages', (select count(*) from messages where kind = 'user'),
      'waitlist', (select count(*) from waitlist)),
    'leagues', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'status', status, 'members', members,
        'joined_7d', joined_7d, 'calls_7d', calls_7d, 'callers_7d', callers_7d, 'messages_7d', messages_7d, 'last_alive', last_alive)
        order by last_alive desc nulls last, id), '[]'::jsonb) from per_league))
  into out;
  return out;
end $$;
revoke execute on function public.platform_week() from public, anon;
grant execute on function public.platform_week() to authenticated;
