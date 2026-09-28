// Best lineups over a stretch of days: each day optimized on its own (lineups are daily), each built on the
// day before so nobody moves without a reason. Shared by Lineup tools and the daily lineup planner.
import { optimize, type Basis, type LContext, type LGame, type LPlayer, type LSeason, STARTING } from './lineup';

export interface DayPlan { date: string; slots: Map<number, string>; value: number; before: number; moves: number }
export const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function planDays(opts: {
  rows: { player_id: number; slot: string; pin?: string | null }[]; players: Map<number, LPlayer>; games: LGame[];
  season: Map<number, LSeason>; caps: Record<string, number>; basis: Basis; from: string; days: number; now: number; today: string;
  // what each day will be if nothing changes (a saved plan, carried forward, or today's lineup)
  baseline?: (date: string) => Map<number, string> | undefined;
}): DayPlan[] {
  const byDate = new Map<string, LGame[]>();
  for (const g of opts.games) byDate.set(g.date, [...(byDate.get(g.date) ?? []), g]);
  const out: DayPlan[] = [];
  let cur = new Map(opts.rows.map((r) => [r.player_id, r.slot]));
  const start = new Map(cur);
  for (let i = 0; i < opts.days; i++) {
    const d = addDays(opts.from, i);
    const ctx: LContext = { today: d, weekEnd: d, now: d === opts.today ? opts.now : 0, games: byDate.get(d) ?? [], season: opts.season, caps: opts.caps };
    const rows = opts.rows.map((r) => ({ ...r, slot: cur.get(r.player_id) ?? 'BN' }));
    const plan = optimize(rows, opts.players, 'day', opts.basis, ctx);
    // "before": what that day will be if you change nothing
    const base = opts.baseline?.(d) ?? start;
    const beforePlan = optimize(opts.rows.map((r) => ({ ...r, slot: base.get(r.player_id) ?? 'BN' })), opts.players, 'day', opts.basis, ctx);
    // a change that matters: someone starts who wouldn't have, or sits who would have (C to Util shuffles don't count)
    const isStart = (x?: string) => STARTING.includes(x ?? 'BN');
    const changed = [...plan.slots].filter(([id, sl]) => isStart(base.get(id)) !== isStart(sl)).length;
    out.push({ date: d, slots: plan.slots, value: plan.value, before: beforePlan.before, moves: changed });
    cur = plan.slots;
  }
  return out;
}
export const starters = (slots: Map<number, string>) => [...slots].filter(([, s]) => STARTING.includes(s)).map(([id]) => id);
