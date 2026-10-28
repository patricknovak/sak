// Landing review fixes: LIB share copy, Privacy + Cookie settings on every footer, world-series src=ws_page
// (no hard-coded landing UTMs), and site.js helpers for cookie reopen + UTM pass-through.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const landing = join(root, 'landing');
const read = (name) => readFileSync(join(landing, name), 'utf8');

const pages = [
  'index.html',
  'love-is-blind.html',
  'together.html',
  'world-series-pools.html',
  'football-pools.html',
  'basketball-pools.html',
  'hockey-pools.html',
];

{
  const lib = read('love-is-blind.html');
  assert.match(lib, /Goblets/, 'LIB page mentions Goblets');
  assert.doesNotMatch(lib, /play coins/i, 'no play coins');
  assert.doesNotMatch(lib, /weekly calls on every couple/i, 'no weekly-calls-on-every-couple');
  const desc = lib.match(/meta name="description" content="([^"]+)"/)?.[1] ?? '';
  assert.match(desc, /questions still open/);
  assert.match(desc, /altar and the reunion/);
  assert.doesNotMatch(desc, /Sixteen questions/, 'the sixteen-question claim is false once the pack drains');
  assert.match(desc, /Goblets/);
  assert.match(lib, /twitter:description/);
  assert.match(lib, /application\/ld\+json[^>]*>[^<]*Goblets/, 'JSON-LD uses Goblets');
}

for (const name of pages) {
  const html = read(name);
  const foot = html.split('<footer>')[1] ?? '';
  assert.match(foot, /Privacy/, `${name} footer has Privacy`);
  assert.match(foot, /data-cookie-settings/, `${name} footer has Cookie settings`);
  assert.match(foot, /#\/privacy/, `${name} Privacy points at the app page`);
}

{
  const ws = read('world-series-pools.html');
  assert.doesNotMatch(ws, /utm_source=landing/, 'no hard-coded utm_source=landing');
  assert.doesNotMatch(ws, /utm_campaign=world_series/, 'no hard-coded utm_campaign=world_series');
  assert.ok((ws.match(/src=ws_page/g) || []).length >= 8, 'app links carry src=ws_page');
}

{
  const js = read('site.js');
  assert.match(js, /spOpenCookieSettings|data-cookie-settings/, 'cookie settings reopen');
  assert.match(js, /spDecorateAppHref/, 'UTM pass-through helper');
  assert.match(js, /utm_source/, 'passes visitor UTMs');
  assert.match(js, /app\.superpoolsai\.com\/#\/privacy/, 'banner Privacy link');
  // Consent still gated: gtag script only after Accept / granted path
  assert.match(js, /spStoreGet\(CONSENT_KEY\) === 'granted'/);
  assert.match(js, /loadTag\(\)/);
}

{
  // World Series marketing page is kept on disk for a licensed feed, but unserved until then
  assert.ok(existsSync(join(landing, 'world-series-pools.html')), 'world-series-pools.html stays in the repo');
  const ignore = read('.assetsignore');
  assert.match(ignore, /^world-series-pools\.html$/m, '.assetsignore lists the page');
  assert.match(ignore, /^og-world-series\.html$/m, '.assetsignore lists the OG HTML');
  assert.match(ignore, /^og-world-series\.png$/m, '.assetsignore lists the OG PNG');
  const redirects = read('_redirects');
  assert.match(redirects, /\/world-series-pools\s+https:\/\/superpoolsai\.com\/\s+302/, '_redirects sends old links home');
  assert.doesNotMatch(read('index.html'), /world-series-pools/, 'home page has no World Series route');
  assert.doesNotMatch(read('sitemap.xml'), /world-series/, 'sitemap has no World Series URL');
}

console.log('landing review tests passed');
