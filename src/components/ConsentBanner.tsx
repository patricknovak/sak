// Consent, asked as little as it can be (23 October 2026). Anywhere but the start page: one line for analytics
// (analytics_storage), with Choices for the detail; the ads question waits. On the start page, #/new, where someone
// who came from an ad lands: whatever is still unanswered, analytics and ads measurement (ad_storage + ad_user_data +
// AW tag + hashed email), in one sheet at the top, clear of the start bar, and any choice closes it with the other saved
// as denied (#299: the sheet never stays over Start my pool). The old sheet asked both everywhere and covered about 38%
// of a phone and the whole dock, a GM's first sight of the app on a new phone. Defaults stay denied until accepted;
// nothing Google loads before an Accept.
import { useEffect, useState } from 'react';
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
  const pair = (which: 'analytics' | 'ads', wide = false) => (
    <>
      <button type="button" className={`btn-ghost ${wide ? 'flex-1' : 'shrink-0 px-3'} py-2 text-sm`} onClick={() => choose(which, false)}>No thanks</button>
      <button type="button" className={`btn-gold ${wide ? 'flex-1' : 'shrink-0 px-3'} py-2 text-sm`} onClick={() => choose(which, true)}>Accept</button>
    </>
  );

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-[80] flex justify-center p-3 ${start ? 'top-0 pt-[max(0.75rem,env(safe-area-inset-top))]' : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]'}`} role="dialog" aria-label="Analytics and ads cookies">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[rgb(11_18_32/.96)] p-3 shadow-[0_18px_50px_-20px_rgba(0,0,0,.85)]">
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
            <div className="text-[12px] font-semibold text-white">Did an ad bring you here?</div>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-300">
              Let us tell Google whether a sign-up came from one of our ads, with a scrambled one-way code from your email,
              never the email itself. <a className="text-sky-300 underline" href="#/privacy">Privacy</a>
            </p>
            <div className="mt-2 flex gap-2">{pair('ads', true)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
