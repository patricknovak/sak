# Super Pools landing page

Static, served by Cloudflare: the Worker `superpools-landing` (`wrangler.jsonc` here) serves this folder as static assets,
deployed by `.github/workflows/cloudflare.yml` on every push to `main`. It answers on `superpoolsai.com` and
`www.superpoolsai.com` through zone routes, which take the traffic while those DNS records are proxied (orange cloud).
`.assetsignore` keeps this file, the config and the share-card source off the site.
Brand, copy and positioning rules live in `docs/BRAND.md`; the product it describes in `docs/POOLS.md` and
`docs/SUPERPOOLS.md`.

- `_redirects`: `/privacy` and `/terms` send visitors to `https://app.superpoolsai.com/#/privacy` (the landing Worker
  has no privacy HTML of its own), and `/fans/<club>` to the club's fan zone in the app.
- `fans.html` (25 October 2026): the NHL fan zones, every club read like a front office and open to every fan, with the
  32 clubs a division to a row (the same grid as the home's `#fans` section, each logo into its zone in the app).
- `index.html`: the home, sports first (the live room in the hero, the events open right now, game night as a room,
  every kind of pool, questions with live prices, the founding league, shipping every week, where it's going) with a door to
  `together.html`, pools for any group (Love Is Blind, women's sports), in rose. Both use `site.css` and `site.js` (the
  reveal on scroll, the live board with its goal horn, the game-night demos and the try-it question drawn in the page,
  the open-right-now board read live from the app's `pool_event_list()` with the publishable key and a fallback when it
  can't be read, the premiere countdown, the waitlist, consented GA4 when `GA4_ID` is set, and first-touch UTM/referrer
  capture for the waitlist). The "Just shipped" and "Being built now" lists are written by hand: keep them true. The waitlist posts
  to `public.waitlist` through PostgREST with the publishable key; the "what do you want to play" choice goes in `league`
  and the optional free text in `note`. `robots.txt` allows crawlers and points `Sitemap:` at
  `https://superpoolsai.com/sitemap.xml`; `sitemap.xml` lists the public pages.
- `img/`: the phone screens. Pool screens come from a sample pool; SaK screens from the league's own site with
  every name changed (the anonymized fixtures). 600 px wide WebP; never a screen with a real GM's name or a cash prize.
- `icon.svg`: the mark (the faceoff dot) on its tile; also the favicon. `img/sak-icon.svg` is SaK's crest.
- `og.html` → `og.png`, `og-together.html` → `og-together.png`, `og-love-is-blind.html` and `og-world-series.html` (the World Series page, 18 October 2026): the share cards, rendered with the pre-installed headless Chromium:

```
B=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
$B --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=landing/og.png file://$PWD/landing/og.html
```

- `fonts/`: Barlow Condensed (700, 900, 900 italic) and Inter (variable), self-hosted so the page depends on nothing at load.
