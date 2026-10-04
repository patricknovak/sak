// Performance: the points that counted, every day, every category, every team. A GM reviews last night or any
// stretch of the season for their own team or the whole league, category by category, and reads what the
// numbers say: where the team is strong, where it leaks, how steady it is and what was left on the bench.
// Everything here comes from the puck-drop freeze-frames and the box scores, the same rows the standings count.
import { useEffect, useMemo, useState } from 'react';
import { useSticky } from '../lib/sticky';
import { Link } from 'react-router-dom';
import { useLeague, useSport } from '../lib/store';
import { isLive } from '../lib/sport';
import { rpc } from '../lib/supabase';
import { fmtDate, fmtPts, readable } from '../lib/format';
import { Headshot, PageHeader, Pos, Section, Stat, TeamBadge } from '../components/ui';
import { PointsRace, Sparkline } from '../components/charts';
import { statDef } from '../lib/playerstats';
import { categoryOf } from '../lib/categories';
import { BarChart3 } from 'lucide-react';

type Day = { team_id: number; date: string; game_type: number; points: number; bench: number; goalie_points: number; starters: number; benched: number; stats: Record<string, number>; bench_stats: Record<string, number> };
type PP = { team_id: number; player_id: number; started: number; benched: number; points: number; bench: number; stats: Record<string, number> };
// a team's night against the best lineup it could have played from the same players (lineup_efficiency)
type Eff = { team_id: number; date: string; game_type: number; points: number; best: number };
type RangeKey = 'last' | '7' | '14' | '30' | 'season' | 'custom';
const RANGES: { k: RangeKey; label: string }[] = [
  { k: 'last', label: 'Last night' }, { k: '7', label: '7 days' }, { k: '14', label: '14 days' }, { k: '30', label: '30 days' }, { k: 'season', label: 'Season' }, { k: 'custom', label: 'Custom' },
];
// the categories in the order the box-score lines use them; only the ones the league scores are shown
const SKATER = ['g', 'a', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow'];
const GOALIE = ['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'];

const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const num = (o: Record<string, number> | null | undefined, k: string) => Number(o?.[k] ?? 0);
const fmtCat = (k: string, v: number) => {
  if (!Number.isFinite(v)) return '–';
  const rate = categoryOf(k)?.rate;
  if (rate === 'pct') return v.toFixed(3).replace(/^0/, '');
  if (rate === 'avg') return v.toFixed(2);
  return k === 'pm' && v > 0 ? `+${v}` : String(Math.round(v * 10) / 10);
};
// a category's value from summed box-score stats: a rate from its totals (no starts behind it: no value)
const catVal = (o: Record<string, number> | null | undefined, k: string): number =>
  k === 'gaa' ? (num(o, 'gs') ? num(o, 'ga') / num(o, 'gs') : NaN)
  : k === 'svp' ? (num(o, 'sa') ? num(o, 'sv') / num(o, 'sa') : NaN)
  : k === 'pts' && o?.pts == null ? num(o, 'g') + num(o, 'a') : num(o, k);
const GOALIE_KEYS = new Set([...['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'], 'sa', 'gaa', 'svp']);
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

// one team's totals over a range
interface Agg { team_id: number; points: number; bench: number; goalie: number; days: number; starters: number; cats: Record<string, number>; daily: number[]; dates: string[] }
function aggregate(rows: Day[], teamIds: number[]): Agg[] {
  return teamIds.map((id) => {
    const mine = rows.filter((r) => r.team_id === id).sort((a, b) => a.date.localeCompare(b.date));
    const cats: Record<string, number> = {};
    for (const r of mine) for (const [k, v] of Object.entries(r.stats)) cats[k] = (cats[k] ?? 0) + Number(v);
    return {
      team_id: id, points: mine.reduce((n, r) => n + r.points, 0), bench: mine.reduce((n, r) => n + r.bench, 0), goalie: mine.reduce((n, r) => n + r.goalie_points, 0),
      days: mine.length, starters: mine.reduce((n, r) => n + r.starters, 0), cats, daily: mine.map((r) => r.points), dates: mine.map((r) => r.date),
    };
  });
}
// rank of a value among a list, 1 = best; low numbers win for the categories that hurt
const rankOf = (v: number, all: number[], lowerIsBetter = false) => all.filter((x) => (lowerIsBetter ? x < v : x > v)).length + 1;

export default function Performance() {
  const { me, teams, team, players, league, leagueDay, games } = useLeague();
  const sport = useSport();
  const [rows, setRows] = useState<Day[] | null>(null);
  const [pps, setPps] = useState<PP[]>([]);
  const [effRows, setEffRows] = useState<Eff[]>([]);
  const [range, setRange] = useSticky<RangeKey>('perf:range', 'last');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: addDays(leagueDay, -6), to: leagueDay });
  const [sel, setSel] = useState<number | 'all'>(me?.id ?? 'all');
  const [sortKey, setSortKey] = useSticky<string>('perf:sort', 'pts');
  const [phase, setPhase] = useSticky<2 | 3>('perf:phase', 2);
  const gmTeams = useMemo(() => teams.filter((t) => t.role === 'gm'), [teams]);

  // the whole season once; ranges are sliced here
  useEffect(() => {
    rpc<Day[]>('performance_days', { p_from: null, p_to: leagueDay })
      .then((d) => setRows(d.map((r) => ({ ...r, points: Number(r.points), bench: Number(r.bench), goalie_points: Number(r.goalie_points) }))), () => setRows([]));
    rpc<Eff[]>('lineup_efficiency', { p_from: null, p_to: leagueDay })
      .then((d) => setEffRows(d.map((r) => ({ ...r, points: Number(r.points), best: Number(r.best) }))), () => setEffRows([]));
  }, [leagueDay]);
  const playoffsToo = useMemo(() => (rows ?? []).some((r) => r.game_type === 3), [rows]);
  const scored = useMemo(() => (rows ?? []).filter((r) => r.game_type === phase), [rows, phase]);
  const allDates = useMemo(() => [...new Set(scored.map((r) => r.date))].sort(), [scored]);
  // "last night" is the latest league day with box scores; while games are on it is tonight so far
  const lastNight = allDates[allDates.length - 1] ?? leagueDay;
  const tonightLive = lastNight === leagueDay && games.some((g) => g.date === leagueDay && isLive(sport, g.state));
  const [from, to] = useMemo((): [string, string] => {
    if (range === 'last') return [lastNight, lastNight];
    if (range === 'custom') return [custom.from <= custom.to ? custom.from : custom.to, custom.to >= custom.from ? custom.to : custom.from];
    if (range === 'season') return [allDates[0] ?? lastNight, lastNight];
    return [addDays(lastNight, 1 - Number(range)), lastNight];
  }, [range, custom, lastNight, allDates]);
  const inRange = useMemo(() => scored.filter((r) => r.date >= from && r.date <= to), [scored, from, to]);
  const dates = useMemo(() => [...new Set(inRange.map((r) => r.date))].sort(), [inRange]);

  useEffect(() => {
    if (!rows) return;
    rpc<PP[]>('performance_players', { p_from: from, p_to: to, p_team: null })
      .then((d) => setPps(d.map((r) => ({ ...r, points: Number(r.points), bench: Number(r.bench) }))), () => setPps([]));
  }, [rows, from, to]);

  const w = league?.scoring;
  // a category league (rotisserie or head-to-head categories) reads its own categories, ranked team against team over
  // the stretch the way its table is; a points league its scoring's stats and points
  const catMode = !!league?.categories?.length;
  const cats = useMemo(() => (catMode ? league!.categories! : [...SKATER.filter((k) => w?.skater[k]), ...GOALIE.filter((k) => w?.goalie[k] || k === 'sv' || k === 'ga')]), [w, catMode, league?.categories]); // eslint-disable-line react-hooks/exhaustive-deps
  // a category the league scores negatively (PIM, goals against, losses) is one where fewer is better
  const isLow = (k: string) => { if (catMode) return !!categoryOf(k)?.low; const wt = w?.skater[k] ?? w?.goalie[k]; return wt != null && wt !== 0 ? wt < 0 : !!statDef(k).lowerIsBetter; };
  const aggs = useMemo(() => aggregate(inRange, gmTeams.map((t) => t.id)), [inRange, gmTeams]);
  // lineup efficiency over the range: what the lineups scored against the best they could have, and the night that
  // cost the most
  const eff = useMemo(() => {
    const m = new Map<number, { points: number; best: number; worst: Eff | null }>();
    for (const r of effRows) {
      if (r.game_type !== phase || r.date < from || r.date > to) continue;
      const e = m.get(r.team_id) ?? { points: 0, best: 0, worst: null };
      e.points += r.points; e.best += r.best;
      if (r.best - r.points > 0.05 && (!e.worst || r.best - r.points > e.worst.best - e.worst.points)) e.worst = r;
      m.set(r.team_id, e);
    }
    return m;
  }, [effRows, phase, from, to]);
  // rotisserie points over the stretch: in each category first earns as many as there are teams, last one, ties share
  // (a rate with nothing behind it is last), as category_standings counts the season
  const roto = useMemo(() => {
    const out = new Map<number, { total: number; place: Record<string, number> }>(aggs.map((a) => [a.team_id, { total: 0, place: {} }]));
    if (!catMode) return out;
    const n = aggs.length;
    for (const k of cats) {
      const vals = aggs.map((a) => ({ id: a.team_id, v: catVal(a.cats, k) }));
      const better = (x: number, y: number) => (!Number.isFinite(y) ? Number.isFinite(x) : Number.isFinite(x) && (isLow(k) ? x < y : x > y));
      for (const me of vals) {
        const ahead = vals.filter((o) => better(o.v, me.v)).length;
        const tied = vals.filter((o) => o.v === me.v || (!Number.isFinite(o.v) && !Number.isFinite(me.v))).length;
        const e = out.get(me.id)!;
        e.total += n + 1 - (ahead + 1 + (tied - 1) / 2);
        e.place[k] = ahead + 1;
      }
    }
    return out;
  }, [aggs, cats, catMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const effPct = (id: number) => { const e = eff.get(id); return e && e.best > 0 ? e.points / e.best : null; };
  const bestOf = useMemo(() => new Map(effRows.filter((r) => r.game_type === phase).map((r) => [`${r.team_id}:${r.date}`, r.best])), [effRows, phase]);
  const sorted = useMemo(() => [...aggs].sort((a, b) => {
    // a category league has no points columns: a sort left on one of them falls back to the roto order
    if (sortKey === 'pts' || (catMode && ['avg', 'bench', 'eff'].includes(sortKey))) return catMode ? (roto.get(b.team_id)?.total ?? 0) - (roto.get(a.team_id)?.total ?? 0) : b.points - a.points;
    if (sortKey === 'avg') return (b.days ? b.points / b.days : 0) - (a.days ? a.points / a.days : 0);
    if (sortKey === 'bench') return b.bench - a.bench;
    if (sortKey === 'eff') return (effPct(b.team_id) ?? -1) - (effPct(a.team_id) ?? -1);
    const x = catVal(a.cats, sortKey), y = catVal(b.cats, sortKey);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.isFinite(x) ? -1 : Number.isFinite(y) ? 1 : 0;
    return isLow(sortKey) ? x - y : y - x;
  }), [aggs, sortKey, w, eff]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = useMemo(() => Object.fromEntries(['pts', 'avg', 'bench', 'eff', ...cats].map((k) => {
    const vals = aggs.map((a) => k === 'pts' ? (catMode ? roto.get(a.team_id)?.total ?? 0 : a.points) : k === 'avg' ? (a.days ? a.points / a.days : 0) : k === 'bench' ? -a.bench : k === 'eff' ? effPct(a.team_id) ?? 0 : isLow(k) ? -catVal(a.cats, k) : catVal(a.cats, k));
    return [k, Math.max(...vals.filter(Number.isFinite))];
  })), [aggs, cats, w, eff, roto]); // eslint-disable-line react-hooks/exhaustive-deps
  const leagueAvg = (f: (a: Agg) => number) => { const xs = aggs.map(f).filter(Number.isFinite); return xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : NaN; };
  // rank of every team on every day in the range, for the day-by-day table and the streaks
  const dayRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dates) {
      const day = inRange.filter((r) => r.date === d).sort((a, b) => b.points - a.points);
      day.forEach((r, i) => m.set(`${r.team_id}:${d}`, i + 1));
    }
    return m;
  }, [inRange, dates]);

  const focus = sel === 'all' ? me?.id ?? gmTeams[0]?.id : sel;
  const mine = aggs.find((a) => a.team_id === focus);
  const myDays = useMemo(() => inRange.filter((r) => r.team_id === focus).sort((a, b) => b.date.localeCompare(a.date)), [inRange, focus]);
  const myPlayers = useMemo(() => pps.filter((p) => p.team_id === focus && players.get(p.player_id)).sort((a, b) => b.points - a.points), [pps, focus, players]);
  const topLeague = useMemo(() => [...pps].filter((p) => players.get(p.player_id)).sort((a, b) => b.points - a.points).slice(0, 10), [pps, players]);

  // what the numbers say about one team, in plain sentences
  const notes = useMemo(() => {
    if (!mine || !mine.days) return [];
    const out: { tone: 'good' | 'bad' | 'info'; text: string }[] = [];
    const t = team(mine.team_id);
    const name = t?.id === me?.id ? 'You' : t?.name ?? 'This team';
    const are = t?.id === me?.id ? 'are' : 'is';
    const pos = catMode ? rankOf(roto.get(mine.team_id)?.total ?? 0, aggs.map((a) => roto.get(a.team_id)?.total ?? 0)) : rankOf(mine.points, aggs.map((a) => a.points));
    // goalie categories only mean something once a goalie has started; an edge has to beat the league average
    const ranks = cats.filter((k) => k !== 'gs' && (!GOALIE_KEYS.has(k) || num(mine.cats, 'gs') > 0))
      .map((k) => ({ k, low: isLow(k), r: rankOf(catVal(mine.cats, k), aggs.map((a) => catVal(a.cats, k)), isLow(k)), v: catVal(mine.cats, k), avg: leagueAvg((a) => catVal(a.cats, k)) }))
      .filter((c) => Number.isFinite(c.v) && Number.isFinite(c.avg) && (c.v !== 0 || c.avg !== 0));
    const edge = ranks.filter((c) => c.r <= 2 && (c.low ? c.v < c.avg : c.v > c.avg)).sort((a, b) => a.r - b.r).slice(0, 3);
    const gap = ranks.filter((c) => c.r >= aggs.length - 1 && (c.low ? c.v > c.avg : c.v < c.avg)).sort((a, b) => b.r - a.r).slice(0, 3);
    const place = `${pos === 1 ? 'first' : `${pos}${['st', 'nd', 'rd'][pos - 1] ?? 'th'}`} of ${aggs.length} over this stretch`;
    out.push({ tone: pos <= 2 ? 'good' : pos >= aggs.length - 1 ? 'bad' : 'info', text: catMode
      ? `${name} ${are} ${place} with ${fmtPts(roto.get(mine.team_id)?.total ?? 0)} ${league?.format === 'h2h' ? 'category points (every team ranked in each category over the stretch)' : 'rotisserie points'} from the league's ${cats.length} categories (most possible ${aggs.length * cats.length}).`
      : `${name} ${are} ${place} with ${fmtPts(mine.points)} points, ${fmtPts(mine.points / mine.days)} a day against a league average of ${fmtPts(leagueAvg((a) => (a.days ? a.points / a.days : 0)))}.` });
    if (edge.length) out.push({ tone: 'good', text: `Edge: ${edge.map((c) => `${statDef(c.k).label.toLowerCase()} (${fmtCat(c.k, c.v)}, league avg ${fmtCat(c.k, c.avg)})`).join(', ')}.` });
    if (gap.length) out.push({ tone: 'bad', text: `Gap: ${gap.map((c) => `${statDef(c.k).label.toLowerCase()} (${fmtCat(c.k, c.v)}, league avg ${fmtCat(c.k, c.avg)})`).join(', ')}.` });
    // the lineup against the best it could have been from the same players, night by night
    // the rest reads fantasy points: a category league stops at its categories
    if (catMode) return out;
    const e = eff.get(mine.team_id), mePct = effPct(mine.team_id);
    if (e && mePct != null) {
      const others = aggs.map((a) => effPct(a.team_id)).filter((x): x is number => x != null);
      const lgPct = others.length ? others.reduce((n, x) => n + x, 0) / others.length : mePct;
      const left = e.best - e.points;
      out.push({ tone: left < 0.05 ? 'good' : mePct >= lgPct ? 'info' : 'bad',
        text: left < 0.05 ? `Perfect lineups: every night the best possible from the players who played.`
          : `Lineups scored ${fmtPts(e.points)} of a possible ${fmtPts(e.best)} (${Math.round(mePct * 100)}%, league ${Math.round(lgPct * 100)}%)${e.worst && mine.days > 1 ? `; the night that cost most was ${fmtDate(e.worst.date)}, ${fmtPts(e.worst.best - e.worst.points)} left out` : ''}.` });
    }
    if (mine.goalie > 0 && mine.points > 0) {
      const share = mine.goalie / mine.points, lg = leagueAvg((a) => (a.points > 0 ? a.goalie / a.points : 0));
      out.push({ tone: 'info', text: `Goalies brought ${Math.round(share * 100)}% of the points (league ${Math.round(lg * 100)}%)${share > lg + 0.1 ? ': a lot riding on the crease' : share < lg - 0.1 ? ': the skaters carry this team' : ''}.` });
    }
    if (mine.days >= 4) {
      const vol = sd(mine.daily), lgVol = leagueAvg((a) => (a.days >= 2 ? sd(a.daily) : 0));
      const hi = Math.max(...mine.daily), lo = Math.min(...mine.daily);
      out.push({ tone: vol <= lgVol ? 'good' : 'info', text: `${vol <= lgVol ? 'Steady' : 'Streaky'}: best day ${fmtPts(hi)} (${fmtDate(mine.dates[mine.daily.indexOf(hi)])}), worst ${fmtPts(lo)} (${fmtDate(mine.dates[mine.daily.indexOf(lo)])}), swing of ±${fmtPts(vol)} a day against the league's ±${fmtPts(lgVol)}.` });
    }
    if (range === 'season' || range === '30' || range === '14') {
      const last7 = mine.daily.slice(-7), before = mine.daily.slice(0, -7);
      if (last7.length >= 3 && before.length >= 3) {
        const a = last7.reduce((n, x) => n + x, 0) / last7.length, b = before.reduce((n, x) => n + x, 0) / before.length;
        const pct = b ? Math.round(((a - b) / b) * 100) : 0;
        if (Math.abs(pct) >= 5) out.push({ tone: pct > 0 ? 'good' : 'bad', text: `Form: the last 7 game days average ${fmtPts(a)}, ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the ${fmtPts(b)} before that.` });
      }
    }
    // how many of the last days this team finished in the top half
    let streak = 0;
    for (const d of [...mine.dates].reverse()) { const r = dayRank.get(`${mine.team_id}:${d}`) ?? 99; if (r <= Math.ceil(aggs.length / 2)) streak++; else break; }
    if (streak >= 3) out.push({ tone: 'good', text: `${streak} game days in a row in the top half of the league.` });
    const wins = mine.dates.filter((d) => dayRank.get(`${mine.team_id}:${d}`) === 1).length;
    if (mine.days >= 3 && wins) out.push({ tone: 'info', text: `Won the night ${wins} time${wins > 1 ? 's' : ''} out of ${mine.days}.` });
    return out;
  }, [mine, aggs, cats, me, team, dayRank, range, eff, roto, catMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel = range === 'last' ? (tonightLive ? 'Tonight so far' : `Last night, ${fmtDate(lastNight)}`) : from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;
  const Th = ({ k, label, title, right = true }: { k: string; label: string; title?: string; right?: boolean }) => (
    <th className={`cursor-pointer whitespace-nowrap px-2 py-1.5 ${right ? 'text-right' : 'text-left'} ${sortKey === k ? 'text-gold' : ''}`} title={title} onClick={() => setSortKey(k)}>{label}{sortKey === k ? ' ▾' : ''}</th>
  );

  return (
    <div className="space-y-4">
      <PageHeader icon={<BarChart3 size={22} className="text-gold" />} title="Performance" sub="Every point that counted, by day and by category, for your team and everyone else’s." />
      {league?.phase !== 'season' && !rows?.length && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">The season hasn’t started. Once it does, every game day lands here the morning after.</div>}

      <div className="card space-y-2 p-3">
        <div className="scroll-x flex gap-1">
          {RANGES.map((r) => <button key={r.k} className={`tab shrink-0 px-3 py-1.5 ${range === r.k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setRange(r.k)}>{r.label}</button>)}
          {playoffsToo && <button className={`tab ml-auto shrink-0 px-3 py-1.5 ${phase === 3 ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPhase(phase === 3 ? 2 : 3)}>{phase === 3 ? 'Playoffs' : 'Regular season'}</button>}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="input py-1" value={custom.from} max={leagueDay} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-mute">to</span>
            <input type="date" className="input py-1" value={custom.to} max={leagueDay} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <div className="scroll-x flex items-center gap-1.5">
          <button className={`tab shrink-0 px-3 py-1.5 ${sel === 'all' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setSel('all')}>All teams</button>
          {gmTeams.map((t) => (
            <button key={t.id} className={`flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition ${sel === t.id ? 'border-gold/50 bg-gold/10 text-slate-100' : 'border-white/[.08] bg-white/[.03] text-mute'}`} onClick={() => setSel(t.id)} title={t.name}>
              <TeamBadge team={t} size={22} /><span>{t.id === me?.id ? 'Me' : t.abbrev}</span>
            </button>
          ))}
        </div>
        <div className="text-xs text-mute">{rangeLabel}{dates.length > 1 ? ` · ${dates.length} game days` : ''}{rows && !inRange.length ? ' · nothing scored yet in this range' : ''}</div>
      </div>

      {rows === null ? <div className="card p-4 text-sm text-mute">Loading the season…</div> : (
        <>
          <Section title="League table" right={<span className="text-xs text-mute">tap a column to sort</span>}>
            <div className="card overflow-hidden">
              <div className="scroll-x">
                <table className="w-full min-w-max text-xs">
                  <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                    <tr>
                      <th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Team</th>
                      <Th k="pts" label={catMode ? 'Roto' : 'Pts'} title={catMode ? 'Rotisserie points over this stretch: first in a category earns as many as there are teams' : 'Points that counted'} />
                      {!catMode && <Th k="avg" label="Avg" title="Points per game day" />}
                      {cats.map((k) => <Th key={k} k={k} label={statDef(k).short} title={statDef(k).label} />)}
                      {!catMode && <Th k="bench" label="Bench" title="Points left on the bench and IR: shown, never counted" />}
                      {!catMode && <Th k="eff" label="Lineup" title="Points scored against the best lineup possible from the same players, night by night" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[.05]">
                    {sorted.map((a, i) => {
                      const t = team(a.team_id);
                      const hi = (k: string, v: number) => (aggs.length > 1 && v === best[k] && v !== 0 ? 'font-bold text-gold' : '');
                      return (
                        <tr key={a.team_id} className={`cursor-pointer hover:bg-white/[.03] ${a.team_id === focus && sel !== 'all' ? 'bg-white/[.05]' : ''}`} onClick={() => setSel(a.team_id)}>
                          <td className="sticky left-0 z-10 bg-rink px-2 py-1.5">
                            <div className="flex items-center gap-1.5"><span className="num w-4 text-center text-mute">{i + 1}</span><TeamBadge team={t} size={22} /><span className="max-w-[88px] truncate font-semibold">{t?.name}</span><Sparkline values={a.daily} color={t?.color ?? '#fff'} width={40} height={16} /></div>
                          </td>
                          {catMode
                            ? <td className={`num px-2 text-right font-bold ${hi('pts', roto.get(a.team_id)?.total ?? 0)}`}>{fmtPts(roto.get(a.team_id)?.total ?? 0)}</td>
                            : <td className={`num px-2 text-right font-bold ${hi('pts', a.points)}`}>{fmtPts(a.points)}</td>}
                          {!catMode && <td className={`num px-2 text-right ${hi('avg', a.days ? a.points / a.days : 0)}`}>{a.days ? fmtPts(a.points / a.days) : '–'}</td>}
                          {cats.map((k) => <td key={k} className={`num px-2 text-right ${hi(k, isLow(k) ? -catVal(a.cats, k) : catVal(a.cats, k))}`}>{fmtCat(k, catVal(a.cats, k))}</td>)}
                          {!catMode && <td className={`num px-2 text-right text-mute ${hi('bench', -a.bench)}`}>{a.bench ? fmtPts(a.bench) : '–'}</td>}
                          {!catMode && <td className={`num px-2 text-right ${hi('eff', effPct(a.team_id) ?? 0)}`}>{effPct(a.team_id) != null ? `${Math.round(effPct(a.team_id)! * 100)}%` : '–'}</td>}
                        </tr>
                      );
                    })}
                    {aggs.length > 1 && (
                      <tr className="bg-white/[.02] text-mute">
                        <td className="sticky left-0 z-10 bg-rink px-2 py-1.5 font-semibold">League average</td>
                        <td className="num px-2 text-right">{fmtPts(catMode ? leagueAvg((a) => roto.get(a.team_id)?.total ?? 0) : leagueAvg((a) => a.points))}</td>
                        {!catMode && <td className="num px-2 text-right">{fmtPts(leagueAvg((a) => (a.days ? a.points / a.days : 0)))}</td>}
                        {cats.map((k) => <td key={k} className="num px-2 text-right">{fmtCat(k, leagueAvg((a) => catVal(a.cats, k)))}</td>)}
                        {!catMode && <td className="num px-2 text-right">{fmtPts(leagueAvg((a) => a.bench))}</td>}
                        {!catMode && <td className="num px-2 text-right">{(() => { const xs = aggs.map((a) => effPct(a.team_id)).filter((x): x is number => x != null); return xs.length ? `${Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 100)}%` : '–'; })()}</td>}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Only players in a starting slot at {sport.words.start} count.{catMode ? (league?.format === 'h2h' ? ' Roto ranks every team in each of the league’s categories over this stretch (first earns as many points as there are teams); the standings play them week by week.' : ' Roto ranks every team in each of the league’s categories over this stretch, as the standings do over the season.') : ''}{catMode ? '' : ' Lineup is the share of the best lineup possible each night from the players who played (bench, not IR).'} Gold marks the league’s best in each column. Stat corrections from the NHL can move a day for up to a month.</div>
            </div>
          </Section>

          {!catMode && dates.length > 1 && (
            <Section title="The race over this stretch">
              <PointsRace daily={inRange.map((r) => ({ team_id: r.team_id, date: r.date, points: r.points }))} focus={focus ?? 0} />
            </Section>
          )}

          {!catMode && inRange.length > 0 && <BenchTally rows={inRange} dates={dates} teamIds={gmTeams.map((t) => t.id)} focus={focus ?? 0} />}

          {mine && (
            <Section title={<span className="flex items-center gap-2"><TeamBadge team={team(mine.team_id)} size={26} />{team(mine.team_id)?.name}</span>} right={sel === 'all' && <span className="text-xs text-mute">your team · pick another above</span>}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {catMode ? (() => {
                    const r = roto.get(mine.team_id), placeOf = (k: string) => r?.place[k] ?? aggs.length;
                    const ord = (n: number) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;
                    const byPlace = [...cats].sort((a, b) => placeOf(a) - placeOf(b));
                    const top = byPlace[0], low = byPlace[byPlace.length - 1];
                    return <>
                      <Stat label="Roto points" value={<span style={{ color: readable(team(mine.team_id)?.color ?? '#fff') }}>{fmtPts(r?.total ?? 0)}</span>} sub={`${ord(rankOf(r?.total ?? 0, aggs.map((a) => roto.get(a.team_id)?.total ?? 0)))} of ${aggs.length}`} />
                      <Stat label="Game days" value={mine.days} sub={`${cats.length} categories`} />
                      <Stat label="Best category" value={<span className="text-emerald-300">{statDef(top).short}</span>} sub={`${ord(placeOf(top))} · ${fmtCat(top, catVal(mine.cats, top))}`} />
                      <Stat label="Weakest" value={<span className="text-amber-200">{statDef(low).short}</span>} sub={`${ord(placeOf(low))} · ${fmtCat(low, catVal(mine.cats, low))}`} />
                    </>;
                  })() : <>
                  <Stat label="Points" value={<span style={{ color: readable(team(mine.team_id)?.color ?? '#fff') }}>{fmtPts(mine.points)}</span>} sub={`${rankOf(mine.points, aggs.map((a) => a.points))}${['st', 'nd', 'rd'][rankOf(mine.points, aggs.map((a) => a.points)) - 1] ?? 'th'} of ${aggs.length}`} />
                  <Stat label="Per game day" value={mine.days ? fmtPts(mine.points / mine.days) : '–'} sub={`${mine.days} game day${mine.days === 1 ? '' : 's'}`} />
                  {effPct(mine.team_id) != null
                    ? <Stat label="Lineup" value={<span className={effPct(mine.team_id)! >= 0.95 ? 'text-emerald-300' : effPct(mine.team_id)! >= 0.85 ? 'text-slate-100' : 'text-amber-200'}>{Math.round(effPct(mine.team_id)! * 100)}%</span>} sub={`of a possible ${fmtPts(eff.get(mine.team_id)!.best)}`} />
                    : <Stat label="On the bench" value={<span className="text-amber-200">{fmtPts(mine.bench)}</span>} sub="shown, never counted" />}
                  <Stat label="From goalies" value={mine.points > 0 ? `${Math.round((mine.goalie / mine.points) * 100)}%` : '–'} sub={`${fmtPts(mine.goalie)} points`} />
                  </>}
                </div>
                {notes.length > 0 && (
                  <div className="card divide-y divide-white/[.05]">
                    {notes.map((n, i) => <div key={i} className="flex gap-2 px-3 py-2 text-sm"><span>{n.tone === 'good' ? '🟢' : n.tone === 'bad' ? '🔴' : '🔵'}</span><span className="text-slate-200">{n.text}</span></div>)}
                  </div>
                )}

                {myDays.length > 1 && (
                  <div className="card overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold text-slate-200">Day by day</div>
                    <div className="scroll-x">
                      <table className="w-full min-w-max text-xs">
                        <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                          <tr><th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Day</th>{!catMode && <><th className="px-2 text-right">Pts</th><th className="px-2 text-right" title="The best lineup possible that night from the players who played">Max</th><th className="px-2 text-right" title="Where the night ranked among the league">Night</th></>}<th className="px-2 text-right" title="Starters with a game">GP</th>{cats.map((k) => <th key={k} className="px-2 text-right" title={statDef(k).label}>{statDef(k).short}</th>)}{!catMode && <th className="px-2 text-right">Bench</th>}</tr>
                        </thead>
                        <tbody className="divide-y divide-white/[.05]">
                          {myDays.map((d) => {
                            const r = dayRank.get(`${d.team_id}:${d.date}`);
                            return (
                              <tr key={d.date} className="hover:bg-white/[.03]">
                                <td className="sticky left-0 z-10 bg-rink px-2 py-1.5"><Link to={`/scoreboard?day=${d.date}`} className="whitespace-nowrap font-semibold text-sky-300">{fmtDate(d.date)}</Link></td>
                                {!catMode && <td className="num px-2 text-right font-bold">{fmtPts(d.points)}</td>}
                                {!catMode && (() => { const b = bestOf.get(`${d.team_id}:${d.date}`); return <td className={`num px-2 text-right ${b == null ? 'text-mute' : b - d.points < 0.05 ? 'text-emerald-300' : 'text-amber-200/80'}`}>{b == null ? '–' : fmtPts(b)}</td>; })()}
                                {!catMode && <td className={`num px-2 text-right ${r === 1 ? 'font-bold text-gold' : r && r >= aggs.length ? 'text-red-300' : 'text-mute'}`}>{r ? `${r}${['st', 'nd', 'rd'][r - 1] ?? 'th'}` : '–'}</td>}
                                <td className="num px-2 text-right text-mute">{d.starters}</td>
                                {cats.map((k) => <td key={k} className="num px-2 text-right">{fmtCat(k, catVal(d.stats, k))}</td>)}
                                {!catMode && <td className="num px-2 text-right text-mute">{d.bench ? fmtPts(d.bench) : '–'}</td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {myPlayers.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold text-slate-200">Who carried the team <span className="font-normal text-mute">· starters’ totals{catMode ? ' in the league’s categories' : ', with what each left on the bench'}</span></div>
                    <div className="scroll-x">
                      <table className="w-full min-w-max text-xs">
                        <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                          <tr><th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Player</th><th className="px-2 text-right" title="Games started">GS</th>{!catMode && <><th className="px-2 text-right">Pts</th><th className="px-2 text-right" title="Points per start">/GS</th></>}{cats.map((k) => <th key={k} className="px-2 text-right" title={statDef(k).label}>{statDef(k).short}</th>)}{!catMode && <th className="px-2 text-right" title="Games on the bench or IR and the points they produced there">Benched</th>}</tr>
                        </thead>
                        <tbody className="divide-y divide-white/[.05]">
                          {myPlayers.map((p) => {
                            const pl = players.get(p.player_id)!;
                            const goalie = pl.pos === 'G';
                            return (
                              <tr key={p.player_id} className="hover:bg-white/[.03]">
                                <td className="sticky left-0 z-10 bg-rink px-2 py-1"><Link to={`/player/${pl.id}`} className="flex items-center gap-1.5"><Headshot p={pl} size={22} /><span className="max-w-[120px] truncate font-semibold">{pl.name}</span><Pos p={pl.pos} className="px-1 py-0" /></Link></td>
                                <td className="num px-2 text-right text-mute">{p.started}</td>
                                {!catMode && <td className={`num px-2 text-right font-bold ${p.points < 0 ? 'text-red-300' : ''}`}>{fmtPts(p.points)}</td>}
                                {!catMode && <td className="num px-2 text-right">{p.started ? fmtPts(p.points / p.started) : '–'}</td>}
                                {cats.map((k) => <td key={k} className={`num px-2 text-right ${GOALIE_KEYS.has(k) === goalie ? '' : 'text-white/20'}`}>{GOALIE_KEYS.has(k) === goalie ? fmtCat(k, catVal(p.stats, k)) : '·'}</td>)}
                                {!catMode && <td className="num px-2 text-right text-amber-200/80">{p.benched ? `${p.benched} · ${fmtPts(p.bench)}` : '–'}</td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {!catMode && sel === 'all' && topLeague.length > 0 && (
            <Section title="Top performers in the league">
              <div className="card divide-y divide-white/[.05]">
                {topLeague.map((p, i) => {
                  const pl = players.get(p.player_id)!;
                  const t = team(p.team_id);
                  return (
                    <Link key={p.player_id} to={`/player/${pl.id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/[.03]">
                      <span className="num w-5 text-center text-xs text-mute">{i + 1}</span><Headshot p={pl} size={26} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{pl.name}</span><span className="block truncate text-[11px] text-mute">{pl.pos} · {pl.nhl_team} · {t?.name} · {p.started} start{p.started === 1 ? '' : 's'}</span></span>
                      <span className="num font-bold" style={{ color: readable(t?.color ?? '#fff') }}>{fmtPts(p.points)}</span>
                    </Link>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// What every GM left on the bench and IR over the stretch: one column per GM, one row per game day, with the
// total and the share of their players' points that sat out. Shown, never counted. Same rows as the table above.
function BenchTally({ rows, dates, teamIds, focus }: { rows: Day[]; dates: string[]; teamIds: number[]; focus: number }) {
  const { team, me } = useLeague();
  const [all, setAll] = useState(false);
  const cell = useMemo(() => new Map(rows.map((r) => [`${r.team_id}:${r.date}`, r])), [rows]);
  const totals = useMemo(() => teamIds.map((id) => {
    const mine = rows.filter((r) => r.team_id === id);
    const bench = mine.reduce((n, r) => n + r.bench, 0), pts = mine.reduce((n, r) => n + r.points, 0);
    return { id, bench, pts, games: mine.reduce((n, r) => n + r.benched, 0) };
  }).sort((a, b) => b.bench - a.bench || a.id - b.id), [rows, teamIds]);
  const days = useMemo(() => [...dates].reverse(), [dates]);
  const shown = all ? days : days.slice(0, 14);
  const benchOf = (id: number, d: string) => cell.get(`${id}:${d}`)?.bench ?? 0;
  return (
    <Section title="🪑 Bench tally" right={<span className="text-xs text-mute">shown, never counted</span>}>
      <div className="space-y-3">
        {dates.length > 1 && <PointsRace daily={rows.map((r) => ({ team_id: r.team_id, date: r.date, points: r.bench }))} focus={focus} />}
        <div className="card overflow-hidden">
          <div className="scroll-x">
            <table className="w-full min-w-max text-xs">
              <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                <tr>
                  <th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Day</th>
                  {totals.map((t) => (
                    <th key={t.id} className="px-1.5 py-1.5 text-center" title={`${team(t.id)?.name} · ${team(t.id)?.gm_name}`}>
                      <div className="flex flex-col items-center gap-0.5"><TeamBadge team={team(t.id)} size={20} /><span className={`normal-case ${t.id === me?.id ? 'text-sky-300' : ''}`}>{t.id === me?.id ? 'Me' : team(t.id)?.gm_name}</span></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.05]">
                <tr className="bg-amber-500/[.06]">
                  <td className="sticky left-0 z-10 bg-rink px-2 py-1.5 font-semibold text-amber-200">Total</td>
                  {totals.map((t) => <td key={t.id} className="num px-1.5 text-center font-bold text-amber-200">{t.bench ? fmtPts(t.bench) : '–'}</td>)}
                </tr>
                <tr className="text-mute">
                  <td className="sticky left-0 z-10 bg-rink px-2 py-1.5" title="Bench and IR points as a share of everything their players scored">% benched</td>
                  {totals.map((t) => <td key={t.id} className="num px-1.5 text-center">{t.pts + t.bench > 0 && t.bench > 0 ? `${Math.round((t.bench / (t.pts + t.bench)) * 100)}%` : '–'}</td>)}
                </tr>
                <tr className="text-mute">
                  <td className="sticky left-0 z-10 bg-rink px-2 py-1.5" title="Games played by players on the bench or IR">Games</td>
                  {totals.map((t) => <td key={t.id} className="num px-1.5 text-center">{t.games || '–'}</td>)}
                </tr>
                {shown.map((d) => {
                  const hi = Math.max(...totals.map((t) => benchOf(t.id, d)));
                  return (
                    <tr key={d} className="hover:bg-white/[.03]">
                      <td className="sticky left-0 z-10 bg-rink px-2 py-1.5"><Link to={`/scoreboard?day=${d}`} className="whitespace-nowrap font-semibold text-sky-300">{fmtDate(d)}</Link></td>
                      {totals.map((t) => {
                        const v = benchOf(t.id, d);
                        return <td key={t.id} className={`num px-1.5 text-center ${v && v === hi ? 'font-bold text-amber-200' : v ? 'text-slate-300' : 'text-white/20'}`}>{v ? fmtPts(v) : '·'}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {days.length > 14 && <button className="w-full border-t border-white/[.06] py-2 text-xs font-semibold text-sky-300" onClick={() => setAll(!all)}>{all ? 'Show the last 14 days' : `Show all ${days.length} days`}</button>}
          <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Bench and IR points for every GM, game day by game day, with the total over this stretch. Amber marks the biggest bench of each day. Tap a day for that night’s scoreboard.</div>
        </div>
      </div>
    </Section>
  );
}
