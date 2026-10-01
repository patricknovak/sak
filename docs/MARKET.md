# Super Pools: the market, the competition, and the road to every sport

Written 1 October 2026 from four research passes over the platforms' own pages, app-store listings, press
releases, FSGA and Leger surveys, data-vendor pricing and terms, and 2025-26 trade press. Reddit was not
reachable from the research environment, so commissioner quotes come from app-store reviews, Trustpilot and
forums. Every figure that matters carries its source. This document sets the position; `docs/SUPERPOOLS.md`
holds the ordered work and `docs/BRAND.md` the words and the look.

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
- The way to "every sport" is one sport at a time, in the order the audience and the data allow: hockey
  first and fully, then basketball (same engine, same calendar), then baseball (same engine, the summer),
  then football (the biggest market, the hardest data, the most crowded), then soccer and the rest. The
  portal is not a feature list; it is the same ten friends, one home, every season of the year, one crown.

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
4. No pick'em against the house, no prediction markets, no affiliate links to sportsbooks.

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
league, with a league voice. Against each competitor, the one sentence we win with:

- Against Sleeper: everything you love about Sleeper, with hockey, and a voice that posts the recap.
- Against Yahoo and ESPN: your rules, not theirs; your history, all of it; no ads; an assistant that knows
  hockey.
- Against Fantrax: the same depth, on a phone, fast, with no pop-ups, and it talks.
- Against CBS: the same control for less, and it works on game night.

The pricing posture that fits the benchmarks: one subscription per league per season, paid by the
commissioner or split, with no per-user upsell and no ads, ever. The right number sits where Fantrax, CBS
and RotoWire already are and under what Yahoo asks per user: about $99 per league per season, which is
roughly two percent of a typical pot and under $10 a GM. Season one and the first beta leagues are free.
LLM spend is the only cost that scales with leagues, so the per-league voice budget in the plan is a
condition of this price, not a nice-to-have.

The AI posture, from what users said in 2026: grounded in the league's own data, labelled as the voice,
dry, specific, never generic prose and never an invented stat. Yahoo's AI-written content drew "zero
personality, zero laughs"; ChatGPT drafted players who were out for the season. Garry's grades and recaps
are built on box scores and the league's record, which is why they work. Every product decision about the
voice keeps that property.

## 6. The road to every sport

The portal idea, stated plainly: the same group of friends keeps one home for every season of the year.
Hockey and basketball run October to June, baseball April to October, football September to February,
soccer August to May. One login, one chat, one voice, one dues ledger, one history, and a cross-sport
standing (the Super Pool) that crowns the year. No incumbent sells that; they sell sports, one app each.

The order is set by two things: where the audience we already have is (hockey leagues also play
basketball and baseball; football is a different crowd with the most options) and what the data costs.

| Sport | Engine fit | Data | Verdict |
|---|---|---|---|
| NHL | built | free public API, seconds latency, tolerated personal-use terms | finish it first |
| NBA, WNBA | same daily engine, same calendar | free CDN feed but cloud IPs are blocked; $10-40 a month licensed (BALLDONTLIE, Tank01) | second |
| MLB | same daily engine, the summer | best free API in sport, but an explicit non-commercial notice and a litigious owner; budget a licensed feed | third |
| NFL | new weekly engine | no free live data; Genius exclusivity; $100 a month (Tank01) to about $16k a year (SportsDataIO) for live | fourth, once revenue carries the feed |
| Soccer | weekly engine, FPL-style and head-to-head | cheap and licensed: API-Football $19-39, football-data.org €12-49 a month | fifth; the global door |
| College FB and BB | reuse NFL and NBA engines | the cheapest licensed live data of all (CollegeFootballData $5-30 a month) | with football |
| Golf, F1 | pool formats, not rosters | DataGolf non-commercial, PGA unofficial; Jolpica and OpenF1 free | pools only, low cost |
| PWHL | reuse NHL | HockeyTech feed, undocumented | small, cheap, on brand for Canada |
| Cricket, esports | new engines | $150-1,000 a month per title; India bans real money | not before 2029 |

Sources: [NHL API reference](https://github.com/Zmalski/NHL-API-Reference), [NBA blocking](https://github.com/swar/nba_api/issues/405), [BALLDONTLIE](https://www.balldontlie.io/), [Tank01](https://www.tank01.com/), [MLB copyright notice](https://gdx.mlb.com/components/copyright.txt), [Genius and the NFL](https://www.geniussports.com/newsroom/the-national-football-league-expands-and-extends-strategic-partnership-with-genius-sports-in-multi-year-deal/), [SportsDataIO](https://sportsdata.io/developers), [API-Football](https://www.api-football.com/), [CollegeFootballData](https://collegefootballdata.com/api-tiers), [C.B.C. v. MLBAM](https://media.ca8.uscourts.gov/opndir/07/10/063357P.pdf).

Legal footing: using player names and public statistics in a paid fantasy game is protected speech in the
US (C.B.C. Distribution v. MLBAM, 2007; Daniels v. FanDuel, 2018). The exposure is the terms of the feed we
read, not the stats themselves, and the remedy is a licensed feed once a sport earns it. Headshots, logos
and marks need licences; we draw our own.

### Horizon 1: win hockey (now to summer 2027)

The product is finished when a commissioner can move a fourteen-year Fantrax league to Super Pools in an
evening without us, and nothing is lost.

1. Finish tenancy (plan steps 1-7: functions per league, accounts, league by host, voice per league,
   scheduler per league, money per league, onboarding).
2. Category and rotisserie scoring, with the scoring engine reading the league's categories the way it
   reads its point weights today.
3. Import with history from Yahoo (exists), Fantrax, ESPN and CBS: rosters, keepers, draft results, past
   standings and champions.
4. Contracts, caps, prospect slots, rookie drafts; guillotine and best ball formats.
5. Dues tracker with balances and reminders; co-commissioners; constitution page; commissioner audit trail;
   abandoned-team handover.
6. App-store listing through a thin native wrapper of the existing site; push through the store.
7. The voice, per league, with a daily budget, labelled, and a commissioner switch for what it may say.
8. Playoff bracket pool and playoff-only leagues (a cheap spring product and a way to try the site).
9. Billing: Stripe, one subscription per league per season; free for the beta leagues.

Target: 10 beta leagues on the 2027 playoffs, 100 paying hockey leagues for 2027-28.

### Horizon 2: the second and third sports (summer 2027 to spring 2028)

1. Pull the sport out of the engine: a `sports` table, per-sport player, game and stat shapes, per-sport
   scoring vocabularies, and a sync per sport; the NHL becomes one row.
2. Basketball for 2027-28, on a licensed feed, with the hockey engine's daily lineups, locks, corrections,
   book and voice.
3. Baseball for 2028, same engine, on a licensed feed or a written arrangement with MLBAM.
4. The Super Pool: one group, several leagues, one cross-sport standing and one crown; dues and history
   across sports; the voice knows all of them.
5. The public API and an MCP connector, so the tools people already use (and the assistants they already
   ask) read Super Pools leagues the way they read MFL and Sleeper.

Target: 300 leagues across three sports for 2028-29; a league that plays all three.

### Horizon 3: football, soccer and the rest (2028 to 2029)

1. Football with a weekly engine (matchups, weekly locks, waivers with FAAB), keeper and dynasty depth,
   best ball and guillotine, on licensed live data once revenue carries it. College football and
   basketball ride the same engines on the cheapest licensed data in sport.
2. Soccer, FPL-style and head-to-head, the first sport outside North America and the door to the UK's
   thirteen million FPL managers.
3. Pools for golf and F1; PWHL and WNBA on the existing engines.
4. Creator-hosted leagues and public leagues with waiting lists, which is how new commissioners arrive
   once the product is known.

Target: 1,000 leagues, every major North American sport, one season of soccer.

### What we will not do

- No ads, no per-user upsell, no features taken away from a free tier to sell them back.
- No real money through us, no house-banked products, no sportsbook affiliation.
- No generic AI content; nothing the voice says comes from anywhere but the league's own data.
- No sport added before its data is licensed or demonstrably tolerated and its engine is the same one we
  already run; no "coming soon" sports on the landing page.

## 7. Sources on commissioner pain

[Cheddar Up on dues](https://www.cheddarup.com/blog/fantasy-football-dues/), [Terry Lyons on the job](https://terrylyons.substack.com/p/its-just-a-fantasy), [Yahoo on abandoned teams](https://help.yahoo.com/kb/dumped-players-abandoned-teams-handled-yahoo-fantasy-sln6991.html), [FantraxHQ on trust](https://fantraxhq.com/the-commissioning-conundrum/), [Fantrax reviews](https://www.trustpilot.com/review/fantrax.com), [Fantrax App Store](https://apps.apple.com/us/app/fantrax-fantasy-sports/id1463442455), [Sleeper reviews](https://play.google.com/store/apps/details?id=com.sleeperbot&hl=en_US), [Sleeper App Store](https://apps.apple.com/us/app/sleeper-fantasy-sports/id987367543), [AI backlash](https://www.thegamingjuice.com/2025/06/12/artificial-intelligence-content-fantasy-football), [ChatGPT drafting](https://www.outkick.com/culture/i-used-chatgpt-draft-my-fantasy-football-team-heres-how-week-one-went), [LeagueSafe fees](https://help.leaguesafe.com/hc/en-us/articles/217117406-What-are-the-fees-on-LeagueSafe).
