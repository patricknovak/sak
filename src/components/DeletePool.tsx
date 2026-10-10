// Delete a pool (migration 242: pool_delete), from My pools and the host's desk: everything in it goes for good, so the
// host types its name to be sure. A fantasy league can go this way only while it's still being set up, by the one who
// started it; the platform can delete any league but the SaK Superleague.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { Sheet, Spinner } from './ui';

export function DeletePool({ pool, open, onClose, onDone }: { pool: { league_id: number; name: string; kind?: string }; open: boolean; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const word = pool.kind === 'predict' ? 'pool' : 'league';
  const match = typed.trim().toLowerCase() === pool.name.trim().toLowerCase();
  const go = async () => {
    setBusy(true); setErr('');
    try { await rpc('pool_delete', { p_league: pool.league_id, p_confirm: typed.trim() }); onDone(); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={() => { setTyped(''); setErr(''); onClose(); }} title={`Delete ${pool.name}`}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/20 text-red-200"><Trash2 size={18} /></span>
          <p className="text-sm leading-snug text-red-100">This deletes the {word} for everyone in it: every game, pick, question, coin and chat message, and its place on everyone’s My pools. It can’t be undone.</p>
        </div>
        <label className="block"><span className="label">Type <b className="normal-case text-white">{pool.name}</b> to confirm</span>
          <input className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={pool.name} autoComplete="off" /></label>
        {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-3 py-2 text-sm text-red-200">{err}</div>}
        <button type="button" disabled={!match || busy} onClick={go}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-3 text-base font-bold text-white transition hover:bg-red-400 disabled:opacity-40">
          {busy ? <Spinner /> : <><Trash2 size={18} /> Delete the {word}</>}
        </button>
      </div>
    </Sheet>
  );
}
