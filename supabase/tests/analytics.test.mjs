// App GA4: the gtag shim must push Arguments objects (not rest-param arrays), gtag.js loads only after
// Accept, and a page_view is recorded for the current route on Accept and on a consented return visit —
// without double-counting when the router also fires.
import assert from 'node:assert/strict';
import {
  __testResetAnalytics,
  __testSetGaId,
  currentAppPath,
  getAnalyticsConsent,
  hasTrackedFirstCall,
  initAnalytics,
  newPoolPath,
  setAnalyticsConsent,
  trackFirstCall,
  trackPageView,
} from '../../src/lib/analytics.ts';

function isArguments(v) {
  return Object.prototype.toString.call(v) === '[object Arguments]';
}

function dataLayerEntries() {
  return Array.from(window.dataLayer || []);
}

function pageViewEntries() {
  return dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'event' && e[1] === 'page_view');
}

function installDom({ hash = '#/', consent = null } = {}) {
  const store = new Map();
  if (consent) store.set('sp_analytics_consent', consent);

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const headKids = [];
  const head = {
    appendChild(node) {
      headKids.push(node);
      return node;
    },
  };
  const document = {
    title: 'Super Pools',
    referrer: '',
    head,
    body: {},
    getElementById(id) {
      return headKids.find((n) => n.id === id) || null;
    },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        id: '',
        async: false,
        src: '',
        remove() {
          const i = headKids.indexOf(node);
          if (i >= 0) headKids.splice(i, 1);
        },
      };
      return node;
    },
  };

  const location = {
    hash,
    search: '',
    pathname: '/',
    href: `https://app.superpoolsai.com/${hash}`,
  };

  const listeners = new Map();
  globalThis.window = globalThis;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.location = location;
  globalThis.addEventListener = (type, fn, opts) => {
    const list = listeners.get(type) || [];
    list.push({ fn, once: !!(opts && opts.once) });
    listeners.set(type, list);
  };
  globalThis.removeEventListener = (type, fn) => {
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter((x) => x.fn !== fn));
  };
  globalThis.dispatchEvent = (ev) => {
    const type = ev && ev.type;
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter((x) => {
      x.fn(ev);
      return !x.once;
    }));
    return true;
  };
  delete globalThis.gtag;
  delete globalThis.dataLayer;

  return { headKids, store };
}

// --- no measurement ID: silence ---
{
  __testResetAnalytics();
  installDom();
  __testSetGaId('');
  initAnalytics();
  assert.equal(window.dataLayer, undefined, 'no dataLayer when the ID is empty');
  setAnalyticsConsent(true);
  assert.equal(document.getElementById('sp-ga4'), null, 'no gtag.js without an ID');
}

// --- before Accept: shim may queue consent defaults, but no tag and no page_view ---
{
  __testResetAnalytics();
  const { headKids } = installDom({ hash: '#/new' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  assert.equal(getAnalyticsConsent(), null);
  assert.ok(window.gtag, 'shim is ready before consent');
  assert.ok(Array.isArray(window.dataLayer) && window.dataLayer.length > 0, 'consent default is queued');
  for (const entry of dataLayerEntries()) {
    assert.ok(isArguments(entry), 'every dataLayer push is an Arguments object, not an array');
  }
  assert.equal(pageViewEntries().length, 0, 'no page_view before Accept');
  assert.equal(headKids.length, 0, 'gtag.js is not loaded before Accept');
  assert.equal(document.getElementById('sp-ga4'), null);
}

// --- Accept: load the tag and record the current route once ---
{
  __testResetAnalytics();
  const { headKids } = installDom({ hash: '#/new' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  assert.equal(pageViewEntries().length, 0);

  setAnalyticsConsent(true);

  assert.equal(getAnalyticsConsent(), 'granted');
  const tag = document.getElementById('sp-ga4');
  assert.ok(tag, 'gtag.js loads on Accept');
  assert.match(tag.src, /googletagmanager\.com\/gtag\/js\?id=G-TESTID/);
  assert.equal(headKids.length, 1);

  const views = pageViewEntries();
  assert.equal(views.length, 1, 'one page_view right after Accept');
  assert.equal(views[0][2].page_path, '/new');
  assert.ok(isArguments(views[0]), 'page_view is an Arguments entry');

  // Router mount for the same path must not double-count
  trackPageView(currentAppPath());
  assert.equal(pageViewEntries().length, 1, 'same path is not counted twice');

  // A real navigation still records
  trackPageView('/privacy');
  assert.equal(pageViewEntries().length, 2, 'a new path is counted');
  assert.equal(pageViewEntries()[1][2].page_path, '/privacy');
}

// --- consented return visit: tag + page_view on init, no double-count ---
{
  __testResetAnalytics();
  installDom({ hash: '#/p/love-is-blind', consent: 'granted' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  assert.ok(document.getElementById('sp-ga4'), 'gtag.js loads when consent was already granted');
  const views = pageViewEntries();
  assert.equal(views.length, 1, 'one page_view on consented first load');
  assert.equal(views[0][2].page_path, '/p/love-is-blind');
  assert.ok(isArguments(views[0]));

  trackPageView('/p/love-is-blind');
  assert.equal(pageViewEntries().length, 1, 'router remount does not double-count');
}

// --- rest-param array would be wrong: prove the shim never pushes one ---
{
  __testResetAnalytics();
  installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  for (const entry of dataLayerEntries()) {
    assert.equal(Array.isArray(entry), false, 'dataLayer must not hold Arrays (gtag.js ignores them)');
    assert.ok(isArguments(entry));
  }
}

// --- first-call flag + viral CTA paths (join card / scoreboard; src stays a URL param) ---
{
  __testResetAnalytics();
  installDom({ hash: '#/' });
  __testSetGaId('');
  assert.equal(hasTrackedFirstCall(), false);
  assert.equal(newPoolPath('join_cta'), '/new?src=join_cta');
  assert.equal(newPoolPath('scoreboard_cta'), '/new?src=scoreboard_cta');

  let heard = false;
  window.addEventListener('sp-first-call', () => { heard = true; }, { once: true });
  trackFirstCall('pickem');
  assert.equal(hasTrackedFirstCall(), true);
  assert.equal(heard, true, 'sp-first-call fires so the home card can appear');
  trackFirstCall('pickem');
  assert.equal(hasTrackedFirstCall(), true, 'second call is a no-op');
}

console.log('analytics tests passed');
