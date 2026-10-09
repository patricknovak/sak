// The pool scoreboard (migration 169): every game a pool runs, read into one shape. Each game's own engine keeps its
// rules; `pool_scoreboard()` ranks every game, leads with the pool's main game and carries each member's movement since
// the day began, so the Table page, the home's rank and anything built later read one thing whatever the kind.
import { useCallback, useEffect, useState } from 'react';
import { rpc } from './supabase';

export type BoardKind = 'questions' | 'series' | 'rank' | 'squares' | 'pickem' | 'survivor' | 'score' | 'bracket' | 'players' | 'props';
export interface BoardRow { team_id: number; rank: number; score: number; possible: number | null; alive: boolean | null; line: string | null; move: number | null }
export interface BoardMine { rank: number; score: number; possible: number | null; alive: boolean | null; line: string | null; move: number | null; behind: number }
export interface BoardGame { key: string; kind: BoardKind; title: string; status: 'open' | 'done'; link: string; members: number; crown: boolean; mine: BoardMine | null; rows: BoardRow[] }
export interface Scoreboard { crown: string | null; games: BoardGame[] }

// how each kind reads: an icon, what its score counts, and whether the score is coins
export const BOARD_KIND: Record<BoardKind, { icon: string; unit: (n: number) => string; coins?: boolean; blurb: string }> = {
  questions: { icon: '🔮', unit: () => '', coins: true, blurb: 'Net worth: coins in hand plus every call at today’s price.' },
  series: { icon: '⚾', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Points for each series called, more for the length.' },
  rank: { icon: '📊', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Every win pays the rank you gave that club.' },
  squares: { icon: '🔲', unit: () => '', coins: true, blurb: 'Coins won by your squares.' },
  pickem: { icon: '✅', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Points for every right pick, round by round.' },
  bracket: { icon: '🏆', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Points for each right winner, more each round.' },
  props: { icon: '📋', unit: (n) => (n === 1 ? 'call' : 'calls'), blurb: 'Calls right on the game; the closest total breaks a tie.' },
  players: { icon: '🏒', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Goals, assists and goalie wins from one player in each box.' },
  survivor: { icon: '🛡️', unit: (n) => (n === 1 ? 'week' : 'weeks'), blurb: 'Still in first, then the matchweeks survived.' },
  score: { icon: '🎯', unit: (n) => (n === 1 ? 'pt' : 'pts'), blurb: 'Points for every result and exact score called.' },
};

// a kind this copy of the site doesn't know yet (the database learns kinds before every phone reloads) reads plainly
// instead of breaking the page
export const kindOf = (k: string) => BOARD_KIND[k as BoardKind] ?? { icon: '🏆', unit: (n: number) => (n === 1 ? 'pt' : 'pts'), blurb: 'Ranked by points.' };

const num = (x: unknown) => (x == null ? null : Number(x));

export function usePoolScoreboard() {
  const [board, setBoard] = useState<Scoreboard | null | undefined>(undefined);
  const load = useCallback(() => rpc<Scoreboard>('pool_scoreboard').then((b) => setBoard(b ? {
    crown: b.crown,
    games: (b.games ?? []).map((g) => ({
      ...g,
      mine: g.mine ? { ...g.mine, score: Number(g.mine.score), possible: num(g.mine.possible), behind: Number(g.mine.behind ?? 0) } : null,
      rows: g.rows.map((r) => ({ ...r, score: Number(r.score), possible: num(r.possible) })),
    })),
  } : null), () => setBoard(null)), []);
  useEffect(() => {
    load();
    // the tables move with results: look again every minute while the page is open
    const i = window.setInterval(load, 60_000);
    return () => window.clearInterval(i);
  }, [load]);
  return { board, reload: load };
}

// a row can't finish first: the game is on, it says what's still possible, and that's short of the leader
export const outOfIt = (g: BoardGame, r: BoardRow) => g.status === 'open' && r.possible != null && r.possible < (g.rows[0]?.score ?? 0);
