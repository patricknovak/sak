// Consented GA4 (Consent Mode v2) and first-touch UTM/referrer for Super Pools.
// Measurement ID from VITE_GA4_ID (.env.production); empty means nothing loads and no network calls.
// Funnel events carry no PII (no email, name, or user id).

const CONSENT_KEY = 'sp_analytics_consent';
const TOUCH_KEY = 'sp_first_touch';
const FIRST_CALL_KEY = 'sp_first_call';
const SIGN_UP_KEY = 'sp_sign_up';
const poolCreatedKey = (id: string | number) => `sp_pool_created:${id}`;
const joinGroupKey = (id: string | number) => `sp_join_group:${id}`;

// Tests inject a measurement ID without Vite. Production always reads VITE_GA4_ID.
let testGaId: string | undefined;

export function __testSetGaId(id: string | undefined) {
  testGaId = id;
}

function measurementId(): string {
  if (testGaId !== undefined) return testGaId;
  return (import.meta.env.VITE_GA4_ID as string | undefined)?.trim() ?? '';
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
  }
}

function storeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  const v = storeGet(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
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
  if (document.getElementById('sp-ga4')) return;
  ensureGtag();
  const s = document.createElement('script');
  s.id = 'sp-ga4';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

// Call once at app start: capture first-touch, and load gtag only when consent was already granted.
export function initAnalytics() {
  captureFirstTouch();
  if (!measurementId()) return;
  ensureGtag();
  if (getAnalyticsConsent() === 'granted') {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    loadTag();
    // First load of a consented return visit: record this route (AnalyticsRoute will not double-count).
    trackPageView(currentAppPath());
  }
}

export function setAnalyticsConsent(granted: boolean) {
  storeSet(CONSENT_KEY, granted ? 'granted' : 'denied');
  if (!measurementId()) return;
  ensureGtag();
  if (granted) {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    loadTag();
    // Current page at Accept: route has not changed, so AnalyticsRoute would never fire.
    trackPageView(currentAppPath());
  } else {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  }
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

export type FunnelEvent = 'pool_start' | 'pool_created' | 'invite_share' | 'join' | 'join_group' | 'first_call' | 'sign_up';

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
export function trackSignUp(method: 'email' = 'email') {
  if (storeGet(SIGN_UP_KEY) === '1') return;
  storeSet(SIGN_UP_KEY, '1');
  track('sign_up', { method });
}

export type PoolCreatedParams = {
  id?: number | string | null;
  pack?: string | null;
  sport?: string | null;
  kind?: string | null;
  src?: string | null;
};

// North-star: a pool (or fantasy league) opened successfully. Once per pool id; no backfill after Accept.
export function trackPoolCreated(params: PoolCreatedParams = {}) {
  if (params.id != null && params.id !== '') {
    const key = poolCreatedKey(params.id);
    if (storeGet(key) === '1') return;
    storeSet(key, '1');
  }
  const attrs = attributionParams({ src: params.src });
  track('pool_created', {
    ...attrs,
    pack: params.pack ? String(params.pack).slice(0, 80) : undefined,
    sport: params.sport ? String(params.sport).slice(0, 40) : undefined,
    kind: params.kind ? String(params.kind).slice(0, 40) : undefined,
  });
}

// Member joined a pool via invite. Once per pool id; no backfill after Accept.
export function trackJoinGroup(params: { id?: number | string | null } = {}) {
  if (params.id != null && params.id !== '') {
    const key = joinGroupKey(params.id);
    if (storeGet(key) === '1') return;
    storeSet(key, '1');
  }
  track('join_group');
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
  if (typeof window !== 'undefined') {
    delete (window as { gtag?: unknown }).gtag;
    delete (window as { dataLayer?: unknown }).dataLayer;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === CONSENT_KEY || k === TOUCH_KEY || k === FIRST_CALL_KEY || k === SIGN_UP_KEY
        || k.startsWith('sp_pool_created:') || k.startsWith('sp_join_group:'))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* no store */ }
  if (typeof document !== 'undefined') {
    document.getElementById('sp-ga4')?.remove();
  }
}
