// League by host: a league has an address of its own (<web name>.superpoolsai.com, or its own domain), and the site
// served from it opens that league: the sign-in page wears its wordmark and colour, and once signed in every request
// names it (x-league). The app's own addresses (the apex, www, app, GitHub and Cloudflare Pages, a dev server) are no
// league's, and there the site opens the account's own league as it always has.
import { rpc, setLeagueHeader } from './supabase';
import type { Brand } from './brand';

export interface HostLeague { id: number; slug: string; name: string; short_name: string; brand: Partial<Brand> | null; status: string }

// a league switched to in this tab (Profile, "Your leagues") wins over the address for as long as the tab is open
const TAB = 'sak-tab-league';
export const tabLeague = () => { try { return Number(sessionStorage.getItem(TAB)) || null; } catch { return null; } };
export const setTabLeague = (id: number | null) => { try { if (id) sessionStorage.setItem(TAB, String(id)); else sessionStorage.removeItem(TAB); } catch { /* no storage */ } };

const appHost = (h: string) => !h || h === 'localhost' || /^[\d.]+$/.test(h) || /\.(github\.io|pages\.dev|vercel\.app)$/.test(h)
  || /^(www\.|app\.)?superpools?ai\.com$/.test(h);

let found: Promise<HostLeague | null> | null = null;
export function hostLeague(): Promise<HostLeague | null> {
  if (!found) {
    const h = location.hostname.toLowerCase();
    found = appHost(h) ? Promise.resolve(null) : rpc<HostLeague | null>('league_by_host', { p_host: h }).catch(() => null);
    found.then((l) => setLeagueHeader(tabLeague() ?? l?.id ?? null));
  }
  return found;
}

// a league's own address, for a link from another league's site
export const leagueUrl = (slug: string) => `https://${slug}.superpoolsai.com/`;
