// Prediction pools (migration 145, docs/POOLS.md): questions priced by the pool's market maker. The prices and the
// quote for a stake are worked out here the same way the database does (LMSR), so the buy sheet answers "what do I get
// for 100?" as the slider moves; the database does it again when the trade is made, and its numbers are the ones kept.
import { useCallback, useEffect, useState } from 'react';
import { realtimeChannel, supabase } from './supabase';

export interface PoolOutcome { key: string; label: string }
export interface PoolMarket {
  id: number; title: string; rule: string; category: string | null; outcomes: PoolOutcome[]; q: Record<string, number>;
  b: number; max_stake: number; status: 'open' | 'resolved' | 'void'; closes_at: string; winner_key: string | null; note: string | null;
  created_by: number | null; pack: string | null; sort: number; created_at: string; resolved_at: string | null;
}
export interface PoolPosition { market_id: number; team_id: number; outcome: string; shares: number; cost: number; paid: number }
export interface PoolTrade { id: number; market_id: number; team_id: number; outcome: string; shares: number; coins: number; prices: Record<string, number>; created_at: string }
export interface PoolDrop { id: number; at: string; amount: number; note: string }
export interface PoolLeader { team_id: number; coins: number; holdings: number; worth: number; calls: number; hits: number; trades: number }

// every answer's chance, adding to 1
export function prices(q: Record<string, number>, b: number): Record<string, number> {
  const ks = Object.keys(q), mx = Math.max(...ks.map((k) => Number(q[k])));
  const w = ks.map((k) => Math.exp((Number(q[k]) - mx) / b)), tot = w.reduce((a, x) => a + x, 0);
  return Object.fromEntries(ks.map((k, i) => [k, w[i] / tot]));
}
// the shares a stake buys of one answer, and the prices after it
export function quoteBuy(q: Record<string, number>, b: number, key: string, coins: number) {
  const ks = Object.keys(q), mx = Math.max(...ks.map((k) => Number(q[k])));
  const s = ks.reduce((a, k) => a + Math.exp((Number(q[k]) - mx) / b), 0), si = Math.exp((Number(q[key]) - mx) / b);
  const shares = mx + b * Math.log(s * (Math.exp(coins / b) - 1) + si) - Number(q[key]);
  return { shares, after: prices({ ...q, [key]: Number(q[key]) + shares }, b) };
}
const cost = (q: Record<string, number>, b: number) => {
  const ks = Object.keys(q), mx = Math.max(...ks.map((k) => Number(q[k])));
  return mx + b * Math.log(ks.reduce((a, k) => a + Math.exp((Number(q[k]) - mx) / b), 0));
};
// the coins selling some shares back gets
export function quoteSell(q: Record<string, number>, b: number, key: string, shares: number) {
  const nq = { ...q, [key]: Number(q[key]) - shares };
  return { coins: Math.floor(cost(q, b) - cost(nq, b)), after: prices(nq, b) };
}

export const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;
export const isOpen = (m: PoolMarket, now = Date.now()) => m.status === 'open' && new Date(m.closes_at).getTime() > now;

// the answers' colours, in order: rose for the first, then the rest of the palette (a two-answer question reads Yes/No)
export const ANSWER_COLORS = ['#fb7185', '#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f97316', '#f472b6', '#22d3ee', '#c084fc', '#4ade80', '#facc15', '#60a5fa'];
export const answerColor = (m: PoolMarket, key: string) => {
  const i = m.outcomes.findIndex((o) => o.key === key);
  if (m.outcomes.length === 2) return i === 0 ? '#34d399' : '#fb7185';
  return ANSWER_COLORS[i % ANSWER_COLORS.length];
};

// a pool's questions, positions, trades and drops, live: any trade anywhere in the pool refreshes the board
export function usePool() {
  const [markets, setMarkets] = useState<PoolMarket[] | null>(null);
  const [positions, setPositions] = useState<PoolPosition[]>([]);
  const [trades, setTrades] = useState<PoolTrade[]>([]);
  const [drops, setDrops] = useState<PoolDrop[]>([]);
  const load = useCallback(async () => {
    const [m, p, t, d] = await Promise.all([
      supabase.from('pool_markets').select('*').order('sort').order('closes_at'),
      supabase.from('pool_positions').select('market_id,team_id,outcome,shares,cost,paid'),
      supabase.from('pool_trades').select('*').order('created_at', { ascending: false }).limit(400),
      supabase.from('pool_drops').select('id,at,amount,note').order('at'),
    ]);
    if (!m.error) setMarkets((m.data ?? []) as PoolMarket[]);
    if (!p.error) setPositions(((p.data ?? []) as PoolPosition[]).map((x) => ({ ...x, shares: Number(x.shares), cost: Number(x.cost) })));
    if (!t.error) setTrades(((t.data ?? []) as PoolTrade[]).map((x) => ({ ...x, shares: Number(x.shares) })));
    if (!d.error) setDrops((d.data ?? []) as PoolDrop[]);
  }, []);
  useEffect(() => {
    load();
    const ch = realtimeChannel('pool')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pool_markets' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pool_trades' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  return { markets, positions, trades, drops, reload: load };
}

// a member's coins to spend (the ledger less what open side bets hold)
export function useCoins(teamId: number | undefined) {
  const [coins, setCoins] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase.from('coin_balances').select('balance,escrow').eq('team_id', teamId).maybeSingle();
    setCoins(data ? Number(data.balance) - Number(data.escrow) : 0);
  }, [teamId]);
  useEffect(() => { load(); }, [load]);
  return { coins, reloadCoins: load };
}
