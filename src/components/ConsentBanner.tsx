// Consent, asked as little as it can be (23 October 2026). Anywhere but the start page: one line for analytics
// (analytics_storage), with Choices for the detail; the ads question waits. On the start page, #/new, where someone
// who came from an ad lands: whatever is still unanswered, analytics and ads measurement (ad_storage + ad_user_data +
// AW tag + hashed email), one line each in a slim sheet at the top, clear of the start bar, and any choice closes it with
// the other saved as denied (#299: the sheet never stays over Start my pool). Since 4 November 2026 the two lines are
// worded apart ("No ads in the app" beside a question about our own Google ads read as a contradiction) and the detail
// for both waits behind Choices, so the sheet is about 110 px on a phone and "Start a pool" shows under it. Defaults stay
// denied until accepted; nothing Google loads before an Accept.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getAdsConsent, getAnalyticsConsent, hasGaId, setAdsConsent, setAnalyticsConsent } from '../lib/analytics';

const onStart = () => /^#\/new(\?|$)/.test(window.location.hash);

export function ConsentBanner() {
  const [, setTick] = useState(0);
  const [details, setDetails] = useState(false);
  // the question to ask follows the page: the hash changes without a reload
  useEffect(() => {
    const re = () => setTick((n) => n + 1);
    window.addEventListener('hashchange', re);
    return () => window.removeEventListener('hashchange', re);
  }, []);
  // on the start page the sheet sits over the top of the page, so it says how far down it reaches (--consent-space) and
  // the page leaves that much room above its title; the room goes when the sheet does
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const el = box.current;
    if (!el || !onStart()) { root.removeProperty('--consent-space'); return; }
    const put = () => root.setProperty('--consent-space', `${Math.ceil(el.getBoundingClientRect().bottom)}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty('--consent-space'); };
  });
  if (!hasGaId()) return null;
  const start = onStart();
  const askAnalytics = getAnalyticsConsent() == null;
  const askAds = start && getAdsConsent() == null;
  if (!askAnalytics && !askAds) return null;

  // on the start page any choice closes the sheet, the other question saved as denied; elsewhere only analytics is asked
  const choose = (which: 'analytics' | 'ads', granted: boolean) => {
    (which === 'analytics' ? setAnalyticsConsent : setAdsConsent)(granted);
    // the ads question is only ever asked on the start page, so answering analytics anywhere settles it as no
    if (which === 'analytics' && getAdsConsent() == null) setAdsConsent(false);
    if (start && which === 'ads' && getAnalyticsConsent() == null) setAnalyticsConsent(false);
    setTick((n) => n + 1);
  };
  const pair = (which: 'analytics' | 'ads') => (
    <span className="flex shrink-0 gap-1.5">
      <button type="button" className="btn-ghost min-h-0 px-2.5 py-1.5 text-[13px]" onClick={() => choose(which, false)} aria-label="No thanks">No</button>
      <button type="button" className="btn-gold min-h-0 px-3 py-1.5 text-[13px]" onClick={() => choose(which, true)}>Accept</button>
    </span>
  );
  const choices = <button type="button" className="text-sky-300 underline" onClick={() => setDetails(!details)} aria-expanded={details}>Choices</button>;

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-[80] flex justify-center p-3 ${start ? 'top-0 pt-[max(0.75rem,env(safe-area-inset-top))]' : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`} role="dialog" aria-label="Analytics and ads cookies">
      <div ref={box} className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[rgb(11_18_32/.96)] px-3 py-2.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,.85)]">
        {askAnalytics && (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[12px] leading-[1.35] text-slate-200">
              Count your visits to help make Super Pools better? No ads in the app.{' '}{choices}
            </p>
            {pair('analytics')}
          </div>
        )}
        {askAds && (
          <div className={`flex items-center gap-2 ${askAnalytics ? 'mt-2 border-t border-white/10 pt-2' : ''}`}>
            <p className="min-w-0 flex-1 text-[12px] leading-[1.35] text-slate-200">
              Help us count sign-ups from our Google ads?{' '}<span className="text-slate-400">A scrambled one-way code from your email, never the email.</span>{!askAnalytics && <>{' '}{choices}</>}
            </p>
            {pair('ads')}
          </div>
        )}
        {details && (
          <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2 text-[12px] leading-snug text-slate-300">
            {askAnalytics && <p>Visits: analytics counts how Super Pools gets used (pools started, invites shared, pages opened), never who you are.</p>}
            {askAds && <p>Sign-ups from ads: when you sign up, Google is told whether one of our ads brought you, matched by a scrambled one-way code made from your email on your phone. Google never gets the email itself.</p>}
            <p>Nothing loads unless you accept. <a className="text-sky-300 underline" href="#/privacy">Privacy</a></p>
          </div>
        )}
      </div>
    </div>
  );
}
