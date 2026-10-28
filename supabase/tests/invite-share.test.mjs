// Invite share growth: ?src=share on invite links, share-after-create flag, join_group carries src.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __testResetAnalytics,
  __testSetGaId,
  initAnalytics,
  readSrcParam,
  setAnalyticsConsent,
  trackJoinGroup,
} from '../../src/lib/analytics.ts';
import {
  consumeShareAfterCreate,
  inviteLinkWithSrc,
  markShareAfterCreate,
} from '../../src/lib/inviteShare.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function isArguments(v) {
  return Object.prototype.toString.call(v) === '[object Arguments]';
}

function installDom({ hash = '#/', hostname = 'app.superpoolsai.com' } = {}) {
  const store = new Map();
  const session = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
  globalThis.sessionStorage = {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v)),
    removeItem: (k) => session.delete(k),
    clear: () => session.clear(),
  };
  globalThis.window = globalThis;
  globalThis.document = {
    title: 'Super Pools',
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ async: false, src: '', id: '' }),
  };
  globalThis.dataLayer = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      hostname,
      origin: `https://${hostname}`,
      pathname: '/',
      search: '',
      hash,
      href: `https://${hostname}/${hash}`,
    },
  });
}

{
  assert.equal(inviteLinkWithSrc('abcd', { hostname: 'app.superpoolsai.com' }), 'https://app.superpoolsai.com/j/abcd');
  assert.equal(inviteLinkWithSrc('abcd', { hostname: 'app.superpoolsai.com', src: 'share' }), 'https://app.superpoolsai.com/j/abcd?src=share');
  assert.match(
    inviteLinkWithSrc('xyz9', { hostname: 'localhost', origin: 'http://localhost:5173', pathname: '/', src: 'share' }),
    /#\/join\/xyz9\?src=share$/,
  );
}

{
  // Flag helpers remain for tests; InviteCard no longer auto-shares on mount.
  installDom();
  markShareAfterCreate();
  assert.equal(consumeShareAfterCreate(), true);
  assert.equal(consumeShareAfterCreate(), false, 'flag is one-shot');
}

{
  __testResetAnalytics();
  installDom({ hash: '#/join/abcd?src=share' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(readSrcParam(), 'share');
  trackJoinGroup({ id: 42, src: readSrcParam() });
  const joins = (window.dataLayer || []).filter((e) => isArguments(e) && e[0] === 'event' && e[1] === 'join_group');
  assert.equal(joins.length, 1);
  assert.equal(joins[0][2].src, 'share');
}

{
  __testResetAnalytics();
  installDom({ hash: '#/join/abcd?src=share' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  trackJoinGroup({ id: 99, src: 'share' });
  const joins = (window.dataLayer || []).filter((e) => isArguments(e) && e[0] === 'event' && e[1] === 'join_group');
  assert.equal(joins.length, 0, 'join_group gated on analytics consent');
}

{
  // Create confirmation: mark before openPool on both NewPool paths; consume on Pool; funnel event exists.
  const newPool = readFileSync(join(root, 'src/pages/NewPool.tsx'), 'utf8');
  assert.equal((newPool.match(/markShareAfterCreate\(\)/g) || []).length, 2, 'both create paths mark share-after-create');
  assert.match(newPool, /markShareAfterCreate\(\);\s*\n\s*await openPool/, 'mark runs immediately before openPool');
  const pool = readFileSync(join(root, 'src/pages/Pool.tsx'), 'utf8');
  assert.match(pool, /consumeShareAfterCreate\(\)/, 'Pool consumes the create flag');
  assert.match(pool, /src:\s*'create'/, 'create confirmation invite uses src=create');
  assert.match(pool, /invite_shared/, 'create confirmation tracks invite_shared on a real share tap');
  assert.match(pool, /setJob\(\{ title: poolName, text: pitch, url: link \}\)/, 'share job text is pitch without a duplicated link');
  const analytics = readFileSync(join(root, 'src/lib/analytics.ts'), 'utf8');
  assert.match(analytics, /FunnelEvent[\s\S]*'invite_shared'/, 'invite_shared is in the FunnelEvent union');
  const sheet = readFileSync(join(root, 'src/components/ShareSheet.tsx'), 'utf8');
  assert.match(sheet, /onShared\?/, 'ShareSheet exposes onShared for real copy/share taps');
}

console.log('invite share tests passed');
