// App GA4: the gtag shim must push Arguments objects (not rest-param arrays), gtag.js loads only after
// Accept, and a page_view is recorded for the current route on Accept and on a consented return visit —
// without double-counting when the router also fires.
import assert from 'node:assert/strict';
import {
  __testResetAnalytics,
  __testSetGaId,
  __testSetPoolCreatedFlushMs,
  analyticsAllowed,
  awaitPoolCreatedFlush,
  captureFirstTouch,
  currentAppPath,
  flushPendingCtaArrival,
  flushPendingPoolCreated,
  getAdsConsent,
  getAnalyticsConsent,
  hasTrackedFirstCall,
  initAnalytics,
  needsConsentChoice,
  newPoolPath,
  noteCtaArrival,
  setAdsConsent,
  setAnalyticsConsent,
  setEnhancedConversionEmail,
  sha256Hex,
  trackFirstCall,
  trackJoinGroup,
  trackPageView,
  trackPoolCreated,
  trackSignUp,
} from '../../src/lib/analytics.ts';

async function flushAndConfirm() {
  const p = flushPendingPoolCreated();
  // gtag.js isn't loaded in unit tests — fire event_callback ourselves to confirm the send.
  for (const e of eventEntries('pool_created')) {
    const cb = e[2] && e[2].event_callback;
    if (typeof cb === 'function') cb();
  }
  await p;
  await awaitPoolCreatedFlush();
}

function isArguments(v) {
  return Object.prototype.toString.call(v) === '[object Arguments]';
}

function dataLayerEntries() {
  return Array.from(window.dataLayer || []);
}

function pageViewEntries() {
  return dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'event' && e[1] === 'page_view');
}

function eventEntries(name) {
  return dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'event' && e[1] === name);
}

function userDataSets() {
  return dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'set' && e[1] === 'user_data');
}

function installDom({ hash = '#/', consent = null, hostname = 'app.superpoolsai.com', webdriver = false } = {}) {
  const store = new Map();
  if (consent) store.set('sp_analytics_consent', consent);
  const session = new Map();
  const cookieJar = new Map();
  const cookieWrites = [];

  function storageApi(map) {
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      clear: () => { map.clear(); },
      get length() { return map.size; },
      key: (i) => [...map.keys()][i] ?? null,
    };
  }

  const localStorage = storageApi(store);
  const sessionStorage = storageApi(session);

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
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set(line) {
      const s = String(line);
      cookieWrites.push(s);
      const segs = s.split(';');
      const first = segs[0] || '';
      const eq = first.indexOf('=');
      if (eq < 0) return;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      let maxAge = null;
      for (const seg of segs.slice(1)) {
        const [ak, av] = seg.split('=').map((x) => x.trim());
        if (String(ak).toLowerCase() === 'max-age') maxAge = Number(av);
      }
      if (maxAge === 0) cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  });

  const location = {
    hash,
    search: '',
    pathname: '/',
    hostname,
    href: `https://${hostname}/${hash}`,
  };

  const listeners = new Map();
  globalThis.window = globalThis;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.location = location;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { webdriver },
  });
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
  delete globalThis.__spAnalyticsTest;
  delete globalThis.__spFlushPoolCreated;

  return { headKids, store, session, cookieJar, cookieWrites };
}

// --- production host allowlist: only prod hosts (or __spAnalyticsTest) inject gtag.js ---
{
  __testResetAnalytics();
  installDom({ hostname: 'app.superpoolsai.com' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(analyticsAllowed(), true);
  assert.ok(document.getElementById('sp-ga4'), 'allowed host loads gtag.js');
}

{
  __testResetAnalytics();
  installDom({ hostname: 'www.superpoolsai.com' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.ok(document.getElementById('sp-ga4'), 'www host loads gtag.js');
}

{
  __testResetAnalytics();
  installDom({ hostname: '127.0.0.1' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(analyticsAllowed(), false);
  assert.equal(document.getElementById('sp-ga4'), null, '127.0.0.1 never loads gtag.js');
  assert.ok(window.gtag, 'dataLayer shim still exists for in-page plumbing');
  const aw = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'config' && String(e[1] || '').startsWith('AW-'));
  assert.equal(aw.length, 0, 'no AW config on non-prod host');
}

{
  __testResetAnalytics();
  installDom({ hostname: 'localhost' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(document.getElementById('sp-ga4'), null, 'localhost never loads gtag.js');
}

{
  __testResetAnalytics();
  installDom({ hostname: 'app.superpoolsai.com', webdriver: true });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(analyticsAllowed(), false);
  assert.equal(document.getElementById('sp-ga4'), null, 'webdriver never loads gtag.js');
  assert.equal(window.__spFlushPoolCreated, undefined, 'flush helper stays off without test flag');
}

{
  __testResetAnalytics();
  installDom({ hostname: '127.0.0.1', webdriver: true });
  window.__spAnalyticsTest = true;
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(analyticsAllowed(), true, 'test flag overrides host/webdriver');
  assert.ok(document.getElementById('sp-ga4'), 'test flag allows gtag.js for explicit harnesses');
  assert.equal(typeof window.__spFlushPoolCreated, 'function', 'flush helper only with test flag');
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

// --- Analytics Accept: load the tag and record the current route; Ads stays off until its own Accept ---
{
  __testResetAnalytics();
  const { headKids } = installDom({ hash: '#/new' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  assert.equal(pageViewEntries().length, 0);

  const awBefore = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'config' && String(e[1] || '').startsWith('AW-'));
  assert.equal(awBefore.length, 0, 'no AW config before Accept');

  setAnalyticsConsent(true);

  assert.equal(getAnalyticsConsent(), 'granted');
  assert.equal(getAdsConsent(), null, 'Ads is a separate choice — one Accept must not grant both');
  assert.equal(localStorage.getItem('sp_ads_consent'), null, 'sp_ads_consent stays unset after Analytics Accept');
  const tag = document.getElementById('sp-ga4');
  assert.ok(tag, 'gtag.js loads on Analytics Accept');
  assert.match(tag.src, /googletagmanager\.com\/gtag\/js\?id=G-TESTID/);
  assert.equal(headKids.length, 1);

  const awAnalyticsOnly = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'config' && String(e[1] || '').startsWith('AW-'));
  assert.equal(awAnalyticsOnly.length, 0, 'no AW config from Analytics alone');

  const views = pageViewEntries();
  assert.equal(views.length, 1, 'one page_view right after Analytics Accept');
  assert.equal(views[0][2].page_path, '/new');
  assert.ok(isArguments(views[0]), 'page_view is an Arguments entry');

  // Router mount for the same path must not double-count
  trackPageView(currentAppPath());
  assert.equal(pageViewEntries().length, 1, 'same path is not counted twice');

  // A real navigation still records
  trackPageView('/privacy');
  assert.equal(pageViewEntries().length, 2, 'a new path is counted');
  assert.equal(pageViewEntries()[1][2].page_path, '/privacy');

  setAdsConsent(true);
  assert.equal(getAdsConsent(), 'granted');
  const awAfter = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'config' && String(e[1] || '').startsWith('AW-'));
  assert.equal(awAfter.length, 1, 'one AW config after Ads Accept');
  assert.equal(awAfter[0][1], 'AW-949617778');
  assert.equal(awAfter[0][2]?.allow_enhanced_conversions, true);
  assert.equal(awAfter.some((e) => e[1] === 'AW-7411462618'), false, 'old customer-id AW is gone');
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

// --- key events: sign_up, pool_created, join_group (consented only; once; no backfill) ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new?src=join_cta&utm_source=invite' });
  __testSetGaId('G-TESTID');
  captureFirstTouch();
  initAnalytics();
  setAnalyticsConsent(true);

  await trackSignUp('email');
  assert.equal(eventEntries('sign_up').length, 1);
  assert.equal(eventEntries('sign_up')[0][2].method, 'email');
  await trackSignUp('email');
  assert.equal(eventEntries('sign_up').length, 1, 'sign_up fires once per browser');

  await trackPoolCreated({ id: 42, pack: 'love-is-blind-s11', sport: 'nhl', kind: 'questions' });
  assert.equal(eventEntries('pool_created').length, 0, 'trackPoolCreated only queues before reload');
  assert.ok(localStorage.getItem('sp_pool_created_pending'), 'pending written before emit');
  assert.equal(localStorage.getItem('sp_pool_created:42'), null, 'once-key unset until gtag callback');
  await flushAndConfirm();
  const created = eventEntries('pool_created');
  assert.equal(created.length, 1);
  assert.equal(created[0][2].pack, 'love-is-blind-s11');
  assert.equal(created[0][2].sport, 'nhl');
  assert.equal(created[0][2].kind, 'questions');
  assert.equal(created[0][2].src, 'join_cta');
  assert.equal(created[0][2].utm_source, 'invite');
  assert.equal(created[0][2].transport_type, undefined, 'no transport_type — send after reload on a stable page');
  assert.equal(typeof created[0][2].event_callback, 'function', 'event_callback confirms the send');
  assert.equal(localStorage.getItem('sp_pool_created:42'), '1', 'once-key set only after event_callback');
  assert.equal(localStorage.getItem('sp_pool_created_pending'), null, 'pending cleared after event_callback');
  await trackPoolCreated({ id: 42, pack: 'love-is-blind-s11' });
  await flushAndConfirm();
  assert.equal(eventEntries('pool_created').length, 1, 'same pool id does not re-fire');
  await trackPoolCreated({ id: 99, sport: 'nfl' });
  await flushAndConfirm();
  assert.equal(eventEntries('pool_created').length, 2, 'a new pool id still fires');

  trackJoinGroup({ id: 7 });
  assert.equal(eventEntries('join_group').length, 1);
  trackJoinGroup({ id: 7 });
  assert.equal(eventEntries('join_group').length, 1, 'same join does not re-fire');
  trackJoinGroup({ id: 8 });
  assert.equal(eventEntries('join_group').length, 2);
}

// --- before Accept: sign_up / join_group stay silent (no backfill); pool_created queues and flushes ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new?src=scoreboard_cta' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  await trackSignUp('email');
  await trackPoolCreated({ id: 1, pack: 'nhl-2026-27', sport: 'nhl', kind: 'questions' });
  trackJoinGroup({ id: 1 });
  assert.equal(eventEntries('sign_up').length, 0, 'no sign_up before Accept');
  assert.equal(eventEntries('pool_created').length, 0, 'no pool_created before Accept');
  assert.equal(eventEntries('join_group').length, 0, 'no join_group before Accept');
  assert.ok(localStorage.getItem('sp_pool_created_pending'), 'queued in pending before Accept');
  assert.equal(localStorage.getItem('sp_pool_created:1'), null, 'once-key not set until confirmed send');

  setAnalyticsConsent(true);
  // Accept kicks flushPending; confirm via callback.
  for (const e of eventEntries('pool_created')) {
    const cb = e[2] && e[2].event_callback;
    if (typeof cb === 'function') cb();
  }
  await awaitPoolCreatedFlush();
  assert.equal(eventEntries('sign_up').length, 0, 'Accept does not backfill sign_up');
  assert.equal(eventEntries('join_group').length, 0, 'Accept does not backfill join_group');
  const flushed = eventEntries('pool_created');
  assert.equal(flushed.length, 1, 'Accept flushes pending pool_created (north-star)');
  assert.equal(flushed[0][2].pack, 'nhl-2026-27');
  assert.equal(flushed[0][2].sport, 'nhl');
  assert.equal(flushed[0][2].kind, 'questions');
  assert.equal(flushed[0][2].src, 'scoreboard_cta');
  assert.equal(localStorage.getItem('sp_pool_created:1'), '1');

  // once-keys were consumed: a later call for the same ids still does not fire again
  await trackSignUp('email');
  await trackPoolCreated({ id: 1, pack: 'nhl-2026-27' });
  await flushAndConfirm();
  trackJoinGroup({ id: 1 });
  assert.equal(eventEntries('sign_up').length, 0);
  assert.equal(eventEntries('pool_created').length, 1, 'flushed pool_created is not duplicated');
  assert.equal(eventEntries('join_group').length, 0);
}

// --- pending pool_created survives a reload, then flushes on consented init ---
{
  __testResetAnalytics();
  const { store } = installDom({ hash: '#/new?src=join_cta' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  await trackPoolCreated({ id: 77, pack: 'love-is-blind-s11', sport: null, kind: 'questions' });
  assert.equal(eventEntries('pool_created').length, 0);
  assert.ok(store.get('sp_pool_created_pending'), 'pending queue is in localStorage');
  assert.equal(store.get('sp_pool_created:77'), undefined, 'once-key not set before confirm');

  // Snapshot what a real reload would keep (localStorage), then reset module/gtag state.
  const kept = new Map(store);
  __testResetAnalytics();
  installDom({ hash: '#/new?src=join_cta' });
  for (const [k, v] of kept) localStorage.setItem(k, v);
  __testSetGaId('G-TESTID');
  initAnalytics();
  assert.equal(eventEntries('pool_created').length, 0, 'still pending until Accept');
  setAnalyticsConsent(true);
  for (const e of eventEntries('pool_created')) {
    const cb = e[2] && e[2].event_callback;
    if (typeof cb === 'function') cb();
  }
  await awaitPoolCreatedFlush();
  assert.equal(eventEntries('pool_created').length, 1, 'reload + Accept still delivers pool_created');
  assert.equal(eventEntries('pool_created')[0][2].pack, 'love-is-blind-s11');
  assert.equal(localStorage.getItem('sp_pool_created_pending'), null, 'pending queue cleared after callback');
}

// --- timeout leaves pending for retry; once-key only after event_callback ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new' });
  __testSetGaId('G-TESTID');
  __testSetPoolCreatedFlushMs(20);
  initAnalytics();
  setAnalyticsConsent(true);
  setAdsConsent(false);

  await trackPoolCreated({ id: 55, pack: 'mlb-post-2026', sport: 'mlb', kind: 'sports' });
  assert.ok(localStorage.getItem('sp_pool_created_pending'), 'queued before emit');
  const emit = flushPendingPoolCreated();
  assert.equal(eventEntries('pool_created').length, 1, 'flush emits on the stable page');
  assert.equal(localStorage.getItem('sp_pool_created:55'), null, 'once-key not set mid-flight');
  // Timeout without callback: pending stays.
  await emit;
  await awaitPoolCreatedFlush();
  assert.equal(localStorage.getItem('sp_pool_created:55'), null, 'timeout does not mark sent');
  assert.ok(localStorage.getItem('sp_pool_created_pending'), 'pending kept for retry');

  // Simulate reload: init flushes again; callback confirms.
  const kept = new Map();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) kept.set(k, localStorage.getItem(k));
  }
  __testResetAnalytics();
  installDom({ hash: '#/new' });
  for (const [k, v] of kept) localStorage.setItem(k, v);
  __testSetGaId('G-TESTID');
  initAnalytics(); // consent already granted → flushPending
  for (const e of eventEntries('pool_created')) {
    const cb = e[2] && e[2].event_callback;
    if (typeof cb === 'function') cb();
  }
  await awaitPoolCreatedFlush();
  assert.equal(eventEntries('pool_created').length, 1, 'pending retry fires after reload');
  assert.equal(eventEntries('pool_created')[0][2].sport, 'mlb');
  assert.equal(localStorage.getItem('sp_pool_created:55'), '1');
}

// --- once-key is set only after gtag event_callback ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new' });
  __testSetGaId('G-TESTID');
  __testSetPoolCreatedFlushMs(5_000);
  initAnalytics();
  setAnalyticsConsent(true);

  await trackPoolCreated({ id: 88, pack: 'world-series-2026', sport: 'mlb', kind: 'questions' });
  const emit = flushPendingPoolCreated();
  assert.equal(eventEntries('pool_created').length, 1);
  assert.equal(localStorage.getItem('sp_pool_created:88'), null, 'not marked before callback');
  assert.ok(localStorage.getItem('sp_pool_created_pending'));
  const cb = eventEntries('pool_created')[0][2].event_callback;
  assert.equal(typeof cb, 'function');
  cb();
  await emit;
  await awaitPoolCreatedFlush();
  assert.equal(localStorage.getItem('sp_pool_created:88'), '1', 'once-key set only after event_callback');
  assert.equal(localStorage.getItem('sp_pool_created_pending'), null);
}

// --- enhanced conversions: hashed email via user_data, only with Ads consent, before sign_up ---
{
  __testResetAnalytics();
  installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  const plain = '  Pat.Example+tag@Gmail.COM ';
  assert.equal(await setEnhancedConversionEmail(plain), false, 'no user_data without Ads Accept');
  assert.equal(userDataSets().length, 0);

  setAnalyticsConsent(true);
  assert.equal(await setEnhancedConversionEmail(plain), false, 'Analytics alone does not unlock hashed email');
  assert.equal(userDataSets().length, 0);

  setAdsConsent(true);
  const expected = await sha256Hex(plain.trim().toLowerCase());
  assert.equal(await setEnhancedConversionEmail(plain), true);
  assert.equal(userDataSets().length, 1);
  const payload = userDataSets()[0][2];
  assert.equal(payload.sha256_email_address, expected);
  assert.equal(Object.keys(payload).join(','), 'sha256_email_address');
  assert.equal(JSON.stringify(payload).includes('@'), false, 'no plaintext email in user_data');
  assert.equal(JSON.stringify(payload).toLowerCase().includes('pat.example'), false);
}

{
  __testResetAnalytics();
  installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  setAdsConsent(true);

  const email = 'new.gm@example.com';
  const expected = await sha256Hex(email);
  await trackSignUp('email', email);

  const sets = userDataSets();
  const signs = eventEntries('sign_up');
  assert.equal(sets.length, 1, 'user_data set once');
  assert.equal(signs.length, 1, 'sign_up once');
  assert.equal(sets[0][2].sha256_email_address, expected);
  const setIdx = dataLayerEntries().indexOf(sets[0]);
  const signIdx = dataLayerEntries().indexOf(signs[0]);
  assert.ok(setIdx >= 0 && signIdx >= 0 && setIdx < signIdx, 'user_data is set before sign_up');
}

// --- Ads-only: AW loads, no analytics page_view; Analytics-only: page_view, no AW ---
{
  __testResetAnalytics();
  installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAdsConsent(true);
  assert.equal(getAdsConsent(), 'granted');
  assert.ok(document.getElementById('sp-ga4'), 'gtag loads for Ads alone');
  const aw = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'config' && e[1] === 'AW-949617778');
  assert.equal(aw.length, 1, 'AW config on Ads Accept');
  assert.equal(pageViewEntries().length, 0, 'no page_view without Analytics');
  trackPageView('/team');
  assert.equal(pageViewEntries().length, 0, 'trackPageView stays silent without Analytics');

  const updates = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'consent' && e[1] === 'update');
  const last = updates[updates.length - 1][2];
  assert.equal(last.analytics_storage, 'denied');
  assert.equal(last.ad_storage, 'granted');
  assert.equal(last.ad_user_data, 'granted');
}

// --- Privacy page withdraw: Analytics off denies analytics_storage and persists ---
{
  __testResetAnalytics();
  installDom({ hash: '#/privacy' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  setAdsConsent(true);
  assert.equal(getAnalyticsConsent(), 'granted');
  const before = dataLayerEntries().length;
  setAnalyticsConsent(false);
  assert.equal(getAnalyticsConsent(), 'denied');
  const updates = dataLayerEntries().slice(before).filter((e) => isArguments(e) && e[0] === 'consent' && e[1] === 'update');
  assert.ok(updates.length >= 1, 'consent update on withdraw');
  const flags = updates[updates.length - 1][2];
  assert.equal(flags.analytics_storage, 'denied');
  // Ads stays whatever it was until its own control is flipped
  assert.equal(flags.ad_user_data, 'granted');
  assert.equal(flags.ad_storage, 'granted');
  setAdsConsent(false);
  const afterAds = dataLayerEntries().filter((e) => isArguments(e) && e[0] === 'consent' && e[1] === 'update');
  const adsFlags = afterAds[afterAds.length - 1][2];
  assert.equal(adsFlags.ad_user_data, 'denied');
  assert.equal(adsFlags.ad_storage, 'denied');
}

// --- Consent change notifies same-tab listeners (Privacy switches while banner Accept is pressed) ---
{
  __testResetAnalytics();
  installDom({ hash: '#/privacy' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  let n = 0;
  const on = () => { n += 1; };
  window.addEventListener('sp-consent-change', on);
  setAnalyticsConsent(true);
  setAdsConsent(true);
  window.removeEventListener('sp-consent-change', on);
  assert.equal(n, 2, 'each consent write fires sp-consent-change');
}

// --- cta_arrival: once per session per src; queues until Accept; host gate ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new?src=home' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);

  noteCtaArrival('home');
  assert.equal(eventEntries('cta_arrival').length, 1);
  assert.equal(eventEntries('cta_arrival')[0][2].src, 'home');
  assert.equal(sessionStorage.getItem('sp_cta_arrival:home'), '1');

  noteCtaArrival('home');
  assert.equal(eventEntries('cta_arrival').length, 1, 'same src once per session');

  noteCtaArrival('lib');
  assert.equal(eventEntries('cta_arrival').length, 2);
  assert.equal(eventEntries('cta_arrival')[1][2].src, 'lib');
}

{
  __testResetAnalytics();
  const { session } = installDom({ hash: '#/new?src=traitors' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  noteCtaArrival('traitors');
  assert.equal(eventEntries('cta_arrival').length, 0, 'silent before Accept');
  assert.ok(session.get('sp_cta_arrival_pending'), 'queued pending');
  assert.equal(sessionStorage.getItem('sp_cta_arrival:traitors'), null);

  setAnalyticsConsent(true);
  assert.equal(eventEntries('cta_arrival').length, 1, 'Accept flushes pending cta_arrival');
  assert.equal(eventEntries('cta_arrival')[0][2].src, 'traitors');
  assert.equal(sessionStorage.getItem('sp_cta_arrival:traitors'), '1');
  assert.equal(sessionStorage.getItem('sp_cta_arrival_pending'), null);

  noteCtaArrival('traitors');
  assert.equal(eventEntries('cta_arrival').length, 1, 'still once after flush');
}

{
  __testResetAnalytics();
  installDom({ hash: '#/new?src=hockey', hostname: '127.0.0.1' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  noteCtaArrival('hockey');
  assert.equal(eventEntries('cta_arrival').length, 0, 'non-prod host never sends cta_arrival');
  assert.ok(sessionStorage.getItem('sp_cta_arrival_pending'), 'stays pending when gate fails');
  flushPendingCtaArrival();
  assert.equal(eventEntries('cta_arrival').length, 0);
}

function readSpConsentCookie() {
  const raw = document.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== 'sp_consent') continue;
    let val = part.slice(i + 1).trim();
    try { val = decodeURIComponent(val); } catch { /* keep */ }
    return val;
  }
  return null;
}

// --- shared sp_consent cookie: write on accept/decline; hydrate; never on localhost ---
{
  __testResetAnalytics();
  const { cookieWrites } = installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  assert.equal(readSpConsentCookie(), null, 'cookie waits until both choices exist');
  setAdsConsent(false);
  assert.equal(readSpConsentCookie(), 'a=granted;d=denied');
  const last = cookieWrites[cookieWrites.length - 1] || '';
  assert.match(last, /Domain=\.superpoolsai\.com/);
  assert.match(last, /Max-Age=31536000/);
  assert.match(last, /SameSite=Lax/);
  assert.match(last, /Secure/);
  assert.match(last, /Path=\//);
}

{
  __testResetAnalytics();
  const { cookieWrites } = installDom({ hash: '#/' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(false);
  setAdsConsent(false);
  assert.equal(readSpConsentCookie(), 'a=denied;d=denied', 'decline writes cookie');
  assert.ok(cookieWrites.some((w) => w.includes('sp_consent=')));
}

{
  __testResetAnalytics();
  const { cookieJar, store } = installDom({ hash: '#/new', hostname: '127.0.0.1' });
  __testSetGaId('G-TESTID');
  initAnalytics();
  setAnalyticsConsent(true);
  setAdsConsent(true);
  assert.equal(cookieJar.has('sp_consent'), false, 'no cookie on localhost');
  assert.equal(store.get('sp_analytics_consent'), 'granted', 'localStorage still set');
}

{
  __testResetAnalytics();
  // Landing already chose: cookie present, empty localStorage → hydrate, sheet not needed.
  const { store } = installDom({ hash: '#/new' });
  document.cookie = `sp_consent=${encodeURIComponent('a=granted;d=denied')}; Path=/`;
  __testSetGaId('G-TESTID');
  assert.equal(store.has('sp_analytics_consent'), false);
  // needsConsentChoice → storeGet → hydrate fills keys
  assert.equal(needsConsentChoice(), false, 'hydrated keys skip the sheet');
  assert.equal(getAnalyticsConsent(), 'granted');
  assert.equal(getAdsConsent(), 'denied');
  assert.equal(store.get('sp_analytics_consent'), 'granted');
  assert.equal(store.get('sp_ads_consent'), 'denied');
}

{
  __testResetAnalytics();
  const again = installDom({ hash: '#/new' });
  document.cookie = `sp_consent=${encodeURIComponent('a=denied;d=granted')}; Path=/`;
  __testSetGaId('G-TESTID');
  initAnalytics();
  assert.equal(getAnalyticsConsent(), 'denied');
  assert.equal(getAdsConsent(), 'granted');
  assert.equal(needsConsentChoice(), false);
  assert.equal(again.store.get('sp_analytics_consent'), 'denied');
}

{
  __testResetAnalytics();
  // Existing localStorage wins over cookie (do not overwrite).
  installDom({ hash: '#/', consent: 'denied' });
  localStorage.setItem('sp_ads_consent', 'denied');
  document.cookie = `sp_consent=${encodeURIComponent('a=granted;d=granted')}; Path=/`;
  __testSetGaId('G-TESTID');
  initAnalytics();
  assert.equal(getAnalyticsConsent(), 'denied', 'localStorage keeps its own answer');
  assert.equal(getAdsConsent(), 'denied');
}

console.log('analytics tests passed');
