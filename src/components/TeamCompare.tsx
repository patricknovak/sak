// One team's players beside another GM's, or beside every GM's: every player in one table, every stat for the
// timeframe, sorted by any column, with each team's totals (or its average player) underneath to compare at a glance.
import { useMemo, type CSSProperties } from 'react';
import { useLeague, useSport } from '../lib/store';
import { useSticky } from '../lib/sticky';
import { positionKeys } from '../lib/sport';
import type { Player, Team } from '../lib/types';
import { fmtPts } from '../lib/format';
import { TIMEFRAMES, fmtStat, minSample, projLike, statDef, statValue, type Line, type Timeframe } from '../lib/playerstats';
import { PlayerTag } from './PlayerCard';
import { Headshot, Pos, TeamBadge } from './ui';

const SKATER = ['fp', 'gp', 'g', 'a', 'pts', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow', 'shpct'];
const GOALIE = ['fp', 'gp', 'gs', 'w', 'l', 'otl', 'ga', 'sa', 'sv', 'sho', 'svp', 'gaa'];
const STARTING = new Set(['C', 'LW', 'RW', 'D', 'Util', 'G']);
// columns that aren't stats: sorted alphabetically (team by the order the teams are shown)
type TextCol = 'name' | 'team' | 'pos' | 'nhl';
interface Sort { k: string; desc: boolean }
interface Row { p: Player; team: Team; line: Line | null }

function sumLines(lines: (Line | null)[]): Line {
  const totals: Record<string, number> = {};
  let gp = 0, fp = 0;
  for (const l of lines) { if (!l) continue; gp += l.gp ?? 0; fp += l.fp; for (const [k, v] of Object.entries(l.totals)) totals[k] = (totals[k] ?? 0) + (v ?? 0); }
  return { gp, fp, totals };
}
const ord = (n: number) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;

export function TeamCompare({ baseId, vsIds, tf, scope, line }: {
  baseId: number; vsIds: number[]; tf: Timeframe; scope: 'starters' | 'roster'; line: (p: Player) => Line | null;
}) {
  const { teams, rosters, players, me } = useLeague();
  const POSITIONS = ['ALL', ...positionKeys(useSport())];
  const [pos, setPos] = useSticky<string>('teamcompare:pos', 'ALL');
  const [perGame, setPerGame] = useSticky<boolean>('teamcompare:pg', false);
  const [foot, setFoot] = useSticky<'total' | 'avg'>('teamcompare:foot', 'total');
  const [sort, setSort] = useSticky<Sort>('teamcompare:sort', { k: 'fp', desc: true });
  const proj = projLike(tf);
  const pg = perGame && !proj;
  const sample = minSample(tf);
  const myId = me?.id ?? null;

  // the teams in the table: this page's team first, then the others in league order
  const shown = useMemo(() => {
    const ids = [baseId, ...vsIds.filter((id) => id !== baseId)];
    return ids.map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => !!t);
  }, [teams, baseId, vsIds]);
  const order = useMemo(() => new Map(shown.map((t, i) => [t.id, i])), [shown]);

  const rows = useMemo<Row[]>(() => rosters
    .filter((r) => order.has(r.team_id) && (scope === 'roster' || STARTING.has(r.slot)))
    .map((r) => ({ p: players.get(r.player_id), team: shown[order.get(r.team_id)!] }))
    .filter((x): x is { p: Player; team: Team } => !!x.p)
    .map((x) => ({ ...x, line: line(x.p) })), [rosters, players, order, shown, scope, line]);
  const match = (p: Player) => pos === 'ALL' || (pos === 'G' ? p.pos === 'G' : p.elig.includes(pos));
  const picked = rows.filter((r) => match(r.p));
  const skaters = picked.filter((r) => r.p.pos !== 'G');
  const goalies = picked.filter((r) => r.p.pos === 'G');

  // the strip up top: each team's fantasy points from the players the filter leaves in
  const board = shown.map((t) => {
    const mine = picked.filter((r) => r.team.id === t.id);
    const fp = mine.reduce((s, r) => s + (r.line?.fp ?? 0), 0);
    return { t, fp, n: mine.length };
  }).sort((a, b) => b.fp - a.fp);
  const top = Math.max(1, ...board.map((b) => b.fp));
  const tfLabel = TIMEFRAMES.find((x) => x.k === tf)?.label ?? '';
  const posLabel = pos === 'ALL' ? '' : pos === 'G' ? ' · goalies' : ` · ${pos} only`;

  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute hover:text-slate-200'}`;

  return (
    <div className="space-y-4">
      <div className="card p-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <div className="label">Fantasy points · {tfLabel}{posLabel}</div>
          <div className="text-[11px] text-mute">{scope === 'starters' ? 'current starters only' : 'everyone on the roster'}</div>
        </div>
        <div className="space-y-1.5">
          {board.map((b, i) => {
            const you = b.t.id === myId;
            return (
              <div key={b.t.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${you ? 'bg-gold/[.08] ring-1 ring-inset ring-gold/25' : 'bg-white/[.03]'}`}>
                <span className={`num w-7 shrink-0 text-center text-[11px] font-bold ${i === 0 ? 'text-gold' : 'text-mute'}`}>{ord(i + 1)}</span>
                <TeamBadge team={b.t} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm font-semibold leading-tight">
                      <span>{b.t.name}</span>
                      {you && <span className="rounded-full bg-gold/20 px-1.5 text-[10px] font-bold uppercase tracking-wide text-gold">You</span>}
                    </div>
                    <div className="num shrink-0 font-display text-lg font-extrabold leading-none">{fmtPts(b.fp, 1)}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * b.fp) / top)}%`, background: `linear-gradient(90deg, color-mix(in oklab, ${b.t.color} 70%, white 10%), ${b.t.color})` }} />
                    </div>
                    <div className="num shrink-0 text-[10px] text-mute">{b.n} {b.n === 1 ? 'player' : 'players'} · {b.n ? fmtPts(b.fp / b.n, 1) : '–'} each</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="scroll-x flex items-center gap-1">
          {POSITIONS.map((x) => <button key={x} className={`tab px-2.5 py-1 ${pos === x ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPos(x)}>{x === 'ALL' ? 'All' : x}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!proj && <button className={chip(perGame)} onClick={() => setPerGame(!perGame)} title="Every counting stat per game played">Per game</button>}
          {!pg && (
            <>
              <span className="ml-1 text-[11px] text-mute">Team rows:</span>
              <button className={chip(foot === 'total')} onClick={() => setFoot('total')}>Totals</button>
              <button className={chip(foot === 'avg')} onClick={() => setFoot('avg')}>Per player</button>
            </>
          )}
          <span className="ml-auto text-[11px] text-mute">tap a column to sort</span>
        </div>
      </div>

      {pos !== 'G' && <CompareTable title="Skaters" rows={skaters} cols={proj ? (tf === 'ros' ? ['fp', 'gp'] : ['fp']) : SKATER} {...{ shown, order, sort, setSort, pg, sample, foot, myId }} />}
      {(pos === 'ALL' || pos === 'G') && <CompareTable title="Goalies" rows={goalies} cols={proj ? (tf === 'ros' ? ['fp', 'gp'] : ['fp']) : GOALIE} {...{ shown, order, sort, setSort, pg, sample, foot, myId }} />}
    </div>
  );
}

function CompareTable({ title, rows, cols, shown, order, sort, setSort, pg, sample, foot, myId }: {
  title: string; rows: Row[]; cols: string[]; shown: Team[]; order: Map<number, number>; sort: Sort; setSort: (s: Sort) => void;
  pg: boolean; sample: { gp: number; sog: number }; foot: 'total' | 'avg'; myId: number | null;
}) {
  // a stat this group doesn't have (sorting skaters by saves) sorts by fantasy points instead
  const text = (['name', 'team', 'pos', 'nhl'] as string[]).includes(sort.k);
  const k = text || cols.includes(sort.k) ? sort.k : 'fp';
  const desc = k === sort.k ? sort.desc : true;
  const perGameOf = (c: string) => pg && !statDef(c).rate && c !== 'gp';
  const val = (r: Row, c: string) => statValue(r.line, c, perGameOf(c), sample);

  const list = useMemo(() => {
    const textOf = (r: Row, c: TextCol): string | number => c === 'name' ? (r.p.last_name ?? r.p.name) : c === 'team' ? order.get(r.team.id) ?? 99 : c === 'pos' ? r.p.pos : r.p.nhl_team ?? 'ZZZ';
    const byFp = (a: Row, b: Row) => (b.line?.fp ?? -1e9) - (a.line?.fp ?? -1e9);
    return [...rows].sort((a, b) => {
      if (text) {
        const va = textOf(a, k as TextCol), vb = textOf(b, k as TextCol);
        const c = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
        return (desc ? -c : c) || byFp(a, b);
      }
      const va = val(a, k), vb = val(b, k);
      if (va == null && vb == null) return byFp(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (desc ? vb - va : va - vb) || byFp(a, b);
    });
  }, [rows, k, desc, text, order, pg, sample.gp, sample.sog]); // eslint-disable-line react-hooks/exhaustive-deps

  // each team's line for the group: summed, or the average player (counting stats split across his teammates);
  // rates (S%, SV%, GAA) come off the summed totals either way
  const teamRows = shown.map((t) => {
    const mine = rows.filter((r) => r.team.id === t.id);
    const sum = sumLines(mine.map((r) => r.line));
    const n = mine.length;
    const v = (c: string) => {
      const x = statValue(sum, c, perGameOf(c), { gp: 1, sog: 1 });
      if (x == null || !n) return n ? x : null;
      return foot === 'avg' && !pg && !statDef(c).rate ? x / n : x;
    };
    return { t, n, vals: Object.fromEntries(cols.map((c) => [c, v(c)])) as Record<string, number | null> };
  });
  if (!text) teamRows.sort((a, b) => {
    const va = a.vals[k], vb = b.vals[k];
    if (va == null) return 1; if (vb == null) return -1;
    return desc ? vb - va : va - vb;
  });
  // the best team value in each column, lit in the league colour
  const best = Object.fromEntries(cols.map((c) => {
    const vs = teamRows.map((r) => r.vals[c]).filter((x): x is number => x != null);
    if (vs.length < 2) return [c, null];
    return [c, statDef(c).lowerIsBetter ? Math.min(...vs) : Math.max(...vs)];
  })) as Record<string, number | null>;

  const tap = (c: string) => {
    const isText = (['name', 'team', 'pos', 'nhl'] as string[]).includes(c);
    if (c === k) setSort({ k: c, desc: !desc });
    else setSort({ k: c, desc: isText ? false : !statDef(c).lowerIsBetter });
  };
  const arrow = (c: string) => (c === k ? (desc ? ' ▼' : ' ▲') : '');
  const head = (c: string, label: string, cls = '', tip?: string) => (
    <th key={c} title={tip} onClick={() => tap(c)} className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-semibold hover:text-slate-200 ${c === k ? 'text-sky-300' : ''} ${cls}`}>{label}{arrow(c)}</th>
  );
  // every cell is solid (the name cell slides over the others), so a row wears one colour end to end: a GM's own
  // rows a wash of the league colour, the team rows a shade lighter
  const cell = (you: boolean, team = false): CSSProperties => {
    const base = team ? '#182033' : '#131a2a';
    return { background: you ? `linear-gradient(rgb(var(--gold-rgb) / .10), rgb(var(--gold-rgb) / .10)), ${base}` : base };
  };
  const HEAD = '#111a31';

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
        <h3 className="h-display flex items-center gap-2 text-base text-slate-100"><span className="accent-bar h-3.5 w-1 rounded-full" />{title}</h3>
        <span className="text-[11px] text-mute">{rows.length} {rows.length === 1 ? 'player' : 'players'}</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
          <thead className="text-mute">
            <tr style={{ background: HEAD }}>
              <th style={{ background: HEAD }} className="sticky left-0 z-20 select-none whitespace-nowrap border-b border-white/[.08] px-2 py-2 text-left font-semibold">
                <button type="button" onClick={() => tap('name')} className={`hover:text-slate-200 ${k === 'name' ? 'text-sky-300' : ''}`}>Player{arrow('name')}</button>
                <span className="sm:hidden"><span className="px-1 text-white/20">·</span><button type="button" onClick={() => tap('team')} className={`hover:text-slate-200 ${k === 'team' ? 'text-sky-300' : ''}`}>Team{arrow('team')}</button></span>
              </th>
              {head('team', 'Team', 'hidden border-b border-white/[.08] text-left sm:table-cell', 'Fantasy team')}
              {head('pos', 'Pos', 'hidden border-b border-white/[.08] text-left sm:table-cell', 'Position')}
              {head('nhl', 'NHL', 'hidden border-b border-white/[.08] text-left sm:table-cell', 'NHL team')}
              {cols.map((c) => {
                const d = statDef(c);
                return head(c, `${d.short}${perGameOf(c) ? '/G' : ''}`, `border-b border-white/[.08] text-right ${c === 'fp' ? 'text-slate-200' : ''}`, d.label);
              })}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const you = r.team.id === myId;
              const bg = cell(you);
              return (
                <tr key={`${r.team.id}:${r.p.id}`}>
                  <td style={bg} className="sticky left-0 z-10 border-b border-white/[.05] py-1.5 pl-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-8 w-[3px] shrink-0 rounded-r-full" style={{ background: r.team.color }} />
                      <span className="num w-4 shrink-0 text-right text-[10px] text-mute">{i + 1}</span>
                      <Headshot p={r.p} size={26} />
                      <div className="min-w-0 max-w-[8.5rem] sm:max-w-none">
                        <PlayerTag p={r.p} className="text-[12px] leading-tight" />
                        <div className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[10px] text-mute sm:hidden">
                          <TeamBadge team={r.team} size={13} />
                          <span className={`font-bold ${you ? 'text-gold' : 'text-slate-300'}`}>{r.team.abbrev}</span>
                          <Pos p={r.p.pos} className="min-w-0 px-1 py-0 text-[9px]" />
                          <span>{r.p.nhl_team ?? 'FA'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={bg} className="hidden border-b border-white/[.05] px-2 py-1.5 sm:table-cell">
                    <span className="flex items-center gap-1.5 whitespace-nowrap" title={`${r.team.name} · ${r.team.gm_name}`}>
                      <TeamBadge team={r.team} size={18} />
                      <span className={`font-semibold ${you ? 'text-gold' : 'text-slate-300'}`}>{r.team.abbrev}</span>
                    </span>
                  </td>
                  <td style={bg} className="hidden border-b border-white/[.05] px-2 py-1.5 sm:table-cell"><Pos p={r.p.pos} className="px-1 py-0" /></td>
                  <td style={bg} className="hidden border-b border-white/[.05] px-2 py-1.5 text-mute sm:table-cell">{r.p.nhl_team ?? 'FA'}</td>
                  {cols.map((c) => (
                    <td style={bg} key={c} className={`num border-b border-white/[.05] px-2 py-1.5 text-right ${c === k ? 'font-bold text-sky-200' : c === 'fp' ? 'font-semibold text-slate-100' : ''}`}>{fmtStat(val(r, c), c, perGameOf(c))}</td>
                  ))}
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={cols.length + 4} className="p-6 text-center text-mute">No players here.</td></tr>}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4 + cols.length} className="border-t border-white/10 px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-mute" style={{ background: HEAD }}>
                  <span className="sticky left-2">{pg ? 'Each team, per game' : foot === 'avg' ? 'Each team’s average player' : 'Each team’s totals'}</span>
                </td>
              </tr>
              {teamRows.map(({ t, n, vals }) => {
                const you = t.id === myId;
                const bg = cell(you, true);
                return (
                  <tr key={t.id}>
                    <td style={bg} className="sticky left-0 z-10 border-b border-white/[.05] py-2 pl-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-8 w-[3px] shrink-0 rounded-r-full" style={{ background: t.color }} />
                        <TeamBadge team={t} size={24} />
                        <div className="min-w-0 max-w-[9.5rem] sm:max-w-none">
                          <div className={`text-[12px] font-bold leading-tight ${you ? 'text-gold' : 'text-slate-100'}`}>{t.name}</div>
                          <div className="text-[10px] text-mute">{t.gm_name} · {n} {n === 1 ? 'player' : 'players'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={bg} className="hidden border-b border-white/[.05] px-2 py-2 sm:table-cell"><span className={`font-semibold ${you ? 'text-gold' : 'text-slate-300'}`}>{t.abbrev}</span></td>
                    <td style={bg} className="hidden border-b border-white/[.05] sm:table-cell" />
                    <td style={bg} className="hidden border-b border-white/[.05] sm:table-cell" />
                    {cols.map((c) => {
                      const v = vals[c];
                      const top = v != null && best[c] != null && v === best[c];
                      const dp = foot === 'avg' || pg ? Math.max(statDef(c).dp ?? 1, 1) : statDef(c).dp;
                      const shownV = v == null ? '–' : statDef(c).rate ? fmtStat(v, c) : (c === 'pm' && v > 0 ? '+' : '') + v.toFixed(dp ?? 0);
                      return <td style={bg} key={c} className={`num border-b border-white/[.05] px-2 py-2 text-right font-bold ${top ? 'text-gold' : 'text-slate-200'}`}>{shownV}</td>;
                    })}
                  </tr>
                );
              })}
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
