-- A pool made only by test accounts isn't a pool started (migration 268 left their calls and chat out; the TEST Love
-- Is Blind pool still counted as a pool started this week): pools and leagues are counted, this week and all time, when
-- at least one member is a real account. They stay on the list below the numbers, with nothing done in them. Safe to
-- run twice.

create or replace function public.platform_week() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '7 days'; out jsonb;
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  with real_members as (
    select m.league_id, m.user_id, m.joined_at from league_members m
    left join accounts a on a.user_id = m.user_id where not coalesce(a.is_test, false)
  ),
  -- what people did, leaving out test accounts (migration 268): a test account's calls and chat are testing, not use
  calls as (
    select c.league_id, c.team_id, c.at from (
      select league_id, team_id, created_at as at from pool_trades
      union all select league_id, team_id, picked_at from pool_picks
      union all select league_id, created_by, created_at from pool_markets where created_by is not null) c
    join teams t on t.id = c.team_id left join accounts a on a.user_id = t.user_id
    where not coalesce(a.is_test, false)
  ),
  talk as (
    select x.league_id, x.created_at from messages x join teams t on t.id = x.team_id left join accounts a on a.user_id = t.user_id
    where x.kind = 'user' and not coalesce(a.is_test, false)
  ),
  -- the stranger's path measured (section 8.4 item 4): members whose first call came within fifteen minutes of
  -- joining, which is what the invite's first call and the three-field form are for
  first_calls as (
    select m.league_id, m.user_id, m.joined_at
    from real_members m join teams t on t.league_id = m.league_id and t.user_id = m.user_id
    where exists (select 1 from calls c where c.league_id = m.league_id and c.team_id = t.id and c.at between m.joined_at and m.joined_at + interval '15 minutes')
  ),
  per_league as (
    select l.id, l.name, l.kind, l.status, l.created_at,
      (select count(*) from real_members m where m.league_id = l.id) as members,
      (select count(*) from real_members m where m.league_id = l.id and m.joined_at > since) as joined_7d,
      (select count(*) from calls c where c.league_id = l.id and c.at > since) as calls_7d,
      (select count(distinct c.team_id) from calls c where c.league_id = l.id and c.at > since) as callers_7d,
      (select count(*) from talk x where x.league_id = l.id and x.created_at > since) as messages_7d,
      greatest(l.created_at,
        (select max(c.at) from calls c where c.league_id = l.id),
        (select max(x.created_at) from talk x where x.league_id = l.id),
        (select max(t.last_seen) from teams t where t.league_id = l.id)) as last_alive
    from leagues l where l.status <> 'archived'
  )
  select jsonb_build_object(
    'since', since,
    'week', jsonb_build_object(
      'pools_started', (select count(*) from leagues where created_at > since and kind = 'predict' and id in (select league_id from real_members)),
      'leagues_started', (select count(*) from leagues where created_at > since and kind = 'fantasy' and id in (select league_id from real_members)),
      'people_joined', (select count(distinct user_id) from real_members where joined_at > since),
      'first_calls', (select count(*) from first_calls where joined_at > since),
      'calls', (select count(*) from calls where at > since),
      'messages', (select count(*) from talk where created_at > since),
      'links_made', (select count(*) from league_invites where created_at > since),
      'waitlist', (select count(*) from waitlist where created_at > since)),
    'all_time', jsonb_build_object(
      'pools', (select count(*) from leagues where kind = 'predict' and id in (select league_id from real_members)),
      'leagues', (select count(*) from leagues where kind = 'fantasy' and id in (select league_id from real_members)),
      'people', (select count(distinct user_id) from real_members),
      'first_calls', (select count(*) from first_calls),
      'calls', (select count(*) from calls),
      'messages', (select count(*) from talk),
      'waitlist', (select count(*) from waitlist)),
    'leagues', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'status', status, 'members', members,
        'joined_7d', joined_7d, 'calls_7d', calls_7d, 'callers_7d', callers_7d, 'messages_7d', messages_7d, 'last_alive', last_alive)
        order by last_alive desc nulls last, id), '[]'::jsonb) from per_league))
  into out;
  return out;
end $$;
