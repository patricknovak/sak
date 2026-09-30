-- Housekeeping from the season-one review: less work per night, tighter grants, faster joins.
--
-- * _scores_due(): the minute-by-minute score sync only has something to do while a game is live, about to
--   start (the lineup freeze-frame is taken at puck drop) or just ended and not yet pulled into the box scores.
--   Between those windows it is skipped, with a run every 15 minutes as a backstop. Cuts the edge-function
--   invocations by roughly two thirds on a game night and to almost nothing on an off day.
-- * Views run as the caller (security_invoker), so the row-level policies on the tables underneath decide what
--   a view shows. Every table they read is readable by any signed-in GM, so nothing changes for the site; it
--   closes the door the linter flags, where a view owned by postgres would bypass RLS. The one exception is
--   team_directory: it is the deliberately public projection of teams (name, colour, emoji) that the login
--   page lists before anyone is signed in, so it keeps running as its owner.
-- * Internal helpers pin their search_path and lose their anon grant.
-- * Indexes on the foreign keys the site actually joins on.

create or replace function public._scores_due() returns boolean
language sql stable set search_path = public as $$
  select
    -- a game live now or starting within 15 minutes (today or yesterday ET, for late finishes)
    exists (select 1 from games where date between today_et() - 1 and today_et() + 1
              and state not in ('OFF', 'FINAL', 'PPD', 'CNCL') and start_utc <= now() + interval '15 minutes')
    -- a final whose box score hasn't been pulled yet
    or exists (select 1 from games where date between today_et() - 1 and today_et() and state in ('OFF', 'FINAL') and not coalesce(final_synced, false))
    -- backstop: every 15 minutes regardless (schedule changes, early starts)
    or extract(minute from now())::int % 15 = 0
$$;
revoke execute on function public._scores_due() from public, anon, authenticated;

do $$
declare v text;
begin
  foreach v in array array['standings', 'player_season', 'team_daily_all', 'playoff_daily', 'playoff_standings', 'team_daily', 'team_bench_daily',
    'coin_balances', 'player_windows', 'book_standings', 'sak_cup_daily', 'sak_cup_standings', 'fund_status', 'money_balances', 'pickup_status'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('alter view public.%I set (security_invoker = true)', v);
    end if;
  end loop;
end $$;

alter function public._creator_stake(bets) set search_path = public;
alter function public._odds(numeric) set search_path = public;
alter function public._market_option_odds(markets, text) set search_path = public;
alter function public._stat_diff(jsonb, jsonb) set search_path = public;
alter function public._ir_ok(text) set search_path = public;

revoke execute on function public._bet_underway(date), public._block_cleanup(), public._club_form(text), public._fund_on_paid(), public._payout_market(bigint, text),
  public.bet_progress(bigint), public.can_do(text), public.is_gm(), public.open_markets(date), public.settle_markets() from anon;
-- only the scheduler and security-definer callers run these
revoke execute on function public._bet_underway(date), public._block_cleanup(), public._club_form(text), public._fund_on_paid(), public._payout_market(bigint, text),
  public.open_markets(date), public.settle_markets() from authenticated;

create index if not exists messages_team_idx on public.messages (team_id);
create index if not exists messages_reply_idx on public.messages (reply_to) where reply_to is not null;
create index if not exists market_bets_team_idx on public.market_bets (team_id);
create index if not exists markets_game_idx on public.markets (game_id) where game_id is not null;
create index if not exists coin_ledger_bet_idx on public.coin_ledger (bet_id) where bet_id is not null;
create index if not exists bets_creator_idx on public.bets (creator_team);
create index if not exists bets_opponent_idx on public.bets (opponent_team) where opponent_team is not null;
create index if not exists bet_entries_team_idx on public.bet_entries (team_id);
create index if not exists trade_items_trade_idx on public.trade_items (trade_id);
create index if not exists trades_from_idx on public.trades (from_team);
create index if not exists trades_to_idx on public.trades (to_team);
create index if not exists transactions_player_idx on public.transactions (player_id);
create index if not exists lineup_plans_player_idx on public.lineup_plans (player_id);
create index if not exists draft_picks_team_idx on public.draft_picks (team_id);
create index if not exists draft_picks_player_idx on public.draft_picks (player_id) where player_id is not null;
create index if not exists draft_queue_player_idx on public.draft_queue (player_id);
create index if not exists stat_corrections_game_idx on public.stat_corrections (game_id);
create index if not exists ledger_team_idx on public.ledger (team_id);
create index if not exists fund_ledger_team_idx on public.fund_ledger (team_id);
drop index if exists public.players_name_idx;
