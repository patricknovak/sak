# Super Pools landing page

Static, served by Cloudflare: the Worker `superpools-landing` (`wrangler.jsonc` here) serves this folder as static assets,
deployed by `.github/workflows/cloudflare.yml` on every push to `main`. It answers on `superpoolsai.com` and
`www.superpoolsai.com` through zone routes, which take the traffic while those DNS records are proxied (orange cloud).
`.assetsignore` keeps this file, the config and the share-card source off the site.
Brand, copy and positioning rules live in `docs/BRAND.md`; the product it describes in `docs/POOLS.md` and
`docs/SUPERPOOLS.md`.

- `index.html`: the page. Two doors: prediction pools (the Love Is Blind pool in rose) and fantasy sports (the SaK
  Superleague in gold). The waitlist form posts to `public.waitlist` through PostgREST with the publishable key; the
  "what do you want to play" choice goes in `league` and the optional free text in `note`.
- `img/`: the phone screens. Pool screens come from a sample pool; SaK screens from the league's own site with
  every name changed (the anonymized fixtures). 600 px wide WebP; never a screen with a real GM's name or a cash prize.
- `icon.svg`: the mark (the faceoff dot) on its tile; also the favicon. `img/sak-icon.svg` is SaK's crest.
- `og.html` → `og.png`: the share card, rendered with the pre-installed headless Chromium:

```
B=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
$B --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=landing/og.png file://$PWD/landing/og.html
```

- `fonts/`: Barlow Condensed (700, 900, 900 italic) and Inter (variable), self-hosted so the page depends on nothing at load.
