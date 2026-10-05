// Lineup New, the week: every player down the side, the days across. A cell is his slot that day with the opponent:
// green when he starts with a game, amber when he sits with one, a dot with no game. Light nights are tinted. On your
// own team a tap starts or benches him for that day (into an open slot, or in place of a starter with no game, or of
// the weakest starter he can replace). The foot of each column counts the starters who play and what they should score.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useLeague } from '../../lib/store';
import { START, addDays, hurt, isStart, monthDay, weekday, type Kit } from '../../lib/lineupKit';
import { Headshot } from '../ui';
import { fmt1, useSave } from './bits';
import { OptimizeSheet } from './DayView';
import type { Player } from '../../lib/types';

export function WeekView({ kit, teamId, from, readOnly, onDay, onInfo }: { kit: Kit; teamId: number; from: string; readOnly: boolean; onDay: (d: string) => void; onInfo: (id: number) => void }) {
  const { me } = useLeague();
  const { save, busy } = useSave();
  const [span, setSpan] = useState(7);
  const [opt, setOpt] = useState(false);
  const start = from < kit.today ? kit.today : from;
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  const roster = kit.rosterOf(teamId);
  const lineups = new Map(days.map((d) => [d, kit.lineupOf(teamId, d).slots]));
  const order = [...roster].sort((a, b) => {
    const s = (x: typeof a) => ({ C: 0, LW: 1, RW: 2, D: 3, Util: 4, G: 5, BN: 6, IR: 7 } as Record<string, number>)[lineups.get(start)?.get(x.p.id) ?? 'BN'];
    return s(a) - s(b) || kit.expPts(b.p) - kit.expPts(a.p);
  });
  const editable = !readOnly && me?.role !== 'spectator';

  // start or bench him for a day, the least disruptive way
  const toggle = async (p: Player, d: string) => {
    if (!editable || busy || kit.lockedOn(p, d)) return;
    const cur = lineups.get(d)!;
    const s = cur.get(p.id) ?? 'BN';
    if (s === 'IR') return;
    const next = new Map(cur);
    if (isStart(s)) { next.set(p.id, 'BN'); await save(d, next, cur, `${p.last_name ?? p.name} benched for ${d === kit.today ? 'today' : monthDay(d)}`); return; }
    const count: Record<string, number> = {};
    for (const v of cur.values()) count[v] = (count[v] ?? 0) + 1;
    const open = START.find((sl) => kit.canPlay(p, sl) && (count[sl] ?? 0) < (kit.caps[sl] ?? 0));
    if (open) { next.set(p.id, open); await save(d, next, cur, `${p.last_name ?? p.name} into ${open} for ${d === kit.today ? 'today' : monthDay(d)}`); return; }
    // a starter he can replace: one with no game first, else the one expected to score least (and less than him)
    const cands = roster.filter((x) => isStart(cur.get(x.p.id)) && kit.canPlay(p, cur.get(x.p.id)!) && !kit.lockedOn(x.p, d) && x.r.pin !== 'start');
    const idle = cands.find((x) => !kit.gameFor(x.p.nhl_team, d));
    const weakest = [...cands].sort((a, b) => kit.expPts(a.p) - kit.expPts(b.p))[0];
    const out = idle ?? (weakest && kit.expPts(weakest.p) < kit.expPts(p) ? weakest : undefined);
    if (!out) return;
    const sl = cur.get(out.p.id)!;
    next.set(p.id, sl); next.set(out.p.id, 'BN');
    await save(d, next, cur, `${p.last_name ?? p.name} in for ${out.p.last_name ?? out.p.name} at ${sl}, ${d === kit.today ? 'today' : monthDay(d)}`);
  };

  const foot = days.map((d) => kit.dayStats(teamId, d, lineups.get(d)));
  const games = days.map((d) => roster.filter((x) => isStart(lineups.get(d)?.get(x.p.id)) && kit.gameFor(x.p.nhl_team, d)).length);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[['Starter games', String(games.reduce((t, n) => t + n, 0)), `over ${span} days`], ['Expected', fmt1(foot.reduce((t, f) => t + f.pts, 0)), 'points'],
          ['Left to sit', String(foot.reduce((t, f) => t + f.benched, 0)), 'healthy, with a game']].map(([k, v, s]) => (
          <div key={k} className="rounded-2xl border border-white/10 bg-white/[.04] p-3">
            <div className="text-[10px] font-bold uppercase tracking-[.14em] text-mute">{k}</div>
            <div className="num mt-0.5 text-2xl font-black text-white">{v}</div>
            <div className="text-[11px] text-mute">{s}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">{[7, 14].map((n) => <button key={n} type="button" onClick={() => setSpan(n)} className={`rounded-full px-3 py-1 text-xs font-semibold ${span === n ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{n} days</button>)}</div>
        {editable && <button type="button" className="btn-gold btn-sm ml-auto inline-flex items-center gap-1.5" onClick={() => setOpt(true)}><Sparkles className="h-4 w-4" /> Best lineup, every day</button>}
      </div>
      <div className="card overflow-hidden">
        <div className="scroll-x">
          <table className="text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[118px] bg-rink px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-mute">Player</th>
                {days.map((d) => (
                  <th key={d} className={`px-0.5 py-1.5 ${kit.light(d) ? 'bg-sky-400/[.08]' : ''}`}>
                    <button type="button" onClick={() => onDay(d)} className="w-[46px] rounded-lg py-0.5 leading-tight hover:bg-white/[.06]">
                      <span className="block text-[10px] font-bold uppercase text-mute">{d === kit.today ? 'Today' : weekday(d)}</span>
                      <span className="block text-sm font-black text-white">{monthDay(d).replace(/^\w+ /, '')}</span>
                      <span className={`block text-[9px] font-bold ${kit.light(d) ? 'text-sky-300' : 'text-mute'}`}>{kit.nightSize(d)} gms</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.04]">
              {order.map(({ p }) => (
                <tr key={p.id}>
                  <td className="sticky left-0 z-10 bg-rink px-2 py-1">
                    <button type="button" className="flex items-center gap-1.5 text-left" onClick={() => onInfo(p.id)}>
                      <Headshot p={p} size={24} />
                      <span className="min-w-0">
                        <span className="block max-w-[86px] break-words font-semibold leading-tight text-slate-100">{p.last_name ?? p.name}</span>
                        <span className="block text-[9px] text-mute">{p.elig.join('/')}{hurt(p) ? <span className="text-red-300"> · {p.injury_status}</span> : ''}</span>
                      </span>
                    </button>
                  </td>
                  {days.map((d) => {
                    const g = kit.gameFor(p.nhl_team, d);
                    const s = lineups.get(d)?.get(p.id) ?? 'BN';
                    const st = isStart(s);
                    const opp = g ? (g.home === p.nhl_team ? g.away : '@' + g.home) : '';
                    const lk = kit.lockedOn(p, d);
                    const tone = s === 'IR' ? 'bg-red-500/15 text-red-200' : !g ? (st ? 'bg-white/[.06] text-white/50 ring-1 ring-dashed ring-white/15' : '') : st ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/15 text-amber-200';
                    return (
                      <td key={d} className={`px-0.5 py-1 text-center ${kit.light(d) ? 'bg-sky-400/[.05]' : ''}`}>
                        {!g && !st ? <span className="text-white/15">·</span> : (
                          <button type="button" disabled={!editable || lk || s === 'IR' || busy} onClick={() => toggle(p, d)}
                            title={`${st ? s : s === 'IR' ? 'On IR' : 'Bench'}${g ? ` · ${opp}` : ' · no game'}${editable && !lk ? ' (tap to change)' : ''}`}
                            className={`mx-auto block w-[46px] rounded-lg py-0.5 font-bold leading-tight transition enabled:hover:brightness-125 enabled:active:scale-95 ${tone}`}>
                            {st ? s : s}<span className="block text-[9px] font-semibold opacity-75">{g ? opp : 'idle'}</span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-white/[.03]">
                <td className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">Starters playing</td>
                {foot.map((f, i) => <td key={i} className={`num px-0.5 text-center text-sm font-black ${f.playing < f.slotsTotal && f.benched > 0 ? 'text-amber-200' : 'text-white'}`}>{f.playing}<span className="text-[9px] text-mute">/{f.slotsTotal}</span></td>)}
              </tr>
              <tr className="bg-white/[.03]">
                <td className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">Expected</td>
                {foot.map((f, i) => <td key={i} className="num px-0.5 text-center font-bold text-gold">{fmt1(f.pts)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-white/[.06] px-3 py-2 text-[10px] text-mute">
          <span><span className="rounded bg-emerald-500/20 px-1 text-emerald-200">C</span> starts with a game</span>
          <span><span className="rounded bg-amber-500/15 px-1 text-amber-200">BN</span> sits with a game</span>
          <span><span className="rounded bg-sky-400/15 px-1 text-sky-200">5 gms</span> a light night</span>
          {editable && <span>Tap a cell to start or bench him that day</span>}
        </div>
      </div>
      {editable && <OptimizeSheet kit={kit} teamId={teamId} day={start} open={opt} onClose={() => setOpt(false)} initial={7} />}
    </div>
  );
}
