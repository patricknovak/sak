// App GA4: the gtag shim must push Arguments objects (not rest-param arrays), gtag.js loads only after
// Accept, and a page_view is recorded for the current route on Accept and on a consented return visit —
// without double-counting when the router also fires.
import assert from 'node:assert/strict';
import {
  __testResetAnalytics,
  __testSetGaId,
  captureFirstTouch,
  currentAppPath,
  getAdsConsent,
  getAnalyticsConsent,
  hasTrackedFirstCall,
  initAnalytics,
  newPoolPath,
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

function installDom({ hash = '#/', consent = null } = {}) {
  const store = new Map();
  if (consent) store.set('sp_analytics_consent', consent);

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
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
  assert.equal(getAdsConsent(), null, 'Ads is a separate choice');
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

  trackPoolCreated({ id: 42, pack: 'love-is-blind-s11', sport: 'nhl', kind: 'questions' });
  const created = eventEntries('pool_created');
  assert.equal(created.length, 1);
  assert.equal(created[0][2].pack, 'love-is-blind-s11');
  assert.equal(created[0][2].sport, 'nhl');
  assert.equal(created[0][2].kind, 'questions');
  assert.equal(created[0][2].src, 'join_cta');
  assert.equal(created[0][2].utm_source, 'invite');
  assert.equal(created[0][2].transport_type, 'beacon', 'pool_created uses beacon so a reload does not drop it');
  trackPoolCreated({ id: 42, pack: 'love-is-blind-s11' });
  assert.equal(eventEntries('pool_created').length, 1, 'same pool id does not re-fire');
  trackPoolCreated({ id: 99, sport: 'nfl' });
  assert.equal(eventEntries('pool_created').length, 2, 'a new pool id still fires');

  trackJoinGroup({ id: 7 });
  assert.equal(eventEntries('join_group').length, 1);
  trackJoinGroup({ id: 7 });
  assert.equal(eventEntries('join_group').length, 1, 'same join does not re-fire');
  trackJoinGroup({ id: 8 });
  assert.equal(eventEntries('join_group').length, 2);
}

// --- before Accept: key events are silent, and Accept later does not backfill ---
{
  __testResetAnalytics();
  installDom({ hash: '#/new?src=scoreboard_cta' });
  __testSetGaId('G-TESTID');
  initAnalytics();

  await trackSignUp('email');
  trackPoolCreated({ id: 1, pack: 'nhl-2026-27', sport: 'nhl' });
  trackJoinGroup({ id: 1 });
  assert.equal(eventEntries('sign_up').length, 0, 'no sign_up before Accept');
  assert.equal(eventEntries('pool_created').length, 0, 'no pool_created before Accept');
  assert.equal(eventEntries('join_group').length, 0, 'no join_group before Accept');

  setAnalyticsConsent(true);
  assert.equal(eventEntries('sign_up').length, 0, 'Accept does not backfill sign_up');
  assert.equal(eventEntries('pool_created').length, 0, 'Accept does not backfill pool_created');
  assert.equal(eventEntries('join_group').length, 0, 'Accept does not backfill join_group');

  // marks were consumed: a later success for the same ids still does not fire
  await trackSignUp('email');
  trackPoolCreated({ id: 1, pack: 'nhl-2026-27' });
  trackJoinGroup({ id: 1 });
  assert.equal(eventEntries('sign_up').length, 0);
  assert.equal(eventEntries('pool_created').length, 0);
  assert.equal(eventEntries('join_group').length, 0);
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

console.log('analytics tests passed');
