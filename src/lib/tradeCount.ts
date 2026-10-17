// Active players after a deal, counted the way the database counts them (_trade_active_after): a player kept on IR
// doesn't count, and one who arrives from another team's IR with an injury slides into an IR slot the deal leaves open.
// The builder asks for exactly the drops propose_trade and respond_trade will take (17 October 2026: counting the hurt
// arrival as active asked for a drop the database then refused).
import type { Player } from './types';
import { irOk } from '../../supabase/functions/_shared/lineup.ts';

export function activeAfter(s: { before: Player[]; after: Player[]; ir?: Set<number>; irCap?: number; irAny?: Set<number> }): number {
  const ir = s.ir ?? new Set<number>();
  const had = new Set(s.before.map((p) => p.id));
  const kept = s.after.filter((p) => had.has(p.id)), inn = s.after.filter((p) => !had.has(p.id));
  const irKept = kept.filter((p) => ir.has(p.id)).length;
  const hurt = inn.filter((p) => s.irAny?.has(p.id) && irOk(p.injury_status)).length;
  return kept.length - irKept + inn.length - Math.min(Math.max(0, (s.irCap ?? 0) - irKept), hurt);
}
