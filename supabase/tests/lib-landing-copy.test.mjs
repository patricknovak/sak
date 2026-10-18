// Love Is Blind landing: pack links use the live slug, and share/body copy stays clear of
// gambling-review triggers and Netflix trademark overreach (nominative show name + disclaimer only).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'landing/love-is-blind.html'), 'utf8');
const together = readFileSync(join(root, 'landing/together.html'), 'utf8');

{
  const appLinks = [...html.matchAll(/href="(https:\/\/app\.superpoolsai\.com[^"]*)"/g)].map((m) => m[1]);
  const startLinks = appLinks.filter((h) => h.includes('#/new'));
  assert.ok(startLinks.length >= 3, 'LIB page has app start links');
  for (const href of startLinks) {
    assert.match(href, /#\/new\?pack=love-is-blind-s11/, `pack slug on ${href}`);
    assert.doesNotMatch(href, /pack=love-is-blind(?!-s11)/, 'no bare love-is-blind pack');
  }
  assert.ok(appLinks.some((h) => h.includes('#/privacy')), 'Privacy footer points at the app');
  const togetherLib = [...together.matchAll(/href="(https:\/\/app\.superpoolsai\.com[^"]*love-is-blind[^"]*)"/g)].map((m) => m[1]);
  for (const href of togetherLib) {
    assert.match(href, /pack=love-is-blind-s11/, `together LIB link ${href}`);
  }
}

{
  const banned = /\b(odds|betting|wager|gamble|gambling|win money|pay\s*out|cash\s*out)\b/i;
  // "bet" alone is checked separately so "alphabet" etc. do not false-positive; allow none on this page.
  const betWord = /(^|[^a-z])bets?([^a-z]|$)/i;
  assert.doesNotMatch(html, banned, 'no gambling-review trigger words');
  assert.doesNotMatch(html, betWord, 'no bet/bets');
  assert.doesNotMatch(html, /\bSell\b/, 'no Sell (market verb)');
}

{
  assert.match(html, /not affiliated with Netflix/i, 'Netflix disclaimer');
  assert.doesNotMatch(html, /\bofficial\b/i, 'no official');
  assert.doesNotMatch(html, /Netflix pool/i, 'no Netflix pool');
  assert.doesNotMatch(html, /netflix\.com|nflx|tudum/i, 'no Netflix asset URLs');
  // Nominative show title is fine; brand logos are not used on this page.
  assert.doesNotMatch(html, /netflix.*logo|logo.*netflix/i);
}

console.log('lib landing copy tests passed');
