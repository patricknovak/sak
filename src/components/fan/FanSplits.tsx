// The fan zone's splits and style (24 October 2026): the record cut every way that tells a story (home and road, the
// division, playoff teams, rest, overtime, margins, the month, the situations in a game, by period), and the NHL's
// tracking numbers (speed, shot speed, zone time, where the shots come from) read in words.
import { useState } from 'react';
import type { Splits, Split, TrackLine } from '../../lib/fanDeep';
import type { FanTracking } from '../../lib/fanZone';
import { Chips, Head, RankChip, ShareBar, pctStr } from './kit';

type Tab = 'situations' | 'venue' | 'opponents' | 'schedule' | 'months';
export function FanSplits({ sp }: { sp: Splits }) {
  const tabs = ([['situations', 'In the game'], ['venue', 'Home and road'], ['opponents', 'Opponents'], ['schedule', 'Rest and margins'], ['months', 'By month']] as const).filter(([k]) => sp[k].length);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'venue');
  if (!tabs.length) return null;
  const rows = sp[tab];
  return (
    <section className="space-y-3">
      <Head id="splits" title="Splits" sub="The record cut every way that tells a story. The bar is points percentage; the tick is .500." />
      <Chips label="Split" items={tabs} value={tab} onChange={setTab} />
      <div className="card divide-y divide-white/[.05] p-1">
        {rows.map((s) => <SplitRow key={s.label} s={s} />)}
      </div>
      {sp.periods.length > 0 && (
        <div className="card p-4">
          <b className="text-white">Goals by period</b>
          <div className="mt-3 space-y-2.5">
            {sp.periods.map((p) => {
              const max = Math.max(1, ...sp.periods.flatMap((x) => [x.gf, x.ga]));
              const diff = p.gf - p.ga;
              return (
                <div key={p.label} className="flex items-center gap-2 text-sm">
                  <span className="w-7 shrink-0 font-bold text-slate-300">{p.label}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5"><div className="h-2 rounded-full" style={{ width: `${(p.gf / max) * 100}%`, background: 'rgb(var(--club-rgb))', minWidth: 3 }} /><span className="num text-[11px] text-slate-300">{p.gf}</span></div>
                    <div className="flex items-center gap-1.5"><div className="h-2 rounded-full bg-slate-400/60" style={{ width: `${(p.ga / max) * 100}%`, minWidth: 3 }} /><span className="num text-[11px] text-mute">{p.ga}</span></div>
                  </div>
                  <span className={`num w-9 shrink-0 text-right font-bold ${diff > 0 ? 'text-emerald-300' : diff < 0 ? 'text-red-300' : 'text-slate-300'}`}>{diff > 0 ? '+' : ''}{diff}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-3 text-[11px] text-mute"><span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: 'rgb(var(--club-rgb))' }} />For</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400/60" />Against</span></div>
        </div>
      )}
    </section>
  );
}

function SplitRow({ s }: { s: Split }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="min-w-0 flex-1 text-slate-200">{s.label}{s.note && <span className="block text-[11px] text-mute">{s.note}</span>}</span>
        <span className="num font-semibold text-white">{s.w}-{s.l}-{s.otl}</span>
        <span className={`num w-11 text-right text-xs font-bold ${s.pct >= 0.6 ? 'text-emerald-300' : s.pct < 0.45 ? 'text-red-300' : 'text-slate-300'}`}>{pctStr(s.pct)}</span>
      </div>
      <div className="mt-1.5"><ShareBar value={s.pct} mark={0.5} tone={s.pct >= 0.6 ? 'good' : s.pct < 0.45 ? 'bad' : 'club'} /></div>
    </div>
  );
}

export function FanStyle({ lines, tracking }: { lines: TrackLine[]; tracking: FanTracking | null | undefined }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const areas = (tracking?.areas ?? []).filter((a) => a.shots != null).sort((a, b) => (b.shots ?? 0) - (a.shots ?? 0));
  const total = areas.reduce((s, a) => s + (a.shots ?? 0), 0);
  return (
    <section className="space-y-3">
      <Head id="style" title="How they play" sub="From the NHL's player and puck tracking: speed, shot speed, where the shots come from and where the game is played. Ranks are among the 32." />
      <div className="card divide-y divide-white/[.05] p-1">
        {lines.map((l) => (
          <div key={l.label} className="px-3 py-2.5">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 text-slate-200">{l.label}</span>
              <span className={`num font-bold ${l.tone === 'good' ? 'text-emerald-200' : l.tone === 'bad' ? 'text-red-200' : 'text-white'}`}>{l.value}</span>
              <RankChip rank={l.rank} />
            </div>
            {l.note && <p className="mt-0.5 text-[12px] leading-snug text-mute">{l.note}</p>}
          </div>
        ))}
      </div>
      {areas.length > 0 && total > 0 && (
        <div className="card p-4">
          <b className="text-white">Where the shots come from</b>
          <div className="mt-2 space-y-1.5">
            {(all ? areas : areas.slice(0, 8)).map((a) => (
              <div key={a.area} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 truncate text-slate-200">{a.area}</span>
                <span className="min-w-0 flex-1"><ShareBar value={(a.shots ?? 0) / (areas[0].shots || 1)} /></span>
                <span className="num w-8 shrink-0 text-right text-white">{a.shots}</span>
                <RankChip rank={a.rank} />
              </div>
            ))}
          </div>
          {areas.length > 8 && <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm font-semibold text-sky-300">{all ? 'The top eight' : `All ${areas.length} areas`}</button>}
          <p className="mt-2 text-[11px] text-mute">Shots on goal from each area of the ice this season, and where that count ranks among the 32 clubs.</p>
        </div>
      )}
    </section>
  );
}
