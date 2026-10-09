// The weekly review on the Performance page: every team's fantasy week (Monday to Sunday, Eastern; a head-to-head
// league's matchup weeks), graded against the rest of the league, with what to do about it. Two halves:
//
// * The week, from the same rows the page's table counts (performance_days, performance_players, lineup_efficiency):
//   points and rank, the move in the standings, points against what the starters' games projected, the best and the
//   coldest player, what was left on the bench, and starts used against starts possible (every non-IR player who
//   played that night, fitted into the league's starting slots: the puck-drop snapshots and the league's box scores).
// * What to do now, from today's rosters and the same values the trade finder and the pickup advisor use (rest-of-season
//   points, a category league's on a points scale): free agents who beat a team's weakest starter at a position where it
//   ranks low (with the player it can best spare), a two-way trade with the partner whose strengths fit its needs
//   (findTrades, both lineups better, value close), and lineup housekeeping (injured players off IR, healthy ones on it,
//   bench points, unused starts, goalie starts, a light schedule in the next seven days). Every rule is plain arithmetic
//   on those numbers, so each suggestion says why with them.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Crown, TrendingUp, Armchair, ClipboardCheck } from 'lucide-react';
import { useLeague, useSport } from '../lib/store';
import { useSticky } from '../lib/sticky';
import { rpc, supabase } from '../lib/supabase';
import { etToday, fmtDate, fmtPts, injuryBack, ordinal, readable } from '../lib/format';
import { calledOff } from '../lib/sport';
import { gamesOf, irOk, isOut, rosPerGame, slotOk, STARTING } from '../lib/lineup';
import { lineupStrength, gradeColor } from '../lib/grades';
import { useSeasonGames } from '../lib/projections';
import { dropOrder, findTrades, healthy, NEED, partnerFit, positionRanks, posture, POS, type Suggestion as TradeIdea } from '../lib/trade';
import { statDef } from '../lib/playerstats';
import { aggregate, addDays, catVal, fmtCat, GOALIE_KEYS, rankOf, rotoTable, type Day, type Eff, type PP } from '../lib/perf';
import type { Player, Team } from '../lib/types';
import { usePickupStatus, useTradeValuer } from './TradeTools';
import { useH2H, type Matchup } from './HeadToHead';
import { PlayerTag } from './PlayerCard';
import { Headshot, Pos, Section, TeamBadge } from './ui';

type Snap = { team_id: number; player_id: number; slot: string; game_id: number; date: string };
interface Week { key: string; from: string; to: string; live: boolean; n?: number }
type Tone = 'good' | 'bad' | 'info';
type Kind = 'roster' | 'pickup' | 'trade' | 'lineup' | 'goalie' | 'ahead' | 'outlook';
interface Tip { key: string; kind: Kind; tone: Tone; title: ReactNode; why: ReactNode; to?: { href: string; label: string } }

const KIND: Record<Kind, { label: string; icon: string }> = {
  roster: { label: 'Roster', icon: '🩹' }, pickup: { label: 'Free agent', icon: '➕' }, trade: { label: 'Trade idea', icon: '🔁' },
  lineup: { label: 'Lineup', icon: '📋' }, goalie: { label: 'Goalies', icon: '🥅' }, ahead: { label: 'Week ahead', icon: '📅' }, outlook: { label: 'Outlook', icon: '🧭' },
};
const TONE: Record<Tone, string> = { good: 'border-emerald-400/25 bg-emerald-400/[.06]', bad: 'border-rose-400/25 bg-rose-400/[.06]', info: 'border-white/[.08] bg-white/[.03]' };

const monday = (d: string) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const md = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const span = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${md(a)}–${Number(b.slice(8))}` : `${md(a)} – ${md(b)}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const LETTERS: [number, string][] = [[1.2, 'A+'], [0.8, 'A'], [0.45, 'A-'], [0.15, 'B+'], [-0.15, 'B'], [-0.45, 'B-'], [-0.75, 'C+'], [-1.05, 'C'], [-1.4, 'D']];
const letter = (z: number) => LETTERS.find(([min]) => z >= min)?.[1] ?? 'F';
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// the most starting slots a night's players could fill (each where he's eligible): augmenting paths, like
// _best_lineup_points with every player worth one
function maxStarts(ps: Player[], slots: string[]) {
  const holder = new Array<number>(slots.length).fill(-1);
  const place = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < slots.length; j++) {
      if (seen[j] || !slotOk(ps[i], slots[j])) continue;
      seen[j] = true;
      if (holder[j] < 0 || place(holder[j], seen)) { holder[j] = i; return true; }
    }
    return false;
  };
  let n = 0;
  for (let i = 0; i < ps.length; i++) if (place(i, new Array<boolean>(slots.length).fill(false))) n++;
  return n;
}

// every page of a filtered read (the REST API hands back a thousand rows at a time)
async function allPages<T>(q: (a: number, b: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export function WeeklyReview({ rows, effRows, phase, catMode, cats, isLow }: { rows: Day[]; effRows: Eff[]; phase: 2 | 3; catMode: boolean; cats: string[]; isLow: (k: string) => boolean }) {
  const { me, teams, team, players, rosters, league, leagueDay, season, windows } = useLeague();
  const sport = useSport();
  const gmTeams = useMemo(() => teams.filter((t) => t.role === 'gm'), [teams]);
  const ids = useMemo(() => gmTeams.map((t) => t.id), [gmTeams]);
  const n = ids.length;
  const h2h = useH2H();
  const h2hOn = league?.format === 'h2h' && phase === 2 && !!h2h.matchups?.length;
  const scored = useMemo(() => rows.filter((r) => r.game_type === phase), [rows, phase]);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const slots = useMemo(() => STARTING.flatMap((s) => Array.from({ length: caps[s] ?? 0 }, () => s)), [league?.roster]); // eslint-disable-line react-hooks/exhaustive-deps

  // the weeks to pick from: a head-to-head league's matchup weeks, otherwise Monday to Sunday; newest first
  const weeks = useMemo((): Week[] => {
    if (h2hOn) {
      const byWeek = new Map<number, Matchup>();
      for (const m of h2h.matchups!) if (m.status !== 'upcoming' && !byWeek.has(m.week)) byWeek.set(m.week, m);
      return [...byWeek.values()].sort((a, b) => b.week - a.week).map((m) => ({ key: `w${m.week}`, from: m.starts, to: m.ends, live: m.status === 'live', n: m.week }));
    }
    const dates = [...new Set(scored.map((r) => r.date))].sort();
    if (!dates.length) return [];
    const out: Week[] = [];
    for (let w = monday(dates[0]); w <= monday(leagueDay); w = addDays(w, 7)) {
      const to = addDays(w, 6);
      if (dates.some((d) => d >= w && d <= to)) out.push({ key: w, from: w, to, live: to >= leagueDay });
    }
    return out.reverse();
  }, [h2hOn, h2h.matchups, scored, leagueDay]);
  const [picked, setPicked] = useSticky<string | null>('perf:week', null);
  const week = weeks.find((w) => w.key === picked) ?? weeks.find((w) => !w.live) ?? weeks[0] ?? null;
  const label = (w: Week) => (w.live ? 'This week so far' : `${w.n ? `Week ${w.n} · ` : ''}${span(w.from, w.to)}`);

  // the week's player lines, puck-drop snapshots and who played, loaded when the week changes
  const [wk, setWk] = useState<{ key: string; pp: PP[]; snaps: Snap[] | null; played: Set<string> | null } | null>(null);
  useEffect(() => {
    if (!week) return;
    let on = true;
    const { key, from, to } = week;
    (async () => {
      const pp = await rpc<PP[]>('performance_players', { p_from: from, p_to: to, p_team: null })
        .then((d) => d.map((r) => ({ ...r, points: Number(r.points), bench: Number(r.bench) })), () => [] as PP[]);
      let snaps: Snap[] | null = null, played: Set<string> | null = null;
      try {
        snaps = (await allPages<Snap>((a, b) => supabase.from('lineup_snapshots').select('team_id,player_id,slot,game_id,date').gte('date', from).lte('date', to).order('game_id').order('team_id').order('player_id').range(a, b)))
          .filter((s) => s.date >= from && s.date <= to);
        const gameIds = [...new Set(snaps.map((s) => s.game_id))], who = [...new Set(snaps.map((s) => s.player_id))];
        const lg = gameIds.length ? await allPages<{ player_id: number; game_id: number }>((a, b) => supabase.from('league_games').select('player_id,game_id').in('game_id', gameIds).in('player_id', who).order('game_id').order('player_id').range(a, b)) : [];
        played = new Set(lg.map((r) => `${r.player_id}:${r.game_id}`));
      } catch { snaps = null; played = null; }
      if (on) setWk({ key, pp, snaps, played });
    })();
    return () => { on = false; };
  }, [week?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const wkData = wk && week && wk.key === week.key ? wk : null;

  // ---- the week, team by team ----
  const perGame = (p: Player) => p.proj / gamesOf(p);
  const review = useMemo(() => {
    if (!week) return null;
    const wRows = scored.filter((r) => r.date >= week.from && r.date <= week.to);
    const aggs = aggregate(wRows, ids);
    const roto = catMode ? rotoTable(aggs, cats, isLow) : null;
    const score = (id: number) => (catMode ? roto!.get(id)?.total ?? 0 : aggs.find((a) => a.team_id === id)?.points ?? 0);
    const scores = ids.map(score);
    const mean = scores.reduce((t, x) => t + x, 0) / Math.max(1, n);
    const spread = Math.sqrt(scores.reduce((t, x) => t + (x - mean) ** 2, 0) / Math.max(1, n)) || 1;
    // lineups against the best they could have been, night by night
    const eff = new Map<number, { points: number; best: number; worst: Eff | null }>();
    for (const r of effRows) {
      if (r.game_type !== phase || r.date < week.from || r.date > week.to) continue;
      const e = eff.get(r.team_id) ?? { points: 0, best: 0, worst: null };
      e.points += r.points; e.best += r.best;
      if (r.best - r.points > 0.05 && (!e.worst || r.best - r.points > e.worst.best - e.worst.points)) e.worst = r;
      eff.set(r.team_id, e);
    }
    const effPct = (id: number) => { const e = eff.get(id); return e && e.best > 0 ? e.points / e.best : null; };
    const pcts = ids.map(effPct).filter((x): x is number => x != null);
    const lgPct = pcts.length ? pcts.reduce((t, x) => t + x, 0) / pcts.length : null;
    // starts possible: every night, the non-IR players who played, fitted into the starting slots
    const possible = new Map<number, number>();
    if (wkData?.snaps && wkData.played) {
      const nights = new Map<string, Player[]>();
      for (const s of wkData.snaps) {
        if (s.slot === 'IR' || !wkData.played.has(`${s.player_id}:${s.game_id}`)) continue;
        const p = players.get(s.player_id);
        if (!p) continue;
        const k = `${s.team_id}|${s.date}`;
        nights.set(k, [...(nights.get(k) ?? []), p]);
      }
      for (const [k, ps] of nights) { const t = Number(k.split('|')[0]); possible.set(t, (possible.get(t) ?? 0) + maxStarts(ps, slots)); }
    }
    const pp = wkData?.pp ?? [];
    // goalie starts and what the starters' games projected
    const goalieStarts = new Map<number, number>(), expected = new Map<number, number>();
    for (const r of pp) {
      const p = players.get(r.player_id);
      if (!p) continue;
      if (p.pos === 'G') goalieStarts.set(r.team_id, (goalieStarts.get(r.team_id) ?? 0) + r.started);
      expected.set(r.team_id, (expected.get(r.team_id) ?? 0) + r.started * perGame(p));
    }
    const gsAvg = pp.length ? ids.reduce((t, id) => t + (goalieStarts.get(id) ?? 0), 0) / Math.max(1, n) : null;

    // the standings before the week and after it
    const before = new Map<number, number>(), after = new Map<number, number>();
    let h2hGame = new Map<number, { opp: number | null; mine: number; theirs: number | null; res: 'W' | 'L' | 'T' | 'bye' | 'live' }>();
    if (h2hOn && week.n != null) {
      const rec = (upto: number, incl: boolean) => {
        const r = new Map<number, { w: number; l: number; t: number; pf: number }>(ids.map((id) => [id, { w: 0, l: 0, t: 0, pf: 0 }]));
        for (const m of h2h.matchups!) {
          if (m.status !== 'final' || (incl ? m.week > upto : m.week >= upto)) continue;
          const a = r.get(m.home_team), b = m.away_team != null ? r.get(m.away_team) : undefined;
          if (!a) continue;
          a.pf += Number(m.home_pts);
          if (!b) continue;
          b.pf += Number(m.away_pts ?? 0);
          const hp = Number(m.home_pts), ap = Number(m.away_pts ?? 0);
          if (hp > ap) { a.w++; b.l++; } else if (hp < ap) { a.l++; b.w++; } else { a.t++; b.t++; }
        }
        const key = (id: number) => { const x = r.get(id)!; return (x.w + x.t / 2) * 1e6 + x.pf; };
        return new Map(ids.map((id) => [id, rankOf(key(id), ids.map(key))]));
      };
      const hasBefore = h2h.matchups!.some((m) => m.status === 'final' && m.week < week.n!);
      if (hasBefore) for (const [k, v] of rec(week.n, false)) before.set(k, v);
      if (!week.live) for (const [k, v] of rec(week.n, true)) after.set(k, v);
      h2hGame = new Map();
      for (const m of h2h.matchups!.filter((x) => x.week === week.n)) {
        const hp = Number(m.home_pts), ap = m.away_pts == null ? null : Number(m.away_pts);
        const res = (mine: number, theirs: number | null) => (m.away_team == null ? 'bye' as const : m.status !== 'final' ? 'live' as const : mine > theirs! ? 'W' as const : mine < theirs! ? 'L' as const : 'T' as const);
        h2hGame.set(m.home_team, { opp: m.away_team, mine: hp, theirs: ap, res: res(hp, ap) });
        if (m.away_team != null) h2hGame.set(m.away_team, { opp: m.home_team, mine: ap ?? 0, theirs: hp, res: res(ap ?? 0, hp) });
      }
    } else if (!h2hOn) {
      const pre = scored.filter((r) => r.date < week.from), post = scored.filter((r) => r.date <= week.to);
      const ranks = (rs: Day[]) => {
        const a = aggregate(rs, ids);
        const val = catMode ? rotoTable(a, cats, isLow) : null;
        const s = (id: number) => (catMode ? val!.get(id)?.total ?? 0 : a.find((x) => x.team_id === id)?.points ?? 0);
        return new Map(ids.map((id) => [id, rankOf(s(id), ids.map(s))]));
      };
      if (pre.length) for (const [k, v] of ranks(pre)) before.set(k, v);
      for (const [k, v] of ranks(post)) after.set(k, v);
    }

    const out = new Map(ids.map((id) => {
      const a = aggs.find((x) => x.team_id === id)!;
      const e = eff.get(id), p = effPct(id), exp = expected.get(id) ?? 0;
      const rank = rankOf(score(id), scores);
      const g = h2hGame.get(id);
      // the grade: where the week's total sits against the league (in spreads), nudged by how well the lineups were set,
      // by the points against what the starters' games projected, and by a head-to-head result
      let z = (score(id) - mean) / spread;
      if (!catMode && p != null && lgPct != null) z += clamp((p - lgPct) * 6, -0.4, 0.4);
      if (!catMode && exp > 0 && a.days) z += clamp((a.points / exp - 1) * 1.5, -0.35, 0.35);
      if (g?.res === 'W') z += 0.25; else if (g?.res === 'L') z -= 0.25;
      const mine = pp.filter((r) => r.team_id === id && players.get(r.player_id));
      const starters = mine.filter((r) => r.started > 0);
      const best = [...starters].sort((x, y) => y.points - x.points)[0] ?? null;
      // the coldest: furthest below what his starts projected, two starts or more
      const cold = starters.filter((r) => r.started >= 2).map((r) => ({ r, miss: r.points - r.started * perGame(players.get(r.player_id)!) }))
        .sort((x, y) => x.miss - y.miss)[0] ?? null;
      const place = roto?.get(id)?.place ?? {};
      const byPlace = catMode ? [...cats].sort((x, y) => (place[x] ?? n) - (place[y] ?? n)) : [];
      return [id, {
        id, agg: a, score: score(id), rank, eff: e ?? null, effPct: p, expected: exp, possible: possible.get(id) ?? null, g: g ?? null,
        before: before.get(id) ?? null, after: after.get(id) ?? null, grade: letter(z), z, goalieStarts: goalieStarts.get(id) ?? 0,
        best, cold: cold && cold.miss <= -2 ? cold : null, place, topCat: byPlace[0] ?? null, lowCat: byPlace[byPlace.length - 1] ?? null, pp: mine,
      }] as const;
    }));
    return { teams: out, mean, lgPct, gsAvg, days: [...new Set(wRows.map((r) => r.date))].length, roto };
  }, [week, scored, effRows, ids, catMode, cats, wkData, players, slots, h2hOn, h2h.matchups, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what to do now, from today's rosters ----
  const { v, ctxOf, rosterMax, progress, standings } = useTradeValuer();
  const pk = usePickupStatus();
  const rostered = useMemo(() => new Set(rosters.map((r) => r.player_id)), [rosters]);
  const rosterOf = (id: number) => rosters.filter((r) => r.team_id === id).map((r) => ({ r, p: players.get(r.player_id) })).filter((x): x is { r: typeof x.r; p: Player } => !!x.p);
  const ranks = useMemo(() => (rosters.length ? positionRanks(ids.map((id) => ctxOf(id)), v) : new Map<number, Record<string, number>>()), [rosters, v, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = useMemo(() => [...players.values()].filter((p) => !rostered.has(p.id) && p.proj > 0 && healthy(p)).sort((a, b) => v.player(b) - v.player(a)).slice(0, 250), [players, rostered, v]);
  // per game the rest of the way (the Players page's ROS/G), and the last 14 days
  const rosG = (p: Player) => { const s = season.get(p.id); return rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp); };
  const last14 = (p: Player) => { const w = windows.get(p.id)?.['14']; return w && w.gp > 0 ? w.fpts : null; };
  const worth = (p: Player) => (catMode ? `value ${Math.round(v.player(p))}` : `${rosG(p).toFixed(2)} a game`);
  // the next seven days of games: who plays, and how many starts each roster can fill
  const seasonGames = useSeasonGames();
  const today = etToday();
  const ahead = useMemo(() => {
    if (!seasonGames) return null;
    const end = addDays(today, 6);
    const byDay = new Map<string, Set<string>>();
    for (const g of seasonGames) {
      if (g.date < today || g.date > end || calledOff(sport, g.state)) continue;
      const s = byDay.get(g.date) ?? new Set<string>(); s.add(g.home); s.add(g.away); byDay.set(g.date, s);
    }
    const gamesOf7 = (p: Player) => [...byDay.values()].filter((s) => p.nhl_team && s.has(p.nhl_team)).length;
    const fill = new Map<number, number>();
    for (const id of ids) {
      const ps = rosters.filter((r) => r.team_id === id && r.slot !== 'IR').map((r) => players.get(r.player_id)).filter((p): p is Player => !!p && !isOut(p.injury_status));
      let t = 0;
      for (const s of byDay.values()) t += maxStarts(ps.filter((p) => p.nhl_team && s.has(p.nhl_team)), slots);
      fill.set(id, t);
    }
    const avg = ids.length ? ids.reduce((t, id) => t + (fill.get(id) ?? 0), 0) / ids.length : 0;
    return { fill, avg, gamesOf7, days: byDay.size };
  }, [seasonGames, today, ids, rosters, players, slots, sport]); // eslint-disable-line react-hooks/exhaustive-deps

  const tips = useMemo(() => {
    const out = new Map<number, Tip[]>();
    if (!review) return out;
    for (const id of ids) {
      const isMe = id === me?.id;
      const list: Tip[] = [];
      const roster = rosterOf(id);
      const active = roster.filter((x) => x.r.slot !== 'IR').map((x) => x.p);
      const R = review.teams.get(id)!;
      // IR housekeeping: an injured player taking a roster spot, an injured starter, a healthy player stuck on IR
      const irCap = caps.IR ?? 0;
      let irUsed = roster.filter((x) => x.r.slot === 'IR').length;
      for (const { r, p } of [...roster].sort((a, b) => v.player(b.p) - v.player(a.p))) {
        const back = injuryBack(p.injury_return);
        if (r.slot === 'IR' && !isOut(p.injury_status)) {
          list.push({ key: `ir-h${p.id}`, kind: 'roster', tone: 'bad', title: <><PlayerTag p={p} /> is on IR but {p.injury_status ? `only ${p.injury_status.toLowerCase()}` : 'off the injury report'}</>,
            why: 'Points on IR never count. Move him back to the lineup or the bench so his games score.' });
        } else if (r.slot !== 'IR' && isOut(p.injury_status)) {
          if ((STARTING as readonly string[]).includes(r.slot)) list.push({ key: `ir-s${p.id}`, kind: 'roster', tone: 'bad', title: <><PlayerTag p={p} /> is in the {r.slot} slot but listed {p.injury_status}</>,
            why: `He won't play${back ? ` (${back})` : ''}: a healthy player in that slot is free points.` });
          if (irOk(p.injury_status) && irUsed < irCap) {
            irUsed++;
            list.push({ key: `ir-m${p.id}`, kind: 'roster', tone: 'info', title: <>Move <PlayerTag p={p} /> to IR</>,
              why: `Listed ${p.injury_status}${back ? `, ${back}` : ''}. On IR he doesn't take a roster spot, so the spot can go to a free agent (${irCap - irUsed} IR spot${irCap - irUsed === 1 ? '' : 's'} left after him).` });
          } else if (irUsed >= irCap && irCap > 0 && !(STARTING as readonly string[]).includes(r.slot) && !list.some((x) => x.key.startsWith('ir-f'))) {
            // one of these is enough: the most valuable injured player holding a bench spot
            list.push({ key: `ir-f${p.id}`, kind: 'roster', tone: 'info', title: <><PlayerTag p={p} /> is out and IR is full</>,
              why: `Listed ${p.injury_status}${back ? `, ${back}` : ''}. He holds a bench spot meanwhile: worth ${catMode ? `a category value of ${Math.round(v.player(p))}` : `about ${Math.round(v.player(p))} points`} the rest of the way, so weigh keeping him against a pickup.` });
          }
        }
      }

      // free agents: the best one at each position where this team ranks low, when he clearly beats its weakest starter
      const left = pk.length ? pk.find((x) => x.team_id === id)?.remaining ?? null : null;
      const r = ranks.get(id);
      if (left === 0) list.push({ key: 'pk0', kind: 'pickup', tone: 'info', title: 'No free pickups left', why: 'Upgrades from here come by trade (pickups can change hands in one).' });
      else if (r && active.length) {
        const mid = (n + 1) / 2;
        const weak = POS.filter((pos) => r[pos] > mid).sort((a, b) => r[b] - r[a]);
        const order = [...weak, ...POS.filter((pos) => !weak.includes(pos))];
        const usedFa = new Set<number>(), usedDrop = new Set<number>();
        let roomLeft = rosterMax - active.length;
        for (const pos of order) {
          if (usedFa.size >= 2) break;
          const at = active.filter((p) => p.pos === pos && !usedDrop.has(p.id)).sort((a, b) => v.player(b) - v.player(a));
          const weakest = at[NEED[pos] - 1] ?? null;
          const floor = weakest ? v.player(weakest) : 0;
          const fa = free.find((p) => p.pos === pos && !usedFa.has(p.id));
          if (!fa) continue;
          const gain = v.player(fa) - floor;
          // a clear upgrade where the team is thin; a big one anywhere else
          if (gain < (weak.includes(pos) ? Math.max(4, floor * 0.08) : Math.max(12, floor * 0.2))) continue;
          let drop: Player | null = null;
          if (roomLeft <= 0) {
            const pool = active.filter((p) => !usedDrop.has(p.id));
            drop = dropOrder(pool, pool, v, 1)[0] ?? null;
            if (!drop || v.player(drop) >= v.player(fa)) continue;
            usedDrop.add(drop.id);
          } else roomLeft--;
          usedFa.add(fa.id);
          const f14 = last14(fa);
          list.push({ key: `fa${fa.id}`, kind: 'pickup', tone: 'good',
            title: <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">Add <PlayerTag p={fa} /> <Pos p={pos} className="px-1 py-0" />{drop ? <> for <PlayerTag p={drop} /></> : null}</span>,
            why: `${pos} ranks ${ordinal(r[pos])} of ${n} in the league. ${fa.name} (${fa.nhl_team}) ${catMode ? `rates a category value of ${Math.round(v.player(fa))} the rest of the way` : `projects ${rosG(fa).toFixed(2)} a game the rest of the way`}${f14 != null && !catMode ? `, ${fmtPts(f14)} points in his last 14 days` : ''}; ${weakest ? `the weakest starting ${pos}, ${weakest.name}, ${worth(weakest)}` : at.length ? `only ${at.length} ${pos} for ${NEED[pos]} starting spots` : `there's no ${pos} to start`}. ${drop ? `${drop.name} (${worth(drop)}) is the player the roster can best spare.` : 'There is an open roster spot for him.'}${left != null && left <= 3 ? ` ${left} pickup${left === 1 ? '' : 's'} left: spend them where it counts.` : ''}`,
            to: isMe ? { href: '/players?tab=advisor', label: 'Pickup advisor' } : undefined });
        }
      }

      // the week's lineup habits (points left on the bench, starts left unused)
      if (!catMode && R.eff && R.effPct != null) {
        const leftPts = R.eff.best - R.eff.points;
        if (leftPts >= 3 && R.effPct < 0.97) list.push({ key: 'bench', kind: 'lineup', tone: review.lgPct != null && R.effPct < review.lgPct ? 'bad' : 'info',
          title: `${fmtPts(leftPts)} points left out of the lineup`,
          why: `The lineups scored ${fmtPts(R.eff.points)} of a possible ${fmtPts(R.eff.best)} (${pct(R.effPct)}${review.lgPct != null ? `, league ${pct(review.lgPct)}` : ''})${R.eff.worst ? `; the costliest night was ${fmtDate(R.eff.worst.date)}, ${fmtPts(R.eff.worst.best - R.eff.worst.points)} left out` : ''}. Setting lineups ahead in the planner, or the auto-lineup, closes most of it.`,
          to: isMe ? { href: '/team', label: 'Set lineups' } : undefined });
        else if (leftPts < 0.05 && R.agg.days >= 2) list.push({ key: 'perfect', kind: 'lineup', tone: 'good', title: 'Perfect lineups all week', why: `Every night was the best lineup possible from the players who played (${R.agg.days} game days).` });
      }
      if (R.possible != null && R.possible - R.agg.starters >= 2) list.push({ key: 'starts', kind: 'lineup', tone: 'bad', title: `${R.possible - R.agg.starters} starts went unused`,
        why: `Players who played sat on the bench while a starting slot they could fill had nobody playing in it: ${R.agg.starters} starts of a possible ${R.possible}.` });

      // goalies: starts against the league, and enough healthy ones to fill the crease
      const goalies = active.filter((p) => p.pos === 'G' && !isOut(p.injury_status));
      const bestG = free.find((p) => p.pos === 'G');
      if (goalies.length < (NEED.G ?? 2) && bestG && !list.some((x) => x.key === `fa${bestG.id}`)) list.push({ key: 'g-few', kind: 'goalie', tone: 'bad', title: <span className="inline-flex flex-wrap items-center gap-x-1.5">Only {goalies.length} healthy goalie{goalies.length === 1 ? '' : 's'}: add <PlayerTag p={bestG} /></span>,
        why: `${caps.G ?? 2} goalie slots to fill every night. ${bestG.name} (${bestG.nhl_team}) is the best free-agent goalie, ${worth(bestG)}.` });
      else if (review.gsAvg != null && R.agg.days >= 2 && R.goalieStarts <= review.gsAvg - 1.5) list.push({ key: 'g-starts', kind: 'goalie', tone: 'info',
        title: `Goalies made ${R.goalieStarts} start${R.goalieStarts === 1 ? '' : 's'} (league average ${fmtPts(review.gsAvg)})`,
        why: `Goalie starts are where the big nights come from.${bestG ? ` ${bestG.name} (${bestG.nhl_team}) is the best free-agent goalie, ${worth(bestG)}.` : ''} Check who starts each night before puck drop.` });

      // the week ahead: a light schedule, and the free agent who plays the most
      if (ahead && ahead.days) {
        const mineFill = ahead.fill.get(id) ?? 0;
        if (mineFill < ahead.avg - Math.max(2, ahead.avg * 0.05)) {
          const st = lineupStrength(active.filter((p) => !isOut(p.injury_status)).map((p) => ({ id: p.id, pos: p.pos, elig: p.elig, proj: v.player(p) }))).starters
            .map((s) => active.find((p) => p.id === s.p.id)!).filter(Boolean);
          const light = st.map((p) => ({ p, g: ahead.gamesOf7(p) })).filter((x) => x.g <= 2).sort((a, b) => a.g - b.g).slice(0, 3);
          const stream = free.filter((p) => p.pos !== 'G' && ahead.gamesOf7(p) >= 4).sort((a, b) => rosG(b) * ahead.gamesOf7(b) - rosG(a) * ahead.gamesOf7(a))[0];
          list.push({ key: 'ahead', kind: 'ahead', tone: 'bad', title: `Light week ahead: about ${mineFill} starts to fill`,
            why: <>League average {fmtPts(ahead.avg, 0)} over the next 7 days.{light.length ? <> Few games for {light.map((x, i) => <span key={x.p.id}>{i ? ', ' : ' '}{x.p.name} ({x.g})</span>)}.</> : null}{stream ? <> {stream.name} ({stream.nhl_team}, {stream.elig.join('/')}) plays {ahead.gamesOf7(stream)} and is the best free agent to stream.</> : null}</> });
        } else if (mineFill >= ahead.avg + Math.max(3, ahead.avg * 0.08) && mineFill === Math.max(...ids.map((x) => ahead.fill.get(x) ?? 0))) {
          list.push({ key: 'ahead+', kind: 'ahead', tone: 'good', title: `Busiest week ahead in the league: about ${mineFill} starts`, why: `League average ${fmtPts(ahead.avg, 0)} over the next 7 days: keep the lineups full and it should be a big one.` });
        }
      }
      // buying or selling, for your own team in a points race
      if (isMe && !catMode && league?.format !== 'h2h') {
        const ps = posture(id, standings, progress);
        if (ps) list.push({ key: 'posture', kind: 'outlook', tone: 'info', title: ps.mode === 'buy' ? 'Buyer' : 'Seller', why: ps.text });
      }
      out.set(id, list);
    }
    return out;
  }, [review, ids, me?.id, rosters, players, ranks, free, pk, v, ahead, catMode, standings, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // trade ideas: the slowest search, run when a card opens (and for your own team), one team at a time
  const [open, setOpen] = useState<Set<number>>(() => new Set(me && me.role === 'gm' ? [me.id] : []));
  const [trades, setTrades] = useState<Map<number, { fit: ReturnType<typeof partnerFit>[number] | null; s: TradeIdea | null }>>(new Map());
  useEffect(() => { setTrades(new Map()); }, [v, rosters]);
  useEffect(() => {
    const next = [...open].find((id) => !trades.has(id) && ranks.has(id));
    if (next == null) return;
    const timer = setTimeout(() => {
      const fits = partnerFit(next, ranks, n);
      const good = fits.filter((f) => f.theyGive.length && f.youGive.length).slice(0, 2);
      let found: TradeIdea | null = null, fit = good[0] ?? fits[0] ?? null;
      for (const f of good) {
        const s = findTrades(ctxOf(next), [ctxOf(f.team)], v, rosterMax, { limit: 1, winWin: true, wantPos: f.theyGive, givePos: f.youGive, top: 10 })[0];
        if (s) { found = s; fit = f; break; }
      }
      setTrades((m) => new Map(m).set(next, { fit, s: found }));
    }, 40);
    return () => clearTimeout(timer);
  }, [open, trades, ranks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!week || !review) {
    return <div className="card flex items-center gap-3 p-4 text-sm text-mute"><span className="text-2xl">🗓️</span><span>The weekly review opens once the season’s first games are in: every team’s week, graded, with what each GM could do next.</span></div>;
  }
  const order = [...ids].sort((a, b) => (a === me?.id ? -1 : b === me?.id ? 1 : review.teams.get(a)!.rank - review.teams.get(b)!.rank || a - b));
  const all = ids.map((id) => review.teams.get(id)!);
  const top = [...all].sort((a, b) => b.score - a.score)[0];
  const climb = [...all].filter((x) => x.before != null && x.after != null).sort((a, b) => (b.before! - b.after!) - (a.before! - a.after!))[0];
  const sharp = !catMode ? [...all].filter((x) => x.effPct != null).sort((a, b) => b.effPct! - a.effPct!)[0] : null;
  const bench = !catMode ? [...all].filter((x) => x.eff).sort((a, b) => (b.eff!.best - b.eff!.points) - (a.eff!.best - a.eff!.points))[0] : null;
  const busiest = catMode ? [...all].sort((a, b) => b.agg.starters - a.agg.starters)[0] : null;
  const unit = catMode ? 'roto' : 'pts';
  const highlights = [
    <Highlight key="top" icon={<Crown size={14} className="text-gold" />} label="Team of the week" t={team(top.id)} value={`${fmtPts(top.score)} ${unit}`} />,
    climb && climb.before! - climb.after! > 0 ? <Highlight key="climb" icon={<TrendingUp size={14} className="text-emerald-300" />} label="Biggest climb" t={team(climb.id)} value={`▲${climb.before! - climb.after!} to ${ordinal(climb.after!)}`} />
      : sharp && sharp.effPct != null ? <Highlight key="sharp" icon={<TrendingUp size={14} className="text-emerald-300" />} label="Best lineups" t={team(sharp.id)} value={`${pct(sharp.effPct)} of the best`} /> : null,
    bench && bench.eff ? <Highlight key="bench" icon={<Armchair size={14} className="text-amber-200" />} label="Most left out" t={team(bench.id)} value={`${fmtPts(bench.eff.best - bench.eff.points)} pts`} />
      : busiest ? <Highlight key="busy" icon={<ClipboardCheck size={14} className="text-sky-300" />} label="Most starts" t={team(busiest.id)} value={`${busiest.agg.starters} starts`} /> : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-3">
        <div className="scroll-x flex gap-1">
          {weeks.map((w) => <button key={w.key} className={`tab shrink-0 px-3 py-1.5 ${week.key === w.key ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPicked(w.key)}>{label(w)}</button>)}
        </div>
        <div className="text-xs text-mute">{week.live ? `${span(week.from, week.to)}, so far` : span(week.from, week.to)} · {review.days} game day{review.days === 1 ? '' : 's'} · league average {fmtPts(review.mean)} {catMode ? 'roto points over the week’s categories' : 'points'}</div>
        <div className={`grid gap-2 ${highlights.length === 3 ? 'grid-cols-3' : highlights.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>{highlights}</div>
      </div>

      <Section title="Team by team" right={<span className="text-xs text-mute">tap a team to open</span>}>
        <div className="space-y-2">
          {order.map((id) => {
            const R = review.teams.get(id)!;
            const t = team(id);
            const isOpen = open.has(id);
            const tl = tips.get(id) ?? [];
            const tr = trades.get(id);
            return (
              <div key={id} className={`card overflow-hidden ${id === me?.id ? 'ring-1 ring-gold/40' : ''}`}>
                <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; })}>
                  <TeamBadge team={t} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 font-semibold leading-tight"><span className="break-words">{t?.name}</span>{id === me?.id && <span className="rounded-full bg-gold/15 px-1.5 text-[10px] font-bold uppercase tracking-wide text-gold">You</span>}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-mute">{ordinal(R.rank)} of {n} this week<Move R={R} />{R.g ? <H2HLine g={R.g} team={team} /> : null}{tl.length ? <> · <span className="text-sky-300">{tl.length} tip{tl.length === 1 ? '' : 's'}</span></> : null}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-display text-xl font-extrabold leading-none" style={{ color: readable(t?.color ?? '#fff') }}>{fmtPts(R.score)}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-mute">{unit}</span>
                  </span>
                  <GradeChip g={R.grade} />
                  <ChevronDown size={16} className={`shrink-0 text-mute transition ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-white/[.06] px-3 pb-3 pt-2.5">
                    <p className="text-sm leading-snug text-slate-200"><b className={gradeColor(R.grade)}>{R.grade}</b> · {explain(R, { n, mean: review.mean, lgPct: review.lgPct, catMode, cats, team })}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {catMode ? <>
                        <Tile label="Roto points" value={fmtPts(R.score)} sub={`${ordinal(R.rank)} of ${n}`} />
                        <Tile label="Best category" value={R.topCat ? statDef(R.topCat).short : '–'} sub={R.topCat ? `${ordinal(R.place[R.topCat] ?? n)} · ${fmtCat(R.topCat, catVal(R.agg.cats, R.topCat))}` : ''} cls="text-emerald-300" />
                        <Tile label="Weakest" value={R.lowCat ? statDef(R.lowCat).short : '–'} sub={R.lowCat ? `${ordinal(R.place[R.lowCat] ?? n)} · ${fmtCat(R.lowCat, catVal(R.agg.cats, R.lowCat))}` : ''} cls="text-amber-200" />
                      </> : <>
                        <Tile label="Points" value={fmtPts(R.agg.points)} sub={`${ordinal(R.rank)} of ${n} · avg ${fmtPts(review.mean)}`} />
                        <Tile label="Vs projection" value={R.expected > 0 ? `${R.agg.points >= R.expected ? '+' : '−'}${Math.abs(Math.round((R.agg.points / R.expected - 1) * 100))}%` : '–'} sub={R.expected > 0 ? `${fmtPts(R.expected)} projected` : 'no starts yet'}
                          cls={R.expected > 0 ? (R.agg.points >= R.expected ? 'text-emerald-300' : 'text-amber-200') : ''} />
                        <Tile label="Lineup" value={R.effPct != null ? pct(R.effPct) : '–'} sub={R.eff ? `${fmtPts(R.eff.best - R.eff.points)} left out` : 'of the best possible'}
                          cls={R.effPct == null ? '' : R.effPct >= 0.95 ? 'text-emerald-300' : R.effPct >= 0.85 ? '' : 'text-amber-200'} />
                      </>}
                      <Tile label="Starts" value={R.possible != null ? `${R.agg.starters}/${R.possible}` : String(R.agg.starters)} sub={R.possible != null ? (R.possible > R.agg.starters ? `${R.possible - R.agg.starters} unused` : 'none wasted') : `${R.goalieStarts} by goalies`}
                        cls={R.possible != null && R.possible - R.agg.starters >= 2 ? 'text-amber-200' : ''} />
                    </div>
                    <Performers R={R} catMode={catMode} />
                    <div className="space-y-1.5">
                      <div className="label px-0.5">What to do now</div>
                      {tl.filter((x) => x.kind === 'roster' || x.kind === 'pickup').map((x) => <TipRow key={x.key} tip={x} />)}
                      {tradeTip(id, tr, id === me?.id)}
                      {tl.filter((x) => x.kind !== 'roster' && x.kind !== 'pickup').map((x) => <TipRow key={x.key} tip={x} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      <p className="px-1 text-[11px] leading-snug text-mute">
        The grade sets each team’s week against the league’s (how far above or below the average it finished){catMode ? '' : ', nudged by how close the lineups came to the best possible and by the points against what the starters’ games projected'}{league?.format === 'h2h' ? ', and by the matchup' : ''}. Starts possible counts every non-IR player who played, fitted into the starting slots each night. Suggestions read today’s rosters with the trade finder’s and the pickup advisor’s rest-of-season values{catMode ? ' (category value, on a points scale)' : ''}: a free agent shows when he clearly beats the weakest starter at a position where the team ranks low, and a trade when both lineups get better at close value. They are ideas to check, never moves made for you.
      </p>
    </div>
  );

  // the trade idea row: the deal found, or the partner whose shape fits
  function tradeTip(id: number, tr: { fit: ReturnType<typeof partnerFit>[number] | null; s: TradeIdea | null } | undefined, isMe: boolean) {
    if (!ranks.has(id)) return null;
    if (!tr) return <div className={`rounded-xl border px-3 py-2 text-xs text-mute ${TONE.info}`}>🔁 Looking for a fair trade…</div>;
    const you = isMe ? 'you' : team(id)?.gm_name ?? 'this team';
    const yours = isMe ? 'you’re' : `${team(id)?.gm_name ?? 'this team'} is`;
    if (!tr.s) {
      if (!tr.fit || (!tr.fit.theyGive.length && !tr.fit.youGive.length)) return null;
      const p = team(tr.fit.team);
      return <TipRow tip={{ key: 'fit', kind: 'trade', tone: 'info', title: <span className="inline-flex items-center gap-1.5">Talk to <TeamBadge team={p} size={18} /><b>{p?.gm_name}</b></span>,
        why: `${p?.gm_name} ${tr.fit.theyGive.length ? `is deep at ${tr.fit.theyGive.join(', ')}` : 'is built a lot like this team'}${tr.fit.youGive.length ? ` and thin at ${tr.fit.youGive.join(', ')}, where ${yours} deep` : ''}. No two-for-two or smaller deal helps both lineups at close value yet; the trade finder can widen the search.`,
        to: isMe ? { href: `/trades?with=${tr.fit.team}`, label: 'Trade finder' } : undefined }} />;
    }
    const s = tr.s, p = team(s.partner);
    const net = s.me.net;
    const extra = [...s.givePicks.map((k) => `a ${k.season.slice(0, 4)} round ${k.round} pick`), ...(s.givePk ? [`${s.givePk} pickup${s.givePk === 1 ? '' : 's'}`] : [])];
    const back = [...s.getPicks.map((k) => `a ${k.season.slice(0, 4)} round ${k.round} pick`), ...(s.getPk ? [`${s.getPk} pickup${s.getPk === 1 ? '' : 's'}`] : [])];
    const q = new URLSearchParams({ with: String(s.partner), give: s.give.map((x) => x.id).join(','), get: s.get.map((x) => x.id).join(',') });
    if (s.givePicks.length) q.set('givePicks', s.givePicks.map((k) => k.id).join(','));
    if (s.getPicks.length) q.set('getPicks', s.getPicks.map((k) => k.id).join(','));
    if (s.givePk) q.set('givePk', String(s.givePk));
    if (s.getPk) q.set('getPk', String(s.getPk));
    return <TipRow tip={{ key: 'trade', kind: 'trade', tone: 'good',
      title: <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">With <TeamBadge team={p} size={18} /><b>{p?.gm_name}:</b> send {s.give.map((x, i) => <span key={x.id} className="inline-flex items-center gap-1">{i ? '+ ' : ''}<PlayerTag p={x} /><Pos p={x.pos} className="px-1 py-0" /></span>)}{extra.length ? <span>+ {extra.join(' + ')}</span> : null} for {s.get.map((x, i) => <span key={x.id} className="inline-flex items-center gap-1">{i ? '+ ' : ''}<PlayerTag p={x} /><Pos p={x.pos} className="px-1 py-0" /></span>)}{back.length ? <span>+ {back.join(' + ')}</span> : null}</span>,
      why: `${p?.gm_name} is deep at ${tr.fit?.theyGive.join(', ') || 'what this team needs'} and thin at ${tr.fit?.youGive.join(', ') || 'what it can spare'}. Both best lineups get better: ${you} ${s.me.startersDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(s.me.startersDelta))}, ${p?.gm_name} +${Math.round(s.them.startersDelta)} projected points the rest of the way; value ${Math.abs(net) <= 10 ? 'about even' : `${Math.round(Math.abs(net))} ${net > 0 ? `in ${isMe ? 'your' : 'this team’s'} favour` : `in ${p?.gm_name}’s favour`}`}.`,
      to: isMe ? { href: `/trades?${q.toString()}`, label: 'Open in the builder' } : undefined }} />;
  }
}

type Row = { id: number; agg: { points: number; days: number; starters: number; cats: Record<string, number> }; score: number; rank: number; eff: { points: number; best: number } | null; effPct: number | null; expected: number;
  g: { opp: number | null; mine: number; theirs: number | null; res: 'W' | 'L' | 'T' | 'bye' | 'live' } | null; before: number | null; after: number | null; place: Record<string, number>; topCat: string | null; lowCat: string | null;
  best: PP | null; cold: { r: PP; miss: number } | null; pp: PP[] };

// the grade in plain words, with the numbers behind it
function explain(R: Row, c: { n: number; mean: number; lgPct: number | null; catMode: boolean; cats: string[]; team: (id: number) => Team | undefined }) {
  const parts: string[] = [];
  if (c.catMode) parts.push(`${ordinal(R.rank)} of ${c.n} with ${fmtPts(R.score)} roto points from the week’s ${c.cats.length} categories (league average ${fmtPts(c.mean)})${R.topCat ? `, best in ${statDef(R.topCat).label.toLowerCase()} (${ordinal(R.place[R.topCat] ?? c.n)})` : ''}${R.lowCat && R.lowCat !== R.topCat ? `, weakest in ${statDef(R.lowCat).label.toLowerCase()} (${ordinal(R.place[R.lowCat] ?? c.n)})` : ''}`);
  else {
    parts.push(`${ordinal(R.rank)} of ${c.n} with ${fmtPts(R.agg.points)} points (league average ${fmtPts(c.mean)})`);
    if (R.effPct != null) parts.push(`lineups at ${pct(R.effPct)} of the best possible${c.lgPct != null ? ` (league ${pct(c.lgPct)})` : ''}`);
    if (R.expected > 0) { const d = Math.round((R.agg.points / R.expected - 1) * 100); parts.push(d === 0 ? 'right on what the starters’ games projected' : `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} what the starters’ games projected (${fmtPts(R.expected)})`); }
  }
  if (R.g && R.g.res !== 'bye' && R.g.opp != null) {
    const o = c.team(R.g.opp)?.gm_name ?? 'the opponent';
    const sc = `${c.catMode ? Math.round(R.g.mine) : fmtPts(R.g.mine)}–${c.catMode ? Math.round(R.g.theirs ?? 0) : fmtPts(R.g.theirs ?? 0)}`;
    parts.push(R.g.res === 'W' ? `beat ${o} ${sc}` : R.g.res === 'L' ? `lost to ${o} ${sc}` : R.g.res === 'T' ? `tied ${o} ${sc}` : `${sc} against ${o} so far`);
  }
  if (R.before != null && R.after != null && R.before !== R.after) parts.push(`${R.after < R.before ? 'up' : 'down'} ${Math.abs(R.before - R.after)} to ${ordinal(R.after)} in the standings`);
  return parts.join('; ') + '.';
}

function Move({ R }: { R: Row }) {
  if (R.before == null || R.after == null) return null;
  const d = R.before - R.after;
  if (!d) return <> · held {ordinal(R.after)} overall</>;
  return <> · <span className={d > 0 ? 'text-emerald-300' : 'text-rose-300'}>{d > 0 ? `▲${d}` : `▼${-d}`} to {ordinal(R.after)}</span> overall</>;
}
function H2HLine({ g, team }: { g: NonNullable<Row['g']>; team: (id: number) => Team | undefined }) {
  if (g.res === 'bye' || g.opp == null) return <> · bye</>;
  const cls = g.res === 'W' ? 'text-emerald-300' : g.res === 'L' ? 'text-rose-300' : 'text-slate-300';
  return <> · <span className={cls}>{g.res === 'live' ? 'v' : g.res}</span> {g.res === 'live' ? '' : 'v '}{team(g.opp)?.gm_name}</>;
}

function GradeChip({ g }: { g: string }) {
  const ring = g.startsWith('A') ? 'ring-emerald-400/40 bg-emerald-400/10' : g.startsWith('B') ? 'ring-sky-400/40 bg-sky-400/10' : g.startsWith('C') ? 'ring-amber-400/40 bg-amber-400/10' : 'ring-rose-400/40 bg-rose-400/10';
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-base font-extrabold ring-1 ring-inset ${ring} ${gradeColor(g)}`}>{g}</span>;
}

function Tile({ label, value, sub, cls = '' }: { label: string; value: ReactNode; sub?: ReactNode; cls?: string }) {
  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.04] px-2.5 py-2">
      <div className="label">{label}</div>
      <div className={`num font-display text-xl font-extrabold leading-tight ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] leading-snug text-mute">{sub}</div>}
    </div>
  );
}

function Highlight({ icon, label, t, value }: { icon: ReactNode; label: string; t?: Team; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[.06] bg-gradient-to-b from-white/[.06] to-white/[.02] px-2 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-mute">{icon}<span className="min-w-0">{label}</span></div>
      <div className="mt-1.5 flex items-center gap-1.5"><TeamBadge team={t} size={22} /><span className="min-w-0 break-words text-xs font-bold leading-tight">{t?.gm_name}</span></div>
      <div className="num mt-1 text-xs font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function Performers({ R, catMode }: { R: Row; catMode: boolean }) {
  const { players } = useLeague();
  if (catMode) {
    // a category league: who led the team in its best category
    const k = R.topCat;
    if (!k || ['gaa', 'svp'].includes(k)) return null;
    const lead = [...R.pp].filter((r) => r.started > 0 && GOALIE_KEYS.has(k) === (players.get(r.player_id)?.pos === 'G')).sort((a, b) => catVal(b.stats, k) - catVal(a.stats, k))[0];
    const p = lead && players.get(lead.player_id);
    if (!p || !catVal(lead.stats, k)) return null;
    return <PerfCard p={p} label={`Led the team in ${statDef(k).label.toLowerCase()}`} value={fmtCat(k, catVal(lead.stats, k))} sub={`${lead.started} start${lead.started === 1 ? '' : 's'}`} tone="good" />;
  }
  if (!R.best && !R.cold) return null;
  const bp = R.best && players.get(R.best.player_id), cp = R.cold && players.get(R.cold.r.player_id);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {bp && R.best && <PerfCard p={bp} label="Best performer" value={`${fmtPts(R.best.points)} pts`} sub={`${R.best.started} start${R.best.started === 1 ? '' : 's'}${R.best.started ? ` · ${fmtPts(R.best.points / R.best.started)} a game` : ''}`} tone="good" />}
      {cp && R.cold && <PerfCard p={cp} label="Coldest" value={`${fmtPts(R.cold.r.points)} pts`} sub={`${R.cold.r.started} starts · ${fmtPts(-R.cold.miss)} under his projection`} tone="bad" />}
    </div>
  );
}
function PerfCard({ p, label, value, sub, tone }: { p: Player; label: string; value: string; sub: string; tone: 'good' | 'bad' }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${tone === 'good' ? 'border-emerald-400/20 bg-emerald-400/[.05]' : 'border-sky-400/20 bg-sky-400/[.05]'}`}>
      <Headshot p={p} size={36} />
      <div className="min-w-0 flex-1">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${tone === 'good' ? 'text-emerald-300' : 'text-sky-300'}`}>{tone === 'good' ? '🔥' : '🧊'} {label}</div>
        <div className="text-sm leading-tight"><PlayerTag p={p} /> <span className="text-[11px] text-mute">{p.pos} · {p.nhl_team}</span></div>
        <div className="text-[11px] text-mute">{sub}</div>
      </div>
      <div className="num shrink-0 font-display text-lg font-extrabold">{value}</div>
    </div>
  );
}

function TipRow({ tip }: { tip: Tip }) {
  const k = KIND[tip.kind];
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3 py-2 ${TONE[tip.tone]}`}>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-black/25 text-sm">{k.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-mute">{k.label}</div>
        <div className="text-sm font-semibold leading-snug text-slate-100">{tip.title}</div>
        <div className="mt-0.5 text-xs leading-snug text-slate-300">{tip.why}</div>
        {tip.to && <Link to={tip.to.href} className="mt-1 inline-block text-xs font-semibold text-sky-300">{tip.to.label} ›</Link>}
      </div>
    </div>
  );
}
