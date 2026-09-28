// A GM's season at a glance from the forecast engine: projected finish, odds and the one thing to fix.
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { fmtPts, ordinal } from '../lib/format';
import { useDraftAnalysis } from '../pages/DraftAnalysis';
import { gradeColor } from '../lib/grades';

const pct = (v: number) => (v >= 0.995 ? '>99%' : v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
export function TeamForecastCard({ teamId }: { teamId: number }) {
  const { team } = useLeague();
  const a = useDraftAnalysis();
  if (!a) return <div className="card h-20 animate-pulse" />;
  const i = a.teams.findIndex((t) => t.team === teamId);
  const t = a.teams[i];
  if (!t) return null;
  const weakest = Object.entries(t.posRank).sort((x, y) => y[1] - x[1])[0];
  return (
    <Link to="/draft/analysis" className="card flex flex-wrap items-center gap-3 p-3 transition hover:bg-white/[.04]">
      <div className="text-2xl">📈</div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">Full-year forecast: {ordinal(i + 1)} of {a.teams.length} · {fmtPts(t.year, 0)} pts</div>
        <div className="text-xs text-mute">🏆 SAK Cup {pct(t.so.cup.first)} · regular season {pct(t.odds.first)} ({pct(t.odds.top3)} in the money) · playoffs {pct(t.so.po.first)} · weakest spot {weakest[0]} (#{weakest[1]}){t.moves[0] ? ` · ${t.moves[0].split('.')[0]}.` : ''}</div>
      </div>
      <div className="text-center"><div className="text-[9px] uppercase tracking-wider text-mute">Roster</div><div className={`h-display text-2xl ${gradeColor(t.rosterGrade)}`}>{t.rosterGrade}</div></div>
      <span className="text-xs text-sky-300">Full analysis for {team(teamId)?.gm_name} ›</span>
    </Link>
  );
}
