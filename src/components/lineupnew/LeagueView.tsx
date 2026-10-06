// Lineup New, the whole league: every team's lineup for a day on one board, ranked by what it should score (or has
// scored, once tonight's games start): starters who play, players left on the bench with a game, empty places and
// light-night starts. A week mode adds the next seven days up, team by team. Tap a team to look at its lineup, or
// to put it beside yours.
import { useEffect, useMemo, useState } from 'react';
import { Columns2, Eye, Radio } from 'lucide-react';
import { addDays, isStart, monthDay, weekday, useDayPoints, type Kit } from '../../lib/lineupKit';
import { TeamBadge } from '../ui';
import { fmt1 } from './bits';

const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };

export function LeagueView({ kit, day, onView, onCompare }: { kit: Kit; day: string; onView: (id: number) => void; onCompare: (id: number) => void }) {
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const teams = kit.teams.filter((t) => t.role !== 'spectator');
  const d = day < kit.today ? kit.today : day;
  useEffect(() => { kit.loadPlans(teams.map((t) => t.id)); }, [teams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pts: livePts, live } = useDayPoints(kit, d);
  const started = livePts.size > 0;
  const rows = useMemo(() => teams.map((t) => {
    const slots = kit.lineupOf(t.id, d).slots;
    const st = kit.dayStats(t.id, d, slots);
    const roster = kit.rosterOf(t.id);
    const scored = roster.reduce((s, x) => s + (isStart(slots.get(x.p.id)) ? livePts.get(x.p.id) ?? 0 : 0), 0);
    const light = kit.light(d) ? st.playing : 0;
    const week = Array.from({ length: 7 }, (_, i) => kit.dayStats(t.id, addDays(d, i)));
    return { t, st, scored, light, week, wPts: week.reduce((a, w) => a + w.pts, 0), wGames: week.reduce((a, w) => a + w.playing, 0), wSit: week.reduce((a, w) => a + w.benched, 0) };
  }), [teams, kit, d, livePts]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = [...rows].sort((a, b) => (mode === 'week' ? b.wPts - a.wPts : started ? b.scored - a.scored || b.st.pts - a.st.pts : b.st.pts - a.st.pts));
  const top = Math.max(0.01, ...rows.map((r) => (mode === 'week' ? r.wPts : Math.max(r.st.pts, r.scored))));
  const mine = sorted.findIndex((r) => r.t.id === kit.me?.id);
  const maxDay = Math.max(0.01, ...rows.flatMap((r) => r.week.map((w) => w.pts)));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
        {(['day', 'week'] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-xl py-2 text-xs font-bold ${mode === m ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{m === 'day' ? (d === kit.today ? 'Tonight' : monthDay(d)) : `${monthDay(d)} to ${monthDay(addDays(d, 6))}`}</button>)}
      </div>
      {mine >= 0 && (
        <div className="card-hero p-4">
          <div className="relative flex items-center gap-3">
            <div className="num font-display text-5xl font-extrabold leading-none text-shine">{ord(mine + 1)}</div>
            <div className="min-w-0 text-sm text-white/80">
              of {sorted.length} {mode === 'week' ? 'over the next seven days' : d === kit.today ? (started ? 'tonight on points scored' : 'tonight on expected points') : `on ${monthDay(d)}`}
              {live && mode === 'day' && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-red-200"><Radio className="h-3 w-3 animate-pulse" /> Live</span>}
              <div className="text-xs text-white/50">{mode === 'week' ? 'On every team\'s lineups as they stand today and their plans ahead.' : 'Every team\'s lineup as it stands, read only but yours.'}</div>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {sorted.map((r, i) => {
          const me = r.t.id === kit.me?.id;
          const val = mode === 'week' ? r.wPts : started ? r.scored : r.st.pts;
          return (
            <div key={r.t.id} className={`card overflow-hidden ${me ? 'border-gold/50 shadow-[0_0_24px_rgb(var(--gold-rgb)/.12)]' : ''}`}>
              <div className="flex items-center gap-3 p-3">
                <span className={`num w-5 shrink-0 text-center text-sm font-black ${i === 0 ? 'text-gold' : 'text-mute'}`}>{i + 1}</span>
                <TeamBadge team={r.t} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold leading-tight text-white">{r.t.name}</div>
                  <div className="text-[11px] text-mute">{r.t.gm_name}</div>
                </div>
                <div className="text-right">
                  <div className="num text-xl font-black text-white">{fmt1(val)}</div>
                  <div className="text-[10px] text-mute">{mode === 'week' ? 'expected' : started ? `scored · ${fmt1(r.st.pts)} exp` : 'expected'}</div>
                </div>
              </div>
              <div className="mx-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${(val / top) * 100}%`, background: r.t.color }} /></div>
              {mode === 'day' ? (
                <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 text-[11px]">
                  <span className="chip border-emerald-400/30 text-emerald-200">{r.st.playing}/{r.st.slotsTotal} play</span>
                  {r.st.benched > 0 && <span className="chip border-amber-400/30 text-amber-200">{r.st.benched} benched with a game</span>}
                  {r.st.empty > 0 && <span className="chip border-red-400/30 text-red-200">{r.st.empty} empty</span>}
                  {r.light > 0 && <span className="chip border-sky-400/30 text-sky-200">{r.light} on a light night</span>}
                  <span className="ml-auto flex gap-1">
                    <button type="button" onClick={() => onView(r.t.id)} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-2.5 py-1 font-semibold text-slate-200 ring-1 ring-white/10"><Eye className="h-3 w-3" /> Lineup</button>
                    {!me && <button type="button" onClick={() => onCompare(r.t.id)} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-2.5 py-1 font-semibold text-slate-200 ring-1 ring-white/10"><Columns2 className="h-3 w-3" /> Compare</button>}
                  </span>
                </div>
              ) : (
                <div className="px-3 py-2.5">
                  <div className="grid grid-cols-7 gap-1">
                    {r.week.map((w, k) => (
                      <div key={k} className="flex flex-col items-center gap-0.5" title={`${monthDay(addDays(d, k))}: ${w.playing} play, ${fmt1(w.pts)} expected`}>
                        <div className="flex h-10 w-full items-end justify-center rounded bg-white/[.03]"><span className="w-3/5 rounded-t" style={{ height: `${(w.pts / maxDay) * 100}%`, background: r.t.color }} /></div>
                        <span className="text-[9px] font-bold uppercase text-mute">{weekday(addDays(d, k)).slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="chip border-emerald-400/30 text-emerald-200">{r.wGames} starter games</span>
                    {r.wSit > 0 && <span className="chip border-amber-400/30 text-amber-200">{r.wSit} sit with a game</span>}
                    <button type="button" onClick={() => onView(r.t.id)} className="ml-auto text-sky-300">Lineup →</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-mute">Expected points: each starter with a game, projected points a game times the chance he plays. Lineups ahead are each GM&apos;s saved plans, else what carries forward.</p>
    </div>
  );
}
