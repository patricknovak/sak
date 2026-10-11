// An NHL game as NHL centre reads it (nhl-hub's scores and game feeds, from the NHL's own API), and the league's clock
// laid over it. The score, the period, the clock and the state come from the games table every page reads (written
// within seconds of the NHL by nhl-sync's clock job, migrations 246 and 247, and pushed by realtime), so NHL centre,
// the scoreboard, My Team and the home page always show the same score at the same moment; the feed brings everything
// else (logos, broadcasters, goals with clips, the box score).
import { useCallback, useMemo } from 'react';
import { useLeague } from './store';
import { fmtTime } from './format';
import type { Game as DbGame } from './types';
import type { SnFeed } from '../components/LiveWatch';

export type NTeam = { id: number; abbrev: string; name: string; place: string; score: number | null; sog: number | null; logo: string | null; radio: string | null; record: string | null };
export type Goal = { period: number; type?: string; time: string; playerId: number; name: string; team: string; strength: string; modifier: string; goalsToDate: number; away: number; home: number; mugshot: string | null; assists: { playerId: number; name: string; n: number }[]; clip: string | null };
export type HubGame = {
  id: number; date?: string; type: number; state: string; scheduleState: string; start: string; venue: string;
  period: { n: number; type: string } | null; clock: { time: string; running: boolean; intermission: boolean } | null;
  home: NTeam; away: NTeam; outcome: string | null; tv: { network: string; market: string; country: string }[];
  goals: Goal[]; recap: string | null; condensed: string | null; link: string | null; sn?: SnFeed[];
};
export type Skater = { id: number; num: number; name: string; pos: string; g: number; a: number; pts: number; pm: number; pim: number; sog: number; hit: number; blk: number; toi: string; fo: number };
export type Goalie = { id: number; num: number; name: string; pos: 'G'; sa: string; svp: number | null; ga: number; toi: string; decision: string | null; starter: boolean };
export type Detail = HubGame & {
  scoring: { period: number; type: string; goals: Goal[] }[];
  stars: { star: number; playerId: number; team: string; name: string; pos: string; g?: number; a?: number; pts?: number; svp?: number; ga?: number; headshot: string | null }[];
  penalties: { period: number; items: { time: string; team: string; who: string; desc: string; min: number }[] }[];
  box: { home: { forwards: Skater[]; defense: Skater[]; goalies: Goalie[] } | null; away: { forwards: Skater[]; defense: Skater[]; goalies: Goalie[] } | null } | null;
};
export type Scores = { date: string; prev: string | null; next: string | null; games: HubGame[] };

export const LIVE = new Set(['LIVE', 'CRIT']), DONE = new Set(['OFF', 'FINAL']);

export const per = (g: Pick<HubGame, 'period'>) => (!g.period ? '' : g.period.type === 'REG' ? `P${g.period.n}` : g.period.type);
export const status = (g: Pick<HubGame, 'scheduleState' | 'state' | 'outcome' | 'clock' | 'period' | 'start'>) => {
  if (g.scheduleState === 'PPD' || g.state === 'PPD') return 'Postponed';
  if (g.scheduleState === 'CNCL' || g.state === 'CNCL') return 'Cancelled';
  if (DONE.has(g.state)) return g.outcome && g.outcome !== 'REG' ? `Final/${g.outcome}` : 'Final';
  if (LIVE.has(g.state)) return g.clock?.intermission ? `End ${per(g)}` : `${per(g)} · ${g.clock?.time ?? ''}`;
  return fmtTime(g.start);
};
export const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// the games table's line over the feed's: score, state, period and clock. 'INT' is an intermission; a period is '1' to
// '3', or 'OT' / 'SO'. A game the table holds as postponed or cancelled keeps the feed's schedule state as well.
export function overlay<T extends Pick<HubGame, 'state' | 'period' | 'clock' | 'home' | 'away'>>(g: T, db: DbGame | undefined): T {
  if (!db) return g;
  const off = db.state === 'PPD' || db.state === 'CNCL';
  const period = db.period ? (/^\d+$/.test(db.period) ? { n: Number(db.period), type: 'REG' } : { n: db.period === 'SO' ? 5 : 4, type: db.period }) : g.period;
  const clock = db.clock ? (db.clock === 'INT' ? { time: '00:00', running: false, intermission: true } : { time: db.clock, running: LIVE.has(db.state), intermission: false }) : g.clock;
  return {
    ...g, state: off ? g.state : db.state, period, clock,
    home: { ...g.home, score: db.home_score ?? g.home.score }, away: { ...g.away, score: db.away_score ?? g.away.score },
  };
}

// the league's clock over any list of the feed's games
export function useOverlay() {
  const { games } = useLeague();
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const one = useCallback(<T extends Pick<HubGame, 'id' | 'state' | 'period' | 'clock' | 'home' | 'away'>>(g: T) => overlay(g, byId.get(g.id)), [byId]);
  return { one, byId };
}
