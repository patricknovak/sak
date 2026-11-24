// "The playoffs are open" on a pool's home, for its host (24 November 2026). A pool started weeks ahead from a playoff
// landing page plays the season as it stands (src/lib/comingEvents.ts), on the promise that the playoff pool is one
// tap to add the night it opens. This is that night: the sport's postseason has joined the list and the pool has no
// game on it yet, so the host is told, with what it offers and when the first pick locks, and one tap to Add a game.
// Members aren't shown it (only the host can add a game). "Not now" puts it away for that event on this phone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { useLeague } from '../lib/store';
import { playoffOf, usePoolCompetitions } from '../lib/poolOwn';
import { KINDS, eventGrids, finalName, inFinal, type PoolEvent } from '../lib/poolGames';

const EMOJI: Record<string, string> = { nfl: '🏈', nba: '🏀', mlb: '⚾', nhl: '🏒', soccer: '⚽', ncaab: '🏀' };
const KEY = (league: number, comp: string) => `sp-playoffs-hide:${league}:${comp}`;
const hiddenFor = (league: number, comp: string) => { try { return localStorage.getItem(KEY(league, comp)) === '1'; } catch { return false; } };
const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PlayoffsOpen() {
  const { league, me, kind } = useLeague();
  const lid = league?.league_id ?? 0;
  const own = usePoolCompetitions();
  const host = kind === 'predict' && !!me?.is_commish;
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const [gone, setGone] = useState(0);
  useEffect(() => { if (host) rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents(e ?? []), () => setEvents([])); }, [host, lid]);
  if (!host) return null;
  // the postseason of a sport this pool follows, with a pick still to lock and no game of the pool's on it yet
  const e = events.find((x) => playoffOf(own, x) && !!x.next_lock && Date.parse(x.next_lock) > Date.now() && !hiddenFor(lid, x.competition));
  if (!e) return null;
  const name = inFinal(e) ? finalName(e) : `The ${e.name.replace(/\s+\d{4}(-\d{2})?$/, '').replace(/^The /, '')}`;
  const plays = [...e.kinds.filter((k) => k in KINDS), ...(!e.kinds.includes('squares') && eventGrids(e).length ? ['squares' as const] : [])]
    .map((k) => KINDS[k].title.replace(/^The (.)/, (_, c: string) => c.toUpperCase()));
  const hide = () => { try { localStorage.setItem(KEY(lid, e.competition), '1'); } catch { /* private mode */ } setGone(gone + 1); };
  return (
    <section className="card relative overflow-hidden p-0" aria-label={`${name} are open`}>
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgb(var(--gold-rgb)/.22),transparent_70%)]" />
      <div className="relative flex items-start gap-3 px-4 pt-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-2xl">{EMOJI[e.sport] ?? '🏆'}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[.18em] text-gold">Open now · for the host</div>
          <h2 className="mt-0.5 text-balance text-lg font-bold leading-tight text-white">{name} {/s$/.test(name) ? 'are' : 'is'} open. Add {/s$/.test(name) ? 'them' : 'it'} to this pool.</h2>
        </div>
        <button type="button" onClick={hide} aria-label="Not now" className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X size={16} /></button>
      </div>
      <div className="relative px-4 pb-4 pt-2">
        <p className="text-sm leading-snug text-slate-300">Same pool, same people, same table. The first pick locks {WHEN.format(new Date(e.next_lock!))}.</p>
        {plays.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{plays.map((p) => <span key={p} className="rounded-full bg-white/[.06] px-2.5 py-1 text-[11px] font-semibold text-white/80 ring-1 ring-white/10">{p}</span>)}</div>}
        <Link to="/host?add=1" className="btn-gold mt-3 flex w-full items-center justify-center gap-2">Add a game <ArrowRight size={16} /></Link>
      </div>
    </section>
  );
}
