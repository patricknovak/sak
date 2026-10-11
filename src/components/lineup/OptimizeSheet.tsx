// The best lineup as a list of changes: what the auto-pilot would do from where the lineup stands, move by move with
// the reason for each and what it is worth, for today or the days ahead (3, 7 or 14), each day built on the one before.
// Opened from My Team's Tonight card, its warnings' Fix, and the week grid.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useLeague } from '../../lib/store';
import { rpc } from '../../lib/supabase';
import { optimize, type Basis, type LContext } from '../../lib/lineup';
import { addDays, hurt, isStart, longDay, monthDay, type Kit } from '../../lib/lineupKit';
import { Headshot, Sheet } from '../ui';
import { diffMoves, fmt1, SlotPill, useSave } from './bits';
import type { Player } from '../../lib/types';

// the best lineup for a day from where it stands, as the auto-pilot works it out (pins respected)
export function useBest(kit: Kit) {
  const { season, me } = useLeague();
  const basis: Basis = me?.auto_basis ?? 'proj';
  const seasonMap = useMemo(() => new Map([...season].map(([k, v]) => [k, { gp: v.gp, fpts: v.fpts, gp14: v.gp14, fpts14: v.fpts14 }])), [season]);
  return (teamId: number, d: string, start: Map<number, string>) => {
    const ctx: LContext = { today: d, weekEnd: d, now: d === kit.today ? kit.nowMs : 0, games: kit.gamesOn.get(d) ?? [], season: seasonMap, caps: kit.caps, avail: kit.avail };
    const rows = kit.rosterOf(teamId).map((x) => ({ player_id: x.p.id, slot: start.get(x.p.id) ?? 'BN', pin: x.r.pin }));
    return optimize(rows, kit.players, 'day', basis, ctx).slots;
  };
}

// why a move: one line a GM can check
function reason(kit: Kit, p: Player, d: string, starting: boolean) {
  const g = kit.gameFor(p.nhl_team, d);
  if (!starting) {
    if (hurt(p)) return p.injury_status ?? 'hurt';
    if (!g) return 'no game';
    return `${fmt1(kit.expPts(p))} expected, less than who replaces him`;
  }
  const opp = g ? (g.home === p.nhl_team ? `vs ${g.away}` : `@${g.home}`) : '';
  return `${opp} · ${fmt1(kit.expPts(p))} expected${kit.light(d) ? ' · light night' : ''}`;
}

export function OptimizeSheet({ kit, teamId, day, open, onClose, initial = 1 }: { kit: Kit; teamId: number; day: string; open: boolean; onClose: () => void; initial?: number }) {
  const best = useBest(kit);
  const { save } = useSave();
  const { refresh } = useLeague();
  const [scope, setScope] = useState(initial);
  useEffect(() => { if (open) setScope(initial); }, [open, initial]);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => Array.from({ length: scope }, (_, i) => addDays(day, i)).filter((d) => d >= kit.today), [scope, day, kit.today]);
  // each day built on the one before, the way the planner's autofill does
  const plan = useMemo(() => {
    if (!open) return [];
    let prev = kit.lineupOf(teamId, days[0] ?? day).slots;
    return days.map((d, i) => {
      const cur = i === 0 ? prev : kit.lineupOf(teamId, d).slots;
      const next = best(teamId, d, i === 0 ? cur : prev);
      prev = next;
      const pts = (m: Map<number, string>) => kit.rosterOf(teamId).reduce((t, x) => t + (isStart(m.get(x.p.id)) && kit.gameFor(x.p.nhl_team, d) ? kit.expPts(x.p) : 0), 0);
      return { d, cur, next, gain: pts(next) - pts(cur), moves: diffMoves(cur, next) };
    });
  }, [open, days, teamId, kit, best, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = plan.reduce((t, x) => t + x.gain, 0);
  const changes = plan.filter((x) => x.moves.length);
  const apply = async () => {
    setBusy(true);
    try {
      if (plan.length === 1) {
        const x = plan[0];
        await save(x.d, x.next, x.cur, `Best lineup set for ${x.d === kit.today ? 'today' : monthDay(x.d)}`);
      } else {
        const today = plan.find((x) => x.d === kit.today && x.moves.length);
        if (today) await rpc('set_lineup', { p_slots: Object.fromEntries(today.moves.map((m) => [m.id, m.to])) });
        const later = plan.filter((x) => x.d > kit.today);
        if (later.length) await rpc('set_lineup_plans', { p_plans: Object.fromEntries(later.map((x) => [x.d, Object.fromEntries(x.next)])) });
        await Promise.all([refresh(['rosters', 'teams']), kit.loadPlans([teamId])]);
      }
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="The best lineup">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-black/25 p-1">
          {[[1, day === kit.today ? 'Today' : 'This day'], [3, '3 days'], [7, '7 days'], [14, '14 days']].map(([n, l]) => (
            <button key={n} type="button" onClick={() => setScope(n as number)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${scope === n ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{l}</button>
          ))}
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-400/15 to-transparent p-4 ring-1 ring-emerald-400/25">
          <div className="text-[11px] font-bold uppercase tracking-[.16em] text-emerald-200">Projected gain</div>
          <div className="num font-display text-3xl font-extrabold text-white">+{fmt1(total)} <span className="text-base text-white/60">pts</span></div>
          <div className="text-xs text-white/60">{changes.length ? `${changes.reduce((t, x) => t + x.moves.length, 0)} moves over ${changes.length} ${changes.length === 1 ? 'day' : 'days'}. Pins are respected; started games stay put.` : 'Already the best lineup for every day here.'}</div>
        </div>
        <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {changes.map((x) => (
            <div key={x.d}>
              <div className="mb-1.5 flex items-center justify-between text-xs"><b className="text-white">{x.d === kit.today ? 'Today' : longDay(x.d)}</b><span className="num font-bold text-emerald-300">+{fmt1(x.gain)}</span></div>
              <div className="space-y-1">
                {x.moves.map((m) => {
                  const p = kit.players.get(m.id)!;
                  return (
                    <div key={m.id} className="flex items-center gap-2.5 rounded-xl bg-white/[.04] px-2.5 py-2 ring-1 ring-white/[.06]">
                      <Headshot p={p} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-semibold text-white">{p.name}</div>
                        <div className="text-[11px] text-mute">{reason(kit, p, x.d, isStart(m.to))}</div>
                      </div>
                      <SlotPill slot={m.from} size="sm" /><ArrowRightLeft className="h-3 w-3 text-mute" /><SlotPill slot={m.to} size="sm" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-gold w-full py-3" disabled={busy || !changes.length} onClick={apply}>{busy ? 'Setting…' : changes.length ? `Make ${changes.reduce((t, x) => t + x.moves.length, 0)} moves` : 'Nothing to change'}</button>
      </div>
    </Sheet>
  );
}
