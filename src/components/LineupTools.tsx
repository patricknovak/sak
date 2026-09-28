import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { optimize, weekEndOf, gamesLeftThisWeek, locked as isLocked, type Basis, type LContext, type Mode, type Plan } from '../lib/lineup';
import { addDays, planDays, type DayPlan } from '../lib/lineupplan';
import { useSeasonGames } from '../lib/projections';
import { supabase } from '../lib/supabase';
import type { Player, Roster } from '../lib/types';
import { Pos, Sheet, useAction } from './ui';

type Row = { r: Roster; p: Player };

// lineups are set daily, so the auto-pilot always sets the best lineup for the day it runs
const MODES: { k: Mode | 'off'; label: string; hint: string }[] = [
  { k: 'off', label: 'Off', hint: 'You set every lineup yourself (or save days ahead on Daily lineups).' },
  { k: 'day', label: 'On', hint: 'Every morning, and again before puck drop: the best possible lineup for that day. Whoever plays, best first, every slot filled that can be.' },
];
type Period = 'today' | 'week' | '30';
const PERIODS: { k: Period; label: string }[] = [{ k: 'today', label: 'Today' }, { k: 'week', label: 'Rest of the week' }, { k: '30', label: 'Next 30 days' }];
const BASES: { k: Basis; label: string; hint: string }[] = [
  { k: 'proj', label: 'Projection', hint: 'Preseason projection' },
  { k: 'form', label: 'Hot hand', hint: 'Last 14 days' },
  { k: 'season', label: 'Season avg', hint: 'Points per game this season' },
  { k: 'ros', label: 'Rest of season', hint: 'Projection blended with pace' },
];

export function useLineupContext(): LContext {
  const { league, games, season, serverOffset } = useLeague();
  return useMemo(() => {
    const today = etToday();
    return {
      today, weekEnd: weekEndOf(today), now: Date.now() + serverOffset, games, season,
      caps: (league?.roster ?? {}) as Record<string, number>,
    };
  }, [league, games, season, serverOffset]);
}

// one-tap "optimize today" used by the lineup card
export function useOptimizer(roster: Row[]) {
  const { players, me, refresh } = useLeague();
  const ctx = useLineupContext();
  const { busy, run } = useAction();
  const plan = (mode: Mode, basis: Basis = me?.auto_basis ?? 'proj') =>
    optimize(roster.map((x) => x.r), players, mode, basis, { ...ctx, now: Date.now() });
  const apply = (p: Plan, label: string) => run(async () => {
    if (!p.moves.length) return;
    await rpc('set_lineup', { p_slots: Object.fromEntries(p.moves.map((m) => [m.player_id, m.to])) });
    await refresh(['rosters', 'teams']);
  }, p.moves.length ? `Lineup set for ${label}: ${p.moves.length} move${p.moves.length > 1 ? 's' : ''} ✨` : 'Already optimal. Look at you.');
  return { plan, apply, busy };
}

export function LineupTools({ open, onClose, roster }: { open: boolean; onClose: () => void; roster: Row[] }) {
  const { me, league, players, refresh } = useLeague();
  const ctx = useLineupContext();
  const { plan, apply, busy } = useOptimizer(roster);
  const { run } = useAction();
  const [period, setPeriod] = useState<Period>('today');
  const [basis, setBasis] = useState<Basis>(me?.auto_basis ?? 'proj');
  const inSeason = league?.phase === 'season';
  const seasonGames = useSeasonGames();
  const { season, serverOffset } = useLeague();
  const autoOn = !!me?.auto_mode && me.auto_mode !== 'off';
  const preview = useMemo(() => (open && inSeason ? plan('day', basis) : null), [open, inSeason, basis, roster, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  // a stretch of days, each optimized on its own
  const spanDays = period === 'week' ? Math.max(1, Math.round((new Date(ctx.weekEnd).getTime() - new Date(ctx.today).getTime()) / 86400000) + 1) : 30;
  // lineups already saved for future days: "before" is what each day really is now
  const [plans, setPlans] = useState<Map<string, Map<number, string>> | null>(null);
  useEffect(() => {
    if (!open || !me) return;
    supabase.from('lineup_plans').select('date,player_id,slot').eq('team_id', me.id).gt('date', ctx.today).then(({ data }) => {
      const m = new Map<string, Map<number, string>>();
      for (const r of data ?? []) { const x = m.get(r.date) ?? new Map(); x.set(r.player_id, r.slot); m.set(r.date, x); }
      setPlans(m);
    });
  }, [open, me?.id, ctx.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const span: DayPlan[] | null = useMemo(() => {
    if (!open || !inSeason || period === 'today' || !seasonGames || !plans) return null;
    const live = new Map(roster.map((x) => [x.p.id, x.r.slot as string]));
    const baseline = (d: string) => {
      if (d === ctx.today) return live;
      let from: string | null = null;
      for (const k of plans.keys()) if (k <= d && (!from || k > from)) from = k;
      const src = from ? plans.get(from)! : live;
      return new Map(roster.map((x) => [x.p.id, src.get(x.p.id) ?? (x.r.slot === 'IR' ? 'IR' : 'BN')]));
    };
    return planDays({ rows: roster.map((x) => x.r), players, games: seasonGames, season, caps: ctx.caps, basis, from: ctx.today, days: spanDays, now: Date.now() + serverOffset, today: ctx.today, baseline });
  }, [open, inSeason, period, seasonGames, plans, roster, players, season, basis, spanDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const applySpan = (days: DayPlan[]) => run(async () => {
    const [first, ...rest] = days;
    const moves = Object.fromEntries([...first.slots].filter(([id, s]) => roster.find((x) => x.p.id === id)?.r.slot !== s));
    if (Object.keys(moves).length) await rpc('set_lineup', { p_slots: moves });
    if (rest.length) await rpc('set_lineup_plans', { p_plans: Object.fromEntries(rest.map((d) => [d.date, Object.fromEntries(d.slots)])) });
    await refresh(['rosters', 'teams']);
  }, `Best lineup set for every day through ${new Date(addDays(ctx.today, days.length - 1) + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ✨`);

  const savePrefs = (m: Mode | 'off' | null, b: Basis | null) => run(async () => {
    await rpc('set_lineup_prefs', { p_mode: m, p_basis: b });
    await refresh(['teams']);
  }, m === 'off' ? 'Auto-pilot off: it’s all you now' : m ? `Auto-pilot on: ${m} mode` : 'Saved');

  // this week's schedule for everyone not on IR
  const days = useMemo(() => {
    const out: string[] = [];
    const d = new Date(ctx.today + 'T12:00:00Z');
    while (out.length < 7) { const s = d.toISOString().slice(0, 10); out.push(s); if (s >= ctx.weekEnd) break; d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }, [ctx.today, ctx.weekEnd]);
  const plays = (p: Player, day: string) => ctx.games.some((g) => g.date === day && g.state !== 'PPD' && g.state !== 'CNCL' && (g.home === p.nhl_team || g.away === p.nhl_team));
  const planner = roster.filter((x) => x.r.slot !== 'IR').sort((a, b) => gamesLeftThisWeek(b.p.nhl_team, ctx) - gamesLeftThisWeek(a.p.nhl_team, ctx) || b.p.proj - a.p.proj);
  const pinned = roster.filter((x) => x.r.pin);

  return (
    <Sheet open={open} onClose={onClose} title="⚙️ Lineup tools" wide>
      <div className="space-y-5">
        <section>
          <div className="label mb-1.5">Auto-pilot</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[.04] p-1">
            {MODES.map((m) => (
              <button key={m.k} disabled={busy} onClick={() => savePrefs(m.k, null)}
                className={`rounded-lg px-2 py-1.5 text-sm font-semibold transition ${(m.k === 'off' ? !autoOn : autoOn) ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-ice shadow' : 'text-mute hover:bg-white/[.06]'}`}>{m.label}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-mute">{MODES[autoOn ? 1 : 0].hint}{autoOn && ' It never undoes a move you made yourself that day, never touches a day you saved on Daily lineups, and never moves a locked player.'}</p>
          <div className="label mb-1.5 mt-3">Rank players by</div>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/[.04] p-1">
            {BASES.map((b) => (
              <button key={b.k} disabled={busy} onClick={() => { setBasis(b.k); savePrefs(null, b.k); }}
                className={`rounded-lg px-2 py-1.5 text-sm font-semibold transition ${basis === b.k ? 'bg-white/[.12] text-white ring-1 ring-inset ring-white/20' : 'text-mute hover:bg-white/[.06]'}`}>
                {b.label}<div className="text-[10px] font-normal text-mute">{b.hint}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="label mb-1.5">Optimize now</div>
          {!inSeason ? <p className="text-sm text-mute">Opens when the season starts. Set your auto-pilot now and it’ll take over from opening night.</p> : <>
            <div className="flex gap-1">
              {PERIODS.map((x) => (
                <button key={x.k} className={`tab flex-1 ${period === x.k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPeriod(x.k)}>{x.label}</button>
              ))}
            </div>
            {period === 'today' && preview && (
              <div className="mt-2 rounded-xl border border-white/[.07] bg-white/[.03] p-3">
                {preview.moves.length === 0
                  ? <div className="text-sm">✅ Your lineup is already the best one for today.</div>
                  : <>
                    <div className="mb-2 text-sm">
                      <span className="font-semibold">{preview.moves.length} move{preview.moves.length > 1 ? 's' : ''}</span>
                      {preview.value > 0 || preview.before > 0 ? <>
                        <span className="text-mute"> · expected {fmtPts(preview.before)} → </span>
                        <span className="font-semibold text-emerald-300">{fmtPts(preview.value)}</span>
                        <span className="text-mute"> pts today</span>
                      </> : <span className="text-mute"> · nobody plays today, so this lines up your best on paper</span>}
                    </div>
                    <ul className="space-y-1">
                      {preview.moves.map((m) => (
                        <li key={m.player_id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{players.get(m.player_id)?.name}</span>
                          <Pos p={m.from} /> <span className="text-mute">→</span> <Pos p={m.to} />
                        </li>
                      ))}
                    </ul>
                    <button className="btn-blue mt-3 w-full" disabled={busy} onClick={() => apply(preview, 'today')}>Apply {preview.moves.length} move{preview.moves.length > 1 ? 's' : ''}</button>
                  </>}
              </div>
            )}
            {period !== 'today' && (
              <div className="mt-2 rounded-xl border border-white/[.07] bg-white/[.03] p-3">
                {!span ? <div className="text-sm text-mute">Working it out day by day…</div> : (() => {
                  const after = span.reduce((t, d) => t + d.value, 0), before = span.reduce((t, d) => t + d.before, 0);
                  const better = (d: DayPlan) => d.moves > 0 && d.value - d.before > 0.05;
                  const changed = span.filter(better).length;
                  return <>
                    <div className="text-sm"><span className="font-semibold">{span.length} days</span><span className="text-mute"> · as your days stand now: {fmtPts(before)} → best each day: </span><span className="font-semibold text-emerald-300">{fmtPts(after)}</span><span className="text-mute"> projected pts</span>{after - before >= 0.5 && <span className="ml-1 chip bg-emerald-500/15 text-emerald-200">+{fmtPts(after - before)}</span>}</div>
                    <div className="scroll-x mt-2 flex gap-1">
                      {span.map((d) => <div key={d.date} className={`w-11 shrink-0 rounded-lg px-1 py-1 text-center text-[10px] ${better(d) ? 'bg-sky-500/15 text-sky-100' : 'bg-white/[.04] text-mute'}`}><div>{new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'narrow', timeZone: 'UTC' })} {Number(d.date.slice(8))}</div><div className="num font-bold">{fmtPts(d.value, 0)}</div></div>)}
                    </div>
                    <p className="mt-1.5 text-[11px] text-mute">Each day gets its own best lineup (shaded days gain points). Today is set now; the other days are saved on Daily lineups and replace anything you saved for them.</p>
                    {changed === 0 ? <div className="mt-2 text-center text-sm text-emerald-200">✅ Every day is already set to its best lineup.</div>
                      : <button className="btn-blue mt-2 w-full" disabled={busy} onClick={() => confirm(`Set the best lineup for each of the next ${span.length} days? It replaces lineups you already saved for those days.`) && applySpan(span)}>Set {span.length} days ({changed} gain points)</button>}
                  </>;
                })()}
              </div>
            )}
            <p className="mt-1.5 text-xs text-mute">Nothing changes until you hit Apply. You can still move anyone by hand afterwards.</p>
          </>}
        </section>

        <section>
          <div className="label mb-1.5">Pins</div>
          <p className="text-xs text-mute">Tap 📍 next to any player on your lineup: 📌 always start him when he plays, 🚫 never start him. Auto-pilot and Optimize both obey pins.</p>
          {pinned.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pinned.map((x) => <span key={x.p.id} className="chip">{x.r.pin === 'start' ? '📌' : '🚫'} {x.p.name}</span>)}
            </div>
          )}
        </section>

        <section>
          <div className="label mb-1.5">Week planner <span className="font-normal normal-case text-mute">· games through Sunday</span></div>
          <div className="overflow-x-auto rounded-xl border border-white/[.07]">
            <table className="w-full text-xs">
              <thead className="bg-white/[.04] text-mute">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Player</th>
                  {days.map((d) => <th key={d} className="px-1 py-1.5 font-semibold">{new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'narrow', timeZone: 'UTC' })}<div className="font-normal">{Number(d.slice(8))}</div></th>)}
                  <th className="px-2 py-1.5 font-semibold">G</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.05]">
                {planner.map((x) => (
                  <tr key={x.p.id} className={x.r.slot === 'BN' ? 'text-mute' : ''}>
                    <td className="max-w-36 truncate px-2 py-1"><Pos p={x.r.slot} className="mr-1.5" />{x.p.name}</td>
                    {days.map((d) => <td key={d} className="px-1 py-1 text-center">{plays(x.p, d) ? <span className={`inline-block h-2.5 w-2.5 rounded-full ${d === ctx.today && isLocked(x.p, ctx) ? 'bg-slate-500' : 'bg-emerald-400'}`} /> : <span className="text-white/15">·</span>}</td>)}
                    <td className="px-2 py-1 text-center font-semibold">{gamesLeftThisWeek(x.p.nhl_team, ctx)}</td>
                  </tr>
                ))}
                {planner.length === 0 && <tr><td className="p-3 text-mute" colSpan={days.length + 2}>No players yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Sheet>
  );
}
