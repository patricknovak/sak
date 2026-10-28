// Marketing landing HTML must stay clear of gambling-review trigger words
// (odds / bet / cash out). Currency: Goblets on the Love Is Blind pages and
// the example pool; Supercoins (or plain "coins" for counts) elsewhere.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const landing = join(root, 'landing');
const pages = readdirSync(landing).filter((n) => n.endsWith('.html') && !n.startsWith('og'));

const banned = /\b(odds|betting|wager|gamble|gambling|cash(?:ing|ed)?\s*out|cashing out|cashed out|pay\s*out)\b/i;
const betWord = /(^|[^a-z])bets?([^a-z]|$)/i;
const sideBet = /side[- ]?bets?/i;

for (const name of pages) {
  const html = readFileSync(join(landing, name), 'utf8');
  assert.doesNotMatch(html, banned, `${name}: no odds/bet/cash-out/pay-out`);
  assert.doesNotMatch(html, betWord, `${name}: no bet/bets`);
  assert.doesNotMatch(html, sideBet, `${name}: no side-bet`);
  if (name === 'love-is-blind.html' || name === 'example-pool.html') {
    assert.match(html, /Goblets/, `${name} uses Goblets`);
    assert.doesNotMatch(html, /Supercoins/, `${name} does not say Supercoins`);
    if (name === 'love-is-blind.html') {
      assert.doesNotMatch(html, /Sixteen (questions|calls)/, 'no hardcoded sixteen on the LIB page');
      const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const tenseWithDate = new RegExp(`\\bclose[sd]?\\b[^\\n<]{0,40}\\b(?:${monthNames})\\s+\\d`, 'i');
      const cardLabels = [...html.matchAll(/<div class="eyebrow r" style="margin-bottom:10px">([^<]*)<\/div>/g)].map((m) => m[1]);
      assert.equal(cardLabels.length, 4, 'four question cards on the LIB page');
      for (const label of cardLabels) {
        assert.doesNotMatch(label, tenseWithDate, `question card label carries a bare date, no tense that goes stale: ${label}`);
      }
    }
  } else if (!name.includes('together')) {
    assert.doesNotMatch(html, /Goblets/, `${name}: Goblets only on LIB (and together's LIB cards)`);
  }
  if (name === 'example-pool.html') {
    assert.equal((html.match(/class="q-card"/g) || []).length, 16, 'all sixteen question cards are static HTML');
    assert.doesNotMatch(html, /<script(?![^>]*src="\.\/site\.js")/i, 'no inline or extra scripts');
    assert.match(html, /Every name and every number on this page is an illustration, not a live pool/);
    assert.match(html, /Illustration only\. No live pool, no real players\./);
    assert.match(html, /It is an illustration built to show the shape of a Love Is Blind pool/);
    assert.match(html, /Every name, call and number on this page is an illustration, not a live pool\./);
    const tableNote = html.indexOf('Four made-up players');
    assert.notEqual(tableNote, -1, 'Table section labels the made-up players');
    assert.ok(tableNote < html.indexOf('<table class="standings"'), 'Table label appears before the standings table');
    assert.match(html, /A pool you start today opens with the questions still to settle\. This page shows the whole season so you can see the shape of it\./);
    assert.match(html, /<!--[\s\S]*\bdrained\b[\s\S]*-->/, 'snapshot comment notes the pack is drained');
  }
}

{
  const redirects = readFileSync(join(landing, '_redirects'), 'utf8');
  assert.match(redirects, /^\/privacy\s+https:\/\/app\.superpoolsai\.com\/#\/privacy\s+302/m);
  assert.match(redirects, /^\/terms\s+https:\/\/app\.superpoolsai\.com\/#\/privacy\s+302/m);
}

console.log('landing copy safe tests passed');
