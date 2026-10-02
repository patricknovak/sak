# CLAUDE.md: the standing briefing for this repository

Read this first in every session, then `docs/SUPERPOOLS.md` (the product plan), `docs/BRAND.md` (how the product
is named, described and drawn), `docs/MARKET.md` (the competition and the road to every sport), `docs/EXPANSION.md`
(what must change before more leagues and sports, in order) and, for how the system is built and what it costs to
run, `docs/REVIEW-2026-09.md`.

## What this is

Two things in one repo:

- **The SaK Superleague site**: an 8-team NHL fantasy keeper league (commissioner: Patrick Novak, team 1,
  "The Hip Czechs"). It is live and used every night of the season. Treat it as production.
- **Super Pools** (superpoolsai.com): the product being built from it. The SaK league is league 1, the model
  league. Every league-scoped table already carries `league_id` (default 1); see `docs/SUPERPOOLS.md`.

## Stack and layout

- Front end: React 19 + Vite + TypeScript + Tailwind v4, `HashRouter`. Pages in `src/pages`, components in
  `src/components`, shared logic in `src/lib`. The app-wide store is `src/lib/store.tsx` (`useLeague()`):
  it loads league, teams, players, rosters, picks, draft, standings, season stats, windows, games,
  notifications and game-day status, subscribes to realtime, and exposes `leagueDay` and `brand`.
- Brand: `src/lib/brand.ts` (`useBrand()`, SaK defaults, `PRODUCT` constants). Names come from
  `leagues.brand`; never hard-code a new league-specific name.
- Backend: Supabase Postgres (project `quakdkzdafzlhgjvmypg`). Every rule is a SQL function behind
  row-level security; the site calls them with `rpc(...)` from `src/lib/supabase.ts`. Views compute
  standings, daily points, coin balances and money.
- Edge functions in `supabase/functions`: `nhl-sync` (scores, box scores, lineup snapshots, schedule,
  injuries, game-day status, news, projections, auto-lineups; tasks via `?task=`), `nhl-hub` (NHL centre
  data, cached in `hub_cache`), `garry` (the league voice; the LLM is Grok via xAI, `XAI_API_KEY`),
  `player-info`, `push`, `yahoo`. Shared code in `supabase/functions/_shared`.
- Scheduler: pg_cron jobs call the edge functions through pg_net with the anon key. Job names: nhl-scores
  (gated by `_scores_due()`), nhl-gameday, nhl-injuries, nhl-schedule, season-schedule, nhl-news,
  nhl-players, nhl-players-pregame, nhl-standings, nhl-corrections, nhl-corrections-deep, projections,
  auto-lineups, auto-lineups-late, garry-daily, garry-weekly, garry-nudge, garry-moments, open-book, settle-book,
  settle-bets, expire-bets, process-pending (every 10 s), health-check, fund-price, cron-history.
- Hosting: GitHub Pages from `main` (`.github/workflows/deploy.yml`, builds on push). The landing page for
  Super Pools is `landing/index.html`, to be hosted on Vercel.

## Time and the league day

Everything league-facing runs on Eastern time. The "league day" stays on the previous date until that
night's last game is final (6 am ET backstop): SQL `today_et()` / `_league_day()`, site `etToday()` and
`leagueDay` from the store, edge functions `leagueToday()`. Use these, never the calendar date, for
anything that decides which day a game or a lineup belongs to.

## Commands

```
npm run typecheck          # tsc -b
npm run build              # tsc -b && vite build
npm run test:db            # full database flow test against a local Postgres (see below)
npm run test:nhl           # scoring/stat parsing tests
npx vite preview --port 4174 --strictPort   # serve dist/ for browser checks
```

Local database for `test:db`: a plain Postgres 16 on a Unix socket, `PGHOST=/tmp PGPORT=5433
PGUSER=postgres bash supabase/tests/run.sh`. The runner applies every migration in order (files whose name
contains `_cron` are skipped: pg_cron is not available locally) and then `supabase/tests/flow.sql`, which
drafts, sets lineups, scores, trades and settles a whole flow, then `supabase/tests/tenancy.sql`, the tenancy
guardrails. Success prints `database flow test passed`.
Note: psql `:vars` do not interpolate inside `DO` blocks; use `set_config` / `current_setting`.

Deno check for edge functions: copy the function folder plus `_shared` to a scratch dir and run
`deno check <entry>` (`npx -y deno@2`; set `DENO_CERT` to the proxy CA bundle when behind a proxy).

## Migrations and deploys

- Migrations live in `supabase/migrations/` as `20261005000NNN_name.sql` (next number after the highest).
  Write the file, run `test:db`, then apply the same SQL to the project (Supabase MCP `apply_migration`).
  Cron changes go in their own `*_cron*` migration.
- Pitfall: the Supabase MCP holds any top-level statement that begins with `drop` (`drop policy if exists`,
  `drop trigger if exists`, ...) for a confirmation this session cannot give, and the call times out after 60 s
  with nothing applied, in `apply_migration` and `execute_sql` alike. Write migrations without top-level drops
  (`create or replace`, `if not exists`, or a drop inside a `do $$ ... $$` block), or apply in pieces with
  `execute_sql` and record the row in `supabase_migrations.schema_migrations` by hand. Check the live state
  before retrying: a timed-out call may have applied nothing, or everything up to the drop.
- Edge functions deploy with the Supabase MCP `deploy_edge_function`, sending the full contents of
  `<fn>/index.ts` and every `_shared/*.ts` it imports. Pitfall: a literal `\uXXXX` in source is decoded once
  more by the deploy pipeline; send it as `\\u005cuXXXX`.
- The site deploys itself on merge to `main`.

## Conventions

- SaK is the test and development platform for Super Pools. Anything built for the SaK Superleague is, by
  default, a Super Pools feature or a per-league customization for every league (reads its league's rules and
  brand, keyed by `league_id`), unless Patrick says otherwise for that feature.
- Branch and PR flow: work on the designated `claude/...` branch, commit with Patrick's name and email,
  push, open a draft PR against `main`, subscribe to it, schedule a self check-in, and fast-forward the
  branch to `main` after the merge. No model identifiers in commits or PR text.
- Tenancy: a new league table gets `league_id`, the `_stamp_league` trigger and policies bound to
  `current_league_id()` in the same migration; a new security-definer RPC that takes an id calls
  `_in_league(table, id)` first; a new view is `security_invoker`. `tenancy.sql` fails the test otherwise.
- The platform admin key (`private.app_keys`, name `admin`) goes in the `x-admin-key` header for Garry's
  commissioner tasks (keepers, learn, evolve, assess, probe); the public anon key alone is refused. Never put it
  in the site or the repo.
- Comments explain the league rule or the reason, in plain language, in the voice of the existing code.
- UI copy is hockey-league plain English, phone-first (390 px wide) and checked with a screenshot before
  a PR (Playwright with the pre-installed Chromium; sign in as a test team, never as a real GM).
- Garry posts to league chat only when Patrick asks. Bot posts are `messages` rows with `kind='bot'` and
  `meta.bot='garry'`.
- Never modify real GMs' rosters, lineups, plans, bets or coins unless asked. Browser checks against
  production are view-only.
- Never commit credentials. Secrets live in Supabase function secrets and GitHub Actions secrets. The test
  team's login is kept out of the repo.

## Team ids (SaK, league 1)

1 Patrick (commish), 2 Terry, 3 Jason, 4 Craig, 5 Trystan, 6 Panagiotis, 7 Todd, 8 Darin, 9 Dan Perra
(spectator).

## Where the plan lives

`docs/SUPERPOOLS.md` holds the ordered list of remaining product work; update it when a step lands.
`docs/REVIEW-2026-09.md` holds the resource-use and security baseline; update the numbers when they change.
