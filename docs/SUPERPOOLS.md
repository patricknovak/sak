# Super Pools: AI-enhanced fantasy leagues

Super Pools is the product built from the SaK Superleague site. The SaK league is league 1, the model
league, and keeps running on the same code and database while the product grows around it. This document is
the plan of record: what the product is, how leagues are separated, what is shared, and the order of work.

Domains: `superpoolsai.com` (primary) and `superpoolai.com` (redirects to the primary). The market, the
competition and the road to every sport are in `docs/MARKET.md`; the words and the look in `docs/BRAND.md`.

Landing page hosting: Vercel project `superpools` (team `patricknovak1-8908s-projects`, id
`prj_SRNe8ClGioGw9vAAOwq3unQ9tbMh`), linked to this repo with root directory `landing/`; every push to `main`
redeploys it. Production domains on the project: `superpoolsai.com` serves the page; `www.superpoolsai.com`,
`superpoolai.com` and `www.superpoolai.com` are 308 redirects to it. DNS lives in Cloudflare (DNS only, no
proxy): apex `A 216.150.1.1`, `www` `CNAME cname.vercel-dns.com`, on both zones.

## 1. What it is

A fantasy hockey league site with an AI commissioner's assistant built in. One league is one tenant. Each
league gets: live scoring from NHL box scores with per-player puck-drop locks; daily lineups set up to 60
days ahead with an auto-pilot; a draft room (clock, board, queues, TV mode, mock drafts, graded report
card); keepers; trades with grades; free-agent and trade finders; side bets and a coin sportsbook that settle
themselves; a Performance page (every point that counted, by day and by category, for any team or the
league, with plain-language analytics); projections and simulated-season forecasts; a chat with polls; push notifications; and a league
voice (Garry in SaK, named per league) that posts recaps, rankings, grades and answers questions.

The NHL data behind all of that is fetched once and shared by every league.

## 2. Tenancy model (done in migration 59)

- `leagues` is the tenant table: `id`, `slug`, `name`, `short_name`, `sport`, `status`, `brand` (jsonb),
  `domain`, `owner_user`. SaK is id 1, slug `sak`.
- `league` (the per-league rules row: roster caps, scoring weights, keepers, draft settings, money split)
  now carries `league_id`. One row per league; SaK's is row 1.
- Every league-scoped table has `league_id int not null default 1 references leagues`. The default is what
  keeps the live league untouched: every existing row and every new insert is league 1 until a call site
  says otherwise. Indexed on the tables read in bulk.
- `current_league_id()` returns the signed-in GM's league (1 for everyone today). It is the one hook every
  future policy and view filter uses.
- `create_league(slug, name, short, brand)` makes a new league with SaK's rules as its starting point.

**Shared tables** (league-independent, fetched once): `players`, `games`, `player_games`, `player_status`,
`player_events`, `player_history`, `news`, `nhl_teams`, `stat_corrections`, `hub_cache`, `health_alerts`,
`fund_prices`.

**Per-league tables**: teams, rosters, draft_picks, draft_state, draft_queue, lineup_plans,
lineup_plan_applied, lineup_snapshots, messages, chat_reads, reactions, polls, poll_votes, bets, bet_entries,
coin_ledger, markets, market_bets, ledger, fund, fund_ledger, acq_transfers, trades, trade_items, trade_block,
transactions, proposals, proposal_votes, feature_ideas, feature_comments, feature_votes, notifications,
push_subscriptions, yahoo_accounts, pool_links, garry_memory, garry_state, league_reports.

## 3. Brand layer (done)

`leagues.brand` holds the names the site used to hard-code: the two-word wordmark, tagline, trophy, the
last-place prize, the bot's name and emoji, the coin's name and emoji, the accent colour. The app reads it
through `useBrand()` (src/lib/brand.ts) with SaK defaults for anything missing. The wordmark and the
sidebar tagline use it now; the remaining hard-coded names (the Peter, Garry, St. Patrick coins, the SAK
Cup) move over as each screen is touched. `src/lib/brand.ts` also holds the product constants.

## 4. Per-league policies (done in migration 60)

Every policy on a table that carries `league_id` now requires `league_id = current_league_id()` in front of its
own predicate, reads and writes alike, including the commissioner's `or is_commish()` branches. `leagues` and
`league` are readable only for the caller's league. The scoring, coin and money views run as the caller
(`security_invoker`), so they inherit the bound without a filter of their own. A row written with a team on it
takes its league from that team (`_stamp_league` before-insert trigger on every league-scoped table with
`team_id`, `creator_team`, `from_team`, `sponsor_team` or `trade_id`), so the client's direct inserts and the
SQL functions never rely on the column default of 1. The flow test opens a second league and checks that
neither league sees the other's teams, rosters, chat, bets, money, lineup plans or standings.

Still open from this step: `current_league_id()` falls back to league 1 for a signed-in user with no team row
(today that is nobody; accounts replaced the fallback for anyone with a membership), and `team_directory` stays the public list
of every team on the login page until the app is served per host (step 1).

## 5. Every rule reads its own league's row (done in migration 62)

The rules table is `league_rules`; `league` is a view of the caller's row (`where league_id =
current_league_id()`, caller's rights), so the thirty-seven functions and five views that read `league` keep
their text and land on the right league. `current_league_id()` honours an `app.league_id` setting first (the
hook the per-league scheduler sets before each league's pass), then the signed-in GM's league, then league 1.
The functions that pinned the row to `id = 1` lost the pin. The edge-function tasks that loop over teams
still run for league 1 only; that is the scheduler step below.

## 6. Accounts (done in migration 63)

A person is an account with a membership per league: `league_members (user_id, league_id, team_id, role)`,
backfilled from the team rows and kept in step with them by a trigger (`teams.user_id` stays the login on the
team, now one team per person per league). `accounts.active_league_id` is the league a person is working in
when the request does not say. `current_league_id()` resolves, in order: the scheduler's `app.league_id`
setting; the request's `x-league` header when the caller is a member of that league (the site sends it once
it has a league switcher); the account's active league; the first membership; league 1. `my_team()`,
`_team()`, `is_commish()`, `_commish()`, `is_gm()` and `can_do()` read the membership for the current league,
so a commissioner in one league is a plain GM in another. `my_leagues()` and `set_active_league()` serve the
switcher. Invites: `create_invite(team, role, days, uses)` mints a code for an open seat or a spectator
place, `accept_invite(code)` claims it and makes the joined league active, `revoke_invite(code)` ends it.
The flow test has the SaK commissioner join the north league as a GM, switch between the two, be picked by
header for one call, and a fan join as a spectator. Still to come with onboarding: sign-up, the invite page
on the site, and the switcher.

## 7. What is not done yet, in order

1. **League by host.** `leagues.domain`: `sak.superpoolsai.com` or a custom domain per league; the app picks
   the league from the host, so one deployment serves all leagues.
2. **Garry per league.** Memory and persona are already keyed by team and channel; add the league key and
   a per-league daily budget of LLM calls (the one cost that scales with leagues).
3. **Scheduler per league.** nhl-sync's league-scoped tasks (snapshots, auto-lineups, standings,
   settlement) iterate leagues, setting `app.league_id` before each league's pass; the NHL fetches stay single.
4. **Money.** Coins stay. Cash tracking stays bookkeeping between friends (no payments handled), or is
   turned off per league.
5. **Onboarding.** A new league: sign up, name and brand it, invite GMs, import a Yahoo pool (the connector
   exists) or start fresh, set rules, draft.
6. **Billing.** A subscription per league per season (Stripe). Landing page collects interest until then.

The steps above finish the tenancy. `docs/MARKET.md` sets what comes after in three horizons. The first,
"win hockey and lay the foundations", adds to this list in this order once tenancy is done:

7. **Tiers and billing.** Free, Plus, Premium, the side-bet add-on and the Super Pool bundle, enforced per
   pool (a `plan` on the league row and a feature gate function), Stripe for the paid tiers.
8. **Category and rotisserie scoring.** The scoring engine reads the league's categories the way it reads
    its point weights.
9. **Import with history** from Fantrax, ESPN and CBS (Yahoo exists).
10. **Contracts, caps, prospect slots and rookie drafts**; guillotine and best ball formats.
11. **The Supercoin.** An account-level wallet, the SaK coin ledger migrated onto it, per-pool allowances, the
    Book and side bets as the add-on, the ledger visible in every pool. Never for sale, never cashed out.
    Already in place on the league coin (migration 66): the Book's season edition (futures on the champion,
    last place, the playoffs and the full-year trophy, priced from the standings and re-priced daily; season
    props on every team and the biggest names, settled from the standings and season stats) and the coin
    races (net coins this week, this month, this season). The kinds and subjects are a stat key and a line,
    so they carry to every sport.
12. **Commissioner tools the market lacks**: dues tracker (no escrow), co-commissioners, constitution page,
    audit trail of every override, abandoned-team handover.
13. **The sport pulled out of the engine**: a `sports` table, per-sport player, game and stat shapes and
    scoring vocabularies, a sync per sport; the NHL becomes one row. Prerequisite for soccer, basketball and
    the multi-sport pool.
14. **Telemetry and the feature board**: pseudonymous per-pool usage tables with a commissioner opt-out, the
    SaK Features page grown into a product-wide board with public statuses and a changelog.
15. **App-store listing**, the **playoff bracket pool**, and the voice per league with a daily budget.

Then horizon 2 (soccer on licensed data, basketball, the multi-sport pool, the Supercoin prediction market,
the Super Pool bundle, the public API) and horizon 3 (cricket free-to-play, baseball, football and college,
pools for golf and F1, Supercoin competitions and non-cash prizes), as `docs/MARKET.md` lays out.

## 8. Environments

| | Today | Product |
|---|---|---|
| Database | one Supabase project (`quakdkzdafzlhgjvmypg`), SaK is league 1 | same project through beta; a second project for staging before the first paying league |
| App | GitHub Pages from `main` | Vercel, one deployment, league chosen by host |
| Landing | Vercel project `superpools` from `landing/` | same, grows into sign-up |
| Edge functions | Supabase, deployed by hand | same, deployed from CI |
| LLM | Grok (xAI) for Garry and X search | same, per-league budget; model per league later |

## 9. Working agreement

- The SaK league is the model and the test and development platform: build features there first, on the
  league that uses them every night. Unless Patrick says otherwise for a feature, anything built for SaK is a
  Super Pools feature (or a per-league customization) for every league: it reads its league's rules, brand and
  data by `league_id` and never assumes SaK's names or numbers.
- Every league-scoped change from now on writes `league_id` explicitly (or relies on the default = 1 only
  where the caller can only be in SaK).
- Nothing in `docs/` or the app names SaK as the product; the product is Super Pools, SaK is a league on it.
