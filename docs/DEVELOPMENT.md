# How we build Super Pools

The review of how the product is being built, and the working method that comes out of it. `docs/SUPERPOOLS.md`
is what we build and in what order; `docs/EXPANSION.md` is what has to change before more leagues and sports;
this is how we build it so that every week of work lands, stays landed and makes the product smarter.
Reviewed 3 October 2026, after migrations 81 to 85 (Super Pools B1 to B4).

## 1. Where we are

- One live league, SaK: eight GMs, used every night, on a React 19 + Supabase stack with edge functions, a
  scheduler and an LLM voice (Garry, on Grok, metered per feature and league).
- 85 migrations. Every rule is a SQL function behind row-level security, and every league table is bound to its
  league and checked by the tenancy guardrails on every test run.
- Phase 1 of the expansion plan is four blockers in: rosters, the draft, scoring and the scheduler are per
  league (B1 to B4). Left in Phase 1: B6 (money and the Fund) and the medium SQL items, then the shadow-league
  week that is the phase's gate.
- The flow test drives a whole season in SQL (1,750 lines): keepers, the draft, lineups, scoring, trades, bets,
  the Book, money, and a second league beside SaK that must never see or change it.

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

1. **Land B1 to B4.** Done 3 October 2026: migrations 81 to 94 live and verified, nhl-sync and Garry deployed, the
   site reads the league views (#81).
2. **The delivery pipeline.** Test workflow (done), direct database access (`SUPABASE_ACCESS_TOKEN` in the cloud
   environment, read by new sessions), function deploys from CI (the GitHub secret), no staging (decided).
3. **Start the shadow league** (Phase 1's gate): a copy of SaK's teams, running alongside for a week of real games
   while the next steps are built. It is the real proof that B1 to B4 hold. Built (migrations 92 and 93):
   `open_shadow_league(1, 'sak-shadow')` makes it (SaK's rules and profile, a team per GM team, the same rosters,
   active); `shadow_sync()` mirrors rosters and slots every minute; `shadow_report(league)` lays each day's points
   side by side with the difference, which must be zero from its first full day. Opened 3 October 2026 as league 2
   (`sak-shadow`); its first full day is 3 October.
4. **The prediction log**, small and early (migration 87, built): `predictions`, written each morning for every
   rostered player playing that night (`predict_tonight`) and scored the next morning on the league's own points
   (`score_predictions`), with `prediction_accuracy` by week and `book_calibration` (the Book's odds against what
   happened, read from the markets). Trades next (migration 102): every approved trade logs a `trade_value` per team,
   the rest-of-season points of the players coming in less those going out, scored at the end of the regular season
   on what they actually scored. Drafts and keepers next (migration 115): when a draft is done, each team's draft class
   (`draft_value`) and keepers (`keeper_value`) are forecast for the regular season the same way, and scored at its end
   on what those players scored. Garry's picks next (migration 123): every pick he hands a GM at the Book is a
   `garry_pick` (the chance its odds gave it, once per market and option), scored 1 or 0 when the market settles, so
   the Calibration page shows whether his picks come in more often than the prices say. Next kind: the auto-pilot's
   choices. The Calibration page
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
   linked to today's team by name. Next: imports write them.
7. **Phase 2, people can join** (under way: email sign-in with reset codes, invites, the join page and the switcher done
   3 October 2026, migrations 103 to 105; onboarding part 1, the Platform page, the readiness checklist, going live and
   the league identity editor, migration 106): league by host, realtime and presence
   per league, phones, Cloudflare Pages hosting (decided 3 October 2026), the Garry budget.
8. **Pool intelligence** once a few leagues are playing, then the horizons in `docs/MARKET.md`.

## 6. The working method

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
