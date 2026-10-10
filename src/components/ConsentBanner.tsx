// Lightweight analytics consent floor: shows only when a GA4 ID is configured and the visitor
// has not chosen yet. Defaults stay denied (Consent Mode v2) until Accept.
import { useEffect, useState } from 'react';
import { getAnalyticsConsent, hasGaId, setAnalyticsConsent } from '../lib/analytics';

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!hasGaId()) return;
    if (getAnalyticsConsent() == null) setOpen(true);
  }, []);
  if (!open) return null;
  const choose = (granted: boolean) => { setAnalyticsConsent(granted); setOpen(false); };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="dialog" aria-label="Analytics cookies">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[rgb(11_18_32/.94)] p-3.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,.85)] backdrop-blur-md">
        <p className="text-[13px] leading-snug text-slate-200">
          We use optional analytics cookies to see which pools people start and which invites get shared. No ads, never money, never your email.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-ghost flex-1 py-2.5 text-sm" onClick={() => choose(false)}>No thanks</button>
          <button type="button" className="btn-gold flex-1 py-2.5 text-sm" onClick={() => choose(true)}>Accept</button>
        </div>
      </div>
    </div>
  );
}
