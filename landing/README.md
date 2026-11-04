# Super Pools marketing site

Static, served by Cloudflare: the Worker `superpools-landing` (`wrangler.jsonc` here) serves this folder as static assets,
deployed by `.github/workflows/cloudflare.yml` on every push to `main`. It answers on `superpoolsai.com` and
`www.superpoolsai.com` through zone routes, which take the traffic while those DNS records are proxied (orange cloud).
`.assetsignore` keeps this file, the config, the share cards' sources and the retired World Series page off the site.
Brand, copy and positioning rules live in `docs/BRAND.md`; the product it describes in `docs/POOLS.md` and
`docs/SUPERPOOLS.md`; what each page claims, and whether it is true today, in `docs/CLAIMS-AUDIT-2026-11-04.md`.
The site was rebuilt on 4 November 2026 from the market review (`docs/MARKET-REVIEW-2026-11.md`).

## The pages

Every page is plain HTML on one design system. Each start button opens the app's start page on its event and kind
(`app.superpoolsai.com/#/new?...&src=<page>`), so the app knows which page a pool came from.

- `index.html`, the home, in ten sections: the hero (the tagline and its three lines, one gold button, the founding
  league in one line) beside the open-now board (`#now`, real events from the app's `pool_event_list()`, a rail on a
  phone); four doors by audience (fantasy, sports, shows in rose, fan zones); the three things we say, each with a drawn
  screen (the voice's post is the founding league's real morning column of 25 October 2026, the GMs' names changed and
  captioned so); every kind of pool, each link keeping its kind, with a page for each sport above the list; the try-it
  question (`#market`); game night as a room (`#feed`, `#clock`, the invite); the change log's latest four lines; the
  planned prices; the FAQ (mirrored word for word by the FAQPage JSON-LD in the head); the closer. Retired anchors
  (`#season`, `#ship`, `#join`...) are mapped to their new sections by `site.js`.
- `fantasy-hockey.html`, the commissioner's page: the honest first button (a stranger asks for a league through the
  app's `#/start`; nobody opens one alone yet), what comes over from Yahoo, ESPN and Fantrax, the season deadline to final
  night, the voice with a real lineup nudge (names changed), the founding league's record and the prediction log, and
  "Bring your league", the waitlist.
- `pricing.html`: per pool, never per person. The planned plans in Canadian dollars, the founding season, every row
  included or not, the rules that never change, and the buyer's questions. Every price on it is planned; nothing is
  billed today.
- `changelog.html`: every entry in the app's change log by month, with a sticky row of weeks and each entry a title that
  opens to its words (the latest week starts open).
- `hockey-pools.html`, `football-pools.html`, `basketball-pools.html` and `soccer-pools.html`, the sport pages, written by
  `python3 scripts/landing/gen_sports.py` from `scripts/landing/sports_content.py` (one template, so the head, header,
  footer and FAQPage JSON-LD stay the same on all four). Edit the content file and re-run the generator; never edit the
  four pages by hand. Each page's open-now board keeps to its sport (`#now data-sport`, nhl, nfl, nba or soccer; site.js
  does the filtering and counts the sport's events in `#now-tag`), and shows the sport's always-on season when the app's
  list has nothing for it.
- `together.html`, show pools for any group, in rose: what's on and what's next (every line dated), the drawn invite,
  the try-it question, women's sport with a pool on it.
- `traitors.html`: the Traitors pool while its pack has a question left, then the questions pool. Redirect it to
  `together.html` after 20 November 2026 (`docs/CLAIMS-AUDIT-2026-11-04.md`).
- `love-is-blind.html`: Season 11's last calls until the reunion airs (9 November 02:00Z), then "Season 11 ended with the
  reunion" and Season 12 by the show's pattern, with one line in place of a sign-up form (an email form for a later pool
  is commercial email under CASL and needs a postal address on it; Patrick supplies one before any such form returns).
- `example-pool.html`: a sample Love Is Blind pool filled in, every question, call and the table, captioned as an
  illustration.
- `fans.html`: the fan zones, every club read like a front office and open to every fan: the four leagues (NHL, NFL, NBA,
  Premier League, each into its page in the app) and the NHL's 32 clubs a division to a row, each logo into its zone in
  the app with `?src=fans` (the app's Worker carries the query into the app, `worker/fans.ts`). The marks are self-hosted
  in `img/clubs/` (96 by 64 WebP for a club, 68 by 68 for a league, each trimmed to what it draws), so the page depends on
  nothing at load; re-draw them from the leagues' own files if a club changes its mark.
- `world-series-pools.html` (18 October 2026) is off the site since 28 October 2026 (`.assetsignore`, `_redirects`) until a
  feed is licensed.

## What they share

- Every page is three landmarks on one 1140 px column: `<header class="site-head">` (the doors and the phone menu),
  `<main id="main">` (the skip link's target) and `<footer class="site-foot">`. Decorative icons carry
  `aria-hidden="true" focusable="false"`.

- `site.css`: the one design system. Its header lists its parts (tokens, base, type, buttons, the header and phone
  menu, the hero, the open-now board and rail, doors, three things, drawn screens, kinds, demos, change log, plans, FAQ,
  closer, sticky bar, footer, then the blocks the show and sport pages share). Gold is spent once per screen on the
  primary button (or one word), ice is for links, lines and live data, rose only on a show page or the any-group door.
  A page that wants the sticky bottom button adds `<div class="stickybar" id="sticky">` at the end of the body and marks
  its other gold elements `data-gold`.
- Three page files, each linked after `site.css` by its pages only: `site-sports.css` (the four sport pages: the proof
  band, soccer's competitions, the drawn sample pools), `site-commish.css` (fantasy-hockey and pricing: the draft board,
  the note for the group chat, the voice's schedule, the waitlist in the closer, the feature table) and `site-shows.css` (together, traitors,
  love-is-blind, example-pool and fans: the drawn question card, show tiles, the dated rows, Season 12's line, the
  example pool, the fan zones). Each file's header lists its sections.
- `site.js`: one script for every page; each part checks its element exists. Consented GA4 and Google Ads, first-touch
  UTM and the app-link decoration, the phone menu, the sticky bar, retired anchors, the reveal on scroll, the open-now
  board, the try-it question and the game-night demos (fictional, drawn in the page), the change log's latest lines, the
  Love Is Blind calendar, copy that follows the calendar, and the fantasy waitlist.
- `icons.svg`: the one-stroke icon sprite every page shares (`<svg class="ico"><use href="./icons.svg#i-bolt"/></svg>`).
- `fonts/`: Barlow Condensed (700, 900, 900 italic) and Inter (variable), self-hosted so a page depends on nothing at load.

## Copy that follows the calendar

A page says what is true on the day it is read, without a redeploy:

- `data-until="<ISO time>"`: the element is removed from that moment (site.js, on load).
- `data-from="<ISO time>"`: the element appears from that moment. `site.css` hides `[data-from]` until the script has
  checked it, so without the script a page reads as it did before the date.
- `LIB_STAGES` in `site.js`: Love Is Blind Season 11's dates (each drop at 3 am ET, and the reunion at 9 pm ET on 8
  November, which is the last stage: the pack's reunion question stays open in the database until 11 November 08:00Z,
  but the pages never invite that call once the reunion is on air). An element with `data-next` holds a template (`{next}` is what happens,
  `{date}` its Eastern date) that it fills once the premiere has aired; `data-done` takes over once the last stage has
  passed. When Season 12 is announced, write its pack, give `LIB_STAGES` the new dates and switch the page's hero with a
  `data-from` line (the comment at the top of `love-is-blind.html`).

Write both times in UTC (`2026-11-09T02:00:00Z`), and check the page on either side of each date.

## The change log

`changelog.json`, `changelog-latest.json` (the four newest, which the home's lines refresh from), `changelog.html` and the
home's four lines (between `<!-- changelog:start -->` and `<!-- changelog:end -->`) are written by
`node scripts/landing-changelog.mjs` from the app's `src/data/changelog.ts`. Run it whenever that file changes and commit
what it writes; never edit the four by hand. It warns on the brand's banned words and the sportsbook's (bet, stake,
wager, payout, market, push).

## Pictures and share cards

- `img/`: the phone screens. Pool screens come from a sample pool; SaK screens from the league's own site with every name
  changed (the anonymized fixtures). 600 px wide WebP; never a screen with a real GM's name or a cash prize.
- `icon.svg`: the mark (the faceoff dot) on its tile; also the favicon. `img/sak-icon.svg` is SaK's crest.
- The share cards, 1200 by 630: `og.png` (the home, the commissioner's, pricing, the sport pages and the change log),
  `og-together.png` (together, traitors and the example pool) and `og-love-is-blind.png`, each drawn from its `og*.html`.
  The fan page's card is drawn by the app's Worker (`/og/fans/NHL.png`). Re-bake a card after changing its HTML, with the
  pre-installed headless Chromium:

```
B=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
$B --no-sandbox --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=landing/og.png file://$PWD/landing/og.html
```

The same for `og-together` and `og-love-is-blind`. The pages point at fixed file names, so a network's cached card
refreshes on its own schedule.

## Routing

- `_redirects`: `/privacy` and `/terms` send visitors to the app's `#/privacy` and `#/terms` (the landing Worker has no
  legal pages of its own), `/fans/<club>` to the club's fan zone in the app, and the World Series page home.
- `sitemap.xml` and `robots.txt`: every served page, with its `lastmod` moved to the day it changed.
