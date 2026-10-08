// A match's result by hand (migrations 172 and 177): what the host settled for this pool, shown to everyone with the
// reason, and for the host, Settle by hand on a match that has kicked off, a side, a draw, void or a score, for every
// game the pool runs on it. Handing it back lets the feed decide again.
import { useCallback, useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { useAction } from './ui';

export interface Override { fixture_id: number; outcome: 'H' | 'D' | 'A' | 'void'; home: number | null; away: number | null; reason: string }
interface Side { name: string; short?: string | null }

// this pool's results by hand for the matches shown
export function useOverrides(ids: number[]) {
  const [map, setMap] = useState<Map<number, Override>>(new Map());
  const key = ids.join(',');
  const load = useCallback(async () => {
    if (!ids.length) { setMap(new Map()); return; }
    const { data } = await supabase.from('pool_result_overrides').select('fixture_id,outcome,home,away,reason').in('fixture_id', ids);
    setMap(new Map(((data ?? []) as Override[]).map((o) => [o.fixture_id, o])));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { overrides: map, reload: load };
}

const said = (o: Override, home: Side, away: Side) => o.outcome === 'void' ? 'void, it counts for nobody'
  : o.home != null ? `${home.short ?? home.name} ${o.home}-${o.away} ${away.short ?? away.name}`
  : o.outcome === 'H' ? `${home.name} win` : o.outcome === 'A' ? `${away.name} win` : 'a draw';

export function HostResult({ fixture, home, away, override, draws, score, onDone }: {
  fixture: { id: number; kickoff: string; state: string }; home: Side; away: Side; override?: Override; draws: boolean; score?: boolean; onDone: () => void;
}) {
  const { me } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<'H' | 'D' | 'A' | 'void' | null>(null);
  const [h, setH] = useState(''); const [a, setA] = useState('');
  const [reason, setReason] = useState('');
  const started = fixture.state !== 'scheduled' || new Date(fixture.kickoff).getTime() <= Date.now();
  const host = !!me?.is_commish && started && fixture.state !== 'final';
  const hasScore = h !== '' && a !== '';
  const ready = reason.trim().length >= 3 && (pick === 'void' || hasScore || (!score && pick));
  const save = () => run(async () => {
    await rpc('pool_fixture_result_set', { p_fixture: fixture.id, p_outcome: pick === 'void' ? 'void' : hasScore ? null : pick,
      p_home: pick !== 'void' && hasScore ? Number(h) : null, p_away: pick !== 'void' && hasScore ? Number(a) : null, p_reason: reason.trim() });
    setOpen(false); onDone();
  }, 'Settled for this pool');
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${on ? 'bg-gold text-[#0b1220] ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10'}`;
  return (
    <>
      {override && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/[.08] px-3 py-2 text-[12px] leading-snug text-amber-100">
          <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1"><b>Settled by the host: {said(override, home, away)}.</b> {override.reason}</span>
          {me?.is_commish && (
            <button type="button" disabled={busy} className="shrink-0 text-[11px] font-bold text-amber-200 underline-offset-2 hover:underline"
              onClick={() => run(async () => { await rpc('pool_fixture_result_set', { p_fixture: fixture.id, p_outcome: null, p_home: null, p_away: null, p_reason: null }); onDone(); }, 'Back to the feed')}>
              Hand back
            </button>
          )}
        </div>
      )}
      {host && !override && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-200">
          <PenLine className="h-3.5 w-3.5" /> Settle by hand
        </button>
      )}
      {host && !override && open && (
        <div className="mt-2 space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/[.06] p-3">
          <div className="text-[11px] font-bold uppercase tracking-[.14em] text-amber-200">Settle for this pool</div>
          {score && (
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <span className="min-w-0 flex-1 truncate text-right">{home.short ?? home.name}</span>
              <input inputMode="numeric" aria-label={`${home.name} score`} className="input w-14 py-1.5 text-center" value={h} onChange={(e) => { setH(e.target.value.replace(/\D/g, '').slice(0, 2)); setPick(null); }} />
              <span className="text-white/40">-</span>
              <input inputMode="numeric" aria-label={`${away.name} score`} className="input w-14 py-1.5 text-center" value={a} onChange={(e) => { setA(e.target.value.replace(/\D/g, '').slice(0, 2)); setPick(null); }} />
              <span className="min-w-0 flex-1 truncate">{away.short ?? away.name}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {!score && <button type="button" className={chip(pick === 'H')} onClick={() => setPick('H')}>{home.short ?? home.name}</button>}
            {!score && draws && <button type="button" className={chip(pick === 'D')} onClick={() => setPick('D')}>Draw</button>}
            {!score && <button type="button" className={chip(pick === 'A')} onClick={() => setPick('A')}>{away.short ?? away.name}</button>}
            <button type="button" className={chip(pick === 'void')} onClick={() => { setPick(pick === 'void' ? null : 'void'); }}>Void</button>
          </div>
          <input className="input w-full py-1.5 text-sm" maxLength={200} placeholder="Why, for the pool to see" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-gold flex-1" disabled={busy || !ready} onClick={save}>Settle it</button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="text-[11px] leading-snug text-mute">For this pool only, and for every game it runs on this {score ? 'match: a score settles the calls, the winner and last one standing' : 'match'}.</p>
        </div>
      )}
    </>
  );
}
