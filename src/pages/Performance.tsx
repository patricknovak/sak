// Performance: the points that counted, every day, every category, every team. A GM reviews last night or any
// stretch of the season for their own team or the whole league, category by category, and reads what the
// numbers say: where the team is strong, where it leaks, how steady it is and what was left on the bench.
// Everything here comes from the puck-drop freeze-frames and the box scores, the same rows the standings count.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtDate, fmtPts, readable } from '../lib/format';
import { Headshot, PageHeader, Pos, Section, Stat, TeamBadge } from '../components/ui';
import { PointsRace, Sparkline } from '../components/charts';
import { statDef } from '../lib/playerstats';
import { BarChart3 } from 'lucide-react';

type Day = { team_id: number; date: string; game_type: number; points: number; bench: number; goalie_points: number; starters: number; benched: number; stats: Record<string, number>; bench_stats: Record<string, number> };
type PP = { team_id: number; player_id: number; started: number; benched: number; points: number; bench: number; stats: Record<string, number> };
type RangeKey = 'last' | '7' | '14' | '30' | 'season' | 'custom';
const RANGES: { k: RangeKey; label: string }[] = [
  { k: 'last', label: 'Last night' }, { k: '7', label: '7 days' }, { k: '14', label: '14 days' }, { k: '30', label: '30 days' }, { k: 'season', label: 'Season' }, { k: 'custom', label: 'Custom' },
];
// the categories in the order the box-score lines use them; only the ones the league scores are shown
const SKATER = ['g', 'a', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow'];
const GOALIE = ['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'];
const LIVE = new Set(['LIVE', 'CRIT']);

const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const num = (o: Record<string, number> | null | undefined, k: string) => Number(o?.[k] ?? 0);
const fmtCat = (k: string, v: number) => (k === 'pm' && v > 0 ? `+${v}` : String(Math.round(v * 10) / 10));
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
  const [rows, setRows] = useState<Day[] | null>(null);
  const [pps, setPps] = useState<PP[]>([]);
  const [range, setRange] = useState<RangeKey>('last');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: addDays(leagueDay, -6), to: leagueDay });
  const [sel, setSel] = useState<number | 'all'>(me?.id ?? 'all');
  const [sortKey, setSortKey] = useState<string>('pts');
  const [phase, setPhase] = useState<2 | 3>(2);
  const gmTeams = useMemo(() => teams.filter((t) => t.role === 'gm'), [teams]);

  // the whole season once; ranges are sliced here
  useEffect(() => {
    rpc<Day[]>('performance_days', { p_from: null, p_to: leagueDay })
      .then((d) => setRows(d.map((r) => ({ ...r, points: Number(r.points), bench: Number(r.bench), goalie_points: Number(r.goalie_points) }))), () => setRows([]));
  }, [leagueDay]);
  const playoffsToo = useMemo(() => (rows ?? []).some((r) => r.game_type === 3), [rows]);
  const scored = useMemo(() => (rows ?? []).filter((r) => r.game_type === phase), [rows, phase]);
  const allDates = useMemo(() => [...new Set(scored.map((r) => r.date))].sort(), [scored]);
  // "last night" is the latest league day with box scores; while games are on it is tonight so far
  const lastNight = allDates[allDates.length - 1] ?? leagueDay;
  const tonightLive = lastNight === leagueDay && games.some((g) => g.date === leagueDay && LIVE.has(g.state));
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
  const cats = useMemo(() => [...SKATER.filter((k) => w?.skater[k]), ...GOALIE.filter((k) => w?.goalie[k] || k === 'sv' || k === 'ga')], [w]);
  // a category the league scores negatively (PIM, goals against, losses) is one where fewer is better
  const isLow = (k: string) => { const wt = w?.skater[k] ?? w?.goalie[k]; return wt != null && wt !== 0 ? wt < 0 : !!statDef(k).lowerIsBetter; };
  const aggs = useMemo(() => aggregate(inRange, gmTeams.map((t) => t.id)), [inRange, gmTeams]);
  const sorted = useMemo(() => [...aggs].sort((a, b) => {
    if (sortKey === 'pts') return b.points - a.points;
    if (sortKey === 'avg') return (b.days ? b.points / b.days : 0) - (a.days ? a.points / a.days : 0);
    if (sortKey === 'bench') return b.bench - a.bench;
    return isLow(sortKey) ? num(a.cats, sortKey) - num(b.cats, sortKey) : num(b.cats, sortKey) - num(a.cats, sortKey);
  }), [aggs, sortKey, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = useMemo(() => Object.fromEntries(['pts', 'avg', 'bench', ...cats].map((k) => {
    const vals = aggs.map((a) => k === 'pts' ? a.points : k === 'avg' ? (a.days ? a.points / a.days : 0) : k === 'bench' ? -a.bench : isLow(k) ? -num(a.cats, k) : num(a.cats, k));
    return [k, Math.max(...vals)];
  })), [aggs, cats, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const leagueAvg = (f: (a: Agg) => number) => (aggs.length ? aggs.reduce((n, a) => n + f(a), 0) / aggs.length : 0);
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
    const pos = rankOf(mine.points, aggs.map((a) => a.points));
    // goalie categories only mean something once a goalie has started; an edge has to beat the league average
    const ranks = cats.filter((k) => k !== 'gs' && (!GOALIE.includes(k) || num(mine.cats, 'gs') > 0))
      .map((k) => ({ k, low: isLow(k), r: rankOf(num(mine.cats, k), aggs.map((a) => num(a.cats, k)), isLow(k)), v: num(mine.cats, k), avg: leagueAvg((a) => num(a.cats, k)) }))
      .filter((c) => c.v !== 0 || c.avg !== 0);
    const edge = ranks.filter((c) => c.r <= 2 && (c.low ? c.v < c.avg : c.v > c.avg)).sort((a, b) => a.r - b.r).slice(0, 3);
    const gap = ranks.filter((c) => c.r >= aggs.length - 1 && (c.low ? c.v > c.avg : c.v < c.avg)).sort((a, b) => b.r - a.r).slice(0, 3);
    out.push({ tone: pos <= 2 ? 'good' : pos >= aggs.length - 1 ? 'bad' : 'info', text: `${name} ${are} ${pos === 1 ? 'first' : `${pos}${['st', 'nd', 'rd'][pos - 1] ?? 'th'}`} of ${aggs.length} over this stretch with ${fmtPts(mine.points)} points, ${fmtPts(mine.points / mine.days)} a day against a league average of ${fmtPts(leagueAvg((a) => (a.days ? a.points / a.days : 0)))}.` });
    if (edge.length) out.push({ tone: 'good', text: `Edge: ${edge.map((c) => `${statDef(c.k).label.toLowerCase()} (${fmtCat(c.k, c.v)}, league avg ${fmtCat(c.k, c.avg)})`).join(', ')}.` });
    if (gap.length) out.push({ tone: 'bad', text: `Gap: ${gap.map((c) => `${statDef(c.k).label.toLowerCase()} (${fmtCat(c.k, c.v)}, league avg ${fmtCat(c.k, c.avg)})`).join(', ')}.` });
    const total = mine.points + mine.bench;
    if (mine.bench > 0 && total > 0) {
      const eff = mine.points / total;
      const lgEff = leagueAvg((a) => (a.points + a.bench > 0 ? a.points / (a.points + a.bench) : 1));
      out.push({ tone: eff >= lgEff ? 'info' : 'bad', text: `${fmtPts(mine.bench)} points sat on the bench or IR: ${Math.round(eff * 100)}% of the points available made it into the lineup (league ${Math.round(lgEff * 100)}%).` });
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
  }, [mine, aggs, cats, me, team, dayRank, range]); // eslint-disable-line react-hooks/exhaustive-deps

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
                      <Th k="pts" label="Pts" title="Points that counted" />
                      <Th k="avg" label="Avg" title="Points per game day" />
                      {cats.map((k) => <Th key={k} k={k} label={statDef(k).short} title={statDef(k).label} />)}
                      <Th k="bench" label="Bench" title="Points left on the bench and IR: shown, never counted" />
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
                          <td className={`num px-2 text-right font-bold ${hi('pts', a.points)}`}>{fmtPts(a.points)}</td>
                          <td className={`num px-2 text-right ${hi('avg', a.days ? a.points / a.days : 0)}`}>{a.days ? fmtPts(a.points / a.days) : '–'}</td>
                          {cats.map((k) => <td key={k} className={`num px-2 text-right ${hi(k, isLow(k) ? -num(a.cats, k) : num(a.cats, k))}`}>{fmtCat(k, num(a.cats, k))}</td>)}
                          <td className={`num px-2 text-right text-mute ${hi('bench', -a.bench)}`}>{a.bench ? fmtPts(a.bench) : '–'}</td>
                        </tr>
                      );
                    })}
                    {aggs.length > 1 && (
                      <tr className="bg-white/[.02] text-mute">
                        <td className="sticky left-0 z-10 bg-rink px-2 py-1.5 font-semibold">League average</td>
                        <td className="num px-2 text-right">{fmtPts(leagueAvg((a) => a.points))}</td>
                        <td className="num px-2 text-right">{fmtPts(leagueAvg((a) => (a.days ? a.points / a.days : 0)))}</td>
                        {cats.map((k) => <td key={k} className="num px-2 text-right">{fmtCat(k, leagueAvg((a) => num(a.cats, k)))}</td>)}
                        <td className="num px-2 text-right">{fmtPts(leagueAvg((a) => a.bench))}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Only players in a starting slot at puck drop count. Gold marks the league’s best in each column. Stat corrections from the NHL can move a day for up to a month.</div>
            </div>
          </Section>

          {dates.length > 1 && (
            <Section title="The race over this stretch">
              <PointsRace daily={inRange.map((r) => ({ team_id: r.team_id, date: r.date, points: r.points }))} focus={focus ?? 0} />
            </Section>
          )}

          {mine && (
            <Section title={<span className="flex items-center gap-2"><TeamBadge team={team(mine.team_id)} size={26} />{team(mine.team_id)?.name}</span>} right={sel === 'all' && <span className="text-xs text-mute">your team · pick another above</span>}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Points" value={<span style={{ color: readable(team(mine.team_id)?.color ?? '#fff') }}>{fmtPts(mine.points)}</span>} sub={`${rankOf(mine.points, aggs.map((a) => a.points))}${['st', 'nd', 'rd'][rankOf(mine.points, aggs.map((a) => a.points)) - 1] ?? 'th'} of ${aggs.length}`} />
                  <Stat label="Per game day" value={mine.days ? fmtPts(mine.points / mine.days) : '–'} sub={`${mine.days} game day${mine.days === 1 ? '' : 's'}`} />
                  <Stat label="On the bench" value={<span className="text-amber-200">{fmtPts(mine.bench)}</span>} sub="shown, never counted" />
                  <Stat label="From goalies" value={mine.points > 0 ? `${Math.round((mine.goalie / mine.points) * 100)}%` : '–'} sub={`${fmtPts(mine.goalie)} points`} />
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
                          <tr><th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Day</th><th className="px-2 text-right">Pts</th><th className="px-2 text-right" title="Where the night ranked among the league">Night</th><th className="px-2 text-right" title="Starters with a game">GP</th>{cats.map((k) => <th key={k} className="px-2 text-right" title={statDef(k).label}>{statDef(k).short}</th>)}<th className="px-2 text-right">Bench</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/[.05]">
                          {myDays.map((d) => {
                            const r = dayRank.get(`${d.team_id}:${d.date}`);
                            return (
                              <tr key={d.date} className="hover:bg-white/[.03]">
                                <td className="sticky left-0 z-10 bg-rink px-2 py-1.5"><Link to={`/scoreboard?day=${d.date}`} className="whitespace-nowrap font-semibold text-sky-300">{fmtDate(d.date)}</Link></td>
                                <td className="num px-2 text-right font-bold">{fmtPts(d.points)}</td>
                                <td className={`num px-2 text-right ${r === 1 ? 'font-bold text-gold' : r && r >= aggs.length ? 'text-red-300' : 'text-mute'}`}>{r ? `${r}${['st', 'nd', 'rd'][r - 1] ?? 'th'}` : '–'}</td>
                                <td className="num px-2 text-right text-mute">{d.starters}</td>
                                {cats.map((k) => <td key={k} className="num px-2 text-right">{fmtCat(k, num(d.stats, k))}</td>)}
                                <td className="num px-2 text-right text-mute">{d.bench ? fmtPts(d.bench) : '–'}</td>
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
                    <div className="px-3 py-2 text-xs font-semibold text-slate-200">Who carried the team <span className="font-normal text-mute">· starters’ totals, with what each left on the bench</span></div>
                    <div className="scroll-x">
                      <table className="w-full min-w-max text-xs">
                        <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                          <tr><th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Player</th><th className="px-2 text-right" title="Games started">GS</th><th className="px-2 text-right">Pts</th><th className="px-2 text-right" title="Points per start">/GS</th>{cats.map((k) => <th key={k} className="px-2 text-right" title={statDef(k).label}>{statDef(k).short}</th>)}<th className="px-2 text-right" title="Games on the bench or IR and the points they produced there">Benched</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/[.05]">
                          {myPlayers.map((p) => {
                            const pl = players.get(p.player_id)!;
                            const goalie = pl.pos === 'G';
                            return (
                              <tr key={p.player_id} className="hover:bg-white/[.03]">
                                <td className="sticky left-0 z-10 bg-rink px-2 py-1"><Link to={`/player/${pl.id}`} className="flex items-center gap-1.5"><Headshot p={pl} size={22} /><span className="max-w-[120px] truncate font-semibold">{pl.name}</span><Pos p={pl.pos} className="px-1 py-0" /></Link></td>
                                <td className="num px-2 text-right text-mute">{p.started}</td>
                                <td className={`num px-2 text-right font-bold ${p.points < 0 ? 'text-red-300' : ''}`}>{fmtPts(p.points)}</td>
                                <td className="num px-2 text-right">{p.started ? fmtPts(p.points / p.started) : '–'}</td>
                                {cats.map((k) => <td key={k} className={`num px-2 text-right ${(goalie ? GOALIE : SKATER).includes(k) ? '' : 'text-white/20'}`}>{(goalie ? GOALIE : SKATER).includes(k) ? fmtCat(k, num(p.stats, k)) : '·'}</td>)}
                                <td className="num px-2 text-right text-amber-200/80">{p.benched ? `${p.benched} · ${fmtPts(p.bench)}` : '–'}</td>
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

          {sel === 'all' && topLeague.length > 0 && (
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
