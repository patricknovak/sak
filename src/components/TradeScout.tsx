// Trade scouting: the numbers a GM wants next to every player while picking a trade, past and future side by
// side. Form (this season, the last 7, 14 and 30 days, a hot/cold read against his own pace), outlook (the
// projection and its range, rest of season, games left, the next week's schedule, age), or the raw skater and
// goalie categories for any timeframe. Used by the trade builder and the team scouting page.
import { useMemo, useState, type ReactNode } from 'react';
import { useLeague } from '../lib/store';
import type { Player, PlayerSeason, PlayerWindow, ProjDetail } from '../lib/types';
import { etToday, fmtPts } from '../lib/format';
import { TIMEFRAMES, fmtStat, lineFor, minSample, rosPoints, statDef, statValue, type Timeframe } from '../lib/playerstats';
import { gamesOf, rosPerGame } from '../lib/lineup';
import { useProjDetails, useSeasonGames, toneCls, toneIcon } from '../lib/projections';
import type { Game } from '../lib/types';

export type ScoutView = 'form' | 'outlook' | 'skater' | 'goalie';
export type ScoutSort = 'proj' | 'ros' | 'fp' | 'fpg' | '7' | '14' | '30' | 'last' | 'pos';
export const SKATER_COLS = ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'shpct'];
export const GOALIE_COLS = ['gp', 'w', 'l', 'svp', 'gaa', 'sho', 'sv'];
const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];

// everything the strip, the peek and the sort need, loaded once per page
export interface ScoutCtx { windows: Map<number, Record<string, PlayerWindow>>; season: Map<number, PlayerSeason>; details: Map<number, ProjDetail> | null; games: Game[] | null; today: string }
export function useScoutCtx(): ScoutCtx {
  const { windows, season } = useLeague();
  const details = useProjDetails();
  const games = useSeasonGames();
  return useMemo(() => ({ windows, season, details, games, today: etToday() }), [windows, season, details, games]);
}

const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);

// one player's numbers, past and future
export interface ScoutNums {
  gp: number; fp: number; fpg: number | null;                 // this season
  w: Record<'7' | '14' | '30', { gp: number; fp: number; fpg: number | null } | null>;
  trend: number | null;                                       // last 14 days per game against his own pace (season, else projection), as a fraction
  last: number; lastGp: number;                               // last season
  proj: number; projPg: number; lo: number | null; hi: number | null; ros: number; left: number; next7: number; age: number | null;
  projTrend: 'up' | 'down' | 'flat' | null; factors: { tone: 'good' | 'bad' | 'info'; text: string }[];
}
export function scoutNums(p: Player, c: ScoutCtx): ScoutNums {
  const s = c.season.get(p.id);
  const w = c.windows.get(p.id) ?? {};
  const gp = s?.gp ?? 0, fp = s?.fpts ?? 0;
  const projPg = p.proj / gamesOf(p);
  const win = (k: '7' | '14' | '30') => { const x = w[k]; return x && x.gp > 0 ? { gp: x.gp, fp: x.fpts, fpg: x.fpts / x.gp } : null; };
  const w14 = win('14');
  const pace = gp >= 8 ? fp / gp : projPg;
  const trend = w14 && w14.gp >= 3 && pace > 0.2 ? w14.fpg! / pace - 1 : null;
  const m = c.details?.get(p.id)?.proj_meta ?? null;
  const left = c.games ? c.games.filter((g) => g.date >= c.today && !['PPD', 'CNCL'].includes(g.state) && (g.home === p.nhl_team || g.away === p.nhl_team)).length : 0;
  const next7 = c.games ? c.games.filter((g) => g.date >= c.today && g.date <= addDays(c.today, 6) && !['PPD', 'CNCL'].includes(g.state) && (g.home === p.nhl_team || g.away === p.nhl_team)).length : 0;
  return {
    gp, fp, fpg: gp ? fp / gp : null, w: { '7': win('7'), '14': w14, '30': win('30') }, trend,
    last: p.last_fp, lastGp: p.last_stats?.gp ?? 0,
    proj: p.proj, projPg, lo: m ? p.proj * m.lo : null, hi: m ? p.proj * m.hi : null, ros: rosPoints(p, s), left, next7, age: m?.age ?? null,
    projTrend: m?.trend ?? null, factors: m?.factors ?? [],
  };
}
// rest-of-season per game, the number that actually decides lineups
export const rosPg = (p: Player, c: ScoutCtx) => { const s = c.season.get(p.id); return rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp); };

export const trendLabel = (t: number | null) => (t == null ? null : t >= 0.1 ? { icon: '🔥', text: `+${Math.round(t * 100)}%`, cls: 'text-emerald-300' } : t <= -0.1 ? { icon: '🧊', text: `${Math.round(t * 100)}%`, cls: 'text-sky-300' } : { icon: '→', text: 'steady', cls: 'text-mute' });

export function sortPlayers(ps: Player[], sort: ScoutSort, c: ScoutCtx): Player[] {
  const key = (p: Player) => {
    const n = scoutNums(p, c);
    switch (sort) {
      case 'proj': return p.proj;
      case 'ros': return n.ros;
      case 'fp': return n.fp;
      case 'fpg': return n.fpg ?? -1;
      case '7': case '14': case '30': return n.w[sort]?.fp ?? -1;
      case 'last': return n.last;
      default: return 0;
    }
  };
  return [...ps].sort((a, b) => (sort === 'pos' ? POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos) || b.proj - a.proj : key(b) - key(a)));
}

// the controls above a list: what to show beside each player, which window, and the order
export function useScout(init: Partial<{ view: ScoutView; tf: Timeframe; sort: ScoutSort }> = {}) {
  const { league, windows } = useLeague();
  const inSeason = league?.phase === 'season' && windows.size > 0;
  const [view, setView] = useState<ScoutView>(init.view ?? (inSeason ? 'form' : 'outlook'));
  const [tf, setTf] = useState<Timeframe>(init.tf ?? (inSeason ? 'season' : 'last'));
  const [sort, setSort] = useState<ScoutSort>(init.sort ?? (inSeason ? 'ros' : 'proj'));
  const [perGame, setPerGame] = useState(false);
  return { view, setView, tf, setTf, sort, setSort, perGame, setPerGame, inSeason };
}
export type Scout = ReturnType<typeof useScout>;

export function ScoutBar({ s, hasG = true, hasS = true, children }: { s: Scout; hasG?: boolean; hasS?: boolean; children?: ReactNode }) {
  const chip = (on: boolean, extra = '') => `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'} ${extra}`;
  const SORTS: [ScoutSort, string][] = [['ros', 'Rest of season'], ['proj', 'Projection'], ['fp', 'Season pts'], ['fpg', 'Pts / game'], ['30', 'Last 30 days'], ['14', 'Last 14 days'], ['7', 'Last 7 days'], ['last', '’25-26'], ['pos', 'Position']];
  return (
    <div className="space-y-1.5">
      <div className="scroll-x flex items-center gap-1">
        <span className="label mr-1 shrink-0">Show</span>
        <button className={chip(s.view === 'form')} onClick={() => s.setView('form')} title="This season and the last 7, 14 and 30 days">📈 Form</button>
        <button className={chip(s.view === 'outlook')} onClick={() => s.setView('outlook')} title="Projection, range, rest of season, schedule, age">🔭 Outlook</button>
        {hasS && <button className={chip(s.view === 'skater')} onClick={() => s.setView('skater')}>Skater stats</button>}
        {hasG && <button className={chip(s.view === 'goalie')} onClick={() => s.setView('goalie')}>Goalie stats</button>}
        {(s.view === 'skater' || s.view === 'goalie') && <>
          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
          {TIMEFRAMES.filter((x) => x.k !== 'proj' && x.k !== 'ros').map((x) => <button key={x.k} disabled={x.live && !s.inSeason} title={x.label} className={chip(s.tf === x.k, 'disabled:opacity-35')} onClick={() => s.setTf(x.k)}>{x.short}</button>)}
          <button className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.perGame ? 'bg-emerald-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => s.setPerGame(!s.perGame)}>Per game</button>
        </>}
        {children}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-mute">
        <span>Sort by</span>
        <select className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-200" value={s.sort} onChange={(e) => s.setSort(e.target.value as ScoutSort)}>
          {SORTS.filter(([k]) => s.inSeason || !['fp', 'fpg', '30', '14', '7'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}

const Num = ({ label, value, cls = '', title }: { label: string; value: ReactNode; cls?: string; title?: string }) => (
  <span className="flex min-w-[34px] flex-col items-end leading-tight" title={title}><span className={`num text-xs font-semibold ${cls}`}>{value}</span><span className="text-[9px] uppercase tracking-wide text-mute">{label}</span></span>
);

// the compact numbers beside a player in a list, for the chosen view
export function StatStrip({ p, s, c }: { p: Player; s: Scout; c: ScoutCtx }) {
  const n = scoutNums(p, c);
  const goalie = p.pos === 'G';
  if (s.view === 'form') {
    const t = trendLabel(n.trend);
    return (
      <span className="flex items-end gap-2">
        <Num label="Szn" value={n.gp ? fmtPts(n.fp, 0) : '–'} title={`${n.gp} games this season`} />
        <Num label="/G" value={n.fpg != null ? n.fpg.toFixed(1) : '–'} title="Points per game this season" />
        <Num label="7d" value={n.w['7'] ? fmtPts(n.w['7']!.fp, 0) : '–'} title={`Last 7 days (${n.w['7']?.gp ?? 0} GP)`} />
        <Num label="14d" value={n.w['14'] ? fmtPts(n.w['14']!.fp, 0) : '–'} title={`Last 14 days (${n.w['14']?.gp ?? 0} GP)`} />
        <Num label="30d" value={n.w['30'] ? fmtPts(n.w['30']!.fp, 0) : '–'} title={`Last 30 days (${n.w['30']?.gp ?? 0} GP)`} />
        <Num label="Trend" value={t ? <span className={t.cls}>{t.icon} {t.text}</span> : '–'} title="Last 14 days per game against his own pace" />
      </span>
    );
  }
  if (s.view === 'outlook') {
    return (
      <span className="flex items-end gap-2">
        <Num label="Proj" value={fmtPts(n.proj, 0)} cls="text-slate-100" title={n.lo != null ? `A bad year ${fmtPts(n.lo, 0)}, a great one ${fmtPts(n.hi, 0)}` : 'Projected points'} />
        <Num label="ROS" value={fmtPts(n.ros, 0)} cls="text-gold" title="Rest of season: projection blended with this season's pace" />
        <Num label="ROS/G" value={rosPg(p, c).toFixed(1)} title="Rest-of-season points per game" />
        <Num label="Left" value={n.left || '–'} title="NHL games left on his team's schedule" />
        <Num label="Wk" value={n.next7 || '0'} title="Games in the next 7 days" />
        <Num label="Age" value={n.age ?? '–'} />
      </span>
    );
  }
  const cols = goalie ? ['fp', ...GOALIE_COLS.slice(0, 6)] : (s.view === 'goalie' ? [] : ['fp', ...SKATER_COLS.slice(0, 7)]);
  if (!cols.length) return <span className="text-[10px] text-mute">skater</span>;
  const tfOk: Timeframe = !c.windows.size && TIMEFRAMES.find((x) => x.k === s.tf)?.live ? 'last' : s.tf;
  const line = lineFor(p, tfOk, c.windows.get(p.id), c.season.get(p.id));
  return (
    <span className="flex items-end gap-2">
      {cols.map((k) => <Num key={k} label={statDef(k).short} value={fmtStat(statValue(line, k, s.perGame && k !== 'gp', minSample(tfOk)), k, s.perGame && k !== 'gp')} />)}
    </span>
  );
}

// the expanded card under a player: every window side by side, the projection's story and the week ahead
export function PlayerPeek({ p, c }: { p: Player; c: ScoutCtx }) {
  const n = scoutNums(p, c);
  const goalie = p.pos === 'G';
  const cols = goalie ? ['w', 'l', 'svp', 'gaa', 'sho'] : ['g', 'a', 'pts', 'ppp', 'sog', 'hit', 'blk'];
  const rows: { k: Timeframe; label: string }[] = [{ k: '7', label: 'Last 7 days' }, { k: '14', label: 'Last 14 days' }, { k: '30', label: 'Last 30 days' }, { k: 'season', label: 'This season' }, { k: 'last', label: '’25-26' }];
  const t = trendLabel(n.trend);
  const week = c.games ? c.games.filter((g) => g.date >= c.today && g.date <= addDays(c.today, 6) && !['PPD', 'CNCL'].includes(g.state) && (g.home === p.nhl_team || g.away === p.nhl_team)).sort((a, b) => a.date.localeCompare(b.date)) : [];
  return (
    <div className="space-y-2 rounded-xl border border-white/[.08] bg-black/25 p-2 text-xs">
      <div className="grid grid-cols-3 gap-1.5 text-center sm:grid-cols-6">
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">Projected</div><div className="num font-bold">{fmtPts(n.proj, 0)}</div><div className="text-[10px] text-mute">{n.lo != null ? `${fmtPts(n.lo, 0)}–${fmtPts(n.hi, 0)}` : `${n.projPg.toFixed(1)} / game`}</div></div>
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">Rest of season</div><div className="num font-bold text-gold">{fmtPts(n.ros, 0)}</div><div className="text-[10px] text-mute">{rosPg(p, c).toFixed(1)} / game · {n.left} left</div></div>
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">This season</div><div className="num font-bold">{n.gp ? fmtPts(n.fp, 0) : '–'}</div><div className="text-[10px] text-mute">{n.gp} GP{n.fpg != null ? ` · ${n.fpg.toFixed(1)} / game` : ''}</div></div>
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">Form</div><div className={`num font-bold ${t?.cls ?? ''}`}>{t ? `${t.icon} ${t.text}` : '–'}</div><div className="text-[10px] text-mute">14 days vs his pace</div></div>
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">’25-26</div><div className="num font-bold">{fmtPts(n.last, 0)}</div><div className="text-[10px] text-mute">{n.lastGp ? `${n.lastGp} GP · ${(n.last / n.lastGp).toFixed(1)} / game` : ''}</div></div>
        <div className="rounded-lg bg-white/[.04] p-1.5"><div className="text-[10px] text-mute">Next 7 days</div><div className="num font-bold">{n.next7} game{n.next7 === 1 ? '' : 's'}</div><div className="truncate text-[10px] text-mute">{week.map((g) => (g.home === p.nhl_team ? `vs ${g.away}` : `@ ${g.home}`)).join(', ') || 'off'}</div></div>
      </div>
      <div className="scroll-x">
        <table className="w-full min-w-max text-[11px]">
          <thead className="text-[10px] uppercase tracking-wider text-mute"><tr><th className="px-1.5 py-1 text-left">Window</th><th className="px-1.5 text-right">GP</th><th className="px-1.5 text-right">FP</th><th className="px-1.5 text-right">FP/G</th>{cols.map((k) => <th key={k} className="px-1.5 text-right">{statDef(k).short}</th>)}</tr></thead>
          <tbody className="divide-y divide-white/[.05]">
            {rows.map((r) => {
              const line = lineFor(p, r.k, c.windows.get(p.id), c.season.get(p.id));
              if (!line || !line.gp) return <tr key={r.k} className="text-mute"><td className="px-1.5 py-1">{r.label}</td><td className="px-1.5 text-right">–</td><td /><td />{cols.map((k) => <td key={k} />)}</tr>;
              return (
                <tr key={r.k} className={r.k === 'season' ? 'font-semibold text-slate-100' : ''}>
                  <td className="px-1.5 py-1">{r.label}</td>
                  <td className="num px-1.5 text-right">{line.gp}</td>
                  <td className="num px-1.5 text-right">{fmtPts(line.fp, 1)}</td>
                  <td className="num px-1.5 text-right">{(line.fp / line.gp).toFixed(2)}</td>
                  {cols.map((k) => <td key={k} className="num px-1.5 text-right">{fmtStat(statValue(line, k, false, minSample(r.k)), k)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {n.factors.length > 0 && <ul className="space-y-0.5">{n.factors.slice(0, 3).map((f) => <li key={f.text} className={toneCls[f.tone]}>{toneIcon[f.tone]} <span className="text-slate-300">{f.text}</span></li>)}</ul>}
      {p.injury_note && <div className="text-amber-200">⚕️ {p.injury_status}: {p.injury_note}</div>}
    </div>
  );
}
