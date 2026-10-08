# How we build Super Pools

The review of how the product is being built, and the working method that comes out of it. `docs/SUPERPOOLS.md`
is what we build and in what order; `docs/EXPANSION.md` is what has to change before more leagues and sports;
this is how we build it so that every week of work lands, stays landed and makes the product smarter.
Reviewed 3 October 2026, after migrations 81 to 85 (Super Pools B1 to B4); reviewed again 8 October 2026, after migration 169
(the pool scoreboard): section 1 and section 6 are that review.

## 1. Where we are

*As of 8 October 2026, migration 169.*

- **SaK**, the live league: eight GMs, used every night, on React 19 + Supabase with edge functions, a scheduler and
  an LLM voice (Garry, on Grok, metered per feature and league). The season is under way; Lineup New runs beside My
  Team for the league to compare, Watch live and the NHL centre's radio, lines and game Book are live.
- **The tenancy is done and proven.** Rosters, the draft, scoring, the scheduler, money and the Fund, phones and
  Garry are per league (Phase 1); people can join (email sign-in, invites, the switcher, onboarding, league by host,
  one account for every pool: Phase 2). The shadow league (league 2) has matched SaK to the hundredth on every full day
  since it opened (3 to 7 October); its gate closes on 10 October.
- **Super Pools is live as prediction pools.** The questions engine (LMSR prices in coins, drops, the crown), the Love
  Is Blind pool (Pod Squad, league 3), self-serve start with no account (`#/new`), the calendar of packs, share cards,
  alerts and person invites. On the sports side: shared event tables (`competitions`, `clubs`, `fixtures`, `series`,
  `fixture_periods`) fed by `soccer-sync` (ESPN for testing) and `mlb-sync` (MLB's Stats API for testing); last one
  standing and Call the score on soccer; the pool-games engine with Pick the series, Rank the teams and squares for the
  baseball postseason; MLB centre; and the scoreboard over every kind (migration 169).
- **Use so far is the founder's.** Four live pools, each with one or two members, nine calls in all; the Love Is Blind
  gate (three pools, thirty players by 4 November) is the first real test, and the premiere is 14 October.
- 169 migrations; the flow test drives a whole fantasy season and every pool kind in SQL (about 4,100 lines), with a
  second league beside each that must never see or change it; CI runs it on every pull request.

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
/ new_fpts`, the `*_before_*` function signatures renamed out of the way, `run_auto_lineups` (superseded by
nhl-sync's auto-pilot), `src/data/history.ts` (section 4; no page reads it now, only the generator script), `fund.id` (the
fund is keyed by league since migration 95).

## 4. The knowledge base: every league makes every league smarter

What sets Super Pools apart is not one feature; it is that the product learns. Every league that has ever played
on it, and every league imported with its history, should make the tools better for all of them. Three layers,
built in this order:

1. **League memory.** A league's past lives in the database, not in code: seasons, final standings, champions
   and last places, prizes, drafts, keepers, trades and transactions, by `league_id`. SaK's history moves out of
   `src/data/history.ts`; imports (Yahoo now, Fantrax, ESPN and CBS next) bring a league's past with it. Garry,
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
   linked to today's team by name. A league that played on Yahoo brings every season Yahoo kept in one go (the `history` task walks the league's renew chain; the commissioner ticks the seasons on the League page). Next: Fantrax, ESPN and CBS the same way.
7. **Phase 2, people can join** (under way: email sign-in with reset codes, invites, the join page and the switcher done
   3 October 2026, migrations 103 to 105; onboarding part 1, the Platform page, the readiness checklist, going live and
   the league identity editor, migration 106; league by host, migration 107; realtime and presence per league; phones,
   migration 100; Garry's daily budget, migration 99). Cloudflare hosting (decided 3 October 2026, built as Workers): SaK live at
   `sak.superpoolsai.com` on 4 October; the landing page moves with its redesign.
8. **Pool intelligence** once a few leagues are playing, then the horizons in `docs/MARKET.md`.

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
   record for the NFL). In the More menu of a pool with a game on one. Still to come: box scores, standings by
   division, odds.
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
   on the Survivor and Call the score pages). Still to come: settling a series or a grid by hand (the MLB feed has not
   needed it).
4. **Contract the old kinds.** Last one standing and Call the score become `pool_games` kinds (`survivor`, `score`),
   their tables and pages read through the engine, the old tables retired once the numbers match. The engine's door is
   already shared (migration 173: `pool_game_start` and a new pool's games start a survivor); the tables are next.
5. **The learning loop.** Each lock writes the pool's pick split to the prediction log as a forecast, scored when
   the result is in, so we learn how good a group's consensus is, sport by sport.
   *Built for pick'em 8 October 2026 (migration 174):* at kick-off each pick'em match with three picks or more and one
   favourite writes `pool_split` (the favourite's share, made at kick-off), scored at the final whistle by the pool's
   own result (a host's ruling re-scores it); `crowd_calibration()` reads it by sport and split, every pool's for a
   platform admin, on the Calibration page ("The crowd"). Series picks and the survivor are next on the same log.
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
   the last round formed from the two winners before it. Still to come: brackets, and "what you need" in words.
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
   the Divisional round. The same change keeps the Pro Bowl out of the season's weeks. *March Madness, worked out 8
   October 2026 (not built):* ESPN's men's scoreboard (`basketball/mens-college-basketball`, `groups=100`, by date)
   names each game's region and round in its note ("... - East Region - 1st Round") and each team's seed in
   `curatedRank.current`; within a region the first round goes in the bracket's seed order (1-16, 8-9, 5-12, 4-13,
   6-11, 3-14, 7-10, 2-15), so the tree is right through the Elite Eight. The Final Four's pairing of regions isn't in
   ESPN's feed until those games are drawn, so it goes on the competition when the field is announced (a `regions` list
   in Final Four order, entered on the Platform page) and the adapter orders the regions by it. The First Four are
   left out: a first-round slot whose team is still to be decided fills once that game is played, and the bracket
   locks only once every first-round team is set (`_bracket_ok` already insists on it).
   *The Stanley Cup playoffs as series, built 8 October 2026 (migration 191):* mlb-sync, the postseason feed, reads the
   NHL's bracket (`/v1/playoff-bracket/<year>`) and each series' games for competitions with provider 'nhl-api'
   (`_shared/nhlPlayoffs.ts`). The NHL letters its series in bracket order, so the bracket runs from the first round.
   Tested on the 2026 playoffs (every series as the NHL had it); `nhl-post-2027` fills when the NHL draws its bracket,
   and the two-minute live cadence (`_mlb_due`) covers it. *In football's words (migration
   190):* the board sends the sport's words for the start of a game and its score, so the tiebreaker is the Super Bowl's
   total points (0 to 150; runs 0 to 60, goals 0 to 30) and the news says kickoff; a single game is picked on the winner
   alone, its length points riding with it. Still to come: March Madness,
   whose bracket order wants ESPN's region and seed.
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

*Where 8 October left it (migrations 172 to 191, PR #243):* items 1 to 3 and 5 built, item 6 built for pick'em, Pick
the series and Rank the teams, item 7's bracket built on series and its box pool on the NHL season, item 4 begun (last one standing starts through the
engine's door). Beside them: NFL
centre and Match centre, the market's view on each match, results by hand for every game on fixtures, the rules
written down, last calls and second reminders. Next, in order: March Madness's bracket order, the box pool's
playoffs version, then the contraction (item 4).

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
