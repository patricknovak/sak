# CLAUDE.md: the standing briefing for this repository

Read this first in every session, then `docs/DEVELOPMENT.md` (how we build: the release order, the working method,
the knowledge base and the next steps), `docs/SUPERPOOLS.md` (the product plan), `docs/POOLS.md` (the direction since 4
October 2026: prediction pools for any group, the Love Is Blind test, soccer next), `docs/POOL-TYPES.md` (since 5 October
2026: the kinds of sports pool, one engine for them, the three-step start and a sport centre per sport, the World Series
test), `docs/BRAND.md` (how the product
is named, described and drawn), `docs/MARKET.md` (the competition and the road to every sport), `docs/EXPANSION.md`
(what must change before more leagues and sports, in order) and, for how the system is built and what it costs to
run, `docs/REVIEW-2026-09.md`.

## What this is

Two things in one repo:

- **The SaK Superleague site**: an 8-team NHL fantasy keeper league (commissioner: Patrick Novak, team 1,
  "The Hip Czechs"). It is live and used every night of the season. Treat it as production.
- **Super Pools** (superpoolsai.com): the product being built from it: fantasy leagues and prediction pools (the
  Polymarket interface, in Supercoins, never money) for any group, about anything. The SaK league is league 1, the model
  league. Every league-scoped table carries `league_id` (default `current_league_id()`, the caller's league); see
  `docs/SUPERPOOLS.md`.

## Stack and layout

- Front end: React 19 + Vite + TypeScript + Tailwind v4, `HashRouter`. Pages in `src/pages`, components in
  `src/components`, shared logic in `src/lib`. The app-wide store is `src/lib/store.tsx` (`useLeague()`):
  it loads league, teams, players, rosters, picks, draft, standings, season stats, windows, games,
  notifications and game-day status, subscribes to realtime, and exposes `leagueDay` and `brand`.
- A player's card opens in place, app-wide (`src/lib/playerInfo.tsx`, `PlayerInfoProvider` in `main.tsx`): `PlayerRow`'s injury,
  status and news chips and `PlayerTag` (a player named in a sentence) open it over the page, news dot on the News tab.
  New UI that shows a player uses them rather than linking away. The injury report's timeline (expected return, body
  part, IR list, the write-up) is on `players` (migration 152, written by nhl-sync's injury task) and drawn by
  `InjuryReport`.
- Lineups: the classic page is My Team (`src/pages/MyTeam.tsx`, its Daily lineups tab `LineupPlanner`); Lineup New
  (`#/lineup-new`, `src/pages/LineupNew.tsx`, `src/components/lineupnew/`, data in `src/lib/lineupKit.ts`) runs beside it
  for the league to compare (5 October 2026): Day (with What if), Week, League (every team ranked for a night or a week),
  Compare and Insights for any team (others read only); live points refresh every minute (`useDayPoints`), lines come from
  nhl-hub's shift charts (`useLines`); saving
  through the same `set_lineup` and `set_lineup_plans`. Plans are readable league-wide (migration 164).
- Sport: `src/lib/sport.ts` (`useSport()` from the store): the league's sport as the engine reads it (positions, slots,
  stats, game states, periods), the database's `sports` row with the NHL compiled in. New code that needs a position
  list, a slot rule or a stat label reads it instead of writing hockey in; the rest moves over one place at a time.
- Brand: `src/lib/brand.ts` (`useBrand()`, SaK defaults, `PRODUCT` constants). Names come from
  `leagues.brand`; never hard-code a new league-specific name. The league's colour (`brand.colors.gold`) themes the
  site through CSS variables (`--color-gold`, `--gold-rgb`, `--gold-hi`...; `applyBrandColors`): draw accents with
  `gold` classes or `rgb(var(--gold-rgb)/…)`, never a literal `#f7c548`. The commissioner edits the brand on the
  Commish page (`commish_set_brand`); the platform opens leagues on `#/platform`, from requests made on the public
  `#/start` page (drawn in the product's own colours, docs/BRAND.md). League by host: `src/lib/host.ts`
  reads the address (`league_by_host`), and the site sends that league as `x-league` on REST requests only (the edge
  functions' CORS doesn't list it).
- Backend: Supabase Postgres (project `quakdkzdafzlhgjvmypg`). Every rule is a SQL function behind
  row-level security; the site calls them with `rpc(...)` from `src/lib/supabase.ts`. Views compute
  standings, daily points, coin balances and money.
- Edge functions in `supabase/functions`: `nhl-sync` (scores, box scores, lineup snapshots, schedule,
  injuries, game-day status, news, projections, auto-lineups; tasks via `?task=`), `nhl-hub` (NHL centre
  data, cached in `hub_cache`; `?task=lines` works out each club's lines from the NHL's shift charts), `garry` (the league voice; the LLM is Grok via xAI, `XAI_API_KEY`),
  `player-info`, `push`, `yahoo`, `join` (makes a newcomer's account from an invite link and seats them, or with `pool` in the body opens a prediction pool for someone new: `#/new`, migration 153, three a day per address and sixty a day in all), `soccer-sync` (soccer fixtures and results per competition's
  provider: ESPN's public scoreboard for testing, `espn`, migration 168, or API-Football with `API_FOOTBALL_KEY`;
  `?task=fixtures|live`, platform key only; ESPN's other sports ride it too: the NFL by week, migration 171; ESPN's
  pre-match lines ride along as `fixtures.detail.odds`, chances only, frozen at kick-off, migration 178), `mlb-sync` (baseball's postseason from MLB's
  public Stats API into `series`, `fixtures` and `fixture_periods` through `sport_ingest`; platform key only; for testing, a
  licensed feed replaces it, docs/POOL-TYPES.md §8; `sport_ingest` ends by drawing and paying any grid of squares on the
  event, `_squares_tick`, migration 167). Shared code in `supabase/functions/_shared`.
- Scheduler: pg_cron jobs call the edge functions through pg_net with the anon key. Job names: nhl-scores
  (gated by `_scores_due()`), nhl-gameday, nhl-injuries, nhl-schedule, season-schedule, nhl-news,
  nhl-players, nhl-players-pregame, nhl-standings, nhl-corrections, nhl-corrections-deep, projections,
  auto-lineups, auto-lineups-late, garry-daily, garry-weekly, garry-nudge, garry-moments, open-book, settle-book,
  settle-bets, expire-bets, h2h-notes, pool-drops, pool-settle, soccer-fixtures, soccer-live (gated by `_soccer_due()`), mlb-live (gated by `_mlb_due()`), mlb-schedule, process-pending (every 10 s), health-check, fund-price, cron-history, cost-snapshot,
  cost-watch. A job that does a league's work runs once per active league: in SQL through
  `run_league_jobs(job)` (sets `app.league_id`, one league's failure doesn't stop the others), in an edge function
  through a client with the service key and an `x-league` header (`dbFor(league)` in nhl-sync and Garry).
- Points: the NHL data is shared, the scoring isn't. `player_games.fpts` and `players.proj / last_fp / rank` are
  SaK's numbers kept for old readers; read a league's points through `league_games`, `league_players`,
  `player_season`, `player_windows` (each league's scoring profile, `scoring_profiles`).
- Formats: how a league is won is in `league_rules` (and the `league` view): `format` ('season', SaK's total, or 'h2h'
  weekly matchups on `matchups`), `categories` (null for points; set, it is rotisserie in a season league and weekly
  categories in an h2h one) and `h2h_playoffs` (0, or the bracket's size). Read the tables through `standings` (points),
  `category_standings()`, `h2h_scores()` / `h2h_standings()` / `h2h_bracket()` (worked out on read). Anything that ranks
  teams (payouts, Garry, the Money page) follows the format; SaK's path stays the points table.
- Hosting: the app on GitHub Pages from `main` (`.github/workflows/deploy.yml`, builds on push) and on Cloudflare; the
  Super Pools landing page (`landing/index.html`) on Cloudflare (zone routes on the apex and www; off Vercel); every
  other `<league>.superpoolsai.com` goes to the app through a wildcard zone route and a proxied `AAAA * 100::` record (live
  since 4 October 2026: `podsquad.superpoolsai.com`). One account, every pool (migration 151): the product's one address is
  `app.superpoolsai.com`; a pool's link is `#/p/<web name>/<page>` there and invites are `#/join/<code>` there (`appLink`,
  `poolLink` in `src/lib/host.ts`); a `<web name>` subdomain forwards to it unless someone is signed in on that address.
  My pools (`#/pools`) reads `my_pools()` and starts prediction pools with `pool_start`. Every pool's games share one scoreboard
  (`pool_scoreboard()`, migration 169): a new kind of game adds a branch to `_pool_rows()` and gets the table, movement,
  climb alerts and the main-game crown (`league_rules.crown`) with it. Weekly pick'em (migration 170) is the first kind on
  `fixtures`: any competition whose matches come in rounds; last one standing runs on the same competitions in the
  sport's words (migration 173, `pool_game_start('survivor', ...)`), and `#/centre/<competition>` is their centre
  (`src/pages/RoundCentre.tsx`: NFL centre, Match centre); a pool's own result on a match (the host's, in
  `pool_result_overrides`, read through `_pool_fixture`) settles every game on it (migration 177); the start page and the host's desk list events through
  `pool_event_list()` (`pool_events()` stays for older copies of the site). Decided (3 October 2026): both move to **Cloudflare** (free for commercial
  use, DNS already on Cloudflare, wildcard subdomains for league by host); never plan new work on Vercel. Built as
  Workers serving static assets (`wrangler.jsonc`, `landing/wrangler.jsonc`; Pages can't take a wildcard), deployed by
  `.github/workflows/cloudflare.yml` (the secrets are set; SaK's address there is `sak.superpoolsai.com`). The
  move is in `docs/EXPANSION.md`.

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

Database changes are made directly on the live project. Two routes:

- `scripts/db.sh` (Supabase's Management API, with `SUPABASE_ACCESS_TOKEN` from the cloud environment's settings):
  `scripts/db.sh migrate <file>` applies a migration and records it; `scripts/db.sh query "<sql>"` runs a statement.
  This is the route for any migration with `drop` or `delete` in it, functions included.
- The Supabase connector (`execute_sql`, `apply_migration`) for reads and for SQL with no `drop` or `delete`. The
  connector holds any statement containing either word (even a `delete` inside a function body, even on a temp
  table) for a confirmation a cloud session can't give, whatever the tool permissions say; the call times out after
  60 s with nothing applied. Checked 3 October 2026 with the tools set to allowed.

Every change goes out in this order, and the pull request says which steps are done:

1. Write `supabase/migrations/20261005000NNN_name.sql` (next number after the highest; cron changes in their own
   `*_cron*` file). Make it safe to run twice (`create or replace`, `if not exists`, guarded `do` blocks).
2. `npm run test:db` green locally, with a two-league section for anything league-facing.
3. Check live first: fingerprint every function the migration replaces, live and local, and compare
   (`md5(btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))` per `proname`); a
   difference means live has something the repo doesn't: stop and reconcile. For a change to numbers GMs see,
   prove with a read-only query on live that the new path reproduces today's numbers.
4. Apply (`scripts/db.sh migrate`, or `apply_migration` with the file's name part), then verify: fingerprints match the repo,
   `supabase_migrations.schema_migrations` has the row, the numbers SaK sees are unchanged, Postgres logs clean.
5. Deploy the edge functions that changed (below).
6. Merge the pull request last. A pull request whose migration is not live and verified never merges: the site
   and the functions deploy from `main` and would read objects that don't exist yet.

Every pull request is safe to merge the moment it is opened, even as a draft: Patrick may merge any open pull
request. Code that needs SQL not yet live stays out of it (on the branch, unpushed, or in a later pull request
opened once the SQL is live). PR #74 broke the live site for this reason (its site change read views whose SQL
wasn't applied); #75 was the hotfix.

- Destroying league data (deleting rows GMs made, dropping a table or a column that holds data) needs Patrick's
  yes in the chat first, every time. Dropping functions, policies or triggers, and housekeeping deletes the tests
  cover, are ordinary migrations.
- After a connector timeout, check the live state before anything else: a timed-out call may have applied nothing,
  or everything up to the held statement. Without `SUPABASE_ACCESS_TOKEN` in the environment the fallback is a
  paste file in the scratchpad (the migrations, then the `schema_migrations` rows, then a one-line check), dry-run
  twice on a clean copy of the pre-change schema, sent to Patrick for the SQL editor.
- Retire an old function signature with `alter function ... rename to ..._before_x` plus a revoke when a
  `drop function` would break callers mid-deploy.
- Edge functions: `.github/workflows/functions.yml` deploys every function on merge to `main` once the
  `SUPABASE_ACCESS_TOKEN` GitHub Actions secret exists (it does: soccer-sync v6 came from the workflow). For a change
  that can't wait for a merge, run the workflow's own command from a session with `SUPABASE_ACCESS_TOKEN`:
  `npx -y supabase@2 functions deploy <fn> --project-ref quakdkzdafzlhgjvmypg --use-api` (exact files, JWT verification
  kept on; 8 October 2026). Otherwise deploy with the connector's `deploy_edge_function`, sending the full contents of `<fn>/index.ts` and every
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
  The service key (Garry, the edge functions) skips row-level security, so a view that ranks, counts or lists across
  teams filters `league_id = current_league_id()` itself (migration 96: the sign-in list and the standings).
- The platform admin key (`private.app_keys`, name `admin`) goes in the `x-admin-key` header for Garry's
  commissioner tasks (keepers, learn, evolve, assess, probe); the public anon key alone is refused. Never put it
  in the site or the repo.
- Comments explain the league rule or the reason, in plain language, in the voice of the existing code.
- UI copy is hockey-league plain English, phone-first (390 px wide) and checked with a screenshot before
  a PR (Playwright with the pre-installed Chromium; sign in as a test team, never as a real GM).
- Every feature is built in the most beautiful, visually appealing way we can (Patrick's standing rule): it looks like a
  premium sports app, fits a small phone (check 360 and 390 px) without cutting off what a GM needs, wraps rather than
  truncates key facts, and uses the league's brand and the existing card, chip and colour language. A plain or cramped
  first version is not done.
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
- Sign-in is email and password (GMs' own emails, set by the commissioner on the Commish page; open sign-up is off).
  Auth email (the 6-digit password reset code) goes through Resend's SMTP from no-reply@superpoolsai.com; the key lives
  only in Supabase's SMTP settings. superpoolsai.com's DNS is on Cloudflare.
- Money and a league fund are per-league options (`league_rules.features`: `money`, `fund`), never requirements: SQL checks
  `league_has()` / `_feature()`, the site `hasFeature()` (`src/lib/features.ts`). SaK has both; a new league neither.
- Expand, then contract: add the new path beside the old, move the readers, prove the numbers match, retire the
  old path in a later change (the debt list is in `docs/DEVELOPMENT.md`).
- The product learns: a new prediction or grade (projection, trade or draft grade, odds, a Garry pick, a pool's pick
  split at kick-off, migration 174; a member's chance to win, 175) is written to the prediction log once it exists and scored when the result is in; a league's history lives in the
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
