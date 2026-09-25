// Every stat for one team: totals by category with the team's league rank in each, and a full per-player
// table, for any timeframe (projection, last season, this season, last 30 / 14 / 7 days).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../lib/store';
import type { Player } from '../lib/types';
import { fmtPts } from '../lib/format';
import { TIMEFRAMES, fmtStat, lineFor, projLike, statDef, statValue, type Line, type Timeframe } from '../lib/playerstats';
import { PlayerFilterBar, StatTable, usePlayerFilter } from './PlayerFilters';
import { Section } from './ui';

const SKATER = ['fp', 'gp', 'g', 'a', 'pts', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow', 'shpct'];
const GOALIE = ['fp', 'gp', 'gs', 'w', 'l', 'otl', 'ga', 'sa', 'sv', 'sho', 'svp', 'gaa'];
const STARTING = new Set(['C', 'LW', 'RW', 'D', 'Util', 'G']);

type Totals = Record<string, number | null>;
// sum a group of lines into one team line, then read every stat off it the same way a player's is read
function sumLines(lines: Line[]): Line {
  const totals: Record<string, number> = {};
  let gp = 0, fp = 0;
  for (const l of lines) { gp += l.gp ?? 0; fp += l.fp; for (const [k, v] of Object.entries(l.totals)) totals[k] = (totals[k] ?? 0) + (v ?? 0); }
  return { gp, fp, totals };
}
const teamTotals = (line: Line, keys: string[]): Totals => Object.fromEntries(keys.map((k) => [k, statValue(line, k, false, { gp: 1, sog: 1 })]));

export function TeamStats({ teamId }: { teamId: number }) {
  const { teams, rosters, players, windows, season, league } = useLeague();
  const nav = useNavigate();
  const inSeason = league?.phase === 'season';
  const [tf, setTf] = useState<Timeframe>(inSeason ? 'season' : 'last');
  const [scope, setScope] = useState<'starters' | 'roster'>('roster');
  const liveOk = windows.size > 0;
  const tfOk = !liveOk && TIMEFRAMES.find((t) => t.k === tf)?.live ? 'last' : tf;
  const line = (p: Player) => lineFor(p, tfOk, windows.get(p.id), season.get(p.id));

  // totals for every GM team, so this one can be ranked
  const league8 = useMemo(() => teams.map((t) => {
    const ps = rosters.filter((r) => r.team_id === t.id && (scope === 'roster' || STARTING.has(r.slot))).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
    const sk = ps.filter((p) => p.pos !== 'G').map(line).filter((l): l is Line => !!l);
    const go = ps.filter((p) => p.pos === 'G').map(line).filter((l): l is Line => !!l);
    return { id: t.id, skaters: teamTotals(sumLines(sk), SKATER), goalies: teamTotals(sumLines(go), GOALIE), total: sumLines([...sk, ...go]).fp };
  }), [teams, rosters, players, scope, tfOk, windows, season]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = league8.find((x) => x.id === teamId);
  const rankOf = (group: 'skaters' | 'goalies', k: string) => {
    const d = statDef(k);
    const vals = league8.map((x) => x[group][k]).filter((v): v is number => v != null);
    const v = mine?.[group][k];
    if (v == null) return null;
    const better = vals.filter((o) => (d.lowerIsBetter ? o < v : o > v)).length;
    return better + 1;
  };
  const totalRank = mine ? league8.filter((x) => x.total > mine.total).length + 1 : null;

  // per-player table, reusing the Players page machinery
  const pf = usePlayerFilter({ tf: tfOk });
  const roster = useMemo(() => rosters.filter((r) => r.team_id === teamId && (scope === 'roster' || STARTING.has(r.slot))).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p), [rosters, players, teamId, scope]);
  const list = useMemo(() => pf.apply(roster), [pf.apply, roster]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTfBoth = (k: Timeframe) => { setTf(k); pf.set({ tf: k }); };

  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute hover:text-slate-200'}`;
  const rankCls = (r: number | null) => r === 1 ? 'bg-gold/20 text-gold' : r === 2 ? 'bg-white/15 text-slate-100' : r === 3 ? 'bg-orange-500/20 text-orange-200' : r === teams.length ? 'bg-red-500/15 text-red-200' : 'bg-white/[.06] text-mute';
  const Tile = ({ group, k }: { group: 'skaters' | 'goalies'; k: string }) => {
    const v = mine?.[group][k];
    const r = rankOf(group, k);
    const d = statDef(k);
    return (
      <div className="rounded-xl bg-white/[.04] px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] text-mute"><span title={d.label}>{d.short}</span>{r && <span className={`num rounded-full px-1.5 font-bold ${rankCls(r)}`}>{r}{['st', 'nd', 'rd'][r - 1] ?? 'th'}</span>}</div>
        <div className="num text-base font-bold">{fmtStat(v, k)}</div>
      </div>
    );
  };
  const projOnly = projLike(tfOk);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="scroll-x flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button key={t.k} disabled={t.live && !liveOk} title={t.live && !liveOk ? 'Once the season starts' : t.label}
              className={`${chip(tfOk === t.k)} disabled:opacity-35`} onClick={() => setTfBoth(t.k)}>{t.short}</button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <button className={chip(scope === 'roster')} onClick={() => setScope('roster')}>Whole roster</button>
          <button className={chip(scope === 'starters')} onClick={() => setScope('starters')}>Starters</button>
        </div>
      </div>

      <Section title={`Team totals · ${TIMEFRAMES.find((t) => t.k === tfOk)?.label}`} right={totalRank && <span className="text-xs text-mute">rank among {teams.length} teams in each stat</span>}>
        <div className="card p-3">
          <div className="mb-3 flex items-baseline gap-3">
            <div><div className="text-[10px] uppercase tracking-wider text-mute">Fantasy points</div><div className="num font-display text-3xl font-extrabold">{fmtPts(mine?.total ?? 0, 1)}</div></div>
            {totalRank && <span className={`num rounded-full px-2 py-0.5 text-sm font-bold ${rankCls(totalRank)}`}>{totalRank}{['st', 'nd', 'rd'][totalRank - 1] ?? 'th'} of {teams.length}</span>}
            <span className="text-xs text-mute">{scope === 'starters' ? 'current starters only' : 'everyone on the roster'}{projOnly ? ' · projections carry only a points total' : ''}</span>
          </div>
          {!projOnly && (
            <>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mute">Skaters</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">{SKATER.map((k) => <Tile key={k} group="skaters" k={k} />)}</div>
              <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-mute">Goalies</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">{GOALIE.map((k) => <Tile key={k} group="goalies" k={k} />)}</div>
            </>
          )}
          {projOnly && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[['Skaters', mine?.skaters.fp], ['Goalies', mine?.goalies.fp]].map(([k, v]) => <div key={String(k)} className="rounded-xl bg-white/[.04] px-2 py-1.5"><div className="text-[10px] text-mute">{k}</div><div className="num text-base font-bold">{fmtPts(Number(v ?? 0), 0)}</div></div>)}
            </div>
          )}
        </div>
      </Section>

      <Section title="Every player" right={<span className="text-xs text-mute">tap a column to sort</span>}>
        <div className="mb-2"><PlayerFilterBar pf={pf} compact hideSearch /></div>
        <StatTable list={list} pf={pf} onPlayer={(id) => nav(`/player/${id}`)} />
      </Section>
    </div>
  );
}
