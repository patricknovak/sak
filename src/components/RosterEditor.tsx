import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useAction } from './ui';

// The league's roster slots, set by its commissioner before the draft (commish_set_roster): how many of each position
// start, the bench and IR. The draft gets one round per spot left after the keepers. Locked once the draft order is
// drawn or the season is on, because the picks and every lineup are built on it.
const SLOTS: { k: string; label: string; min: number; max: number }[] = [
  { k: 'C', label: 'Centres', min: 0, max: 6 }, { k: 'LW', label: 'Left wings', min: 0, max: 6 }, { k: 'RW', label: 'Right wings', min: 0, max: 6 },
  { k: 'D', label: 'Defence', min: 0, max: 8 }, { k: 'G', label: 'Goalies', min: 1, max: 4 }, { k: 'Util', label: 'Utility (any skater)', min: 0, max: 6 },
  { k: 'BN', label: 'Bench', min: 0, max: 20 }, { k: 'IR', label: 'Injured reserve', min: 0, max: 6 },
];

export function RosterEditor() {
  const { league, draft, refresh } = useLeague();
  const { busy, run } = useAction();
  const [r, setR] = useState<Record<string, number>>({});
  useEffect(() => { if (league?.roster) setR({ ...(league.roster as Record<string, number>) }); }, [league?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!league) return null;
  const open = ['keepers', 'predraft', 'offseason'].includes(league.phase) && !draft?.order_set && draft?.status !== 'live' && draft?.status !== 'paused';
  const starters = SLOTS.filter((s) => s.k !== 'BN' && s.k !== 'IR').reduce((t, s) => t + (r[s.k] ?? 0), 0);
  const total = starters + (r.BN ?? 0);
  const rounds = total - league.keepers;
  const changed = SLOTS.some((s) => (r[s.k] ?? 0) !== ((league.roster as Record<string, number>)?.[s.k] ?? 0));
  const ok = starters >= 5 && starters <= 25 && rounds >= 1;

  return (
    <div className="card space-y-3 p-3">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {SLOTS.map((s) => (
          <div key={s.k} className="flex items-center gap-3 rounded-xl bg-white/[.04] px-3 py-2">
            <span className="w-10 shrink-0 font-display text-lg font-extrabold text-white/90">{s.k}</span>
            <span className="min-w-0 flex-1 text-sm text-slate-300">{s.label}</span>
            {open ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 p-0.5">
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 font-bold disabled:opacity-30" disabled={(r[s.k] ?? 0) <= s.min} onClick={() => setR({ ...r, [s.k]: (r[s.k] ?? 0) - 1 })} aria-label={`One ${s.k} fewer`}>−</button>
                <span className="num w-7 text-center font-display text-xl font-extrabold">{r[s.k] ?? 0}</span>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-white/10 font-bold disabled:opacity-30" disabled={(r[s.k] ?? 0) >= s.max} onClick={() => setR({ ...r, [s.k]: (r[s.k] ?? 0) + 1 })} aria-label={`One ${s.k} more`}>+</button>
              </span>
            ) : <span className="num w-7 shrink-0 text-center font-display text-xl font-extrabold">{r[s.k] ?? 0}</span>}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-200">
        Roster of <b>{total}</b>: <b>{starters}</b> starting, <b>{r.BN ?? 0}</b> on the bench{r.IR ? <>, plus {r.IR} IR</> : null}.
        {league.keepers > 0 ? <> With {league.keepers} keepers, the draft is <b>{rounds}</b> rounds.</> : <> The draft is <b>{rounds}</b> rounds.</>}
      </div>
      {open
        ? <button className="btn-primary w-full" disabled={busy || !changed || !ok} onClick={() => run(async () => { await rpc('commish_set_roster', { p_roster: r, p_set_rounds: true }); await refresh(['league']); }, 'Roster saved')}>Save the roster</button>
        : <p className="text-xs text-mute">The roster is set before the draft order is drawn and changes again in the off-season.</p>}
    </div>
  );
}
