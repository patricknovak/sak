// What a settled side bet or a Book ticket did to each GM's coins, shared by the Bets page, the Book and the
// home screen's summaries so every place shows the same number.
import type { Bet, BetEntry, Market, MarketBet } from './types';

export type Move = { coins: number; cash: number; won: boolean | null };
const isPool = (k: string) => k.startsWith('pool');

// what each team gained or lost on one settled side bet (pools: share of the pot minus the buy-in)
export function betMoves(b: Bet, entries: BetEntry[]): Map<number, Move> {
  const m = new Map<number, Move>();
  if (isPool(b.kind)) {
    const es = entries.filter((e) => e.bet_id === b.id);
    const winners = (b.result?.winners as number[] | undefined) ?? (b.winner_team ? [b.winner_team] : []);
    const pot = Number(b.result?.pot ?? es.reduce((s, e) => s + e.coins, 0));
    const share = winners.length ? Math.floor(pot / winners.length) : 0;
    for (const e of es) { const w = winners.includes(e.team_id); m.set(e.team_id, { coins: (w ? share : 0) - e.coins, cash: 0, won: b.push ? null : w }); }
    return m;
  }
  const sides = [b.creator_team, b.opponent_team].filter((x): x is number => !!x);
  if (b.push || !b.winner_team) { for (const t of sides) m.set(t, { coins: 0, cash: 0, won: null }); return m; }
  const loser = b.winner_team === b.creator_team ? b.opponent_team! : b.creator_team;
  const coins = loser === b.creator_team ? Math.round(b.coins * Number(b.odds)) : b.coins;
  const cash = Number(b.amount ?? 0);
  m.set(b.winner_team, { coins, cash, won: true });
  m.set(loser, { coins: -coins, cash: -cash, won: false });
  return m;
}

// a Book ticket's result: open, void, or won/lost with the net (payout minus stake)
export function ticketOutcome(m: Market | undefined, t: MarketBet): { label: 'open' | 'void' | 'won' | 'lost'; net: number | null } {
  if (!m || m.status === 'open') return { label: 'open', net: null };
  if (m.status === 'void') return { label: 'void', net: 0 };
  const won = m.winner_key === t.pick;
  return { label: won ? 'won' : 'lost', net: won ? Math.round(t.payout ?? t.coins * t.odds) - t.coins : -t.coins };
}
