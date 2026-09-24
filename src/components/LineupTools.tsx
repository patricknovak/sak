import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { optimize, weekEndOf, gamesLeftThisWeek, locked as isLocked, type Basis, type LContext, type Mode, type Plan } from '../lib/lineup';
import type { Player, Roster } from '../lib/types';
import { Pos, Sheet, useAction } from './ui';

type Row = { r: Roster; p: Player };

const MODES: { k: Mode | 'off'; label: string; hint: string }[] = [
  { k: 'off', label: 'Off', hint: 'You set every lineup yourself.' },
  { k: 'day', label: 'Day', hint: 'Every morning: start whoever plays today, best first.' },
  { k: 'week', label: 'Week', hint: 'Starts the players with the most value over the rest of the week (games × points per game).' },
  { k: 'season', label: 'Season', hint: 'Keeps your best players in, games or not. Set it and forget it.' },
];
const BASES: { k: Basis; label: string; hint: string }[] = [
  { k: 'proj', label: 'Projection', hint: 'Preseason projection' },
  { k: 'form', label: 'Hot hand', hint: 'Last 14 days' },
  { k: 'season', label: 'Season avg', hint: 'Points per game this season' },
];
const MODE_NAME: Record<Mode, string> = { day: 'today', week: 'this week', season: 'the season' };

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
  const [mode, setMode] = useState<Mode>('day');
  const [basis, setBasis] = useState<Basis>(me?.auto_basis ?? 'proj');
  const inSeason = league?.phase === 'season';
  const preview = useMemo(() => (open && inSeason ? plan(mode, basis) : null), [open, inSeason, mode, basis, roster, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/[.04] p-1">
            {MODES.map((m) => (
              <button key={m.k} disabled={busy} onClick={() => savePrefs(m.k, null)}
                className={`rounded-lg px-2 py-1.5 text-sm font-semibold transition ${me?.auto_mode === m.k ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-ice shadow' : 'text-mute hover:bg-white/[.06]'}`}>{m.label}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-mute">{MODES.find((m) => m.k === (me?.auto_mode ?? 'off'))?.hint}{me?.auto_mode !== 'off' && ' Runs every morning and again before puck drop, but never undoes a move you made yourself that day. Locked players are never touched.'}</p>
          <div className="label mb-1.5 mt-3">Rank players by</div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[.04] p-1">
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
              {(['day', 'week', 'season'] as Mode[]).map((m) => (
                <button key={m} className={`tab flex-1 ${mode === m ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setMode(m)}>{m === 'day' ? 'Today' : m === 'week' ? 'This week' : 'Season'}</button>
              ))}
            </div>
            {preview && (
              <div className="mt-2 rounded-xl border border-white/[.07] bg-white/[.03] p-3">
                {preview.moves.length === 0
                  ? <div className="text-sm">✅ Your lineup is already the best one for {MODE_NAME[mode]}.</div>
                  : <>
                    <div className="mb-2 text-sm">
                      <span className="font-semibold">{preview.moves.length} move{preview.moves.length > 1 ? 's' : ''}</span>
                      {preview.value > 0 || preview.before > 0 ? <>
                        <span className="text-mute"> · expected {fmtPts(preview.before)} → </span>
                        <span className="font-semibold text-emerald-300">{fmtPts(preview.value)}</span>
                        <span className="text-mute"> pts {MODE_NAME[mode]}</span>
                      </> : <span className="text-mute"> · none of your guys play {MODE_NAME[mode]}, so this just lines up your best on paper</span>}
                    </div>
                    <ul className="space-y-1">
                      {preview.moves.map((m) => (
                        <li key={m.player_id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{players.get(m.player_id)?.name}</span>
                          <Pos p={m.from} /> <span className="text-mute">→</span> <Pos p={m.to} />
                        </li>
                      ))}
                    </ul>
                    <button className="btn-blue mt-3 w-full" disabled={busy} onClick={() => apply(preview, MODE_NAME[mode])}>Apply {preview.moves.length} move{preview.moves.length > 1 ? 's' : ''}</button>
                  </>}
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
