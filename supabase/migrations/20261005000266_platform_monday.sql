-- The Monday read (docs/DEVELOPMENT.md §8.4 item 2: "read it every Monday ... the numbers decide what's next"): the
-- week's numbers come to the platform admins instead of waiting on the Platform page. Each Monday morning every
-- platform admin gets one bell on their own team (the first active league they play in): pools started, people
-- joined, first calls within fifteen minutes, calls, chat messages, and the busiest pool, from platform_week(),
-- linking to the Platform page. Run by the platform-monday job (migration 267). Safe to run twice.

create or replace function public._platform_monday() returns int
language plpgsql security definer set search_path = public, ops as $$
declare a record; w jsonb; t record; busy jsonb; n int := 0; wk jsonb;
begin
  for a in select user_id from ops.platform_admins loop
    -- read the week as that admin (platform_week checks who is asking)
    perform set_config('request.jwt.claim.sub', a.user_id::text, true);
    w := platform_week();
    wk := w->'week';
    select tm.id, tm.league_id into t from teams tm join leagues l on l.id = tm.league_id
      where tm.user_id = a.user_id and l.status = 'active' order by l.id limit 1;
    continue when t.id is null;
    select x into busy from jsonb_array_elements(w->'leagues') x
      where (x->>'calls_7d')::int + (x->>'messages_7d')::int > 0
      order by (x->>'calls_7d')::int + (x->>'messages_7d')::int desc limit 1;
    insert into notifications (league_id, team_id, kind, body, link)
    values (t.league_id, t.id, 'platform_week', format('📈 Last week: %s pool%s started, %s %s joined, %s first call%s inside 15 minutes, %s call%s, %s chat message%s.%s',
      wk->>'pools_started', case when (wk->>'pools_started')::int = 1 then '' else 's' end,
      wk->>'people_joined', case when (wk->>'people_joined')::int = 1 then 'person' else 'people' end,
      wk->>'first_calls', case when (wk->>'first_calls')::int = 1 then '' else 's' end,
      wk->>'calls', case when (wk->>'calls')::int = 1 then '' else 's' end,
      wk->>'messages', case when (wk->>'messages')::int = 1 then '' else 's' end,
      case when busy is not null then format(' Busiest: %s (%s calls, %s messages).', busy->>'name', busy->>'calls_7d', busy->>'messages_7d') else ' Every pool was quiet.' end),
      '/platform');
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
revoke execute on function public._platform_monday() from public, anon, authenticated;
