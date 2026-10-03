# CLAUDE.md: the standing briefing for this repository

Read this first in every session, then `docs/DEVELOPMENT.md` (how we build: the release order, the working method,
the knowledge base and the next steps), `docs/SUPERPOOLS.md` (the product plan), `docs/BRAND.md` (how the product
is named, described and drawn), `docs/MARKET.md` (the competition and the road to every sport), `docs/EXPANSION.md`
(what must change before more leagues and sports, in order) and, for how the system is built and what it costs to
run, `docs/REVIEW-2026-09.md`.

## What this is

Two things in one repo:

- **The SaK Superleague site**: an 8-team NHL fantasy keeper league (commissioner: Patrick Novak, team 1,
  "The Hip Czechs"). It is live and used every night of the season. Treat it as production.
- **Super Pools** (superpoolsai.com): the product being built from it. The SaK league is league 1, the model
  league. Every league-scoped table carries `league_id` (default `current_league_id()`, the caller's league); see
  `docs/SUPERPOOLS.md`.

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
  settle-bets, expire-bets, process-pending (every 10 s), health-check, fund-price, cron-history, cost-snapshot,
  cost-watch. A job that does a league's work runs once per active league: in SQL through
  `run_league_jobs(job)` (sets `app.league_id`, one league's failure doesn't stop the others), in an edge function
  through a client with the service key and an `x-league` header (`dbFor(league)` in nhl-sync and Garry).
- Points: the NHL data is shared, the scoring isn't. `player_games.fpts` and `players.proj / last_fp / rank` are
  SaK's numbers kept for old readers; read a league's points through `league_games`, `league_players`,
  `player_season`, `player_windows` (each league's scoring profile, `scoring_profiles`).
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

CI: `.github/workflows/test.yml` runs the build, `test:nhl` and the whole `test:db` (Postgres 16 service) on every
pull request and push to `main`. A red run is a red PR: fix it before anything else.

## Migrations and deploys

Database changes are made directly on the live project through the Supabase connector (`apply_migration`,
`execute_sql`). Every change goes out in this order, and the pull request says which steps are done:

1. Write `supabase/migrations/20261005000NNN_name.sql` (next number after the highest; cron changes in their own
   `*_cron*` file). Make it safe to run twice (`create or replace`, `if not exists`, guarded `do` blocks).
2. `npm run test:db` green locally, with a two-league section for anything league-facing.
3. Check live first: fingerprint every function the migration replaces, live and local, and compare
   (`md5(btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))` per `proname`); a
   difference means live has something the repo doesn't: stop and reconcile. For a change to numbers GMs see,
   prove with a read-only query on live that the new path reproduces today's numbers.
4. Apply with `apply_migration` (name = the file's name part), then verify: fingerprints now match the repo,
   `supabase_migrations.schema_migrations` has the row, the numbers SaK sees are unchanged, Postgres logs clean.
5. Deploy the edge functions that changed (below).
6. Merge the pull request last. A pull request whose migration is not live and verified never merges: the site
   and the functions deploy from `main` and would read objects that don't exist yet.

- Destroying league data (deleting rows GMs made, dropping a table or a column that holds data) needs Patrick's
  yes in the chat first, every time. Dropping functions, policies or triggers, and housekeeping deletes the tests
  cover, are ordinary migrations.
- If the connector holds a statement (the call hangs and times out after about 60 s): its tool permission is not
  set to allowed. Ask Patrick to open https://claude.ai/customize/connectors, choose Supabase and set
  `apply_migration` and `execute_sql` to allowed. Check the live state before retrying: a timed-out call may have
  applied nothing, or everything up to the held statement. Until it is fixed, the fallback is a paste file in the
  scratchpad (the migrations, then the `schema_migrations` rows, then a one-line check), dry-run twice on a clean
  copy of the pre-change schema, sent to Patrick for the SQL editor.
- Retire an old function signature with `alter function ... rename to ..._before_x` plus a revoke when a
  `drop function` would break callers mid-deploy.
- Edge functions: `.github/workflows/functions.yml` deploys every function on merge to `main` once the
  `SUPABASE_ACCESS_TOKEN` GitHub Actions secret exists. Until then (or for a fix that can't wait for a merge),
  deploy with the connector's `deploy_edge_function`, sending the full contents of `<fn>/index.ts` and every
  `_shared/*.ts` it imports, then compare the deployed files with the repo. Pitfall: a literal `\uXXXX` in source
  is decoded once more by that deploy path; send it as `\\u005cuXXXX`.
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
- Running costs: every paid outside call (today xAI, for Garry and the X feed) records its price with
  `meter_cost(league, source, feature, ...)` from the edge function (service role only), tagged with the feature
  (`garry.<task>`, `hub.x_feed`) and the league it served (0 = shared by every league). A new paid call does the same,
  or the dashboard (`#/costs`, platform admins in `ops.platform_admins` only) won't see it. Fixed bills are edited on
  that page. The ledger lives in schema `ops`, which the API doesn't serve.
- Never commit credentials. Secrets live in Supabase function secrets and GitHub Actions secrets. The test
  team's login is kept out of the repo.
- Expand, then contract: add the new path beside the old, move the readers, prove the numbers match, retire the
  old path in a later change (the debt list is in `docs/DEVELOPMENT.md`).
- The product learns: a new prediction or grade (projection, trade or draft grade, odds, a Garry pick) is
  written to the prediction log once it exists and scored when the result is in; a league's history lives in the
  database, never in code. See `docs/DEVELOPMENT.md` section 4.
- Flow-test sections end signed out (`reset role` and an empty `request.jwt.claim.sub`), so the next section
  doesn't run as another league's GM.
- Keep the docs true in the same pull request as the change: `docs/SUPERPOOLS.md`, `docs/EXPANSION.md`, this file.

## Team ids (SaK, league 1)

1 Patrick (commish), 2 Terry, 3 Jason, 4 Craig, 5 Trystan, 6 Panagiotis, 7 Todd, 8 Darin, 9 Dan Perra
(spectator).

## Where the plan lives

`docs/DEVELOPMENT.md` holds the order of work from here and the method; `docs/SUPERPOOLS.md` holds the product
plan and its ordered list; update both when a step lands.
`docs/REVIEW-2026-09.md` holds the resource-use and security baseline; update the numbers when they change.
