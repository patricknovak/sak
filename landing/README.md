# Super Pools landing page

Static, served by Vercel (project `superpools`, root directory `landing/`, redeployed on every push to `main`).
Brand, copy and positioning rules live in `docs/BRAND.md`.

- `index.html`: the page. The waitlist form posts to `public.waitlist` through PostgREST with the publishable key.
- `icon.svg`: the mark (the faceoff dot) on its tile; also the favicon.
- `og.html` → `og.png`: the share card, rendered with the pre-installed headless Chromium:

```
B=$(ls /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
$B --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=1200,630 --screenshot=landing/og.png file://$PWD/landing/og.html
```

- `fonts/`: Barlow Condensed (700, 900, 900 italic) and Inter (variable), self-hosted so the page depends on nothing at load.
