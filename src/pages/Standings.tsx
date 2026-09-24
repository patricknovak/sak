import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { selectAll } from '../lib/supabase';
import { fmtDate, fmtMoney, fmtPts, readable } from '../lib/format';
import { Rank, Section, TeamBadge, TeamName, PageHeader } from '../components/ui';
import type { Team } from '../lib/types';
import { Trophy } from 'lucide-react';
import { SEASONS } from '../data/history';
import { PLACES, prizes } from '../lib/prizes';

interface Daily { team_id: number; date: string; points: number }

// top three on the podium: 2nd, 1st, 3rd
function Podium({ rows, caption }: { rows: { t?: Team; name: string; gm: string; pts: number }[]; caption: string }) {
  const steps = [
    { r: rows[1], place: 2, h: 'h-20', medal: 'from-white via-[#cfd8ea] to-[#8a97b3]' },
    { r: rows[0], place: 1, h: 'h-28', medal: 'from-[#fff1b8] via-[#f7c548] to-[#b97c06]' },
    { r: rows[2], place: 3, h: 'h-14', medal: 'from-[#ffd2a8] via-[#d98b4a] to-[#8a4b1c]' },
  ];
  return (
    <div className="card-hero px-3 pb-0 pt-5" style={{ '--tc': '#f7c548' } as React.CSSProperties}>
      <div className="label relative mb-3 text-center text-white/70">{caption}</div>
      <div className="relative grid grid-cols-3 items-end gap-2">
        {steps.map(({ r, place, h, medal }) => r && (
          <div key={place} className="flex flex-col items-center">
            {place === 1 && <div className="mb-1 text-2xl drop-shadow-[0_0_12px_rgba(247,197,72,.8)]">👑</div>}
            {r.t ? <TeamBadge team={r.t} size={place === 1 ? 58 : 46} ring={place === 1} /> : <div className="h-12 w-12 rounded-full bg-white/10" />}
            <div className="mt-1.5 w-full truncate text-center text-xs font-bold">{r.name}</div>
            <div className="text-[10px] text-white/60">{r.gm}</div>
            <div className="num font-display text-base font-extrabold">{fmtPts(r.pts)}</div>
            <div className={`mt-1.5 w-full ${h} rounded-t-xl bg-gradient-to-b ${medal} grid place-items-start justify-center pt-1 shadow-[inset_0_1px_0_rgba(255,255,255,.6)]`}>
              <span className="font-display text-3xl font-extrabold text-black/40">{place}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const leader = [...series].sort((a, b) => b.pts[b.pts.length - 1] - a.pts[a.pts.length - 1])[0];
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
        <text x={W - P.r} y={H - 6} fontSize={10} fill="#8b97b5" textAnchor="end">{fmtDate(dates[dates.length - 1])}</text>
        {order.map((s) => (
          <path key={s.t} d={path(s.pts)} fill="none" strokeWidth={s.t === focus ? 2.5 : 1.5} strokeLinejoin="round"
            stroke={s.t === focus ? readable(team(s.t)?.color ?? '#ef2a4f') : '#3a4768'} style={s.t === focus ? { filter: `drop-shadow(0 0 5px ${readable(team(s.t)?.color ?? '#ef2a4f')})` } : undefined} />
        ))}
        {[...new Set([focus, leader.t])].map((t) => {
          const s = series.find((z) => z.t === t);
          if (!s) return null;
          return <text key={t} x={W - P.r + 6} y={y(s.pts[s.pts.length - 1]) + 4} fontSize={11} fill="#e7ecf7">{team(t)?.gm_name}</text>;
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#8b97b5" strokeDasharray="3 3" />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-xl border border-white/10 bg-[#0b1222]/90 p-2 text-xs shadow-xl backdrop-blur">
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
  const { standings, playoffs, team, teams, me, league, online } = useLeague();
  const playoffsOn = playoffs.some((t) => Number(t.points) !== 0);
  const [view, setView] = useState<'regular' | 'playoffs'>(playoffsOn ? 'playoffs' : 'regular');
  useEffect(() => { if (playoffsOn) setView('playoffs'); }, [playoffsOn]);
  const isPo = view === 'playoffs';
  const [daily, setDaily] = useState<Daily[]>([]);
  useEffect(() => {
    selectAll<Daily>(isPo ? 'playoff_daily' : 'team_daily', 'team_id,date,points', 1000, ['date', 'team_id']).then(setDaily, () => {});
  }, [standings, playoffs, isPo]);
  const table = useMemo(() => [...(isPo ? playoffs : standings)].sort((a, b) => a.rank - b.rank), [standings, playoffs, isPo]);
  const money = prizes(league, teams.length);
  const pot = isPo ? money.playoffs : money.regular;
  const last = table[table.length - 1], second = table[table.length - 2];
  const scored = table.some((t) => Number(t.points) !== 0);

  return (
    <div className="space-y-5">
      <PageHeader icon={<Trophy size={22} className="text-gold" />} title="Standings" sub={`${league?.season} season`} />

      <div className="grid grid-cols-2 gap-2">
        {([['regular', 'Regular season', money.regularPool, money.regularPct, money.regular], ['playoffs', 'Playoffs', money.playoffPool, money.playoffPct, money.playoffs]] as const).map(([k, label, amt, pct, places]) => (
          <button key={k} onClick={() => setView(k)}
            className={`card p-3 text-left transition active:scale-[.98] ${view === k ? 'border-gold/40 shadow-[0_0_0_1px_rgba(247,197,72,.25),0_12px_32px_-18px_rgba(247,197,72,.7)]' : 'opacity-75'}`}
            style={view === k ? { background: 'linear-gradient(160deg, rgba(247,197,72,.14), rgba(15,23,41,.8) 55%)' } : undefined}>
            <div className="label flex items-center justify-between"><span>{k === 'playoffs' ? '🏆 ' : '🏒 '}{label}</span><span>{pct}%</span></div>
            <div className="num text-gold-shine mt-1 font-display text-2xl font-extrabold">{fmtMoney(amt)}</div>
            <div className="num mt-0.5 text-[11px] text-mute">{places.map((v, i) => `${PLACES[i]} ${fmtMoney(v)}`).join(' · ')}</div>
          </button>
        ))}
      </div>

      {league?.phase !== 'season' && !scored && (
        <div className="card p-4 text-sm text-mute">The season hasn’t started. Scoring begins {league?.season_start && fmtDate(league.season_start)}. Last season’s final table is on the <Link className="text-sky-300" to="/league">League page</Link>.</div>
      )}
      {isPo && !scored && (
        <div className="card p-4 text-sm text-slate-300">🏆 <b>The SaK playoffs</b> run alongside the NHL playoffs with the same rosters. Every fantasy point scored in an NHL playoff game counts toward this separate table, and the top three split {money.playoffPct}% of the prize pool. Players whose NHL team is eliminated stop scoring, so depth on deep playoff teams wins it.</div>
      )}
      {scored && table.length >= 3
        ? <Podium caption={isPo ? 'Playoff podium right now' : 'If the season ended today'} rows={table.slice(0, 3).map((s) => ({ t: team(s.team_id), name: team(s.team_id)?.name ?? '', gm: team(s.team_id)?.gm_name ?? '', pts: Number(s.points) }))} />
        : !isPo && <Podium caption={`${SEASONS[0].season} final podium`} rows={SEASONS[0].rows.slice(0, 3).map((r) => ({ t: teams.find((x) => x.name === r.team), name: r.team, gm: r.gm, pts: r.points }))} />}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[.04] text-left text-[11px] uppercase tracking-wider text-mute">
            <tr><th className="px-3 py-2">#</th><th>Team</th><th className="text-right">Pts</th><th className="hidden text-right sm:table-cell">Today</th><th className="hidden text-right sm:table-cell">7 days</th><th className="px-3 text-right">Back</th></tr>
          </thead>
          <tbody className="divide-y divide-white/[.06]">
            {table.map((s, i) => (
              <tr key={s.team_id} className={s.team_id === me?.id ? 'bg-white/5' : ''}>
                <td className="px-3 py-2.5">{scored ? <Rank n={s.rank} /> : <span className="grid h-7 w-7 place-items-center text-mute">–</span>}</td>
                <td>
                  <Link to={`/team/${s.team_id}`} className="flex items-center gap-2">
                    <TeamBadge team={team(s.team_id)} size={28} />
                    <div className="min-w-0"><TeamName team={team(s.team_id)} className="block truncate" />
                      <div className="text-[11px] text-mute">{team(s.team_id)?.gm_name}{!isPo && ` · ${s.moves} pickups`}{online.has(s.team_id) && <span className="text-emerald-400"> · online</span>}
                        {scored && i < 3 && pot[i] ? <span className="text-gold"> · {fmtMoney(pot[i])}</span> : null}{!isPo && scored && i === table.length - 1 && table.length > 1 ? ' · 🪣 Peter watch' : ''}</div></div>
                  </Link>
                </td>
                <td className="num text-right font-display text-lg font-extrabold">{fmtPts(s.points)}</td>
                <td className="hidden text-right text-emerald-300 sm:table-cell">{s.today ? '+' + fmtPts(s.today) : '–'}</td>
                <td className="hidden text-right sm:table-cell">{fmtPts(s.last7)}</td>
                <td className="px-3 text-right text-mute">{i === 0 ? '—' : fmtPts(table[0].points - s.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isPo && scored && last && second && (
        <p className="px-1 text-xs text-mute">🪣 Peter Punishment if the regular season ended now: {team(last.team_id)?.gm_name} owes {fmtMoney(Math.round((second.points - last.points) * 100) / 100)} to the SaK Fund.</p>
      )}
      <Section title={isPo ? 'Playoff points race' : 'Points race'}>
        <div className="card p-3"><Race daily={daily} focus={me?.id ?? 0} /></div>
      </Section>
      {!isPo && (
        <Section title={`Last season (${SEASONS[0].season})`}>
          <div className="card divide-y divide-white/[.06]">
            {SEASONS[0].rows.map((r, i) => (
              <div key={r.team} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-5 text-mute">{i + 1}</span><span className="flex-1">{r.team} <span className="text-mute">· {r.gm}</span></span>
                <span>{fmtPts(r.points, 2)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
