#!/usr/bin/env node
// Writes the marketing site's change log from the app's own src/data/changelog.ts, so the log is written once, in the
// pull request that ships the feature, and the landing never keeps a list by hand.
//
//   node scripts/landing-changelog.mjs
//
// Writes four things in landing/:
//   changelog.json         every entry (date, title, the body's first sentence, the body, the app link), newest first
//   changelog-latest.json  the four newest, which the home's "Alive and improving" lines refresh from (site.js,
//                          #loglines), so the home never downloads the whole log
//   changelog.html         the full log by month and week, a sticky row of weeks, each entry a title that opens
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
const BANNED = [/—/, /!/, /\bAI-powered\b/i, /\bplatform\b/i, /\bseamless/i, /\bunlock/i, /\bofficial\b/i, /\blicensed\b/i,
  // and the sportsbook's words (docs/BRAND.md section 5): pools pick and call, they never bet, stake or pay out
  /\bbets?\b/i, /\bside[- ]?bets?\b/i, /\bcash(ed|ing)? out\b/i, /\bwager/i, /\bstake\b/i, /\bpayout/i, /\bmarket\b/i, /\bbookmaker/i, /\bpush\b/i, /\bodds\b/i, /\bevery sport\b/i];
for (const e of entries) for (const re of BANNED) if (re.test(e.title + ' ' + e.body)) console.warn(`changelog: ${e.date} "${e.title}" has ${re}`);

writeFileSync(join(root, 'landing/changelog.json'), JSON.stringify({ updated: entries[0].date, entries }, null, 1) + '\n');
// the home's four lines read this small file, not the whole log (site.js, #loglines)
writeFileSync(join(root, 'landing/changelog-latest.json'), JSON.stringify({ updated: entries[0].date,
  entries: entries.slice(0, 4).map(({ date, title, line, to }) => ({ date, title, line, to })) }, null, 1) + '\n');

// The home's four lines, between the markers in landing/index.html
const lines = entries.slice(0, 4).map((e) =>
  `          <li><time datetime="${e.date}">${short(e.date)}</time><div><b>${esc(e.title)}</b></div></li>`).join('\n');
const indexPath = join(root, 'landing/index.html');
const index = readFileSync(indexPath, 'utf8');
const marked = /(<!-- changelog:start -->)[\s\S]*?(\s*<!-- changelog:end -->)/;
if (!marked.test(index)) throw new Error('landing/index.html has no changelog markers');
writeFileSync(indexPath, index.replace(marked, `$1\n${lines}$2`));

// The full log, by month and week, newest first: a sticky row of weeks to jump between, each entry a title that opens
// to its words (only the latest week starts open), the site's own header with the phone menu, and its footer.
// a month holds its weeks (Monday to Sunday, the part of each week inside the month), newest first
const monday = (d) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const groups = [];
for (const e of entries) {
  const key = e.date.slice(0, 7);
  if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [], weeks: [] });
  const g = groups[groups.length - 1];
  g.items.push(e);
  const wk = monday(e.date) < key + '-01' ? key + '-01' : monday(e.date);
  if (!g.weeks.length || g.weeks[g.weeks.length - 1].key !== wk) g.weeks.push({ key: wk, items: [] });
  g.weeks[g.weeks.length - 1].items.push(e);
}
// a week's label inside its month: "19 to 25 October", or one day when it is one
const weekLabel = (w) => {
  const days = w.items.map((e) => Number(e.date.slice(8, 10))); const lo = Math.min(...days), hi = Math.max(...days);
  return `${lo === hi ? lo : `${lo} to ${hi}`} ${MONTHS[Number(w.key.slice(5, 7)) - 1]}`;
};
const weekChip = (w) => { const days = w.items.map((e) => Number(e.date.slice(8, 10))); return `${MON[Number(w.key.slice(5, 7)) - 1]} ${Math.min(...days)}`; };
const allWeeks = groups.flatMap((g) => g.weeks);
const month = (key) => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
// The shared header (the same markup scripts/landing/gen_sports.py writes on the sport pages)
const HEADER = `  <header class="site-head">
    <a class="wordmark" href="./" aria-label="Super Pools home">
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111b30"/><circle cx="32" cy="32" r="17" fill="none" stroke="#f7c548" stroke-width="4"/><circle cx="32" cy="32" r="4.5" fill="#f7c548"/><g stroke="#f7c548" stroke-width="2.6" stroke-linecap="round"><line x1="25" y1="8" x2="25" y2="12.5"/><line x1="39" y1="8" x2="39" y2="12.5"/><line x1="25" y1="51.5" x2="25" y2="56"/><line x1="39" y1="51.5" x2="39" y2="56"/></g></svg>
      <span><b>SUPER</b> POOLS</span>
    </a>
    <nav class="navlinks" aria-label="Doors"><a href="./fantasy-hockey.html">Fantasy league</a><a href="./#kinds">Sports pools</a><a href="./together.html">Show pools</a><a href="./fans.html">Fan zones</a><a href="./pricing.html">Pricing</a></nav>
    <div class="head-right">
      <a class="signin" href="https://app.superpoolsai.com/">Sign in</a>
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="Open the menu">
        <svg class="bars" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        <svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <nav class="menu" id="menu" aria-label="Menu">
      <a href="./fantasy-hockey.html"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-trophy"/></svg></span><span><b>Fantasy league</b><small>Keepers, the draft room, a league voice</small></span></a>
      <a href="./#kinds"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-target"/></svg></span><span><b>Sports pools</b><small>The NFL, NHL, NBA and soccer</small></span></a>
      <a href="./together.html"><span class="mi r"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-tv"/></svg></span><span><b>Show pools</b><small>Call what happens next, with your group</small></span></a>
      <a href="./fans.html"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-chart"/></svg></span><span><b>Fan zones</b><small>Every club, read like a front office</small></span></a>
      <a href="./pricing.html"><span class="mi n"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-coin"/></svg></span><span><b>Pricing</b><small>Per pool, never per person</small></span></a>
      <a href="https://app.superpoolsai.com/"><span class="mi n"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-users"/></svg></span><span><b>Sign in</b><small>Back to your pools</small></span></a>
    </nav>
  </header>
`;
const entry = (e, open) => `          <details class="ce"${open ? ' open' : ''}>
            <summary><time datetime="${e.date}">${short(e.date)}</time><b>${esc(e.title)}</b></summary>
            <div class="cb"><p>${esc(e.body)}</p>${e.to ? `<a class="textlink" href="${esc(e.to)}" aria-label="Open in the app: ${esc(e.title)}">Open it in the app</a>` : ''}</div>
          </details>`;
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Changelog: what shipped, week by week | Super Pools</title>
  <meta name="description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it. Supercoins, never money." />
  <link rel="canonical" href="https://superpoolsai.com/changelog" />
  <link rel="icon" href="./icon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0b1220" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Super Pools" />
  <meta property="og:url" content="https://superpoolsai.com/changelog" />
  <meta property="og:title" content="What shipped, week by week" />
  <meta property="og:description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it. Never money." />
  <meta property="og:image" content="https://superpoolsai.com/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Super Pools: Fantasy Pools from the Future. Fun fantasy pools with friends, for all. AI-enhanced. Fun for all." />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="What shipped, week by week" />
  <meta name="twitter:description" content="Every change to Super Pools, dated and newest first, written in the pull request that shipped it. Never money." />
  <meta name="twitter:image" content="https://superpoolsai.com/og.png" />
  <link rel="preload" href="./fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="./fonts/inter.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="./site.css" />
  <style>
    /* the months: one chip each, sticky at the top while the log scrolls */
    .months { position: sticky; top: 0; z-index: 40; display: flex; gap: 6px; overflow-x: auto; margin: 0 calc(-1 * var(--gutter)); padding: 10px var(--gutter);
      background: linear-gradient(180deg, rgba(11,18,32,.97) 70%, rgba(11,18,32,0)); scrollbar-width: none; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .months::-webkit-scrollbar { display: none; }
    .months a { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--soft);
      background: var(--boards); border: 1px solid var(--line2); white-space: nowrap; }
    .months a small { font-size: 12px; font-weight: 600; color: var(--mute); }
    .months a:hover, .months a[aria-current="true"] { color: var(--ink); border-color: rgba(56,189,248,.5); }
    .cmonth { margin-top: 30px; scroll-margin-top: 70px; }
    .cmonth h2 { display: flex; align-items: baseline; gap: 12px; margin: 0 0 12px; font-size: clamp(30px, 6vw, 40px); }
    .cmonth h2 small { font: 600 13px/1 Inter, sans-serif; color: var(--mute); letter-spacing: 0; }
    .cweek { scroll-margin-top: 70px; }
    .cweek + .cweek { margin-top: 18px; }
    .cweek h3 { display: flex; align-items: baseline; gap: 10px; margin: 0 2px 8px; font: 700 13px/1.2 'Barlow Condensed', sans-serif; letter-spacing: .16em; text-transform: uppercase; color: var(--mute); }
    .cweek h3 small { font: 600 12px/1 Inter, sans-serif; letter-spacing: 0; color: var(--dim); }
    .clist { border-radius: 22px; background: var(--boards); border: 1px solid var(--line); padding: 2px 16px; }
    .ce + .ce { border-top: 1px solid var(--line); }
    .ce summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 60px minmax(0, 1fr) 18px; gap: 12px; align-items: baseline; padding: 14px 0; min-height: 48px; }
    .ce summary::-webkit-details-marker { display: none; }
    .ce summary::after { content: '+'; justify-self: end; font: 900 22px/1 'Barlow Condensed', sans-serif; color: var(--ice); }
    .ce[open] summary::after { content: '–'; }
    .ce time { font: 700 13px/1.4 'Barlow Condensed', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--ice); font-variant-numeric: tabular-nums; }
    .ce b { font-size: 15.5px; line-height: 1.35; }
    .cb { padding: 0 0 14px 72px; }
    .cb p { margin: 0; font-size: 14.5px; line-height: 1.55; color: var(--soft); max-width: 700px; }
    .cb .textlink { min-height: 40px; font-size: 14px; }
    @media (max-width: 560px) { .cb { padding-left: 0; } .ce summary { grid-template-columns: 52px minmax(0, 1fr) 18px; gap: 10px; } }
  </style>
</head>
<body>
  <!-- Written by scripts/landing-changelog.mjs from src/data/changelog.ts; edit that file, not this one. -->
  <a class="skip" href="#main">Skip to the log</a>
${HEADER}  <main id="main">
    <section id="log" style="margin-top:34px">
      <div class="shead">
        <div class="eyebrow">Changelog</div>
        <h1 class="display" style="font-size:clamp(46px,9vw,76px);margin:8px 0 12px">What shipped, week by week.</h1>
        <p class="lead">Every change to Super Pools, newest first, written in the same pull request that shipped it. ${entries.length} entries, last updated ${long(entries[0].date)}. Tap a line to read it.</p>
      </div>
      <nav class="months" aria-label="Weeks">
${allWeeks.map((w) => `        <a href="#w-${w.key}">${weekChip(w)}<small>${w.items.length}</small></a>`).join('\n')}
      </nav>
${groups.map((g) => `      <section class="cmonth" id="m-${g.key}" aria-labelledby="h-${g.key}">
        <h2 class="display" id="h-${g.key}">${month(g.key)}<small>${g.items.length} ${g.items.length === 1 ? 'change' : 'changes'}</small></h2>
${g.weeks.map((w) => `        <div class="cweek" id="w-${w.key}">
          <h3>${weekLabel(w)}<small>${w.items.length}</small></h3>
          <div class="clist">
${w.items.map((e) => entry(e, w === allWeeks[0])).join('\n')}
          </div>
        </div>`).join('\n')}
      </section>`).join('\n')}
    </section>
  </main>

  <footer class="site-foot">
    <div class="cols">
      <div><h2>Play</h2><ul><li><a href="./fantasy-hockey.html">Fantasy league</a></li><li><a href="./hockey-pools.html">Hockey pools</a></li><li><a href="./football-pools.html">NFL pools</a></li><li><a href="./basketball-pools.html">NBA pools</a></li><li><a href="./soccer-pools.html">Soccer pools</a></li><li><a href="./together.html">Show pools</a></li></ul></div>
      <div><h2>Look around</h2><ul><li><a href="./fans.html">Fan zones</a></li><li><a href="./example-pool.html">An example pool</a></li><li><a href="./pricing.html">Pricing</a></li><li><a href="./changelog.html" aria-current="page">Changelog</a></li></ul></div>
      <div><h2>Your pools</h2><ul><li><a href="https://app.superpoolsai.com/">Sign in</a></li><li><a href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a></li></ul></div>
      <div><h2>The fine print</h2><ul><li><a href="https://app.superpoolsai.com/#/privacy">Privacy</a></li><li><a href="https://app.superpoolsai.com/#/terms">Terms</a></li><li><button type="button" class="linkbtn" data-cookie-settings>Cookie settings</button></li></ul></div>
    </div>
    <div class="base"><span>© 2026 Super Pools · superpoolsai.com · Supercoins, never money</span><span>Planetterrian Ventures · 963 8th Ave W, Vancouver, BC V5Z 1E4, Canada</span><span>Scores from public score feeds. Not affiliated with the NHL, the NCAA, Netflix or any league.</span></div>
  </footer>
  <script src="./site.js"></script>
  <script>
    // the chip for the week on screen is marked, so the row says where you are
    (function () {
      var chips = document.querySelectorAll('.months a'); if (!chips.length || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          chips.forEach(function (c) { c.setAttribute('aria-current', c.getAttribute('href') === '#' + e.target.id ? 'true' : 'false'); });
        });
      }, { rootMargin: '-80px 0px -70% 0px' });
      document.querySelectorAll('.cweek').forEach(function (m) { io.observe(m); });
    })();
  </script>
</body>
</html>
`;
writeFileSync(join(root, 'landing/changelog.html'), html);
console.log(`landing changelog: ${entries.length} entries, newest ${entries[0].date}`);
