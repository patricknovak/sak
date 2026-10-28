-- Before launch (28 October 2026, docs/LAUNCH-READINESS-2026-10-28.md section 3, Patrick: "Apply migrations and
-- continue"): the shadow league and the test pools are archived. Nothing is deleted: an archived league keeps every row
-- and can be set active again from the Platform page. Archived, a league drops out of the scheduled work (the voice's
-- posts, the league pass, the pool jobs, the platform's counts).
--
-- The shadow league (league 2) proved the tenancy (the gate met 11 October 2026, docs/DEVELOPMENT.md section 5); its
-- roster mirror ran every minute since. The mirror now leaves an archived shadow alone, and its job stops in
-- migration 341.

create or replace function public.shadow_sync() returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  -- players the original no longer has (an archived shadow league is left as it was)
  delete from rosters r using teams s, leagues l
  where s.id = r.team_id and s.perms ? 'shadow_of' and l.id = s.league_id and l.status = 'active'
    and not exists (select 1 from rosters o where o.team_id = (s.perms->>'shadow_of')::int and o.player_id = r.player_id);
  get diagnostics k = row_count; n := n + k;
  -- players the original has, in the original's slot (a player traded between originals moves between shadows)
  insert into rosters (league_id, player_id, team_id, slot, acquired, acquired_at, keeper, prev_fp, pin)
  select s.league_id, o.player_id, s.id, o.slot, o.acquired, o.acquired_at, o.keeper, o.prev_fp, o.pin
  from teams s join leagues l on l.id = s.league_id and l.status = 'active'
  join rosters o on o.team_id = (s.perms->>'shadow_of')::int
  where s.perms ? 'shadow_of'
  on conflict (league_id, player_id) do update set team_id = excluded.team_id, slot = excluded.slot, acquired = excluded.acquired,
    acquired_at = excluded.acquired_at, keeper = excluded.keeper, prev_fp = excluded.prev_fp, pin = excluded.pin
  where (rosters.team_id, rosters.slot) is distinct from (excluded.team_id, excluded.slot);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- the shadow league, found by its slug
update leagues set status = 'archived', updated_at = now() where slug = 'sak-shadow' and status = 'active';

-- the QA and test pools: a prediction pool named as a test whose every member is a test account (accounts.is_test) or
-- a name-only guest made by the QA run; a pool with any real member is left alone
update leagues l set status = 'archived', updated_at = now()
where l.status = 'active' and l.kind = 'predict' and l.id <> 1
  and (l.slug like 'qa-test-%' or l.slug like 'test-%')
  and exists (select 1 from league_members m where m.league_id = l.id)
  and not exists (
    select 1 from league_members m left join accounts a on a.user_id = m.user_id left join auth.users u on u.id = m.user_id
    where m.league_id = l.id and not coalesce(a.is_test, false) and coalesce(u.email, '') not like 'guest-qa%@guest.superpoolsai.com');

-- the running costs' fixed bills, brought up to date (the Costs page): the landing page left Vercel for Cloudflare on
-- 4 October 2026, and the app's Worker has run on Cloudflare Workers Paid since 11 October 2026
update ops.cost_fixed set ends = date '2026-10-04', note = 'The landing page moved to Cloudflare on 4 October 2026'
where source = 'hosting' and item = 'Vercel (landing page)' and ends is null;
insert into ops.cost_fixed (source, item, monthly_usd, share, starts, note)
select 'hosting', 'Cloudflare Workers Paid (the app and the landing page)', 5.00, 1, date '2026-10-11',
  'Workers Paid plan: the app''s Worker, its live rooms (Durable Objects) and the landing page'
where not exists (select 1 from ops.cost_fixed where source = 'hosting' and item like 'Cloudflare Workers Paid%');
