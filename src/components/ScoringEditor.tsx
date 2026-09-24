import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { SCORING_STATS } from '../lib/format';
import { Toggle, useAction } from './ui';

type Side = 'skater' | 'goalie';
type Draft = Record<Side, Record<string, { on: boolean; value: string }>>;

// Yahoo-style scoring settings: flip a stat on, give it a point value, save once.
export function ScoringEditor() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);

  const fromLeague = useMemo((): Draft | null => {
    if (!league) return null;
    const d = { skater: {}, goalie: {} } as Draft;
    for (const side of ['skater', 'goalie'] as Side[]) {
      for (const [k] of SCORING_STATS[side]) {
        const v = league.scoring[side]?.[k];
        d[side][k] = { on: v != null && v !== 0, value: v != null ? String(v) : '' };
      }
    }
    return d;
  }, [league?.updated_at]);
  useEffect(() => setDraft(fromLeague), [fromLeague]);
  if (!draft || !league) return null;

  const set = (side: Side, k: string, patch: Partial<{ on: boolean; value: string }>) =>
    setDraft({ ...draft, [side]: { ...draft[side], [k]: { ...draft[side][k], ...patch } } });

  const invalid = (['skater', 'goalie'] as Side[]).some((side) =>
    Object.values(draft[side]).some((s) => s.on && (s.value.trim() === '' || Number.isNaN(Number(s.value)))));
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromLeague);

  const save = () => {
    const scoring = { skater: {} as Record<string, number>, goalie: {} as Record<string, number> };
    for (const side of ['skater', 'goalie'] as Side[]) {
      for (const [k, s] of Object.entries(draft[side])) if (s.on && Number(s.value) !== 0) scoring[side][k] = Number(s.value);
    }
    if (!confirm('Save the new scoring? Every game this season is re-scored and the draft rankings are recalculated.')) return;
    run(async () => { await rpc('commish_update_scoring', { p_scoring: scoring }); await refresh(['league', 'players', 'standings', 'season']); },
      'Scoring saved. Everything has been re-scored.');
  };

  return (
    <div className="card p-3">
      {(['skater', 'goalie'] as Side[]).map((side) => (
        <div key={side} className="mb-4">
          <div className="h-display mb-1 text-base">{side === 'skater' ? 'Forwards / Defencemen' : 'Goaltenders'}</div>
          <div className="divide-y divide-line">
            {SCORING_STATS[side].map(([k, label]) => {
              const s = draft[side][k];
              return (
                <div key={k} className="flex items-center gap-3 py-2">
                  <div className="flex-1 text-sm">{label}</div>
                  {s.on && (
                    <label className="flex items-center gap-1">
                      <input className="input w-24 py-1 text-right" inputMode="decimal" value={s.value}
                        onChange={(e) => set(side, k, { value: e.target.value.replace(/[^\d.-]/g, '') })} />
                      <span className="text-xs text-mute">pts</span>
                    </label>
                  )}
                  <Toggle on={s.on} onChange={(v) => set(side, k, { on: v, value: v && !s.value ? '1' : s.value })} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="sticky bottom-20 flex items-center gap-2 rounded-xl bg-rink/95 py-2 lg:bottom-2">
        <span className="flex-1 text-xs text-mute">ⓘ Nothing changes until you save. Saving re-scores the whole season.</span>
        <button className="btn-ghost" disabled={!dirty || busy} onClick={() => setDraft(fromLeague)}>Cancel</button>
        <button className="btn-primary" disabled={!dirty || invalid || busy} onClick={save}>Save changes</button>
      </div>
    </div>
  );
}
