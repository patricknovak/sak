# Claims vs product (4 November 2026)

The rebuilt marketing site (`landing/`, from `docs/MARKET-REVIEW-2026-11.md`) audited against `src/`, `supabase/`,
`worker/` and the live database. Copy that overreached was rewritten in the pull request that rebuilt the pages; what
needs real build work, or Patrick's yes, stays listed here.

## Status key

- **true**: the code delivers it today
- **partial**: true with a condition the page states, or true for one league or sport only
- **planned**: written as planned or expected on the page, not built or not billed

## Table (high-visibility claims)

| Claim | Where | Status | Note |
|---|---|---|---|
| Supercoins, never money; nothing to buy, nothing to cash out | Every hero, FAQs, meta | true | "Never money" once in every hero |
| Pools and fantasy leagues scored from box scores or settled by your host | Home sub | true | Feeds per sport (nhl-sync, soccer-sync, mlb-sync); hosts settle questions |
| The events open right now, each with its next lock | Home and sport boards | true | Read live from `pool_event_list()`; a sport page keeps to its sport, the always-on season if the list is empty |
| Built by the SaK Superleague, a keeper league since 2013, run on it every night of 2026-27 | Home, fantasy, sport pages | true | 13 seasons in the record; all 36 game nights of 2026-27 scored (market review, Addendum 3) |
| Twelve ways to play | Home kinds | partial | Seven open today; the series kinds with the playoffs, win totals before next season, each row says when |
| The box pool, live tonight; join with a name | Hockey pools | true | Box pool on `nhl-2026` (migration 188); guest seats (332) |
| Pick'em, last one standing, streaks on every NFL week; squares and prop sheets on any game | Football pools | true | Squares and props on NFL games only (migration 346) |
| Pick'em, last one standing and the daily streak on the NBA | Basketball pools | true | `nba-2026-27` night by night (274) |
| Exact scores, pick'em and last one standing on the Premier League, MLS, the WSL and the NWSL | Soccer pools | true | The NWSL goes dark after its final on 21 November |
| The pool's split shows after the lock, never before | Sport pages | true | Pick split written at kick-off (174) |
| Keepers, the draft room, live points at every puck drop, a league voice | Fantasy hockey | true | The founding league's every night |
| Rosters and past seasons from Yahoo, ESPN and Fantrax | Fantasy hockey | true | `commish_import_rosters` (256) and the history imports; named as sources only |
| Start your league, free, or we set it up with you | Fantasy hockey, home FAQ | true | A stranger starts it at `#/new?type=fantasy` (the join function's `fantasy` body, `_fantasy_start_new`, migration 347, PR #349, live); `#/start` (`request_league`, 112) is the set-it-up path |
| The voice's lineup calls: one swap and the points it gains; posts checked against the table | Home, fantasy | true | `garry/tonight.ts` and the number check; the nudge runs before puck drop, 4 pm ET since 1 November |
| The voice's posts shown are real | Home, fantasy | true | The 25 October morning column and the 3 November nudge, names changed and captioned so |
| Within 1.6 points on average across 2,252 scored calls; the Book within 1.1 points | Home, fantasy | partial | True on live as of 4 November; dated static copy until a public `proof_counts()` exists |
| Free for a friends-sized pool, for good; every feature free until billing ships | Pricing | true | Nothing is gated or billed today |
| Plans per pool in Canadian dollars; the founding rate, 30% under list while a pool renews | Pricing | planned | The numbers and the promise wait on Patrick's yes (the page's comment says so) |
| Call what happens next; the group's chance moves; your host settles it | Together, shows | true | Questions pools and packs (145, 251); the invite asks the first question (252, 255) |
| A call on every round table and the finale | Traitors | true | The pack closes 19 November 8 pm ET (249); the page turns to the questions pool after |
| Season 12 is expected in February; the pool opens when Netflix announces the season | Love Is Blind | planned | No announcement as of 4 November; the show's pattern, written as expected. From the reunion's air time (9 November 02:00Z) the pages say Season 11 ended with the reunion and never invite a call on its last question, which stays open in the database until 11 November 08:00Z |
| One email when your league can open | Fantasy waitlist | true | `#/privacy` says so since this change. The Season 12 reserve form was taken off `love-is-blind.html` on 4 November: commercial email under CASL needs a postal address on the form |
| A pool, filled in | Example pool | true | Every name and number made up, captioned as an illustration |
| Every club in four leagues read like a front office, no account; the data open at /api/fans | Fans | true | `worker/fans.ts`; the fans' voice is empty on live, so the page describes what a fan can add, not a crowd |

## Left for product (not copy)

1. ~~A stranger cannot start a fantasy league alone.~~ Done on `main` by PR #349 (migration 347): `#/new?type=fantasy`
   makes the account and the league in one go; `fantasy-hockey.html` and the home FAQ send strangers there.
2. ~~A fan account cannot start a pool.~~ Done 4 November 2026 (migration 349): `pool_start` takes any signed-in account,
   a name-only one under a hundred pools a day across all of them; the fan zones' header offers Start a pool signed in or
   not, and `#/new` tells a name-only host to keep the seat with an email (Keep your place).
3. The waitlist form lacks CASL consent columns and a mailing address (the Love Is Blind reserve form was removed for
   that reason on 4 November). Consent is written into
   `waitlist.note` as text; a `consent_at`, the wording consented to and the sender's mailing address in the email are
   needed before any message beyond the one promised.
4. ~~The founding-rate prices and the founding promise need Patrick's yes.~~ Decided 4 November 2026 on Patrick's word to
   settle the open items as recommended (docs/MARKET-REVIEW-2026-11.md, "Decided"): the ladder and the founding season stand
   as the pages state them, worded as planned until billing ships.
5. ~~The proof numbers are dated static copy.~~ Live 4 November 2026 (migration 350): `proof_counts()` answers the scored
   calls, the average miss, the share within two points and the game nights with a column, league 1 only, and `site.js`
   fills the `[data-proof]` spans on the home and fantasy-hockey (the page's own numbers stand if the read fails). The
   Book's line stays dated copy: its 1.1 points is a reading of `book_calibration`, not a count.
6. The voice's posts are shown with names changed, and stay so (decided 4 November 2026): the GMs are private people, and a
   changed name loses the page nothing.
7. No French yet (Law 25 and the Quebec market): the site, the privacy page and the app are English only.
8. ~~`/traitors` should redirect to `/together` after 20 November 2026.~~ Done in `site.js`: from 20 November 05:00Z the
   page replaces itself with `together.html`, keeping the query. A `_redirects` line can replace it once the date has passed.
9. A pick'em or last one standing fixes its last round when it starts (`_pickem_rules`, migration 294), so a pool on MLS or
   the NWSL started today plays the one round in the feed (MLS Decision Day, 7 November; the NWSL quarter-finals, 6 to 8
   November). Until `to_round` follows the feed as later rounds are filed, the pages sell each playoff round as it is set,
   never a pool "to MLS Cup" or "to the final".
10. ~~The Love Is Blind pack's last question closes 11 November 08:00Z.~~ Fixed live 4 November 2026 (migration 348): the
   pack's question and its three open copies close at the reunion, 9 November 02:00Z, as the question's rule says.

## Patrick hand-offs

- Law 25 (done 4 November 2026 except two lines): `#/privacy` names the US processors, the person in charge (the founder,
  by title), how long things are kept, the rights and the complaints line, and every place an account is made says the
  data is held in the United States; the Terms say 14 in Quebec. Still Patrick's: the legal name behind Super Pools and
  the governing-law sentence in the Terms, which wait on the legal entity and its province.
- A postal address before any email sign-up form beyond the fantasy waitlist (item 3).
- Check the outside dates the pages state (the Love Is Blind reunion, the NWSL dates, Survivor, the award nights, the
  PWHL opening, the Women's World Cup draw, The Traitors' next seasons) before the pages go live.
