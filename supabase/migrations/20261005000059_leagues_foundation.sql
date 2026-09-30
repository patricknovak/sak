-- Super Pools foundation: one database, many leagues.
--
-- The SaK league becomes league 1 in a `leagues` table, and every league-scoped table gets a `league_id`
-- that defaults to 1. Nothing changes for the live league today: every existing row is league 1 and every
-- insert lands there. What it buys is that every later step (per-league policies, a second league, brand
-- and rules per league) is an edit of a `where league_id = ...`, not a data migration during the season.
--
-- Shared, league-independent tables stay as they are: players, games, player_games, player_status,
-- player_events, player_history, news, nhl_teams, stat_corrections, hub_cache, health_alerts, fund_prices.

create table if not exists public.leagues (
  id serial primary key,
  slug text not null unique,
  name text not null,
  short_name text not null,
  sport text not null default 'nhl',
  status text not null default 'active' check (status in ('active', 'archived', 'setup')),
  -- how the site looks and talks for this league: names, wordmark, colours, trophies, the bot's name
  brand jsonb not null default '{}'::jsonb,
  -- the host the league lives on once Super Pools serves many (null = the default app host)
  domain text unique,
  owner_user uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leagues enable row level security;
drop policy if exists read_all on public.leagues;
create policy read_all on public.leagues for select to authenticated using (true);

insert into public.leagues (id, slug, name, short_name, brand)
select 1, 'sak', l.name, l.short_name,
  jsonb_build_object(
    'wordmark', jsonb_build_object('a', 'SAK', 'b', 'SUPERLEAGUE'),
    'tagline', 'She’s A Keeper',
    'trophy', 'The SAK Cup', 'booby', 'The Peter',
    'bot', jsonb_build_object('name', 'Garry', 'emoji', '🎙️'),
    'coin', jsonb_build_object('name', 'St. Patrick coins', 'emoji', '☘️'),
    'colors', jsonb_build_object('gold', '#f7c548'))
from public.league l where l.id = 1
on conflict (id) do nothing;
select setval('public.leagues_id_seq', greatest((select max(id) from public.leagues), 1));

-- the per-league settings row points at its league (still one row today; the id=1 check goes so a second can exist)
alter table public.league drop constraint if exists league_id_check;
alter table public.league add column if not exists league_id int not null default 1 references public.leagues (id);
create unique index if not exists league_league_id_idx on public.league (league_id);

do $$
declare t text;
begin
  foreach t in array array[
    'teams', 'rosters', 'draft_picks', 'draft_state', 'draft_queue', 'lineup_plans', 'lineup_plan_applied', 'lineup_snapshots',
    'messages', 'chat_reads', 'reactions', 'polls', 'poll_votes',
    'bets', 'bet_entries', 'coin_ledger', 'markets', 'market_bets',
    'ledger', 'fund', 'fund_ledger', 'acq_transfers', 'trades', 'trade_items', 'trade_block', 'transactions',
    'proposals', 'proposal_votes', 'feature_ideas', 'feature_comments', 'feature_votes',
    'notifications', 'push_subscriptions', 'yahoo_accounts', 'pool_links', 'garry_memory', 'garry_state', 'league_reports'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I add column if not exists league_id int not null default 1 references public.leagues (id)', t);
    end if;
  end loop;
end $$;

-- the tables the site reads in bulk get an index on the league key
create index if not exists teams_league_idx on public.teams (league_id);
create index if not exists rosters_league_idx on public.rosters (league_id);
create index if not exists messages_league_idx on public.messages (league_id, channel, id desc);
create index if not exists lineup_plans_league_idx on public.lineup_plans (league_id, date);
create index if not exists lineup_snapshots_league_idx on public.lineup_snapshots (league_id, date);
create index if not exists transactions_league_idx on public.transactions (league_id, id desc);
create index if not exists notifications_league_idx on public.notifications (league_id, team_id);
create index if not exists draft_picks_league_idx on public.draft_picks (league_id, season);
create index if not exists bets_league_idx on public.bets (league_id);
create index if not exists markets_league_idx on public.markets (league_id, date);

-- the league of the signed-in GM (1 while every account is in the SaK league); the hook every future
-- policy and view filter uses, so adding a second league changes no call site
create or replace function public.current_league_id() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select league_id from teams where user_id = auth.uid() limit 1), 1)
$$;
grant execute on function public.current_league_id() to authenticated;
revoke execute on function public.current_league_id() from anon;

-- a new league row copies the SaK rules as its starting point; the commissioner tunes them after
create or replace function public.create_league(p_slug text, p_name text, p_short text, p_brand jsonb default '{}'::jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare nid int;
begin
  perform _commish();
  insert into leagues (slug, name, short_name, brand, status) values (p_slug, p_name, p_short, coalesce(p_brand, '{}'::jsonb), 'setup') returning id into nid;
  insert into league (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq)
  select nid, nid, p_name, p_short, season, 'keepers', keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq
  from league where league_id = 1;
  return nid;
end $$;
revoke execute on function public.create_league(text, text, text, jsonb) from public, anon;
grant execute on function public.create_league(text, text, text, jsonb) to authenticated;
