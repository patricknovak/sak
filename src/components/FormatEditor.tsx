import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { useAction } from './ui';

// The league's format: one season-long total (SaK's), or weekly head-to-head matchups on a schedule the commissioner
// makes here (commish_set_format, commish_make_schedule). The schedule can be made again until its first week starts;
// the playoff spots go with it, since the bracket takes the season's last weeks (migration 120).
export function FormatEditor() {
  const { league, refresh, teams } = useLeague();
  const { busy, run } = useAction();
  const [weeks, setWeeks] = useState<{ n: number; first: string | null; started: boolean } | null>(null);
  const load = () => supabase.from('matchups').select('week,starts').order('week').then(({ data }) => {
    const d = (data ?? []) as { week: number; starts: string }[];
    setWeeks({ n: d.length ? d[d.length - 1].week : 0, first: d[0]?.starts ?? null, started: !!d[0] && new Date(d[0].starts + 'T12:00:00') <= new Date() });
  });
  useEffect(() => { load(); }, [league?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [po, setPo] = useState<number | null>(null);
  if (!league) return null;
  const gms = teams.filter((t) => t.role !== 'spectator').length;
  const spots = po ?? league.h2h_playoffs ?? 0;
  const roundsFor = (n: number) => (n < 2 ? 0 : Math.ceil(Math.log2(n)));
  const choices = [0, 2, 4, 6, 8].filter((n) => n <= gms);
  const h2h = league.format === 'h2h';
  const roto = !!league.categories?.length;

  return (
    <div className="card mb-3 space-y-3 p-3">
      <div className="label">The format</div>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-white/[.05] p-1">
        {([['season', '📈 Season total'], ['h2h', '⚔️ Head-to-head']] as const).map(([k, l]) => (
          <button key={k} type="button" disabled={busy || league.format === k}
            onClick={() => confirm(k === 'h2h' ? 'Play weekly head-to-head matchups? Make the schedule next.' : 'Go back to one season-long total?') && run(async () => { await rpc('commish_set_format', { p_format: k }); await refresh(['league']); }, k === 'h2h' ? 'Head-to-head it is' : 'Season total it is')}
            className={`rounded-full px-3 py-2 text-sm font-semibold transition disabled:cursor-default ${(league.format ?? 'season') === k ? 'tab-on' : 'text-mute hover:text-slate-200 disabled:opacity-40'}`}>{l}</button>
        ))}
      </div>
      <p className="text-xs text-mute">{h2h ? `Each week (Monday to Sunday) every team plays one other; ${roto ? 'more categories won' : 'more points'} wins. The table is wins, losses and ties.` : roto ? 'Every team is ranked in each category over the whole season.' : 'Every point from opening night to the end of the regular season counts toward one table.'}</p>
      {h2h && (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm">
          {weeks?.n ? (
            <p className="text-slate-200">{weeks.n} weeks scheduled, starting {weeks.first ? fmtDate(weeks.first) : ''}{(league.h2h_playoffs ?? 0) >= 2 ? `, then ${roundsFor(league.h2h_playoffs!)} ${roundsFor(league.h2h_playoffs!) === 1 ? 'week' : 'weeks'} of playoffs for the top ${league.h2h_playoffs}` : ', no playoffs'}.</p>
          ) : <p className="text-slate-200">No schedule yet.</p>}
          {!weeks?.started && (
            <>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-mute">Playoffs</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {choices.map((n) => (
                  <button key={n} type="button" disabled={busy} onClick={() => setPo(n)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${spots === n ? 'tab-on' : 'bg-white/[.05] text-mute hover:text-slate-200'}`}>
                    {n === 0 ? 'None' : `Top ${n}`}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-mute">{spots >= 2 ? `The top ${spots} meet in a bracket over the season's last ${roundsFor(spots)} ${roundsFor(spots) === 1 ? 'week' : 'weeks'}, one a round; the top seeds get a bye when the field isn't 2, 4 or 8.` : 'No bracket: the table at the end of the regular season decides it.'}</p>
              <button className="btn-primary mt-3 w-full" disabled={busy || !league.season_start || !league.season_end}
                onClick={() => run(async () => { const n = await rpc<number>('commish_make_schedule', { p_playoffs: spots }); await load(); await refresh(['league']); setPo(null); return n; }, spots >= 2 ? `Schedule made, with playoffs for the top ${spots}` : 'Schedule made: every team meets every other in turn')}>
                {weeks?.n ? 'Make the schedule again' : 'Make the schedule'}
              </button>
            </>
          )}
          {weeks?.started && <p className="mt-1 text-xs text-mute">The schedule is set: its first week has started.</p>}
        </div>
      )}
    </div>
  );
}
