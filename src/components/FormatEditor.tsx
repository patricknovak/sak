import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { useAction } from './ui';

// The league's format: one season-long total (SaK's), or weekly head-to-head matchups on a schedule the commissioner
// makes here (commish_set_format, commish_make_schedule). The schedule can be made again until its first week starts.
export function FormatEditor() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const [weeks, setWeeks] = useState<{ n: number; first: string | null; started: boolean } | null>(null);
  const load = () => supabase.from('matchups').select('week,starts').order('week').then(({ data }) => {
    const d = (data ?? []) as { week: number; starts: string }[];
    setWeeks({ n: d.length ? d[d.length - 1].week : 0, first: d[0]?.starts ?? null, started: !!d[0] && new Date(d[0].starts + 'T12:00:00') <= new Date() });
  });
  useEffect(() => { load(); }, [league?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!league) return null;
  const h2h = league.format === 'h2h';
  const roto = !!league.categories?.length;

  return (
    <div className="card mb-3 space-y-3 p-3">
      <div className="label">The format</div>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-white/[.05] p-1">
        {([['season', '📈 Season total'], ['h2h', '⚔️ Head-to-head']] as const).map(([k, l]) => (
          <button key={k} type="button" disabled={busy || (k === 'h2h' && roto) || league.format === k}
            onClick={() => confirm(k === 'h2h' ? 'Play weekly head-to-head matchups? Make the schedule next.' : 'Go back to one season-long total?') && run(async () => { await rpc('commish_set_format', { p_format: k }); await refresh(['league']); }, k === 'h2h' ? 'Head-to-head it is' : 'Season total it is')}
            className={`rounded-full px-3 py-2 text-sm font-semibold transition disabled:cursor-default ${(league.format ?? 'season') === k ? 'tab-on' : 'text-mute hover:text-slate-200 disabled:opacity-40'}`}>{l}</button>
        ))}
      </div>
      <p className="text-xs text-mute">{h2h ? 'Each week (Monday to Sunday) every team plays one other; more points wins. The table is wins, losses and ties.' : 'Every point from opening night to the end of the regular season counts toward one table.'}{roto && ' Head-to-head plays for points: switch rotisserie off to use it.'}</p>
      {h2h && (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm">
          {weeks?.n ? <p className="text-slate-200">{weeks.n} weeks scheduled, starting {weeks.first ? fmtDate(weeks.first) : ''}.</p> : <p className="text-slate-200">No schedule yet.</p>}
          {!weeks?.started && (
            <button className="btn-primary mt-2 w-full" disabled={busy || !league.season_start || !league.season_end}
              onClick={() => run(async () => { const n = await rpc<number>('commish_make_schedule'); await load(); return n; }, 'Schedule made: every team meets every other in turn')}>
              {weeks?.n ? 'Make the schedule again' : 'Make the schedule'}
            </button>
          )}
          {weeks?.started && <p className="mt-1 text-xs text-mute">The schedule is set: its first week has started.</p>}
        </div>
      )}
    </div>
  );
}
