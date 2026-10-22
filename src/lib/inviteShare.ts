// Share-after-create and invite URLs with ?src= for growth attribution (join_group / invite_share).
// Kept free of supabase so unit tests can load it under node.

const SHARE_AFTER_CREATE = 'sp-share-after-create';
const APP = 'https://app.superpoolsai.com/';
const PRODUCT_DOMAIN = /(^|\.)superpools?ai\.com$/;

export function markShareAfterCreate() {
  try { sessionStorage.setItem(SHARE_AFTER_CREATE, '1'); } catch { /* private mode */ }
}

export function consumeShareAfterCreate(): boolean {
  try {
    if (sessionStorage.getItem(SHARE_AFTER_CREATE) !== '1') return false;
    sessionStorage.removeItem(SHARE_AFTER_CREATE);
    return true;
  } catch { return false; }
}

// Short /j/<code> on product hosts (unfurls in chat); elsewhere the app's #/join/<code>.
// Optional src (e.g. share) rides on the query for join_group attribution.
export function inviteLinkWithSrc(code: string, opts?: { src?: string; hostname?: string; origin?: string; pathname?: string }) {
  const host = (opts?.hostname ?? (typeof location !== 'undefined' ? location.hostname : '')).toLowerCase();
  const src = (opts?.src || '').trim().slice(0, 40);
  const q = src ? `?src=${encodeURIComponent(src)}` : '';
  if (PRODUCT_DOMAIN.test(host) || host === 'app.superpoolsai.com') return `${APP}j/${code}${q}`;
  const origin = opts?.origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost');
  const pathname = opts?.pathname ?? (typeof location !== 'undefined' ? location.pathname : '/');
  return `${origin}${pathname}#/join/${code}${q}`;
}
