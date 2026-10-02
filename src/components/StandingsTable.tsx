// The standings table, one for every screen that shows it (Standings and Home). Built to fit a phone: every
// column stays on screen at 390 px, the team cell truncates instead of pushing numbers off the edge, and
// "back of the leader" rides under the points instead of taking a column.
// The day column shows today's points once tonight's first game has started; before that it shows yesterday's,
// so the morning after a game night still reads like a box score instead of a row of dashes.
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { fmtMoney, fmtPts } from '../lib/format';
import type { Standing } from '../lib/types';
import { Rank, TeamBadge, TeamName } from './ui';

const STARTED = new Set(['LIVE', 'CRIT', 'OFF', 'FINAL']);

export function StandingsTable({ rows, view = 'regular', pot = [], peter = false }: {
  rows: Standing[];
  view?: 'regular' | 'playoffs' | 'cup';
  pot?: number[];          // prize money by finishing place, shown on the top rows
  peter?: boolean;         // flag last place for the Peter
}) {
  const { team, me, online, games, leagueDay } = useLeague();
  const table = [...rows].sort((a, b) => a.rank - b.rank);
  const scored = table.some((t) => Number(t.points) !== 0);
  const tonight = games.some((g) => g.date === leagueDay && STARTED.has(g.state));
  const lead = Number(table[0]?.points ?? 0);
  const benchWhen = view === 'cup' ? 'this year' : view === 'playoffs' ? 'in the playoffs' : 'this season';

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-white/[.04] text-left text-[10px] uppercase tracking-wider text-mute">
          <tr>
            <th className="w-9 py-2 pl-2 pr-1">#</th>
            <th className="px-1">Team</th>
            <th className="px-1 text-right" title="Points, and how far back of the leader">Pts</th>
            <th className="px-1 text-right" title={tonight ? 'Points scored today' : 'Points scored yesterday (today’s games haven’t started)'}>{tonight ? 'Today' : 'Yest'}</th>
            <th className="px-1 text-right" title="Points over the last 7 days">7d</th>
            <th className="py-2 pl-1 pr-2 text-right" title={`Points left on the bench and IR ${benchWhen}: shown, never counted`}>Bench</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[.06]">
          {table.map((s, i) => {
            const t = team(s.team_id);
            const day = Number(tonight ? s.today : s.yesterday);
            const back = lead - Number(s.points);
            const sub = [
              t?.gm_name,
              view === 'regular' && s.moves != null ? `${s.moves} pickup${Number(s.moves) === 1 ? '' : 's'}` : null,
            ].filter(Boolean).join(' · ');
            return (
              <tr key={s.team_id} className={s.team_id === me?.id ? 'bg-white/[.05]' : ''}>
                <td className="py-2 pl-2 pr-1">{scored ? <Rank n={s.rank} /> : <span className="grid h-7 w-7 place-items-center text-mute">–</span>}</td>
                <td className="w-full max-w-0 px-1">
                  <Link to={`/team/${s.team_id}`} className="flex min-w-0 items-center gap-2">
                    <TeamBadge team={t} size={26} />
                    <span className="min-w-0">
                      <TeamName team={t} className="block truncate text-[13px] font-bold leading-tight" />
                      <span className="block truncate text-[10px] text-mute">
                        {sub}
                        {online.has(s.team_id) && <span className="text-emerald-400"> · online</span>}
                        {scored && pot[i] ? <span className="text-gold"> · {fmtMoney(pot[i])}</span> : null}
                        {peter && scored && i === table.length - 1 && table.length > 1 ? ' · 🪣' : ''}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-1 text-right">
                  <div className="num font-display text-base font-extrabold leading-tight">{fmtPts(s.points)}</div>
                  <div className="num text-[10px] text-mute">{i === 0 || !scored ? '—' : `−${fmtPts(back)}`}</div>
                </td>
                <td className={`num whitespace-nowrap px-1 text-right text-xs ${day > 0 ? 'text-emerald-300' : day < 0 ? 'text-red-300' : 'text-mute'}`}>{day ? `${day > 0 ? '+' : ''}${fmtPts(day)}` : '–'}</td>
                <td className="num whitespace-nowrap px-1 text-right text-xs text-slate-300">{Number(s.last7) ? fmtPts(s.last7) : '–'}</td>
                <td className="num whitespace-nowrap py-2 pl-1 pr-2 text-right text-xs text-mute">
                  {Number(s.bench) ? fmtPts(s.bench) : '–'}
                  {tonight && Number(s.bench_today) > 0 && <div className="text-[10px] text-amber-200">+{fmtPts(s.bench_today)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
