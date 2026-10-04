# Super Pools: prediction pools for any group, about anything

Written 4 October 2026 from three research passes: prediction markets (Polymarket, Kalshi and the play-money
products), the pools market (office, sports and reality-TV pools, and who plays them), and soccer data with the
Love Is Blind calendar. Every number that matters carries its source. This document sets the direction Patrick chose
on 4 October 2026: Super Pools becomes the Polymarket of pools, for pools of any kind, sports first, played in
Supercoins with no money in or out, built for the long life of a group. `docs/MARKET.md` keeps the fantasy-league
market and the road to every sport; `docs/SUPERPOOLS.md` holds the ordered work; `docs/BRAND.md` the words and look.

## 1. The short version

- **Polymarket proved the interface, not the business we want.** A price that reads as a probability, a chart that
  moves as people pick, comments under every question and a card worth sharing: that is why its median user made 46
  trades in six weeks ([Pew, 22 Jul 2026](https://www.pewresearch.org/short-reads/2026/07/22/what-we-know-about-the-typical-polymarket-user/)).
  Its money sits in litigation: New York sued Polymarket on 24 September 2026 and Kalshi on 31 July; the federal circuits
  are split and New Jersey has asked the Supreme Court to decide ([RotoWire timeline](https://www.rotowire.com/prediction-markets/legal-timeline)).
  We take the interface and leave the money.
- **Groups are the moat.** Polymarket's newest feature is group chat ("Squads"); Sleeper grew 90% virally because every
  new league invites about eleven people and its chat replaced the group text ([a16z, 2020](https://a16z.com/announcement/investing-in-sleeper/)).
  Super Pools starts where they are heading: a private pool of friends with its own chat, its own voice and its own
  history, season after season.
- **Play money works when it is social, and fails when it chases cash.** Manifold's sweepstakes cash ran six months and
  closed for missing its usage goals; about 1% of its daily visitors trade ([Manifold, Feb 2025](https://news.manifold.markets/p/focusing-on-mana-bringing-sweepstakes),
  [stats](https://manifold.markets/stats)). Bracketology's loudest complaint is its drift to prize modes and
  gambling-style pushes ([App Store](https://apps.apple.com/us/app/bracketology/id6463115555)). Design for people who
  watch, react and talk, not only for people who trade.
- **The pools market is big, old and badly served.** ESPN took 26.6M March Madness brackets in 2026
  ([ESPN](https://espnpressroom.com/us/press-releases/2026/03/26-6-million-brackets-espn-tournament-challenge-sets-new-record-for-fourth-consecutive-year/));
  36.5M US adults planned a casual pool or squares bet on the 2024 Super Bowl ([AGA via ESPN](https://www.espn.com/nfl/story/_/id/39469575/americans-expected-bet-231b-super-bowl-lviii)).
  The free tools reset every event; the paid ones look like 2009 ("basically the website in phone form"); the fastest
  grower (Splash, $14.5M Series B, Oct 2025) is pushing toward real money. Nobody combines a beautiful phone-first pool,
  chat, history that carries across seasons, and pools beyond sports.
- **Entertainment pools are a women-led audience nobody serves well.** Love Is Blind's audience was 75% female and 78%
  aged 18-49 (Nielsen, S6, [Deadline](https://www.yahoo.com/entertainment/love-blind-sails-back-onto-200859078.html));
  Love Island USA's voting app reached 5.5M users ([Deadline, Jul 2025](https://deadline.com/2025/07/love-island-usa-fan-voting-record-season-7-stand-on-business-challenge-1236448856/)).
  Fans run their pools in group chats and spreadsheets. The research on women in fantasy says the same thing every
  time: they come for the group and the conversation, and Sleeper reached about 30% women by designing for it.
- **So the product is one engine with two doors.** Fantasy pools for the sports season (hockey today, soccer next) and
  prediction pools for anything a group watches (a show, an awards night, a bracket, the Cup), sharing one wallet, one
  chat and one record. Love Is Blind Season 11 (premiere 14 October 2026) is the first test of the second door.

## 2. What Polymarket and its rivals teach

| | What it is | What to take | What to leave |
|---|---|---|---|
| Polymarket | Order-book market in USDC; each outcome a share paying $1; resolved by UMA token vote; US relaunch December 2025; $21B valuation (Aug 2026); sports 41% of 30-day volume ([DeFi Rate](https://defirate.com/prediction-markets/volume/polymarket/)) | The price as a probability, the moving chart, comments per market, trending feed, share cards, small frequent trades | Real money; an order book (dead in a group of ten); token-vote resolution (a whale forced a wrong answer on a $7M market in March 2025, [The Defiant](https://thedefiant.io/news/defi/polymarket-s-usd7m-ukraine-mineral-deal-debacle-traced-to-oracle-whale)) |
| Kalshi | CFTC exchange; September 2026 record month; sued by 20+ state regulators | Sports as the engine of daily use | The legal fight |
| Robinhood, FanDuel Predicts, DraftKings Predictions, Fanatics Markets, Novig | Every sportsbook and broker now runs event contracts | Proof the habit is mainstream | All of it is money |
| Manifold | Play-money markets ("mana"), creator-resolved, streaks, quests, monthly leagues | Streaks, leagues with promotion, creator markets | The cash experiment; a public site of strangers |
| Metaculus | Reputation and calibration, no money | Calibration as the status symbol | Forecasting as homework |
| ESPN Streak for the Cash | Free pick'em, closed 2022 after 14 years | A free sponsored game can vanish overnight; own the group, not the event | |

The mechanics we adopt, from what works with play money in small groups:

1. **An automated market maker, not an order book.** Each question runs on a logarithmic market scoring rule (LMSR):
   prices always add to 100%, every pick moves them, and anyone can buy or sell at any moment before it closes. The
   pool's maker is funded by the pool (new Supercoins at most `b·ln(n)` a question), so nobody is the house. The
   liquidity `b` is sized to the group so ten friends still see the price move.
2. **Bankrolls that keep it fair.** A starting stake, a drop of coins on a schedule (every episode night, every
   gameweek), a cap per question, and late joiners caught up to the same coins as everyone else.
3. **Rankings that reward judgment, not size.** Net worth (coins plus positions at today's prices) for the season's
   crown, plus a hit rate and a calibration badge, so a reckless all-in is not the best strategy.
4. **Trust in resolution is the product.** Every question carries its resolution rule, written at creation and locked;
   the host resolves with a reason that posts to the chat; a resolved question can be voided with every stake refunded;
   every coin is a ledger line the pool can see.

## 3. The legal line, permanent

Not legal advice; the safe zone as the research reads it. Gambling needs a prize, chance and consideration. Supercoins
are free to get, cannot be bought, sold, transferred for value or cashed out, and win nothing of value, which removes
both the consideration and the prize.

- **Never sell coins.** Purchased virtual chips were a "thing of value" in Kater v. Churchill Downs (9th Cir. 2018), and
  Washington's attorney general is suing social-casino operators for $225M (July 2026). Apple also forbids purchased
  currency from expiring, which would break season resets.
- **Never make coins redeemable.** That is the sweepstakes model, banned in California (AB 831, in force 1 January
  2026, reaching vendors and payment processors) and New York (December 2025).
- **Prizes of any kind** (even a gift card) bring contest law, Apple 5.3 sponsor rules and, in Canada, the Criminal Code
  s.206 skill-testing rule. Counsel first, market by market.
- **App stores.** A play-money pool is neither a real-money app nor a social casino; Apple rates infrequent simulated
  gambling 13+, frequent 18+. We rate the app 17+ when it is listed and keep ads (we have none) away from simulated
  gambling.

Money comes from the software (the tiers in `docs/MARKET.md`), never from the coins.

## 4. The pools market, and the gap

| Who | What they sell | Where they fall short |
|---|---|---|
| ESPN, Yahoo, CBS | Free brackets and pick'em; the biggest audiences | Groups reset every event; no history; ads |
| Splash (RunYourPool, OfficeFootballPool) | Commissioner-run contests, moving to real money; RunYourPool about $100 for 50 entries | "The website in phone form"; surprise fees; money |
| OfficePoolStop, PoolTracker | Cheap hosted pools with ads | Dated, ad-supported, no chat |
| Superbru | Soccer score predictor; 2.9M players, 376k in its World Cup 2026 game | One format, public-first |
| Bracketology.tv | Reality-TV leagues for 40+ shows; claims 400k+ active players | 3.9 stars; prize mode and gambling-style pushes; no chat |
| RealityFan, RealTVFantasy, Fantasy Reality TV | Small reality-TV drafts and templates | Thin, paywalled scoring, no group life |

The gap, in one line: a beautiful pool on a phone, opened from one tap in the group chat, with the chat built in, the
price of every call moving as friends pick, and a record that carries from this show to the next sport to next season.

## 5. Two doors, one engine

**Fantasy pools** (sports): rosters, a draft, lineups, live scoring, trades, the Book. Hockey is live; soccer is next
(section 7).

**Prediction pools** (anything): a pool of questions with two to twelve answers each, priced by the market maker,
bought and sold in Supercoins until the question closes, resolved by the host. A prediction pool can stand alone (a
Love Is Blind pool, an Oscars night, a March Madness pool) or live inside a fantasy league as its Markets tab (who
wins the Cup, the trade of the year).

Everything else is shared: accounts, invites and the join page, the chat with reactions and polls, the league voice,
push alerts, the Supercoin ledger, the brand per pool, history, telemetry and the feature board.

## 6. The first test: Love Is Blind, Season 11

**The season.** US Season 11, Boston; hosts Nick and Vanessa Lachey; 30 singles aged 28-40 (14 men, 16 women).
Episodes drop Wednesdays at 3 am ET ([Netflix Tudum, 30 Sep 2026](https://www.netflix.com/tudum/articles/love-is-blind-season-11-release-date-news)):
14 October (episodes 1-5), 21 October (6-8), 28 October (9-11), 4 November (12, the weddings). The reunion is not
announced; seasons 9 and 10 had it one week after the finale, so about 11 November. Season 10's baseline: seven
engagements, three called off before the weddings, four couples at the altar, two married, one together at the reunion.

**The audience.** Women 18-49, in friend groups, watching on drop night and talking about it for a week. They come for
the group and the conversation, so the chat is the product and the market is what gives it a scoreboard.

**The pool.** A prediction pool with its own brand (rose on night, a wordmark per pool) and no sports anywhere on screen:

- Questions for the whole season, open from the day the pool opens and closing at the first drop: how many couples
  get engaged, how many say "I do", does any couple go somewhere other than Mexico, is anyone still together at the
  reunion, is there a split decision at an altar.
- Questions for each drop, written by the host after each batch when the couples are known: will these two make it to
  the altar, who leaves the pods engaged, who gets cold feet first. They close at the next drop, Wednesday 3 am ET.
- Coins: 1,000 to start, 250 more on each drop night; a cap of 500 per question; the host can pay a bonus drop.
- The crown: net worth at the reunion, with the hit rate beside it and a "called it" badge for the best long-shot call.
- One tap to join from a link in the group chat, no app to download; share cards after every drop.

**The gate.** The test passes if, by the finale on 4 November: three pools or more are running, thirty players or
more have joined, two thirds of them trade in three of the four drop weeks, and the median player makes five trades
a week. Whatever the result, we write down what people asked for and what they ignored, and the next show (The
Bachelor and The Traitors in January, the Oscars in March) starts from it.

## 7. Soccer, the next sport

Soccer is the next sport in both doors, starting with the cheap one.

1. **Prediction pools on soccer first (October-December 2026).** They need fixtures and results only: match winner and
   score predictor questions per gameweek, a survivor ("last one standing") pool, and season questions (the champion,
   the top scorer, relegation). Premier League 2026-27 runs to 30 May 2027 (38 gameweeks); MLS Cup is 18 December
   2026; Champions League, Liga MX, NWSL and WSL follow on the same feed.
2. **Soccer fantasy next (for the second half of 2026-27 or for 2027-28).** A weekly engine: gameweeks, squads,
   transfers, captain, FPL-style scoring (minutes 1 or 2; goals 10/6/5/4 by position; assist 3; clean sheet 4/4/1;
   saves 1 per 3; bonus 3-2-1; yellow -1, red -3, own goal -2; defensive contribution 2), points and head-to-head.
3. **Data.** API-Football Pro ($19 a month: Premier League, MLS, Liga MX, Champions League, NWSL, WSL; fixtures, live
   every 15 seconds, lineups, player match stats, injuries; commercial use allowed), with the tables kept
   provider-neutral so Sportmonks (€29 Starter, stronger contract) can replace it. Never the FPL API (its terms forbid
   commercial use and building a database), FotMob or SofaScore; ESPN's public endpoints only as a cross-check.
   Free tier (100 requests a day) for development. *Built 4 October 2026 (migrations 148-149): `soccer-sync` reads
   API-Football into `competitions`, `clubs` and `fixtures`; the Premier League and MLS are switched on. It starts the
   day the `API_FOOTBALL_KEY` function secret is set.*

## 8. Every pool, by the calendar

Keep the pool and its people; change what they predict. The order after Love Is Blind, chosen by the calendar and the
audience it brings:

| When | Pool | Door |
|---|---|---|
| Oct-Nov 2026 | Love Is Blind S11 (the test); soccer gameweek and survivor pools; NHL season questions in SaK | prediction |
| Dec 2026 | MLS Cup; NFL playoff pick'em (questions only, no NFL data needed beyond results) | prediction |
| Jan-Mar 2027 | The Bachelor, The Traitors, the Oscars and award nights; soccer fantasy half-season | both |
| Mar-Apr 2027 | March Madness bracket pool; NHL playoff bracket pool | prediction |
| Jun-Jul 2027 | Women's World Cup 2027 (Brazil, 24 June-25 July); Love Island | prediction |
| Aug 2027 onward | Premier League 2027-28 fantasy; MLS's first fall-spring season; hockey's second season on Super Pools | both |

Creators are the second growth engine after invites: a podcast or TikTok recap host runs a branded public pool with a
leaderboard for her audience, free, with the host tools Splash pays commissioners for.

## 9. What we will not do

- No money in or out, no coins for sale, no redemption, no prizes of value without counsel, no sportsbook or
  prediction-market affiliation, no gambling-style pushes (an alert says what changed in your pool, never "bet now").
- No order book, no token votes, no anonymous public markets about real people's private lives beyond what the show
  airs; questions about a show are about what airs.
- No feature that makes one pool's data visible to another; no telemetry sold or tied to a name.

## 10. Sources

Prediction markets: [Pew on Polymarket users](https://www.pewresearch.org/short-reads/2026/07/22/what-we-know-about-the-typical-polymarket-user/),
[DeFi Rate volumes](https://defirate.com/prediction-markets/volume/polymarket/), [Bloomberg on Polymarket's round](https://www.bloomberg.com/news/articles/2026-08-31/polymarket-funding-round-led-by-1789-values-firm-at-21-billion),
[Bloomberg on Kalshi](https://www.bloomberg.com/news/articles/2026-09-30/kalshi-finalizing-new-funding-at-40-billion-value-ahead-of-ipo),
[Paradigm on double counting](https://www.paradigm.xyz/writing/polymarket-volume-is-being-double-counted), [Manifold FAQ](https://docs.manifold.markets/faq),
[Kater v. Churchill Downs](https://cdn.ca9.uscourts.gov/datastore/opinions/2018/03/28/16-35010.pdf),
[California AB 831](https://sbcamericas.com/2025/10/14/newsom-signs-california-sweepstakes-ban/),
[Apple guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play gambling policy](https://support.google.com/googleplay/android-developer/answer/9877032),
[Canada skill-testing questions](https://www.contestlawyer.ca/skill-testing-questions/).
Pools: [Splash Series B](https://pulse2.com/splash-14-5-million-series-b-closed-for-improving-social-sports-gaming-platform/),
[RunYourPool reviews](https://apps.apple.com/us/app/runyourpool/id1662531821), [OfficePoolStop pricing](https://officepoolstop.com/pricing),
[Superbru](https://www.superbru.com/), [Bracketology](https://bracketology.tv/), [Netflix Top 10](https://www.netflix.com/tudum/top10),
[Sleeper and women, CNBC 2019](https://www.cnbc.com/2019/08/25/sleeper-casual-fantasy-football-start-up-battling-yahoo-and-espn.html),
[women's fantasy motivations](https://journals.sagepub.com/doi/10.1177/2329496515616821), [Ariel Fantasy closing](https://www.espn.com/soccer/story/_/id/48172925/popular-wsl-fantasy-football-app-set-shut-down).
Love Is Blind: [Tudum release dates](https://www.netflix.com/tudum/articles/love-is-blind-season-11-release-date-news),
[Tudum cast](https://www.netflix.com/tudum/features/love-is-blind-season-11-boston-cast-instagrams),
[Boston.com](https://www.boston.com/culture/streaming/2026/09/30/love-is-blind-boston-season-11-cast/), [season 10](https://en.wikipedia.org/wiki/Love_Is_Blind_season_10).
Soccer: [Premier League 2026-27 dates](https://www.premierleague.com/en/news/4468487/dates-for-202627-premier-league-season-confirmed),
[FPL rules](https://fantasy.premierleague.com/help/rules), [Premier League terms](https://www.premierleague.com/en/terms-and-conditions),
[API-Football](https://www.api-football.com/), [Sportmonks pricing](https://www.sportmonks.com/football-api/plans-pricing/),
[football-data.org pricing](https://www.football-data.org/pricing), [C.B.C. v. MLBAM](https://law.justia.com/cases/federal/appellate-courts/ca8/06-3358/063357p-2011-02-25.html).
