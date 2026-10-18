// Open right now, under the sign-in on the product's own address (18 October 2026): a stranger who lands on
// app.superpoolsai.com found a sign-in form and one small link. Three events open this minute, from the same list the
// start page reads (pool_event_list, open to anyone), the one reaching its final first, each a tap into the start page
// with it chosen. A league's own address (SaK's) keeps its sign-in as it is.
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { finalName, finalSoon, inFinal, type PoolEvent } from '../lib/poolGames';

const EMOJI: Record<string, string> = { mlb: '⚾', nhl: '🏒', soccer: '⚽', nfl: '🏈', nba: '🏀', ncaab: '🏀' };
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const title = (e: PoolEvent) => (inFinal(e) ? finalName(e) : e.name.replace(/\s+\d{4}(-\d{2})?(\s+games)?$/i, ''));

export function OpenNow() {
  const [events, setEvents] = useState<PoolEvent[] | null>(null);
  useEffect(() => { rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents(e ?? []), () => setEvents([])); }, []);
  // one a sport, the final that can't wait first, then the soonest lock
  const best = new Map<string, PoolEvent>();
  for (const e of (events ?? []).filter((x) => x.next_lock && Date.parse(x.next_lock) > Date.now())) {
    const have = best.get(e.sport);
    if (!have || Number(finalSoon(e)) > Number(finalSoon(have)) || (finalSoon(e) === finalSoon(have) && Date.parse(e.next_lock!) < Date.parse(have.next_lock!))) best.set(e.sport, e);
  }
  const shown = [...best.values()].sort((a, b) => Number(finalSoon(b)) - Number(finalSoon(a)) || Date.parse(a.next_lock!) - Date.parse(b.next_lock!)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 text-center text-[10px] font-black uppercase tracking-[.2em] text-white/50">Open right now</div>
      <div className="grid gap-2">
        {shown.map((e) => (
          <a key={e.competition} href={`#/new?comp=${encodeURIComponent(e.competition)}`}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] px-3 py-2.5 transition hover:bg-white/[.07] active:scale-[.99]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.06] text-lg">{EMOJI[e.sport] ?? '🏆'}</span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-bold leading-tight text-white">{title(e)}</span>
              <span className="block text-[11px] text-white/55">Start a pool · first pick locks {DAY.format(new Date(e.next_lock!))}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-white/40" />
          </a>
        ))}
      </div>
    </div>
  );
}
