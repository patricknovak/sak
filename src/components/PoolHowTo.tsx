import { useState } from 'react';
import { ArrowLeftRight, CircleDollarSign, Crown, Target, X } from 'lucide-react';
import { useBrand } from '../lib/brand';

// How a prediction pool works, in four lines, for someone who joined from a link in the group chat and has never seen
// a market: the price is the pool's chance, a right answer pays one coin a share, you can sell back before it closes,
// and the crown goes to the most coins at the end. Shown on the pool's home until it is put away (per pool, on this
// phone); a "How it works" link brings it back.
const key = (league: number) => `pool-howto-${league}`;
const seen = (league: number) => { try { return localStorage.getItem(key(league)) === '1'; } catch { return false; } };

export function PoolHowTo({ league }: { league: number }) {
  const brand = useBrand();
  const [hidden, setHidden] = useState(() => seen(league));
  const coin = brand.coin.name.toLowerCase();
  const one = coin.replace(/s$/, '');
  const hide = () => { setHidden(true); try { localStorage.setItem(key(league), '1'); } catch { /* private window */ } };
  if (hidden) return (
    <button type="button" onClick={() => setHidden(false)} className="mx-auto block text-xs font-semibold text-mute underline-offset-4 hover:underline">How it works</button>
  );
  const steps = [
    { icon: Target, title: 'Every answer has a price', body: `It is the pool's chance it happens. 25% means the pool thinks one in four.` },
    { icon: CircleDollarSign, title: `Right pays 1 ${one} a share`, body: `A share costs about its price: at 25% it is a quarter of a ${one}, so long shots pay big. The price climbs as you buy.` },
    { icon: ArrowLeftRight, title: 'Change your mind', body: 'Prices move as people call. Sell back any time before the question closes.' },
    { icon: Crown, title: `Win ${(brand.trophy || 'the crown').replace(/^The /, 'the ')}`, body: `Most ${coin} at the end wins: what you hold plus what your calls are worth. Never money.` },
  ];
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.2em] text-gold">New here?</div>
          <div className="font-display text-xl font-extrabold text-white">How it works</div>
        </div>
        <button type="button" onClick={hide} aria-label="Put it away" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-slate-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <ol className="relative mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><s.icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0"><span className="block font-semibold text-white">{s.title}</span><span className="block text-sm leading-snug text-slate-300">{s.body}</span></span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={hide} className="btn-gold relative mt-4 w-full py-2.5">Got it</button>
    </div>
  );
}
