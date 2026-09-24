import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fmtDate, fmtMoney, fmtPts } from '../lib/format';
import { Section, TeamBadge, TeamName } from '../components/ui';
import { SEASONS } from '../data/history';

interface Daily { team_id: number; date: string; points: number }

// cumulative points race: your team highlighted, everyone else recessive
function Race({ daily, focus }: { daily: Daily[]; focus: number }) {
  const { team } = useLeague();
  const [hover, setHover] = useState<number | null>(null);
  const dates = [...new Set(daily.map((d) => d.date))].sort();
  const teams = [...new Set(daily.map((d) => d.team_id))];
  const series = teams.map((t) => {
    let acc = 0;
    return { t, pts: dates.map((d) => (acc += daily.find((x) => x.team_id === t && x.date === d)?.points ?? 0)) };
  });
  if (dates.length < 2) return <div className="p-6 text-center text-sm text-mute">The points race chart appears after a couple of game days.</div>;
  const W = 640, H = 220, P = { l: 40, r: 70, t: 10, b: 22 };
  const max = Math.max(...series.flatMap((s) => s.pts), 1);
  const x = (i: number) => P.l + (i / (dates.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = (pts: number[]) => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const order = [...series].sort((a, b) => (a.t === focus ? 1 : 0) - (b.t === focus ? 1 : 0));
  const leader = [...series].sort((a, b) => b.pts.at(-1)! - a.pts.at(-1)!)[0];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (dates.length - 1)))));
        }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="#26324f" strokeWidth={1} />
            <text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10} fill="#8b97b5">{Math.round(max * f)}</text></g>
        ))}
        <text x={P.l} y={H - 6} fontSize={10} fill="#8b97b5">{fmtDate(dates[0])}</text>
        <text x={W - P.r} y={H - 6} fontSize={10} fill="#8b97b5" textAnchor="end">{fmtDate(dates.at(-1)!)}</text>
        {order.map((s) => (
          <path key={s.t} d={path(s.pts)} fill="none" strokeWidth={s.t === focus ? 2.5 : 1.5} strokeLinejoin="round"
            stroke={s.t === focus ? team(s.t)?.color ?? '#e11d48' : '#4b5878'} />
        ))}
        {[...new Set([focus, leader.t])].map((t) => {
          const s = series.find((z) => z.t === t);
          if (!s) return null;
          return <text key={t} x={W - P.r + 6} y={y(s.pts.at(-1)!) + 4} fontSize={11} fill="#e7ecf7">{team(t)?.gm_name}</text>;
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#8b97b5" strokeDasharray="3 3" />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-xl border border-line bg-ice/95 p-2 text-xs shadow-xl">
          <div className="mb-1 font-semibold">{fmtDate(dates[hover])}</div>
          {[...series].sort((a, b) => b.pts[hover] - a.pts[hover]).map((s) => (
            <div key={s.t} className="flex justify-between gap-4"><span className={s.t === focus ? 'font-semibold' : 'text-slate-300'}>{team(s.t)?.gm_name}</span><span>{fmtPts(s.pts[hover])}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Standings() {
  const { standings, team, me, league, online } = useLeague();
  const [daily, setDaily] = useState<Daily[]>([]);
  useEffect(() => {
    supabase.from('team_daily').select('team_id,date,points').order('date').then(({ data }) => setDaily((data ?? []) as Daily[]));
  }, [standings]);
  const table = useMemo(() => [...standings].sort((a, b) => a.rank - b.rank), [standings]);
  const pool = (league?.entry_fee ?? 200) - (league?.sak_fee ?? 25);
  const prizes = (league?.prize_split ?? [60, 30, 10]).map((p) => (p / 100) * pool * table.length);
  const last = table.at(-1), second = table.at(-2);

  return (
    <div className="space-y-5">
      <h1 className="h-display text-2xl">{league?.season} Standings</h1>
      {league?.phase !== 'season' && (
        <div className="card p-4 text-sm text-mute">The season hasn’t started. Scoring begins {league?.season_start && fmtDate(league.season_start)}. Last season’s final table is on the <Link className="text-sky-300" to="/league">League page</Link>.</div>
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-boards/60 text-left text-[11px] uppercase tracking-wider text-mute">
            <tr><th className="px-3 py-2">#</th><th>Team</th><th className="text-right">Pts</th><th className="hidden text-right sm:table-cell">Today</th><th className="hidden text-right sm:table-cell">7 days</th><th className="px-3 text-right">Back</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {table.map((s, i) => (
              <tr key={s.team_id} className={s.team_id === me?.id ? 'bg-white/5' : ''}>
                <td className="px-3 py-2.5 font-display text-lg text-mute">{s.rank}</td>
                <td>
                  <Link to={`/team/${s.team_id}`} className="flex items-center gap-2">
                    <TeamBadge team={team(s.team_id)} size={28} />
                    <div className="min-w-0"><TeamName team={team(s.team_id)} className="block truncate" />
                      <div className="text-[11px] text-mute">{team(s.team_id)?.gm_name} · {s.moves} pickups{online.has(s.team_id) && <span className="text-emerald-400"> · online</span>}
                        {i < 3 && prizes[i] ? <span className="text-gold"> · {fmtMoney(prizes[i])}</span> : null}{i === table.length - 1 && table.length > 1 ? ' · 🪣 Peter watch' : ''}</div></div>
                  </Link>
                </td>
                <td className="text-right font-display text-lg font-bold">{fmtPts(s.points)}</td>
                <td className="hidden text-right text-emerald-300 sm:table-cell">{s.today ? '+' + fmtPts(s.today) : '–'}</td>
                <td className="hidden text-right sm:table-cell">{fmtPts(s.last7)}</td>
                <td className="px-3 text-right text-mute">{i === 0 ? '—' : fmtPts(table[0].points - s.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {last && second && league?.phase === 'season' && (
        <p className="px-1 text-xs text-mute">🪣 Peter Punishment if the season ended now: {team(last.team_id)?.gm_name} owes {fmtMoney(Math.round((second.points - last.points) * 100) / 100)} to the SaK Fund.</p>
      )}
      <Section title="Points race">
        <div className="card p-3"><Race daily={daily} focus={me?.id ?? 0} /></div>
      </Section>
      <Section title={`Last season (${SEASONS[0].season})`}>
        <div className="card divide-y divide-line">
          {SEASONS[0].rows.map((r, i) => (
            <div key={r.team} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-5 text-mute">{i + 1}</span><span className="flex-1">{r.team} <span className="text-mute">· {r.gm}</span></span>
              <span>{fmtPts(r.points, 2)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
