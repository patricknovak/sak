-- Every rule reads its own league's row (Super Pools step 2).
--
-- Thirty-seven SQL functions and five views read `league`, the per-league rules row (roster caps, scoring
-- weights, keepers, draft settings, money split), as if it were the only one: `select phase from league`,
-- `update league set ...`, `from league where id = 1`. Rather than rewrite them all, the table becomes
-- `league_rules` and `league` becomes a view of the caller's row. Every existing read and write keeps its
-- text and now lands on the right league:
--
-- * A signed-in GM's calls (security definer functions run with the GM's JWT still in the session) resolve
--   current_league_id() to his league.
-- * The scheduler and the edge functions run with no user; current_league_id() falls back to league 1 until
--   the per-league scheduler (plan step 5) sets `app.league_id` before each league's pass. The setting is
--   honoured first, so that step is a loop around existing calls, not a rewrite.
-- * The view is a plain projection of one table, so Postgres lets `update league set ...` and the
--   `insert into league` in create_league write through it unchanged.
--
-- The five views that read the rules row (standings, player_season, team_daily_all, team_bench_daily,
-- pickup_status) are re-pointed at the view, so they see one league in every context, including inside
-- security definer functions where row-level security does not apply. For the SaK league nothing changes:
-- every caller resolves to league 1 and the one row is league 1.

set client_min_messages = warning;

-- the scheduler's hook first, then the signed-in GM's league, then the model league
create or replace function public.current_league_id() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(current_setting('app.league_id', true), '')::int,
    (select league_id from teams where user_id = auth.uid() limit 1),
    1)
$$;

alter table public.league rename to league_rules;

create view public.league with (security_invoker = true) as
  select * from public.league_rules where league_id = public.current_league_id();
grant select on public.league to authenticated;
revoke all on public.league from anon;

do $$
declare v text; d text;
begin
  foreach v in array array['standings', 'player_season', 'team_daily_all', 'team_bench_daily', 'pickup_status'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      d := pg_get_viewdef(('public.' || v)::regclass, true);
      d := regexp_replace(d, '\mleague_rules\M', 'league', 'g');
      -- create or replace resets a view's options, so the caller's-rights setting from migration 57 is restated
      execute format('create or replace view public.%I with (security_invoker = true) as %s', v, d);
    end if;
  end loop;
end $$;

-- A handful of functions pinned the rules row to `id = 1` (the SaK row) instead of reading `from league`
-- plainly: _cap, _advance, ensure_future_picks, draft_start, commish_update_scoring, commish_update_league,
-- finalize_keepers, _playoffs_on, calc_fpts, _club_form and the money helpers. The view already picks the caller's row, so the pin
-- comes off: `from league where id = 1` becomes `from league`, and `update league set ... where id = 1`
-- becomes `update league set ...`. Other tables' `where id = 1` (draft_state has one too) are untouched.
do $$
declare f record; src text; def text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ 'league' and p.prosrc ~ 'where (l\.)?id = 1'
  loop
    def := pg_get_functiondef(f.oid);
    src := def;
    src := regexp_replace(src, 'from league where id = 1', 'from league', 'g');
    src := regexp_replace(src, 'from league l where l\.id = 1', 'from league l', 'g');
    -- calc_fpts and _club_form join `league l` and pin it in the where clause
    src := regexp_replace(src, 'where l\.id = 1 and ', 'where ', 'g');
    src := regexp_replace(src, '\s+where l\.id = 1\M', '', 'g');
    src := regexp_replace(src, '(update league set(?:(?!where id = 1).)*?)\s+where id = 1', '\1', 'g');
    if src <> def then execute src; end if;
  end loop;
end $$;
