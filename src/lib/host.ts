// Which league the site opens, and the links that lead into one (one account, every pool: migration 151).
//
// The product's home is one app, app.superpoolsai.com: one sign-in, one installed app, one alerts permission, every
// pool a tap away on My pools. A pool's link carries its web name in the path (app.superpoolsai.com/#/p/podsquad,
// and deeper: #/p/podsquad/q/12); opening one sets this tab's league and drops the name from the address.
//
// League by host still works: a league's own address (<web name>.superpoolsai.com, or a domain of its own) opens that
// league. A <web name>.superpoolsai.com address forwards to the one app unless someone is already signed in on it
// (SaK's GMs keep their address and sign-in), so a newcomer never ends up with a sign-in per pool. The app's own
// addresses (the apex, www, app, GitHub and Cloudflare Pages, a dev server) are no league's: there the site opens the
// pool in the link, else the one this tab switched to, else the account's own.
import { rpc, setLeagueHeader } from './supabase';
import type { Brand } from './brand';

export interface HostLeague { id: number; slug: string; name: string; short_name: string; brand: Partial<Brand> | null; status: string; kind?: 'fantasy' | 'predict' }

// a league switched to in this tab (My pools, a pool's link) wins over the address for as long as the tab is open
const TAB = 'sak-tab-league';
export const tabLeague = () => { try { return Number(sessionStorage.getItem(TAB)) || null; } catch { return null; } };
export const setTabLeague = (id: number | null) => { try { if (id) sessionStorage.setItem(TAB, String(id)); else sessionStorage.removeItem(TAB); } catch { /* no storage */ } };

const PRODUCT_DOMAIN = /(^|\.)superpools?ai\.com$/;
const appHost = (h: string) => !h || h === 'localhost' || /^[\d.]+$/.test(h) || /\.(github\.io|pages\.dev|vercel\.app)$/.test(h)
  || /^(www\.|app\.)?superpools?ai\.com$/.test(h);

// the one app's address: app.superpoolsai.com on the product's domain, this page's own address anywhere else (a dev
// server, the GitHub Pages copy), so a link made there still works there
const APP = 'https://app.superpoolsai.com/';
export const appBase = () => (PRODUCT_DOMAIN.test(location.hostname) ? APP : `${location.origin}${location.pathname}`);
export const appLink = (path: string) => `${appBase()}#${path.startsWith('/') ? path : `/${path}`}`;
// a pool's link: the app with the pool's web name in the path, and a page inside it if given
export const poolLink = (slug: string, path = '') => appLink(`/p/${slug}${path && path !== '/' ? path : ''}`);
// kept for the Platform page's "this league's address"
export const leagueUrl = (slug: string) => poolLink(slug);

// someone signed in on this address (the sign-in lives in this address's storage: supabase.ts, 'sak-auth')
const signedInHere = () => { try { return !!(localStorage.getItem('sak-auth') || sessionStorage.getItem('sak-auth')); } catch { return false; } };

// Read once, before the router starts: a pool in the link (#/p/<web name>/<page>) leaves just the page in the address,
// so the router opens that page; the name is kept here and resolved below.
const POOL_PATH = /^#\/p\/([a-z0-9][a-z0-9-]{0,40})(\/.*)?$/i;
const linked = (() => {
  const m = location.hash.match(POOL_PATH);
  if (!m) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#${m[2] || '/'}`);
  return m[1].toLowerCase();
})();

// a league's own *.superpoolsai.com address, opened by someone not signed in on it: on to the one app, keeping the page
// (an invite stays an invite: #/join/<code> needs no pool in the path)
const forwarded = (() => {
  const h = location.hostname.toLowerCase();
  const sub = h.match(/^([a-z0-9][a-z0-9-]{0,40})\.superpools?ai\.com$/)?.[1];
  if (!sub || sub === 'www' || sub === 'app' || signedInHere()) return false;
  const page = location.hash.replace(/^#/, '') || '/';
  location.replace(page.startsWith('/join/') ? appLink(page) : poolLink(linked ?? sub, page));
  return true;
})();

let found: Promise<HostLeague | null> | null = null;
export function hostLeague(): Promise<HostLeague | null> {
  if (!found) {
    const h = location.hostname.toLowerCase();
    if (forwarded) found = new Promise(() => { /* the page is on its way to the one app */ });
    else if (linked) {
      // the pool in the link becomes this tab's league; for someone not in it the database falls back to their own and
      // the page says so (HostNotice)
      found = rpc<HostLeague | null>('league_by_host', { p_host: `${linked}.superpoolsai.com` })
        .then((l) => { if (l) setTabLeague(l.id); return l; }).catch(() => null);
    } else found = appHost(h) ? Promise.resolve(null) : rpc<HostLeague | null>('league_by_host', { p_host: h }).catch(() => null);
    found.then((l) => setLeagueHeader(tabLeague() ?? l?.id ?? null));
  }
  return found;
}

// open one of this account's pools: the account remembers it (new tabs open there), then the page loads for it
export async function openPool(p: { league_id: number; slug: string }, path = '') {
  try { await rpc('set_active_league', { p_league: p.league_id }); } catch { /* a link still works without it */ }
  setTabLeague(p.league_id);
  // replaceState fires no hashchange, so the router doesn't act on the address before the reload reads it
  history.replaceState(null, '', `${location.pathname}${location.search}#/p/${p.slug}${path && path !== '/' ? path : ''}`);
  location.reload();
}
