// Consented GA4 (Consent Mode v2) and first-touch UTM/referrer for Super Pools.
// Measurement ID from VITE_GA4_ID (.env.production); empty means nothing loads and no network calls.
// Funnel events carry no PII (no email, name, or user id). Enhanced conversions send only a SHA-256 of the email.
// Remote gtag.js / Ads hits only leave production hostnames (never localhost, CI, or webdriver).

const CONSENT_KEY = 'sp_analytics_consent';
const ADS_CONSENT_KEY = 'sp_ads_consent';
// Shared across marketing + app (Domain=.superpoolsai.com). Value: a=granted|denied;d=granted|denied.
const CONSENT_COOKIE = 'sp_consent';
const CONSENT_COOKIE_MAX_AGE = 31536000;
const TOUCH_KEY = 'sp_first_touch';
const FIRST_CALL_KEY = 'sp_first_call';
const SIGN_UP_KEY = 'sp_sign_up';
const POOL_CREATED_PENDING_KEY = 'sp_pool_created_pending';
const CTA_ARRIVAL_PENDING_KEY = 'sp_cta_arrival_pending';
const poolCreatedKey = (id: string | number) => `sp_pool_created:${id}`;
const joinGroupKey = (id: string | number) => `sp_join_group:${id}`;
const ctaArrivalKey = (src: string) => `sp_cta_arrival:${src}`;

// Google Ads tag (AW-949617778): enhanced conversions on the same Google tag as GA4.
// Not the Ads customer ID (741-146-2618) — that is not a valid AW- tag id.
const ADS_ID = 'AW-949617778';

// Only these hosts may inject googletagmanager and send GA4 / AW hits.
const PROD_ANALYTICS_HOSTS = new Set([
  'app.superpoolsai.com',
  'superpoolsai.com',
  'www.superpoolsai.com',
]);

// Tests (unit/e2e) set window.__spAnalyticsTest to exercise dispatch / flush on non-prod hosts.
const ANALYTICS_TEST_FLAG = '__spAnalyticsTest';

// Tests inject a measurement ID without Vite. Production always reads VITE_GA4_ID.
let testGaId: string | undefined;

export function __testSetGaId(id: string | undefined) {
  testGaId = id;
}

function measurementId(): string {
  if (testGaId !== undefined) return testGaId;
  return (import.meta.env.VITE_GA4_ID as string | undefined)?.trim() ?? '';
}

function analyticsTestOverride(): boolean {
  try {
    return typeof window !== 'undefined'
      && !!(window as unknown as Record<string, unknown>)[ANALYTICS_TEST_FLAG];
  } catch {
    return false;
  }
}

// True when remote gtag.js / Ads config may run. In-page dataLayer plumbing still works without this.
export function analyticsAllowed(): boolean {
  if (analyticsTestOverride()) return true;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  const host = typeof location !== 'undefined' ? (location.hostname || '').toLowerCase() : '';
  return PROD_ANALYTICS_HOSTS.has(host);
}

export type AnalyticsConsent = 'granted' | 'denied' | null;

export type FirstTouch = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __spAnalyticsTest?: boolean;
    __spFlushPoolCreated?: () => void;
  }
}

function rawGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function rawSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

// Cookie only on *.superpoolsai.com (never localhost / Pages / preview hosts).
function consentCookieHostOk(): boolean {
  if (typeof location === 'undefined') return false;
  const h = (location.hostname || '').toLowerCase();
  return h === 'superpoolsai.com' || h.endsWith('.superpoolsai.com');
}

function parseConsentCookie(): { a?: 'granted' | 'denied'; d?: 'granted' | 'denied' } {
  if (typeof document === 'undefined') return {};
  try {
    const raw = document.cookie || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() !== CONSENT_COOKIE) continue;
      let val = part.slice(i + 1).trim();
      try { val = decodeURIComponent(val); } catch { /* keep raw */ }
      const out: { a?: 'granted' | 'denied'; d?: 'granted' | 'denied' } = {};
      for (const bit of val.split(';')) {
        const eq = bit.indexOf('=');
        if (eq < 0) continue;
        const k = bit.slice(0, eq).trim();
        const v = bit.slice(eq + 1).trim();
        if ((k === 'a' || k === 'd') && (v === 'granted' || v === 'denied')) out[k] = v;
      }
      return out;
    }
  } catch { /* private / no cookie */ }
  return {};
}

function writeConsentCookie(a: string, d: string) {
  if (!consentCookieHostOk()) return;
  if ((a !== 'granted' && a !== 'denied') || (d !== 'granted' && d !== 'denied')) return;
  if (typeof document === 'undefined') return;
  try {
    const value = encodeURIComponent(`a=${a};d=${d}`);
    document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Domain=.superpoolsai.com; Max-Age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
  } catch { /* ignore */ }
}

function syncConsentCookie() {
  const a = rawGet(CONSENT_KEY);
  const d = rawGet(ADS_CONSENT_KEY);
  if (a !== 'granted' && a !== 'denied') return;
  if (d !== 'granted' && d !== 'denied') return;
  writeConsentCookie(a, d);
}

// Empty localStorage keys pick up the shared cookie so the sheet is not asked again.
function hydrateConsentFromCookie() {
  const parsed = parseConsentCookie();
  if (parsed.a && rawGet(CONSENT_KEY) == null) rawSet(CONSENT_KEY, parsed.a);
  if (parsed.d && rawGet(ADS_CONSENT_KEY) == null) rawSet(ADS_CONSENT_KEY, parsed.d);
}

function storeGet(key: string): string | null {
  if (key === CONSENT_KEY || key === ADS_CONSENT_KEY) {
    const v = rawGet(key);
    if (v == null) {
      hydrateConsentFromCookie();
      return rawGet(key);
    }
    return v;
  }
  return rawGet(key);
}
function storeSet(key: string, value: string) {
  rawSet(key, value);
  if (key === CONSENT_KEY || key === ADS_CONSENT_KEY) syncConsentCookie();
}
function sessionGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode */ }
}
function sessionRemove(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* private mode */ }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  const v = storeGet(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

// Ads measurement (ad_storage + ad_user_data + AW tag + hashed email). Separate from analytics.
export function getAdsConsent(): AnalyticsConsent {
  const v = storeGet(ADS_CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

// #286 split: Analytics and Ads are separate choices. Do not mirror one onto the other —
// a single Analytics Accept must not set sp_ads_consent (and vice versa).
export function needsConsentChoice(): boolean {
  return getAnalyticsConsent() == null || getAdsConsent() == null;
}

export function hasGaId(): boolean {
  return measurementId().length > 0;
}

// Capture UTM + document.referrer on the first visit only (first-touch).
export function captureFirstTouch(): FirstTouch {
  const existing = readFirstTouch();
  if (existing) return existing;
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  // HashRouter: UTMs may sit on the search before the hash, or inside the hash query
  const hashQ = typeof location !== 'undefined' && location.hash.includes('?')
    ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1))
    : null;
  const get = (k: string) => {
    const v = q.get(k) || hashQ?.get(k) || '';
    return v.trim().slice(0, 200) || null;
  };
  const touch: FirstTouch = {
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_content: get('utm_content'),
    utm_term: get('utm_term'),
    referrer: (typeof document !== 'undefined' && document.referrer ? document.referrer.slice(0, 500) : null),
  };
  storeSet(TOUCH_KEY, JSON.stringify(touch));
  return touch;
}

export function readFirstTouch(): FirstTouch | null {
  const raw = storeGet(TOUCH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as FirstTouch; } catch { return null; }
}

// Fields safe to send with a waitlist row or pool signup (no empty strings).
export function attributionFields(): Record<string, string> {
  const t = readFirstTouch() ?? captureFirstTouch();
  const out: Record<string, string> = {};
  (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'] as const).forEach((k) => {
    const v = t[k];
    if (v) out[k] = v;
  });
  return out;
}

// HashRouter path as AnalyticsRoute records it: "/team" or "/p/foo?x=1".
export function currentAppPath(): string {
  if (typeof location === 'undefined') return '/';
  const h = location.hash || '';
  if (h.startsWith('#')) {
    const body = h.slice(1) || '/';
    return body.startsWith('/') ? body : `/${body}`;
  }
  return `${location.pathname || '/'}${location.search || ''}`;
}

// Last path we recorded: skips Accept + first AnalyticsRoute mount, and StrictMode's second effect.
let lastTrackedPath: string | null = null;

function ensureGtag() {
  const GA_ID = measurementId();
  if (!GA_ID || typeof window === 'undefined') return;
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads Arguments objects from dataLayer; a rest-param array is ignored and never reaches g/collect.
  window.gtag = function gtag() {
    window.dataLayer!.push(arguments);
  };
  // Consent Mode v2 defaults: analytics denied until the visitor accepts
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: false, anonymize_ip: true });
}

function loadTag() {
  const GA_ID = measurementId();
  if (!GA_ID || typeof document === 'undefined') return;
  // Local / CI / webdriver builds keep the dataLayer stub but never pull gtag.js.
  if (!analyticsAllowed()) return;
  if (document.getElementById('sp-ga4')) return;
  ensureGtag();
  const s = document.createElement('script');
  s.id = 'sp-ga4';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

// Split consent: analytics_storage alone for Analytics; ad_storage + ad_user_data for Ads.
// ad_personalization stays denied. gtag.js loads when either choice is granted.
function applyConsentFlags() {
  window.gtag?.('consent', 'update', {
    analytics_storage: getAnalyticsConsent() === 'granted' ? 'granted' : 'denied',
    ad_user_data: getAdsConsent() === 'granted' ? 'granted' : 'denied',
    ad_storage: getAdsConsent() === 'granted' ? 'granted' : 'denied',
    ad_personalization: 'denied',
  });
}

export function hasAdsUserDataConsent(): boolean {
  return getAdsConsent() === 'granted';
}

function configAdsTag() {
  if (!measurementId() || typeof window === 'undefined') return;
  if (!analyticsAllowed()) return;
  if (getAdsConsent() !== 'granted') return;
  window.gtag?.('config', ADS_ID, { allow_enhanced_conversions: true });
}

function loadTagsIfNeeded() {
  if (getAnalyticsConsent() === 'granted' || getAdsConsent() === 'granted') loadTag();
  if (getAdsConsent() === 'granted') configAdsTag();
}

// Call once at app start: capture first-touch, and load gtag only when consent was already granted.
export function initAnalytics() {
  // Before needsConsentChoice / ConsentBanner: fill empty keys from the shared cookie.
  hydrateConsentFromCookie();
  captureFirstTouch();
  if (typeof window !== 'undefined' && analyticsTestOverride()) {
    // e2e only (window.__spAnalyticsTest): stubbed reload flushes pending pool_created.
    window.__spFlushPoolCreated = () => {
      void flushPendingPoolCreated();
    };
  }
  if (!measurementId()) return;
  ensureGtag();
  applyConsentFlags();
  loadTagsIfNeeded();
  if (getAnalyticsConsent() === 'granted') {
    // First load of a consented return visit: record this route (AnalyticsRoute will not double-count).
    trackPageView(currentAppPath());
    // Retry any pool_created that was queued (consent off, or before openPool's reload).
    void flushPendingPoolCreated();
    flushPendingCtaArrival();
  }
}

// Same-tab signal so the Privacy page switches refresh when Accept is pressed from the banner.
const CONSENT_CHANGE = 'sp-consent-change';
function notifyConsentChange() {
  try { window.dispatchEvent(new Event(CONSENT_CHANGE)); } catch { /* no window */ }
}

export function setAnalyticsConsent(granted: boolean) {
  storeSet(CONSENT_KEY, granted ? 'granted' : 'denied');
  notifyConsentChange();
  if (!measurementId()) return;
  ensureGtag();
  applyConsentFlags();
  loadTagsIfNeeded();
  if (granted) {
    // Current page at Accept: route has not changed, so AnalyticsRoute would never fire.
    trackPageView(currentAppPath());
    // North-star: pools opened before Accept still count once Accept lands (pending queue).
    void flushPendingPoolCreated();
    flushPendingCtaArrival();
  }
}

export function setAdsConsent(granted: boolean) {
  storeSet(ADS_CONSENT_KEY, granted ? 'granted' : 'denied');
  notifyConsentChange();
  if (!measurementId()) return;
  ensureGtag();
  applyConsentFlags();
  loadTagsIfNeeded();
}

// SHA-256 hex of normalized email (trim + lowercase). Never returns the plaintext.
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Enhanced conversions: gtag('set','user_data',{ sha256_email_address }) when the user typed an email and
// Ads consent has granted ad_user_data. No-op without ads consent or measurement ID. Never sends plaintext.
export async function setEnhancedConversionEmail(email: string): Promise<boolean> {
  if (!measurementId() || !hasAdsUserDataConsent()) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) return false;
  ensureGtag();
  const hash = await sha256Hex(normalized);
  window.gtag?.('set', 'user_data', { sha256_email_address: hash });
  return true;
}

export function trackPageView(path: string) {
  if (!measurementId() || getAnalyticsConsent() !== 'granted') return;
  if (path === lastTrackedPath) return;
  lastTrackedPath = path;
  ensureGtag();
  window.gtag?.('event', 'page_view', {
    page_path: path.slice(0, 200),
    page_title: typeof document !== 'undefined' ? document.title.slice(0, 120) : undefined,
  });
}

export type FunnelEvent = 'pool_start' | 'pool_created' | 'invite_share' | 'join' | 'join_group' | 'first_call' | 'sign_up' | 'cta_arrival';

export function track(event: FunnelEvent, params?: Record<string, string | number | boolean | undefined>) {
  if (!measurementId() || getAnalyticsConsent() !== 'granted') return;
  ensureGtag();
  const clean: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      // never send emails or free-text that could hold PII
      if (/email|name|user|phone|password/i.test(k)) continue;
      clean[k] = typeof v === 'string' ? v.slice(0, 100) : v;
    }
  }
  window.gtag?.('event', event, clean);
}

function readPendingCtaArrival(): string[] {
  const raw = sessionGet(CTA_ARRIVAL_PENDING_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.map((s) => String(s).slice(0, 80)).filter(Boolean);
  } catch {
    return [];
  }
}

function writePendingCtaArrival(list: string[]) {
  const uniq = [...new Set(list.map((s) => s.slice(0, 80)).filter(Boolean))];
  if (!uniq.length) sessionRemove(CTA_ARRIVAL_PENDING_KEY);
  else sessionSet(CTA_ARRIVAL_PENDING_KEY, JSON.stringify(uniq));
}

// Landing CTA measurement on the app: once per session per src, after Analytics Accept.
// Call on #/new when ?src= is present; queues until consent + host allowlist.
export function noteCtaArrival(src?: string | null) {
  const s = (src ?? readSrcParam())?.trim().slice(0, 80);
  if (!s) return;
  if (sessionGet(ctaArrivalKey(s)) === '1') return;
  const pending = readPendingCtaArrival();
  if (!pending.includes(s)) writePendingCtaArrival([...pending, s]);
  flushPendingCtaArrival();
}

export function flushPendingCtaArrival() {
  if (!measurementId() || getAnalyticsConsent() !== 'granted') return;
  // Same gate as remote tag load (#304): no localhost / webdriver hits.
  if (!analyticsAllowed()) return;
  const pending = readPendingCtaArrival();
  if (!pending.length) return;
  const left: string[] = [];
  for (const src of pending) {
    if (sessionGet(ctaArrivalKey(src)) === '1') continue;
    track('cta_arrival', { src });
    sessionSet(ctaArrivalKey(src), '1');
  }
  writePendingCtaArrival(left);
}

// HashRouter: ?src= on the search or inside the hash (#/new?src=join_cta).
export function readSrcParam(): string | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search || '');
  const hashQ = location.hash.includes('?')
    ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1))
    : null;
  const v = (q.get('src') || hashQ?.get('src') || '').trim().slice(0, 80);
  return v || null;
}

// Attribution params safe for GA4 (first-touch UTM + optional src). No PII.
function attributionParams(extra?: { src?: string | null }): Record<string, string> {
  const t = readFirstTouch() ?? captureFirstTouch();
  const out: Record<string, string> = {};
  (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const).forEach((k) => {
    const v = t[k];
    if (v) out[k] = v.slice(0, 100);
  });
  const src = (extra?.src ?? readSrcParam())?.trim().slice(0, 80);
  if (src) out.src = src;
  return out;
}

// New account created (email/password). Once per browser; mark even without consent so Accept later never backfills.
// When the typed email is passed, set enhanced-conversion user_data (hashed) immediately before sign_up.
export async function trackSignUp(method: 'email' | 'guest' = 'email', email?: string | null) {
  if (storeGet(SIGN_UP_KEY) === '1') return;
  storeSet(SIGN_UP_KEY, '1');
  if (email) await setEnhancedConversionEmail(email);
  track('sign_up', { method });
}

export type PoolCreatedParams = {
  id?: number | string | null;
  pack?: string | null;
  sport?: string | null;
  kind?: string | null;
  src?: string | null;
};

type PoolCreatedPayload = {
  id?: string;
  pack?: string;
  sport?: string;
  kind?: string;
  src?: string | null;
};

function readPendingPoolCreated(): PoolCreatedPayload[] {
  const raw = storeGet(POOL_CREATED_PENDING_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as PoolCreatedPayload[]) : [];
  } catch { return []; }
}

function writePendingPoolCreated(list: PoolCreatedPayload[]) {
  if (!list.length) {
    try { localStorage.removeItem(POOL_CREATED_PENDING_KEY); } catch { /* private mode */ }
    return;
  }
  storeSet(POOL_CREATED_PENDING_KEY, JSON.stringify(list));
}

// How long we wait for gtag's event_callback before giving up (pending stays for a later retry).
// GA4 often batches ~5s; mark sent only inside event_callback, never on this timer.
let poolCreatedFlushMs = 8000;
export function __testSetPoolCreatedFlushMs(ms: number) {
  poolCreatedFlushMs = ms;
}

// In-flight emits after a flush (reload / Accept); tests can await these.
const poolCreatedFlushes = new Set<Promise<void>>();
const poolCreatedTimers = new Set<number>();

export function awaitPoolCreatedFlush(): Promise<void> {
  if (!poolCreatedFlushes.size) return Promise.resolve();
  return Promise.all([...poolCreatedFlushes]).then(() => undefined);
}

function markPoolCreatedSent(payload: PoolCreatedPayload) {
  if (payload.id) storeSet(poolCreatedKey(payload.id), '1');
  const pending = readPendingPoolCreated().filter((p) => {
    if (payload.id) return p.id !== payload.id;
    return !(p.pack === payload.pack && p.sport === payload.sport && p.kind === payload.kind && !p.id);
  });
  writePendingPoolCreated(pending);
}

function enqueuePending(payload: PoolCreatedPayload) {
  const pending = readPendingPoolCreated();
  if (payload.id && pending.some((p) => p.id === payload.id)) return;
  if (payload.id && storeGet(poolCreatedKey(payload.id)) === '1') return;
  pending.push(payload);
  writePendingPoolCreated(pending);
}

// Fire gtag on a stable page (after reload). Mark once-key / clear pending only in event_callback.
// On timeout, leave pending so the next init can retry — never treat the timer as a send.
function emitPoolCreated(payload: PoolCreatedPayload): Promise<void> {
  if (!measurementId() || getAnalyticsConsent() !== 'granted') return Promise.resolve();
  if (payload.id && storeGet(poolCreatedKey(payload.id)) === '1') return Promise.resolve();
  ensureGtag();
  const attrs = attributionParams({ src: payload.src });
  const clean: Record<string, string | number | boolean | (() => void)> = { ...attrs };
  if (payload.pack) clean.pack = payload.pack;
  if (payload.sport) clean.sport = payload.sport;
  if (payload.kind) clean.kind = payload.kind;
  // Ask gtag to call back within our window; we still only mark inside our callback below.
  clean.event_timeout = poolCreatedFlushMs;

  const p = new Promise<void>((resolve) => {
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(() => {
      // Timed out: keep pending for retry; do not set the once-key.
      poolCreatedTimers.delete(timer);
      resolveOnce();
    }, poolCreatedFlushMs);
    poolCreatedTimers.add(timer);
    clean.event_callback = () => {
      window.clearTimeout(timer);
      poolCreatedTimers.delete(timer);
      markPoolCreatedSent(payload);
      resolveOnce();
    };
    window.gtag?.('event', 'pool_created', clean);
  });
  poolCreatedFlushes.add(p);
  p.finally(() => {
    poolCreatedFlushes.delete(p);
  });
  return p;
}

// Flush pool_created hits queued before Accept or before openPool's reload.
export function flushPendingPoolCreated(): Promise<void> {
  if (getAnalyticsConsent() !== 'granted') return Promise.resolve();
  const pending = readPendingPoolCreated();
  if (!pending.length) return Promise.resolve();
  return Promise.all(pending.map((row) => emitPoolCreated(row))).then(() => undefined);
}

// North-star: queue only here. openPool reloads; initAnalytics / Accept flush on the stable page.
// Once-key is set only when gtag's event_callback fires.
export function trackPoolCreated(params: PoolCreatedParams = {}): Promise<void> {
  if (params.id != null && params.id !== '' && storeGet(poolCreatedKey(params.id)) === '1') {
    return Promise.resolve();
  }
  const payload: PoolCreatedPayload = {
    id: params.id != null && params.id !== '' ? String(params.id) : undefined,
    pack: params.pack ? String(params.pack).slice(0, 80) : undefined,
    sport: params.sport ? String(params.sport).slice(0, 40) : undefined,
    kind: params.kind ? String(params.kind).slice(0, 40) : undefined,
    src: params.src ?? readSrcParam(),
  };
  enqueuePending(payload);
  return Promise.resolve();
}

// Member joined a pool via invite. Once per pool id; no backfill after Accept.
// Carries ?src= from the invite URL (e.g. share) when present.
export function trackJoinGroup(params: { id?: number | string | null; src?: string | null } = {}) {
  if (params.id != null && params.id !== '') {
    const key = joinGroupKey(params.id);
    if (storeGet(key) === '1') return;
    storeSet(key, '1');
  }
  const attrs = attributionParams({ src: params.src });
  track('join_group', attrs);
}

// First pick/call/trade in a pool (once per browser). Safe to call after any successful game action.
export function trackFirstCall(kind?: string) {
  if (storeGet(FIRST_CALL_KEY) === '1') return;
  storeSet(FIRST_CALL_KEY, '1');
  track('first_call', kind ? { kind: kind.slice(0, 40) } : undefined);
  // the home's "start your own pool" card listens so it can appear without a reload
  try { window.dispatchEvent(new Event('sp-first-call')); } catch { /* no window */ }
}

export function hasTrackedFirstCall(): boolean {
  return storeGet(FIRST_CALL_KEY) === '1';
}

// #/new with a src mark for the viral CTAs (join card, scoreboard). Pool creation has no src column —
// only UTM/referrer on signup — so this stays a URL param for analytics routes and funnels.
export function newPoolPath(src: string): string {
  return `/new?src=${encodeURIComponent(src)}`;
}

// Reset module state between unit tests.
export function __testResetAnalytics() {
  lastTrackedPath = null;
  testGaId = undefined;
  poolCreatedFlushMs = 1000;
  for (const t of poolCreatedTimers) {
    try { window.clearTimeout(t); } catch { /* no window */ }
  }
  poolCreatedTimers.clear();
  poolCreatedFlushes.clear();
  if (typeof window !== 'undefined') {
    delete (window as { gtag?: unknown }).gtag;
    delete (window as { dataLayer?: unknown }).dataLayer;
    delete (window as { __spFlushPoolCreated?: unknown }).__spFlushPoolCreated;
    delete (window as { __spAnalyticsTest?: unknown }).__spAnalyticsTest;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === CONSENT_KEY || k === ADS_CONSENT_KEY || k === TOUCH_KEY || k === FIRST_CALL_KEY || k === SIGN_UP_KEY
        || k === POOL_CREATED_PENDING_KEY
        || k.startsWith('sp_pool_created:') || k.startsWith('sp_join_group:'))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* no store */ }
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k === CTA_ARRIVAL_PENDING_KEY || k.startsWith('sp_cta_arrival:'))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* no session */ }
  if (typeof document !== 'undefined') {
    document.getElementById('sp-ga4')?.remove();
    try {
      document.cookie = `${CONSENT_COOKIE}=; Path=/; Domain=.superpoolsai.com; Max-Age=0; SameSite=Lax; Secure`;
      document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    } catch { /* no cookie */ }
  }
}
