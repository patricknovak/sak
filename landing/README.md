# Super Pools landing page

Static, served by Cloudflare: the Worker `superpools-landing` (`wrangler.jsonc` here) serves this folder as static assets,
deployed by `.github/workflows/cloudflare.yml` on every push to `main`. It answers on `superpoolsai.com` and
`www.superpoolsai.com` through zone routes, which take the traffic while those DNS records are proxied (orange cloud).
`.assetsignore` keeps this file, the config and the share-card source off the site.
Brand, copy and positioning rules live in `docs/BRAND.md`; the product it describes in `docs/POOLS.md` and
`docs/SUPERPOOLS.md`.

- `_redirects`: `/privacy` and `/terms` send visitors to the app's `#/privacy` and `#/terms` (the landing Worker
  has no legal pages of its own), and `/fans/<club>` to the club's fan zone in the app.
- `fans.html` (25 October 2026): the fan zones, every club read like a front office and open to every fan: the four leagues
  (NHL, NFL, NBA, Premier League, each into its page in the app) and the NHL's 32 clubs a division to a row, each logo
  into its zone in the app (the club grid lives only here since the home's rebuild, 4 November 2026).
- `index.html` (rebuilt 4 November 2026): the home in ten sections. The hero (the tagline and its three lines, one
  gold button, the founding league in one line) beside the open-now board (`#now`, real events from the app's
  `pool_event_list()`, a rail on a phone); four doors by audience (fantasy, sports, shows in rose, fan zones); the three
  things we say, each with a drawn screen (the voice's post is the founding league's real morning column of 25 October
  2026 with the GMs' names changed, captioned so); every kind of pool, each link keeping its kind; the try-it question
  (`#market`); game night as a room (`#feed`, `#clock`, the invite); the change log's latest four lines; the planned
  prices; the FAQ (mirrored word for word by the FAQPage JSON-LD in the head); the closer. The founding league's numbers
  are dated static copy (as of 4 November 2026) until an anon-readable aggregate is live. Retired anchors (`#season`,
  `#ship`, `#join`...) are mapped to their new sections by `site.js`.
- `site.css` and `site.js`: one design system and one script for every page. The CSS's header lists its parts (hero,
  open-now board and rail, doors, three things, drawn screens, stats, kind list, demos, change log, plans, FAQ, closer,
  sticky bar, footer, the phone menu); gold is spent once per screen on the primary button (or one word), ice is for
  links and lines, rose only on a show page or the any-group door. A page that wants the sticky bottom button adds
  `<div class="stickybar" id="sticky">` at the end of the body and marks its other gold elements `data-gold`.
- `icons.svg`: the one-stroke icon sprite every page can share (`<svg class="ico"><use href="./icons.svg#i-bolt"/></svg>`).
- `changelog.json`, `changelog.html` and the home's four lines are written by `node scripts/landing-changelog.mjs` from the
  app's `src/data/changelog.ts`; run it after adding an entry there and commit what it writes.
- `img/`: the phone screens. Pool screens come from a sample pool; SaK screens from the league's own site with
  every name changed (the anonymized fixtures). 600 px wide WebP; never a screen with a real GM's name or a cash prize.
- `icon.svg`: the mark (the faceoff dot) on its tile; also the favicon. `img/sak-icon.svg` is SaK's crest.
- `og.html` → `og.png`, `og-together.html` → `og-together.png`, `og-love-is-blind.html` and `og-world-series.html` (the World Series page, 18 October 2026; off the site since 28 October 2026 with it, see `.assetsignore`): the share cards, rendered with the pre-installed headless Chromium:

```
B=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)
$B --no-sandbox --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=landing/og.png file://$PWD/landing/og.html
```

- `fonts/`: Barlow Condensed (700, 900, 900 italic) and Inter (variable), self-hosted so the page depends on nothing at load.
