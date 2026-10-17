# How we build Super Pools

The review of how the product is being built, and the working method that comes out of it. `docs/SUPERPOOLS.md`
is what we build and in what order; `docs/EXPANSION.md` is what has to change before more leagues and sports;
this is how we build it so that every week of work lands, stays landed and makes the product smarter.
Reviewed 3 October 2026, after migrations 81 to 85 (Super Pools B1 to B4); reviewed again 8 October 2026, after migration 169
(the pool scoreboard): section 6 is that review; and on 11 October 2026, after migration 243, with Cloudflare Workers
Paid subscribed: section 1 and section 8 are that review.

## 1. Where we are

*As of 15 October 2026, migration 307.*

- **SaK**, the live league: eight GMs, used every night, on React 19 + Supabase (Postgres rules, edge functions, a
  scheduler) and an LLM voice (Garry, on Grok, metered per feature and league), served from Cloudflare. The season is
  under way: My Team's Tonight card, Sit or start and the compare tools, Lineup New (folded into My Team on 11 October:
  Week, League, Compare and Insights tabs, What if and an undo), the live scoreboard, the weekly
  review, NHL centre (Watch live joined its Scores tab on 11 October) with radio, lines and the game Book, one game sheet on every page and one live clock (8.5). The lineup optimizer was rebuilt on 10 October (a
  player with a game always outranks an idle one) and players on no NHL roster drop out of the free agents.
- **The tenancy is done and proven.** Phase 1's gate is met: the shadow league (league 2) matched SaK to the hundredth,
  team by team, on every full day from 3 to 10 October (`shadow_report(2)`, eight days, no team off by a hundredth).
  Phase 2 (people can join) is built: email sign-in, invites, the switcher, onboarding, league by host, one account for
  every pool, and since 10 October a fantasy league anyone in a pool can start themselves (`fantasy_start`).
- **Super Pools is live as prediction pools for any group.** The questions engine (LMSR prices in coins), packs, and a
  sports-pool engine with eleven kinds (pick'em, the series, the bracket, last one standing, Call the score, the box
  pool, prop sheets, squares, rank the teams, the daily streak, the sweepstake) on shared event tables fed for the NFL,
  MLB, the NHL playoffs, soccer, the NBA and March Madness; one scoreboard over every kind, chances to win, the learning
  loop; a centre per sport with news, standings, injuries and leaders (10 October). The start page offers every kind.
- **Use so far is the founder's.** Four prediction pools besides SaK, one or two members each, one pick between them
  and no chat (section 9.2, 13 October). The Love Is Blind gate (three pools, thirty players by 4 November) is the first
  real test of the product with strangers; the premiere is 14 October, and the week's build for it is section 9.5.
- 307 migrations; the flow test drives a whole fantasy season and every pool kind in SQL, with a second league beside
  each that must never see or change it; CI runs it, the build and the Worker's types on every pull request.

## 2. What is working, and stays

1. **SaK is the proving ground.** Every feature is built on the league that uses it nightly, then generalised by
   `league_id`. Real GMs find what tests miss.
2. **A plan of record with gates.** Blockers are named, ordered and closed with proof; a phase ends on a gate
   that is true or not, never on a feeling.
3. **Guardrails as tests.** `tenancy.sql` fails the build when a table, view or function breaks the league
   boundary. Its reviewed lists are the debt register and only get shorter.
4. **Compatibility first.** A change keeps the old readers working while the new ones arrive (SaK's points
   stayed on `player_games.fpts` while every reader moved to `league_games`), and the new path is proven to
   reproduce the old numbers exactly before anything switches.
5. **Verify against live before replacing.** Before a migration replaces functions, their live text is
   fingerprinted (whitespace and comments stripped, md5) and compared with the repo, so nothing that only
   exists on live is overwritten.
6. **Costs are measured.** Every paid call is metered by feature and league, and a spike notifies the owner.

## 3. What slowed us down, and the fix

| Problem | What it cost | Fix |
|---|---|---|
| Database changes went through SQL files pasted by hand, because the Supabase connector held any statement with `drop` or `delete` for a confirmation a cloud session can't give. | B1 to B4 waited on a paste. PR #73 merged while its SQL wasn't live (harmless, no site change); PR #74 merged the same way and its site change read views that didn't exist yet, so the live player list failed until the #75 hotfix. | Direct database changes through `scripts/db.sh` (Supabase's Management API) with `SUPABASE_ACCESS_TOKEN` set in the cloud environment's settings: the connector's hold is its own and stayed on with the tools set to allowed. The connector stays for reads and hold-free SQL. Rule: a pull request merges only after its migration is live and verified. The paste file stays as the fallback. |
| Nothing ran the tests on a pull request; the only check was Vercel's landing preview. | A broken migration or build could reach `main`; the site deploys itself from `main`. | `.github/workflows/test.yml`: build, the stat parser and the whole database flow test on every pull request and push. |
| Edge functions were deployed by hand, full files pasted through the connector (with the `\u` escaping trap). | Slow, and a function could lag `main`. | `.github/workflows/functions.yml` deploys every function on merge once the `SUPABASE_ACCESS_TOKEN` secret is added in GitHub. Until then, the connector as before. |
| Production is the only database. | Every migration lands on the league people are using tonight. | Decided (Patrick, 3 October 2026): no staging project. SaK is the live test bed and the product grows around it; the safety comes from the release order, the flow test on every pull request, fingerprints before and checks after every migration, and the shadow league. |
| One 1,750-line flow test with shared session state. | Two false failures this week from a test still signed in as the north GM. | Each section ends signed out (`reset role` plus an empty `request.jwt.claim.sub`); the file splits by area as it is touched. |
| The plan's lists drift from what has landed. | Time spent re-reading what is done. | Update `docs/SUPERPOOLS.md` section 7 and `docs/EXPANSION.md` in the same pull request as the work. |

**Compatibility debt to retire** once Phase 1's gate is passed and the edge functions read the league views:
`player_games.fpts` and `players.proj / last_fp / rank` (SaK's numbers kept for old readers), `stat_corrections.old_fpts
/ new_fpts`, `fund.id` (the fund is keyed by league since migration 95), and, since migrations 203 and 204, the old
`survivors`, `survivor_picks`, `predictors` and `predictor_picks` tables (copied into `pool_games` and `pool_picks`, read by
nothing). Each holds data, so each goes on Patrick's yes. *Retired 12 October 2026 (the gate passed 11 October):* the
`*_before_*` function signatures, `survivor_start_before_end` and `run_auto_lineups` (migration 250: nothing called them),
and `src/data/history.ts` with its generator (the history lives in the database since migration 89).

## 4. The knowledge base: every league makes every league smarter

What sets Super Pools apart is not one feature; it is that the product learns. Every league that has ever played
on it, and every league imported with its history, should make the tools better for all of them. Three layers,
built in this order:

1. **League memory.** A league's past lives in the database, not in code: seasons, final standings, champions
   and last places, prizes, drafts, keepers, trades and transactions, by `league_id`. SaK's history moved out of
   code into the database (migration 89); imports (Yahoo, ESPN and Fantrax now; CBS by paste) bring a league's past with it. Garry,
   the trade and draft tools and the history pages read it. Every league starts with its own story.
2. **The prediction log.** Everything the product predicts is written down with its inputs and scored when the
   result is in: projections, lineup choices, trade grades, draft and keeper grades, the Book's odds, Garry's
   picks. Calibration (how far off, which way, for whom) shows on an operations page next to the costs, and the
   models are tuned from it. Started early it compounds: every night of the season not logged is lost.
3. **Pool intelligence.** Cross-league signals, aggregated and anonymous, read per scoring profile: where players
   go in drafts, what keepers are worth, the prices trades actually close at, which pickups paid off, how
   lineups are set. Each new league sharpens every league's valuations. A league can opt out; nothing is shown
   from fewer than five leagues; no league's own moves are ever visible to another.

Garry sits on top of all three: his memory per league exists today; he gains the league's history, the
results of his own past calls, and what the wider pool knows.

## 5. The order of work from here

**Reordered 4 October 2026 (Patrick): prediction pools and the Love Is Blind test come first, soccer next** (`docs/POOLS.md`,
`docs/SUPERPOOLS.md` P1 to P5). The engine lands as migration 145 with its two-league flow-test section; the Love Is
Blind pool opens before the 14 October premiere; soccer prediction pools follow on API-Football. **Added 5 October 2026 (Patrick): sports pools ask which kind of pool, and each sport gets a centre**
(`docs/POOL-TYPES.md`, `docs/SUPERPOOLS.md` P6 to P9). The World Series is the test: the pool-games engine with series
pick'em and rank the teams before the LCS (11 October), squares and MLB centre before the World Series (23 October);
squares landed 6 October (migration 167).
The items below
continue alongside: the shadow-league gate runs to 10 October, Cloudflare hosting finishes with the landing page.

1. **Land B1 to B4.** Done 3 October 2026: migrations 81 to 94 live and verified, nhl-sync and Garry deployed, the
   site reads the league views (#81).
2. **The delivery pipeline.** Test workflow (done), direct database access (`SUPABASE_ACCESS_TOKEN` in the cloud
   environment, read by new sessions), function deploys from CI (the GitHub secret), no staging (decided).
3. **Start the shadow league** (Phase 1's gate): a copy of SaK's teams, running alongside for a week of real games
   while the next steps are built. It is the real proof that B1 to B4 hold. Built (migrations 92 and 93):
   `open_shadow_league(1, 'sak-shadow')` makes it (SaK's rules and profile, a team per GM team, the same rosters,
   active); `shadow_sync()` mirrors rosters and slots every minute; `shadow_report(league)` lays each day's points
   side by side with the difference, which must be zero from its first full day. Opened 3 October 2026 as league 2
   (`sak-shadow`); its first full day is 3 October. *Day one held (checked 4 October):* all eight teams scored the same
   on 3 October in both leagues (225.10 points each side, no team off by a hundredth); the shadow's Garry posted only in
   its own chat, its costs were metered to league 2 ($0.0067 over 5 calls), and its notifications went to its own teams,
   which have no owners or phones, so no SaK GM heard anything. The gate needs a week of such days (to 10 October).
   *Six days held (checked 9 October):* every day from 3 to 8 October matched team by team, no team off by a hundredth
   (3 October now reads 226.10 on both sides after a stat correction); 9 October closes the week. *The gate is met
   (checked 11 October):* every full day from 3 to 10 October matched for all eight teams, a difference of 0.00 each
   day. The shadow league can be archived whenever Patrick says (its sync runs every minute until then).
4. **The prediction log**, small and early (migration 87, built): `predictions`, written each morning for every
   rostered player playing that night (`predict_tonight`) and scored the next morning on the league's own points
   (`score_predictions`), with `prediction_accuracy` by week and `book_calibration` (the Book's odds against what
   happened, read from the markets). Trades next (migration 102): every approved trade logs a `trade_value` per team,
   the rest-of-season points of the players coming in less those going out, scored at the end of the regular season
   on what they actually scored. Drafts and keepers next (migration 115): when a draft is done, each team's draft class
   (`draft_value`) and keepers (`keeper_value`) are forecast for the regular season the same way, and scored at its end
   on what those players scored. Garry's picks next (migration 123): every pick he hands a GM at the Book is a
   `garry_pick` (the chance its odds gave it, once per market and option), scored 1 or 0 when the market settles, so
   the Calibration page shows whether his picks come in more often than the prices say. The auto-pilot's choices next
   (migration 132): every lineup it sets is an `auto_lineup` call (its starters' expected points, the starters in
   `predictions.detail`), scored once the night is final on what they scored, void if the GM changed the lineup after
   it. Head-to-head win chances next (migration 137): each morning nhl-sync logs every points matchup's chance for its home side (`h2h_win`, the same forecast the site shows, now in `_shared/forecast.ts`), scored 1, 0 or a half when the week ends. The pickup advisor's suggestions next (migration 138): a pickup a GM makes from it logs the lineup points it promised (`pickup`, points leagues), scored when the stretch is over on what the new player scored in that lineup less what the dropped one scored (migration 139: a call needs the move itself in the transaction log, and both sides count the games that start after the call; migration 142: the drop is the one made with the add, and the advisor's promise leaves out tonight's games already under way). The Calibration page
   (`#/calibration`, platform admins, beside Costs) shows how far off the nightly calls run and which way, the Book's
   priced chances against how often they came in (with its Brier score), and what is still waiting on results.
5. **B6 money and the Fund**: money per league (migration 86), and both are options a league turns on (migration
   95, Patrick's call): `league_rules.features` holds `money` and `fund`; SaK has both, a new league neither; the
   ledger refuses lines in a league without money; the Fund is one per league with its own prices. Then the medium
   SQL items. Phase 1 done.
6. **League memory**: history into the database (part of B7) with SaK's past as the first import. Tables built
   (migration 89: `league_seasons`, `season_results`, `league_all_time_base` and the `league_all_time` view,
   `league_trophies`, `league_timeline`, `league_rule_text`), loaded with SaK's history from `history.ts`; the all-time
   table matches the site's to the cent. The site reads them (`useHistory()`, `src/lib/history.ts`): every page that
   showed SaK's past reads the caller's league's rows, and a league with no past shows none. Garry reads them as his
   record book (each season's champion and last place, titles by GM). A commissioner writes past seasons in from the
   League page (migration 114, `commish_set_season`, `commish_delete_season`), so a league that played elsewhere
   arrives with its champions and final tables. A season's final table can be pasted straight from Yahoo, ESPN, Fantrax,
   CBS or a spreadsheet (`src/lib/historyPaste.ts`, tested in `test:nhl`): the team, its GM and its points come through,
   linked to today's team by name. A league that played on Yahoo brings every season Yahoo kept in one go (the `history` task walks the league's renew chain; the commissioner ticks the seasons on the League page). ESPN (11 October) and Fantrax (12 October) the same way, from their public APIs in the browser; CBS needs a sign-in, so it stays on paste.
7. **Phase 2, people can join** (under way: email sign-in with reset codes, invites, the join page and the switcher done
   3 October 2026, migrations 103 to 105; onboarding part 1, the Platform page, the readiness checklist, going live and
   the league identity editor, migration 106; league by host, migration 107; realtime and presence per league; phones,
   migration 100; Garry's daily budget, migration 99). Cloudflare hosting (decided 3 October 2026, built as Workers): SaK live at
   `sak.superpoolsai.com` and the landing page on Cloudflare since 4 October; every address is served by Cloudflare; what
   is left of the move is retiring the GitHub Pages copy (EXPANSION B5 step 3). Workers Paid since 11 October: section 8.
8. **Pool intelligence** once a few leagues are playing, then the horizons in `docs/MARKET.md`. The order from here is
   section 8.4.

## 6. The pool infrastructure, in order (8 October 2026 review)

What is built gives every pool one shape: a game has a kind, an event and rules (`pool_games`), picks hidden until
they lock (`pool_picks`), results graded on read from the shared event tables, and one scoreboard over every kind
(`_pool_rows()`, the arrows, the climb alerts, the main game). What a pool still can't do, and the order to build it:

1. **Weekly pick'em on the engine.** A fixture kind: each round's matches, pick the winner (a draw where the sport
   has one), optional confidence points, each pick locking at its own kick-off, graded on read from `fixtures`. It runs
   on any competition with fixtures, so soccer has it today and the NFL the day its feed lands; it is the first kind
   built on fixtures rather than series, and the shape the survivor and Call the score move onto (item 4).
   *Built 8 October 2026 (migration 170):* the `pickem` kind, Classic or Confidence, on the Premier League and MLS today;
   the start page and the host's desk read `pool_event_list()` (the postseason events plus every competition with
   rounds); a round's end tells the pool who won it and each picker how they did; the scoreboard reads it as it reads
   every kind. A kind the site doesn't know yet reads plainly instead of breaking the page.
2. **The NFL on ESPN.** The `nfl` sports row, its competition, the ESPN scoreboard adapter (soccer-sync's, by sport),
   weekly rounds; pick'em and a second-half survivor on it; NFL centre's first version later.
   *Built 8 October 2026 (migration 171):* the `nfl` sports row (no draws, its rounds are Weeks) and the NFL's 2026 season
   on ESPN; soccer-sync reads ESPN by sport, the NFL week by week (weeks 1 to 18, the playoffs as 19 to 22 once their
   teams are set) through the same ingest and live task. Live with 272 games, weeks 1 to 4 final, so pick'em on the NFL
   starts from Week 5.
   *NFL centre and Match centre, first version, 8 October 2026 (site only):* `#/centre/<competition>` for any
   competition played in rounds: the round strip, every match with its score and the minute or quarter while it is on,
   your pick and the pool's split once it kicks off, and the table worked out from the results (points for soccer, the
   record for the NFL). In the More menu of a pool with a game on one. Odds came with migration 178. *Standings by
   division and conference, 9 October 2026 (migration 207):* a competition's groups are data on it
   (`competitions.detail.groups`, each with its parent and its clubs by short name, named by `group_word` and
   `parent_word`); the Table tab switches between the league, the conferences and the divisions (the NFL's eight
   divisions and two conferences, MLS's two conferences), each group's leader marked. *Box scores, the same day:*
   nhl-hub's `espn` task trims ESPN's public summary for one game (team stats, each side's passing, rushing and
   receiving leaders, every scoring play with the score after it; cached by the game's state), and each NFL game that
   has started opens its box score in NFL centre (`src/components/EspnBox.tsx`).
   *The survivor on the NFL, 8 October 2026 (migration 173):* last one standing runs on any competition played in
   rounds, in the sport's words (weeks and teams, a tie is out), to a last round (the competition's last known one, so
   an NFL survivor started now runs the regular season; whoever is still in then shares it). The start page and the
   host's Add a game offer it beside pick'em (`pool_event_list` kinds; `pool_game_start('survivor', ...)`), and the host
   can enter a member's pick (`survivor_host_pick`). Its reminders speak the sport too, with a last call before a
   round's final kick-off for anyone still without a pick, since the NFL's week opens on a Thursday (migration 179).
3. **The host's desk for every game.** Settle what the feed missed, pool by pool (an override on a result, never a
   change to the shared tables, with the reason on the record); enter a pick for a member who asked; change a rule
   until the first lock and freeze it after. Every pool type can then run with no feed at all.
   *Built 8 October 2026 (migration 172):* `pool_game_set_rules` (frozen at the first lock; a pick'em's scoring only
   before anyone picks), `pool_host_pick` (a pick'em round, a series pick or the ranking for a member, under their locks,
   and they hear it), `pool_result_set` (a pick'em match settled for the pool alone, in `pool_result_overrides` with the
   reason everyone sees; the round and the game end as if the feed had sent it). All on the commissioner's log. Picking for
   a member from the site covers series and the ranking too (8 October). *Every game on fixtures, the same day
   (migration 177):* last one standing and Call the score settle per pool from the pool's own result, the host's result
   can carry a score, and `pool_fixture_result_set` settles a match for every game the pool runs on it (Settle by hand
   on the Survivor and Call the score pages). *A postseason game by hand, 9 October 2026 (migration 206):* a series is
   shared by every pool on it, so its fix is the platform's: `platform_game_fix` (the Platform page's Fix a game card,
   the last three days' games of every series competition) sets a game's score, state and score by period with a
   reason, marks it `fixtures.detail.by_hand`, and reruns the ingest's series step, so the series, every pool on it and
   the squares follow; `sport_ingest` leaves a game marked by hand alone until it is handed back.
4. **Contract the old kinds.** Last one standing and Call the score become `pool_games` kinds (`survivor`, `score`),
   their tables and pages read through the engine, the old tables retired once the numbers match. The engine's door is
   already shared (migration 173: `pool_game_start` and a new pool's games start a survivor); the tables are next.
   *Built 9 October 2026 (migrations 203 and 204):* a survivor is a `pool_games` row of kind 'survivor' (its first and
   last rounds in `rules`) with a `pool_picks` row per round ('gw:<n>': the club, its match and how it came out); Call the
   score is kind 'score' (`posted` holds the rounds the pool has heard) with a row per call ('f:<match>': the round, the
   score, the banker, its points). Every function reads them through `pool_survivors` / `pool_survivor_picks` and
   `pool_predictors` / `pool_predictor_picks`, views in the old tables' shape (the pick views for the functions only, so
   calls stay hidden until they lock), and the site's calls are unchanged. The old rows were copied across (one live
   survivor, league 6; it kept its id and its board reads the same) and the scoreboard keeps both on their own branch
   and page. The old tables stay, read by nothing, until Patrick says they can go (the debt list above).
5. **The learning loop.** Each lock writes the pool's pick split to the prediction log as a forecast, scored when
   the result is in, so we learn how good a group's consensus is, sport by sport.
   *Built for pick'em 8 October 2026 (migration 174):* at kick-off each pick'em match with three picks or more and one
   favourite writes `pool_split` (the favourite's share, made at kick-off), scored at the final whistle by the pool's
   own result (a host's ruling re-scores it); `crowd_calibration()` reads it by sport and split, every pool's for a
   platform admin, on the Calibration page ("The crowd"). Series picks and the survivor are next on the same log.
   *Series picks, 9 October 2026 (migration 205):* at a series' first game each Pick the series game on it writes
   `pool_split` (the club most of the pool picked and its share; three picks or more, no even split), scored when the
   series is over; the Calibration page counts them with the matches. *Prop calls, the same day (migration 210):* once a
   prop sheet's game starts, each call with three sheets or more and one favourite answer writes `pool_split` (subject
   the game and the call), scored on the call's answer when the game is final. *The survivor's picks, decided 9 October
   2026: not logged.* A survivor pick isn't a forecast of the game: each member picks the safest club they haven't used
   yet, so the share of a round's picks on a club measures what's left in everyone's hand, not how likely it is to win, and
   scoring it as a chance would mislead the Calibration page. Its picks stay on the scoreboard only.
   *The market beside it, the same day (migration 178):* soccer-sync keeps ESPN's pre-match lines on each match as the
   market's view (each side's chance with the margin out, the spread, the total; no bookmaker, no link), frozen at
   kick-off; the crowd's forecast records what the market gave its favourite, and Calibration shows the two side by side.
   The centres show it on each match. *Every chance on one page (migration 183):* `chance_calibration` buckets every
   probability the product gives (head-to-head wins, a pool's favourite, a member's chance to win) against what came in,
   per league, on Calibration ("Every chance").
6. **What you need to win.** The outcomes left, played out exactly where they are few (a bracket, a series round) and
   by simulation where they are many (a pick'em, a player pool), shown on the Table for each member.
   *Built for pick'em 8 October 2026 (migration 175):* `pool_game_chances` plays a pick'em out a thousand times from
   here (each undecided match drawn from the pool's own smoothed split, an unpicked match a guess; a long season's
   guesses drawn whole from their normal shape, about a third of a second for an NFL season), shown on the Table as
   "Chance to win" and on every row. The first look each day logs each member's chance (`pool_win`), scored when the
   game ends. *Pick the series, the same day (migration 176):* each series with its matchup set is played out exactly
   from where it stands (the chance of each winner and length from the pool's split, C(k-1, a-1) p^a (1-p)^(k-a)), a
   series not yet set or not yet picked a guess. A pick'em match with the market's line draws from it rather than the
   pool's split (migration 181). Rank the teams once its order locks (migration 182): every series drawn at even odds,
   the last round formed from the two winners before it. Brackets came with migration 186. *"What you need" in words, the same day (site only):* the top of each game's Table
   says how many can still catch the leader, how much a member has to make up and with what, or that first is out of
   reach or already theirs, from the game's own "still possible".
7. **The bracket and the player pool**, for the NHL playoffs and March Madness (`docs/POOL-TYPES.md` §9).
   *The bracket built 8 October 2026 (migration 185):* a `bracket` kind on `series`: every winner from a round to the
   final in one pick, checked round by round, locked at the round's first game; Classic doubles each round, Flat is a
   point a series; what's still possible counts picks whose club is still in; the final's runs break a tie. The tree is
   read from each round's order (`_bracket_tree`; `_bracket_ok` says where a bracket can start: every later round
   halves to a final of one). The site's picker goes round by round on a phone, clears later picks an earlier change
   broke, and shows right, wrong and everyone's champion once locked. Its chance to win once locked (migration 186: the
   tree played out round by round). *The NFL's playoffs as series (migration 187):* `competitions.format` ('rounds' or
   'series'); `nfl-post-2026`, which soccer-sync fills through `espnPlayoffPayload` (each playoff game a best-of-1
   series, the AFC's before the NFC's, the Pro Bowl left out; tested on last season's playoffs), so the bracket runs from
   the Divisional round. The same change keeps the Pro Bowl out of the season's weeks. *March Madness, built 9 October 2026
   (migration 201):* ESPN's men's scoreboard (`basketball/mens-college-basketball`, `groups=100`, by date)
   names each game's region and round in its note ("... - East Region - 1st Round") and each team's seed in
   `curatedRank.current`; within a region the first round goes in the bracket's seed order (1-16, 8-9, 5-12, 4-13,
   6-11, 3-14, 7-10, 2-15), so the tree is right through the Elite Eight. The Final Four's pairing of regions isn't in
   ESPN's feed until those games are drawn, so it goes on the competition when the field is announced (`competitions.detail.regions`
   in Final Four order, set on the Platform page's Tournaments card through `platform_set_regions`; until then the Final
   Four games pair them once drawn, else alphabetically) and the adapter (`espnTournamentPayload`) orders the regions by
   it. Every one of the 63 slots exists from the start (later rounds to be decided), so the bracket opens on the first
   round. soccer-sync fetches the tournament day by day from 12 March to 10 April only (`ncaam-2027`, sport `ncaab`);
   tested on the 2026 tournament, every result as ESPN had it and the tree exact. Its tiebreaker runs to 300 points. The First Four are
   left out: a first-round slot whose team is still to be decided fills once that game is played, and the bracket
   locks only once every first-round team is set (`_bracket_ok` already insists on it).
   *The Stanley Cup playoffs as series, built 8 October 2026 (migration 191):* mlb-sync, the postseason feed, reads the
   NHL's bracket (`/v1/playoff-bracket/<year>`) and each series' games for competitions with provider 'nhl-api'
   (`_shared/nhlPlayoffs.ts`). The NHL letters its series in bracket order, so the bracket runs from the first round.
   Tested on the 2026 playoffs (every series as the NHL had it); `nhl-post-2027` fills when the NHL draws its bracket,
   and the two-minute live cadence (`_mlb_due`) covers it. *In football's words (migration
   190):* the board sends the sport's words for the start of a game and its score, so the tiebreaker is the Super Bowl's
   total points (0 to 150; runs 0 to 60, goals 0 to 30) and the news says kickoff; a single game is picked on the winner
   alone, its length points riding with it. Each playoff game also carries its score by quarter (`fixture_periods`,
   overtime a fifth). *Squares by the quarter (migration 200, 9 October 2026):* a grid pays after each period its sport
   plays (`rules.pays` 'innings', 'quarters' or 'periods', or 'final'), and the chat, the ledger and the page say it in the
   sport's words (`_squares_moment`, the board's `words`); a single game drops its "Game 1".
   *The box pool built 8 October 2026 (migration 188):* the player pool without a draft night, on nhl-sync's own
   `games` and `player_games` (a competition of a third format, 'players': `nhl-2026`). The best players are dealt into
   boxes when the game starts, forwards, defence and goalies each ranked by the points they're expected to score in the
   pool's nights (their projection per game, times their club's games in the window, times the share they play), the
   hurt left out; Classic is ten boxes of six, Quick five of five; a week, four weeks or the rest of the season. One
   player a box, locked at the first puck drop; goals and assists count, a goalie's win 2 and a shutout 1 more, live; the
   hourly pool job names the winners the morning after the last night. The same change lets the host enter a bracket for
   a member (refused since 185). Still to come for it: the playoffs' version (clubs going out shaded, on the NHL
   playoffs' own event), a snake draft. *Its chance to win, the same day (migration 189):* once teams lock, the rest of
   the window played out a thousand times, each player's points in his club's games still to come drawn around his
   projection (a Poisson count as a rounded normal), the same draw for every member who took him.
   *Goal alerts (migration 192):* a member hears each goal a player on their team scores and each win their goalie gets,
   while the game is on (a trigger on `player_games` that returns at once when no box pool is open, and never blocks the
   write). *Still to come (migration 193):* each player's expected points in his club's games left in the window
   (`_box_rate`), shown while picking and, once locked, summed for each team.
   *The morning line (migration 194):* once a night's games are final, the pool's chat hears who had the night (with
   their best player's line) and who leads, once a night, from the hourly pool job.
   *In the prediction log (migration 197):* at the lock each team's expected points for the window (`box_points`),
   scored on the points made when the pool is done; the Calibration page can read it once there are pools to judge.
   *The next one (migration 198):* when a box pool is done the host hears it, with an invitation to deal the next.
   *Tonight (migration 199):* the board sends each player's next game in the window; once locked, the page leads with
   which of a member's players are on tonight, at what time or live with the score and their line.
   *The playoffs' version, built 9 October 2026 (migration 202, for April):* the same kind on a series competition of the NHL
   (`nhl-post-2027`): `_box_games` counts game type 3 as well as 2 (a regular-season window ends before the playoffs,
   so nothing changes for it); `_players_rules` takes the first round's clubs (`clubs.short` is the NHL abbreviation)
   and its first puck drop (the window runs to the Cup final), and deals the boxes on each club's expected playoff
   games (`nhl_teams.exp_po_games`, kept by nhl-sync's standings task) in place of the window's schedule;
   `_players_lock` falls back to the first round's `starts_at`; a player whose club lost a series is out (the board
   shades him); the games still to come for a club still in are the more of its scheduled games and its expected games
   (`_box_team_games`: games played plus, for a club still in, the more of its scheduled games and
   `exp_po_games`, which already counts the series as they stand; `to_come`, the chance to win and the forecast read
   it); it settles when the final series is final; `pool_event_list` offers it on an NHL series event before the first round starts; the site words the window
   as "all through the playoffs" and hides the window choice.

*Where 8 October left it (migrations 172 to 199, PR #243):* items 1 to 3 and 5 built, item 6 built for pick'em, Pick
the series and Rank the teams, item 7's bracket built on series and its box pool on the NHL season, item 4 begun (last one standing starts through the
engine's door). Beside them: NFL
centre and Match centre, the market's view on each match, results by hand for every game on fixtures, the rules
written down, last calls and second reminders. Next, in order: the box pool's playoffs version, then the contraction
(item 4). *9 October added* Super Bowl squares by the quarter (migration 200), March Madness (201), the box pool's
playoffs version (202), the contraction (203 and 204), series picks in the prediction log (205), a postseason game by hand (206), standings by division in the centres
(207), the prop sheet (208 and 209, docs/POOL-TYPES.md §9 item 3), prop calls in the prediction log (210) and the
second-chance bracket (211), NFL centre's box scores (nhl-hub) and the Eliminator (212), and the fixes from an
independent review of 200 to 212 (213 and 214: a sheet's calls are always the server's and a sheet has no rules to change;
`sport_ingest` runs squares and sheets in their own exception blocks so a pool game can never stop the feed; hockey grids
pay on the final and hockey gets no prop sheets until `_shared/nhlPlayoffs.ts` sends the score by period), PR #244.
*Hockey's periods, the same day (migration 215):* mlb-sync sends each Stanley Cup game's score by period, worked out
from the NHL's gamecenter landing (`nhlPeriods`: each period's goals from the running score, a scoreless period 0-0,
overtime a period, a shootout not; tested on the 2026 Cup Final), for the games on now or over in the last day and a
half, so hockey grids pay by the period again and prop sheets run on the Stanley Cup. *Prop sheets on an NFL week (migration 216):* the weekly
feed's quarters ride in with each game (`espnFixture` `periods`, written by `soccer_ingest`, which settles the sheets at
the end of each run in its own exception block), so a sheet goes on any NFL game in the next week. *Squares on an NFL
week's game (migration 217):* a grid's rules name a fixture as well as a series; the game reads as a series of one, so
every squares function is unchanged in shape, and `soccer_ingest` settles the grids after the sheets. *A sheet scores
live (migration 218):* `_props_answers` returns the calls the game has already decided while it is on (the final's
answers are unchanged), the sheet's table and board read them, and a locked sheet has a chance to win (item 6).
*Review fixes for 215 to 217 (migration 219, mlb-sync):* a second independent review found nothing severe; fixed: a grid
on a week's game put off waits for its new kickoff and one called off hands back what's left of the pot; a grid pays a
period only once the feed has sent it, so a game that lands final with no score by period pays its final alone (never
the 0-0 square); `nhlPeriods` sends nothing for a landing with no scoring summary and one bad landing no longer stops
the bracket's sync; the NFL's playoff weeks read as ESPN names them; the host's grid picker keeps series as chips beside
the week's games. *The NBA playoffs' feed (migration 220, soccer-sync):* `nba-post-2027` from ESPN's scoreboard,
seeds from its standings, fifteen series in bracket order from the first day (docs/POOL-TYPES.md §9 item 6); squares
on it pay by the quarter (migration 221) and its games take prop sheets (222). *Sheets on every game, automatically (migration 223):* the host's switch per
event (`pool_auto_sheets`), opened by the hourly pool job a day and a half before each game. *The pools in play on the
Platform page (migration 224):* `platform_pool_games()`, every live pool's sports games with how many have picked, for
watching a test like the World Series. *Review fixes for 218 to 223 (migration 225, soccer-sync):* a third
independent review found nothing severe; fixed: a grid on a game called off is marked done before it refunds (two runs
can't refund twice), one open sheet a game is a unique index, automatic sheets open only on a series' next game (never
an "if necessary" one), a live 1st-period call waits for that period's score, the NBA Finals' order never flips and a run
without the league's seeds sends nothing. The sport centres draw each sport's own line score (quarters, periods,
overtime; runs, hits and errors for baseball only). *Every prop sheet added up (migration 226):* a scoreboard row
per event once a pool has two sheets on it, the calls right across them, sheets won breaking a tie. *The bracket with
series length (migration 228):* a bonus for calling each series' games, `rules.games_bonus` and `pick.lengths`. *Review fixes for 224 to 228 (migration
229):* a fourth review found nothing severe; the live early and half calls wait for their periods' scores, a race on one
game's sheet reads plainly, an NFL week no longer defaults to a sheet on every game, and the games bonus shows only on
best-of-7 sports. *A nudge for the host (migration 230):* a pool that follows an event through its question pack but runs
no game on it hears, once a round, when the next round's matchups are set and it starts within two days (the hourly
pool job, `_pool_host_nudge`). *The daily streak (migrations 231 to 233):* a kind ('streak') on any event with games, one
winner a day, the longest run of right picks wins (docs/POOL-TYPES.md §9 item 7); a fifth review's fixes in 234 (games a series
didn't need, ties, a game put off, a game moved; the host's event nudge kept per event); the streak's split in the prediction log (235); the sweepstake
(236: the field dealt from the hat, whoever holds the champion wins); a sixth review's fixes in 237 (byes, unfiled rounds,
the deal round the pool, the crown, the streak's quiet week), and a seventh's in 238 (none severe); the host's event nudge names both new games (239).
Next for them: the World Series test (the sweepstake opens to the pool once both LCS matchups are set).

Alongside: the World Series test (the LCS from 11 October, the World Series from 23 October) needs its games started
in the World Series pool (league 5, the questions only so far), and the Love Is Blind test needs players.

## 7. The working method

- **Every change, in this order:** migration written; `npm run test:db` green locally; live state checked
  (fingerprints of the functions being replaced); migration applied to live and verified (fingerprints match the
  repo, the numbers SaK sees unchanged, Postgres logs clean); edge functions deployed; site change merged last.
  The pull request says which of those are done.
- **Every pull request is safe to merge the moment it is opened.** Code that needs SQL not yet live is not in it;
  it goes up in its own pull request once the SQL is live.
- **Expand, then contract.** Add the new path beside the old one, move the readers, prove the numbers match,
  and only then retire the old path in a later change.
- **Two-league proof.** Any league-facing change gets a flow-test section where SaK and the north both use it
  and neither sees the other.
- **Measure what the product claims.** A new prediction or grade writes to the prediction log; a new paid call
  meters its cost.
- **Keep the docs true in the same pull request** as the change: the plan, the blockers, CLAUDE.md.

## 8. The 11 October 2026 review: what is built, what sets it apart, and the edge

Two audits on 11 October: the plans against the code and the live database, and the architecture for cost, speed and
safety, with Cloudflare Workers Paid subscribed that day ($5 a month: 10 million requests and 30 million CPU-ms
included, Durable Objects with SQLite and WebSockets, Queues, KV, R2, Cron Triggers, Workers AI, Browser Rendering).

### 8.1 Built against the plan

- **Ahead of plan:** the sports-pool engine (eleven kinds where the plan named five), the sport centres (every sport's
  desk, built 10 October where the plan had MLB only), self-serve fantasy leagues (the plan said "later, with billing"),
  rotisserie, head-to-head, dues, co-commissioners, the constitution and the audit trail (MARKET.md's list of what the
  market had that we didn't is now built), the prediction log on every forecast the product makes.
- **Gates:** Phase 1's shadow-league gate is met (section 5 item 3). The World Series test is not met in the pool: the
  engine, the feed, MLB centre and squares are built, but the World Series pool (league 5) has no games; they are
  started from its Host page (Add a game), the LCS from 11 October. The Love Is Blind gate (4 November) needs players,
  not code.
- **Not started:** billing and tiers (Stripe), the account-level Supercoin wallet, CBS history
  import (Yahoo, ESPN, Fantrax and paste work), contracts, salary caps, prospects, guillotine and best ball, the app-store listing,
  per-pool usage telemetry, winter question packs (The Traitors, The Bachelor, award nights).
- **Stale in the docs, fixed in this review:** this section 1 (it read 8 October and 169 migrations); the shadow gate's
  result; the landing page's move (done 4 October); "Cloudflare Pages" where it is Workers; MARKET.md's "we are
  points-only"; BRAND.md's "the NHL is the only sport".

### 8.2 What sets it apart, and what still has to

Built and unlike anyone: one account for every kind of group game, fantasy and pools side by side; a league voice that
knows the league's history and talks in chat; prices that move like a market with no money in it; "what you need to
win" and chances on every table; the product grading its own forecasts in public; every sport's centre inside the pool.
What would make it unmistakable next, in order of what a new group feels first:

1. **The link is the product's front door.** A pool grows by a link in a group chat. Done 11 October: every invite and
   pool link unfurls with the pool's own name, host, colour and a picture drawn for it (section 8.3, E2).
2. **Live, together.** The night a game is on, the pool should feel like a room: who's watching, the swing of each
   call as it happens, a thread per game, "your pick just scored". Durable Objects (E4) are the tool: one live room per
   league or pool, pushed to every phone over a WebSocket, instead of every phone polling. Done 11 and 12 October: the live room on
   a league's and a pool's home, a thread for every game, and "your pick just scored" (a pool member's pick'em pick or
   last-one-standing club scores and a banner says so, from the pool room's own scores against the member's picks).
3. **The draft night that runs itself.** Done 11 October: the draft clock on a Durable Object alarm, an expired pick made
   on the second, picks fanned out in under a second, the 4-second poll standing down while the room is live (E4).
4. **A voice that's quick and cheap enough to say more.** Garry on an AI Gateway (E8): caching, a fallback model,
   per-league limits at the edge; small jobs (moments triage, memory notes) on Workers AI.
5. **Money through the door, never in the game.** Tiers and billing (SUPERPOOLS item 6) so a league or a host pays for
   more; Supercoins stay play money.

### 8.3 The edge plan (Cloudflare Workers Paid)

Postgres stays the source of truth: every rule, row-level security, Auth and the writing work (nhl-sync, soccer-sync,
mlb-sync, Garry, Yahoo, join) stay on Supabase. Cloudflare takes what is read by many and written by few, what must be
instant, and what must happen exactly on time. No D1 (it would split the source of truth); Hyperdrive only once a
Worker reads Postgres directly.

| # | What | Replaces | Status |
|---|---|---|---|
| E1 | `/api/hub`: the sports data every centre reads, cached at Cloudflare's edge with serve-stale-while-refreshing (worker/hub.ts) | every open page calling the nhl-hub function with its own token, uncachable | **Built 11 October** (a cached read in 7 ms against 1.2 s) |
| E2 | Link previews: `/j/<code>` and `/p/<web name>` pages with the pool's own tags, and a 1200×630 picture drawn per pool (satori and resvg in the Worker, cached a day at the edge; worker/preview.ts) | every pool's invite unfurling as "SAK Superleague" with a broken picture | **Built 11 October** |
| E3 | Hardening found by the review: every scheduled task needs the admin key (migration 243); Garry's league kept per request; the scores task writes only games that moved; polls stop when the page is hidden or nothing is live | open endpoints, a cross-league race, needless realtime churn | **Built 11 October** (PR #252) |
| E4 | A Durable Object per league or pool: the live room (presence, the night's swings, a thread per game), the draft clock on its alarm, fan-out over WebSockets | Supabase Realtime's per-subscriber checks, the 4-second draft poll, the 10-second `process-pending` job, the scoreboard's minute poll per phone | **Game nights built 11 October** (`worker/live.ts`, `src/lib/liveRoom.tsx`): a room per league per league day, joined from the app while a game is on. It reads the night (slate, frozen lineups, starters' box lines) once every 20 s for everyone, with a member's own sign-in (so it sees only what a GM sees, and needs no key of its own), works out the swings, keeps them for the night, and pushes changes; who's watching, reactions on a swing, and a goal alert for your starters anywhere in the app. The scoreboard reads from it and falls back to its own minute poll off the product's addresses. **The draft clock built 11 October** (`worker/draft.ts`, `src/lib/draftRoom.ts`): a draft room per league whose alarm is set to the pick's deadline and asks for the autopick (`draft_tick`, with a member's sign-in) the moment it passes, about 0.1 s after the clock runs out against up to 10 s on `process-pending`; every pick goes to every phone at once (the picking phone tells the room, and the room looks every 2 s besides, once for the league), and the store's 4-second draft poll stands down while the room is live. Both rooms share `worker/room.ts`. **A thread per game built 11 October** (`src/components/GameThread.tsx`): chat channel `game:<game id>` under the existing chat rules (no SQL), opened from the scoreboard's game chips and the room's game swings as the first tab of the game sheet, with the league's players in that game and the room's swings above the chat; the merged feed and the chat badge leave it out, the chips carry its count and unread dot, and the league voice answers there when named. **Pools' game nights built 11 October** (`worker/pool.ts`, `src/lib/poolRoom.ts`, `PoolRoomCard` on the pool's home): a room per prediction pool per day reads `pool_scoreboard()`, `pool_competitions()` and today's fixtures with a member's sign-in and pushes scores, starts, finals and members climbing the main game's table, with who's watching; the board reads again when the table moves. A box pool's games are the NHL's own (`games`, read beside the fixtures when the pool runs a `players` event). All three rooms share `worker/room.ts` and `npm run test:live` (40 checks). **A thread per game for pools built 11 October**: `game:fx<fixture id>` for a match on the shared fixtures (the box pool's NHL games keep `game:<game id>`), from the pool room's game chips and score swings, each pick'em match's Talk and the match centre's Thread, each with its count; same chat rules, no SQL. |
| E5 | One live snapshot per league at the edge (standings, tonight's points, the windows), refreshed by the scores run; first `player_windows` and `player_season` made materialized in Postgres | 6 to 10 reads a minute per open page on game night, aggregate views recomputed per page | **SQL half built 11 October** (migrations 244 and 245: `player_windows` and `player_season` read a per-profile cache, 135 ms to 8 ms, rebuilt by the scores run and a minute cron, live views whenever a stat has moved since; same numbers to the hundredth). **The edge half built 11 October** through the live room rather than a separate snapshot: each beat the room reads `stats_gen` (one row) and reads tonight's points for every player only when it has moved, once for the league, and pushes the lines that changed; the phones in the room take them into the store's `dayPoints` and skip their own reads (a clock moving alone reads no points, `npm run test:live`). Standings stay on the store's own read per box-score change |
| E6 | Push through a Queue with retries and batching (VAPID in the Worker) | a fire-and-forget pg_net call per notification | Later |
| E7 | Ingestion on Cron Triggers and Queues (per-game box-score jobs, retries, logs), writing through the API | pg_net calls with 55-second timeouts and no retry | Later |
| E8 | AI Gateway in front of xAI (Garry, the X feed); Workers AI for small jobs | direct calls | **Garry's side built 12 October**: with the function secret `AI_GATEWAY_URL` set to the gateway's Grok endpoint (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/grok`, plus `AI_GATEWAY_TOKEN` if the gateway is authenticated) every model call goes through it, tagged with its league, and falls back to xAI directly if the gateway fails; unset, nothing changes. Waiting on the gateway itself: the cloud environment's Cloudflare token has no AI Gateway permission, so Patrick creates it (AI › AI Gateway › Create, name `superpools`) and sets the secret. The X feed and Workers AI next |
| E9 | R2 for the promo videos and anything people upload (logos, avatars); `public/*.mp4` out of every deploy | 17 MB in each site deploy | Later |

### 8.4 The order from here (reset 13 October 2026, section 9)

1. **Love Is Blind, premiere 14 October: a pool worth coming back to every Wednesday.** The pack gets questions that
   close at each drop (21 and 28 October), not only at the premiere and the finale; a pack's new questions reach every
   pool already on it by themselves (the hourly pool job), with a line in the pool's chat; the pool's voice speaks on
   drop days (what settled, what's open, who's up, a last call). Patrick fills Pod Squad and two more pools with people
   he knows: the gate (three pools, thirty players by 4 November) is people, not code. *Built 13 October (section 9.5):
   the drop questions, the pack refresh, the morning post, the host's settle bell, the last call on the home, where
   everyone stands once calls lock, the drop's share card, the couple questions ready to ask, the landing page.*
2. **Measure the first week.** The GA4 funnel is wired; read it, and the per-pool counts (`mission_control_counts`),
   every Monday: pools started, links shared, joins, first calls, calls per member, chat messages. The numbers decide
   what's next, not the feature list.
3. **The voice in every pool** (item 1's drop-day voice generalised: the Traitors' episode nights, the World Series
   games, a soccer gameweek): a reason to open the app that isn't a push. *Built 13 October (section 9.5, migration
   264): the morning post reads the pool's own events too, the picks that lock before tomorrow with who's still to pick,
   and tonight's games; the chat knows the next three days.*
4. **Shorten the stranger's path** once the funnel shows where it leaks: today a link opens a preview (good), then four
   fields (name, email, password twice) before a first call. The first call before the account is the candidate. *Built
   13 October: the link's preview asks the first question (text thread and page), the answer is picked before the form,
   the password is asked once, and the call lands the moment they're in.*
5. **Billing and tiers** and the Supercoin wallet, once there are pools to bill (SUPERPOOLS items 7 and 11).
6. **The GitHub Pages copy retired** after a SaK GM checks push alerts and the installed app on `sak.superpoolsai.com`;
   imports' rosters (*done 13 October: Fantrax, ESPN and Yahoo, migration 256*); the app-store listing. The winter packs (The Bachelor when ABC names its lead) ride item 3.

### 8.5 One live clock, one game sheet, one lineup (11 October 2026, Patrick: "updates should be coordinated ... in the lowest cost way possible")

Before: the scoreboard read the games table (written once a minute), NHL centre read the NHL's feed through nhl-hub
every 30 seconds, and six pages polled tonight's points on their own minute timers, so the scoreboard and NHL centre
showed different scores on the same night and each phone read the night several times a minute.

Now there is one source per number, and every page reads it:

| Number | One source | How it moves | Cost |
|---|---|---|---|
| Score, period, clock, state | the `games` table | nhl-sync's clock task every 20 s while a game is on (`nhl-clock`, gated by `_clock_due()`, migrations 246 and 247), each changed row pushed by realtime and applied in place by the store | about 810 light function calls a game night (two NHL score feeds each); nothing on an off night; no client reads |
| Tonight's fantasy points | `league_games`, read into the store's `dayPoints` | read once each time a box score moves (realtime on `stats_gen`, migration 248), five-minute backstop | one read per change per phone, instead of six polls a minute per phone |
| Goals, clips, shots, broadcasters, box score | nhl-hub through the edge cache | NHL centre every minute while a game is on, the game sheet every 30 s, both edge-cached | one function call per refresh window per location |

NHL centre lays the store's score and clock over the feed (`src/lib/nhlGame.ts`), so its cards, its front tab, the
home card and the game sheet agree with the scoreboard to the second. Every NHL game opens in one sheet from any page
(`GameSheet`), which took in the scoreboard's box score and NHL centre's game page, and Watch live became NHL centre's
Scores tab. Lineup New was folded into My Team (Lineup, Week, Daily lineups, League, Compare, Insights, Stats). More and
the sidebar are grouped. The pools' table moves, share card and climbs came to the league's standings and live room.

## 9. The 13 October 2026 review: a week of building against the market

Patrick asked for a review of the last week against the pools market, the plan re-ordered by value, and the build to go
on from there.

### 9.1 What the week built (6 to 13 October, 221 commits on main)

Ahead of every plan on surface: the whole sports-pool engine (pick'em, last one standing, Call the score, the series,
the bracket, prop sheets, squares by the quarter, rank the teams, the daily streak, the sweepstake, the box pool) on
shared feeds for six sports; a centre per sport; share cards for every kind; the pool scoreboard with chances to win;
the live room (a Durable Object per league or pool: presence, swings, a thread per game, "your pick just scored"), the
draft clock on an alarm, one live clock and one game sheet in SaK; the home and navigation reworked; link previews with
a picture per pool; the edge cache; history imports from ESPN and Fantrax and Fantrax's scoring; the Traitors pack;
analytics with consent; the security and scheduled-task hardening; the compatibility debt retired; and Garry rebuilt so
every lineup call is a real move and every column is built on real stories (PR #262).

### 9.2 What the numbers say

Read from the live database on 13 October:

| | |
|---|---|
| Fantasy leagues in use | SaK: 8 GMs, 108 chat messages, lineups set nightly (the only live league) |
| Prediction pools open | 4 (Pod Squad, PLIC, PLC, a test Love Is Blind pool): 1 to 2 members each |
| Picks in every prediction pool, ever | 1 |
| Chat messages in every prediction pool, ever | 0 |
| Waitlist | 1 |

The product has a season's worth of surface and no second group. Everything built this week is ready for people who
have not arrived. The one real test on the calendar is tomorrow: Love Is Blind's premiere (14 October, 3 am ET on
Netflix) and the gate of three pools and thirty players by 4 November.

### 9.3 The market, re-read

- **Bracketology** is the incumbent for exactly this audience: a Love Is Blind fantasy league in an app (3.6 to 3.9
  stars; "won't load", scoring confusion, a cash "Pools" mode its own reviews resent), picks locking each week when
  the batch drops, scores "within 72 hours". It has no chat, no voice and no group memory. Our pack beat it on
  the premiere and the finale, and lost to it in between: four of its eight questions close at the premiere and four
  on 4 and 11 November, so a member had nothing to call on 21 or 28 October. Fixed in this review (section 8.4 item 1).
- **Splash absorbed RunYourPool and OfficeFootballPool** into one login, real money, a 10% take and a commissioner
  rewards programme; its October 2026 features are golf. Office pools stay where they were: spreadsheets, or sites
  that look like 2009, with premium tiers of $10 a year. Polymarket's newest feature is still group chat.
- **The position holds.** Nobody combines a phone-first pool, a chat with a voice in it, no money, and a group that
  keeps its history across seasons and shows. What the week proved is that the engine is there; what it did not prove
  is that a group of strangers will use it, because none has tried.

### 9.4 What was wrong, and what to do first

1. **The pack ran out of questions between drops.** A reality-show pool lives on Wednesdays. The pack gets questions
   per drop, written about what the show airs (no names needed before the cast is known), the way the Traitors pack
   already does per episode.
2. **A pack's new questions never reached an open pool.** `_pool_load_pack` adds only what a pool doesn't have, but
   nothing called it after the start: no job, no button. The hourly pool job now reloads every open pool's packs, and
   the pool's chat says what arrived.
3. **A prediction pool had no voice.** Garry's scheduled posts skip pools (rightly: no lineups, no slate). So a pool
   with no games is a quiet list of odds; nothing ever says "the premiere's questions settle tonight" or "you're up to
   second". The drop-day post is the pool's reason to open the app, and the one thing the incumbents don't have.
4. **The plan was ordered by what was fun to build.** Section 8.4 is re-ordered by what gets a second group through
   the door and keeps it: the premiere, the numbers, the voice, the stranger's path, then billing, then the rest.

### 9.5 What was built from this review

Built 13 October, live:

- **Migration 251:** the Love Is Blind pack gains four questions for each of its two middle drops (21 and 28 October),
  about what the show airs, no cast named; `_pool_pack_refresh` runs in the hourly pool job and gives every open pool
  its packs' new questions (a line in the chat, a bell per member). The test pool and Pod Squad got theirs the same hour.
- **The pool's morning (Garry, `daily` in a prediction pool):** posts only on a day something happened or is about to:
  a question settled (the answer, who called it), coins dropped, questions closing in the next day with an @ for each
  member who hasn't called, questions waiting on the host, new questions, the table when it moved. Previewed on the test
  pool and Pod Squad; the first live post is the morning of 13 October (the premiere's questions close that night).
- **Migration 252:** the invite link's preview carries the pool's next question, when it closes and how many are open,
  and the join page shows it above the sign-up as "First up", so a stranger sees the game before the form.
- **Migration 253:** `platform_week()`, the week's numbers for platform admins (pools started, people joined, calls
  made, chat messages, links made, the waitlist, each against all time; every league with its members, its week's calls
  and callers and messages, and when it was last alive, the quietest last), the "This week" card at the top of the
  Platform page. Section 8.4 item 2's Monday read.
- **Migration 254:** `_pool_settle_nudge` in the hourly pool job: eight hours after a question closes with no result,
  the host's bell says it waits on them (the questions folded into one line, each nudging once), with the link to call
  it. The host's nudges covered events only; the premiere's questions close at 3 am and the host settles that evening.
- **The drop day on the phone:** the pool's home says above the fold how many questions close today and how many still
  wait on the member's call, one tap from the first; once a question closes and until the host settles it, its page shows
  where everyone stands (every member's call, answer by answer, who sat it out), so the group watches knowing who said
  what. A first call from an invite lands in the pool just joined, whichever pool the tab was in before.
  The drop's share card (POOLS.md §6, share cards after every drop): on the Questions page's Settled tab for four days after
  a settle, the member's calls on it right or wrong with the score, drawn as the sheet card; the same card sits on the
  pool's home while the drop is fresh. The Ask sheet's One for each shape carries the couple questions ready to ask once the cast is
  known (POOLS.md §6's questions for each drop), one tap each with its rule. The Host page opens with What's next (what closes and when, what
  waits to be settled, the next drop, the couple questions), for a first-time host on a drop night. The host's invite card sits
  up top on the pool's home while fewer than four members are in.
- **Migration 256, rosters from Fantrax** (§8.4 item 6's imports' rosters): `commish_import_rosters` writes each team named
  whole, everyone on the bench (IR kept), refusing a team bigger than the league's roster by name and a player who is on
  a team not named; the Commish page's Roster section reads a league's rosters from Fantrax's public API, matches players
  by name and club (then last name, first initial and club), and lists what it couldn't match; the same sheet reads ESPN's
  rosters for a league made viewable to the public (checked against a stub of ESPN's shape: no public hockey league was
  found to read live); a Yahoo league's rosters come in from its page under My pools through the Yahoo function, no link
  to paste. One sheet (`RosterImport`), a reader per site.
- **The privacy note** (`#/privacy`, SUPERPOOLS item 14): what is kept, who sees it, the analytics choice, email and the
  voice, where it lives, how to leave or be deleted; from the consent banner and the landing's footer. The setup guide
  gains "Bring what you had" (seasons, scoring and rosters from Fantrax or ESPN) for a league that played elsewhere.
- **The landing's Love Is Blind page** (`landing/love-is-blind.html`, in the sitemap, linked from the show page): what a
  stranger searching for the pool this week lands on: every question by drop with its answers, the drop dates, three
  steps, the questions people ask, one start button. The landing's Love Is Blind copy follows the calendar (`LIB_STAGES` in
  `landing/site.js`): the countdown counts to whatever is next, and once the pods are open every line written for before
  the premiere says what's next instead (drop 2, drop 3, the weddings, the reunion), then that the season is in the books.
- **Migration 257:** the chat line a settle leaves names who called it, biggest call first, against how many called
  anything ("Called it: Priya, Sam (2 of 7)", or "Nobody called it"), so a drop night's settle is a moment in the chat.
- **Migration 258:** a pack question whose closing time moved later (the reunion's placeholder date, once Netflix names
  it) reaches every open copy that still closes earlier, with a line in the pool's chat; a copy the host moved later
  than the pack keeps its own time, and a closed copy is left alone. The pack is corrected once; every pool follows. **Migration 259:** a closing time the host set by hand is marked
  (`source.host_closes`, set by `pool_edit`) and the refresh leaves it alone, so a host who closes a question early isn't undone
  by the hour.
- **Migration 260:** the pool's questions join the prediction log (§4, the product learns): at settle, the answer the pool
  had priced highest at the close, its chance and whether it came in are written and scored at once (`pool_question`,
  the way the pick'em's split is `pool_split`), so the Calibration page can say how well a group reads a show
  (migration 261 counts the kind in `chance_calibration`; the page labels it).
- **Migration 262:** `platform_week` gains `first_calls` (members whose first call came within fifteen minutes of joining,
  this week and all time), the Monday read's number for the stranger's path; a tile on the Platform page.
- **Migration 263:** a pack's drop is one the pool has by its note: a date or amount the pack corrected moves the pool's
  copy while nobody has been paid it (matching on the date too would have paid a moved drop twice), a paid one stays.
- **The morning run includes the pools:** the first scheduled run (14:00 UTC, 13 October) listed fantasy leagues only,
  so Pod Squad got no post on the premiere's eve; `leaguesFor` now includes active prediction pools for the `daily`
  task (the other scheduled tasks still skip them). Deployed the same hour, and the day's post run by hand for Pod Squad
  and the test pool (the drop and the four questions closing at 3 am, the member with three calls left tagged, the eight
  new questions): the first live pool post.
- **Migration 264, the voice in every pool** (§8.4 item 3): `pool_ahead(hours)` is the pool's next day on its own
  events: the games about to be played (home, away, the series and game number) and every pick that locks in the
  window, kind by kind (the round still to be played for pick'em, last one standing and Call the score, the day for the
  streak, each series set and yet to start, the bracket's, the order's, the box pool's and the prop sheet's one lock),
  each with the members still to pick. The morning post now speaks on a game day as it does on a drop day: the lock
  (the round, when, each member still to pick tagged) and tonight's games on the pool's events, after what settled and
  before the questions; a pool with nothing of the kind stays quiet as before. The chat's facts carry the next three
  days, so "who hasn't picked?" and "what's on tonight?" get real answers. The pool's home reads it too (`usePoolAhead`):
  the hero's last call for the games, beside the questions', is the soonest lock before tomorrow (the round, the countdown,
  how many still to pick and whether the member is among them), one tap from the picks.
- **The pool's chat:** in a prediction pool Garry's replies read the pool's board (every open question with its prices
  and closing time, the asker's own calls, what settled lately and who called it) instead of the fantasy answer engine,
  which had an NHL slate to offer a Love Is Blind pool. The Questions page lists the group closing soonest first.
- **The join form** asks for a password once, with Show, instead of twice: a stranger's path is now the preview, the
  first call, three fields, the pool.
- **Migration 255, the first call before the account** (section 8.4 item 4): the invite's preview carries the first
  question's answers with the pool's chances; the join page shows them as chips, a stranger taps one, and the call (100
  coins) is placed the moment they're in, before the account's first page. If the question closed while they typed,
  they're in and the board is a tap away. The GA4 funnel's `first_call` fires with it.
- **The pool's voice, tuned on live previews:** the group chat's words (not a hockey league's), the drops and each
  member's calls left as sentences and counts it quotes as given, and the site's own how-to in its chat board (calling,
  the table, inviting, settling, asking), so it never improvises a tap that isn't there.
- **The pool's morning rings the bell:** each seated member gets the post's first line as a notification (and the push,
  where they allow it), since chat posts don't push and the post is the day's reason to open the pool.


### 9.6 Patrick's asks, 14 October 2026

Built for SaK and, as every SaK change is, for every league:

- **The live room is a league option** (migration 265): `features.live_room`, on unless the commissioner switches it off
  under League features; SaK has it off. Only the card goes (home page and scoreboard); the room keeps feeding tonight's
  points.
- **One chat with a filter**: the channel bar became a filter over one feed (a GM, a kind); the composer's To picks where
  a post goes; old channel links open the matching filter (`src/lib/chatFilter.ts`, `GmPicker`).
- **League transactions on the home page**: every add, drop and trade, the draft and the keepers on a tap, by GM and kind.
- **The roster against the free agents**: Players, Browse, "GM vs available" (one GM's players among every available one,
  in their colour); My Team, Stats, Compare, "Best available" (the best free agent at each of the roster's positions).

### 9.7 The premiere morning, 14 October 2026

- **The pool's morning post told Pod Squad something false**: that the premiere's questions "close tomorrow 3 am ET",
  four hours after they had closed, and it re-announced the day before's new questions (the voice had read its own
  eve-of-premiere post). Pool posts now stand on their facts alone (`write(..., { fresh, check })`), closed questions are
  told as closed and locked, what's new counts from the last morning post, and a check (every number in the facts, no
  closing or calls or locks the facts don't have) rewrites a bad draft once and then falls back to the plain line.
- **The league's posts get the same number check** (the morning column, the 5 pm nudge, the Monday column, the in-game
  moments), with the voice's memory and the league's right-now counted as known. It catches invented numbers, not wrong
  arithmetic, so the morning column's facts now carry the arithmetic: each GM's rank change ("Trystan up 2 spots, 7th to
  5th"), one line per GM who passed others with the count, and each race as who leads whom by how much. Dry runs on SaK
  read the spots, passes and gaps right where they had read "three spots" for two and turned a lead into a deficit.
- **The chat filter checked against SaK's 470 real messages**: the draft's picks no longer count as transactions; a
  test holds every kind (`chat-filter.test.mjs`).
- **The Monday read comes to Patrick** (§8.4 item 2, migrations 266 and 267): a bell each Monday with the week's
  pools, people, first calls, calls, messages and the busiest pool. **Migration 268** leaves test accounts' calls and
  chat out of the week, as it already left out their membership; **migration 269** counts a pool or league as started only
  when one real member is in it (the TEST pool had counted).
- **A pool's Monday** (§8.4 item 3): the weekly run now posts in prediction pools too (`poolWeekly`): what settled that
  week and who called it, the table with each gap, the members who made no call all week (tagged, to bring them back), and
  the week ahead day by day (coins dropping, questions closing, picks locking). Fresh facts and the same check; nothing to
  say, nothing posted. Dry runs on Pod Squad and the test pool read the drop and the four questions closing on 21 October.
- **What people open** (SUPERPOOLS item 14, migrations 270 and 271): a daily count per league and page of opens and of
  members who opened it, a member counted by a hash of their account, the day and the league (a new one every day, no
  name kept), from the site's layout once a page per session per day (`src/lib/usage.ts`, `usage_hit`); the commissioner
  switches it off under League features, a pool's host under Pool settings; platform admins read the last week on the
  Platform page (`platform_usage()`, "What people open"); members read only their league's counts. The privacy note says so.
- **The feed has the answer** (migration 272): a pack's question can name the series its answer comes from (`feed` on
  the pack's entry: a series' winner, whether a club wins it, how many games it went, which league the winner came from,
  whether a round reached a seventh game). Once the series is decided, each host of a pool where the question is still
  open gets one bell with the answer and a link to it; the host still calls it, so coins move only on a person's say.
  The World Series pack's seven series questions carry it, so the pennants and the seven-game question the SaK World
  Series pool waits on announce themselves when the Championship Series end. The host's settle panel shows the same
  answer with a button to settle it (`pool_feed_answer`, migration 273), and the host's "closed and waiting" card on the
  pool's home says when the feed has the answers and opens the first.
- **A gap told the right way round**: a dry run of the morning column on the merged build had Darin, last and 18.0
  behind seventh, "18 clear of the next guy". The league posts' check now holds every "N behind" in the table against
  the sentences that name the trailing GM or their team with that number: behind, back or trailing pass; clear, ahead or
  leads are rewritten. Deployed; dry runs read the table right. Loose comparisons ("roughly the same margin") still get
  through: the check reads numbers and directions, not how two numbers compare.
- **A dry run writes nothing**: the Monday column paid its Team of the Week bonus and rang the bell on every preview
  (`?dry=1`), so previews on 13 and 14 October put four extra 5-coin rows (204, 225, 226, 227) and four bells on SaK's
  team 1. The bonus, the bell, draft prep's bells and the in-game moments' state are now skipped on a dry run. Each power
  ranking row carries its own season line ("6th in the season, 0.3 behind Trystan (5th), 37.4 behind the leader Jason"),
  so a row never borrows another's gap.
- **The pool post hears the feed, and its check reads the pool's own words**: a waiting question whose series is decided
  is told as "the result is in (Los Angeles Dodgers) and the host settles it" (`pool_feed_answer`). The check counts a
  number the facts spell out ("go seven games") as known, lets "calls are locked" through (only a lock still to come needs
  one in the facts), and rejects "settled" when nothing has. Dry runs on Pod Squad and the World Series pool read true;
  one turned "Dodgers v Brewers" into "Dodgers at Brewers", the matchup's order the one slip left.
- **A new build reaches an app left open**: a GM's installed app ran the morning's build all afternoon on 14 October, so
  the day's changes (the page counts among them) never reached it. When the app comes back to the screen, at most every
  ten minutes, it compares its main script with the live page's and offers "A new version is ready · Reload" at the top
  (`src/lib/appUpdate.ts`); nothing reloads by itself, so a half-typed message is never lost.
- **What the first real week says** (7 to 14 October, test accounts left out): one pool started, one person joined,
  one first call inside fifteen minutes, ten calls (both in Trystan's pools), ten chat messages (all in SaK), no call from
  a real member in Pod Squad. All time: 3 real pools, 1 league, 8 people, 20 calls, 3 first calls. The gate (three pools,
  thirty players by 4 November) is people: the next drop is 21 October.

### 9.8 Overnight, 15 October 2026

- **The NHL and NBA regular seasons as pool events** (migrations 274 and 275): until now a pool played the NHL only as a
  box pool and the NBA only in its playoffs, so the sports a group follows every night had no pick'em, no last one
  standing and no daily streak. Each season is a competition in weeks (`nhl-2026-27`, "NHL 2026-27 games", and
  `nba-2026-27`) on ESPN's daily scoreboard: soccer-sync's nightly pull (`espnDaily`) files every regular-season game
  between the league's own clubs in its week, Monday to Sunday from the Monday of opening week (`detail.week1`). The
  first pull files the season whole (`?task=fixtures&competition=<id>&full=1`: 1,344 NHL games, an 84-game season, and
  1,200 NBA games, the Cup's knockout games to come once their teams are known); after that the next two weeks every
  day and the later days a seventh at a time. The live task already updates any ESPN game in its window. A competition
  carries its own round word (`detail.round_word`, read by `_round_word`), so the NBA's playoffs keep "Round"; the NHL
  sport row gains `draws: false` (overtime and the shootout always give a winner, and ESPN counts the shootout in the
  score) and ESPN's game states beside the NHL's own, which had filed a game not yet started as under way. The start
  page offers both with pick'em, last one standing and the daily streak; the centre is "NHL weeks" and "NBA centre"
  (`RoundCentre`, `centreName`).
- **Best ball** (SUPERPOOLS item 10, migrations 276 and 277): a league option (`features.bestball`, points leagues only,
  under League features). Nothing about scoring changes: once a night is over, the hourly `bestball` job re-slots every
  team's puck-drop snapshots for it to the best lineup in hindsight (`_best_lineup_slots`, the same solver as
  `lineup_efficiency`, returning the slots), so the standings, matchups, the Book and the voice read it as they always
  do. It redoes the last three nights each hour, so a stat correction re-picks the night, and never touches a night
  before it was switched on (`info.bestball_from`). Proved on live: the slots' total equals `lineup_efficiency`'s best
  for all 24 SaK team-nights of the last three nights. My Team says so on the Tonight card; Garry skips the lineup nudge
  and never calls a benched hat trick wasted in a best-ball league. SaK doesn't have it on.
- **The guillotine** (SUPERPOOLS item 10, migrations 278 and 279): a league option (`features.guillotine`, a points
  league played for the season total). Every Monday, once Sunday's games are final, the hourly `guillotine` job cuts the
  team still in with the fewest points that Monday-to-Sunday week (a tie goes against the lower season total; the first
  full week of the season is the first judged): `guillotine_cuts` keeps it, its players go to free agency as drops, its
  open trades are called off, the chat and every GM's bell hear it. A cut team can still watch, chat and bet; the eight
  roster and trade functions refuse it (`_not_cut()`, patched into the live definitions after their GM check, as the
  spectator guard was in migration 16; the live bodies matched the repo's before the patch). The home page's card shows
  the week so far, lowest first, and everyone cut; the last team standing wins. The standings (migration 280) rank the
  teams still in first, then the cut, the latest cut highest, so the payouts and the voice follow; a league with no cuts
  ranks by points as before (SaK's standings proved identical on live before and after). Switched on midweek, it judges the first full
  week after (migration 281, `info.guillotine_from`), and the home card says the week is a free one. Garry's morning and Monday columns lead with
  it in a guillotine league (`guillotineFacts`: teams left, the cut just made, every cut, who's on the block this week).
- **Review fixes** (migration 282, from a review of the night's diff): a player added or traded for after his game began
  gets a snapshot for that night written late, on the bench; best ball had counted him, so a free agent picked up the
  morning after a big night scored for it. A snapshot written more than ten minutes after its game began, for a player
  the team added or traded for after that (`_snapshot_late`), stays on the bench in best ball, and `lineup_efficiency`
  stops counting it as a missed start in every league (SaK's points and standings unchanged; the bench's "best" fell on
  the 8 nights a GM picked someone up after puck drop). In a best-ball league the guillotine, the Book and the side bets
  re-slot the nights before they read them. The guillotine switched on on a Monday judges that week; the start days are
  the server's to keep (an editor's stale copy of the league's info never moves them) and switching an option off
  forgets its day. Garry reads only his league's cuts, and nobody is "on the block" until the week has points.
- **Pick'em against the spread** (migration 283, docs/POOL-TYPES.md §2.4): the knob every NFL office pool asks for, on
  any sport without draws (the NFL, the NBA, the NHL's puck line). Switched on at the start or before anyone picks
  (`rules.ats`); each pick keeps the market's line from the moment it was saved while it stays on that side, so a moving
  line never changes a pick made; a side covering its own line is right and a push counts for nobody; the board shows
  each side's line in place of the market's chances, "Covered" or "Didn't cover" once it's over, and everyone's line in
  the pool's picks. Pick the favourites stays off in these pools, and the crowd's straight-up forecast leaves them out.
- **The pick'em tiebreaker** (migration 284): every round, the total in its last game (Monday night's in the NFL), until
  that game starts; level on points for the round, the closest takes it, and at the end the closest on the last round
  played wins the pool. No call, and a tie is shared as before. A card under the round on the board.
- **A missed pick takes the favourite** (migration 285): a pick'em option (`rules.missed`), off by default: when a game
  starts, every member with no pick on it gets the market's favourite, the lowest Confidence number still free, marked
  as picked for them; the crowd's split leaves those out. A switch on the start page, Add a game and the host's rules.
- **Review fixes to the spread and the tiebreaker** (migration 286, from a review of the night's pick'em diff): a
  tiebreaker call keeps the game it was called on (a Monday night game put off had scored every call against Sunday
  night's, and a game moved later re-opened it), and a game put off or voided leaves the tie shared; the host settling a
  spread game by hand gives the final score (`pool_result_set`'s `p_home`/`p_away`, kept in
  `pool_result_overrides.home/away`, the pair the survivor's settle by hand already writes, migration 287; the old
  four-argument signature dropped), so each pick is scored on its own line, and a game
  settled without one counts for nobody; a pick saved before any line is out takes the line at kick-off
  (`_pickem_close_lines`) instead of being kept at even. A push no longer counts as a miss on the share card. The host can
  enter a member's tiebreaker when asked (`pool_host_pick`, migration 289).
- **Lives in last one standing** (migration 288, docs/POOL-TYPES.md §2.5): Yahoo's and ESPN's strikes; a survivor starts
  with one, two or three lives (the start page and Add a game), a loss, tie or missed round costs one, and the page and
  the scoreboard show the hearts left. League 6's survivor scoreboard proved identical before and after.
- **Pick'em week by week** (migration 290, `pool_pickem_weeks`): every member's points in each round played, worked out
  on read from the same results as the table, and each finished round's winner (the closest tiebreaker breaking a tie);
  a grid under the pick'em table, latest round first, the winner's cell in gold and a crown for each round won.
- **Review fixes to missed picks, the spread and lives** (migration 291, from a second review): the pick'em desk's
  settle no longer wipes the score the host gave the same match in the match centre (Call the score kept its exact
  calls); the tiebreaker, its round and the board read the pool's own result and score, so a last game settled by hand
  decides a tie; the match centre's settle asks for the score when a spread pick'em is on the match (and offers a score
  box on the survivor page); a tie with its level score can be settled in a spread pool; a host settling a game the feed
  never started fills that pool's forgotten picks and lines first (`_pickem_override_fill`); the platform's week no
  longer counts picks the pool made for people as their calls; the survivor's last call tells a member with a life to
  spare that a missed round costs one.
  A third review (migration 292): the tiebreaker's total is the host's score when they gave one, else the feed's final
  (`_pool_total`), so a last game settled by hand without a score no longer shares every tie; the board's settle offers
  the score in every pick'em; the week-by-week grid shows a round once a game in it has a result and reloads on any
  point that moves.
- **A sports pool's invite shows its next game** (migration 293): a questions pool's link already asked its first
  question; a pick'em, last one standing or Call the score pool's showed only who invited you. `invite_preview` now
  carries the soonest game still to start (`next_game`, `next_game_line` like "Week 7: 15 games", `next_game_at`),
  drawn on the join page ("First up", when the first pick locks) and the link's text and picture (`worker/preview.ts`).
- **Drop the worst rounds in pick'em** (migration 294, Yahoo's knob): `rules.drop` 0 to 3 takes each member's lowest
  finished rounds off their points and what's still possible, once more rounds are finished than are dropped; the
  round's own winner is unchanged; the grid strikes them through. A choice on the start page, Add a game and the host's
  rules.
  A fourth review (migration 295): "still possible" takes off the lowest of each round's ceiling (it had taken the lowest
  finished rounds, marking a member who could still win as out of it), and the chances in such a pool play every run
  round by round and drop before naming its winner (`_pickem_chances_drop`); a round of only games called off is neither
  finished nor droppable; the last round's last game settled by hand without a score waits for a total before the pool
  is closed when tiebreaker calls are in; a last one standing or Call the score invite keeps to the game's own rounds.
  A fifth review (migration 296): a round of only games called off doesn't count against the ceiling or the drop in the
  table or the chances, and the last round waits for a total only when the leaders are level on points and one of them
  made a tiebreaker call; the ceilings are summed once per round rather than per game.
- **Season win totals** (migration 297, docs/POOL-TYPES.md §2.11): over or under on every NBA team's wins this season,
  called once before opening night (20 October). The lines start from ESPN's BPI preseason projection, to the half-win,
  and the host can set any before the opener; a call is decided the moment it can't change, so points land all season;
  everyone's calls and the pool's split on each line show once the season tips off, and the split goes to the
  prediction log. A choice on the start page and Add a game while a season with lines hasn't started. From a review
  before it went live: a called line stays put, the lock is kept once passed, the Cup final stays out of the season
  (soccer-sync), the host can settle a season game by hand (scores to 999, which an NBA spread pick'em needed too), and
  the records are worked out in one pass (the board in about 25 ms on a full season). Each member's chance to win
  (migration 298, `_wins_chances`): once the calls lock, every open line is played out a thousand times, the club's
  games left won at its rate so far pulled toward its line's by ten games' worth (`_wins_odds`, over and push). At the
  lock the pool hears how it split, once (migration 302): how many called, the surest call, the line that split it most.
  All season, each line decided is told in the pool's chat by the hourly job with how many called it (migration 303).
- **The NBA's questions** (migration 299): a pack for the 2026-27 season (the title, each conference, the NBA Cup, the
  best record and how many games it wins, MVP, Rookie and Defensive Player of the Year), the answers in the order
  DraftKings' futures on ESPN had them before opening night, coins on the first of each month; it rides the season
  (`competitions.pack`), so an NBA pool on the start page opens with its questions ticked, as a World Series pool does.
  The NHL's games, the Premier League and MLS carry their packs the same way (migration 300); the start page no longer
  lists those packs on their own, and a host who wants only the questions leaves the games unticked. The NFL's season
  carries one too (migration 304: the Super Bowl, each conference, the best record, MVP and Defensive Player of the Year).
- **Women's soccer on** (migration 305): the WSL (182 matches in 26 rounds, September to May) and the NWSL (its last
  matchweeks to 1 November; the playoffs come in as ESPN files them) were set up on ESPN's free feed with the rest of
  soccer and left off; on now, with pick'em, last one standing, Call the score and the daily streak, and the women's
  landing page says so. The Champions League and Liga MX are set up the same way and still off. The 2027 Women's World
  Cup gets a questions pack of its own (migration 306: the champion, Europe, how far Brazil go, the United States, the
  final), the contenders in alphabetical order as no market prices it yet, linked from the women's page.
- **The chances to win drew one number per run** (migration 307, found by a review): a random draw in a lateral
  subquery that names only the run is worked out once per run, so every match, series or line in a simulated run went
  the same way (every favourite won together, every open line went over together) and the members who leaned all one
  way took the credit. Since pick'em's chances (migration 175) every chance on a pick'em, Pick the series and Rank the
  teams table carried it, and the prediction log holds those numbers. Each draw now names its own match, series or line
  (30,000 draws, 30,000 values). Win totals' hourly run takes its game's row first, so two runs at once tell nothing
  twice; the surest call is the widest margin.
- **Review fixes to the night's site** (and migration 301): against the spread, a match the host settled shows the
  server's verdict on the pick's own line (it had shown the straight-up winner), a push no longer reads as a loss, and a
  game with no line out says the line is set at the start (the board sent a missing line as 0, "even"); the host's score
  by hand takes three digits; win totals' card after the opener reads "Calls locked", its line editor closes at the lock
  and says a called line stays, and the save bar no longer nags a member who called only some teams.
- **Pick the favourites** (pick'em, every sport): one tap fills every open, unpicked match with the side ESPN's line
  favours, the surest numbered highest in Confidence, nothing saved until Save; a round of more than twelve games reads
  day by day. An NHL or NBA week is about fifty games.
- **A landing page for NHL pools** (`landing/hockey-pools.html`, `/hockey-pools`, in the sitemap, linked from the home
  page's footer and quick starts): the daily streak, weekly pick'em, last one standing, the box pool and the fantasy
  league with best ball and the guillotine, each a link that opens the start page on the right event, and an FAQ that
  goes to search as structured data. The plan's gate is people; hockey is the ground the product knows best.

- **Landing pages for NFL and NBA pools** (`landing/football-pools.html`, `landing/basketball-pools.html`, in the
  sitemap, linked from the home page's quick starts and footer and from the hockey page): every kind each season runs,
  against the spread and the tiebreaker, an FAQ as structured data, and screens of a real pick'em board in a sample
  pool's colours (`landing/img/pool-nfl.webp`, `pool-nba.webp`). `#/new?comp=nfl&ats=1` opens the start page with
  against the spread on. On a phone under 400 px a pick'em card puts each crest above its name, so a long name
  ("Jacksonville Jaguars") wraps whole instead of splitting mid-word.
### 9.9 Off IR any time, 16 October 2026

Craig wanted to keep Gauthier (day-to-day) on IR until warm-ups and found the Daily lineups dropdown greyed for him.
Patrick's rule: a GM moves a player from IR to the bench or the lineup at any time, as long as the roster has room.
**Migration 309** frees the move off IR from the puck-drop lock (the other end of a swap too); the lineup that counts for
a game is still the one at puck drop, so a late activation scores from his next game. Nobody goes onto IR, or is swapped
out of a lineup, once his game has started. Daily lineups' IR dropdown now offers his spots and makes the move at once
(today, to the spot picked or the bench; a day ahead, to today's bench with the pick held for that day's save); My Team
lets a GM pick an IR player whose game is under way. The flow test covers both ends of the swap and the snapshot.

### 9.10 Live in the dock, a livelier scoreboard, a better chat, 16 October 2026

- **Live in the dock**: a fantasy league's dock has six places (Home, Lineup, Live, Chat, the sport's centre, More); Live is
  the scoreboard, with a red dot while a game is on.
- **The scoreboard tells the night**: your night (points, rank tonight, the gap to the team ahead, a projected finish from
  the starters still to play), the stars of the night, a ticker of each goal, assist, win and shutout by a rostered player
  the moment the box score moves (kept for the tab's session), a toast and an optional goal horn for your own starters, a
  line that just moved glowing with what it gained, each game's progress and how many league starters (and yours) it
  carries, and the season race as it would stand if the night ended now. All of it from the store's numbers: no new reads.
- **The chat's GM filter was broken twice over**: on a wide screen the GM list opened under the chat (the card's blur made
  its own layer), and on a phone a GM's view was mostly the voice's columns and league lines that named them (Craig: 8 of
  54). A GM's view is now their own side, with "and mentions" to add the rest.
- **Photos, search, sharing** (migration 310): photos up to 8 MB, shrunk on the phone, in a private bucket per league;
  search over every message you can see, opening the chat at the result; share any message or photo to Messages,
  WhatsApp and the rest; "is typing"; day separators; links that open; a "new messages" button; the chirp of the week.

### 9.11 The week's numbers, and the door from the league to the pools, 17 October 2026

The first measured week (10 to 17 October, `platform_week()` and `usage_daily`): SaK is the only league alive (8 GMs,
340 opens over four days, Home 102 and My Team 71), every other pool has one member, and no pool was started and no one
joined. My pools was opened once. The eight people who open the app every day had never been shown that it runs a pool
for their other groups. **Your other crews** (`OtherCrews` on a fantasy league's home): the pools you're already in, one
tap into each, and the best few events locking in the next ten days (one per sport, the hockey box pool first for the
NHL), each a tap into the start page with the event and its pool chosen (`#/new?comp=…&kind=…&src=league_home`, so the
funnel can tell these starts apart), and "anything else" for a questions pool. "Not now" puts it away for two weeks.
- **A pool, posted where the crew talks** (migration 311): from a pool's invite card, a member posts it into the chat of
  another league or pool they're in, as a card from their own seat there with a Join button (the join page's preview and
  first call) or Open for those already in, and a bell with its push to each of the others there (migration 312); once a
  day per chat; only `pool_announce` can write a card. Building it found
  that the pool's open link (`pool_share_link`, migration 162) could hand out a one-use invitation addressed to one
  person (migration 163), which no one else could use; it now skips them (no live pool had one yet). Your other crews
  lists the pools the league's GMs posted in its chat in the last month that you're not in, each a tap from joining.
  Review fixes (migration 314): a card never rings a mention or wakes the voice, a deleted card frees the day, two posts at
  once make one, the card's link has two weeks in it, and the bell says "shared" and skips those already in the pool.
- **A mention's bell opens the chat at the message** (migration 313): `/chat?m=<id>` instead of the top of the main room.
- **Review of the 16 October chat and scoreboard** (#280), fixed: a chat photo was readable by any member of its league,
  DM and private-line photos included; it now follows its message (migration 315, proven on live accounts). "And
  mentions" survives a change of kind; Load older stays after a jump; a shared link or bell opened before the league
  loads still lands on its message; a search result opens with the filters cleared; the goal horn reuses one sound
  engine woken by a tap (phones start a new one muted); a photo no phone can show (an iPhone's HEIC the browser can't
  read) is turned away with a plain message instead of going up broken; "is typing" survives a change of league with
  two chats open; the "new" count leaves out what the filter hides.
- **The night's goals on the scoreboard**: every goal a rostered player scored or set up, from the NHL's scores feed (one
  cached read for the slate, again each minute while a game is on), with each player's GM and what the goal was worth to
  them (the goal or the assist, plus the power-play or shorthanded point), newest first; full the moment the page opens
  and kept for a night in the books. The session ticker stays as the fallback when the feed is out. Each goal adds
  whichever power-play, shorthanded or points stats the league scores (a Fantrax import may score PPG rather than PPP).
- **Trade drops counted the database's way** (from the logs: six offers turned away in eight minutes on 17 October
  before one went through): the builder counted a hurt player arriving from another team's IR as active, while
  `_trade_active_after` slides him into an IR slot the deal leaves open, so the builder could ask for a drop the
  database then refused ("no drop needed"). One count now, `activeAfter` in `src/lib/tradeCount.ts` (tested in `test:nhl`), for the builder,
  the accept step and the grades. The builder says so when it happens: "X comes in hurt and goes straight to your open IR
  slot, so he doesn't count against your roster."
