# Pool types and sport centres: every kind of pool, for every sport

Written 5 October 2026 from a research pass over the pools people run for seasons and playoffs (ESPN, Yahoo, CBS,
Splash and RunYourPool, OfficePools, PoolTracker, The Second Season, MLB.com, NHL.com, NBA.com, UEFA, Superbru and the
office-pool sites), after Patrick started a World Series pool from the World Series pack and found it thin: a sports
pool should ask what kind of pool you want, offer the kinds people already play, explain each one's options, and give
the pool a home for following the sport. This is the plan for that. `docs/POOLS.md` keeps the direction (prediction
pools for any group), `docs/SUPERPOOLS.md` the ordered work (P6 to P9 come from here), `docs/MARKET.md` the road to
every sport, `docs/EXPANSION.md` the sport pulled out of the engine.

## 1. The short version

- **The same dozen pool types repeat in every sport.** A bracket, a round-by-round series pick'em, weekly pick'em
  and confidence, survivor (last one standing), squares, a player pool (draft, box or open), confidence by team, a
  score predictor, a sweepstake, a prop sheet and futures. What changes from sport to sport is the shape of the event
  (a best-of-3, 5 or 7 series, a single game, a two-legged tie, a draw that can happen) and which stats a player pool
  scores. So we build each type once, as an engine that reads its sport, and offer only the ones that fit the event
  and the date.
- **Starting a sports pool asks three things, in order: what are you following, what kind of pool, and how it scores.**
  The kinds are cards ("Most popular", "Easiest", "Two minutes a week"), each with a one-line how-it-works and the
  date it locks; the scoring is a preset (Classic, Office, the official game's rules) with every knob explained in
  plain words and a live example ("Dodgers in 6, right in 6: 8 + 3 = 11 points"). A pool can run more than one game
  (a series pick'em with World Series squares beside it); each game has its own table.
- **Every pool type is one shape:** a pick (a team, a series and its length, a rank, a score, a player, a square), a
  lock time, a grader that reads results, and a scoring profile. One `pool_games` table with a `kind` and its `rules`
  covers them all, the way `league_rules` covers the fantasy formats. Last one standing and Call the score (built for
  soccer, migrations 157-158) become two kinds of it.
- **A sport centre for every sport we run pools on**, built from NHL centre: today's games with the series state, the
  line score, the bracket or the table, the schedule, injuries, leaders and odds, and a "your pool" ribbon on every
  game (who in your pool needs which side, what it does to the table). The NHL's stays as it is and becomes one
  adapter; MLB is next for the World Series, then the NFL, soccer and the NBA.
- **What wins:** a live table during games, max possible points, an elimination tracker, the pool's pick split shown
  after each lock, rolling locks per game or series so a late joiner still plays, and "what you need to win" (the
  outcomes left, played out). No competitor we found offers the last one; a series bracket is small enough to work it
  out exactly.
- **The World Series is the test, and it is late.** On 5 October the Wild Card round is over and the Division Series
  is under way, so a full bracket is closed. What a new pool can still run: series pick'em for the LCS (locks 11
  October) and the World Series (23 October), confidence over the teams left, World Series squares, a prop sheet and
  the question pack. Section 7 is the plan and its dates.
- **One decision first: MLB's data.** The MLB Stats API is the best free feed in sport, but its notice allows only
  "individual, non-commercial, non-bulk use" without MLBAM's written permission. Every pool type here can run with the
  host settling results (it already does for the question packs); the feed only automates it. Section 8 lays out the
  choices.

## 2. The pool types

Each type below: what people call it, how it works, the knobs organisers set, the data it needs, when it fits, and what
makes it good. The grid after them shows which fit which sport.

### 2.1 Bracket

**Names:** bracket challenge, playoff bracket, Tournament Challenge, Bracket Mayhem.
**How it works:** before the first round, pick every winner through to the champion. Points grow by round.
**Knobs:**
- Points per round: doubling (1-2-4-8; ESPN's March Madness 10-20-40-80-160-320), flat steps (2-4-6-8), or presets
  like PoolTracker's 1-3-6-9 and 5-10-25-50.
- Series length bonus for a best-of series (+3 or +5 for the right number of games, only with the right winner). The
  NHL's official game gives it in round 1 only; MLB.com's counts a series only when both are right.
- Upset or seed bonus: flat per round, or the seed difference times the round (Yahoo), or seed multiplied or added
  (The Second Season).
- Tiebreaker at entry: total runs in the last World Series game (MLB.com), goals in the Final, the championship
  score (ESPN sums the differences).
- Lock: the whole bracket at the first game, or per round with a second-chance bracket from a later round.
**Data:** the bracket's shape and seeds, series state, results.
**Fits:** the start of a playoff only (or a later round, as a second chance).
**Good:** a bracket drawn with your picks against what happened, max possible points, % picked per team, the
second-chance bracket (ESPN's from the Sweet 16) and "what you need".
**Pitfalls:** best-of-3 rounds are close to coin flips and break brackets in a week; MLB never re-seeds (1 plays the 4/5
winner, 2 the 3/6) while the NFL re-seeds every round; the NBA's play-in and the NCAA's First Four leave slots TBD;
the Champions League's ties are two legs on aggregate.

### 2.2 Series pick'em (round by round, with the length)

**Names:** series pick'em, "pick the winner in N", playoff pick'em.
**How it works:** before each round, pick each series' winner and how many games it goes. Later rounds are picked when
their matchups are known.
**Knobs:** points per round; the length bonus (only with the right winner); optional confidence weighting across a
round's series; lock at each series' Game 1 (better than one lock per round, since Game 1s fall on different days);
a missed pick scores zero or defaults to the higher seed.
**Data:** series matchups and state (wins each), the schedule.
**Fits:** any round, so a pool started mid-playoffs plays fully from its first round. The right first type for the
World Series test.
**Good:** each series as a card with the split of the pool's picks after it locks, the live series state, the
points still possible.

### 2.3 Confidence by team ("confidence wins")

**How it works:** rank every team left from N down to 1; each game a team wins earns its rank in points.
**Knobs:** rank the teams still alive (eight now), points per game won or per series won, multipliers by round.
**Data:** game winners only. The cheapest type to build: one drag-to-rank screen, and every game matters.
**Pitfall:** teams with a bye play fewer games; say so in the rules.

### 2.4 Weekly pick'em and confidence

**Names:** pick'em, Pigskin Pick'em, Pro Pick'em, Office Pool Manager; confidence pool.
**How it works:** pick the winner of every game (or a chosen few) each week; in a confidence pool also rank them N..1,
each value used once, and a right pick banks its value.
**Knobs:** straight up or against the spread (the line frozen at lock and stored with the pick); confidence on or off
(ESPN caps it at 10); a rolling lock per game or one weekly deadline; picks hidden until each lock; drop the worst
weeks (Yahoo up to 16); weekly and season tables; the tiebreaker (Monday night's total); a missed pick scores zero,
or takes the favourite, or the home side; late joiners start at zero, the lowest score, or the lowest less one.
**Data:** schedule, finals, a spread snapshot.
**Fits:** any week. The biggest recurring format (the NFL most of all; soccer matchweeks too).
**Good:** drag-to-rank that works on a phone, the pick split after lock, the weekly winner banner, points still
possible.

*Built 8 October 2026 (migration 170): the `pickem` kind on `fixtures`, Classic and Confidence, draws where the sport
has them (`sports.config.draws`), the round's name from the sport (`words.round`). Against the spread and a tiebreaker
wait for the NFL.*

### 2.5 Survivor (last one standing, eliminator)

**How it works:** pick one team a week to win; a loss puts you out; each team once. Built for soccer (migration 157),
where a draw is out too.
**Knobs:** lives or strikes (Yahoo counts a miss or a tie as a strike); buybacks in the first weeks; double-pick
weeks late in the season; a second-chance pool; the tie rule (Circa: a loss; ESPN: through; Yahoo: a strike); holiday
slates as their own week; the deadline (the round's first game, or each game); a loser pool; what happens when the
last ones go out together (share it, or roll back).
**Data:** schedule, results, byes.
**Fits:** the start of a season, or a "second-half survivor"; ESPN's March Madness Eliminator uses it on a tournament
(a team a day, two on the Elite 8 day).
**Good:** the alive count each week as a chart, the used-teams grid, a planner for the weeks ahead, the pick split.
**Popularity:** Circa Survivor 2026 drew 25,017 entries; ESPN, Yahoo and Splash all run one.

### 2.6 Squares

**How it works:** a 10×10 grid; people claim squares; the digits 0-9 are drawn for each side once the grid is full;
at each scoring point the last digit of each team's score names the winning square.
**Knobs:** when it pays (football by quarter, 20/20/20/40 is common; baseball after the 3rd, 6th and final, 25/25/50);
reverse-score squares; fresh digits each game or quarter; extra time counts in the final; a cap on squares each; what
happens to an unclaimed square. Baseball's runs cluster on 0 to 3, so a runs-plus-hits-plus-errors mode spreads them.
**Data:** score by period (the line score).
**Fits:** one game or one series: the World Series, the Super Bowl (about one American in five planned a bet or a pool
on Super Bowl LX), the Stanley Cup Final.
**Good:** pure luck, loved by people who don't follow the sport, the most shared pool there is. In Supercoins the
squares cost coins and the pot pays the winners, so it stays a pool, not a market.
**Pitfalls:** digits stay hidden until the grid is full, and the draw has to be seen to be fair (a recorded seed).
*On any NFL game, 9 October 2026 (migration 217):* a grid goes on one game of an NFL week too (Sunday night, Monday
night), not only a postseason series: the game stands in as a series of one (`_squares_series`, `_squares_fixtures`),
so the claims, the draw at kickoff, the board and the quarters' payouts are the same code, and `soccer_ingest` settles
the grids as the weekly feed lands. Offered through `pool_event_list`'s `game_grids`, picked in the same game picker as
the prop sheet; a level final is still the grid's last.

### 2.7 Player pool (draft, box or open)

**Names:** the hockey pool, playoff draft, box pool, playoff challenge.
**How it works:** pick players from the playoff rosters and score their playoff stats until their teams are out.
- **Draft:** a snake draft, each player owned once (10 F, 5 D, 2 G is typical; 1 a goal or an assist, 2 a goalie win,
  extra for a shutout).
- **Box:** players are grouped into evenly matched boxes and everyone takes one from each, so any number can play and
  nobody needs a draft night.
- **Open:** pick any players within the roster rules, duplicates allowed, "stack 'em" or "spread 'em" (one per club),
  optionally under a salary cap.
- **The NFL's Playoff Challenge:** a player's points multiply by the weeks he has stayed on your roster (up to 4x).
**Knobs:** roster by position, the selection method, the scoring table, bonus stats (game-winners, power-play goals),
one per club, a re-pick between rounds.
**Data:** playoff rosters, player box scores, series state (to shade the eliminated).
**Fits:** the start of a playoff. The Canadian NHL playoff pool is our home audience and nhl-sync already has the box
scores, so the NHL's April 2027 playoffs are its first run. *The box version runs on the regular season now (migration
188): a week, four weeks or the rest of it, from the next night with games, the boxes dealt by expected points in the
window; the playoffs' version adds the clubs going out.*
**Good:** "players left" for each owner, projected points left, elimination shading, goal alerts.
**Pitfall:** owners whose players go out early stop looking; a re-draft after round 1 or a second-half pool keeps them.

### 2.8 Score predictor

Call the score, built for soccer (migration 158): every match's score before kick-off; exact 3, the result 1, a banker
doubled. The knobs from Superbru and Sky's Super 6: points for the exact score, the goal difference and the result; a
joker match; a chosen few matches; the lock per match or per round; in a knockout, the score after 90 minutes. It
carries to any sport with a final score (the World Series game, the Super Bowl) as a single-game question.

### 2.9 Sweepstake (blind draw)

Everyone is dealt teams at random (two to five each for a 48-team World Cup), live, with a recorded seed; the champion
pays, often with a wooden spoon for the first team out. Baseball's versions: a draw per round scoring your team's runs,
or the "13-run" pool. No knowledge needed; the classic office format for tournaments.

### 2.10 Prop sheet, questions and futures

The questions we already run (the market, migrations 145-147): a sheet for one game (MVP, total runs, first to score,
a grand slam) or the season (the champion, the MVP, the Cy Young). A prop sheet can also be played as plain picks, a
point each or a confidence 10 to 1, for a group that doesn't want coins. Every pool can carry questions beside its
main game.

### 2.11 Also later

Season win totals (over or under on frozen preseason lines); best ball (draft once, the best lineup scores itself;
Underdog's Best Ball Mania VII took 672,336 entries); a daily streak game in the style of Beat the Streak (the
longest run in the group).

### 2.12 Which types fit which sport

✔ common, ✔✔ the sport's signature, ○ possible or niche.

| Pool type | MLB playoffs | NHL playoffs | NFL | NBA playoffs | Soccer | March Madness | Season-long |
|---|---|---|---|---|---|---|---|
| Bracket | ✔ | ✔ | ○ (re-seeds) | ✔ | ✔ (World Cup, UCL) | ✔✔ | |
| Series pick'em + length | ✔ | ✔ | | ✔ | ○ (two legs) | | |
| Confidence by team | ✔ | ✔ | ○ | ✔ | ○ | ○ | |
| Weekly pick'em | ○ | ○ | ✔✔ | ○ | ✔ | ○ | ✔ |
| Confidence (rank games) | ○ | ○ | ✔✔ | ○ | ○ | | ✔ |
| Survivor | ○ | ○ | ✔✔ | ○ | ✔ | ✔ (Eliminator) | ✔ |
| Squares | ✔ (World Series) | ○ | ✔✔ (Super Bowl, any week's game) | ○ | ○ | ○ | |
| Player pool | ✔ | ✔✔ | ✔ | ✔ | ○ | | ✔ (fantasy) |
| Score predictor | ○ | ○ | ○ | ○ | ✔✔ | | ✔ |
| Sweepstake | ✔ | ✔ | ○ | ○ | ✔✔ | ○ | |
| Questions and props | ✔ | ✔ | ✔✔ | ✔ | ✔ | ✔ | ✔ (futures) |

## 3. The engine: one shape for every type

Every type is a pick, a lock, a grader and a scoring profile. So:

- **`pool_games`** (league-scoped): a game inside a pool. `kind` (`questions`, `bracket`, `series`, `confidence_team`,
  `pickem`, `survivor`, `squares`, `player_pool`, `score`, `sweepstake`), the event it runs on (a competition and its
  round range, or one fixture), `rules` jsonb (the knobs, validated per kind by `_pool_game_rules(kind, rules)`), the
  lock policy, the tiebreaker question, status, and who started it. A pool has one or more; the pool's home shows each
  with its own table, and the host names the one whose winner wears the pool's crown.
- **`pool_picks`** (league-scoped): one row per member per pickable thing (a series, a fixture, a rank, a square, a
  player), `pick` jsonb shaped by the kind, `locked_at` taken from the thing's own lock, `points` written by the grader.
  Hidden from other members until it locks (the survivor's rule today).
- **Graders are triggers on results**, as the soccer pools are today (`fixtures` settles the survivor and the
  predictor): a final writes points for every pick it decides, a series ending decides a series pick, a period ending
  decides squares. Nothing polls. A host can settle by hand any game the feed doesn't cover, with the reason on the
  record (the question packs' rule).
- **Scoring profiles are presets with knobs**, stored in `rules`, shown as words. Classic, Office and the official
  game's rules for each type; any knob can be changed until the first lock and is frozen after.
- **The shared event tables grow, sport-neutral:** `competitions`, `clubs` and `fixtures` (migration 148) already carry
  a sport and a provider. Add `series` (competition, round, label, best of N, the two clubs and seeds, wins each,
  winner, state) and `fixture_periods` (a fixture's score by inning, quarter or period, for squares and the line
  score). The bracket is the `series` rows with their `feeds_into` links. MLB, the NFL and the NBA arrive as new
  providers on the same tables; the NHL keeps its own tables until the sport split moves it (`docs/EXPANSION.md` §6).
- **Expand, then contract:** `survivors` and `predictors` stay as they are and become `pool_games` of kind `survivor`
  and `score` in a later change, once the new tables carry the World Series test. *Done 9 October 2026 (migrations 203
  and 204): both are `pool_games` kinds now, the old tables copied across and left for a later drop.*
- **One scoreboard over every kind** (built 8 October 2026, migration 169). Whatever a game's rules, its table reads
  into one shape through `_pool_rows()`: per member, a `score` (highest first), `possible` (the most they can still
  finish with, or null), `alive` (still in, for elimination games; ranked first), a `tiebreak` (lowest first) and a
  `line` of detail. `pool_scoreboard()` ranks every game, leads with the pool's main game (the host's `pool_set_crown`,
  else the first open game) and adds each member's movement since the day began from `pool_standing`, which the hourly
  pool job keeps (and which tells a member who climbs into first, or three places or more). **To add a kind:** write its
  engine and board, then one branch in `_pool_rows()`; the table, the arrows, the climb alerts, the crown and the Table
  page come with it. The cross-game features in §6 (max possible, the elimination tracker, "what you need to win") are
  built on this shape, once, for every kind.
- **The learning loop:** the pool's pick split per series is a forecast; it goes in the prediction log
  (`docs/DEVELOPMENT.md` §4) and is scored when the series ends, so we learn how good a group's consensus is, sport by
  sport.

### Adding a kind of game: every place it touches

Written down from the bracket (migration 185), so the next kind (the player pool) misses nothing. A kind that lives on
`pool_games` threads through these; one with its own tables (survivor, predictor) needs its own engine and a branch in
`_pool_rows()` instead.

- **Database, one migration:** the `pool_games_kind_check` constraint; `_pool_game_rules` (its rule presets and
  defaults); `_pool_game_create` (what it is built on, and the check that the event can carry it); `_pool_game_table`
  (score, possible, right calls, picked, tiebreak); `pool_game_board` (what a member sees) and `pool_games_list` (the
  menu's "to pick"); `_pool_game_pick_as` (the shape of a pick, checked, and the host picking for a member);
  `_pool_game_locked` (when it locks); `_pool_game_nudge` (the reminders); `_pool_rows()` (its line on the pool's one
  table); `pool_event_list` (the kinds an event offers, so the start page and the host's desk show it);
  `pool_game_chances` (its chances to win, once it can have them, and the `pool_win` log comes with it).
- **Tests:** a section in `supabase/tests/flow.sql` that starts it, picks, locks, scores and reads the table, with a
  second league that can't see or touch it; `tenancy.sql` passes untouched if every new function checks its league.
- **Site:** `src/lib/poolGames.ts` (`GameKind`, `KINDS`); `src/lib/poolScoreboard.ts` (its board entry);
  `src/pages/Picks.tsx` (the board type, `ICON`, the render branch, the host's desk presets, `GameRules`, the table
  line, the subtitle); `src/pages/NewPool.tsx` and the host's desk (`HostGames`) where it is offered;
  `src/components/PoolTable.tsx` (`useChances`); a changelog entry; screenshots at 360 and 390 px, open and locked.
- **Docs:** this file (§2, §9), `docs/DEVELOPMENT.md` §6 and `docs/SUPERPOOLS.md`, in the same pull request.

## 4. Starting a sports pool

The start page (`#/new` and My pools) becomes three short steps, phone-first, in the pool's colour as it is chosen.

1. **What are you following?** The calendar of events open now, soonest first (`pool_pack_list()` grown into an event
   list): the World Series, the NFL season, the Premier League, the NHL season, Love Is Blind, or "something else"
   (questions on anything). An event card says what stage it is at ("Division Series under way · LCS starts 11 Oct").
2. **What kind of pool?** Cards for the kinds that fit the event today, each with a picture of the pick, one line on
   how it works, how long it takes a week, and when it locks: for the World Series now, "Pick the series" (most
   popular), "Rank the teams" (easiest), "World Series squares" (opens when the matchup is set), "Prop sheet" and "The
   questions". A kind that no longer fits says why ("the bracket closed when the Wild Card round started; pick the
   series instead"). The host can add more than one; the first is the pool's main game.
3. **How it scores.** A preset per kind, the knobs below it in plain words, and a live example built from a real
   series. Late-joiner rule, tie rule and tiebreaker are set here, before anyone picks, and shown on the pool's Rules
   page.

Then the name, the colour and the invite, as today. Every type reads the same way in the pool: a card per thing to
pick on Home ("2 series to pick before Saturday"), a Picks page, the Table, the sport centre, chat, and the alerts
(picks closing, a series ending, you moved up three places).

## 5. Sport centres

NHL centre is the model: Top, Scores, News, Injuries, Insiders, Standings, Leaders, Teams, Schedule. Each sport gets
the same home at `/sport/<sport>` (NHL centre keeps `/nhl`), drawn from the sport's row, with tabs that fit it:

| | Shows | Feed |
|---|---|---|
| MLB | scoreboard with the series state ("TB leads 1-0"), probable pitchers, line score by inning with R/H/E, the live count, outs and runners, box scores, win probability, the postseason bracket (standings in the season), injuries and IL moves | MLB Stats API (`schedule?hydrate=probablePitcher,linescore,seriesStatus`, `schedule/postseason/series`, `game/{pk}/feed/live`, `standings`, `transactions`), subject to §8 |
| NFL | the week's scoreboard, spread and total, score by quarter, box scores, standings, injuries, byes | ESPN's public site API (unofficial: no key, no terms of service for us, poll every 30-60 s and cache); a licensed feed once the NFL earns it |
| Soccer | fixtures and results by matchweek, live events, lineups, the table, the knockout bracket, injuries, odds | API-Football (already paid for: all endpoints on every plan) |
| NBA | scoreboard, box scores, play-by-play, the playoff bracket, injuries, odds | NBA's CDN feed (blocks cloud addresses), ESPN's site API, or a licensed feed |

Every centre carries the pool: a ribbon on each game ("3 of your pool need the Yankees; a Rays win puts you second"),
the pool's pick split on each series, and a tap from a game to the picks it decides. One edge function, `sport-hub`
(the `nhl-hub` pattern, cached in `hub_cache`), with an adapter per sport; the shared tables (§3) hold what the graders
need, and the centre reads the rest live and cached.

## 6. What makes a pool great (every type)

- A live table during games, with arrows and points tonight.
- Max possible points and an elimination tracker, so a broken bracket still has a reason to open the app.
- The pool's pick split, shown after each lock (never before: it would make the picks a copy).
- "What you need to win": the remaining outcomes played out. A series bracket has few enough (seven series of four to
  seven outcomes) to enumerate exactly; a pick'em or a player pool uses a simulation.
- Rolling locks per game or series; a late joiner plays from the next lock.
- Rules written down before the first lock (late joiners, ties, postponed games, the tiebreaker) and frozen after.
- Host tools: enter a pick for a guest, change a rule before the first lock, settle what the feed missed, with a record.
- Postponed and suspended games: a pick follows the game (`gamePk`), not the date; survivor's rule for a called-off
  game is set up front (through, today).
- Never money, never "bet now": an alert says what changed in your pool.

## 7. The World Series test (October 2026)

Where it stands (MLB Stats API and NBC Sports, evening of 5 October): Rays 1-0 Yankees, White Sox 1-0 Guardians (game 2
on), Brewers 2-0 Padres, Dodgers 1-1 Braves. The NLCS starts 11 October, the ALCS 12 October, the World Series
23 October (Game 7 on 31 October). Patrick's first World Series pool (league 4) was archived on 5 October so the new
start runs from the beginning.

| By | What | Type |
|---|---|---|
| 10 October | `pool_games` and `pool_picks`; `series` with the LCS and World Series rows; "Pick the series" (winner and length, points 2-4-8 by round, +2 for the length with the right winner, picks hidden until each Game 1, the split shown after); the three-step start for the World Series; the questions pack as a second game | series pick'em |
| 10 October | "Rank the teams" over the teams left, scored per game won | confidence by team |
| 11 October | The pool runs on the LCS: the series cards, the table, max possible points, alerts | |
| 22 October | World Series squares (a grid per game or one for the series, 3rd, 6th and final; coins in, the pot out; digits drawn when the grid is full). **Built 6 October, migration 167:** one grid per series, 10×10 or 5×5, one draw or fresh digits each game, the pot split over the games a series can run to | squares |
| 22 October | MLB centre, first version: today's games with the series state, the line score, probable pitchers, the bracket | sport centre |
| 23-31 October | The World Series: the series pick, the squares, the prop sheet per game; "what you need to win" from the World Series' outcomes | |

Who plays: Patrick's World Series pool, started fresh through the new flow, plus anyone he invites. What we learn:
which kinds hosts pick, how many members pick every round, whether squares bring in people who don't follow baseball,
and which knobs anyone touches. That goes to the Ideas board and into the NFL (December playoffs), the NHL playoffs
(April) and March Madness.

## 8. Decisions for Patrick

1. **MLB data.** *Decided 5 October 2026 (Patrick): the free feeds for personal use while we test (MLB's Stats API,
   ESPN's public endpoints), replaced by paid data once testing stops. Squares are in coins, and the World Series runs
   Pick the series, Rank the teams, Squares and the questions pack.* The choices were:
   - **Host-settled for the test** (recommended for October): the host taps each series' winner and games, and each
     game's score by inning for squares; nothing to license, and the engine is the same. Series state is typed in by
     the host from the Picks page.
   - **The MLB Stats API** for automation: free and complete, but its notice allows only individual, non-commercial use
     without MLBAM's written authorisation, and the owner is litigious (C.B.C. v. MLBAM). Fine to test against in
     development; not the plan of record for a product.
   - **A licensed feed** before the 2027 season: API-Sports sells a baseball API on the same account as API-Football
     (to be priced and its postseason series checked), or SportsDataIO, Sportradar.
   *Done:* MLB's Stats API feeds the postseason (mlb-sync, migration 165); soccer reads ESPN's public scoreboard
   (soccer-sync, migration 168: the Premier League and MLS, rounds cut from the schedule since ESPN has none). The NFL
   on ESPN came with its first pool kind, pick'em (migration 171: its weeks are ESPN's own, the playoffs after them).
2. **Which kinds the World Series offers first.** Recommended: Pick the series (main game), Rank the teams, Squares
   (from the 22nd), the questions pack.
3. **Squares in coins.** Recommended: a square costs coins from the pool's balance and the pot pays the winners, so the
   pool keeps one currency. The alternative is squares for points only.

## 9. The order after the World Series

*Reviewed 8 October 2026.* Built so far: the engine (§3) with Pick the series, Rank the teams and squares, the
three-step start (§4), MLB centre (§5), and from §6 the live table, max possible, the elimination mark ("can't catch
first"), the pick split after each lock, rolling locks per series and the climb alerts (the scoreboard, migration 169).
From §6, 8 October: "what you need to win" for pick'em and Pick the series (migrations 175 and 176, the chance to win
on the Table; Rank the teams too, migration 182); the bracket on series (migration 185) and the rules written down on every game's page from its own settings ("The rules", fixed at the first
lock). The host's tools (a pick
for a guest, a rule changed before the first lock, a result the feed missed) landed 8 October (migration 172). The infrastructure order is in
`docs/DEVELOPMENT.md` §6; weekly pick'em comes first because it runs on any competition with fixtures, so the NFL (below)
and soccer share it.

1. The NFL: weekly pick'em and confidence and a second-half survivor (the season is in week 5; playoffs from
   January), on ESPN's site API for results and spreads until a licensed feed; NFL centre, first version. Pick'em
   (migration 170), the season's feed (171), the survivor on its weeks (173) and NFL centre's first version
   (`#/centre/nfl`, the same page as soccer's Match centre) are built.
2. Soccer on the same engine: the score predictor and the survivor move onto `pool_games`; the Champions League
   knockout bracket (February); soccer centre on API-Football.
3. Super Bowl squares and the prop sheet (February 2027). *Squares by the quarter built 9 October 2026 (migration 200):* a grid on
   any NFL playoff game pays after the 1st quarter, at the half, after the 3rd and on the final (20/20/20/40), drawn at
   kickoff, in football's words; hockey's pays by the period, from the Stanley Cup feed's score by period (`nhlPeriods`,
   migration 215). *The prop sheet built 9 October 2026 (migrations 208 and
   209), ready for the World Series:* a `props` game on one game of a postseason (baseball, football or hockey): eight
   calls in the sport's words (who wins, the total over or under the market's line or the sport's usual, the margin, who
   leads after the first period and at the halfway mark, the first period's scoring, extra time, a shutout or in
   football a side held to 10), a point each, the total as the tiebreak, locked at the start, all settled from the
   score and the score by period at the end of each feed run (`_props_tick`), so the host settles nothing. Offered on
   each game of a series still going in the next week (`pool_event_list`'s `sheets`), one sheet a game; a game the
   series didn't need ends its sheet with no winner. *On an NFL week too (migration 216):* ESPN's weekly scoreboard
   sends each game's quarters (`espnFixture`'s `periods`), `soccer_ingest` writes them and settles the sheets, and any
   NFL game in the next week takes a sheet ("Week 6: KC at JAX"), offered beside pick'em.
4. March Madness (March 2027): the bracket with a second chance and the Eliminator. *The bracket's feed built 9 October 2026
   (migration 201):* `ncaam-2027` fills from ESPN in mid-March, 63 slots in bracket order; the second chance and the
   Eliminator are still to come. *The second chance built 9 October 2026 (migration 211):* once a pool's bracket has
   locked, the host opens a "Second-chance bracket" from a later round (the Sweet 16, or any postseason's next round),
   a fresh bracket for everyone on the scoreboard beside the first. *The Eliminator, the same day (migration 212):* last
   one standing on a tournament of single games (March Madness, the NFL's playoffs as series): each game carries its
   round (`fixtures.gameweek`, from `sport_ingest`), so the survivor runs on it unchanged to the tournament's last round;
   the start page offers it beside the bracket.
5. The NHL playoffs (April 2027): the player pool (draft and box), the bracket with series length, series pick'em,
   confidence by team; NHL centre gains the bracket and the pool ribbon. *Ready 8 October 2026:* the feed (`nhl-post-2027`
   through mlb-sync, migration 191, tested on the 2026 playoffs), so Pick the series, the bracket from the first round and
   Rank the teams run on it the day the NHL draws its bracket; the box pool runs on the regular season (migrations 188
   to 196, with goal alerts and a morning line), and its playoffs version on the first round's clubs, dealt on each club's
   expected playoff games, is ready too (migration 202, 9 October 2026). A pool with a game on the playoffs gets the
   bracket centre (`#/sport/nhl`, "Stanley Cup playoffs") in its menu beside NHL centre.
6. The NBA playoffs (April 2027) on the same engine, once its feed is settled.
7. Later: win totals, best ball, the daily streak, the sweepstake for the 2027 Women's World Cup.

## 10. Sources

Brackets and pick'em: [ESPN 26.6M brackets](https://espnpressroom.com/us/press-releases/2026/03/26-6-million-brackets-espn-tournament-challenge-sets-new-record-for-fourth-consecutive-year/),
[ESPN 2026 features](http://espnpressroom.com/press-release/espn-tournament-challenge-returns-with-new-eliminator-game-deeper-app-integration-and-enhanced-tools-for-mens-and-womens-tournaments/),
[ESPN Eliminator](https://fantasy.espn.com/games/mens-tournament-challenge-eliminator-2026/howtoplay),
[ESPN second chance](https://fantasy.espn.com/games/mens-tournament-challenge-second-chance-bracket-2026/),
[Yahoo Bracket Mayhem scoring](https://help.yahoo.com/kb/SLN6654.html), [Yahoo Pro Pick'em](https://help.yahoo.com/kb/pro-football-pickem),
[Yahoo pick distribution](https://help.yahoo.com/kb/SLN7020.html), [CBS Office Pool Manager](https://www.cbssports.com/fantasy/games/football/office-pool-manager/),
[PoolTracker NHL pick'em](https://www.pooltracker.com/game_info/nhl_stanley_cup_playoffs_pickem.asp),
[NHL Bracket Challenge rules](https://bracketchallenge.nhl.com/en/rules), [NBA Pick'Em Bracket](https://www.nba.com/news/2026-nba-pick-em-bracket-challenge-is-now-live),
[MLB Bracket Challenge rules](https://secure.mlb.com/mlb/fantasy/bracket_challenge/rules.jsp), [The Second Season](https://thesecondseason.com/baseball-playoffs-challenge/),
[GIST MLB bracket rules](https://www.thegistsports.com/bracket-challenge/2026-mlb-postseason-bracket/rules/),
[UEFA bracket predictor](https://www.uefa.com/uefachampionsleague/news/0296-1d1c6c3a5af0-be1d5c454641-1000--champions-league-bracket-predictor-all-you-need-to-know).
Survivor and squares: [Circa Survivor 2026](https://news3lv.com/news/local/circa-sports-sets-record-387m-prize-pool-for-pro-football-contests),
[Yahoo Survival rules](https://help.yahoo.com/kb/SLN6555.html), [ESPN Eliminator Challenge](https://fantasy.espn.com/games/nfl-eliminator-challenge-2025/howtoplay),
[Splash format guide](https://intercom.help/splashsports-helpcenter/en/articles/15880619-splash-contest-format-guide),
[Last Man Standing rules](https://www.lastmanstandinghq.com/guides/beginners), [squares](https://www.superbowlsquares.org/how-to-play),
[MLB playoff pools](https://www.chooseasquare.com/mlb-playoff-pool), [Marist on Super Bowl LX](https://maristpoll.marist.edu/polls/super-bowl-lx-february-2026/).
Player pools: [OfficePools draft pool](https://www.officepools.com/help/article/hockey-draft-pool/), [box pool](https://www.officepools.com/help/article/hockey-box-pool/),
[OfficePools hockey](https://www2.officepools.com/fantasy-hockey/), [NFL Playoff Challenge](https://www.nfl.com/news/nfl-fantasy-playoff-challenge-a-beginner-s-guide-0ap3000000901908),
[Underdog Best Ball Mania VII](https://help.underdogsports.com/en/articles/14785343-best-ball-mania-vii).
Score predictors: [Superbru](https://www.superbru.com/premierleague_predictor/), [Sky Super 6](https://www.squawka.com/en/news/sky-bet-super-6/), [FIFA Match Predictor](https://play.fifa.com/match-predictor/).
MLB 2026: [postseason schedule](https://www.mlb.com/news/press-release-mlb-announces-2026-postseason-schedule), [2026 postseason](https://en.wikipedia.org/wiki/2026_Major_League_Baseball_postseason),
[NBC tracker](https://www.nbcsports.com/mlb/news/2026-mlb-playoffs-tracker-bracket-schedule-results-scores-matchups-for-al-nl-postseason-games),
[MLB copyright notice](http://gdx.mlb.com/components/copyright.txt). Feeds: [ESPN public API notes](https://github.com/pseudo-r/Public-ESPN-API),
[NBA live endpoints](https://github.com/swar/nba_api/blob/master/docs/nba_api/live/endpoints/boxscore.md), [API-Football](https://www.api-football.com/).
