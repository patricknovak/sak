import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { SCORING_STATS } from '../lib/format';
import { Toggle, useAction } from './ui';

type Side = 'skater' | 'goalie';
type Draft = Record<Side, Record<string, { on: boolean; value: string }>>;

// Fantrax's scoring categories, by their code (or short name where the code wasn't seen), to the stats here
const FANTRAX: Record<Side, Record<string, string>> = {
  skater: {
    INDIVIDUAL_GOALS: 'g', INDIVIDUAL_ASSISTS: 'a', INDIVIDUAL_POINTS: 'pts', INDIVIDUAL_PLUS_MINUS: 'pm', INDIVIDUAL_PENALTY_MINUTES: 'pim',
    PPG: 'ppg', PPA: 'ppa', INDIVIDUAL_POWER_PLAY_POINTS: 'ppp', SHG: 'shg', SHA: 'sha', INDIVIDUAL_SHORT_HANDED_POINTS: 'shp',
    GWG: 'gwg', INDIVIDUAL_SHOTS_ON_GOAL: 'sog', INDIVIDUAL_FACEOFFS_WON: 'fow', FOL: 'fol', INDIVIDUAL_HITS: 'hit', INDIVIDUAL_BLOCKS: 'blk',
  },
  goalie: {
    GS: 'gs', INDIVIDUAL_GOALIE_WINS: 'w', INDIVIDUAL_LOSSES: 'l', OTL: 'otl', INDIVIDUAL_GOALS_AGAINST: 'ga', SA: 'sa',
    INDIVIDUAL_SAVES: 'sv', INDIVIDUAL_SHUTOUTS: 'sho',
  },
};
type FCat = { code: string; shortName: string };
type FScoring = { type?: string; scoringCategorySettings?: { group?: { code?: string }; configs?: { position?: { code?: string }; scoringCategory?: FCat; points?: number }[] }[] };

// A league coming from Fantrax copies its points in one go: the commissioner pastes the league's link, every stat both
// sites keep takes Fantrax's value, and the editor shows the result to check and save (nothing is saved until then).
// Fantrax's public API answers any website, so no server of ours is involved.
async function fantraxScoring(link: string): Promise<{ weights: Record<Side, Record<string, number>>; skipped: string[]; byPosition: boolean; name: string }> {
  const id = link.match(/(?:league\/|leagueId=)([a-z0-9]{16})\b/i)?.[1] ?? link.match(/^\s*([a-z0-9]{16})\s*$/i)?.[1];
  if (!id) throw new Error('Paste the league’s Fantrax link (it has /league/ and the league’s code in it).');
  const r = await fetch(`https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=${id.toLowerCase()}`);
  const b = r.ok ? await r.json() : null;
  if (!b || b.error || !b.scoringSystem) throw new Error('Fantrax has no league at that link.');
  const sc = b.scoringSystem as FScoring;
  if (!/POINTS/.test(sc.type ?? '')) throw new Error('That Fantrax league plays categories, not points: set its categories under the league’s format instead.');
  const weights: Record<Side, Record<string, number>> = { skater: {}, goalie: {} };
  const skipped = new Set<string>();
  let byPosition = false;
  for (const g of sc.scoringCategorySettings ?? []) {
    const side: Side = g.group?.code === 'HOCKEY_GOALIE' ? 'goalie' : 'skater';
    for (const c of g.configs ?? []) {
      if (!c.scoringCategory || c.points == null) continue;
      // a value set for one position only (defencemen's goals worth more, say): the league-wide one is used
      if (c.position?.code && c.position.code !== 'DEFAULT') { byPosition = true; continue; }
      const k = FANTRAX[side][c.scoringCategory.code] ?? FANTRAX[side][c.scoringCategory.shortName];
      if (k) weights[side][k] = c.points;
      else if (c.points) skipped.add(`${c.scoringCategory.shortName}${side === 'goalie' ? ' (goalies)' : ''}`);
    }
  }
  return { weights, skipped: [...skipped], byPosition, name: b.leagueName ?? 'the Fantrax league' };
}

// Yahoo-style scoring settings: flip a stat on, give it a point value, save once.
export function ScoringEditor() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copy, setCopy] = useState<{ open: boolean; link: string; busy: boolean; note: string | null; err: string | null }>({ open: false, link: '', busy: false, note: null, err: null });

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

  const fromFantrax = async () => {
    setCopy({ ...copy, busy: true, err: null, note: null });
    try {
      const f = await fantraxScoring(copy.link);
      const d = { skater: {}, goalie: {} } as Draft;
      for (const side of ['skater', 'goalie'] as Side[]) {
        for (const [k] of SCORING_STATS[side]) { const v = f.weights[side][k]; d[side][k] = { on: v != null && v !== 0, value: v != null ? String(v) : '' }; }
      }
      setDraft(d);
      const n = Object.values(f.weights.skater).filter(Boolean).length + Object.values(f.weights.goalie).filter(Boolean).length;
      setCopy((c) => ({ ...c, busy: false, open: false, note: [`${n} stat${n === 1 ? '' : 's'} copied from ${f.name}. Check them below, then save.`,
        f.skipped.length ? `Not kept here, so left out: ${f.skipped.join(', ')}.` : '',
        f.byPosition ? 'Fantrax scores some stats differently by position; the league-wide value is used.' : ''].filter(Boolean).join(' ') }));
    } catch (e) { setCopy((c) => ({ ...c, busy: false, err: (e as Error).message })); }
  };

  return (
    <div className="card p-3">
      <div className="mb-3 rounded-xl border border-dashed border-sky-400/30 bg-sky-500/[.06] p-3">
        {!copy.open ? (
          <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setCopy({ ...copy, open: true, err: null })}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-[10px] font-black tracking-tight text-sky-100">FTX</span>
            <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Copy the scoring from Fantrax</span><span className="block text-xs text-mute">Paste your Fantrax league’s link; you check it before anything is saved.</span></span>
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs text-mute" htmlFor="fantrax-scoring">Your Fantrax league’s link</label>
            <div className="flex gap-2">
              <input id="fantrax-scoring" className="input min-w-0 flex-1" inputMode="url" placeholder="fantrax.com/fantasy/league/…" value={copy.link} onChange={(e) => setCopy({ ...copy, link: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') fromFantrax(); }} />
              <button type="button" className="btn-primary shrink-0" disabled={copy.busy || !copy.link.trim()} onClick={fromFantrax}>{copy.busy ? 'Reading…' : 'Copy'}</button>
            </div>
          </div>
        )}
        {copy.err && <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-sm leading-snug">{copy.err}</div>}
        {copy.note && <div className="mt-2 text-xs leading-snug text-sky-100">{copy.note}</div>}
      </div>
      {(['skater', 'goalie'] as Side[]).map((side) => (
        <div key={side} className="mb-4">
          <div className="h-display mb-1 text-base">{side === 'skater' ? 'Forwards / Defencemen' : 'Goaltenders'}</div>
          <div className="divide-y divide-white/[.06]">
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
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] flex items-center gap-2 rounded-xl bg-rink/95 py-2 lg:bottom-2">
        <span className="flex-1 text-xs text-mute">ⓘ Nothing changes until you save. Saving re-scores the whole season.</span>
        <button className="btn-ghost" disabled={!dirty || busy} onClick={() => setDraft(fromLeague)}>Cancel</button>
        <button className="btn-primary" disabled={!dirty || invalid || busy} onClick={save}>Save changes</button>
      </div>
    </div>
  );
}
