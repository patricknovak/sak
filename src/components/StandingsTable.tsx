// The standings table, one for every screen that shows it (Standings and Home). Built to fit a phone: every
// column stays on screen at 360 px, the team's name wraps to a second line instead of pushing numbers off the edge, and
// "back of the leader" rides under the points instead of taking a column.
// The day column shows today's points once tonight's first game has started; before that it shows yesterday's,
// so the morning after a game night still reads like a box score instead of a row of dashes.
import { Link } from 'react-router-dom';
import { useLeague, useSport } from '../lib/store';
import { hasStarted } from '../lib/sport';
import { fmtMoney, fmtPts } from '../lib/format';
import type { Standing } from '../lib/types';
import { Move, Rank, TeamBadge, TeamName } from './ui';


export function StandingsTable({ rows, view = 'regular', pot = [], peter = false, compact = false }: {
  rows: Standing[];
  compact?: boolean;       // Home's table: on a phone the 7-day and bench columns give the team's name their room
  view?: 'regular' | 'playoffs' | 'cup';
  pot?: number[];          // prize money by finishing place, shown on the top rows
  peter?: boolean;         // flag last place for the Peter
}) {
  const { team, me, online, games, leagueDay } = useLeague();
  const sport = useSport();
  const table = [...rows].sort((a, b) => a.rank - b.rank);
  const scored = table.some((t) => Number(t.points) !== 0);
  const tonight = games.some((g) => g.date === leagueDay && hasStarted(sport, g.state));
  const lead = Number(table[0]?.points ?? 0);
  // the moves tonight, as the pools' tables show them: each team's place before today's points against its place now
  const before = new Map([...table].sort((a, b) => (Number(b.points) - Number(b.today ?? 0)) - (Number(a.points) - Number(a.today ?? 0)))
    .map((s, _i, all) => [s.team_id, 1 + all.findIndex((x) => Number(x.points) - Number(x.today ?? 0) === Number(s.points) - Number(s.today ?? 0))]));
  // the columns Home leaves to the Standings page on a phone
  const extra = compact ? 'hidden sm:table-cell' : '';
  const benchWhen = view === 'cup' ? 'this year' : view === 'playoffs' ? 'in the playoffs' : 'this season';

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-white/[.04] text-left text-[10px] uppercase tracking-wider text-mute">
          <tr>
            <th className="w-9 py-2 pl-2 pr-1">#</th>
            <th className="px-1">Team</th>
            <th className="px-1 text-right" title="Points, and how far back of the leader">Pts</th>
            <th className={`px-1 text-right ${compact ? 'pr-2 sm:pr-1' : ''}`} title={tonight ? 'Points scored today' : 'Points scored yesterday (today’s games haven’t started)'}>{tonight ? 'Today' : 'Yest'}</th>
            <th className={`px-1 text-right ${extra}`} title="Points over the last 7 days">7d</th>
            <th className={`py-2 pl-1 pr-2 text-right ${extra}`} title={`Points left on the bench and IR ${benchWhen}: shown, never counted`}>Bench</th>
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
                <td className="py-2 pl-2 pr-1">{scored ? <span className="flex flex-col items-center gap-0.5"><Rank n={s.rank} />{tonight && <Move n={(before.get(s.team_id) ?? s.rank) - s.rank} size={10} />}</span> : <span className="grid h-7 w-7 place-items-center text-mute">–</span>}</td>
                <td className="w-full max-w-0 px-1">
                  <Link to={`/team/${s.team_id}`} className="flex min-w-0 items-center gap-2">
                    <TeamBadge team={t} size={26} />
                    <span className="min-w-0">
                      <TeamName team={t} className="line-clamp-2 break-words text-[13px] font-bold leading-tight" />
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
                <td className={`num whitespace-nowrap px-1 text-right text-xs ${compact ? 'pr-2 sm:pr-1' : ''} ${day > 0 ? 'text-emerald-300' : day < 0 ? 'text-red-300' : 'text-mute'}`}>{day ? `${day > 0 ? '+' : ''}${fmtPts(day)}` : '–'}</td>
                <td className={`num whitespace-nowrap px-1 text-right text-xs text-slate-300 ${extra}`}>{Number(s.last7) ? fmtPts(s.last7) : '–'}</td>
                <td className={`num whitespace-nowrap py-2 pl-1 pr-2 text-right text-xs text-mute ${extra}`}>
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
