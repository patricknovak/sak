-- Security surface checks after migration 240 (anon grants, team_directory, emails).
-- Runs after flow.sql / tenancy.sql on the same scratch database (its own session: helpers defined here).
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claim.sub', '', false);
create or replace function pg_temp.expect(label text, ok boolean) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; end $$;
create or replace function pg_temp.as_team(t int) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || t, false) $$;

-- ───────────── team_directory: no emails, runs as the caller, anon still reads names ─────────────
select pg_temp.expect('team_directory has no login_email column', not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'team_directory' and column_name = 'login_email'));
select pg_temp.expect('team_directory runs as the caller',
  coalesce((select reloptions::text ~ 'security_invoker=(true|on)' from pg_class where oid = 'public.team_directory'::regclass), false));

reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect('anon reads the public team list', (select count(*) from team_directory) > 0);
select pg_temp.expect('anon cannot select login_email on teams',
  not has_column_privilege('anon', 'public.teams', 'login_email', 'select'));
select pg_temp.expect('anon cannot select user_id on teams',
  not has_column_privilege('anon', 'public.teams', 'user_id', 'select'));
-- a direct select of the secret column must fail even when the row is in the caller's league
do $$
begin
  begin
    perform login_email from teams limit 1;
    raise exception 'FAILED: anon read login_email from teams';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ───────────── anon cannot call the revoked SECURITY DEFINER functions ─────────────
select pg_temp.expect('anon cannot settle_markets', not has_function_privilege('anon', 'public.settle_markets()', 'execute'));
select pg_temp.expect('anon cannot open_nhl_markets', not has_function_privilege('anon', 'public.open_nhl_markets()', 'execute'));
select pg_temp.expect('anon cannot open_season_markets', not has_function_privilege('anon', 'public.open_season_markets()', 'execute'));
select pg_temp.expect('anon cannot reprice_season_markets', not has_function_privilege('anon', 'public.reprice_season_markets()', 'execute'));
select pg_temp.expect('anon cannot settle_season_markets', not has_function_privilege('anon', 'public.settle_season_markets()', 'execute'));
select pg_temp.expect('anon cannot settle_race_markets', not has_function_privilege('anon', 'public.settle_race_markets()', 'execute'));
select pg_temp.expect('anon cannot pool_buy', not has_function_privilege('anon', 'public.pool_buy(bigint, text, integer)', 'execute'));
select pg_temp.expect('anon cannot pool_sell', not has_function_privilege('anon', 'public.pool_sell(bigint, text, numeric)', 'execute'));
select pg_temp.expect('anon cannot pool_create', not has_function_privilege('anon', 'public.pool_create(jsonb)', 'execute'));
select pg_temp.expect('anon cannot pool_resolve', not has_function_privilege('anon', 'public.pool_resolve(bigint, text, text)', 'execute'));
select pg_temp.expect('anon cannot platform_open_pool',
  not has_function_privilege('anon', 'public.platform_open_pool(text, text, text, text)', 'execute'));
select pg_temp.expect('anon cannot soccer_rounds', not has_function_privilege('anon', 'public.soccer_rounds()', 'execute'));
select pg_temp.expect('anon cannot bet_progress', not has_function_privilege('anon', 'public.bet_progress(bigint)', 'execute'));
select pg_temp.expect('anon cannot _compat_scoring', not has_function_privilege('anon', 'public._compat_scoring()', 'execute'));
select pg_temp.expect('anon cannot _fund_on_paid', not has_function_privilege('anon', 'public._fund_on_paid()', 'execute'));
select pg_temp.expect('anon cannot can_do', not has_function_privilege('anon', 'public.can_do(text)', 'execute'));
select pg_temp.expect('anon cannot is_gm', not has_function_privilege('anon', 'public.is_gm()', 'execute'));

-- ───────────── anon keeps the signed-out doors ─────────────
select pg_temp.expect('anon can current_league_id', has_function_privilege('anon', 'public.current_league_id()', 'execute'));
select pg_temp.expect('anon can current_profile_id', has_function_privilege('anon', 'public.current_profile_id()', 'execute'));
select pg_temp.expect('anon can invite_preview', has_function_privilege('anon', 'public.invite_preview(text)', 'execute'));
select pg_temp.expect('anon can league_by_host', has_function_privilege('anon', 'public.league_by_host(text)', 'execute'));
select pg_temp.expect('anon can request_league',
  has_function_privilege('anon', 'public.request_league(text, text, text, integer, text, text)', 'execute'));
select pg_temp.expect('anon can pool_event_list', has_function_privilege('anon', 'public.pool_event_list()', 'execute'));
select pg_temp.expect('anon can pool_events', has_function_privilege('anon', 'public.pool_events()', 'execute'));
select pg_temp.expect('anon can pool_pack_list', has_function_privilege('anon', 'public.pool_pack_list()', 'execute'));

set role anon;
select pg_temp.expect('invite_preview still answers the public key',
  (invite_preview('not-a-code')->>'reason') = 'unknown');
select pg_temp.expect('pool_pack_list still answers the public key', (select count(*) from pool_pack_list()) >= 0);
select pg_temp.expect('pool_event_list still answers the public key', (select count(*) from pool_event_list()) >= 0);
select pg_temp.expect('league_by_host still answers the public key', league_by_host('no-such-host.example') is null);
reset role;

-- waitlist insert stays open to the landing page (RETURNING needs SELECT, which anon does not have)
set role anon;
insert into waitlist (email, name, source)
values ('security-test-' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '@example.com', 'Security Test', 'security.sql');
reset role;
select pg_temp.expect('anon can still insert the waitlist',
  (select count(*) from waitlist where source = 'security.sql') >= 1);

-- ───────────── signed-in GMs keep the core SaK and pool doors ─────────────
select pg_temp.expect('authenticated can set_lineup',
  has_function_privilege('authenticated', 'public.set_lineup(jsonb)', 'execute'));
select pg_temp.expect('authenticated can propose_trade',
  has_function_privilege('authenticated',
    'public.propose_trade(integer, integer[], integer[], integer[], integer[], text, integer, integer, integer, integer, integer[], bigint)',
    'execute'));
select pg_temp.expect('authenticated can create_bet_v2',
  has_function_privilege('authenticated', 'public.create_bet_v2(jsonb)', 'execute'));
select pg_temp.expect('authenticated can pool_buy',
  has_function_privilege('authenticated', 'public.pool_buy(bigint, text, integer)', 'execute'));
select pg_temp.expect('authenticated can pool_game_pick',
  has_function_privilege('authenticated', 'public.pool_game_pick(bigint, text, jsonb)', 'execute'));
select pg_temp.expect('authenticated can can_do (RLS helpers)',
  has_function_privilege('authenticated', 'public.can_do(text)', 'execute'));
select pg_temp.expect('authenticated can soccer_rounds',
  has_function_privilege('authenticated', 'public.soccer_rounds()', 'execute'));

-- commissioner still sees sign-in emails through the gated path
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('commish_accounts still returns login emails',
  exists (select 1 from commish_accounts() where login_email is not null));
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ───────────── search_path pinned on the flagged set ─────────────
select pg_temp.expect('flagged functions pin search_path', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (
    ('public', '_fixture_result'), ('public', '_commish_logged'), ('public', '_category_catalogue'),
    ('public', '_bracket_rounds'), ('public', '_h2h_week_end'), ('public', '_stat_label'),
    ('public', '_member_role'), ('public', '_odds_long'), ('public', '_phi'),
    ('public', '_stat_spread'), ('public', '_odds_live'), ('public', '_inplay_block'),
    ('public', '_minutes_left'), ('public', '_poisson'), ('public', '_ordinal'),
    ('ops', 'fixed_on')
  ) and (p.proconfig is null or not (p.proconfig::text like '%search_path=%'))
));

-- ───────────── initplan policies use (select auth.uid()) ─────────────
select pg_temp.expect('accounts.read_own uses select auth.uid()',
  (select qual from pg_policies where schemaname = 'public' and tablename = 'accounts' and policyname = 'read_own')
  ~* '[(][[:space:]]*select auth[.]uid[(]');
select pg_temp.expect('league_members.read_mine_or_league uses select auth.uid()',
  (select qual from pg_policies where schemaname = 'public' and tablename = 'league_members' and policyname = 'read_mine_or_league')
  ~* '[(][[:space:]]*select auth[.]uid[(]');

select 'security surface', true;
