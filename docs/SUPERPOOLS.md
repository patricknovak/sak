# Super Pools: fantasy leagues and prediction pools for any group

Super Pools is the product built from the SaK Superleague site. The SaK league is league 1, the model
league, and keeps running on the same code and database while the product grows around it. This document is
the plan of record: what the product is, how leagues are separated, what is shared, and the order of work.

Domains: `superpoolsai.com` (primary) and `superpoolai.com` (redirects to the primary). The market, the
competition and the road to every sport are in `docs/MARKET.md`; the words and the look in `docs/BRAND.md`.

**Direction (Patrick, 4 October 2026):** Super Pools becomes the Polymarket of pools: the interface of a prediction
market (a price that reads as a probability, a chart that moves, comments, share cards) for private pools of any kind,
sports first, in Supercoins with no money in or out, built for the long life of a group. Two doors on one engine:
fantasy pools (hockey today, soccer next) and prediction pools for anything a group watches, tested first with a
Love Is Blind pool aimed at women for Season 11 (premiere 14 October 2026). The research and the plan are in
`docs/POOLS.md`.

Hosting (decided by Patrick, 3 October 2026): **Cloudflare** (Workers serving static assets, the successor to Pages) for both the league app and the landing page. It is
free for commercial use (Vercel's free tier is not, and Vercel Pro is $20 a month per member), the DNS for both domains
is already on Cloudflare, and wildcard subdomains (`<league>.superpoolsai.com`) route to one deployment, which is what
league-by-host needs. The move is in `docs/EXPANSION.md` (Phase 2, hosting). Since 4 October 2026 SaK is live at `sak.superpoolsai.com`
on Cloudflare beside GitHub Pages, and the landing page is on Cloudflare at `superpoolsai.com` and `www` (the
`superpools-landing` Worker; Patrick turned the proxy on for both records the same day). Every other
`<league>.superpoolsai.com` reaches the app through a wildcard zone route and a proxied `AAAA * 100::` record: Pod Squad is
`podsquad.superpoolsai.com`, and a pool's address speaks the pool's words (`league_by_host` returns its kind, migration
150). Left on Vercel: only the `superpoolai.com` spelling, a 308 redirect to `superpoolsai.com`.

One account, every pool (decided 4 October 2026, migration 151): the product's home is **one app at
`app.superpoolsai.com`**, so one sign-in, one installed app and one alerts permission cover every pool a person is in,
however many there are. A pool's link carries its web name in the path (`app.superpoolsai.com/#/p/podsquad`, and deeper:
`#/p/podsquad/questions`); invites are `app.superpoolsai.com/#/join/<code>`. A `<web name>.superpoolsai.com` address
still works as a free vanity link: it forwards to the one app unless someone is already signed in on it (SaK's GMs keep
`sak.superpoolsai.com`), so nobody collects a sign-in per pool and a new pool needs no DNS, certificate or deploy, only
its row. A league's own domain (Cloudflare for SaaS) can come later on the same rule. **My pools** (`#/pools`) is the
account's home: every pool with its crest and colour, where the person stands (rank of how many, points and the gap, or
coin worth), and what needs them (on the clock, a live draft, trade offers, questions closing with no position, a coin
drop, unread chat and alerts), each a tap into the right page of that pool (`my_pools()`, one call that reads each pool
as itself). From there anyone in a pool starts another prediction pool in a few taps, blank or from a pack
(`pool_start`: a web name made from the name, the starter as host with 1000 coins, five a day and 25 in all per
account); a fantasy league still starts from `#/start`.

Landing page before the move (kept for the record): Vercel project `superpools` (team
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
(today that is nobody; accounts replaced the fallback for anyone with a membership). `team_directory` is the
public list of team names and colours for the caller's league (migration 104 dropped emails; migration 240 made
it `security_invoker` with a narrow anon grant on `teams`), used today as the site's health check.

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

**First, from 4 October 2026 (`docs/POOLS.md`):**

- **P1. Prediction pools, the engine.** Questions with two to twelve answers priced by a market maker (LMSR), bought and
  sold in Supercoins until they close, resolved by the host with a locked rule and a reason on the record; coin drops on a
  schedule with late joiners caught up; a per-question cap; a leaderboard by net worth with the hit rate; price history
  for the chart. Works in any league (a Markets tab in a fantasy league) and as a league of its own (`leagues.kind =
  'predict'`). *Built: migrations 145-147 (live), the pages in PR #204.*
- **P2. The Love Is Blind pool.** A prediction league with its own brand and no sports on screen: home, questions,
  leaders, chat; the Season 11 question pack and drop schedule (14, 21, 28 October, 4 November, the reunion); invites by
  link; share cards. Opens before 14 October for the test; the gate is in `docs/POOLS.md` section 6. *Opened 4 October:
  league 3, Pod Squad (`podsquad`), Patrick hosting; active since the pool pages reached `main` (#204). Since migration 153
  anyone can open one without an account first: `app.superpoolsai.com/#/new?pack=love-is-blind-s11` (the landing pages'
  Love Is Blind buttons) takes a pool name, a colour, the pack and the host's email and password, and lands on the Host
  page with the invite link; limits of three a day per address and sixty a day across the platform. Share cards: a member
  posts a picture of their call, a call that came in, or the standings to the group chat, drawn on the phone in the pool's
  colours (`src/lib/shareCard.ts`; nothing is stored or sent until they share it). The host asks from a starting shape (yes or no, who, how many) or the same question once for each name on a list (every couple) in one go, closing at the next coin drop in a tap (`src/components/AskSheet.tsx`); a new player sees how it works on the pool's home (prices are chances, a right answer pays one coin a share, sell back before it closes, the crown) until they put it away.*
- **P3. Soccer prediction pools.** Fixtures and results from API-Football (provider-neutral tables), gameweek and
  survivor questions settled from results, Premier League and MLS first. *Step 1 built (migrations 148-149, live): the
  `soccer` sports row, shared `competitions`, `clubs` and `fixtures`, the `soccer-sync` adapter on API-Football, a
  matchweek's result questions added by the host in one tap and settled from the full-time score. *Live on free data
  since 6 October 2026 (migration 168): with no API-Football key set, every soccer competition reads ESPN's public
  scoreboard for testing (provider `espn`); the Premier League's 380 matches and MLS's 511 are in, rounds cut from the
  schedule. A licensed feed replaces it before anyone pays.* Season questions built (migration 156): the Premier League 2026-27 and MLS Cup 2026
  packs, host-settled and needing no match data, startable from `#/new` today. The survivor built (migration 157, live): "Last one standing" (`#/survivor`), the host
  starts one on a competition; each matchweek every player still in picks one club to win, a club once a season; a
  draw, a loss or no pick is out, a called-off match lets you through and gives the club back; settled by a trigger on
  `fixtures` as each result comes in, with alerts and the winner posted to the pool. Runs on live fixtures once the
  feed is on. Call the score built (migration 158, live): a coin-free score predictor (`#/predictor`), the host starts it
  on a competition; every player calls every match, each call open until kick-off; the exact score 3 points, the right
  result 1, one banker a matchweek doubled; points land at the final whistle through a trigger on `fixtures`, the pool
  hears each matchweek's winner, and a reminder goes out a few hours before a matchweek's first kick-off to anyone with
  matches to call or no survivor pick.*
- **P4. Soccer fantasy.** The weekly engine with FPL-style scoring, for the second half of 2026-27 or for 2027-28.
- **P5. The calendar of pools.** Question packs for The Bachelor, The Traitors, award nights, March Madness and the NHL
  playoffs; creator-hosted public pools. *Started (migration 159, live): the World Series 2026 pack (the pennants, the series, the
  MVP; from the eight clubs left in the division series) and the NHL 2026-27 pack (the Cup, the Presidents' Trophy, the
  scoring races); the start pages (`#/new`, My pools) read like a calendar, `pool_pack_list()` listing only packs with a
  question still to call, soonest deadline first, with when the first call closes; a pool started late takes only the
  questions still open. Next: packs for what airs in the winter (The Traitors, The Bachelor, the award nights).*

**Then, from 5 October 2026 (`docs/POOL-TYPES.md`, Patrick: a sports pool should ask what kind of pool you want and
give the pool a home for following the sport):**

- **P6. The pool-games engine.** `pool_games` (a game inside a pool: its kind, its event, its rules) and `pool_picks`
  (one pick per member per thing to pick, hidden until it locks, points from a grader), graders as triggers on results,
  scoring presets with every knob in words, frozen at the first lock; `series` and `fixture_periods` beside
  `competitions`, `clubs` and `fixtures`. Kinds in order: series pick'em with the length, confidence by team, squares,
  then weekly pick'em and confidence, the bracket with a second chance, the player pool (draft and box). The survivor
  and Call the score moved onto it on 9 October 2026 (migrations 203 and 204; the old tables wait to be dropped). A host settles anything the feed doesn't cover.
  *Built (migration 165, live 5 October 2026): `series`, `fixture_periods`, `sport_ingest` (any adapter's one write),
  `pool_games` and `pool_picks`; Pick the series (winner and length, Classic 1-2-4-8 with 1-1-2-3, Flat, or MLB.com's both
  or nothing; a pick locks at its Game 1's first pitch; the tiebreaker is the final game's runs) and Rank the teams (the
  clubs of the starting round N down to 1, each win from the lock paying its rank); points, max possible and the table
  worked out on read, so a corrected result corrects everything; the pool hears each series' result and who called it,
  each picker hears their own, and a reminder goes out six hours before a lock. `mlb-sync` (MLB's public Stats API, for
  testing; Patrick, 5 October: free feeds while we test, paid ones after) fills the MLB Postseason 2026 every two minutes
  during games (migration 166).*
- **P7. The three-step start.** What are you following (the events open now, with their stage), what kind of pool
  (cards for the kinds that fit the event today, with how long each takes and when it locks), how it scores (a preset,
  the knobs, a live example, the late-joiner, tie and tiebreaker rules). A pool can run more than one game; one is its
  crown. *Built (5 and 6 October 2026, `#/new` and My pools): the events open now with their stage, the kinds that fit
  each with when it locks, a preset per kind with its knobs in words and a live example; the crown is the main game
  (migration 169). Still to come: the late-joiner, tie and tiebreaker rules written on the pool's Rules page before the
  first lock.*
- **P8. Sport centres.** `/sport/<sport>` from NHL centre's pattern: today's games with the series state, the line
  score, the bracket or the table, schedule, injuries, leaders, odds, and the pool's ribbon on every game; one
  `sport-hub` function with an adapter per sport. MLB first (October), then the NFL, soccer and the NBA.
  *MLB centre built (6 October 2026, `#/sport/mlb`, `src/pages/SportCentre.tsx`): the scoreboard day by day with the
  line score by inning, R/H/E, the inning and outs live, probable pitchers and the series status, and the bracket from the
  round in play; the pool's picks and split on every series. It reads the shared tables mlb-sync fills, every minute
  while a game is on, so it needed no new function.*
- **P9. The World Series test.** By 10 October: series pick'em and rank the teams for the LCS and the World Series,
  through the new start; by 22 October: World Series squares and MLB centre's first version. Patrick's first World
  Series pool (league 4) was archived on 5 October so his new one starts from the beginning. MLB's data is a decision
  (`docs/POOL-TYPES.md` §8): host-settled for the test is the recommendation.
  *Where it stands on 8 October:* the engine, the feed (mlb-sync, every two minutes during games), squares and MLB centre
  are live, and the LCS rows are in (NLCS Brewers v Dodgers from 11 October, ALCS Rays v the Guardians-White Sox winner
  from 12 October). Patrick's World Series pool (league 5) runs the question pack only: Pick the series and Rank the
  teams go on from its Host page before the NLCS's first pitch, squares before the World Series.
  *Squares built 6 October (migration 167):* a grid on any series still to start (by default the World Series), 10×10
  or 5×5, a price per square in coins, paid after the 3rd, the 6th and the final of every game (or the final only),
  digits drawn from a recorded seed when the grid fills or at Game 1's first pitch, once or fresh each game. The pot is
  split over the games the series can run to; the last final takes what is left; an empty square passes its coins to
  the next claimed one. Paid by `sport_ingest` as the feed lands (`pool_square_pays`), the hourly pool job as a backstop.
- **P10. The pool scoreboard (every kind, one table).** *Built 8 October 2026 (migration 169):* `_pool_rows()` reads every
  game a pool runs (the questions' net worth, Pick the series, Rank the teams, squares, last one standing, Call the score)
  into one shape: a score, the most still possible, still in or out, a tiebreak and a line of detail per member per
  game. `pool_scoreboard()` ranks each game, puts the pool's main game first (`league_rules.crown`, named by the host
  with `pool_set_crown`, else the first open game) and gives each member's movement since the day began. The hourly
  pool job keeps `pool_standing` and tells a member who climbs into first or three places or more (once a game a day).
  A new kind of game adds one branch to `_pool_rows()` and gets the table, the arrows, the alerts and the crown with it
  (`docs/POOL-TYPES.md` §3).
- **P11. The pool infrastructure, in order** (the 8 October 2026 review; the detail is `docs/DEVELOPMENT.md` §6):
  weekly pick'em on the engine (any competition with fixtures, confidence points optional); the NFL on ESPN; the
  host's desk for every game (settle what the feed missed, a pick for a member, rules until the first lock); last one
  standing and Call the score onto the engine; the pick split in the prediction log; what you need to win; then the
  bracket and the player pool for the spring. *The box pool built 8 October 2026 (migration 188): one player from each
  box of evenly matched NHL players, goals, assists and goalie wins counting live, on the regular season from any night;
  the playoffs' version is ready for April (migration 202, 9 October 2026). With its chance to win, goal alerts, points still to come and a morning line in
  the chat (migrations 189 to 196). The Stanley Cup playoffs' feed is ready for April (migration 191).* *Weekly pick'em built 8 October 2026 (migration 170): every match of a
  round, the winner or a draw, each pick locking at its own kick-off; Classic (a point a right pick) or Confidence (each
  round's picks numbered, a right one earns its number); on any competition whose matches come in rounds, so the
  Premier League and MLS have it now and the NFL the day its feed lands.* *The NFL on ESPN built 8 October 2026 (migration
  171): its 2026 season, every week through the Super Bowl, fed by soccer-sync, so a pool can run an NFL pick'em from Week 5.*
  *The bracket, 8 October 2026 (migration 185): every series winner to the final, picked before the first game, on any
  event played in series whose rounds halve to a final (the NHL playoffs, the MLB postseason from the LCS, the NFL's
  playoffs from the Divisional round, migration 187).*
  *The market's view, 8 October 2026 (migration 178): each match keeps what the bookmakers expected at kick-off (as
  chances, never a price to bet), shown in the centres and set beside the crowd on Calibration.*
  *Results by hand for every game on fixtures, 8 October 2026 (migration 177): last one standing and Call the score run
  with no feed at all, settled per pool from the host's result (a score where the game needs one).*
  *Chance to win, 8 October 2026 (migration 175): a pick'em's Table shows each member's chance of finishing first,
  from a thousand run-throughs of the matches left, logged daily and scored at the end.*
  *NFL centre and Match centre, 8 October 2026: a centre for every competition played in rounds (`#/centre/<id>`), the
  round's matches live with your pick and the pool's split, and the table from the results.*
  *The crowd in the prediction log, 8 October 2026 (migration 174): every pick'em match's split is a forecast, scored at
  the final whistle; Calibration shows, sport by sport, how often a pool's favourite is right for how many agreed.*
  *Last one standing on the NFL, 8 October 2026 (migration 173): any competition played in rounds, in its own words,
  to a last round where those still in share it; offered beside pick'em on the start page and the host's page.*
  *The host's desk built 8 October 2026 (migration 172): the rules until the first lock, a pick entered for a member who
  asked, and a pick'em match settled by hand for the pool alone with the reason shown, all on the commissioner's log.*
  *9 October 2026 (migrations 200 to 212, PR #244):* squares by the quarter for football; March Madness on ESPN's feed;
  the box pool's playoffs version; last one standing and Call the score moved onto `pool_games` (the contraction, old
  tables kept until dropped with Patrick's yes); series picks and prop calls in the prediction log; a postseason game set
  by hand from the Platform page when the feed stalls; standings by division and conference and box scores in NFL
  centre; the prop sheet (eight auto-settled calls on one playoff game, for the LCS and the World Series); the
  second-chance bracket; and the Eliminator (last one standing on March Madness and the NFL's playoffs).*
  *Later the same day (migrations 213 to 219):* fixes from two independent reviews; hockey's score by period from the NHL,
  so Stanley Cup grids pay by the period and sheets run on it; prop sheets and squares on any NFL game of the week, not
  only the playoffs; prop sheets that score live as the game decides each call, with a chance to win once locked; and
  NFL centre linking each game's sheet and grid.*
  *Then (migrations 219 to 228):* the NBA playoffs on ESPN's feed (fifteen series in bracket order, seeds from the
  standings), with squares by the quarter and prop sheets in basketball's words; prop sheets on every game of an event by
  themselves (a host's switch, or ticked when a pool starts) and every sheet added up on the scoreboard; the bracket with
  series length (a bonus for calling the games); the Platform page's view of every pool's games; and fixes from two more
  independent reviews.*
  *And (migrations 229 to 238):* share cards for every kind of pick; a nudge for a host whose pool follows an event with
  no game on it; the daily streak (one winner a day from any event's games, the longest run of right picks wins, its
  splits in the prediction log); the sweepstake (an event's clubs dealt from the hat, whoever holds the champion wins);
  and fixes from three more independent reviews.*

Then the list below, which is the fantasy-league plan of record.

The expansion review (`docs/EXPANSION.md`, October 2026) is the detailed version of this list: the eight
blockers before a second league goes live, the phases and their gates, the sport split, and the new-league
checklist. Phase 1 is under way: B1 (one roster per league), B2 (the draft per league), B3 (each league's own scoring) and
B4 (the scheduler league by league) landed in migrations 81 to 85, B6 (money and the Fund per league, both optional features) in 86 and 95, B8 (phones and alerts per league) in 100, and the shadow league (Phase 1's gate) opened on 3 October 2026. `supabase/tests/tenancy.sql` enforces the tenancy rules on every test run.

1. **League by host.** `leagues.domain`: `sak.superpoolsai.com` or a custom domain per league; the app picks
   the league from the host, so one deployment serves all leagues. *Built (migration 107, October 2026):*
   `league_by_host(host)` maps `<web name>.superpoolsai.com` or a league's own domain to the league and its brand before
   sign-in; the site wears that brand on the sign-in page and names the league in `x-league` on every database request
   (honoured for members only); a GM on another league's address sees their own, with a notice; the platform sets a
   league's own domain on its Platform card (`platform_set_league_domain`). Live on Cloudflare with the wildcard
   `*.superpoolsai.com` (4 October 2026). *Since migration 151* the pool's link is the path on the one app
   (`app.superpoolsai.com/#/p/<web name>`) and a subdomain forwards there for anyone not signed in on it; My pools
   (`my_pools()`) lists an account's pools with where it stands and what needs it, and starts new ones (`pool_start`). *Invitations to a person (migration 163):* a pool's member invites the people they already play with in their other pools, or anyone by email; the invitation waits on that account's My pools (`my_invites`, join or not now) with an alert in each of their pools, and an email with no account looks the same as one with. Each league's menu shows only what it runs: Questions once a fantasy league has asked one (its commissioner starts from the Commissioner page), Call the score and Last one standing only in a pool that has started one.
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
   A new league takes the season's calendar from its template (first and last days, trade deadline, end of the playoffs;
   migration 122), and a head-to-head league's checklist and setup guide want its schedule before it goes live.
   A league that played on Yahoo brings its past in one go (4 October 2026): the commissioner picks the Yahoo league on the League page and every season Yahoo kept (its renew chain, `yahoo?task=history`) comes back with its final table, written in through `commish_set_season`. Still to come: self-serve sign-up and billing for a commissioner, the Yahoo rosters and settings into a new league.
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
    a playoff line on the table and the champion on top. *Head-to-head categories done (migration 121):* a head-to-head
    league that picks categories plays each week for them: the two teams' started players are totalled in each category
    (`_h2h_result`), whoever wins more categories wins the week (and the playoff meeting), categories won break ties on
    the table, and each matchup opens category by category. Payouts follow the format (migration 124): the regular-season
    pot pays the head-to-head or category table, a bracket pays its champion, runner-up and best semifinal loser, and the
    last-place punishment stays a points-league rule. Every morning (`h2h-notes`, migration 125) each GM of a head-to-head
    league hears the week's opponent when a week starts and the result when it ends, the playoffs round by round.
    A category league drafts on its categories (migration 129): `category_values()` values every player on the league's
    categories (last season's pace over his projected games, a z-score against the draftable pool of skaters or goalies),
    the Players page, draft room and mock draft rank by it in the projection view, and the robot's autopick uses it. The pickup advisor plays a category league's moves out on its categories (`src/lib/catpickup.ts`): each stat per game, on one scale across the pool, weighted to where the team trails in the table, with what the move does to each category. Every page reads the format (4 October 2026): in a category league the Performance page ranks
    any stretch rotisserie style and the scoreboard shows each team's categories night by night; a head-to-head points
    matchup shows its live win chance and projected final (logged and scored in the prediction log, migration 137), and
    the table shows each team's max points for (`lineup_efficiency`, migration 133). The trade evaluator weighs a category
    league's trades on its categories, put on a points scale so the grades read the same (`pointsScale`). Next: the
    each-category variant (every category a win or a loss on the table) if a league asks for it.
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
    the multi-sport pool. *Started (migration 135, 4 October 2026):* the `sports` table with the NHL's row and the
    site's `useSport()`; code moves onto it one place at a time (`docs/EXPANSION.md`, Phase 3).
14. **Telemetry and the feature board**: pseudonymous per-pool usage tables with a commissioner opt-out, the
    SaK Features page grown into a product-wide board with public statuses and a changelog. *The changelog done (4 October
    2026):* the Features page's What's new tab, a dated timeline from `src/data/changelog.ts` (an entry in the same pull
    request as the change), with a dot on the tab until a phone has seen the newest. The board's first idea shipped the same day: the watch list (a GM's
    request, migrations 140 to 142): stars on the Players page and player cards, a Home card with free agents first, alerts
    when a watched player is dropped in season or hurt, and Garry knows the list on the GM's private line. *Analytics
    foundation (migration 240, 10 October 2026):* consented GA4 on the landing and the app (Consent Mode v2, measurement ID
    from `VITE_GA4_ID` / a landing constant, empty means nothing loads), funnel events (`pool_start`, `invite_share`, `join`,
    `first_call`, `sign_up`) with no PII, a landing `sitemap.xml`, first-touch UTM/referrer on `waitlist` and
    `private.pool_signups`, `accounts.is_test` (admin-only to change, backfilled from the test email filter), and
    `mission_control_counts` (anon + passcode hash in `mission_control.counts_passcode`, never committed) returning
    real-user, pool, member, action and weekly-active-pool-player counts for Mission Control. Per-pool usage tables and the
    privacy note are still to come.
15. **App-store listing** and the **playoff bracket pool** (the bracket is now a kind in P6, `docs/POOL-TYPES.md`). (The voice per league with a daily budget is done: item 2,
    migration 99.)

Then horizon 2 (soccer on licensed data, basketball, the multi-sport pool, the Supercoin prediction market,
the Super Pool bundle, the public API) and horizon 3 (cricket free-to-play, baseball, football and college,
pools for golf and F1, Supercoin competitions and non-cash prizes), as `docs/MARKET.md` lays out.

## 8. Environments

| | Today | Product |
|---|---|---|
| Database | one Supabase project (`quakdkzdafzlhgjvmypg`), SaK is league 1 | same project; no staging (decided 3 October 2026: SaK is the live test bed, with the shadow league, the flow test on every pull request and fingerprint checks) |
| App | GitHub Pages from `main`, and Cloudflare (`sak.superpoolsai.com`, every `<league>.superpoolsai.com`) | Cloudflare only, one deployment, league chosen by host |
| Landing | Cloudflare Worker `superpools-landing` at `superpoolsai.com` and `www` (since 4 October 2026) | same, grows into sign-up |
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
