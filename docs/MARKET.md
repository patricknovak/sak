# Super Pools: the market, the competition, and the road to every sport

Written 1 October 2026 from four research passes over the platforms' own pages, app-store listings, press
releases, FSGA and Leger surveys, data-vendor pricing and terms, and 2025-26 trade press. Reddit was not
reachable from the research environment, so commissioner quotes come from app-store reviews, Trustpilot and
forums. Every figure that matters carries its source. This document sets the position; `docs/SUPERPOOLS.md`
holds the ordered work and `docs/BRAND.md` the words and the look. Since 4 October 2026 the product is wider than
fantasy leagues: prediction pools for any group, about anything, with the research in `docs/POOLS.md`; this document
stays the fantasy-league market and the road to every sport, and soccer moves up to the next sport now (`docs/POOLS.md`
section 7).

## 1. The short version

- Fantasy is big and flat; betting is where the growth went. 57 million people in the US and Canada played
  fantasy in 2025, roughly the same as 2022; the 90 million "fantasy or betting" headline grows because of
  betting and crossover. Football is three quarters of the activity. Hockey is about a fifth of fantasy
  players, roughly ten million people, with Canada's three million hockey-pool players barely moving in a
  decade because nobody has built them anything new.
- The big free platforms (ESPN 48% of app users, Sleeper about a third, Yahoo under a fifth) are
  football products with hockey bolted on, or in Sleeper's case no hockey at all after four years of
  requests. Their AI is football-only. Their keeper rules are a round swap. Their money handling is a text
  field. Their reliability on the biggest nights is a recurring complaint.
- The hockey power-user incumbent is Fantrax: free for hockey, the deepest rule engine on the market, loved
  by fourteen-year commissioners, and shipped as a slow wrapped web app with pop-up ads, no API and no AI.
- Nobody combines hockey-grade rules, a phone-first app, a league voice, side bets, dues and league history.
  That is the opening, and the SaK site already has most of it.
- Real money is the trap. Every pick'em and DFS operator spent 2025-26 fighting state attorneys general
  and surrendering licences; Ontario classes paid DFS as betting. Season-long leagues among friends with no
  rake are unregulated everywhere that matters. Super Pools stays there.
- The way to "every sport" is one sport at a time: hockey first and fully, then soccer (the one sport the
  whole world plays) and basketball (the same engine as hockey), then cricket (free-to-play, the door to
  India, the UK and Australia) and baseball, then football once revenue carries its data. Free to start,
  paid by feature and per pool, with one fun currency (the Supercoin) across every pool and a multi-sport
  pool that drafts across sports. The portal is not a feature list; it is the same ten friends, one home,
  every season of the year, one crown.

## 2. The market

| Measure | Figure | Source |
|---|---|---|
| Fantasy players, US and Canada, 2025 | 57M (53M US, 4.2M Canada) | FSGA July 2025 |
| Fantasy or betting, US and Canada, 2026 | 90.3M; 31% of US adults | [FSGA July 2026](https://members.thefsga.org/news/Details/new-fsga-research-details-growing-role-of-ai-prediction-markets-in-fantasy-sports-and-sports-betting-341850) |
| Fantasy-only trend | 62.5M (2022) to 57M (2025): flat to down | FSGA via [Wikipedia](https://en.wikipedia.org/wiki/Fantasy_sport) |
| Share by sport (last public split, 2019) | football 78%, baseball 39%, basketball 19%, hockey 18%, soccer 14% | [FSGA](https://en.wikipedia.org/wiki/Fantasy_Sports_%26_Gaming_Association) |
| Hockey players, derived | about 10M in North America | 18% of 57M |
| Canada hockey pools | 7% of adults intend to play (about 2.8M); 14% of 18-34s | [Leger, Oct 2023](https://leger360.com/wp-content/uploads/2024/04/Sports-Omni-Report-Nov.-6.pdf) |
| Fantasy Premier League | 13.1M managers in 2025-26 | [Wikipedia](https://en.wikipedia.org/wiki/Fantasy_Premier_League) |
| Player profile | 74% male, average age 42 | FSGA Feb 2025 |
| League money | average entry $55 per GM, $565 per league; $50 is the modal buy-in | [LeagueSafe 2023-24](https://www.onfocus.news/league-safe-publishes-fantasy-football-findings-vermont-tops-list-with-highest-entry-fee/) |
| AI use | 25% of players use AI tools, mostly "in a supporting role"; 85% want AI content labelled | FSGA July 2026 |

What the numbers say. The audience for a season-long league product is not growing by itself; it is won
league by league from incumbents. Commissioners choose the platform and their leagues follow, so the sale
is to about one person in ten. The money in a league is real but modest, which anchors what a platform can
charge: Fantrax, CBS, MFL and RotoWire all sit between $100 and $180 per league per season, about two percent
of a typical pot and ten dollars a GM. Hockey is the one major sport where the incumbents are weakest and
where a national audience (Canada) has been left on Yahoo, Facebook and officepools.com for a decade.

## 3. The competition

### The big free platforms

| | ESPN | Sleeper | Yahoo | CBS |
|---|---|---|---|---|
| Hockey | yes; per-game locks, up to 6 IR slots | **none**; requests since 2022 unanswered | best of the four: daily lineups, IR+, five scoring types | yes, paid tier; 2026-27 sign-ups closed |
| Keeper and dynasty | round swap; custom rounds in snake only | taxi squads, rookie drafts, pick trading; no contracts | round swap; no contracts | "1000+ options", keeper and dynasty |
| AI | IBM watsonx insights and Auto Control, football only | none for season-long | Draft Scout, Assistant GM, Game Breakdowns, paid, football-led | none |
| Money | none | SleeperSafe dues and payouts, 0% by bank (Aug 2026) | a dues field | none |
| Recaps and voice | none | waiver summaries to chat | weekly recap to chat, football, since 2025 | recaps, power rankings |
| Price | free with ads | free, no ads, funded by DFS picks and Kalshi markets | free with ads; Plus $59.99 and Ultra $79.99 per user per year | $149.99 per hockey league |
| Reliability | app outage on 2025 opening night and week one Sunday | full outage on 2025 opening night | redesigns that move features, scoring delays | "outdated, inconsistent, full of errors" |
| Scale | 48% of US fantasy-app users, 14M+ football | 10-13M players, about a third of app users | under a fifth of app users | smaller |

Sources: [ESPN support](https://support.espn.com/hc/en-us/articles/360000070552-Keeper-Leagues), [IBM](https://newsroom.ibm.com/2025-09-24-new-ibm-watsonx-ai-powered-insights-help-elevate-espn-fantasy-football-for-2025-fantasy-football-season), [Sleeper no hockey](https://sleeper.com/message/253000000000000000/1132800820094984192/1132802343709507584), [SleeperSafe](https://support.sleeper.com/en/articles/15364522-sleepersafe-rules), [Yahoo hockey rules](https://help.yahoo.com/kb/SLN6815.html), [Yahoo recaps](https://sports.yahoo.com/fantasy/article/relive-all-the-fantasy-action-with-weekly-league-recaps-125545592.html), [Yahoo Ultra](https://sports.yahoo.com/fantasy/article/fantasy-ultra-has-arrived--heres-everything-you-need-to-know-125559999.html), [CBS](https://www.cbssports.com/fantasy/hockey/games/chart), [Sensor Tower](https://sensortower.com/blog/2025-nfl-season-betting-fantasy), [outages](https://profootballnetwork.com/fantasy-football/espn-fantasy-football-app-crash-week-1).

NFL.com shut its season-long game in 2026 and moved its leagues to ESPN; the migration kept standings and
champions and dropped drafts, transactions and chat ([ESPN](https://support.espn.com/hc/en-us/articles/51039536539924-FAQs-for-the-NFL-Fantasy-Football-League-Migration-to-ESPN-Fantasy-Football)). That is what the
incumbents think "league history" is. Ours keeps everything.

### The power-user and money platforms

| | Fantrax | MFL | Fleaflicker | Ottoneu | League Tycoon |
|---|---|---|---|---|---|
| Sports | 8 including NHL | NFL only | NFL, MLB, NBA, NHL | MLB, NFL, NBA | NFL only |
| Hockey depth | best in class: custom categories, prospect slots, contracts, caps, multi-team trades | none | good: 40 scoring rules, 40 keepers, taxi | none | none |
| Price | free; premium $129.95 per league | $109.95 per league | free; $49.99-69.99 upgrades | $20 per team | free; $11.99 per team for contract leagues |
| App | wrapped web app, 4.8 stars, "hangs on phones" | dated web | "very dated" | web | native, 4.8 |
| API | none | yes, the model to copy | yes | no | no |
| AI | none | none | none | none | none |

Sources: [Fantrax premium](https://www.fantrax.com/newui/premiumLeagueFeatures.go), [Fantrax forum](https://www.fantrax.com/forums/general/messages/public/h13iioluj9yglx4a/1), [MFL fees](https://home.myfantasyleague.com/fantasy-football-sales-faq/), [MFL API](https://api.myfantasyleague.com/2020/api_info?STATE=details), [Fleaflicker](https://www.fleaflicker.com/nhl/fleaflicker-vs-yahoo), [Ottoneu](https://ottoneu.fangraphs.com/basketball/help/prizes), [League Tycoon](https://leaguetycoon.com/).

Fantrax is the one to beat for hockey keeper leagues. Its users praise exactly what we must match ("I can
make whatever I want to happen"; "fourteen years for my hockey pools") and complain about exactly what we
already do better: speed, phone, ads, support that takes three days to answer a league migration, a draft
that lost rounds five to ten, and no AI. Its weakest spot is the one SaK built first: the app.

### The real-money crowd, and why we stay out

Underdog (bought by IG Group for up to $1.3B in July 2026), PrizePicks (Allwyn, $1.6B for 62%), DraftKings
and FanDuel are betting companies with fantasy branding. In 2025-26 they paid a $15M New York penalty, moved
every pick'em product to peer-to-peer after cease-and-desist letters, and then surrendered fantasy licences
in seven states to keep their CFTC prediction markets ([RotoWire](https://www.rotowire.com/article/underdog-shutters-drafts-in-7-states-to-preserve-prediction-market-platform-132752)). California's
attorney general called all paid daily fantasy illegal ([ESPN](https://www.espn.com/sports-betting/story/_/id/45661944/california-attorney-general-says-daily-fantasy-illegal-state)); Ontario treats paid DFS as sports betting and no
operator has offered it since 2022 ([Covers](https://www.covers.com/industry/ontario-dfs-sports-betting-fantasy-igaming-drought-continues-sept-3-2025)); India banned real-money gaming outright in 2025.
Season-long, friend-run leagues with no rake are addressed by no statute in Canada or the US. The rules for
Super Pools, permanent:

1. No rake, no house, no entry fees to us. The subscription is for the software.
2. Side bets, props, pools and the book settle in league coins, never cash.
3. Cash dues stay bookkeeping between friends: a tracker with balances on the record, no escrow, no payouts
   through us. If leagues want escrow later, it goes through a licensed partner, never our own wallet.
4. No pick'em against the house for money, no real-money prediction markets, no affiliate links to sportsbooks or
   prediction-market operators. Prediction pools in Supercoins, priced by the pool's own market maker, are the product
   (4 October 2026, `docs/POOLS.md`); the line is money, never the format.

### What commissioners actually complain about

From app-store reviews, Trustpilot and forums (links in section 7): chasing dues and paying winners late;
abandoned teams nobody can remove; trust in a commissioner who also plays; set-up complexity and migration
with no help; drafts and apps that fail on the one night that matters; and keeper tracking in spreadsheets
because the free sites cannot express the league's rules. Every one of these is a product requirement.

## 4. Where Super Pools stands today

What the SaK site already does that the market does not combine (103 SQL functions, 26 pages, 39
components, one nightly sync):

- Live scoring from the box scores with per-player puck-drop locks, a month of stat corrections, and a
  lineup history that shows exactly what was credited.
- Lineups set 60 days ahead or left to the auto-pilot; game-day status, injuries and starting goalies in the
  data.
- A draft room with clock, board, queues, autopick, TV board, mock drafts and a graded report card.
- Keepers with the top-scorer rule, trade review windows and grades, IR rules, acquisition limits, future
  pick trading, multi-team trades, a trade block.
- Side bets, props, pools and a coin sportsbook settled from the box scores with live odds; bet rulings.
- A league voice with memory, persona, recaps, rankings, grades and answers, in the chat with polls and
  reactions; push notifications; a Yahoo import; a league fund and money ledger.
- Phone-first, no ads, test suite over the whole draft-to-settlement flow, per-league policies in place.

What the market has that we do not, in the order it costs us leagues:

1. Head-to-head categories and rotisserie scoring. We are points-only. A large share of hockey leagues
   are category leagues; Fantrax, Yahoo and ESPN all offer them. This is the single biggest gate.
2. Onboarding without us: sign up, name the league, invite, import, set rules, draft. Today a league is a
   migration we run by hand.
3. Contracts, salary caps, taxi or prospect slots and rookie drafts. None of the big five offer them for
   hockey; Fantrax does. Owning this is how we take the fourteen-year leagues.
4. Dues tracking with balances and reminders (Sleeper's tracker is the bar; escrow is not ours to build).
5. An app-store presence. Leagues find platforms in the Sports chart during draft season; a web app on a
   home screen does not appear there. A thin native wrapper around the existing site gets us listed.
6. A public API and import from everywhere (Fantrax, ESPN, Yahoo, Sleeper, CBS, MFL, with history). MFL
   and Fleaflicker became hubs for every third-party tool because they opened their data; Fantrax's lack of
   an API is a standing complaint.
7. Co-commissioners, a league constitution page, abandoned-team handling, and a commissioner audit trail
   (every override on the record, which answers the trust complaint directly).
8. Guillotine, best ball and survivor formats, which cost little once the engine is per-league.

## 5. The position

Said once, in the brand document's words: Super Pools is the hockey pool that runs itself, built by a keeper
league, with a league voice. It grows into the place where a group of friends keeps every pool they play, in
every sport, with one fun currency across all of them. Against each competitor, the one sentence we win with:

- Against Sleeper: everything you love about Sleeper, with hockey, and a voice that posts the recap.
- Against Yahoo and ESPN: your rules, not theirs; your history, all of it; no ads; an assistant that knows
  the sport.
- Against Fantrax: the same depth, on a phone, fast, with no pop-ups, and it talks.
- Against CBS: the same control for less, and it works on game night.
- Against FPL and Dream11, abroad: a private pool with your friends and your rules, not one public game.

### Free to start, paid by feature, priced per pool

A free tier gets people into simple pools with no assistant; each paid tier adds the features that make a pool
serious, and the price follows the features, never the head count. No ads on any tier. Prices are per pool
per season, paid by the commissioner or split, and are proposals until the first paying season sets them:

| Tier | Who it is for | What it adds | Proposed price |
|---|---|---|---|
| Free | a group trying a pool | one sport, points scoring from presets, snake draft, daily lineups, standings, chat and polls, league history, up to 12 teams; no assistant | free |
| Plus | an established league | custom scoring (points, categories, rotisserie), keepers, imports with history, dues tracker, co-commissioners, constitution, audit trail, weekly recap from the voice | about $49 a season |
| Premium | the fourteen-year league | the full voice (daily recap, rankings, grades, answers, a daily budget), contracts and caps, prospect slots and rookie drafts, projections and simulated seasons, the multi-sport pool, the prediction market, API access | about $99 a season |
| Side bets and the Book | any tier | head-to-heads, props, pools and the coin book on real games, settled from the box scores | add-on, about $19 a season, included in Premium |
| Super Pool bundle | a group with several pools | every pool the group runs, in every sport, for one price | about $149 a season |

The benchmarks put the top of this ladder where Fantrax, CBS and RotoWire already are and below Yahoo's
per-user tools for a twelve-team league; the free tier matches what Sleeper, Yahoo and ESPN give away, minus
their ads and plus our history. A free pool sees the paid features in place, greyed, with a week's trial on
each, so the upsell is the product and not a banner.

### The Supercoin

One fun currency for the whole site, never money. The SaK league's coins become the first Supercoin wallet;
every account gets one, and every pool draws on it:

- Each pool grants its members a season allowance of Supercoins and may top it up for events (the draft, the
  deadline, the playoffs). Side bets, props, pools and the Book settle in Supercoins from the box scores.
- A prediction market in Supercoins, across the site: who wins the Cup, the scoring title, the trade of the
  year, settled from the record, with pool-level and site-level leaderboards. Peer-to-peer, no house.
- Later, competitions and prizes within Super Pools paid in Supercoins and in kind (badges, trophies, a
  season of Premium), never in cash.

The rules that keep it fun and out of the regulators' way, permanent:

1. Supercoins cannot be bought, sold, transferred for value or cashed out, and the terms say so. A coin with
   no price is not consideration, and without consideration there is no wager and no lottery.
2. No real money enters or leaves through us: no rake, no entry fees to us, no house-banked anything,
   no sportsbook or prediction-market affiliation. Cash dues stay a tracker with balances on the record.
3. Any future prize is non-cash, awarded on skill first (standings, grades), and reviewed by counsel in each
   market before it launches; free entry with a prize is a promotion, and promotions have rules by country.
4. The ledger is the law: every Supercoin movement is a row with a reason, visible to the pool, so a
   commissioner can never be accused of what Fantrax commissioners are accused of.

### The pool that learns

The site improves because it watches how pools are used and asks what they want:

- Usage telemetry, pseudonymous and per pool: which settings leagues choose, which formats and scoring
  presets win, which features get used and dropped, where drafts stall, what bets are popular, what the voice
  gets asked. Stored in our own tables, disclosed in the privacy policy, with a commissioner opt-out, never
  sold or shared. It feeds the presets a new pool starts from, the statistics and projections the site shows,
  and the voice's sense of what matters in a league.
- A product-wide feature board grown from the SaK Features page: GMs and commissioners in every pool suggest,
  comment and vote; statuses are public (new, planned, building, done, declined) with a note on each; a
  changelog posts what shipped and who asked for it. The people who run the pools build the product with us.

The AI posture, from what users said in 2026: grounded in the pool's own data, labelled as the voice, dry,
specific, never generic prose and never an invented stat. Yahoo's AI-written content drew "zero personality,
zero laughs"; ChatGPT drafted players who were out for the season. Garry's grades and recaps are built on
box scores and the league's record, which is why they work, and the free tier has no voice at all so nobody
meets a generic one.

## 6. The road to every sport

The portal, stated plainly: the same group of friends keeps one home for every pool they play, in every
sport, all year, with one currency and one history. Hockey and basketball run October to June, baseball
April to October, football September to February, soccer August to May, cricket's IPL March to May and the
international calendar all year. No incumbent sells that; they sell sports, one app each.

Two sports are promoted for the audience they bring rather than the data they cost: soccer, the one sport
the whole world plays (13.1 million FPL managers in the UK alone), and cricket, the door to India, the UK,
Australia and the Caribbean. Cricket is free-to-play only wherever we offer it: India banned real-money
gaming in 2025, and we have no money in the product anyway.

| Sport | Engine | Data | Verdict |
|---|---|---|---|
| NHL | built: daily lineups, per-game locks | free public API, seconds latency, tolerated personal-use terms | finish it first |
| Soccer | weekly engine: fixtures, gameweeks, FPL-style and head-to-head | cheap and licensed: API-Football $19-39, Sportmonks €29-99 a month | second: the worldwide door, EPL 2027-28 |
| NBA, WNBA | the hockey engine, same calendar | free CDN feed but cloud IPs are blocked; $10-40 a month licensed | third: the first multi-sport partner to hockey |
| Cricket | match engine: innings scorecards, T20 leagues and series | $6-275 a month (CricketData, Roanuz, EntitySport); free-to-play only | fourth: IPL 2028 |
| MLB | the hockey engine, the summer | best free API in sport but an explicit non-commercial notice and a litigious owner; budget a licensed feed | fifth |
| NFL, college football | weekly engine, from soccer | no free live NFL data; $100 a month to about $16k a year; college live data $5-30 a month | sixth, once revenue carries the feed |
| College basketball | the hockey engine | $5-30 a month licensed | with basketball |
| Golf, F1 | pools, not rosters | DataGolf non-commercial, PGA unofficial; Jolpica and OpenF1 free | pools only, cheap |
| PWHL | the hockey engine | HockeyTech feed, undocumented | small, cheap, on brand for Canada |
| Esports | match engine | €400-1,000 a month per title | not before 2029 |

Sources: [NHL API reference](https://github.com/Zmalski/NHL-API-Reference), [NBA blocking](https://github.com/swar/nba_api/issues/405), [BALLDONTLIE](https://www.balldontlie.io/), [Tank01](https://www.tank01.com/), [MLB copyright notice](https://gdx.mlb.com/components/copyright.txt), [Genius and the NFL](https://www.geniussports.com/newsroom/the-national-football-league-expands-and-extends-strategic-partnership-with-genius-sports-in-multi-year-deal/), [SportsDataIO](https://sportsdata.io/developers), [API-Football](https://www.api-football.com/), [Sportmonks](https://www.sportmonks.com/football-api/plans-pricing/), [cricket APIs](https://api.market/blog/veer-hanuman-1/sports/best-cricket-api-2026), [India's 2025 Act](https://en.wikipedia.org/wiki/Promotion_and_Regulation_of_Online_Gaming_Act,_2025), [CollegeFootballData](https://collegefootballdata.com/api-tiers), [C.B.C. v. MLBAM](https://media.ca8.uscourts.gov/opndir/07/10/063357P.pdf).

Legal footing: using player names and public statistics in a paid fantasy game is protected speech in the
US (C.B.C. Distribution v. MLBAM, 2007; Daniels v. FanDuel, 2018). The exposure is the terms of the feed we
read, not the stats themselves, and the remedy is a licensed feed once a sport earns it. Headshots, logos
and marks need licences; we draw our own. Abroad, the FPL and Premier League terms forbid building on their
feed, so soccer runs on licensed data from day one.

### Pools come before fantasy in every sport (5 October 2026)

A sport reaches the product first as pools, which need only the schedule, results and series state, and only later
as a fantasy league, which needs players, lineups and live stats. The pool types are one engine (`docs/POOL-TYPES.md`):
a bracket, series pick'em, weekly pick'em and confidence, survivor, squares, the player pool, confidence by team, the
score predictor, the sweepstake and the questions, offered when a host starts a pool on a sport, each with its presets
and knobs. Each sport also gets a centre for following it, built from NHL centre. So MLB arrives for the 2026 World
Series as pools with the host settling results if need be, years before baseball fantasy; the NFL arrives for its
2026-27 pick'em and survivor season; March Madness and the NBA playoffs arrive in spring 2027 the same way. The market
for those formats is the biggest in pools (26.6M ESPN brackets in 2026; Circa Survivor's 25,017 entries; one American
in five in a Super Bowl pool or bet), and none of the hosts that run them (ESPN, Yahoo, CBS, Splash, OfficePools,
PoolTracker) keeps the group, its chat and its history from one event to the next.

### The multi-sport pool

A pool whose roster spans sports: a GM drafts, say, four hockey players, three basketball players, three
soccer players and two cricketers, and the pool wraps up when one chosen season ends (the anchor season,
usually the longest one in the set). What it needs:

- Each sport's points on a common scale, so a hat trick and a century are worth comparable amounts. The
  pool picks a preset (equal weight per sport, or weighted by roster share) and sees per-sport totals too.
- Slots per sport, locks per sport (a player locks at his own game's start, whatever the sport), and the
  daily and weekly engines running side by side under one lineup page.
- Every sport in the set live on the site first; the pool cannot include a sport we do not score.
- The first version ships with hockey, basketball and soccer, which share the October-to-May window; cricket
  and baseball join as they land.

### Horizon 1: win hockey and lay the foundations (now to summer 2027)

Hockey is finished when a commissioner can move a fourteen-year Fantrax league to Super Pools in an evening
without us and nothing is lost. The foundations are the pieces every later sport and every tier needs.

1. Finish tenancy (plan steps 1-7: functions per league, accounts, league by host, voice per league,
   scheduler per league, money per league, onboarding).
2. Tiers and billing: the free, Plus, Premium, add-on and bundle shape above, enforced per pool in the
   database (a `plan` on the league row and a feature gate function), Stripe for the paid tiers, free for
   the beta leagues.
3. Category and rotisserie scoring, reading the league's categories the way it reads its point weights.
4. Import with history from Yahoo (exists), Fantrax, ESPN and CBS.
5. Contracts, caps, prospect slots, rookie drafts; guillotine and best ball formats.
6. The Supercoin: an account-level wallet, the SaK coin ledger migrated onto it, per-pool allowances, the
   side-bet and Book add-on gated by tier, the ledger visible in every pool.
7. Commissioner tools the market lacks: dues tracker, co-commissioners, constitution page, audit trail,
   abandoned-team handover.
8. The sport pulled out of the engine: a `sports` table, per-sport player, game and stat shapes, per-sport
   scoring vocabularies and a sync per sport; the NHL becomes one row. This is the prerequisite for soccer,
   basketball and the multi-sport pool, so it moves into the first horizon.
9. Telemetry tables and the product-wide feature board; the privacy policy and the commissioner opt-out.
10. App-store listing through a thin native wrapper; the playoff bracket pool; the voice per league with a
    daily budget and a commissioner switch for what it may say.

Target: 10 beta leagues on the 2027 playoffs, 100 hockey pools for 2027-28, a quarter of them paid.

### Horizon 2: the world, and the second currency of fun (summer 2027 to spring 2028)

1. Soccer for 2027-28 on licensed data: a weekly engine with gameweeks, FPL-style squads and head-to-head
   leagues, private pools with the commissioner's rules. The first sport outside North America, the landing
   page in more than one voice of English, and prices in more than one currency.
2. Basketball for 2027-28 on the hockey engine and a licensed feed.
3. The multi-sport pool, version one: hockey, basketball and soccer.
4. The Supercoin prediction market across the site, peer-to-peer, settled from the record, with leaderboards.
5. The Super Pool bundle: one group, several pools, one cross-sport standing and one crown.
6. The public API and an MCP connector; the telemetry feeding presets, statistics and the voice.

Target: 400 pools across three sports, a hundred of them outside North America, a pool that plays all three.

### Horizon 3: cricket, the summer, football and prizes (2028 to 2029)

1. Cricket for IPL 2028, free-to-play everywhere: a match engine for innings scorecards, T20 leagues and
   international series, on a licensed feed. Then the UK, Australian and Caribbean seasons.
2. Baseball for 2028 on the hockey engine and a licensed feed; the multi-sport pool gains the summer.
3. Football and college for 2028 on the soccer engine's weekly bones, with keeper and dynasty depth, best
   ball and guillotine, on licensed live data once revenue carries it; college basketball with basketball.
4. Pools for golf and F1; PWHL and WNBA on the existing engines.
5. Supercoin competitions and non-cash prizes, market by market after counsel review; creator-hosted and
   public pools with waiting lists.

Target: 1,500 pools, every major sport on at least two continents, the first Supercoin champion.

### What we will not do

- No ads on any tier, and no feature taken away from a tier a pool already paid for.
- No real money through us, no Supercoins for sale, no house-banked products, no sportsbook or
  prediction-market affiliation, no cash prizes.
- No generic AI content; nothing the voice says comes from anywhere but the pool's own data, and the free
  tier has no voice rather than a watered-down one.
- No sport added before its data is licensed or demonstrably tolerated and its engine is one we already
  run; the landing page shows the roadmap as a roadmap and never a sport as available before it is; no
  cricket with money anywhere.
- No telemetry sold, shared or tied to a name; what we learn goes back into the product.

## 7. Sources on commissioner pain

[Cheddar Up on dues](https://www.cheddarup.com/blog/fantasy-football-dues/), [Terry Lyons on the job](https://terrylyons.substack.com/p/its-just-a-fantasy), [Yahoo on abandoned teams](https://help.yahoo.com/kb/dumped-players-abandoned-teams-handled-yahoo-fantasy-sln6991.html), [FantraxHQ on trust](https://fantraxhq.com/the-commissioning-conundrum/), [Fantrax reviews](https://www.trustpilot.com/review/fantrax.com), [Fantrax App Store](https://apps.apple.com/us/app/fantrax-fantasy-sports/id1463442455), [Sleeper reviews](https://play.google.com/store/apps/details?id=com.sleeperbot&hl=en_US), [Sleeper App Store](https://apps.apple.com/us/app/sleeper-fantasy-sports/id987367543), [AI backlash](https://www.thegamingjuice.com/2025/06/12/artificial-intelligence-content-fantasy-football), [ChatGPT drafting](https://www.outkick.com/culture/i-used-chatgpt-draft-my-fantasy-football-team-heres-how-week-one-went), [LeagueSafe fees](https://help.leaguesafe.com/hc/en-us/articles/217117406-What-are-the-fees-on-LeagueSafe).
