import { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone } from 'lucide-react';
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported, sendTestPush } from '../lib/push';
import { useAction } from './ui';

// "Turn on alerts" card: on-the-clock, trade offers, bets and @mentions straight to your phone
export function PushCard({ compact, hideWhenOn }: { compact?: boolean; hideWhenOn?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const { busy, run } = useAction();
  const supported = pushSupported();
  const iosNeedsInstall = isIOS() && !isStandalone();

  useEffect(() => {
    if (!supported) { setOn(false); return; }
    currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => setOn(false));
  }, [supported]);

  if (on === null || (hideWhenOn && on)) return null;
  if (hideWhenOn && !supported && !iosNeedsInstall) return null;

  return (
    <div className={`card relative overflow-hidden ${compact ? 'p-3' : 'p-4'}`} style={{ background: on ? 'linear-gradient(135deg, rgba(52,211,153,.14), rgba(15,23,41,.8) 60%)' : 'linear-gradient(135deg, rgba(76,195,255,.16), rgba(15,23,41,.8) 60%)' }}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${on ? 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30' : 'bg-sky-400/15 text-sky-300 ring-sky-400/30'}`}>
          {on ? <BellRing size={20} /> : iosNeedsInstall ? <Smartphone size={20} /> : <BellOff size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{on ? 'Alerts are on for this device' : 'Get draft & trade alerts'}</div>
          <p className="mt-0.5 text-sm text-slate-300">
            {on ? 'You’ll get a buzz when you’re on the clock, get a trade offer, a bet challenge or an @mention.'
              : iosNeedsInstall ? 'On iPhone: tap Share → “Add to Home Screen”, open SaK from your Home Screen, then turn alerts on here.'
              : !supported ? 'This browser can’t do push notifications. Try Chrome, Edge or Safari on your phone.'
              : 'Never miss your pick: a buzz on your phone when you’re on the clock, even with the site closed.'}
          </p>
          {supported && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {!on && <button className="btn-blue btn-sm" disabled={busy} onClick={() => run(async () => { await enablePush(); setOn(true); await sendTestPush(); }, 'Alerts on. We just sent you a test 🔔')}>🔔 Turn on alerts</button>}
              {on && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { const r = await sendTestPush(); if (!r.sent) throw new Error('Couldn’t reach this device. Turn alerts off and on again.'); }, 'Test sent 🔔')}>Send a test</button>}
              {on && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await disablePush(); setOn(false); }, 'Alerts off for this device')}>Turn off</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
