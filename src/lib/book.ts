// The Book's markets, every ticket and the bettors' table, kept current by realtime: read by the Book itself
// (components/Book) and by the home page's cards, which shouldn't have to load the whole Book to show a ticket.
import { useEffect, useState } from 'react';
import { realtimeChannel, supabase } from './supabase';
import type { BookStanding, Market, MarketBet } from './types';

export function useBook() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickets, setTickets] = useState<MarketBet[]>([]);
  const [standings, setStandings] = useState<BookStanding[]>([]);
  const load = () => {
    const since = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    Promise.all([
      supabase.from('markets').select('*').or(`status.eq.open,date.gte.${since}`).order('closes_at'),
      supabase.from('market_bets').select('*').order('id', { ascending: false }).limit(1000),
    ]).then(async ([{ data: ms }, { data: ts }]) => {
      const list = (ms ?? []) as Market[];
      const tix = (ts ?? []) as MarketBet[];
      // older markets that tickets were placed on, so every ticket's result can be shown
      const have = new Set(list.map((m) => m.id));
      const missing = [...new Set(tix.map((t) => t.market_id).filter((id) => !have.has(id)))];
      for (let i = 0; i < missing.length; i += 200) {
        const { data } = await supabase.from('markets').select('*').in('id', missing.slice(i, i + 200));
        list.push(...((data ?? []) as Market[]));
      }
      setMarkets(list.sort((a, b) => a.closes_at.localeCompare(b.closes_at)));
      setTickets(tix);
    });
    supabase.from('book_standings').select('*').then(({ data }) => setStandings((data ?? []) as BookStanding[]));
  };
  useEffect(() => {
    load();
    const ch = realtimeChannel('book')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markets' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_bets' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return { markets, tickets, standings, reload: load };
}
