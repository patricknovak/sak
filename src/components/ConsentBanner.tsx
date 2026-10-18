// Consent floor with two choices: Analytics (analytics_storage) and Ads measurement
// (ad_storage + ad_user_data + AW tag + hashed email). Defaults stay denied until each is accepted.
// Nothing Google loads before at least one Accept. Shows until both have been chosen.
import { useEffect, useState } from 'react';
import {
  getAdsConsent,
  getAnalyticsConsent,
  hasGaId,
  needsConsentChoice,
  setAdsConsent,
  setAnalyticsConsent,
} from '../lib/analytics';

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState<'granted' | 'denied' | null>(null);
  const [ads, setAds] = useState<'granted' | 'denied' | null>(null);
  useEffect(() => {
    if (!hasGaId()) return;
    if (needsConsentChoice()) {
      setAnalytics(getAnalyticsConsent());
      setAds(getAdsConsent());
      setOpen(true);
    }
  }, []);
  if (!open) return null;
  const closeIfDone = (nextA: typeof analytics, nextAds: typeof ads) => {
    if (nextA != null && nextAds != null) setOpen(false);
  };
  const chooseAnalytics = (granted: boolean) => {
    setAnalyticsConsent(granted);
    const next = granted ? 'granted' as const : 'denied' as const;
    setAnalytics(next);
    closeIfDone(next, ads ?? getAdsConsent());
  };
  const chooseAds = (granted: boolean) => {
    setAdsConsent(granted);
    const next = granted ? 'granted' as const : 'denied' as const;
    setAds(next);
    closeIfDone(analytics ?? getAnalyticsConsent(), next);
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="dialog" aria-label="Analytics and ads cookies">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[rgb(11_18_32/.94)] p-3.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,.85)] backdrop-blur-md">
        <p className="text-[13px] leading-snug text-slate-200">
          Two choices. No ads are shown in Super Pools. <a className="text-sky-300 underline" href="#/privacy">Privacy</a>.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[12px] font-semibold text-white">Analytics</div>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-300">Count how Super Pools gets used: pools started, invites shared, pages opened.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={`btn-ghost flex-1 py-2 text-sm ${analytics === 'denied' ? 'ring-1 ring-white/30' : ''}`} onClick={() => chooseAnalytics(false)}>No thanks</button>
              <button type="button" className={`btn-gold flex-1 py-2 text-sm ${analytics === 'granted' ? 'ring-2 ring-white/40' : ''}`} onClick={() => chooseAnalytics(true)}>Accept</button>
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-white">Ads measurement</div>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-300">Tell Google whether a sign-up came from one of our ads, with a scrambled one-way code from your email. Never the email itself.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={`btn-ghost flex-1 py-2 text-sm ${ads === 'denied' ? 'ring-1 ring-white/30' : ''}`} onClick={() => chooseAds(false)}>No thanks</button>
              <button type="button" className={`btn-gold flex-1 py-2 text-sm ${ads === 'granted' ? 'ring-2 ring-white/40' : ''}`} onClick={() => chooseAds(true)}>Accept</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
