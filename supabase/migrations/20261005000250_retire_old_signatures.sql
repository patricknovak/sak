-- Compatibility debt, retired (docs/DEVELOPMENT.md section 3): Phase 1's gate is passed (the shadow league matched SaK
-- to the hundredth from 3 to 10 October), so the function signatures renamed out of the way while their replacements
-- went in can go. Each was closed to every caller when it was renamed; nothing calls them (no function body, no
-- scheduled job, no page, no edge function), checked 12 October 2026. run_auto_lineups went with nhl-sync's
-- auto-pilot, which sets lineups per league itself.
--
-- Only functions: no table, column or row is touched. Safe to run twice.
drop function if exists public.run_auto_lineups();
drop function if exists public.respond_trade_before_drops(bigint, boolean);
drop function if exists public.propose_multi_trade_before_drops(jsonb, text);
drop function if exists public.propose_trade_before_drops(integer, integer[], integer[], integer[], integer[], text, integer, integer, integer, integer);
drop function if exists public.propose_trade_before_counter(integer, integer[], integer[], integer[], integer[], text, integer, integer, integer, integer, integer[]);
drop function if exists public.create_league_before_platform(text, text, text, jsonb);
drop function if exists public._pool_start_new_before_attr(uuid, text, text, text, text, text);
drop function if exists public.survivor_start_before_end(text, integer);
