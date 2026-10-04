import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { CATEGORIES, STANDARD_CATEGORIES } from '../lib/categories';
import { useAction } from './ui';

// How the league is won: by fantasy points (the scoring below), or rotisserie, by the categories the commissioner
// picks here (commish_set_categories). Players still earn fantasy points either way: projections, rankings and the
// draft board read them.
export function CategoryEditor() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<'points' | 'roto'>('points');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    setMode(league?.categories?.length ? 'roto' : 'points');
    setPicked(league?.categories?.length ? league.categories : STANDARD_CATEGORIES);
  }, [league?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!league) return null;
  const was = league.categories?.length ? 'roto' : 'points';
  const changed = mode !== was || (mode === 'roto' && picked.slice().sort().join() !== (league.categories ?? []).slice().sort().join());
  const save = () => run(async () => { await rpc('commish_set_categories', { p_keys: mode === 'roto' ? picked : null }); await refresh(['league']); },
    mode === 'roto' ? 'The league plays rotisserie' : 'The league plays for points');

  return (
    <div className="card mb-3 space-y-3 p-3">
      <div className="label">How the league is won</div>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-white/[.05] p-1">
        {([['points', '🏒 Fantasy points'], ['roto', '📊 Rotisserie']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-full px-3 py-2 text-sm font-semibold transition ${mode === k ? 'tab-on' : 'text-mute hover:text-slate-200'}`}>{l}</button>
        ))}
      </div>
      {mode === 'points'
        ? <p className="text-xs text-mute">Every stat a player starts for you is worth the points set below; the most points wins.</p>
        : (
          <>
            <p className="text-xs text-mute">Teams are ranked in each category on the season totals of the players they start: first earns as many points as there are teams, last earns one. Pick 3 to 12. The point values below still rank players for the draft and the projections.</p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const on = picked.includes(c.key);
                return (
                  <button key={c.key} type="button" title={c.label} onClick={() => setPicked(on ? picked.filter((x) => x !== c.key) : [...picked, c.key])}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 bg-white/[.04] text-slate-300'}`}>
                    {c.short} <span className="font-normal opacity-70">· {c.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      <button className="btn-primary w-full" disabled={busy || !changed || (mode === 'roto' && (picked.length < 3 || picked.length > 12))} onClick={save}>
        {mode === 'roto' ? `Play rotisserie in ${picked.length} categories` : 'Play for fantasy points'}
      </button>
    </div>
  );
}
