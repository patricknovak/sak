#!/usr/bin/env node
// Writes the marketing site's change log from the app's own src/data/changelog.ts, so the log is written once, in the
// pull request that ships the feature, and the landing never keeps a list by hand.
//
//   node scripts/landing-changelog.mjs
//
// Writes three things in landing/:
//   changelog.json  every entry (date, title, the body's first sentence, the body, the app link), newest first; the
//                   home's "Alive and improving" lines refresh from it (site.js, #loglines)
//   changelog.html  the full log, grouped by month, in the site's shell
//   index.html      the latest four lines between <!-- changelog:start --> and <!-- changelog:end -->, the static copy
//                   the home shows before (or without) the script
// The entries' emoji icons stay in the app (docs/BRAND.md section 5: no emoji in copy). Run it after editing
// src/data/changelog.ts and commit what it writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/data/changelog.ts'), 'utf8');

// The file is plain data behind one interface; drop the types and evaluate the array.
const body = src
  .replace(/^export interface[^\n]*\n/m, '')
  .replace(/export const CHANGELOG\s*:\s*Change\[\]\s*=/, 'return');
const CHANGELOG = new Function(body)();
if (!Array.isArray(CHANGELOG) || !CHANGELOG.length) throw new Error('no entries read from src/data/changelog.ts');

const APP = 'https://app.superpoolsai.com/#';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const firstSentence = (s) => { const m = String(s).match(/^.*?[.?](\s|$)/); return (m ? m[0] : String(s)).trim(); };
const short = (d) => { const [, m, day] = d.split('-'); return `${MON[Number(m) - 1]} ${Number(day)}`; };
const long = (d) => { const [y, m, day] = d.split('-'); return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`; };

const entries = CHANGELOG
  .map((e) => ({ date: e.date, title: e.title, line: firstSentence(e.body), body: e.body, to: e.to ? APP + e.to : null }))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

// Words the brand keeps off public pages (docs/BRAND.md section 5); the app's copy is checked here so the landing
// never publishes one by accident. A hit is printed, not fixed: the fix belongs in src/data/changelog.ts.
const BANNED = [/—/, /!/, /\bAI-powered\b/i, /\bplatform\b/i, /\bseamless/i, /\bunlock/i, /\bofficial\b/i, /\blicensed\b/i];
for (const e of entries) for (const re of BANNED) if (re.test(e.title + ' ' + e.body)) console.warn(`changelog: ${e.date} "${e.title}" has ${re}`);

writeFileSync(join(root, 'landing/changelog.json'), JSON.stringify({ updated: entries[0].date, entries }, null, 1) + '\n');

// The home's four lines, between the markers in landing/index.html
const lines = entries.slice(0, 4).map((e) =>
  `          <li><time datetime="${e.date}">${short(e.date)}</time><div><b>${esc(e.title)}</b></div></li>`).join('\n');
const indexPath = join(root, 'landing/index.html');
const index = readFileSync(indexPath, 'utf8');
const marked = /(<!-- changelog:start -->)[\s\S]*?(\s*<!-- changelog:end -->)/;
if (!marked.test(index)) throw new Error('landing/index.html has no changelog markers');
writeFileSync(indexPath, index.replace(marked, `$1\n${lines}$2`));

// The full log, grouped by month, newest first
const groups = [];
for (const e of entries) {
  const key = e.date.slice(0, 7);
  if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
  groups[groups.length - 1].items.push(e);
}
const month = (key) => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Changelog: what shipped, week by week | Super Pools</title>
  <meta name="description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it. The home page shows the latest four lines." />
  <link rel="canonical" href="https://superpoolsai.com/changelog" />
  <link rel="icon" href="./icon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0b1220" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Super Pools" />
  <meta property="og:url" content="https://superpoolsai.com/changelog" />
  <meta property="og:title" content="What shipped, week by week" />
  <meta property="og:description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it." />
  <meta property="og:image" content="https://superpoolsai.com/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Super Pools: Fantasy Pools from the Future" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="What shipped, week by week" />
  <meta name="twitter:description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it." />
  <meta name="twitter:image" content="https://superpoolsai.com/og.png" />
  <link rel="preload" href="./fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="./site.css" />
  <style>
    .clog { display: grid; gap: 34px; margin-top: 8px; }
    .clog h2 { margin: 0 0 10px; font-size: 30px; }
    .clog .loglines li { grid-template-columns: 74px minmax(0, 1fr); }
    .clog .loglines a { display: inline-block; margin-top: 6px; font-size: 13.5px; font-weight: 600; }
    .clog .loglines a::after { content: ' ›'; }
    @media (max-width: 560px) { .clog .loglines li { grid-template-columns: 1fr; gap: 2px; } }
  </style>
</head>
<body>
  <!-- Written by scripts/landing-changelog.mjs from src/data/changelog.ts; edit that file, not this one. -->
  <a class="skip" href="#log">Skip to the log</a>
  <main>
    <header class="site-head">
      <a class="wordmark" href="./" aria-label="Super Pools home">
        <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111b30"/><circle cx="32" cy="32" r="17" fill="none" stroke="#f7c548" stroke-width="4"/><circle cx="32" cy="32" r="4.5" fill="#f7c548"/><g stroke="#f7c548" stroke-width="2.6" stroke-linecap="round"><line x1="25" y1="8" x2="25" y2="12.5"/><line x1="39" y1="8" x2="39" y2="12.5"/><line x1="25" y1="51.5" x2="25" y2="56"/><line x1="39" y1="51.5" x2="39" y2="56"/></g></svg>
        <span><b>SUPER</b> POOLS</span>
      </a>
      <div class="head-right"><a class="textlink" href="./">Home</a><a class="signin" href="https://app.superpoolsai.com/">Sign in</a></div>
    </header>
    <section id="log" style="margin-top:40px">
      <div class="shead">
        <div class="eyebrow">Changelog</div>
        <h1 class="display" style="font-size:clamp(46px,9vw,76px);margin:8px 0 12px">What shipped, week by week.</h1>
        <p class="lead">Every change to Super Pools, newest first, written in the same pull request that shipped it. Last updated ${long(entries[0].date)}.</p>
      </div>
      <div class="clog">
${groups.map((g) => `        <div>
          <h2 class="display">${month(g.key)}</h2>
          <ol class="loglines">
${g.items.map((e) => `            <li><time datetime="${e.date}">${short(e.date)}</time><div><b>${esc(e.title)}</b><span>${esc(e.body)}</span>${e.to ? `<a href="${esc(e.to)}">Open it in the app</a>` : ''}</div></li>`).join('\n')}
          </ol>
        </div>`).join('\n')}
      </div>
    </section>
    <footer>
      <span>© 2026 Super Pools · superpoolsai.com · Supercoins, never money · not affiliated with the NHL or any league</span>
      <nav><a href="./">Home</a><a href="https://app.superpoolsai.com/#/privacy">Privacy</a><a href="https://app.superpoolsai.com/#/terms">Terms</a><a href="#" data-cookie-settings role="button">Cookie settings</a><a href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a></nav>
    </footer>
  </main>
  <script src="./site.js"></script>
</body>
</html>
`;
writeFileSync(join(root, 'landing/changelog.html'), html);
console.log(`landing changelog: ${entries.length} entries, newest ${entries[0].date}`);
