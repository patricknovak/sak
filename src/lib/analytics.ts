// Consented GA4 (Consent Mode v2) and first-touch UTM/referrer for Super Pools.
// Measurement ID from VITE_GA4_ID: empty means nothing loads and no network calls.
// Funnel events carry no PII (no email, name, or user id).

const GA_ID = (import.meta.env.VITE_GA4_ID as string | undefined)?.trim() ?? '';
const CONSENT_KEY = 'sp_analytics_consent';
const TOUCH_KEY = 'sp_first_touch';
const FIRST_CALL_KEY = 'sp_first_call';

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
  return GA_ID.length > 0;
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

function ensureGtag() {
  if (!GA_ID || typeof window === 'undefined') return;
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) { window.dataLayer!.push(args); };
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
  if (!GA_ID) return;
  ensureGtag();
  if (getAnalyticsConsent() === 'granted') {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    loadTag();
  }
}

export function setAnalyticsConsent(granted: boolean) {
  storeSet(CONSENT_KEY, granted ? 'granted' : 'denied');
  if (!GA_ID) return;
  ensureGtag();
  if (granted) {
    window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    loadTag();
  } else {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  }
}

export function trackPageView(path: string) {
  if (!GA_ID || getAnalyticsConsent() !== 'granted') return;
  ensureGtag();
  window.gtag?.('event', 'page_view', {
    page_path: path.slice(0, 200),
    page_title: typeof document !== 'undefined' ? document.title.slice(0, 120) : undefined,
  });
}

export type FunnelEvent = 'pool_start' | 'invite_share' | 'join' | 'first_call' | 'sign_up';

export function track(event: FunnelEvent, params?: Record<string, string | number | boolean | undefined>) {
  if (!GA_ID || getAnalyticsConsent() !== 'granted') return;
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

// First pick/call/trade in a pool (once per browser). Safe to call after any successful game action.
export function trackFirstCall(kind?: string) {
  if (storeGet(FIRST_CALL_KEY) === '1') return;
  storeSet(FIRST_CALL_KEY, '1');
  track('first_call', kind ? { kind: kind.slice(0, 40) } : undefined);
}
