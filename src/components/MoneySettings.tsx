import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtMoney } from '../lib/format';
import { PLACES, potsOf, prizes } from '../lib/prizes';
import { bare, useBrand } from '../lib/brand';
import { useAction } from './ui';

// commissioner: entry fee, the fund's share, the three pots, the 1st/2nd/3rd split and the pickup rules
export function MoneySettings() {
  const { league, teams, refresh } = useLeague();
  const brand = useBrand();
  const POTS = potsOf(brand);
  const { busy, run } = useAction();
  const [f, setF] = useState({ entry: '200', fund: '25', split: ['60', '30', '10'], playoff: '25', cup: '25', acq: '10', bonus: '3' });
  useEffect(() => {
    if (!league) return;
    setF({
      entry: String(league.entry_fee), fund: String(league.sak_fee), split: (league.prize_split ?? [60, 30, 10]).map(String),
      playoff: String(league.playoff_share ?? 25), cup: String(league.cup_share ?? 25),
      acq: String(league.max_acquisitions ?? 10), bonus: String(league.playoff_bonus_acq ?? 3),
    });
  }, [league?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const splitSum = f.split.reduce((t, x) => t + (Number(x) || 0), 0);
  const preview = prizes(league ? { ...league, entry_fee: Number(f.entry), sak_fee: Number(f.fund), prize_split: f.split.map(Number), playoff_share: Number(f.playoff), cup_share: Number(f.cup) } : null, teams.length);
  const regular = 100 - Number(f.playoff) - Number(f.cup);
  const bad = splitSum !== 100 || Number(f.fund) > Number(f.entry) || regular < 0 || Number(f.playoff) < 0 || Number(f.cup) < 0;
  const num = (v: string) => v.replace(/[^\d.]/g, '');
  const field = (label: string, k: 'entry' | 'fund' | 'playoff' | 'cup' | 'acq' | 'bonus') => (
    <label className="text-xs text-mute">{label}<input className="input mt-1" inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: num(e.target.value) })} /></label>
  );

  return (
    <div className="card space-y-3 p-3">
      <div className="font-semibold">Money settings</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('Entry per GM', 'entry')}
        {field(`To ${brand.fund}`, 'fund')}
        {field(`${bare(brand.playoff)} %`, 'playoff')}
        {field(`${bare(brand.trophy)} %`, 'cup')}
      </div>
      <div className="text-xs text-mute">{brand.regular} (regular season) gets the rest: <b className={regular < 0 ? 'text-red-300' : 'text-white'}>{regular}%</b></div>
      <div>
        <div className="mb-1 text-xs text-mute">Payout split for each pot (must add to 100) <span className={splitSum === 100 ? 'text-emerald-300' : 'text-red-300'}>· {splitSum}%</span></div>
        <div className="grid grid-cols-3 gap-2">
          {f.split.map((v, i) => (
            <label key={i} className="text-xs text-mute">{PLACES[i]} %<input className="input mt-1" inputMode="decimal" value={v} onChange={(e) => { const s = [...f.split]; s[i] = num(e.target.value); setF({ ...f, split: s }); }} /></label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {field('Free pickups', 'acq')}
        {field('Playoff bonus', 'bonus')}
      </div>
      <div className="space-y-0.5 rounded-xl border border-white/10 bg-black/25 p-2.5 text-xs">
        <div>Pool {fmtMoney(preview.pool)} ({teams.length} × {fmtMoney(preview.entry - preview.fund)}) · {brand.fund} {fmtMoney(preview.fundTotal)}</div>
        {POTS.map((p) => <div key={p.key}>{p.icon} {p.trophy} {preview.pots[p.key].pct}% {fmtMoney(preview.pots[p.key].amount)}: {preview.pots[p.key].places.map((v, i) => `${PLACES[i]} ${fmtMoney(v)}`).join(' · ')}</div>)}
      </div>
      <button className="btn-primary w-full" disabled={busy || bad} onClick={() => run(async () => {
        await rpc('commish_update_league', { p: {
          entry_fee: Number(f.entry), sak_fee: Number(f.fund), prize_split: f.split.map(Number), playoff_share: Number(f.playoff), cup_share: Number(f.cup),
          max_acquisitions: Number(f.acq), playoff_bonus_acq: Number(f.bonus),
        } });
        await refresh(['league']);
      }, 'Money settings saved 💰')}>Save money settings</button>
    </div>
  );
}
