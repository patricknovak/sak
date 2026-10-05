// The small pieces Lineup New is drawn with: the slot pill, the game line, expected points, and saving a day's lineup
// (today straight to the live lineup, a later day as that day's plan) with an undo.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Undo2 } from 'lucide-react';
import { rpc } from '../../lib/supabase';
import { useLeague, useSport } from '../../lib/store';
import { hasStarted, isLive, periodShort } from '../../lib/sport';
import { teamLogo } from '../../lib/format';
import { isStart, type Kit } from '../../lib/lineupKit';
import type { Game, Player } from '../../lib/types';

export const SLOT_TONE: Record<string, string> = {
  C: 'from-sky-400/30 to-sky-500/10 text-sky-100 ring-sky-300/40', LW: 'from-emerald-400/30 to-emerald-500/10 text-emerald-100 ring-emerald-300/40',
  RW: 'from-teal-400/30 to-teal-500/10 text-teal-100 ring-teal-300/40', D: 'from-violet-400/30 to-violet-500/10 text-violet-100 ring-violet-300/40',
  Util: 'from-amber-400/30 to-amber-500/10 text-amber-100 ring-amber-300/40', G: 'from-rose-400/30 to-rose-500/10 text-rose-100 ring-rose-300/40',
  BN: 'from-white/10 to-white/[.03] text-slate-300 ring-white/15', IR: 'from-red-500/25 to-red-500/5 text-red-200 ring-red-400/40',
};

export function SlotPill({ slot, size = 'md' }: { slot: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-xl bg-gradient-to-b font-black ring-1 ${SLOT_TONE[slot] ?? SLOT_TONE.BN} ${size === 'sm' ? 'h-6 w-9 text-[10px]' : 'h-9 w-11 text-xs'}`}>
      {slot}
    </span>
  );
}

// tonight's game in a line: the opponent's logo and abbreviation, home or away, and the time or the score
export function GameLine({ p, g, compact }: { p: Player; g: Game | undefined; compact?: boolean }) {
  const sport = useSport();
  if (!g) return <span className="text-[11px] text-white/30">No game</span>;
  const home = g.home === p.nhl_team;
  const opp = home ? g.away : g.home;
  const started = hasStarted(sport, g.state) && g.home_score != null;
  const live = isLive(sport, g.state);
  const mine = home ? g.home_score : g.away_score, theirs = home ? g.away_score : g.home_score;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-slate-300">
      <span className="text-mute">{home ? 'vs' : '@'}</span>
      <img src={teamLogo(opp)} alt="" className="h-3.5 w-3.5 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <b className="font-semibold text-slate-200">{opp}</b>
      {!compact && (started
        ? <span className={`num font-bold ${live ? 'text-red-300' : 'text-white'}`}>{mine}-{theirs}{live ? ` · ${periodShort(sport, g.period)}` : ' F'}</span>
        : <span className="text-mute">{new Date(g.start_utc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>)}
    </span>
  );
}

export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// ───────────── saving with an undo ─────────────
interface UndoState { label: string; day: string; prev: Map<number, string> }
const UndoCtx = createContext<{ save: (day: string, next: Map<number, string>, prev: Map<number, string>, label: string) => Promise<boolean>; busy: boolean } | null>(null);

export function SaveProvider({ kit, children }: { kit: Kit; children: ReactNode }) {
  const { me, refresh } = useLeague();
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const write = useCallback(async (day: string, next: Map<number, string>, prev: Map<number, string>) => {
    if (day === kit.today) {
      const moves = Object.fromEntries([...next].filter(([id, s]) => prev.get(id) !== s));
      if (!Object.keys(moves).length) return;
      await rpc('set_lineup', { p_slots: moves });
      await refresh(['rosters', 'teams']);
    } else {
      await rpc('set_lineup_plans', { p_plans: { [day]: Object.fromEntries(next) } });
      await kit.loadPlans([me!.id]);
    }
  }, [kit, me, refresh]);
  const save = useCallback(async (day: string, next: Map<number, string>, prev: Map<number, string>, label: string) => {
    setBusy(true); setErr(null);
    try {
      await write(day, next, prev);
      window.clearTimeout(timer.current);
      setUndo({ label, day, prev });
      timer.current = window.setTimeout(() => setUndo(null), 7000);
      return true;
    } catch (e) {
      setErr((e as Error).message || 'Couldn’t save that. Nothing changed.');
      window.setTimeout(() => setErr(null), 6000);
      return false;
    } finally { setBusy(false); }
  }, [write]);
  const doUndo = async () => {
    if (!undo) return;
    const u = undo; setUndo(null); setBusy(true);
    try { await write(u.day, u.prev, kit.lineupOf(me!.id, u.day).slots); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <UndoCtx.Provider value={{ save, busy }}>
      {children}
      {(undo || err) && (
        <div className="fixed inset-x-0 bottom-[84px] z-40 px-4 md:bottom-6">
          <div className={`mx-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,.5)] ring-1 backdrop-blur ${err ? 'bg-red-950/90 text-red-100 ring-red-400/40' : 'bg-[#0f1a2e]/95 text-white ring-white/15'}`}>
            <span className="min-w-0 flex-1">{err ?? <>✓ {undo!.label}<span className="block text-[11px] text-mute">Saved</span></>}</span>
            {undo && !err && <button type="button" onClick={doUndo} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20"><Undo2 className="h-3.5 w-3.5" /> Undo</button>}
          </div>
        </div>
      )}
    </UndoCtx.Provider>
  );
}
export const useSave = () => useContext(UndoCtx)!;

// the moves between two lineups, for the optimizer's list
export function diffMoves(prev: Map<number, string>, next: Map<number, string>) {
  return [...next].filter(([id, s]) => prev.get(id) !== s).map(([id, to]) => ({ id, from: prev.get(id) ?? 'BN', to }))
    .sort((a, b) => Number(isStart(b.to)) - Number(isStart(a.to)));
}
