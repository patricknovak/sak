// Marketing landing HTML must stay clear of gambling-review trigger words
// (odds / bet / cash out). Currency: Goblets only on Love Is Blind pages;
// Supercoins (or plain "coins" for counts) elsewhere.
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
  if (name === 'love-is-blind.html') {
    assert.match(html, /Goblets/, 'LIB uses Goblets');
    assert.doesNotMatch(html, /Supercoins/, 'LIB page does not say Supercoins');
  } else if (!name.includes('together')) {
    assert.doesNotMatch(html, /Goblets/, `${name}: Goblets only on LIB (and together's LIB cards)`);
  }
}

{
  const redirects = readFileSync(join(landing, '_redirects'), 'utf8');
  assert.match(redirects, /^\/privacy\s+https:\/\/app\.superpoolsai\.com\/#\/privacy\s+302/m);
  assert.match(redirects, /^\/terms\s+https:\/\/app\.superpoolsai\.com\/#\/privacy\s+302/m);
}

console.log('landing copy safe tests passed');
