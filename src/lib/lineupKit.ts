// What Lineup New reads, for any team and any day (docs/DEVELOPMENT.md, the lineup research of 5 October 2026): the
// lineup a team has for a day (today's live one, else its own plan, else the last plan before it, else today's,
// carried forward the way the planner and the morning apply do), who plays that night, how busy the night is, and
// each player's expected points. Shared by the day view, the week grid, the comparison and the insights.
import { useCallback, useMemo, useState } from 'react';
import { useLeague, useSport } from './store';
import { calledOff, hasStarted } from './sport';
import { supabase } from './supabase';
import { etToday } from './format';
import { availability, gamesOf, slotOk } from './lineup';
import { useSeasonGames } from './projections';
import type { Game, Player, Roster } from './types';

export type Row = { r: Roster; p: Player };
export const START = ['C', 'LW', 'RW', 'D', 'Util', 'G'] as const;
export const ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, Util: 4, G: 5, BN: 6, IR: 7 };
export const isStart = (s: string | undefined) => !!s && (START as readonly string[]).includes(s);
export const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const weekday = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });
export const monthDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const longDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
export const hurt = (p: Player) => !!p.injury_status && /^(out|ir|injured|long|suspen)/i.test(p.injury_status);
// a light night: five games or fewer on the NHL slate, when a starter is likelier to be the one playing (Dobber's rule)
export const LIGHT = 5;

export function useLineupKit(span = 14) {
  const { league, players, rosters, serverOffset, teams, me } = useLeague();
  const sport = useSport();
  const games = useSeasonGames();
  const today = etToday();
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const last = addDays(today, span);

  const gamesOn = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const g of games ?? []) { if (calledOff(sport, g.state)) continue; m.set(g.date, [...(m.get(g.date) ?? []), g]); }
    return m;
  }, [games, sport]);
  const gameFor = useCallback((team: string | null | undefined, d: string) => (team ? (gamesOn.get(d) ?? []).find((g) => g.home === team || g.away === team) : undefined), [gamesOn]);
  const nightSize = (d: string) => gamesOn.get(d)?.length ?? 0;
  const light = (d: string) => { const n = nightSize(d); return n > 0 && n <= LIGHT; };

  const avail = useMemo(() => availability(players.values()), [players]);
  const chance = (p: Player) => avail.get(p.id) ?? 0;
  const perGame = (p: Player) => p.proj / gamesOf(p);
  const expPts = (p: Player) => (hurt(p) ? 0 : perGame(p) * chance(p));

  const rosterOf = useCallback((teamId: number): Row[] =>
    rosters.filter((r) => r.team_id === teamId).map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p), [rosters, players]);

  // the plans of the teams asked for, from tomorrow to the end of the window (plans are readable league-wide)
  const [plans, setPlans] = useState<Map<number, Map<string, Map<number, string>>>>(new Map());
  const loadPlans = useCallback(async (ids: number[]) => {
    const want = ids.filter((x) => x);
    if (!want.length) return;
    const got = new Map<number, Map<string, Map<number, string>>>();
    await Promise.all(want.map(async (tid) => {
      const { data } = await supabase.from('lineup_plans').select('date,player_id,slot').eq('team_id', tid).gt('date', today).lte('date', last).limit(5000);
      const m = new Map<string, Map<number, string>>();
      for (const r of data ?? []) { const x = m.get(r.date) ?? new Map(); x.set(r.player_id, r.slot); m.set(r.date, x); }
      got.set(tid, m);
    }));
    setPlans((p) => { const n = new Map(p); for (const [k, v] of got) n.set(k, v); return n; });
  }, [today, last]);

  // a team's lineup for a day: today's live one; a later day's own plan, else the last plan before it, else today's.
  // IR is set by hand on the team page: an IR player stays there, and a plan never puts anyone on it.
  const lineupOf = useCallback((teamId: number, d: string): { slots: Map<number, string>; source: 'live' | 'own' | 'carried' | 'today' } => {
    const roster = rosterOf(teamId);
    const live = new Map(roster.map((x) => [x.p.id, x.r.slot as string]));
    if (d <= today) return { slots: live, source: 'live' };
    const tp = plans.get(teamId);
    let from: string | null = null;
    for (const k of tp?.keys() ?? []) if (k <= d && (!from || k > from)) from = k;
    const base = from ? tp!.get(from)! : live;
    const slots = new Map<number, string>();
    for (const x of roster) { const b = base.get(x.p.id); slots.set(x.p.id, x.r.slot === 'IR' ? 'IR' : !b || b === 'IR' ? 'BN' : b); }
    return { slots, source: from === d ? 'own' : from ? 'carried' : 'today' };
  }, [rosterOf, plans, today]);

  const nowMs = Date.now() + serverOffset;
  const lockedOn = (p: Player, d: string) => {
    if (d !== today) return d < today;
    const g = gameFor(p.nhl_team, d);
    return !!g && (new Date(g.start_utc).getTime() <= nowMs || hasStarted(sport, g.state));
  };

  // a day's numbers for a team: starters with a game, expected points, healthy players with a game left on the bench,
  // empty starting slots
  const dayStats = (teamId: number, d: string, slotsIn?: Map<number, string>) => {
    const slots = slotsIn ?? lineupOf(teamId, d).slots;
    let playing = 0, pts = 0, benched = 0, filled = 0;
    const count: Record<string, number> = {};
    for (const x of rosterOf(teamId)) {
      const s = slots.get(x.p.id) ?? 'BN';
      count[s] = (count[s] ?? 0) + 1;
      const g = gameFor(x.p.nhl_team, d);
      if (isStart(s)) { filled++; if (g) { playing++; pts += expPts(x.p); } } else if (s === 'BN' && g && !hurt(x.p)) benched++;
    }
    const slotsTotal = START.reduce((t, s) => t + (caps[s] ?? 0), 0);
    const empty = START.reduce((t, s) => t + Math.max(0, (caps[s] ?? 0) - (count[s] ?? 0)), 0);
    return { playing, pts, benched, filled, empty, slotsTotal };
  };

  const canPlay = (p: Player, slot: string) => slotOk(p, slot);

  return { today, caps, games, gamesOn, gameFor, nightSize, light, expPts, perGame, chance, avail, rosterOf, plans, loadPlans, lineupOf,
    lockedOn, dayStats, canPlay, teams, me, players, sport, nowMs };
}
export type Kit = ReturnType<typeof useLineupKit>;
