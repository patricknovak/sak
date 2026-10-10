# Expansion readiness: more leagues, then more sports

The review of record for growing Super Pools past one league and one sport. It answers two questions: what
breaks today if a second league (or a second sport) is switched on, and the order of work that makes adding
leagues a routine, issue-free process. It sits under `docs/SUPERPOOLS.md` (the plan) and `docs/MARKET.md` (the
road to every sport); `supabase/tests/tenancy.sql` is its enforcement.

Reviewed 2 October 2026 against `main` after PR #68: all 77 migrations (each function judged by its latest
definition), every edge function, the whole front end, and the live database. Three independent passes
(database, edge functions, front end), then the claims that drive the plan were checked by hand against
production.

## 1. The verdict

- **SaK is safe and unaffected.** Every finding below is about what happens when a second league or sport
  arrives. Nothing in this review changed what SaK's GMs see.
- **Tenancy is about two thirds done.** Every league table carries `league_id`, has row-level security on, has
  every policy bound to `current_league_id()`, and stamps its league from the team on insert (checked by the
  new guardrail test, section 3). Rules, accounts, invites and Garry are per league.
- **A second hockey league cannot go live yet.** Eight blockers (section 4) would make it collide with SaK on
  the first draft, the first scored game or the first cron run: one roster row per NHL player across all
  leagues, a single draft, fantasy points stored once with SaK's weights, a scheduler that only ever runs as
  league 1, and a sign-in page that lists every league's teams.
- **A second sport is a larger, separate step.** The NHL is threaded through the schema (positions, stat keys,
  game states, ids, the Eastern-time league day) and the front end. Section 6 lays out the split: a `sports`
  table, a sport adapter for data, and scoring profiles, with the NHL becoming the first row.
- **What this pass fixed:** three holes that were open today (section 2), cross-league guards on 26 functions,
  and a guardrail test that fails the build when a new table, view or function breaks tenancy.

## 2. Fixed in this pass

Migrations 76 and 77 (applied to production), Garry v32 (deployed), and the guardrail test.

| What | Was | Now |
|---|---|---|
| `_payout_market` | Callable with the public key: anyone could pay out any Book market to the winner of their choice. All 80 settlements on record happened at the scheduler's minutes, so nobody did. | Revoked from the API; only the settlement jobs call it. |
| Garry's commissioner tasks (keeper report, memory passes, voice-note rewrite, the league column, probes) | Callable with the public key; the keeper report had no once-a-day guard, so anyone could make Garry post it again and again, at our LLM cost. | A league's commissioner session, or the platform admin key (`x-admin-key`, held in `private.app_keys`, checked by `admin_key_ok`, which only the service role may call). |
| `current_league_id()` for a signed-in person with no membership | Fell through to league 1: any new account would have read all of SaK. | No league: they read nothing. The scheduler (no user) still lands on league 1. |
| Commissioner and GM tools that take an id (coins, ledger lines, password resets, keepers, picks, bets, markets, trades, proposals, ideas, Garry's memory) | Security-definer functions with no league check: a commissioner in league 2 could hand out coins, settle bets or reset a SaK GM's password. | `_in_league(table, id)` runs first in all 26 of them. |
| `_sys()` (site notices) | Always posted into SaK's chat. | Posts into the caller's league. |
| `@mentions` and the bot's name | `@all` in any league pinged every league's GMs; the bot answered only to "garry". | Mentions stay in their league; the bot answers to its league's name from `leagues.brand`. |
| Garry at the Book | The GM's RPCs ran in their active league, not the run's league. | Sent with `x-league`. |

The flow test now proves each of these (the second league's commissioner tries every tool on SaK ids and is
refused; a stranger reads nothing; a SaK `@all` never reaches the north league).

## 3. The guardrails (how it stays fixed)

`supabase/tests/tenancy.sql` runs after the flow test on every `npm run test:db`. It fails when:

1. A table has no `league_id` and isn't on the shared list (NHL data, caches, platform tables).
2. A league table has row-level security off, or any policy that doesn't check `current_league_id()`.
3. A league table that names a team lacks the `_stamp_league` trigger.
4. A view doesn't run as the caller (`security_invoker`).
5. An internal `_name` security-definer function that writes can be called from the API.
6. A callable security-definer function takes an id (`p_team`, `p_bet`, `p_market`, ...) and never checks
   its league.

Each rule carries a short reviewed list with the reason for every entry. Those lists are the debt register:
they only ever get shorter. Proven by planting a table, a view and a function that break the rules: each was
caught. The same rules were run against production and pass.

**Working rule from now on:** a new league table gets `league_id`, the stamp trigger and bound policies in the
same migration; a new RPC that takes an id calls `_in_league` first; a new view is `security_invoker`. The test
says so if you forget.

## 4. Blockers before a second league goes live (same sport)

Each is confirmed against production. Fix in this order; each lands with flow-test coverage for two leagues.

**B1. One roster row per NHL player across every league.** `rosters` has `primary key (player_id)`. League 2
cannot roster anyone SaK owns, and every lookup by player alone (`add_player`, `drop_player`, `_do_pick`'s
"already taken", `commish_move_player`'s `on conflict (player_id)`, `_autopick_player`, the injury and
big-night alerts, Book props) reads across leagues.
*Fix:* key `(league_id, player_id)`; add the league to every player-keyed roster query; alerts loop every
owning team, one per league.
*Done (migration 81, October 2026).* The key is `(league_id, player_id)`. Nineteen functions look a player up in
the right league: the team's for a GM's own moves, the caller's for the commissioner's, the pick's in the draft;
the injury and big-night alerts reach the owning team in every league; `_in_league` refuses only when none of a
player's rows is in the caller's league; nhl-sync's scratch check counts a shared player once. The flow test has
two leagues roster the same player, add, move and release him independently, and both owners get his injury.

**B2. The draft is single-tenant.** `draft_state` is one row (`check (id = 1)`); `draft_picks` is
`unique (season, overall)` and `unique (season, round, original_team)`; `draft_set_order`, `_ensure_picks`,
`_do_pick`, `_advance`, `draft_tick`, `draft_undo`, `draft_reset`, `finalize_keepers` and
`ensure_future_picks` count, create or delete across all leagues (`draft_reset` deletes every league's drafted
players). `_advance` posts `garry?task=draft` with no league.
*Fix:* one `draft_state` row per league (`unique (league_id)`); pick uniqueness includes `league_id`; every draft
and keeper function filters by league; the cron `draft_tick` loops leagues.
*Done (migration 82, October 2026).* One draft row per league, made by `create_league` (or on first use);
`overall` is unique per league; every draft function works on the caller's league (order from its own GMs only,
picks, undo and reset in its own league; `finalize_keepers` was scoped in 81). `draft_tick` and `process_pending`
run league by league from the scheduler with `app.league_id` set, each trade on its league's review hours, and a
failure in one league is logged without stopping the others (the start of B4). Garry's draft recap gets
`&league=`. The flow test runs a north draft (her order, her pick of a player SaK owns, an autopick by the
scheduler, a reset) while SaK's finished draft and drafted rosters stay byte for byte the same.

**B3. Fantasy points are stored once, with SaK's weights.** The `_player_games_fpts` trigger writes
`calc_fpts(stats)` into the shared `player_games.fpts` as league 1; every standings view, the Book, bench
tallies and Garry sum it. `commish_update_scoring` re-scores every game for everyone, so a league-2
commissioner saving scoring would rewrite SaK's season. `recompute_player_values` writes `proj`, `last_fp` and
`rank` onto the shared `players` table.
*Fix:* scoring profiles. A `scoring_profiles` table (one row per distinct scoring set, keyed by a hash, shared by
leagues with the same rules), `player_game_points (profile_id, game_id, player_id, fpts)` filled by the stats
trigger for every active profile, and `player_values (profile_id, player_id, proj, last_fp, rank)`. Views join
through `league_rules.profile_id`. Saving scoring switches the league to a profile; it never rewrites another.
SaK's current points become profile 1 unchanged.
*Done (migration 83, October 2026).* `scoring_profiles` (keyed by an md5 of the weights, shared by leagues with
the same rules), `league_rules.profile_id` kept in step with `league_rules.scoring` by a trigger (saving new weights
switches the league and scores the whole season under the new profile on the spot), `player_game_points` filled for
every profile in use as each stat line lands, and `player_values`. `league_games`, `league_players` and
`league_corrections` are the shared tables seen with the caller's league's points; the four point views and 16
functions read them, the site reads them, and stat-correction notices use each team's own league's weights. SaK's
weights are profile 1, which reproduced the live points, projections and ranks exactly. `player_games.fpts` and
`players.proj / last_fp / rank` still hold SaK's numbers for the edge functions (Garry, nhl-sync, keeper grades),
which read them directly until B4 gives them a league. The flow test has the north double a goal's worth: the same
game scores differently in each league, SaK's points, projections, ranks and standings stay byte for byte the same,
a new stat line is scored under both profiles, and going back to SaK's weights shares profile 1 again.

**B4. The scheduler only ever runs as league 1.** Nothing sets `app.league_id`. In SQL: `open_markets`,
`open_season_markets`, `open_nhl_markets`, `reprice_season_markets`, `settle_season_markets`,
`settle_race_markets`, `settle_due_bets` (SaK's `season_end`), `process_pending` (SaK's trade review hours and
roster caps; one failing trade aborts the whole job, `draft_tick` included). In nhl-sync: `take_snapshots`,
`apply_lineup_plans`, auto-lineups (the teams query has no league filter and uses SaK's phase and caps),
`notify_corrections`, the faceoff decision, projections.
*Fix:* a league pass: one SQL entry point `run_league_jobs(p_league)` that sets `app.league_id` locally and runs
the per-league work, called once per active league by each cron job; nhl-sync splits into the shared NHL fetch
and a per-league pass through RPCs that take `p_league` (a `set_config` doesn't carry across PostgREST calls).
Each league's pass catches its own errors.
Since B3 the edge functions' reads of `player_games.fpts`, `player_season` and `players.proj` give SaK's numbers when
no league is set; the league pass sends `x-league` (or reads `league_games` / `league_players` through an RPC that takes
`p_league`) so Garry, the projections task and the keeper grades score in each league's own points.
*Done (migrations 84 and 85, October 2026).* `run_league_jobs(job)` runs the Book's open, its settling, the season and
NHL markets and the bet settler once per active league with `app.league_id` set, catching each league's errors; the
five cron jobs call it. `open_markets`, `settle_markets` and `settle_due_bets` work on the running league's rows only
(the props carry the league's short name, not "SaK"). The service key may name a league with `x-league`, so nhl-sync's
auto-pilot runs league by league (its phase, caps, points, teams) and Garry reads box scores, projections, season
lines and standings in his league's points. Every `league_id` defaults to `current_league_id()`, not 1 (tenancy rule
7). Roster caps come from the team's own league in a lineup change, the plans applied at puck drop and the
auto-pilot. The faceoff feed is fetched when any league scores faceoffs. The flow test opens the Book for SaK and the
north at once (each its own board, chat line and prop name), checks the service key's league, caps by league and a
refused unknown job. Left for later: the SaK Fund's price (B6) and the health check, which are platform-wide.

**B5. Sign-in and choosing a league.** (Realtime done, October 2026: a league's tables are heard for that league
only on inserts and updates; deletes, which Realtime can't filter, still arrive from every league and cost a refetch.)
*Decided (Patrick, 3 October 2026):* email sign-in with "remember me", rolled out without signing anyone out.
Step 1 (migration 103): the sign-in page asks for email and password, with "Remember me on this device" (on by default;
off keeps the session in sessionStorage); the commissioner puts each GM's real email on their account from the Commish
page (`commish_set_login_email`; the account, password and existing sessions are untouched), and the old team picker
stays one tap away for anyone not moved yet. *Step 2 done (migration 104, same day, all nine accounts on real emails):*
the picker is gone, `team_directory` lists names and colours only, open sign-up is off (accounts come from the
commissioner, and from invites once they exist), and "Forgot your password?" emails a 6-digit code that is typed with
the new password on the sign-in page (works on any device). Auth email goes through Resend (SMTP, set 3 October 2026):
SAK Superleague <no-reply@superpoolsai.com>, domain verified (DKIM, SPF on `send`, DMARC `p=none` to tighten once mail
has flowed a while), 30 auth emails an hour. GMs change their password any time on their Profile.
*Security harden (migration 240):* `team_directory` runs as the caller; anon keeps only the non-secret team columns
for the health check; PUBLIC/anon execute is revoked on SECURITY DEFINER RPCs the signed-out site does not call.
*Joining and the switcher done (migration 105, the `join` edge function):* the commissioner makes invite links on the
Commish page (an open seat, once; a spectator place, up to five times; 14 days); the link opens `#/join/<code>`, which
shows the league and seat before sign-in (`invite_preview`). Someone new makes their account there (the `join`
function creates it and seats them through `_accept_invite`, removing the account again if the seat can't be taken);
someone with an account signs in and joins (`accept_invite`). Profile lists an account's leagues and switches between
them (`my_leagues`, `set_active_league`). Presence was already per league. Next: hosting and league by host.
*Hosting (decided by Patrick, 3 October 2026): Cloudflare Pages* for the app and the landing page (free for commercial
use, DNS already on Cloudflare, wildcard subdomains for league by host). The move, with no interruption for GMs:
(1) a Pages project built from this repo beside GitHub Pages, each pull request getting a preview; (2) SaK at
`sak.superpoolsai.com`, with sign-in, push and the installed app checked there; (3) GMs told the new address, the old
GitHub Pages address forwarding to it for a season; (4) the landing page off Vercel onto Cloudflare at `superpoolsai.com` (the `superpools-landing` Worker on zone routes for the apex and www; *done 4 October 2026*, and the wildcard record puts every league's address on the app);
(5) league by host: the app reads the host, `league_by_host()` returns the league's brand before sign-in, and a new
league is a subdomain. *Step 5's app side is built (migration 107):* `league_by_host(host)`, the site's `x-league`
header from the address (`src/lib/host.ts`), the sign-in page in the league's brand with its crest, a notice for a GM
on a league they're not in, a league switched to on Profile kept for that tab, and each league's address and own
domain on the Platform page. It waits only on steps 1 and 2 (the Cloudflare project and its wildcard).
*How, on Cloudflare (4 October 2026):* Pages can't take a wildcard custom domain, so the app goes on Cloudflare's
successor to Pages, a Worker serving the built site as static assets (`wrangler.jsonc`), which takes the route
`*.superpoolsai.com/*`; the landing page is a second one (`landing/wrangler.jsonc`). Same free plan, same account.
`.github/workflows/cloudflare.yml` builds and deploys both on every push to `main` once the secrets exist, and
until then stops green with a notice; `public/_headers` keeps the service worker and the page uncached and the
hashed build files cached for a year. What Patrick sets up once: a Cloudflare API token with Account → Workers
Scripts: Edit, and Zone (superpoolsai.com) → Workers Routes: Edit and DNS: Edit; then the token and the account id as
GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and in the cloud environment, for the
sessions). The first push then gives a preview at `superpools-app.<account>.workers.dev` (step 1); step 2 adds a
proxied wildcard DNS record (`AAAA * 100::`) and the route in `wrangler.jsonc`. *4 October 2026:* the secrets are set. The first deploy goes straight to
`sak.superpoolsai.com` as a Worker custom domain (the deploy makes its DNS record and certificate), which is steps 1
and 2 together, beside GitHub Pages; the landing Worker is uploaded with no address until step 4. Checked before it:
the build's base is relative, every edge function answers any origin, `league_by_host` maps `sak` to league 1, and
sign-in needs no redirect address. *Live the same day:* the deploy needed the token's
Workers Scripts and Workers Routes permissions (the first run was refused, the re-run went through), and
`sak.superpoolsai.com` now serves the app from Cloudflare: the sign-in page wears SaK's brand, `league_by_host` answers
league 1, and the service worker and the hashed files carry the cache rules in `public/_headers`. Still to check with
a signed-in GM: push and the installed app at the new address (a phone's push subscription belongs to the address,
so GMs turn alerts on again there). Then step 3, telling the GMs, and step 4, the landing page.
*One app for every pool (4 October 2026, migration 151):* a subdomain per pool would mean a sign-in, an installed app
and an alerts permission per pool for anyone in several (each address keeps its own storage), so the pool moves into
the link instead. `app.superpoolsai.com` is the product's one address (the wildcard route already serves it); a pool's
link is `#/p/<web name>/<page>`, read before the router starts (`src/lib/host.ts`: the tab's league is set and the name
drops out of the address); invites are made on the app's address (`appLink`). `<web name>.superpoolsai.com` forwards to
the one app, keeping the page, unless someone is signed in on that address, so SaK's GMs on `sak.superpoolsai.com` see no
change. My pools (`#/pools`, `my_pools()`) is the switcher, with each pool's standing and what needs attention, and
`pool_start` opens a prediction pool from inside an account (limits: five a day, 25 in all). Nothing per pool is set up
outside the database. Still to come: a league's own domain through Cloudflare for SaaS, and one push subscription
carrying alerts for every pool.

**B6. Money and the Fund are SaK's.** `commish_bill_entries` bills every league's GMs; `commish_post_payouts`
reads `standings` with the owner's rights, so it ranks, pays and charges the Peter across leagues; `fund` is one
row (`check (id = 1)`) and `fund_prices` is shared (SaK's TSLA holding shows to everyone).
*Fix:* filter both by league; the Fund becomes per league (`fund (league_id)`, `fund_prices (league_id, date)`)
or an explicit SaK-only feature hidden elsewhere. *Decided (Patrick, October 2026):* money and the Fund are features any league
can turn on, never requirements.
*Money done (migration 86, October 2026).* Billing and payouts work on the commissioner's league only (its GMs, its
pool, its standings), and the ledger's words come from the league's brand (`regular`, `playoff`, `trophy`, `booby`,
`fund`, with plain defaults; SaK's read as before). `teams.id` comes from a sequence; a spectator lands in the
commissioner's league. The flow test bills and pays out the north beside SaK.
*Fund and options done (migration 95).* `league_rules.features` (`money`, `fund`; SaK both, a new league neither, the
commissioner switches them in League settings); a ledger line in a league without money is refused; `fund` is keyed by
league, `fund_prices` by league and date, `fund_status` reads the caller's league, a paid line feeds the fund only where
there is one; nhl-sync prices every league's fund. The site hides money and the fund where they're off.

**B7. SaK's history and names are written into the site.** `src/data/history.ts` (seasons, champions, team
ids 1 to 8, the rules text, $200 and 60/30/10) renders on League, Home, Standings, Money, Profile and the draft
list; `prizes.ts` hard-codes The Johnson, The Playoff Cup and The SAK Cup; 173 UI lines in 42 files name SaK,
Garry, St. Patrick coins, the Peter or the SAK Cup; `useBrand()` is used in 6 files and `brand.coin`,
`brand.booby`, `brand.trophy` are never read. The draft call room defaults to one Jitsi room name for every
league; `league_reports` ids (`draft-2026-27`) collide across leagues.
*Fix:* league history and rules text move to per-league rows (`league_seasons`, rules generated from
`league_rules`); brand gains `trophies`, `fund`, `penalty`, `short` and every screen reads it; the call room
and report ids include the league.
*Names partly done (October 2026).* The brand now carries `short`, `regular`, `playoff`, `fund` and `bank` (SaK's
defaults unchanged) and the screens GMs use every day read it: Money and its settings, Standings, Bets, the Book,
Home and its cards, Trades, chat, the box score, the player card and page, the profile and the keeper report (whose
predicted standings now show the league's season, not a fixed 2026-27). The draft call room carries the league id
for every league but SaK. Left: `src/data/history.ts` into the database (league memory), the League page, the
feature board, the Yahoo import and the SQL messages.
*History done (October 2026).* The site reads each league's past from the league memory tables (migration 89)
through `useHistory()`; no page imports `src/data/history.ts`. SaK's pages read word for word as before (checked
against a build of the old code), and a league with no past shows none.

**B8. Alerts and phones.** `push_subscriptions` is keyed by `endpoint`, so a phone in two leagues serves only
the last; push titles say "SAK Superleague"; `respond_trade` notifies every league's commissioner; push replay
(`push` with a notification id) is open to the public key.
*Fix:* key `(endpoint, team_id)`; title and link from the league's brand and host; commissioner of the trade's
league only; push sends behind the admin key or a signed trigger.
*Done (migration 100, October 2026).* `push_subscriptions` is keyed `(endpoint, team_id)`: one phone carries a row per
league, and within a league it belongs to one team (signing in as another team of the same league moves it). The
push function titles each alert with the league's name (SaK's reads "SAK Superleague" as before) and links to the
league's domain when it has one; the notifications trigger sends the admin key through `_edge_headers(true)` and the
function refuses a replay without it (a GM's test push still runs on their sign-in, for the team of the league
they're in). `respond_trade` already told only the trade's league's commissioner (migration 80). Left for the
switcher: turning alerts off in one league unsubscribes the browser for all of them.

## 5. High and medium findings (after the blockers)

| Area | Finding | Fix |
|---|---|---|
| Edge functions | nhl-sync answers every task to the public key, including the heavy ones (`projections`, `corrections&days=35`, `players`). | The cron jobs send the admin key; heavy tasks require it. *Done (migrations 97 and 98): `_edge_headers(true)` adds the key at run time, so no job's text or the repo holds it; nhl-sync refuses `players`, `projections` and `corrections` without it.* |
| Edge functions | `.single()` on `teams by user_id` (push test, Yahoo) breaks for a person in two leagues; `yahoo_accounts` is per team. | Resolve the team through `league_members` and the active league; Yahoo per account. *Done: the push test (earlier) and Yahoo (4 October 2026) ask `my_team()` as the caller, so the league they're in decides; a Yahoo sign-in made from the person's team in one league serves their others, and disconnecting forgets it everywhere.* |
| Edge functions | Reads that can pass 1,000 rows across leagues (gameday rosters, auto-lineup rosters) are cut short silently. | Distinct ids by RPC, or page per league. *Done (4 October 2026): nhl-sync reads both a thousand rows at a time in a fixed order (`every()`) until the last page.* |
| SQL | `create_league` copies league 1's rules, sets no sport, owner or membership, and makes no draft or fund row; any commissioner can call it. | A platform-owner `create_league` that builds the whole league (rules from a sport template, draft row, Garry row, commissioner membership, opening coins). *Done (migration 90): platform admins only, owner and sport recorded, rules from a template league, open GM seats with opening coins (seat 1 the commissioner's), and `platform_invite` for the first commissioner.* |
| SQL | `teams.id` has no sequence (`max(id) + 1` in `accept_invite`, `commish_add_spectator`); `commish_add_spectator` writes no league. | Identity column; the league written explicitly. *Done (migration 86).* |
| SQL | Book market inserts with no team (`commish_market`, `open_markets`) rely on the default league 1. | Write `league_id` explicitly. *Done: the scheduler's markets name it since B4; `commish_market` since migration 97.* |
| SQL | The stamp trigger runs on insert only; a trade moving a row to another team never re-stamps. | Cross-league moves are refused anyway once B1 lands; assert it. *Done (migration 97): rosters and draft picks refuse a move to another league's team.* |
| SQL | `commish_health` shows platform cron and function internals to any league's commissioner. | Platform owner only; commissioners see their league's jobs. *Done (migration 97): platform admins see everything; a league's commissioner sees the league's part, without the platform's job list or error text.* |
| SQL | SaK words in SQL messages ("St. Patrick coins", "SaK points tonight", Johnson, Peter, SaK Fund). | Read `leagues.brand`. *Done (migrations 84, 86 and 91): the Book's posts and props, bets, trades, the commissioner's coins and fund entries, payouts and the money settings read the brand; SaK's words unchanged.* |
| Front end | Hosted on GitHub Pages with one SaK manifest, icons, titles and service worker. | Cloudflare Pages (decided 3 October 2026), league by host, manifest and icons per league. |
| Cost | Garry runs per league with no daily budget (about $0.003 a reply, plus the daily, weekly and moments posts). | Per-league daily call budget on `garry_state.usage`, set by plan tier. *Done (migration 99): `garry_state.daily_budget_usd` ($1.00 a day when unset; SaK spends about $0.08), counted from the running-costs ledger; once spent, Garry uses his canned lines until tomorrow. A platform admin sets it with `set_garry_budget`; plan tiers will set it later.* |

## 6. The sport pulled out of the engine

What is hockey-specific today, and what replaces it. The NHL becomes `sports` row `nhl` and nothing about SaK
changes.

**Data and identity.** `players.id` is the NHL player id and `games.id` the NHL game id; `games.game_type`
comes from the NHL id's digits; `players.nhl_team`, `teams.fav_nhl` and the `nhl_teams` table name the league.
Add `sport` to `players`, `games`, `player_games`, `player_status` and a `clubs` table (`nhl_teams` becomes its
NHL rows); new sports get platform ids from a sequence with `(sport, ext_id)` unique, and NHL rows keep their
ids so nothing in SaK moves.

**The sport adapter (edge).** One adapter per sport fetches and normalizes into the shared tables:
`fetchSchedule`, `fetchGame -> {game, stat lines}`, `fetchRosters`, `fetchInjuries`, `fetchNews`,
`fetchProbables`, `fetchSeasonStats`, plus its time zone and day cutoff. `_shared/nhl.ts`, nhl-sync's NHL
endpoints, ESPN hockey, `projections.ts` (82 games, F/D/G priors), `playoffs.ts`, nhl-hub and player-info are
the NHL adapter today. nhl-sync becomes `sport-sync?sport=nhl` for the shared fetch and the league pass from B4.

**The sport definition (database).** A `sports` row carries what the engine now hard-codes:
positions and their labels; lineup slots with eligibility (`slot_ok`'s G and Util rules, IR and bench codes);
player groups (skater and goalie today, batter and pitcher, outfield and keeper); the stat vocabulary with
labels and groups; game states mapped to scheduled, live, final, postponed and cancelled; period labels
(P1, OT, SO; halves; innings); the season shape (regular season and playoffs, games per season); the
day boundary (America/New_York with the 6 am rollover for the NHL; a gameweek for soccer); and the lock rule
(each player at his own game's start). `league_rules.scoring` stops being `{skater, goalie}` and becomes a list
of `{group, stat, points}` read through the sport's vocabulary; `calc_fpts`, `slot_ok`, `_auto_lineup`,
`_apply_lineup`, `_autopick_player`, `recompute_player_values` and the Book's stat whitelist read the sport.

**The front end.** A `SportConfig` read from the sports row drives positions and colours, slot lists, stat
columns, game-state and period text, team names and logos, the day boundary (matching the server), the
"centre" page (`/nhl` becomes `/sport/nhl`; from 5 October 2026 every sport we run pools on gets one at
`/sport/<sport>`, fed by one `sport-hub` function with an adapter per sport, `docs/POOL-TYPES.md` §5), and the words
("puck drop", "goalie starts"). About 28 position
literals in 20 files, 42 game-state literals in 16 files and the NHL team tables in `format.ts` move onto it.

**Garry.** His persona says hockey ("beer-league dressing room", "hockey decisions only"); it reads the sport's
vocabulary and voice notes instead, and his prompt facts stop naming NHL games.

**The Book.** Markets already carry a stat key and a line, so they carry over; the templates, the house
futures (Stanley Cup, Art Ross, Rocket Richard) and the in-play rules (three periods, overtime, shootout) become
per sport.

## 7. The order of work

Each phase ends on a gate: what must be true before the next starts.

**Phase 0, done (this pass).** Live holes closed, cross-league guards, guardrail test, this review.

**Phase 1, a second hockey league in the same database.** B1 rosters key, B2 draft per league, B3 scoring
profiles, B4 the league pass, B6 money and Fund, the medium SQL items. Each lands with two-league flow
coverage: both leagues draft the same player, score the same game with different weights, run every cron job,
settle bets and the Book, post payouts, and neither sees or changes the other.
*Gate:* a shadow league (a copy of SaK's teams under test accounts) runs alongside SaK for a full week of real
games, and its standings, Book and Garry posts match what SaK's engine produces for its own rules. The tooling is
built (migrations 92 and 93: `open_shadow_league`, `shadow_sync` every minute, `shadow_report`).

**Phase 2, people can join.** B5 sign-in by email and league by host, invites and the switcher, realtime and
presence per league, B7 brand and history per league, B8 phones, Cloudflare Pages hosting, the platform `create_league`.
Garry's daily budget (done, migration 99).
*Gate:* a friend's league is created, invited, drafted and scored for two weeks without anyone touching SQL.
*Walked through on 4 October 2026 (migration 108):* a league opened on the Platform page, its commissioner invited and
seated, the order drawn, the draft run to the end with open seats picked for them, rosters slotted and the season
phase set, all through the functions the site calls. Three fixes came out of it: the order draw took every league's
teams (SaK's too since the shadow league), an open seat waited out the full clock each round (now 4 seconds, like
autodraft), and a new league opened in the keepers phase with nobody to keep (now ready to draft). A new league can
set its own roster slots before the draft (migration 116, `commish_set_roster`, the Commish page's Roster section; the
draft takes one round per spot after the keepers).

**Phase 3, the sport pulled out.** Section 6 with the NHL as the only sport: `sports` row, adapter interface,
`SportConfig`, scoring as a list, ids with `sport`. SaK must not notice.
*Gate:* every NHL literal in the guardrail lists is gone and the flow test runs unchanged.
*Started 4 October 2026 (migration 135):* the `sports` table, the NHL its one row (positions and groups, slots and whom
each accepts, the stat vocabulary, game states as the engine's five, periods, the season's shape, the day boundary, the
lock rule, the words); `leagues.sport` references it. The site carries the same row compiled in (`src/lib/sport.ts`,
`useSport()` from the store, which loads another sport's row), `supabase/tests/sport.test.mjs` fails if the two drift or
the slots stop agreeing with the lineup engine, and the flow test checks them against `slot_ok`. First readers moved:
the pickup advisor's positions and Roster vs available, then (the same day) `Pos` became a string and the position
chips and filters across the site read the sport (Players, the lineup planner, Trades, the trade block, the team scout,
Keepers). Then the game states and periods: every page that reads the league's own games asks the sport whether a game
is live, final, not started or called off (`isLive`, `isFinal`, `hasStarted`, `notStarted`, `calledOff`) and how to
write its period (`periodShort`, `extraTime`), the store included; the NHL centre pages read the NHL's own feed and stay
its adapter; the Book asks the sport whether a game is live or final, while its in-play prices (regulation minutes,
overtime) stay hockey's model until a second sport's Book is designed. Garry's voice reads the sport too (migration 144):
the sports row carries the words his prompts wrote in (the game's name, the rec-league adjective, the room, his one-line
character), so the NHL's prompts read exactly as before and another sport's league gets its own. The site's "puck drop" in its
explanations (the lineup lock, a past day, the Book's closing time, the standings' corrections note) reads the same word, and the
centre's name in the nav, its page title and Home's link read `words.centre` ("NHL centre"). Next: the draft simulator, which needs the sport's draft
rules in its row (depth targets per position, a cap per position, flex spots, the goalie timing it now hard-codes),
best designed beside a real second sport rather than guessed at.

**Phase 4, the second sport: soccer (reordered 4 October 2026, `docs/POOLS.md` section 7).** Soccer comes next, in two
steps. First prediction pools on soccer, which need only fixtures and results: a `soccer` sports row (positions GK, DEF,
MID, FWD; halves and extra time; a gameweek day boundary in the competition's time zone), the soccer adapter on
API-Football into provider-neutral tables (`competitions`, `clubs`, `fixtures` keyed by `(provider, ext_id)`; not rows in
`games`, whose NHL readers match on three-letter codes MLS shares with the NHL: TOR, MTL, VAN, SEA and more),
and gameweek, survivor and season questions on the prediction engine settled from results. Then soccer fantasy on the
weekly engine: gameweeks as the lineup period, squads with a captain and transfers, FPL-style scoring through the
sport's vocabulary, the Book's in-play model for two halves. Basketball moves after soccer, on the daily engine.
*Gate:* a soccer prediction pool settles a month of gameweeks from the feed with no hand edits, and SaK's numbers do
not move; then a soccer fantasy league and SaK run side by side through a month with no sport-specific code outside
the adapter and the sports row. *Step 1 is built (migrations 148-149, live, 4 October 2026): the sports row, the shared
tables, `soccer_ingest()` (the adapter's one write), `soccer-sync` (fixtures daily, live every two minutes while a match
is on), result questions a host adds by matchweek (`pool_add_fixtures`), settled by `run_league_jobs('pool-settle')`. It
waits on the `API_FOOTBALL_KEY` secret.*

**Prediction leagues (4 October 2026).** A league has a kind: `fantasy` (rosters, a draft, games) or `predict`
(questions only). A prediction league reuses teams as members' seats, the invites, the chat, the coin ledger, the brand
and the voice settings, and none of the sport machinery; the site shows it its own home, questions, leaders and chat.
The engine's tables (`pool_markets`, `pool_positions`, `pool_trades`, `pool_drops`) are league tables under the same
tenancy rules; question packs (`pool_packs`) are shared, like the sports rows.

## 8. The new-league checklist

Until onboarding is self-serve, a new league goes live only when every line is true. *Built (migration 106):*
`league_readiness(league)` checks lines 1 to 6 as far as data can (name, rules and scoring profile, the commissioner
signed in, the draft row, opening coins required; every seat filled and Garry's briefing advisory), the Platform page
and a new league's Commissioner page show it, and `platform_set_league_status(league, 'active')` refuses until the
required lines hold. Lines 7 and 8 stay by hand.

1. `leagues` row: slug, name, short name, sport, status `active`, owner, full brand (bot, coin, trophies,
   last-place prize, fund name, colours), domain if any.
2. `league_rules` row from the sport's template: season dates, phase, roster caps, scoring profile, keepers,
   draft settings, money (or money off), trade review hours.
3. Commissioner account with a `league_members` row as `commish`; every GM invited and accepted.
4. `draft_state` row, picks generated for this league only, draft room name unique.
5. `garry_state` row with a briefing; daily LLM budget set.
6. Opening coins granted to every GM; Book futures opened for the league.
7. A dry run of the league pass for this league (snapshots, auto-lineups, markets) with no errors.
8. `npm run test:db` green, including `tenancy.sql`, on the build that serves it.

## 9. Decisions for Patrick

1. **Sign-in.** *Decided:* email sign-in with "remember me" (3 October 2026); rollout in B5 above.
2. **The Fund.** *Decided:* money and the Fund are per-league features, off until a league turns them on (migration 95).
3. **The second sport.** Basketball first (cheapest, same engine) or soccer first (bigger audience, new weekly
   engine). Recommendation: basketball proves the split; soccer is the growth bet for 2027-28.
4. **Staging.** *Decided:* no staging project. SaK stays the live test bed; the release order, the flow test, the
   fingerprint checks and the shadow league carry the safety.

## 10. Where things live

- The rules: `supabase/tests/tenancy.sql` (with the reviewed lists), migration 76 (`_in_league`, the admin key).
- The proofs: the "tenancy guards" and "second league" sections of `supabase/tests/flow.sql`.
- The admin key: `private.app_keys` (name `admin`); read it with the service role or the SQL editor. It goes in
  the `x-admin-key` header for Garry's commissioner tasks; never in the site or the repo.
