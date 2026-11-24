// Consent, asked as little as it can be (23 October 2026). Anywhere but the start page: one line for analytics
// (analytics_storage), with Choices for the detail; the ads question waits. On the start page, #/new, where someone
// who came from an ad lands: whatever is still unanswered, analytics and ads measurement (ad_storage + ad_user_data +
// AW tag + hashed email), in one sheet at the top, clear of the start bar, and any choice closes it with the other saved
// as denied (#299: the sheet never stays over Start my pool). The old sheet asked both everywhere and covered about 38%
// of a phone and the whole dock, a GM's first sight of the app on a new phone. Defaults stay denied until accepted;
// nothing Google loads before an Accept.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAdsConsent, getAnalyticsConsent, hasGaId, setAdsConsent, setAnalyticsConsent } from '../lib/analytics';

const onStart = () => /^#\/new(\?|$)/.test(window.location.hash);
// Where a page wants the line (24 November 2026). Floating over the foot of a phone, it sat on whatever a newcomer was
// reaching for: Join the pool on an invite, the Call buttons on a question, the chat's composer, Set password on a
// reset. A page that draws a ConsentSlot gets the line there, as part of the page, covering nothing: the layout has one
// at the top of every page, the invite and the sign-in page under their forms. A page with no slot keeps the floating line.
const SLOT = 'sp-consent-slot';
export function ConsentSlot({ className = '' }: { className?: string }) {
  useEffect(() => { window.dispatchEvent(new Event(SLOT)); return () => { setTimeout(() => window.dispatchEvent(new Event(SLOT)), 0); }; }, []);
  return <div data-consent-slot className={className} />;
}

export function ConsentBanner() {
  const [, setTick] = useState(0);
  const [details, setDetails] = useState(false);
  // on a phone the line sits above the dock, never over it (a newcomer's tabs were under it on their first screen)
  const [dock, setDock] = useState(false);
  // the question to ask follows the page: the hash changes without a reload
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    const find = () => setSlot(document.querySelector('[data-consent-slot]'));
    const re = () => { setTick((n) => n + 1); setTimeout(() => { setDock(!!document.querySelector('[data-dock]')); find(); }, 50); };
    re();
    window.addEventListener('hashchange', re);
    window.addEventListener(SLOT, find);
    return () => { window.removeEventListener('hashchange', re); window.removeEventListener(SLOT, find); };
  }, []);
  const start = hasGaId() && onStart();
  const askAnalytics = hasGaId() && getAnalyticsConsent() == null;
  const askAds = start && getAdsConsent() == null;
  const up = askAnalytics || askAds;
  // on the start page the sheet sits at the top, so the page is told how far down it reaches and leaves that much room
  // (--consent-space, read by NewPool): the title used to sit under it, a stranger's first sight of the product
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement, el = box.current;
    if (!up || !start || !el) { root.style.removeProperty('--consent-space'); return; }
    const set = () => root.style.setProperty('--consent-space', `${Math.ceil(el.getBoundingClientRect().bottom)}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty('--consent-space'); };
  }, [up, start]);
  if (!up) return null;

  // on the start page any choice closes the sheet, the other question saved as denied; elsewhere only analytics is asked
  const choose = (which: 'analytics' | 'ads', granted: boolean) => {
    (which === 'analytics' ? setAnalyticsConsent : setAdsConsent)(granted);
    // the ads question is only ever asked on the start page, so answering analytics anywhere settles it as no
    if (which === 'analytics' && getAdsConsent() == null) setAdsConsent(false);
    if (start && which === 'ads' && getAnalyticsConsent() == null) setAnalyticsConsent(false);
    setTick((n) => n + 1);
  };
  const pair = (which: 'analytics' | 'ads', wide = false) => (
    <>
      <button type="button" className={`btn-ghost ${wide ? 'flex-1' : 'shrink-0 px-3'} py-2 text-sm`} onClick={() => choose(which, false)}>No thanks</button>
      <button type="button" className={`btn-gold ${wide ? 'flex-1' : 'shrink-0 px-3'} py-2 text-sm`} onClick={() => choose(which, true)}>Accept</button>
    </>
  );

  // on the start page it stays a sheet at the top (the page leaves room for it); anywhere with a slot it is in the page
  const inPage = !start && !!slot && slot.isConnected;
  const line = (
    <div className={`pointer-events-none z-[80] flex justify-center ${inPage ? 'pb-3' : `fixed inset-x-0 p-3 ${start ? 'top-0 pt-[max(0.75rem,env(safe-area-inset-top))]' : dock ? 'bottom-[calc(88px+env(safe-area-inset-bottom))] lg:bottom-0 lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`}`} role="dialog" aria-label="Analytics and ads cookies" data-consent>
      <div ref={box} className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[rgb(11_18_32/.96)] p-3 shadow-[0_18px_50px_-20px_rgba(0,0,0,.85)]">
        {askAnalytics && (
          <>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-slate-200">
                Count your visits to help make Super Pools better? No ads in the app.{' '}
                <button type="button" className="text-sky-300 underline" onClick={() => setDetails(!details)} aria-expanded={details}>Choices</button>
              </p>
              {pair('analytics')}
            </div>
            {details && (
              <p className="mt-2 text-[12px] leading-snug text-slate-300">
                Analytics counts how Super Pools gets used (pools started, invites shared, pages opened), never who you are.
                Nothing loads unless you accept. <a className="text-sky-300 underline" href="#/privacy">Privacy</a>
              </p>
            )}
          </>
        )}
        {askAds && (
          <div className={askAnalytics ? 'mt-3 border-t border-white/10 pt-3' : ''}>
            <div className="text-[12px] font-semibold text-white">Did an ad bring you here?{' '}
              {!details && <button type="button" className="font-normal text-sky-300 underline" onClick={() => setDetails(true)} aria-expanded={details}>What we&apos;d tell Google</button>}
            </div>
            {details && (
              <p className="mt-0.5 text-[12px] leading-snug text-slate-300">
                Whether a sign-up came from one of our ads, with a scrambled one-way code from your email,
                never the email itself. <a className="text-sky-300 underline" href="#/privacy">Privacy</a>
              </p>
            )}
            <div className="mt-2 flex gap-2">{pair('ads', true)}</div>
          </div>
        )}
      </div>
    </div>
  );
  return inPage ? createPortal(line, slot!) : line;
}
