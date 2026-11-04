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
| Bring your league: we set it up with you | Fantasy hockey | partial | A stranger asks through `#/start` (`request_league`, 112); nobody opens a league alone yet |
| The voice's lineup calls: one swap and the points it gains; posts checked against the table | Home, fantasy | true | `garry/tonight.ts` and the number check; the nudge runs before puck drop, 4 pm ET since 1 November |
| The voice's posts shown are real | Home, fantasy | true | The 25 October morning column and the 3 November nudge, names changed and captioned so |
| Within 1.6 points on average across 2,252 scored calls; the Book within 1.1 points | Home, fantasy | partial | True on live as of 4 November; dated static copy until a public `proof_counts()` exists |
| Free for a friends-sized pool, for good; every feature free until billing ships | Pricing | true | Nothing is gated or billed today |
| Plans per pool in Canadian dollars; the founding rate, 30% under list while a pool renews | Pricing | planned | The numbers and the promise wait on Patrick's yes (the page's comment says so) |
| Call what happens next; the group's chance moves; your host settles it | Together, shows | true | Questions pools and packs (145, 251); the invite asks the first question (252, 255) |
| A call on every round table and the finale | Traitors | true | The pack closes 19 November 8 pm ET (249); the page turns to the questions pool after |
| Season 12 is expected in February; the pool opens the day it is announced | Love Is Blind | planned | No announcement as of 4 November; the show's pattern, written as expected |
| One email when your league or the Season 12 pool opens | Fantasy waitlist, LIB reserve | true | `#/privacy` says so since this change; the reserve form's consent note names hello@superpoolsai.com |
| A pool, filled in | Example pool | true | Every name and number made up, captioned as an illustration |
| Every club in four leagues read like a front office, no account; the data open at /api/fans | Fans | true | `worker/fans.ts`; the fans' voice is empty on live, so the page describes what a fan can add, not a crowd |

## Left for product (not copy)

1. A stranger cannot start a fantasy league alone. `fantasy-hockey.html` sends them to the request form (`#/start`,
   `request_league`). `fantasy_start` exists but needs a signed-in account already seated in a pool ("Join a pool first"),
   and sign-up is closed, so the build is a self-serve account and league start in one flow.
2. A fan account cannot start a pool. `#/new` disables its button and `pool_start` (migration 153) refuses an account in
   `private.fan_people`; until it accepts one (and the details step asks a fan host for an email through `claim`), the
   fan zones lead back to the marketing site.
3. The reserve and waitlist forms lack CASL consent columns and a mailing address. Consent is written into
   `waitlist.note` as text; a `consent_at`, the wording consented to and the sender's mailing address in the email are
   needed before any message beyond the one promised.
4. The founding-rate prices and the founding promise need Patrick's yes before the pricing page is linked from anywhere
   a buyer would treat it as an offer.
5. The proof numbers are dated static copy. Until an anon-executable `proof_counts()` (aggregates only, no league or pool
   named, test accounts and the shadow league left out) is live and served through `/api/hub`, each figure carries its
   date and is moved by hand.
6. The voice's posts are shown with names changed. Asking the GMs' permission would let the pages use real names.
7. No French yet (Law 25 and the Quebec market): the site, the privacy page and the app are English only.
8. `/traitors` should redirect to `/together` after 20 November 2026 (a 301 for `/traitors` and `/traitors.html` in
   `landing/_redirects`, once the pack's finale questions have closed).

## Patrick hand-offs

- Yes or no on the founding-rate numbers and the founding promise on `pricing.html` (item 4).
- The GMs' permission if the voice's posts are to carry real names (item 6).
- The `/traitors` redirect on or after 20 November (item 8).
