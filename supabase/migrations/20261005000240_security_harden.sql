-- Security hardening (advisors of 9 October 2026): stop handing the public key more than it needs.
--
-- * team_directory: already dropped login_email (migration 104) but still ran as SECURITY DEFINER. It now runs as
--   the caller (security_invoker). Anon keeps a narrow SELECT on the non-secret columns of teams in the caller's
--   league so the health check and the public names list still work; login_email and user_id stay off the public key.
--   Commissioners still read sign-in addresses through teams (league members) and through commish_accounts().
-- * SECURITY DEFINER functions the advisors flagged as callable by anon: revoke EXECUTE from PUBLIC and anon, then
--   re-grant only what signed-out flows, signed-in GMs, or the service role actually need. Cron that runs SQL runs
--   as the database owner and does not need the anon grant; edge functions use the service role.
-- * Pin search_path on the sixteen functions the advisors flagged with a mutable search_path.
-- * accounts.read_own and league_members.read_mine_or_league: wrap auth.uid() in (select ...) so Postgres plans it
--   once per statement (auth_rls_initplan).
-- Safe to run twice. Does not change what the site calls; the live site keeps working before and after apply.

set client_min_messages = warning;

-- ───────────── 1. team_directory: security_invoker, no emails for anon ─────────────
drop view if exists public.team_directory;
create view public.team_directory
  with (security_invoker = true) as
  select id, name, abbrev, gm_name, color, emoji, role, league_id
  from public.teams
  where league_id = public.current_league_id();
grant select on public.team_directory to anon, authenticated;

-- the public key may read only the directory columns of the caller's league (never login_email / user_id)
grant select (id, name, abbrev, gm_name, color, emoji, role, league_id) on public.teams to anon;
revoke select (login_email) on public.teams from anon;
revoke select (user_id) on public.teams from anon;

drop policy if exists read_public_directory on public.teams;
create policy read_public_directory on public.teams
  for select to anon
  using (league_id = (select public.current_league_id()));

-- ───────────── 2. auth_rls_initplan on accounts and league_members ─────────────
drop policy if exists read_own on public.accounts;
create policy read_own on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists read_mine_or_league on public.league_members;
create policy read_mine_or_league on public.league_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or league_id = (select public.current_league_id())
  );

-- ───────────── 3. pin search_path on the flagged functions ─────────────
alter function public._bracket_rounds(integer) set search_path = public;
alter function public._category_catalogue() set search_path = public;
alter function public._commish_logged(text) set search_path = public;
alter function public._fixture_result(integer, integer) set search_path = public;
alter function public._h2h_week_end(date, date) set search_path = public;
alter function public._inplay_block(public.markets, public.games) set search_path = public;
alter function public._member_role(public.teams) set search_path = public;
alter function public._minutes_left(public.games) set search_path = public;
alter function public._odds_live(numeric) set search_path = public;
alter function public._odds_long(numeric) set search_path = public;
alter function public._ordinal(integer) set search_path = public;
alter function public._phi(numeric) set search_path = public;
alter function public._poisson(numeric, integer) set search_path = public;
alter function public._stat_label(text) set search_path = public;
alter function public._stat_spread(text) set search_path = public;
alter function ops.fixed_on(date) set search_path = public, ops;

-- ───────────── 4. revoke anon (and PUBLIC) execute on SECURITY DEFINER RPCs anon does not need ─────────────
-- Kept for anon (re-granted below): current_league_id, current_profile_id, invite_preview, league_by_host,
-- request_league, pool_event_list, pool_events, pool_pack_list. Reasons in the pull request.

-- internal helpers and Book openers/settlers: nobody calls these from the API
revoke execute on function
  public._bet_underway(date),
  public._block_cleanup(),
  public._club_form(text),
  public._club_games_left(text, date, date),
  public._club_label(text),
  public._club_points_in(text, date, date),
  public._club_rating(text),
  public._compat_scoring(),
  public._first_start(text[], date, date),
  public._fund_on_paid(),
  public._future_options(text),
  public._future_probs(text),
  public._league_rules_profile(),
  public._ledger_money_on(),
  public._live_option_odds(public.markets, text),
  public._live_options(public.markets),
  public._nhl_season_end(),
  public._player_game_points(),
  public._player_rate(integer, text),
  public._predict_trade(),
  public._race_field_options(public.markets),
  public._race_sofar(integer, text, date, date),
  public._season_ratings(),
  public._team_stays_in_league(),
  public._window_label(date, date),
  public.open_nhl_markets(),
  public.open_season_markets(),
  public.reprice_season_markets(),
  public.settle_markets(),
  public.settle_race_markets(),
  public.settle_season_markets()
from public, anon, authenticated;

-- signed-in GMs (and the service role) still call these; the public key must not
revoke execute on function
  public.bet_progress(bigint),
  public.can_do(text),
  public.is_gm(),
  public.platform_open_pool(text, text, text, text),
  public.pool_add_drop(integer, text, timestamptz),
  public.pool_add_fixtures(text, integer),
  public.pool_buy(bigint, text, integer),
  public.pool_create(jsonb),
  public.pool_edit(bigint, jsonb),
  public.pool_invite_link(integer, integer),
  public.pool_load_pack(text),
  public.pool_resolve(bigint, text, text),
  public.pool_sell(bigint, text, numeric),
  public.soccer_rounds()
from public, anon;
grant execute on function
  public.bet_progress(bigint),
  public.can_do(text),
  public.is_gm(),
  public.platform_open_pool(text, text, text, text),
  public.pool_add_drop(integer, text, timestamptz),
  public.pool_add_fixtures(text, integer),
  public.pool_buy(bigint, text, integer),
  public.pool_create(jsonb),
  public.pool_edit(bigint, jsonb),
  public.pool_invite_link(integer, integer),
  public.pool_load_pack(text),
  public.pool_resolve(bigint, text, text),
  public.pool_sell(bigint, text, numeric),
  public.soccer_rounds()
to authenticated, service_role;

-- kept for anon: signed-out pages, host lookup, and RLS / directory reads
revoke execute on function
  public.current_league_id(),
  public.current_profile_id(),
  public.invite_preview(text),
  public.league_by_host(text),
  public.request_league(text, text, text, integer, text, text),
  public.pool_event_list(),
  public.pool_events(),
  public.pool_pack_list()
from public;
grant execute on function
  public.current_league_id(),
  public.current_profile_id(),
  public.invite_preview(text),
  public.league_by_host(text),
  public.request_league(text, text, text, integer, text, text),
  public.pool_event_list(),
  public.pool_events(),
  public.pool_pack_list()
to anon, authenticated, service_role;
