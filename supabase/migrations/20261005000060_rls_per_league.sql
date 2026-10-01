-- Per-league row-level policies (Super Pools step 1).
--
-- Until now every policy on a league-scoped table said "any signed-in GM can read everything", which was fine
-- while the SaK league was the only one. From here on every policy also requires the row's league to be the
-- caller's league (current_league_id()), so two leagues in one database cannot see each other's teams,
-- rosters, chat, bets, money or lineups. For the SaK league nothing changes: everyone's league is 1 and
-- every row is league 1.
--
-- * Every existing policy on a table that carries league_id is recreated with `league_id = current_league_id()`
--   in front of its own predicate, for reads, inserts, updates and deletes alike. The commissioner's
--   "or is_commish()" branches get the same bound: a commissioner runs one league, not all of them.
-- * `leagues` and `league` (the rules row) are readable only for the caller's league, so the app's
--   `select * from league` keeps returning exactly one row.
-- * The scoring, coin and money views run as the caller (security_invoker, migration 57), so they inherit
--   these policies without a filter of their own; the flow test checks the standings view against a second league.
-- * A row written with a team on it takes its league from that team (before-insert trigger), so the client's
--   direct inserts (chat, reactions, polls, queues, ideas) and the SQL functions never depend on the column
--   default of 1. Bets and trades take it from the creating team, proposals from the sponsor, trade items from
--   their trade. Rows without a team (draft state, markets, the fund, reports) are written by functions and the
--   scheduler, which learn to loop per league in the next step.
-- * current_league_id() sits in a sub-select inside each policy so Postgres evaluates it once per statement,
--   not once per row.

set client_min_messages = warning;

-- ───────────── the league of the row being written ─────────────
create or replace function public._stamp_league() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(new); tid int; lid int;
begin
  tid := coalesce((r->>'team_id')::int, (r->>'creator_team')::int, (r->>'from_team')::int, (r->>'sponsor_team')::int);
  if tid is not null then
    select league_id into lid from teams where id = tid;
  elsif tg_table_name = 'trade_items' then
    select league_id into lid from trades where id = (r->>'trade_id')::bigint;
  end if;
  if lid is not null then new.league_id := lid; end if;
  return new;
end $$;
revoke execute on function public._stamp_league() from public, anon, authenticated;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join pg_tables pt on pt.schemaname = c.table_schema and pt.tablename = c.table_name
    where c.table_schema = 'public' and c.column_name = 'league_id' and c.table_name not in ('teams', 'league', 'leagues')
      and exists (select 1 from information_schema.columns c2 where c2.table_schema = 'public' and c2.table_name = c.table_name
                  and c2.column_name in ('team_id', 'creator_team', 'from_team', 'sponsor_team', 'trade_id'))
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp_league', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public._stamp_league()', t || '_stamp_league', t);
  end loop;
end $$;

-- ───────────── every policy on a league-scoped table is bounded by the caller's league ─────────────
do $$
declare p record; q text; w text; lb constant text := '(league_id = (select public.current_league_id()))';
begin
  for p in
    select pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check
    from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename <> 'leagues'
      and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = pol.tablename and c.column_name = 'league_id')
      -- already bounded (the migration is safe to run twice)
      and coalesce(pol.qual, '') not like '%current_league_id()%' and coalesce(pol.with_check, '') not like '%current_league_id()%'
  loop
    q := case when p.qual is null then null when p.qual = 'true' then lb else lb || ' and (' || p.qual || ')' end;
    w := case when p.with_check is null then null when p.with_check = 'true' then lb else lb || ' and (' || p.with_check || ')' end;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s %s %s',
      p.policyname, p.tablename, p.permissive, p.cmd, array_to_string(p.roles, ', '),
      case when q is not null then 'using (' || q || ')' else '' end,
      case when w is not null then 'with check (' || w || ')' else '' end);
  end loop;
end $$;

-- a GM sees his own league's row, nobody else's
grant select on public.leagues to authenticated;
revoke all on public.leagues from anon;
drop policy if exists read_all on public.leagues;
create policy read_all on public.leagues for select to authenticated using (id = (select public.current_league_id()));

-- the public team list carries the league, so the login page can narrow it to one league once the app is served per host
create or replace view public.team_directory as
  select id, name, abbrev, gm_name, login_email, color, emoji, role, league_id from public.teams;
