import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtMoney } from '../lib/format';
import { PLACES, prizes } from '../lib/prizes';
import { useAction } from './ui';

// commissioner: entry fee, SaK Fund share, 1st/2nd/3rd split and the playoff share of the pool
export function MoneySettings() {
  const { league, teams, refresh } = useLeague();
  const { busy, run } = useAction();
  const [f, setF] = useState({ entry: '200', fund: '25', split: ['60', '30', '10'], playoff: '40' });
  useEffect(() => {
    if (!league) return;
    setF({ entry: String(league.entry_fee), fund: String(league.sak_fee), split: (league.prize_split ?? [60, 30, 10]).map(String), playoff: String(league.playoff_share ?? 40) });
  }, [league?.updated_at]);
  const splitSum = f.split.reduce((t, x) => t + (Number(x) || 0), 0);
  const preview = prizes(league ? { ...league, entry_fee: Number(f.entry), sak_fee: Number(f.fund), prize_split: f.split.map(Number), playoff_share: Number(f.playoff) } : null, teams.length);
  const bad = splitSum !== 100 || Number(f.fund) > Number(f.entry) || Number(f.playoff) < 0 || Number(f.playoff) > 100;
  const num = (v: string) => v.replace(/[^\d.]/g, '');

  return (
    <div className="card space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-mute">Entry per GM<input className="input mt-1" inputMode="decimal" value={f.entry} onChange={(e) => setF({ ...f, entry: num(e.target.value) })} /></label>
        <label className="text-xs text-mute">To SaK Fund<input className="input mt-1" inputMode="decimal" value={f.fund} onChange={(e) => setF({ ...f, fund: num(e.target.value) })} /></label>
        <label className="text-xs text-mute">Playoff share %<input className="input mt-1" inputMode="decimal" value={f.playoff} onChange={(e) => setF({ ...f, playoff: num(e.target.value) })} /></label>
      </div>
      <div>
        <div className="mb-1 text-xs text-mute">Payout split for each pot (must add to 100) <span className={splitSum === 100 ? 'text-emerald-300' : 'text-red-300'}>· {splitSum}%</span></div>
        <div className="grid grid-cols-3 gap-2">
          {f.split.map((v, i) => (
            <label key={i} className="text-xs text-mute">{PLACES[i]} %<input className="input mt-1" inputMode="decimal" value={v} onChange={(e) => { const s = [...f.split]; s[i] = num(e.target.value); setF({ ...f, split: s }); }} /></label>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-xs">
        <div>Pool {fmtMoney(preview.pool)} ({teams.length} × {fmtMoney(preview.entry - preview.fund)}) · SaK Fund {fmtMoney(preview.fundTotal)}</div>
        <div className="mt-1">🏒 Regular {preview.regularPct}% {fmtMoney(preview.regularPool)}: {preview.regular.map((v, i) => `${PLACES[i]} ${fmtMoney(v)}`).join(' · ')}</div>
        <div>🏆 Playoffs {preview.playoffPct}% {fmtMoney(preview.playoffPool)}: {preview.playoffs.map((v, i) => `${PLACES[i]} ${fmtMoney(v)}`).join(' · ')}</div>
      </div>
      <button className="btn-primary w-full" disabled={busy || bad} onClick={() => run(async () => {
        await rpc('commish_update_league', { p: { entry_fee: Number(f.entry), sak_fee: Number(f.fund), prize_split: f.split.map(Number), playoff_share: Number(f.playoff) } });
        await refresh(['league']);
      }, 'Money settings saved 💰')}>Save money settings</button>
    </div>
  );
}
