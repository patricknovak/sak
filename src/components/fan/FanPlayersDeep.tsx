// The fan zone's player analytics (24 October 2026): every skater's pace, 5-on-5 scoring rate, shot share on the ice
// and deployment in one table; who is running hot or cold against his own career; the milestones in reach this season;
// who the coaches lean on in each situation; and the goalies by goals saved above average.
import { useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';
import { usePlayerInfo } from '../../lib/playerInfo';
import { fmtToi } from '../../lib/fanZone';
import type { CreaseRead, Milestone, PlayerRead } from '../../lib/fanDeep';
import { Chips, pctStr } from './kit';

type Sort = 'pts' | 'paceP' | 'p60' | 'sat' | 'satRel' | 'zs' | 'ppShare' | 'toi';
const COLS: [Sort, string, (p: PlayerRead) => string][] = [
  ['pts', 'P', (p) => String(p.pts)],
  ['paceP', 'Pace', (p) => Math.round(p.paceP).toString()],
  ['p60', 'P/60', (p) => (p.p60 == null ? '–' : p.p60.toFixed(2))],
  ['sat', 'CF%', (p) => (p.sat == null ? '–' : (p.sat * 100).toFixed(1))],
  ['satRel', 'Rel', (p) => (p.satRel == null ? '–' : `${p.satRel > 0 ? '+' : ''}${(p.satRel * 100).toFixed(1)}`)],
  ['zs', 'OZ%', (p) => (p.zs == null ? '–' : (p.zs * 100).toFixed(0))],
  ['ppShare', 'PP%', (p) => (p.ppShare == null ? '–' : (p.ppShare * 100).toFixed(0))],
  ['toi', 'TOI', (p) => fmtToi(p.toi)],
];

export function PlayerTable({ rows }: { rows: PlayerRead[] }) {
  const info = usePlayerInfo();
  const [sort, setSort] = useState<Sort>('pts');
  const [pos, setPos] = useState<'all' | 'F' | 'D'>('all');
  const shown = rows.filter((p) => pos === 'all' || (pos === 'D' ? p.pos === 'D' : p.pos !== 'D')).sort((a, b) => ((b[sort] ?? -9) as number) - ((a[sort] ?? -9) as number));
  return (
    <div className="card overflow-hidden">
      <div className="space-y-2 border-b border-white/[.06] px-3 py-2">
        <b className="block text-sm text-white">The numbers behind the points</b>
        <Chips label="Position" items={[['all', 'All'], ['F', 'Forwards'], ['D', 'Defence']] as const} value={pos} onChange={setPos} />
      </div>
      <div className="scroll-x">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-mute">
              <th className="sticky left-0 z-10 bg-[#121a2e] px-3 py-1.5 text-left font-semibold">Player</th>
              {COLS.map(([k, label]) => (
                <th key={k} className="px-1.5 text-right font-semibold">
                  <button type="button" onClick={() => setSort(k)} className={sort === k ? 'text-white' : ''} aria-label={`Sort by ${label}`}>{label}{sort === k ? ' ▾' : ''}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[.05]">
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-white/[.03]">
                <td className="sticky left-0 z-10 bg-[#121a2e] px-3 py-1.5">
                  <button type="button" onClick={() => info?.(p.id)} className="flex max-w-[9.5rem] items-center gap-1.5 text-left">
                    <span className="rounded bg-white/[.06] px-1 text-[9px] font-bold text-slate-300">{p.pos}</span>
                    <b className="truncate text-white">{p.name.split(' ').slice(-1)[0]}</b>
                    {p.luck === 'hot' ? <Flame className="h-3 w-3 shrink-0 text-amber-300" /> : p.luck === 'cold' ? <Snowflake className="h-3 w-3 shrink-0 text-sky-300" /> : null}
                  </button>
                </td>
                {COLS.map(([k, , f]) => <td key={k} className={`num px-1.5 text-right ${sort === k ? 'font-bold text-white' : 'text-slate-300'}`}>{f(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-white/[.06] px-3 py-2 text-[11px] leading-snug text-mute">Pace: points over 82 games. P/60: 5-on-5 points per 60 minutes. CF%: share of 5-on-5 shot attempts with him on the ice; Rel: that against the club without him. OZ%: his 5-on-5 shifts started in the attacking end. PP%: his share of the power-play time. <Flame className="inline h-3 w-3 text-amber-300" /> running hot, <Snowflake className="inline h-3 w-3 text-sky-300" /> running cold.</p>
    </div>
  );
}

export function LuckWatch({ rows }: { rows: PlayerRead[] }) {
  const info = usePlayerInfo();
  // the four most consequential each way: the biggest scorers running hot, the most-used players running cold
  const hot = rows.filter((p) => p.luck === 'hot').sort((a, b) => b.pts - a.pts).slice(0, 4), cold = rows.filter((p) => p.luck === 'cold').sort((a, b) => b.toi - a.toi).slice(0, 4);
  if (!hot.length && !cold.length) return null;
  const item = (p: PlayerRead, h: boolean) => (
    <button key={p.id} type="button" onClick={() => info?.(p.id)} className="flex w-full items-start gap-2.5 py-2 text-left">
      {p.headshot ? <img src={p.headshot} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-full bg-white/[.06] object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-full bg-white/[.06]" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm"><b className="text-white">{p.name}</b>{h ? <Flame className="h-3.5 w-3.5 text-amber-300" /> : <Snowflake className="h-3.5 w-3.5 text-sky-300" />}<span className="text-[11px] text-mute">{p.g} G · {p.pts} P</span></span>
        <span className="block text-[12px] leading-snug text-slate-300">{p.luckNote}</span>
      </span>
    </button>
  );
  return (
    <div className="card p-4">
      <b className="text-white">The regression watch</b>
      <p className="text-xs text-mute">Finishing and on-ice luck a long way from normal drift back over a season. Who should cool off, and who is due.</p>
      <div className="mt-1 divide-y divide-white/[.05]">{hot.map((p) => item(p, true))}{cold.map((p) => item(p, false))}</div>
    </div>
  );
}

export function Milestones({ list }: { list: Milestone[] }) {
  const info = usePlayerInfo();
  if (!list.length) return null;
  return (
    <div className="card p-4">
      <b className="text-white">Milestones in reach</b>
      <p className="text-xs text-mute">Career round numbers each player gets to this season at his current pace.</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.map((m) => (
          <button key={`${m.id}-${m.what}`} type="button" onClick={() => info?.(m.id)} className="flex items-center gap-2.5 rounded-2xl bg-white/[.03] px-2.5 py-2 text-left ring-1 ring-white/[.06]">
            {m.headshot ? <img src={m.headshot} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-full bg-white/[.06] object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-full bg-white/[.06]" />}
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm text-white">{m.name}</b>
              <span className="block text-[11px] text-mute">{m.now} career {m.what} · {m.need} to go</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="num block font-display text-lg font-extrabold leading-none" style={{ color: 'var(--club)' }}>{m.at}</span>
              <span className="block text-[10px] text-mute">{m.what === 'games' ? `in ${m.games} games` : `~${m.games} games`}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Usage({ leaders }: { leaders: { ev: PlayerRead | null; pp: PlayerRead | null; sh: PlayerRead | null } }) {
  const rows = [['Even strength', leaders.ev, 'evToi'], ['Power play', leaders.pp, 'ppToi'], ['Penalty kill', leaders.sh, 'shToi']] as const;
  if (!rows.some(([, p]) => p)) return null;
  return (
    <div className="card p-4">
      <b className="text-white">Who the coaches trust</b>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {rows.map(([k, p, f]) => (
          <div key={k} className="min-w-0 rounded-2xl bg-white/[.03] p-2 text-center ring-1 ring-white/[.06]">
            <div className="text-[11px] text-mute">{k}</div>
            {p ? <>
              {p.headshot ? <img src={p.headshot} alt="" loading="lazy" className="mx-auto mt-1 h-10 w-10 rounded-full bg-white/[.06] object-cover" /> : null}
              <div className="mt-1 truncate text-[13px] font-bold text-white">{p.name.split(' ').slice(-1)[0]}</div>
              <div className="num text-[11px] text-slate-300">{fmtToi(p[f])} a game</div>
            </> : <div className="text-sm text-mute">–</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreaseDeep({ list, owner }: { list: CreaseRead[]; owner: (id: number) => React.ReactNode }) {
  const info = usePlayerInfo();
  if (!list.length) return null;
  return (
    <div className="card p-4">
      <b className="text-white">In goal</b>
      <p className="text-xs text-mute">Goals saved above average: the goals a league-average goalie would have allowed on the same shots, less the ones he did.</p>
      <div className="mt-2 space-y-3">
        {list.map((g) => (
          <button key={g.id} type="button" onClick={() => info?.(g.id)} className="block w-full text-left">
            <div className="flex items-center gap-2.5">
              {g.headshot ? <img src={g.headshot} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-full bg-white/[.06] object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-full bg-white/[.06]" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm"><b className="truncate text-white">{g.name}</b>{owner(g.id)}</div>
                <div className="text-[11px] text-mute">{g.gs} starts · {pctStr(g.svp)}{g.evSvp != null ? ` · even strength ${pctStr(g.evSvp)}` : ''}{g.career?.svp != null ? ` · career ${pctStr(g.career.svp)}` : ''}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`num font-display text-xl font-extrabold leading-none ${g.gsaa == null ? 'text-white' : g.gsaa >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{g.gsaa == null ? '–' : `${g.gsaa >= 0 ? '+' : '−'}${Math.abs(g.gsaa).toFixed(1)}`}</div>
                <div className="text-[10px] text-mute">GSAA</div>
              </div>
            </div>
            {g.qsPct != null && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mute">
                <span className="w-24 shrink-0">Quality starts {Math.round(g.qsPct * 100)}%</span>
                <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-white/[.06]"><div className="h-1.5 rounded-full" style={{ width: `${g.qsPct * 100}%`, background: g.qsPct >= 0.53 ? 'rgb(52 211 153)' : 'rgb(248 113 113)' }} /><span className="absolute -top-0.5 h-2.5 w-0.5 bg-white/70" style={{ left: '53%' }} /></div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
