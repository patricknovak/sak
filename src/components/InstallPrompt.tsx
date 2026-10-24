// "Add the app to your Home Screen": the steps for this phone (24 October 2026). On Home it rises above the dock once,
// for a member on a phone browser who hasn't installed it, and keeps away a week after Not now (a month once closed);
// on Profile it stays as a card until the app is installed. Chrome on Android installs in a tap; Safari needs the
// Share sheet, so it shows the three steps.
import { useEffect, useState } from 'react';
import { MoreVertical, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useLeague } from '../lib/store';
import { getAnalyticsConsent, hasGaId } from '../lib/analytics';
import { hideInstall, installHidden, useInstall } from '../lib/install';

function Steps({ platform }: { platform: 'ios' | 'android' | 'other' }) {
  const steps = platform === 'ios'
    ? [[<Share key="s" className="h-4 w-4" />, <>Tap <b className="text-white">Share</b> in Safari’s bar (on some iPhones it’s under <b className="text-white">···</b>)</>],
       [<PlusSquare key="p" className="h-4 w-4" />, <>Choose <b className="text-white">Add to Home Screen</b>, leave Open as Web App on, and tap <b className="text-white">Add</b></>],
       [<Smartphone key="m" className="h-4 w-4" />, <>Open it from the new icon: full screen, and phone alerts work</>]]
    : [[<MoreVertical key="m" className="h-4 w-4" />, <>Tap the browser’s <b className="text-white">⋮</b> menu</>],
       [<PlusSquare key="p" className="h-4 w-4" />, <>Choose <b className="text-white">Install app</b> or <b className="text-white">Add to Home screen</b></>],
       [<Smartphone key="s" className="h-4 w-4" />, <>Open it from the new icon: full screen, with phone alerts</>]];
  return (
    <ol className="mt-3 space-y-2">
      {steps.map(([icon, text], i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-snug text-slate-200">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold ring-1 ring-gold/30">{icon}</span>
          <span className="pt-1">{text}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallPrompt({ variant = 'sheet' }: { variant?: 'sheet' | 'card' }) {
  const { league } = useLeague();
  const { platform, standalone, canPrompt, prompt } = useInstall();
  const [show, setShow] = useState(variant === 'card');
  // the sheet waits a moment, and never sits over the cookie question
  useEffect(() => {
    if (variant !== 'sheet') return;
    const t = setTimeout(() => setShow(!installHidden() && !(hasGaId() && getAnalyticsConsent() == null)), 2500);
    return () => clearTimeout(t);
  }, [variant]);
  if (standalone || platform === 'other' || !show) return null;
  const close = (days: number) => { hideInstall(days); setShow(false); };
  const body = (
    <>
      <div className="flex items-start gap-3">
        <img src="./icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-white/15" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-extrabold leading-tight text-white">Get the full-screen app</div>
          <p className="mt-0.5 text-sm leading-snug text-slate-300">Add it to your Home Screen: no browser bars, more room for {league?.name ?? 'your league'}, and alerts on your phone.</p>
        </div>
        {variant === 'sheet' && <button type="button" onClick={() => close(30)} aria-label="Close" className="relative -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute hover:bg-white/[.06] after:absolute after:-inset-1"><X className="h-4 w-4" /></button>}
      </div>
      {platform === 'android' && canPrompt
        ? <button type="button" className="btn-gold mt-3 w-full py-2.5" onClick={async () => { if (await prompt()) setShow(false); }}>Install the app</button>
        : <Steps platform={platform} />}
      {variant === 'sheet' && <button type="button" onClick={() => close(7)} className="mt-3 w-full text-center text-sm font-semibold text-mute hover:text-white">Not now</button>}
    </>
  );
  if (variant === 'card') return <div className="card p-4">{body}</div>;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 lg:hidden" style={{ bottom: 'calc(88px + env(safe-area-inset-bottom))' }} role="dialog" aria-label="Add the app to your Home Screen">
      <div className="animate-pop pointer-events-auto w-full max-w-md rounded-3xl border border-gold/30 bg-[#0e1527] p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]">{body}</div>
    </div>
  );
}
