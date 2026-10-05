// Lineup New, side by side: a team's lineup against any other team's, for one day slot by slot (who plays, against
// whom, what each should score, and where the two meet in the same game) or across the days ahead (starter games,
// light-night starts, starts by position and the expected points day by day).
import { useEffect, useMemo, useState } from 'react';
import { Swords } from 'lucide-react';
import { START, addDays, isStart, monthDay, weekday, type Kit, type Row } from '../../lib/lineupKit';
import { Headshot, TeamBadge } from '../ui';
import { fmt1, GameLine } from './bits';
import type { Team } from '../../lib/types';

export function CompareView({ kit, teamId, other, setOther, day, onInfo }: { kit: Kit; teamId: number; other: number | null; setOther: (id: number) => void; day: string; onInfo: (id: number) => void }) {
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const teams = kit.teams.filter((t) => t.role !== 'spectator');
  const a = teams.find((t) => t.id === teamId), b = teams.find((t) => t.id === other);
  useEffect(() => { if (other) kit.loadPlans([other]); }, [other]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="scroll-x flex gap-1.5 pb-1">
        {teams.filter((t) => t.id !== teamId).map((t) => (
          <button key={t.id} type="button" onClick={() => setOther(t.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold ring-1 transition ${other === t.id ? 'bg-white/15 text-white ring-white/40' : 'bg-white/[.04] text-slate-300 ring-white/10'}`}>
            <TeamBadge team={t} size={22} /> {t.gm_name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
        {(['day', 'week'] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-xl py-2 text-xs font-bold ${mode === m ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{m === 'day' ? (day === kit.today ? 'Tonight' : monthDay(day)) : 'Next 7 days'}</button>)}
      </div>
      {!a || !b ? <div className="card p-4 text-sm text-mute">Pick a team to compare with.</div>
        : mode === 'day' ? <DayCompare kit={kit} a={a} b={b} day={day < kit.today ? kit.today : day} onInfo={onInfo} /> : <WeekCompare kit={kit} a={a} b={b} from={day < kit.today ? kit.today : day} />}
    </div>
  );
}

function Totals({ a, b, va, vb, label }: { a: Team; b: Team; va: number; vb: number; label: string }) {
  const tot = Math.max(0.01, va + vb);
  return (
    <div className="card-hero p-4">
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><TeamBadge team={a} size={36} /><div className="min-w-0"><div className="break-words text-sm font-bold text-white">{a.name}</div><div className="num text-2xl font-black text-white">{fmt1(va)}</div></div></div>
        <Swords className="h-5 w-5 shrink-0 text-white/40" />
        <div className="flex min-w-0 items-center gap-2 text-right"><div className="min-w-0"><div className="break-words text-sm font-bold text-white">{b.name}</div><div className="num text-2xl font-black text-white">{fmt1(vb)}</div></div><TeamBadge team={b} size={36} /></div>
      </div>
      <div className="relative mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/10">
        <span style={{ width: `${(va / tot) * 100}%`, background: a.color }} /><span style={{ width: `${(vb / tot) * 100}%`, background: b.color }} />
      </div>
      <div className="relative mt-1 text-center text-[11px] text-white/60">{label}</div>
    </div>
  );
}

function DayCompare({ kit, a, b, day, onInfo }: { kit: Kit; a: Team; b: Team; day: string; onInfo: (id: number) => void }) {
  const side = (t: Team) => {
    const slots = kit.lineupOf(t.id, day).slots;
    const r = kit.rosterOf(t.id);
    const by: Record<string, Row[]> = {};
    for (const x of r) { const s = slots.get(x.p.id) ?? 'BN'; if (isStart(s)) (by[s] ??= []).push(x); }
    for (const k of Object.keys(by)) by[k].sort((x, y) => kit.expPts(y.p) - kit.expPts(x.p));
    const bench = r.filter((x) => slots.get(x.p.id) === 'BN' && kit.gameFor(x.p.nhl_team, day));
    return { by, bench, stats: kit.dayStats(t.id, day, slots) };
  };
  const A = useMemo(() => side(a), [a, day, kit]); // eslint-disable-line react-hooks/exhaustive-deps
  const B = useMemo(() => side(b), [b, day, kit]); // eslint-disable-line react-hooks/exhaustive-deps
  const gameId = (x: Row | undefined) => kit.gameFor(x?.p.nhl_team, day)?.id;
  const bGames = new Set(Object.values(B.by).flat().map(gameId).filter(Boolean));
  const cell = (x: Row | undefined, right: boolean, other: Row | undefined) => {
    if (!x) return <div className={`flex h-full items-center ${right ? 'justify-end' : ''} text-[11px] text-red-300/70`}>Empty</div>;
    const g = kit.gameFor(x.p.nhl_team, day);
    const v = g ? kit.expPts(x.p) : 0, ov = other && kit.gameFor(other.p.nhl_team, day) ? kit.expPts(other.p) : 0;
    const shared = g && bGames.has(g.id) && !right;
    return (
      <button type="button" onClick={() => onInfo(x.p.id)} className={`flex w-full min-w-0 items-center gap-2 text-left ${right ? 'flex-row-reverse text-right' : ''}`}>
        <Headshot p={x.p} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] font-semibold leading-tight text-white">{x.p.last_name ?? x.p.name}</span>
          <span className={`flex flex-wrap items-center gap-1 ${right ? 'justify-end' : ''}`}><GameLine p={x.p} g={g} compact />{shared && <span className="rounded-full bg-fuchsia-400/15 px-1.5 text-[9px] font-black uppercase text-fuchsia-200" title="Both teams have someone in this game">Same game</span>}</span>
        </span>
        <span className={`num shrink-0 text-sm font-black ${!g ? 'text-white/25' : v >= ov ? 'text-emerald-300' : 'text-white/80'}`}>{g ? fmt1(v) : '–'}</span>
      </button>
    );
  };
  const rows = START.flatMap((s) => Array.from({ length: kit.caps[s] ?? 0 }, (_, i) => ({ s, i })));
  return (
    <div className="space-y-3">
      <Totals a={a} b={b} va={A.stats.pts} vb={B.stats.pts} label={`Expected points ${day === kit.today ? 'tonight' : `on ${monthDay(day)}`} · ${A.stats.playing} and ${B.stats.playing} starters play`} />
      <div className="card divide-y divide-white/[.05] overflow-hidden">
        {rows.map(({ s, i }) => (
          <div key={s + i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2.5 py-2">
            {cell(A.by[s]?.[i], false, B.by[s]?.[i])}
            <span className="grid h-6 w-9 place-items-center rounded-lg bg-white/[.06] text-[10px] font-black text-mute">{s}</span>
            {cell(B.by[s]?.[i], true, A.by[s]?.[i])}
          </div>
        ))}
      </div>
      {(A.bench.length > 0 || B.bench.length > 0) && (
        <div className="card p-3 text-xs">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute">On the bench with a game</div>
          <div className="grid grid-cols-2 gap-3">
            {[A, B].map((x, k) => <div key={k} className="space-y-0.5 text-slate-300">{x.bench.length ? x.bench.map((r) => <div key={r.p.id} className="break-words">{r.p.name} <span className="text-mute">{fmt1(kit.expPts(r.p))}</span></div>) : <span className="text-mute">Nobody</span>}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekCompare({ kit, a, b, from }: { kit: Kit; a: Team; b: Team; from: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const sum = (t: Team) => {
    const per = days.map((d) => {
      const slots = kit.lineupOf(t.id, d).slots;
      const st = kit.dayStats(t.id, d, slots);
      const pos: Record<string, number> = {};
      let light = 0;
      for (const x of kit.rosterOf(t.id)) {
        const s = slots.get(x.p.id) ?? 'BN';
        if (isStart(s) && kit.gameFor(x.p.nhl_team, d)) { const k = s === 'Util' ? 'F' : s === 'LW' || s === 'RW' || s === 'C' ? 'F' : s; pos[k] = (pos[k] ?? 0) + 1; if (kit.light(d)) light++; }
      }
      return { ...st, pos, light };
    });
    return { per, pts: per.reduce((t, x) => t + x.pts, 0), games: per.reduce((t, x) => t + x.playing, 0), light: per.reduce((t, x) => t + x.light, 0),
      F: per.reduce((t, x) => t + (x.pos.F ?? 0), 0), D: per.reduce((t, x) => t + (x.pos.D ?? 0), 0), G: per.reduce((t, x) => t + (x.pos.G ?? 0), 0), sit: per.reduce((t, x) => t + x.benched, 0) };
  };
  const A = sum(a), B = sum(b);
  const metric = (label: string, va: number, vb: number, dec = false, lowWins = false) => {
    const aw = lowWins ? va < vb : va > vb, bw = lowWins ? vb < va : vb > va;
    return (
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-sm">
        <span className={`num font-black ${aw ? 'text-emerald-300' : 'text-white'}`}>{dec ? fmt1(va) : va}</span>
        <span className="text-center text-[11px] font-semibold text-mute">{label}</span>
        <span className={`num text-right font-black ${bw ? 'text-emerald-300' : 'text-white'}`}>{dec ? fmt1(vb) : vb}</span>
      </div>
    );
  };
  const max = Math.max(0.01, ...A.per.map((x) => x.pts), ...B.per.map((x) => x.pts));
  return (
    <div className="space-y-3">
      <Totals a={a} b={b} va={A.pts} vb={B.pts} label={`Expected points, ${monthDay(days[0])} to ${monthDay(days[6])}, on each team's lineups as they stand`} />
      <div className="card divide-y divide-white/[.05] overflow-hidden">
        {metric('Starter games', A.games, B.games)}
        {metric('Forward starts', A.F, B.F)}
        {metric('Defence starts', A.D, B.D)}
        {metric('Goalie starts', A.G, B.G)}
        {metric('Light-night starts', A.light, B.light)}
        {metric('Sitting with a game', A.sit, B.sit, false, true)}
      </div>
      <div className="card p-3">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em] text-mute">Day by day</div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => (
            <div key={d} className={`flex flex-col items-center gap-1 rounded-xl py-1.5 ${kit.light(d) ? 'bg-sky-400/[.07]' : ''}`}>
              <div className="flex h-20 items-end gap-0.5">
                <span className="w-2.5 rounded-t" style={{ height: `${(A.per[i].pts / max) * 100}%`, background: a.color }} />
                <span className="w-2.5 rounded-t" style={{ height: `${(B.per[i].pts / max) * 100}%`, background: b.color }} />
              </div>
              <span className="text-[9px] font-bold uppercase text-mute">{d === kit.today ? 'Tdy' : weekday(d)}</span>
              <span className="num text-[9px] text-slate-300">{fmt1(A.per[i].pts)}·{fmt1(B.per[i].pts)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
