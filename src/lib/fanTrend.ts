// How a club is trending (7 November 2026, Patrick: the fan zone shows how the team has done over the last two weeks and
// the last month). Each window is the games played in it, read the way the club's table reads it (points in hockey, three
// for a win in soccer, wins elsewhere), set against the club's whole season and the same stretch before it. In the other
// leagues every club's games are on hand, so each window is ranked across the league too; the NHL's zone has its own
// club's schedule only.
import { gamesOf, type Sport, type SportLeague } from './fanSport';
import type { FanData } from './fanZone';
import { etCalendarToday } from './format';

export type TrendKind = 'hockey' | 'soccer' | 'other';
export type TrendRes = 'W' | 'L' | 'D' | 'OTL';
export interface TrendGame { date: string; opp: string; home: boolean; us: number; them: number; res: TrendRes }
export interface TrendLine { gp: number; w: number; l: number; d: number; otl: number; pts: number; pct: number; gf: number; ga: number; margin: number }
export type TrendTone = 'hot' | 'cold' | 'steady' | 'quiet';
export interface TrendWindow extends TrendLine {
  days: number; games: TrendGame[]; before: TrendLine | null; vsSeason: number; vsBefore: number | null; tone: TrendTone;
  rank: number | null; of: number | null;
}
export interface Trend { kind: TrendKind; season: TrendLine; two: TrendWindow; month: TrendWindow; head: string; tone: TrendTone; read: string; offseason: boolean; anchor: string }

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const etDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso
  : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)));

export function lineOf(gs: TrendGame[], kind: TrendKind): TrendLine {
  const n = gs.length, c = (r: TrendRes) => gs.filter((g) => g.res === r).length;
  const w = c('W'), l = c('L'), d = c('D'), otl = c('OTL');
  const pts = kind === 'hockey' ? 2 * w + otl : kind === 'soccer' ? 3 * w + d : w + d / 2;
  const of = kind === 'hockey' ? 2 * n : kind === 'soccer' ? 3 * n : n;
  const gf = n ? gs.reduce((t, g) => t + g.us, 0) / n : 0, ga = n ? gs.reduce((t, g) => t + g.them, 0) / n : 0;
  return { gp: n, w, l, d, otl, pts, pct: of ? pts / of : 0, gf, ga, margin: gf - ga };
}

// a stretch is read only once it has a few games in it; a short one needs a bigger swing to count
const MIN_GAMES: Record<TrendKind, number> = { hockey: 3, soccer: 2, other: 2 };
const toneOf = (w: TrendLine, season: TrendLine, kind: TrendKind): TrendTone => {
  if (w.gp < MIN_GAMES[kind] || season.gp < w.gp + 2) return 'quiet';
  const gap = w.gp >= 6 ? 0.08 : 0.12, diff = w.pct - season.pct;
  return diff >= gap ? 'hot' : diff <= -gap ? 'cold' : 'steady';
};

function windowOf(all: TrendGame[], kind: TrendKind, anchor: string, days: number, season: TrendLine): TrendWindow {
  const from = addDays(anchor, -days), prev = addDays(anchor, -2 * days);
  const games = all.filter((g) => g.date > from && g.date <= anchor);
  const pre = all.filter((g) => g.date > prev && g.date <= from);
  const ln = lineOf(games, kind), before = pre.length ? lineOf(pre, kind) : null;
  return { ...ln, days, games, before, vsSeason: ln.pct - season.pct, vsBefore: before ? ln.pct - before.pct : null, tone: toneOf(ln, season, kind), rank: null, of: null };
}

const HEADS: Record<string, string> = {
  'hot/hot': 'Red hot', 'cold/cold': 'In a slump',
  'hot/steady': 'Heating up', 'hot/cold': 'Turning it around', 'hot/quiet': 'Heating up',
  'cold/steady': 'Cooling off', 'cold/hot': 'Cooling off', 'cold/quiet': 'Cooling off',
  'steady/hot': 'Still rolling', 'steady/cold': 'Steadying', 'quiet/hot': 'A good month', 'quiet/cold': 'A rough month',
};

export const recordWord = (x: TrendLine, kind: TrendKind) => (kind === 'hockey' ? `${x.w}-${x.l}-${x.otl}` : kind === 'soccer' ? `${x.w}-${x.d}-${x.l}` : `${x.w}-${x.l}${x.d ? `-${x.d}` : ''}`);

export function trendOf(all: TrendGame[], kind: TrendKind, noun = 'game', today = etCalendarToday()): Trend | null {
  const played = [...all].sort((a, b) => a.date.localeCompare(b.date));
  if (!played.length) return null;
  const last = played[played.length - 1].date;
  // between seasons the windows are the season's last two weeks and month, not an empty calendar
  const offseason = last < addDays(today, -30);
  const anchor = offseason ? last : today;
  const season = lineOf(played, kind);
  const two = windowOf(played, kind, anchor, 14, season), month = windowOf(played, kind, anchor, 30, season);
  if (!month.gp) return null;
  const tone = two.tone !== 'quiet' ? two.tone : month.tone;
  const head = HEADS[`${two.tone}/${month.tone}`] ?? (two.tone === 'quiet' && month.tone === 'quiet' ? 'A quiet stretch' : 'Playing to form');
  const rate = kind === 'hockey' ? 'points' : kind === 'soccer' ? 'points' : 'wins';
  const pace = (x: TrendLine) => (kind === 'hockey' ? ` (a ${Math.round(x.pct * 164)}-point pace)` : '');
  const by = (m: number) => (Math.abs(m) < 0.05 ? 'level with their opponents' : m > 0 ? `outscoring teams by ${m.toFixed(1)} a ${noun}` : `outscored by ${(-m).toFixed(1)} a ${noun}`);
  const pick = two.gp >= MIN_GAMES[kind] ? two : month;
  const span = pick === two ? (offseason ? 'the season’s last two weeks' : 'the last two weeks') : offseason ? 'the season’s last month' : 'the last month';
  const read = `${recordWord(pick, kind)} over ${span} (${pick.gp} ${pick.gp === 1 ? noun : `${noun}s`}), taking ${Math.round(pick.pct * 100)}% of the ${rate}${pace(pick)} against ${Math.round(season.pct * 100)}% all season, ${by(pick.margin)}.`
    + (pick === two && month.gp > two.gp ? ` Over the month: ${recordWord(month, kind)}, ${Math.round(month.pct * 100)}%.` : '');
  return { kind, season, two, month, head, tone, read, offseason, anchor };
}

// ── the NHL's zone: the club's own schedule
export function trendOfNhl(d: FanData, today?: string): Trend | null {
  const gs = (d.schedule ?? []).filter((g) => (g.state === 'OFF' || g.state === 'FINAL') && (g.type == null || g.type === 2) && g.hs != null && g.as != null)
    .map((g): TrendGame => {
      const home = g.home === d.abbrev, us = (home ? g.hs : g.as) ?? 0, them = (home ? g.as : g.hs) ?? 0;
      return { date: g.date, opp: home ? g.away : g.home, home, us, them, res: us > them ? 'W' : g.outcome && g.outcome !== 'REG' ? 'OTL' : 'L' };
    });
  return trendOf(gs, 'hockey', 'game', today);
}

// ── the other leagues: every club's games, so each window is ranked across the league
const kindOf = (s: Sport): TrendKind => (s === 'soccer' ? 'soccer' : 'other');
function clubGames(l: SportLeague): Map<string, TrendGame[]> {
  const by = new Map<string, TrendGame[]>();
  for (const g of gamesOf(l).played) {
    const date = etDate(g.at);
    for (const [code, home] of [[g.home, true], [g.away, false]] as const) {
      const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      const row: TrendGame = { date, opp: home ? g.away : g.home, home, us, them, res: us > them ? 'W' : us < them ? 'L' : 'D' };
      (by.get(code) ?? by.set(code, []).get(code)!).push(row);
    }
  }
  return by;
}
const trendCache = new WeakMap<SportLeague, Map<string, Trend | null>>();
export function trendOfSport(l: SportLeague, code: string, noun: string, today?: string): Trend | null {
  let all = trendCache.get(l);
  if (!all) {
    all = new Map();
    const kind = kindOf(l.sport);
    for (const [c, gs] of clubGames(l)) all.set(c, trendOf(gs, kind, noun, today));
    // each window ranked by its share of the table's points, then the margin; a club with no games in it isn't ranked
    for (const w of ['two', 'month'] as const) {
      const rows = [...all.values()].filter((t): t is Trend => !!t && t[w].gp > 0).sort((a, b) => b[w].pct - a[w].pct || b[w].margin - a[w].margin);
      rows.forEach((t, i) => {
        const prev = rows[i - 1];
        t[w].rank = prev && prev[w].pct === t[w].pct && prev[w].margin === t[w].margin ? prev[w].rank : i + 1;
        t[w].of = rows.length;
      });
    }
    trendCache.set(l, all);
  }
  return all.get(code) ?? null;
}
