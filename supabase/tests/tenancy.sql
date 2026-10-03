-- Tenancy guardrails: the rules every league-scoped change must keep, checked against the whole schema after every
-- migration (supabase/tests/run.sh runs this after flow.sql). A new table, view or function that breaks one fails the
-- test until it is fixed or written into the reviewed list below with its reason. The lists are the debt from the
-- expansion review (docs/EXPANSION.md); they should only ever get shorter.
\set QUIET on
\set ON_ERROR_STOP on
reset role;
create or replace function pg_temp.none(label text, offenders text) returns void language plpgsql as
$$ begin if offenders is not null then raise exception 'TENANCY: % -> %', label, offenders; end if; end $$;

-- 1. Every table is either a league's (it carries league_id) or shared on purpose (listed here).
select pg_temp.none('a table with no league_id that is not on the shared list (add league_id, or list it as shared)', string_agg(c.relname, ', '))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped)
  and c.relname not in (
    -- one copy for every league: NHL data, caches and platform tables
    'players', 'games', 'player_games', 'player_status', 'player_events', 'player_history', 'news', 'nhl_teams',
    'stat_corrections', 'scoring_profiles', 'player_game_points', 'player_values', 'hub_cache', 'health_alerts', 'leagues', 'accounts', 'waitlist',
    -- one-off backup kept from the 2025-26 roster import (row-level security on, no policies)
    'rosters_2526_backup');

-- 2. A league's table has row-level security on, and every policy on it is bound to the caller's league.
select pg_temp.none('a league table without row-level security', string_agg(c.relname, ', '))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped);
select pg_temp.none('a policy on a league table that does not check current_league_id()', string_agg(c.relname || '.' || p.polname, ', '))
from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped)
  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ 'current_league_id';

-- 3. A league's table that names a team takes its league from that team on insert (the _stamp_league trigger), so
--    no insert relies on the column default of league 1.
select pg_temp.none('a league table with a team column and no _stamp_league trigger', string_agg(c.relname, ', '))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped)
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname in ('team_id', 'creator_team', 'from_team', 'sponsor_team', 'trade_id') and not a.attisdropped)
  and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname like '%stamp_league%')
  and c.relname not in ('league_members', 'league_invites');   -- both always write their league explicitly

-- 4. Views run with the caller's rights, so they inherit the league bound.
select pg_temp.none('a view that does not run as the caller (security_invoker)', string_agg(c.relname, ', '))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions::text ~ 'security_invoker=(true|on)', false)
  and c.relname not in (
    'team_directory');   -- debt: the login page's team list, readable before sign-in, every league's teams and login emails

-- 5. An internal helper that writes (a payout, a ledger line) is the database's own business: nobody calls it directly.
select pg_temp.none('an internal (_name) security-definer function that writes and can be called from the API', string_agg(p.proname, ', '))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '\_%' and p.prosecdef and p.prorettype <> 'trigger'::regtype
  and p.prosrc ~* '\m(insert\s+into|update\s+\w+\s+set|delete\s+from)\M'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));

-- 6. A security-definer function the API can call, that takes an id from the caller, checks the id's league
--    (_in_league, or reads current_league_id itself). The reviewed exceptions say why they are safe or what they owe.
select pg_temp.none('a callable security-definer function that takes an id and never checks its league', string_agg(distinct p.proname, ', '))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
  and pg_get_function_identity_arguments(p.oid) ~ '\m(p_team|p_to|p_bet|p_market|p_trade|p_pick|p_player|p_id|p_poll|p_proposal|p_idea|p_message|p_league|p_teams|p_items|p_code)\M'
  and p.prosrc !~ '_in_league\(|current_league_id\('
  and p.proname not in (
    -- read-only, over shared NHL data or a number about a team that is not private
    '_acq_allowed', '_acq_used', '_club_games_left', '_club_points_in', '_first_start', '_player_rate', '_race_sofar',
    '_window_label', 'bet_progress', 'player_locked', 'top_scorer',
    -- act only on the caller's own rows (their roster, bet, entry, trade), found through _team()
    'cancel_bet', 'cancel_trade', 'claim_bet', 'confirm_bet', 'mark_bet_paid', 'leave_pool', 'respond_trade',
    'drop_player', 'move_player', 'set_pin',
    -- check membership themselves
    'accept_invite', 'set_active_league',
    -- platform admins only, over the platform's own bills (ops schema), not league data
    'cost_set_fixed', 'cost_end_fixed',
    -- platform admins only: an invite to an open seat of a league that may have no commissioner yet
    'platform_invite',
    -- debt: a pick names a player, and rosters hold one row per player across all leagues (rosters key, see EXPANSION.md)
    'draft_pick',
    -- debt: a multi-team trade names its teams inside a json list; each team needs the league check
    'propose_multi_trade');

-- 7. A row written without a league takes the caller's league, never a fixed one.
select pg_temp.none('a league table whose league_id default is not current_league_id()', string_agg(c.relname, ', '))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and pg_get_expr((select d.adbin from pg_attrdef d where d.adrelid = c.oid and d.adnum = a.attnum), c.oid) is distinct from 'current_league_id()';

select 'tenancy guardrails', true;
