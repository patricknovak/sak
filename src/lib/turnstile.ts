// The bot check on the open doors (docs/LAUNCH-READINESS-2026-10-28.md item 8): Cloudflare Turnstile, free, asked for
// only when the site was built with a site key (VITE_TURNSTILE_SITE_KEY, public) and only at the moment someone presses
// the button that makes an account (starting a pool or a league, joining with an email or just a name, a fan's name).
// Most people never see it: the widget runs out of sight and shows a box only when Cloudflare wants a click. With no
// site key every door works as before and `humanToken()` answers undefined; the join function checks the token only once
// its secret, TURNSTILE_SECRET, is set, so the order is site key first, secret second.
//
// The key reaches the site one of two ways (24 November 2026): built in (VITE_TURNSTILE_SITE_KEY), or asked of the join
// function, which answers the TURNSTILE_SITE_KEY secret kept beside TURNSTILE_SECRET. The second needs no build: both
// secrets are pasted on one screen and the check is on. `doorSwitches()` is that answer, asked once per visit, and the
// Platform page reads it to show which switches are on.

import { supabase } from './supabase';

const BUILT_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? '';

export type DoorSwitches = {
  turnstile: string;   // the widget's public key the function holds, '' when it has none
  human: boolean;      // the function checks tokens (its secret is set)
  codes: boolean;      // a new email is confirmed by a 6-digit code
  known: boolean;      // false when the function couldn't be asked, or is a copy from before it answered this
};
let asked: Promise<DoorSwitches> | null = null;
export function doorSwitches(): Promise<DoorSwitches> {
  asked ??= supabase.functions.invoke('join', { body: { config: true } }).then(({ data, error }) => {
    const d = (!error && data?.ok === true ? data : null) as { turnstile?: unknown; human?: unknown; codes?: unknown } | null;
    if (!d) { asked = null; return { turnstile: '', human: false, codes: false, known: false }; }
    return { turnstile: typeof d.turnstile === 'string' ? d.turnstile.trim() : '', human: d.human === true, codes: d.codes === true, known: true };
  }, () => { asked = null; return { turnstile: '', human: false, codes: false, known: false }; });
  return asked;
}
export const builtSiteKey = () => BUILT_KEY;
const siteKey = async () => BUILT_KEY || (await doorSwitches()).turnstile;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | null = null;
function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

// One token for one press of the button. A token is good once, so each call renders a fresh widget and removes it after.
// The box, when Cloudflare asks for a click, sits at the foot of the screen over the page, in the product's dark card.
export async function humanToken(): Promise<string | undefined> {
  const SITE_KEY = await siteKey();
  if (!SITE_KEY) return undefined;
  const ts = await load().catch(() => null);
  if (!ts) return undefined;   // the script didn't load (blocked or offline): the function says so if it needed one
  const box = document.createElement('div');
  box.setAttribute('aria-live', 'polite');
  box.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:80';
  document.body.appendChild(box);
  return new Promise<string | undefined>((resolve) => {
    let id = '';
    const done = (token?: string) => {
      try { if (id) ts.remove(id); } catch { /* already gone */ }
      box.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => done(undefined), 60_000);
    id = ts.render(box, {
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      theme: 'dark',
      callback: (token: string) => { window.clearTimeout(timer); done(token); },
      'error-callback': () => { window.clearTimeout(timer); done(undefined); },
      'expired-callback': () => { window.clearTimeout(timer); done(undefined); },
    });
  });
}

// The body field the join function reads; empty when the check is off, so the request is the same as before.
export async function humanField(): Promise<{ turnstile?: string }> {
  const t = await humanToken();
  return t ? { turnstile: t } : {};
}
