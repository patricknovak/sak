# Super Pools: AI-enhanced fantasy leagues

Super Pools is the product built from the SaK Superleague site. The SaK league is league 1, the model
league, and keeps running on the same code and database while the product grows around it. This document is
the plan of record: what the product is, how leagues are separated, what is shared, and the order of work.

Domains: `superpoolsai.com` (primary) and `superpoolai.com` (redirects to the primary). The market, the
competition and the road to every sport are in `docs/MARKET.md`; the words and the look in `docs/BRAND.md`.

Hosting (decided by Patrick, 3 October 2026): **Cloudflare Pages** for both the league app and the landing page. It is
free for commercial use (Vercel's free tier is not, and Vercel Pro is $20 a month per member), the DNS for both domains
is already on Cloudflare, and wildcard subdomains (`<league>.superpoolsai.com`) route to one deployment, which is what
league-by-host needs. The move is in `docs/EXPANSION.md` (Phase 2, hosting); until it is done the app is on GitHub
Pages from `main` and the landing page on Vercel.

Landing page today (until it moves to Cloudflare Pages): Vercel project `superpools` (team
`patricknovak1-8908s-projects`, id `prj_SRNe8ClGioGw9vAAOwq3unQ9tbMh`), linked to this repo with root directory
`landing/`; every push to `main` redeploys it. `superpoolsai.com` serves the page; `www.superpoolsai.com`,
`superpoolai.com` and `www.superpoolai.com` are 308 redirects to it. DNS lives in Cloudflare (DNS only, no proxy):
apex `A 216.150.1.1`, `www` `CNAME cname.vercel-dns.com`, on both zones. Sign-in email sends from the same domain
through Resend (records on `send`, `rsend`, `resend._domainkey`, `_dmarc`).

## 1. What it is

A fantasy hockey league site with an AI commissioner's assistant built in. One league is one tenant. Each
league gets: live scoring from NHL box scores with per-player puck-drop locks; daily lineups set up to 60
days ahead with an auto-pilot; a draft room (clock, board, queues, TV mode, mock drafts, graded report
card); keepers; trades with grades and scouting numbers beside every player (form, outlook, categories, side by side); free-agent and trade finders; side bets and a coin sportsbook that settle
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

The expansion review (`docs/EXPANSION.md`, October 2026) is the detailed version of this list: the eight
blockers before a second league goes live, the phases and their gates, the sport split, and the new-league
checklist. Phase 1 is under way: B1 (one roster per league), B2 (the draft per league), B3 (each league's own scoring) and
B4 (the scheduler league by league) landed in migrations 81 to 85, B6 (money and the Fund per league, both optional features) in 86 and 95, B8 (phones and alerts per league) in 100, and the shadow league (Phase 1's gate) opened on 3 October 2026. `supabase/tests/tenancy.sql` enforces the tenancy rules on every test run.

1. **League by host.** `leagues.domain`: `sak.superpoolsai.com` or a custom domain per league; the app picks
   the league from the host, so one deployment serves all leagues. *Built (migration 107, October 2026):*
   `league_by_host(host)` maps `<web name>.superpoolsai.com` or a league's own domain to the league and its brand before
   sign-in; the site wears that brand on the sign-in page and names the league in `x-league` on every database request
   (honoured for members only); a GM on another league's address sees their own, with a notice; the platform sets a
   league's own domain on its Platform card (`platform_set_league_domain`). Live once the site is on Cloudflare Pages
   with the wildcard `*.superpoolsai.com`.
2. **Garry per league** (done in migration 65, bar the budget). One state row per league (voice notes, the
   commissioner's briefing, where the memory pass got to); the edge function scopes every read and write to
   one league, loops over the active leagues for the cron tasks and takes a reply's league from its message;
   names come from `leagues.brand`. The commissioner shapes the voice from the Commissioner page: a briefing
   read before every post, facts handed over by name, the file he built from the chat (anything can be struck)
   and his voice notes. The per-league daily budget of model calls is in too (`garry_budget`, migration 99; the platform
   sets it with `set_garry_budget`), and once it is spent he falls back to his canned lines.
3. **Scheduler per league.** nhl-sync's league-scoped tasks (snapshots, auto-lineups, standings,
   settlement) iterate leagues, setting `app.league_id` before each league's pass; the NHL fetches stay single.
4. **Money.** Coins stay. Cash tracking stays bookkeeping between friends (no payments handled), or is
   turned off per league.
5. **Onboarding.** A new league: sign up, name and brand it, invite GMs, import a Yahoo pool (the connector
   exists) or start fresh, set rules, draft. *Part 1 done (migration 106, October 2026):* the platform opens a league
   from the Platform page (`#/platform`: name, web name, wordmark, colour, seats), invites its commissioner, follows
   `league_readiness(league)` and puts it live with `platform_set_league_status`; the commissioner sees the same
   checklist and gives the league its identity (`commish_set_brand`: name, wordmark, tagline, colour, prizes, coins,
   the voice's name) on the Commish page, and the league's colour themes the whole site. *Asking for a league (migration
   112):* anyone can ask on the public Start your league page (`#/start`, `request_league`, rate-limited, stored in
   `ops.league_requests`); the Platform page's Requests inbox opens the league in one tap and writes the invite email.
   Still to come: self-serve sign-up and billing for a commissioner, the Yahoo import into a new league.
6. **Billing.** A subscription per league per season (Stripe). Landing page collects interest until then.

The steps above finish the tenancy. `docs/MARKET.md` sets what comes after in three horizons. The first,
"win hockey and lay the foundations", adds to this list in this order once tenancy is done:

7. **Tiers and billing.** Free, Plus, Premium, the side-bet add-on and the Super Pool bundle, enforced per
   pool (a `plan` on the league row and a feature gate function), Stripe for the paid tiers.
8. **Category and rotisserie scoring.** The scoring engine reads the league's categories the way it reads
    its point weights. *Rotisserie done (migration 117, October 2026):* `league_rules.categories` (null for a points league),
    `category_standings()` ranks every team in each category on its started players' season totals, the Standings page and
    Home show the category table, and the commissioner switches between points and rotisserie on the Commish page.
    *Head-to-head done (migration 118):* `league_rules.format` ('season', SaK's, or 'h2h'), a `matchups` schedule the
    commissioner makes (a round robin over the regular season's Monday-to-Sunday weeks, a bye for an odd count),
    `h2h_scores()` and `h2h_standings()` (wins, losses, ties, then points for), shown on Standings and Home with the week's
    matchups live; Garry's standings answers follow the format. *Head-to-head playoffs done (migration 120):* the
    commissioner picks the playoff spots (none, or the top 2 to 8) with the schedule, which keeps the season's last weeks
    for the bracket (one a round); `h2h_bracket()` works the bracket out on read from the table and those weeks' points
    (byes for the top seeds when the field isn't a power of two, a tie to the higher seed), shown on Standings and Home with
    a playoff line on the table and the champion on top. Next: head-to-head categories.
9. **Import with history** from Fantrax, ESPN and CBS (Yahoo exists).
10. **Contracts, caps, prospect slots and rookie drafts**; guillotine and best ball formats.
11. **The Supercoin.** An account-level wallet, the SaK coin ledger migrated onto it, per-pool allowances, the
    Book and side bets as the add-on, the ledger visible in every pool. Never for sale, never cashed out.
    Already in place on the league coin (migration 66): the Book's season edition (futures on the champion,
    last place, the playoffs and the full-year trophy, priced from the standings and re-priced daily; season
    props on every team and the biggest names, settled from the standings and season stats) and the coin
    races (net coins this week, this month, this season). The Book by request (migration 68): a GM builds a
    long market from a template (a game later in the week, a race between players on one stat over a window,
    a player's line, a race between clubs for the division, the conference, the Presidents' Trophy, the Cup or
    the playoffs, a club's season points), sees the odds, and opens it by taking the first ticket, so the board
    only carries bets somebody wants; `book_suggestions()` offers what's worth asking for, computed on the fly;
    settlement from the box scores and the standings, the Cup and ties by the commish; three open requests per
    GM, fifteen per league. Garry at the window (`garry?task=book`): a GM's private line at the Book that reads
    the board, how they bet and the Book's suggestions, and answers with picks that place in one tap or open
    the Ask sheet already built. In play (migration 70): odds are a function of state the site already keeps,
    computed on read (`book_live()`) and stamped on the ticket at placement, never stored per tick; tonight's
    markets stay open while the game is on (10% edge in play, no bets in the last two minutes, overtime or on a
    stale feed), futures and races re-price from the standings and the box scores, and every ticket keeps the
    price it was bought at. The NHL board (migration 71): the house opens, once a season, the Stanley Cup, the
    Presidents' Trophy, the division winners, the Art Ross, the Rocket Richard, most wins and the top defenceman
    (the top eight against the field), priced on read like everything else; requests take one club against the
    field and player races against the field, which is what Garry's chat builds from in words ("Oilers to win
    the Cup"). The kinds and subjects are a stat key and a line, so they carry to every sport.
12. **Commissioner tools the market lacks**: dues tracker (no escrow), co-commissioners, constitution page,
    audit trail of every override, abandoned-team handover. *Co-commissioners and the handover done (migration 109,
    October 2026):* `commish_set_cocommish(team, on)` shares the job with a seated GM (a league always keeps one), and
    `commish_vacate_seat(team)` takes a departed GM off their team, stops their phones' alerts for it and returns a
    fresh invite for the seat; the team keeps its roster, picks, coins and history. Both on the Commish page (Seats
    and commissioners).
    *The audit trail done (migration 110, October 2026):* every
    commissioner power passes `_commish()`, which now writes a line to `commish_log` (who, what, when; once per
    action) for the ones that change the league; every GM reads their league's log on the League page (Commish log). *The constitution page done (migration 111):* the
    League page's Rules tab shows the rules that are settings straight from the settings, then the league's own rules,
    which its commissioner writes and edits there (`commish_set_rules`, on the log; a new league starts from a few
    suggested ones). The dues tracker is the money ledger a money league already has (`commish_bill_entries` bills each
    GM's entry, the commissioner marks lines paid, `money_balances` shows who owes what), with no escrow.
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
| Database | one Supabase project (`quakdkzdafzlhgjvmypg`), SaK is league 1 | same project; no staging (decided 3 October 2026: SaK is the live test bed, with the shadow league, the flow test on every pull request and fingerprint checks) |
| App | GitHub Pages from `main` | Cloudflare Pages, one deployment, league chosen by host (`<league>.superpoolsai.com`) |
| Landing | Vercel project `superpools` from `landing/` | Cloudflare Pages at `superpoolsai.com`, grows into sign-up |
| Edge functions | Supabase, deployed from CI on merge to `main` | same |
| Auth email | Resend SMTP from `no-reply@superpoolsai.com` | same |
| LLM | Grok (xAI) for Garry and X search | same, per-league budget; model per league later |

## 9. Working agreement

- The SaK league is the model and the test and development platform: build features there first, on the
  league that uses them every night. Unless Patrick says otherwise for a feature, anything built for SaK is a
  Super Pools feature (or a per-league customization) for every league: it reads its league's rules, brand and
  data by `league_id` and never assumes SaK's names or numbers.
- Every league-scoped change from now on writes `league_id` explicitly (or relies on the default = 1 only
  where the caller can only be in SaK).
- Nothing in `docs/` or the app names SaK as the product; the product is Super Pools, SaK is a league on it.
