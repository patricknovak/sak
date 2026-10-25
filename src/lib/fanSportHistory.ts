// The other leagues' history, read (25 October 2026): nhl-hub's fan-sport-history brings every club's seasons since
// ESPN's tables begin (the record, the points, the place, the seed, how the spring went) and the champions; the titles
// before that are settled history in src/data/leagueTitles.ts. This file turns them into what the page draws: the
// trophy shelf, the totals, the eras, the facts a fan quotes and the league's champions in order. Pure, tested in
// supabase/tests/fan-sport.test.mjs.
import { FOUNDED, TITLES, countsAsTitle, type TitleRow } from '../data/leagueTitles.ts';
import type { Sport } from './fanSport.ts';
import { rankWord } from './fanZone.ts';

export interface HistRow {
  year: number; team: string; name: string; w: number; l: number; d: number; pf: number; pa: number; pts: number | null; rank: number | null; seed: number | null;
  div: string | null; divRank: number | null; conf: string | null; po: { w: number; l: number; round: number; won: boolean } | null; note: string | null;
}
export interface SportHistory { league: string; sport: Sport; from: number; to: number; clubs: Record<string, HistRow[]>; champions: { year: number; champ: string | null; runner: string | null; champName: string | null }[]; at: string; stale?: boolean }

// a season's label in the league's own words: the NFL's by its start, the NBA's and the Premier League's across two years
export const seasonLabel = (_league: string, sport: Sport, year: number) => (sport === 'football' ? String(year) : sport === 'basketball' ? `${year - 1}-${String(year).slice(2)}` : `${year}-${String(year + 1).slice(2)}`);
const ROUNDS: Record<Sport, string[]> = {
  football: ['', 'Lost in the wild-card round', 'Lost in the divisional round', 'Lost the conference championship', 'Lost the Super Bowl', 'Won the Super Bowl'],
  basketball: ['', 'Lost in the first round', 'Lost in the second round', 'Lost the conference finals', 'Lost the Finals', 'Won the title'],
  soccer: [],
};
// how the season ended, in a line
export function springOf(sport: Sport, r: HistRow): string {
  if (sport === 'soccer') return r.rank === 1 ? 'Champions' : r.note ? r.note : r.rank != null ? `${rankWord(r.rank)} in the table` : 'In the table';
  if (!r.po) return 'Missed the playoffs';
  return ROUNDS[sport][Math.min(5, Math.max(1, r.po.round))] ?? 'Made the playoffs';
}
export const won = (sport: Sport, r: HistRow) => (sport === 'soccer' ? r.rank === 1 : !!r.po?.won);
export const madeIt = (sport: Sport, r: HistRow) => (sport === 'soccer' ? (r.rank ?? 99) <= 4 : !!r.po);
export const inFinal = (sport: Sport, r: HistRow) => (sport === 'soccer' ? (r.rank ?? 99) <= 2 : (r.po?.round ?? 0) >= 4);
export const pct = (r: HistRow) => { const g = r.w + r.l + r.d; return g ? (r.w + r.d / 2) / g : 0; };
export const recordOf = (sport: Sport, r: HistRow) => (sport === 'soccer' ? `${r.w}-${r.d}-${r.l}` : `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`);

// the titles: the data's champions and the settled ones before it, newest first
export interface Titles { what: string; one: string; years: TitleRow[]; count: number; finals: number }
export function titlesOf(h: SportHistory | null, league: string, code: string): Titles {
  const t = TITLES[league] ?? { what: 'titles', one: 'title', rows: [] };
  const before = t.rows.filter((r) => r.club === code && countsAsTitle(league, r));
  const from = h?.from ?? Infinity;
  const fromData = (h?.champions ?? []).filter((c) => c.champ === code).map((c): TitleRow => ({ year: c.year, club: code }));
  const years = [...before.filter((r) => r.year < from), ...fromData].sort((a, b) => a.year - b.year);
  const finals = (h?.clubs[code] ?? []).filter((r) => inFinal(h!.sport, r)).length;
  return { what: t.what, one: t.one, years, count: years.length, finals };
}
export const foundedOf = (league: string, code: string) => FOUNDED[league]?.[code] ?? null;

export interface Totals { seasons: number; w: number; l: number; d: number; pct: number; pf: number; pa: number; playoffs: number; finals: number; titles: number; best: HistRow | null; worst: HistRow | null }
export function totals(sport: Sport, rows: HistRow[]): Totals | null {
  if (!rows.length) return null;
  const w = rows.reduce((t, r) => t + r.w, 0), l = rows.reduce((t, r) => t + r.l, 0), d = rows.reduce((t, r) => t + r.d, 0);
  const sorted = [...rows].sort((a, b) => pct(b) - pct(a) || (b.pts ?? 0) - (a.pts ?? 0));
  return { seasons: rows.length, w, l, d, pct: w + l + d ? (w + d / 2) / (w + l + d) : 0, pf: rows.reduce((t, r) => t + r.pf, 0), pa: rows.reduce((t, r) => t + r.pa, 0),
    playoffs: rows.filter((r) => madeIt(sport, r)).length, finals: rows.filter((r) => inFinal(sport, r)).length, titles: rows.filter((r) => won(sport, r)).length,
    best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null };
}

// the seasons in eras of a decade each (the NFL's by its season start: the 2000s are 2002 to 2009)
export interface Era { name: string; from: number; to: number; seasons: number; pct: number; playoffs: number; finals: number; titles: number; best: HistRow }
export function eras(sport: Sport, rows: HistRow[]): Era[] {
  const by = new Map<number, HistRow[]>();
  for (const r of rows) { const d = Math.floor((sport === 'basketball' ? r.year - 1 : r.year) / 10) * 10; (by.get(d) ?? by.set(d, []).get(d)!).push(r); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([d, rs]) => {
    const w = rs.reduce((t, r) => t + r.w, 0), l = rs.reduce((t, r) => t + r.l, 0), dr = rs.reduce((t, r) => t + r.d, 0);
    return { name: `The ${d}s`, from: rs[0].year, to: rs[rs.length - 1].year, seasons: rs.length, pct: w + l + dr ? (w + dr / 2) / (w + l + dr) : 0,
      playoffs: rs.filter((r) => madeIt(sport, r)).length, finals: rs.filter((r) => inFinal(sport, r)).length, titles: rs.filter((r) => won(sport, r)).length,
      best: [...rs].sort((a, b) => pct(b) - pct(a))[0] };
  });
}

// the longest run of springs and the longest wait
export function runs(sport: Sport, rows: HistRow[]) {
  let streak = 0, best = 0, bestEnd = 0, drought = 0, worst = 0, droughtEnd = 0, current = 0;
  for (const r of rows) {
    if (madeIt(sport, r)) { streak++; drought = 0; if (streak > best) { best = streak; bestEnd = r.year; } } else { drought++; streak = 0; if (drought > worst) { worst = drought; droughtEnd = r.year; } }
  }
  current = madeIt(sport, rows[rows.length - 1] ?? { po: null, rank: null } as HistRow) ? streak : -drought;
  return { best, bestEnd, worst, droughtEnd, current };
}

// the numbers a fan quotes, counted from the seasons so they stay true as the seasons go on
export function facts(h: SportHistory, league: string, code: string, name: string): string[] {
  const rows = h.clubs[code] ?? [];
  const sport = h.sport;
  const out: string[] = [];
  const S = (y: number) => seasonLabel(league, sport, y);
  const t = titlesOf(h, league, code);
  const founded = foundedOf(league, code);
  if (founded) out.push(`Founded in ${founded}${t.count ? `; ${t.count} ${t.count === 1 ? t.one : t.what} since, the last in ${S(t.years[t.years.length - 1].year)}` : ', and still waiting for a first title'}.`);
  if (!rows.length) return out;
  const tot = totals(sport, rows)!;
  const unit = sport === 'soccer' ? 'matches' : 'games';
  out.push(`Since ${S(h.from)}: ${tot.w.toLocaleString()} ${unit} won, ${tot.l.toLocaleString()} lost${tot.d ? `, ${tot.d} drawn` : ''} (${(tot.pct * 100).toFixed(1)}%), ${sport === 'soccer' ? `${tot.playoffs} top-four finish${tot.playoffs === 1 ? '' : 'es'}` : `${tot.playoffs} playoff season${tot.playoffs === 1 ? '' : 's'}`} in ${tot.seasons}.`);
  if (tot.best) out.push(`The best season in the data: ${S(tot.best.year)}, ${recordOf(sport, tot.best)}${tot.best.pts != null ? ` and ${tot.best.pts} points` : ''}. ${springOf(sport, tot.best)}.`);
  if (tot.worst && tot.worst !== tot.best) out.push(`The low point: ${S(tot.worst.year)}, ${recordOf(sport, tot.worst)}${tot.worst.pts != null ? ` and ${tot.worst.pts} points` : ''}.`);
  const most = [...rows].sort((a, b) => b.pf - a.pf)[0], fewest = [...rows].sort((a, b) => a.pa - b.pa)[0];
  if (most) out.push(`Most ${sport === 'soccer' ? 'goals' : 'points'} in a season: ${most.pf.toLocaleString()} in ${S(most.year)}${most.w + most.l + most.d ? `, ${(most.pf / (most.w + most.l + most.d)).toFixed(1)} a ${sport === 'soccer' ? 'match' : 'game'}` : ''}.`);
  if (fewest) out.push(`Stingiest season: ${fewest.pa.toLocaleString()} ${sport === 'soccer' ? 'conceded' : 'allowed'} in ${S(fewest.year)}.`);
  const r = runs(sport, rows);
  if (r.best >= 3) out.push(`The longest run of ${sport === 'soccer' ? 'top-four finishes' : 'playoff seasons'}: ${r.best} straight, ending ${S(r.bestEnd)}.`);
  if (r.worst >= 3) out.push(`The longest wait: ${r.worst} seasons ${sport === 'soccer' ? 'outside the top four' : 'without the playoffs'}, through ${S(r.droughtEnd)}.`);
  if (r.current >= 2) out.push(`${sport === 'soccer' ? 'In the top four' : 'In the playoffs'} ${r.current} seasons running.`);
  if (r.current <= -3) out.push(`${-r.current} seasons since the last ${sport === 'soccer' ? 'top-four finish' : 'playoff appearance'}.`);
  const finals = rows.filter((x) => inFinal(sport, x));
  if (finals.length) out.push(`${finals.length} ${sport === 'football' ? 'Super Bowl' : sport === 'basketball' ? 'Finals' : 'top-two finish'}${finals.length === 1 ? '' : sport === 'basketball' ? '' : sport === 'football' ? 's' : 'es'} since ${S(h.from)}: ${finals.map((x) => `${S(x.year)}${won(sport, x) ? ' 🏆' : ''}`).join(', ')}.`);
  if (sport !== 'soccer') {
    const divs = rows.filter((x) => x.divRank === 1).length;
    if (divs) out.push(`${divs} division title${divs === 1 ? '' : 's'} in ${rows.length} seasons.`);
    const ones = rows.filter((x) => x.seed === 1).length;
    if (ones) out.push(`The top seed in the conference ${ones} time${ones === 1 ? '' : 's'}: ${rows.filter((x) => x.seed === 1).map((x) => S(x.year)).join(', ')}.`);
    const po = rows.filter((x) => x.po);
    const pw = po.reduce((a, x) => a + x.po!.w, 0), pl = po.reduce((a, x) => a + x.po!.l, 0);
    if (pw + pl) out.push(`In the playoffs since ${S(h.from)}: ${pw}-${pl}${sport === 'basketball' ? ' in games' : ''}.`);
  } else {
    const rel = rows.filter((x) => /relegat/i.test(x.note ?? '')).length;
    if (rel) out.push(`Relegated ${rel} time${rel === 1 ? '' : 's'} since ${S(h.from)}: ${rows.filter((x) => /relegat/i.test(x.note ?? '')).map((x) => S(x.year)).join(', ')}.`);
    const seasonsIn = rows.length, all = h.to - h.from + 1;
    if (seasonsIn < all) out.push(`${seasonsIn} of the last ${all} seasons in the Premier League.`);
    const champs = rows.filter((x) => x.rank === 1);
    if (champs.length) out.push(`Champions ${champs.length} time${champs.length === 1 ? '' : 's'} in the data: ${champs.map((x) => S(x.year)).join(', ')}.`);
    const europe = rows.filter((x) => /champions league|europa|conference/i.test(x.note ?? '')).length;
    if (europe) out.push(`Qualified for Europe ${europe} time${europe === 1 ? '' : 's'} since ${S(h.from)}.`);
  }
  if (!t.count && founded) out.push(`${name} ${sport === 'soccer' ? 'have' : 'have'} never won the ${sport === 'football' ? 'Super Bowl' : sport === 'basketball' ? 'NBA title' : 'English title'}.`);
  return out;
}

// the league's champions in order, the settled ones before the data: newest first
export function champions(h: SportHistory | null, league: string, nameOf: (code: string | null, name?: string) => string) {
  const t = TITLES[league];
  const from = h?.from ?? Infinity;
  const before = (t?.rows ?? []).filter((r) => countsAsTitle(league, r) && !r.label?.includes('championship') && r.year < from);
  const list = [...before.map((r) => ({ year: r.year, club: r.club, name: nameOf(r.club, r.name), label: r.label ?? null })),
    ...(h?.champions ?? []).map((c) => ({ year: c.year, club: c.champ, name: c.champ ? nameOf(c.champ, c.champName ?? undefined) : c.champName ?? 'Unknown', label: null }))];
  return list.sort((a, b) => b.year - a.year);
}
// who has won the most, all time (the data and the settled lists together)
export function mostTitles(h: SportHistory | null, league: string) {
  const by = new Map<string, number>();
  const t = TITLES[league];
  const from = h?.from ?? Infinity;
  for (const r of t?.rows ?? []) if (r.club && countsAsTitle(league, r) && r.year < from) by.set(r.club, (by.get(r.club) ?? 0) + 1);
  for (const c of h?.champions ?? []) if (c.champ) by.set(c.champ, (by.get(c.champ) ?? 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}
