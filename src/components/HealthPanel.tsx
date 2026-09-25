// Commissioner's system status: the scheduled jobs, the score sync, Garry, and anything the half-hourly
// health check would have flagged (it also sends the commissioner a notification when something breaks).
import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { ago } from '../lib/format';
import { Section } from './ui';
import { useNow } from '../lib/store';

interface Job { job: string; schedule: string; last: string | null; status: string | null }
interface Health { jobs: Job[]; issues: string[]; phase: string; db_time: string; checked_at: string; scores_ok_at?: string | null; daily_ok_at?: string | null; errors_30m?: number; last_error?: string | null; last_score_row?: string | null; last_bot_post?: string | null; games_today?: number }

const NAMES: Record<string, string> = {
  'nhl-scores': 'NHL scores & box scores', 'nhl-schedule': 'NHL schedule', 'nhl-players': 'NHL rosters', 'nhl-corrections': 'Stat corrections', 'nhl-injuries': 'Injury report', 'nhl-news': 'NHL news',
  'garry-daily': 'Garry’s morning post', 'garry-nudge': 'Garry’s lineup nudge', 'garry-weekly': 'Garry’s Monday column', 'auto-lineups': 'Lineup auto-pilot', 'auto-lineups-late': 'Auto-pilot (pre-game)',
  'process-pending': 'Draft clock & trade processor', 'health-check': 'This health check',
};

export function HealthPanel() {
  const now = useNow(30_000);
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setH(await rpc<Health>('commish_health')); setErr(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const when = (iso?: string | null) => (iso ? ago(iso, now) : 'never');
  const ok = h && h.issues.length === 0;
  return (
    <Section title="🩺 System status" right={<button className="btn-ghost btn-sm" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Re-check'}</button>}>
      <div className="card p-3">
        {err && <div className="text-sm text-red-300">{err}</div>}
        {!h && !err && <div className="text-sm text-mute">Checking…</div>}
        {h && (
          <>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400' : 'animate-pulse bg-red-400'}`} />
              {ok ? 'All systems go' : `${h.issues.length} issue${h.issues.length > 1 ? 's' : ''}`}
              <span className="ml-auto text-xs font-normal opacity-70">checked {when(h.checked_at)} · runs every 30 min, you get a notification when something breaks</span>
            </div>
            {h.issues.length > 0 && <ul className="mt-2 space-y-1 text-sm text-red-200">{h.issues.map((i) => <li key={i}>⚠️ {i}</li>)}</ul>}
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
              {[
                ['Score sync OK', when(h.scores_ok_at)], ['Garry’s morning post', when(h.daily_ok_at)], ['Last box-score row', when(h.last_score_row)], ['Last bot post', when(h.last_bot_post)],
                ['Games today', String(h.games_today ?? 0)], ['Errors (30 min)', String(h.errors_30m ?? 0)], ['Phase', h.phase], ['Database clock', new Date(h.db_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })],
              ].map(([k, v]) => <div key={k} className="rounded-lg bg-white/[.04] px-2 py-1.5"><div className="text-[10px] text-mute">{k}</div><div className="font-semibold">{v}</div></div>)}
            </div>
            {h.last_error && <div className="mt-2 truncate rounded-lg bg-white/[.04] px-2 py-1.5 font-mono text-[11px] text-amber-200" title={h.last_error}>Last error: {h.last_error}</div>}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-mute"><tr><th className="py-1 text-left font-semibold">Scheduled job</th><th className="text-left font-semibold">Schedule (UTC)</th><th className="text-left font-semibold">Last run</th><th className="text-left font-semibold">Result</th></tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {h.jobs.map((j) => (
                    <tr key={j.job}>
                      <td className="py-1 pr-2">{NAMES[j.job] ?? j.job}<span className="ml-1 text-mute">{j.job}</span></td>
                      <td className="num pr-2">{j.schedule}</td>
                      <td className="pr-2">{when(j.last)}</td>
                      <td className={j.status === 'succeeded' ? 'text-emerald-300' : j.status ? 'text-red-300' : 'text-mute'}>{j.status ?? 'not yet'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
