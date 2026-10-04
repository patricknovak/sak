// Shared player filtering and sorting (Players page, draft room, mock draft): any stat, any timeframe.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLeague, useSport } from '../lib/store';
import { positionKeys } from '../lib/sport';
import { supabase } from '../lib/supabase';
import type { Player, Pos as PosT } from '../lib/types';
import { NHL_TEAMS } from '../lib/format';
import { isOut } from '../lib/lineup';
import { TIMEFRAMES, fmtStat, lineFor, minSample, projLike, statDef, statValue, statsFor, type Line, type Timeframe } from '../lib/playerstats';
import { Headshot, Pos } from './ui';
import { injuryBadge } from '../lib/format';
import { useSticky } from '../lib/sticky';

export interface Filter { q: string; pos: 'ALL' | PosT; tf: Timeframe; stat: string; perGame: boolean; hideInjured: boolean; nhl: string; minGp: number }
const DEFAULT: Filter = { q: '', pos: 'ALL', tf: 'proj', stat: 'fp', perGame: false, hideInjured: false, nhl: '', minGp: 0 };
const SKATER_COLS = ['gp', 'fp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'gwg', 'shp', 'fow', 'shpct'];
const GOALIE_COLS = ['gp', 'gs', 'fp', 'w', 'l', 'otl', 'ga', 'sa', 'sv', 'svp', 'sho', 'gaa'];

// a category league's draft value per player (category_values, migration 129): its categories, not fantasy points
const cvCache = new Map<string, Map<number, number>>();
export function useCategoryValues() {
  const { league } = useLeague();
  const key = league?.categories?.length ? `${league.league_id}:${league.categories.join(',')}` : '';
  const [cv, setCv] = useState<Map<number, number> | null>(key ? cvCache.get(key) ?? null : null);
  useEffect(() => {
    if (!key) { setCv(null); return; }
    if (cvCache.has(key)) { setCv(cvCache.get(key)!); return; }
    // a thousand rows a request (the API's cap), best first, until the last page
    (async () => {
      const m = new Map<number, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.rpc('category_values').range(from, from + 999);
        if (error) throw error;
        const rows = (data ?? []) as { player_id: number; value: number }[];
        for (const r of rows) m.set(r.player_id, Number(r.value));
        if (rows.length < 1000) break;
      }
      cvCache.set(key, m); setCv(m);
    })().catch(() => setCv(null));
  }, [key]);
  return cv;
}

// how a draft ranks a player: his category value in a category league, his projected points otherwise. A player with no
// category value (no recent season) goes below everyone who has one.
export function useDraftValue() {
  const cv = useCategoryValues();
  const on = !!cv && cv.size > 0;
  return useCallback((p: Player) => (on ? cv!.get(p.id) ?? -1e6 + p.proj / 1000 : p.proj), [on, cv]);
}

// the draft simulator's bots weigh players by a number above zero: in a category league, the category value shifted so
// the weakest valued player is 1 (no value at all: just under that); undefined in a points league, where bots use points
export function useSimValue(): ((p: Player) => number) | undefined {
  const cv = useCategoryValues();
  return useMemo(() => {
    if (!cv || !cv.size) return undefined;
    const lo = Math.min(...cv.values());
    return (p: Player) => { const v = cv.get(p.id); return v == null ? 0.5 : v - lo + 1; };
  }, [cv]);
}

// `keep` names the screen whose filters should survive the GM stepping away and back (Players, the draft room)
export function usePlayerFilter(init?: Partial<Filter>, keep?: string) {
  const { windows, season } = useLeague();
  const cv = useCategoryValues();
  const [f, setF] = useSticky<Filter>(keep ? `pf:${keep}` : null, { ...DEFAULT, ...init });
  const set = useCallback((patch: Partial<Filter>) => setF((x) => {
    const n = { ...x, ...patch };
    // a stat the other position group doesn't have goes back to fantasy points
    const d = statDef(n.stat);
    if ((n.pos === 'G' && d.skater) || (n.pos !== 'G' && d.goalie)) n.stat = 'fp';
    return n;
  }), []);
  const liveOk = windows.size > 0;   // nobody has played yet before opening night
  const tf: Timeframe = !liveOk && TIMEFRAMES.find((t) => t.k === f.tf)?.live ? 'last' : f.tf;
  const stat = projLike(tf) ? 'fp' : f.stat;
  const perGame = f.perGame && !projLike(tf);
  const goalie = f.pos === 'G';
  const d = statDef(stat);
  const line = useCallback((p: Player): Line | null => lineFor(p, tf, windows.get(p.id), season.get(p.id)), [tf, windows, season]);
  const sample = minSample(tf);
  // in a category league the projection view ranks by category value: what the league actually plays for
  const byCat = tf === 'proj' && !!cv && cv.size > 0;
  const value = useCallback((p: Player) => (byCat ? cv!.get(p.id) ?? null : statValue(line(p), stat, perGame, sample)), [byCat, cv, line, stat, perGame, sample.gp, sample.sog]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = useCallback((list: Player[]) => {
    const needle = f.q.trim().toLowerCase();
    const vals = new Map<number, number | null>();
    const dir = d.lowerIsBetter && !byCat ? 1 : -1;
    const out = list.filter((p) => f.pos === 'ALL' || (f.pos === 'G' ? p.pos === 'G' : p.elig.includes(f.pos)))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.nhl_team?.toLowerCase() === needle)
      .filter((p) => !f.nhl || p.nhl_team === f.nhl)
      .filter((p) => !f.hideInjured || !isOut(p.injury_status))
      .filter((p) => !f.minGp || projLike(tf) || (line(p)?.gp ?? 0) >= f.minGp);
    for (const p of out) vals.set(p.id, value(p));
    return out.sort((a, b) => {
      const va = vals.get(a.id), vb = vals.get(b.id);
      if (va == null && vb == null) return b.proj - a.proj;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir || b.proj - a.proj;
    });
  }, [f.q, f.pos, f.nhl, f.hideInjured, f.minGp, tf, d.lowerIsBetter, byCat, line, value]);
  const tfShort = TIMEFRAMES.find((t) => t.k === tf)!.short;
  const label = byCat ? 'cat value' : tf === 'proj' ? 'proj' : tf === 'ros' ? 'ROS' : `${d.short}${perGame && !d.rate && stat !== 'gp' ? '/GP' : ''} · ${tfShort}`;
  const fmt = useCallback((p: Player) => {
    if (!byCat) return fmtStat(value(p), stat, perGame);
    const v = value(p);
    return v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  }, [byCat, value, stat, perGame]);
  return { f, set, tf, stat, perGame, liveOk, goalie, line, value, apply, label, fmt, sample, byCat };
}
export type PlayerFilter = ReturnType<typeof usePlayerFilter>;

const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute hover:text-slate-200'}`;

// the controls: position, timeframe, stat, per-game, injured, NHL team, minimum games
export function PlayerFilterBar({ pf, compact, hideSearch, children }: { pf: PlayerFilter; compact?: boolean; hideSearch?: boolean; children?: ReactNode }) {
  const POSITIONS: ('ALL' | PosT)[] = ['ALL', ...positionKeys(useSport())];
  const { f, set, tf, stat, liveOk, goalie } = pf;
  return (
    <div className="space-y-1.5">
      {!hideSearch && <input className="input" placeholder="Search name or NHL team (e.g. TOR)" value={f.q} onChange={(e) => set({ q: e.target.value })} />}
      <div className="scroll-x flex items-center gap-1">
        {POSITIONS.map((x) => <button key={x} className={`tab px-2.5 py-1 ${f.pos === x ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => set({ pos: x })}>{x}</button>)}
        {children}
      </div>
      <div className="scroll-x flex items-center gap-1">
        {TIMEFRAMES.map((t) => (
          <button key={t.k} disabled={t.live && !liveOk} title={t.live && !liveOk ? 'Once the season starts' : t.label}
            className={`${chip(tf === t.k)} disabled:opacity-35`} onClick={() => set({ tf: t.k })}>{t.short}</button>
        ))}
      </div>
      <div className="scroll-x flex items-center gap-1.5">
        <select aria-label="Sort by stat" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs" value={stat} disabled={projLike(tf)} onChange={(e) => set({ stat: e.target.value })}>
          {tf === 'proj' ? <option value="fp">{pf.byCat ? 'Category value' : 'Projected points'}</option> : tf === 'ros' ? <option value="fp">Rest-of-season points</option> : statsFor(goalie).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        {!projLike(tf) && <button className={chip(f.perGame)} onClick={() => set({ perGame: !f.perGame })} title="Per game">/GP</button>}
        <button className={chip(f.hideInjured)} onClick={() => set({ hideInjured: !f.hideInjured })}>🚑 {f.hideInjured ? 'hidden' : 'hide'}</button>
        {!compact && (
          <select aria-label="NHL team" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs" value={f.nhl} onChange={(e) => set({ nhl: e.target.value })}>
            <option value="">All NHL teams</option>
            {Object.keys(NHL_TEAMS).sort().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {!compact && !projLike(tf) && (
          <select aria-label="Minimum games" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs" value={f.minGp} onChange={(e) => set({ minGp: Number(e.target.value) })}>
            {[0, 3, 5, 10, 20, 40, 60].map((n) => <option key={n} value={n}>{n ? `${n}+ GP` : 'Any GP'}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

// every stat for the timeframe in one scrollable table; tap a header to sort by it
export function StatTable({ list, pf, onPlayer, badge }: { list: Player[]; pf: PlayerFilter; onPlayer: (id: number) => void; badge?: (p: Player) => ReactNode }) {
  const cols = pf.goalie ? GOALIE_COLS : SKATER_COLS;
  const lines = useMemo(() => new Map(list.map((p) => [p.id, pf.line(p)])), [list, pf.line]);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-max text-xs">
        <thead className="sticky top-0 z-10 bg-[#0f172c] text-mute">
          <tr>
            <th className="px-2 py-2 text-right font-semibold">#</th>
            <th className="sticky left-0 z-10 bg-[#0f172c] px-2 py-2 text-left font-semibold">Player</th>
            {cols.map((c) => {
              const d = statDef(c);
              return <th key={c} title={d.label} onClick={() => pf.set({ stat: c })} className={`cursor-pointer px-2 py-2 text-right font-semibold hover:text-slate-200 ${pf.stat === c ? 'text-sky-300' : ''}`}>{d.short}{pf.stat === c ? (d.lowerIsBetter ? ' ▲' : ' ▼') : ''}</th>;
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[.05]">
          {list.map((p, i) => {
            const l = lines.get(p.id) ?? null;
            const b = injuryBadge(p.injury_status);
            return (
              <tr key={p.id} className="cursor-pointer hover:bg-white/[.04]" onClick={() => onPlayer(p.id)}>
                <td className="num px-2 py-1.5 text-right text-mute">{i + 1}</td>
                <td className="sticky left-0 z-[1] bg-ice px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Headshot p={p} size={26} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 whitespace-nowrap font-semibold">{p.name}{b && <span className={`chip ${b.cls}`}>{b.label}</span>}</div>
                      <div className="flex items-center gap-1 text-[10px] text-mute"><Pos p={p.pos} className="min-w-0 px-1 py-0" />{p.nhl_team ?? 'FA'}{badge?.(p)}</div>
                    </div>
                  </div>
                </td>
                {cols.map((c) => {
                  const d = statDef(c);
                  const pg = pf.perGame && !d.rate && c !== 'gp';
                  return <td key={c} className={`num px-2 py-1.5 text-right ${pf.stat === c ? 'font-bold text-sky-200' : ''}`}>{fmtStat(statValue(l, c, pg, pf.sample), c, pg)}</td>;
                })}
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={cols.length + 2} className="p-6 text-center text-mute">No players match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
