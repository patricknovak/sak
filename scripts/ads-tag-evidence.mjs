// Pre-merge evidence: AW-949617778 is gated behind Accept (no AW / googleads before).
// Usage: node scripts/ads-tag-evidence.mjs <appUrl> <landingUrl>
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const appUrl = process.argv[2] || 'http://127.0.0.1:4174/';
const landingUrl = process.argv[3] || 'http://127.0.0.1:4175/';
const outDir = '/opt/cursor/artifacts/ads-tag-evidence';
mkdirSync(outDir, { recursive: true });

function awConfigs(entries) {
  return entries.filter((e) => Array.isArray(e) && e[0] === 'config' && String(e[1] || '').startsWith('AW-'));
}

async function probe(page, label, url) {
  const adsHits = [];
  const consoleMsgs = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/googleads|googleadservices|pagead\/|\/aw\?/i.test(u)) adsHits.push(u);
  });
  page.on('console', (msg) => {
    const t = msg.text();
    if (/Content Security Policy|CSP|Refused to/i.test(t)) consoleMsgs.push(`[${msg.type()}] ${t}`);
  });
  page.on('pageerror', (err) => consoleMsgs.push(`[pageerror] ${err.message}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => {
    try { localStorage.removeItem('sp_analytics_consent'); } catch { /* */ }
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const dl = Array.from(window.dataLayer || []).map((e) => {
      try { return Array.from(e); } catch { return e; }
    });
    return {
      consent: localStorage.getItem('sp_analytics_consent'),
      hasGtagScript: !!document.getElementById('sp-ga4'),
      dataLayer: dl,
      banner: !!document.querySelector('[aria-label="Analytics cookies"], #sp-consent'),
    };
  });

  const beforeAw = awConfigs(before.dataLayer);
  const beforeAdsNet = [...adsHits];

  const accept = page.getByRole('button', { name: /^Accept$/i }).first();
  await accept.waitFor({ state: 'visible', timeout: 15_000 });
  await accept.click();
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const dl = Array.from(window.dataLayer || []).map((e) => {
      try { return Array.from(e); } catch { return e; }
    });
    return {
      consent: localStorage.getItem('sp_analytics_consent'),
      hasGtagScript: !!document.getElementById('sp-ga4'),
      dataLayer: dl,
    };
  });
  const afterAw = awConfigs(after.dataLayer);
  const afterAdsNet = adsHits.filter((u) => !beforeAdsNet.includes(u));

  const shotBefore = `${outDir}/${label}-before.png`;
  // reload without consent for before screenshot is already past; capture after Accept as proof of config
  const shotAfter = `${outDir}/${label}-after-accept.png`;
  await page.screenshot({ path: shotAfter, fullPage: false });

  return {
    label,
    url,
    before: {
      consent: before.consent,
      hasGtagScript: before.hasGtagScript,
      awConfigs: beforeAw,
      adsNetwork: beforeAdsNet,
      bannerVisible: before.banner,
    },
    after: {
      consent: after.consent,
      hasGtagScript: after.hasGtagScript,
      awConfigs: afterAw,
      adsNetworkSample: afterAdsNet.slice(0, 8),
    },
    cspConsole: consoleMsgs,
    screenshotAfter: shotAfter,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--disable-dev-shm-usage'],
});

const results = [];
for (const [label, url] of [['app', appUrl], ['landing', landingUrl]]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  results.push(await probe(page, label, url));
  await context.close();
}
await browser.close();

const summary = {
  checkedAt: new Date().toISOString(),
  expectedAdsId: 'AW-949617778',
  results,
};

const ok = results.every((r) => {
  const beforeClean = r.before.awConfigs.length === 0 && r.before.adsNetwork.length === 0 && !r.before.hasGtagScript;
  const afterOk = r.after.consent === 'granted'
    && r.after.awConfigs.some((e) => e[1] === 'AW-949617778')
    && !r.after.awConfigs.some((e) => e[1] === 'AW-7411462618')
    && r.cspConsole.length === 0;
  return beforeClean && afterOk;
});

writeFileSync(`${outDir}/evidence.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(ok ? 'EVIDENCE_OK' : 'EVIDENCE_FAIL');
process.exit(ok ? 0 : 1);
