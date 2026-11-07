// Hot and cold: who on a roster is scoring above or below what he was expected to over the last two weeks, per game
// (lineupKit's formOf). Drawn on the Lineup tab for any team, and as a chip on each player's row (FormChip), so a GM
// sees at a glance who has earned a start and who is only there on his name.
import { useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';
import { Headshot } from '../ui';
import { SlotPill } from './bits';
import type { Form } from '../../lib/lineupKit';
import type { Player, Roster } from '../../lib/types';

type Row = { r: Roster; p: Player };
const pctLabel = (pct: number) => `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct) * 100)}%`;

// the chip on a player's row: only for the hot and the cold, steady says nothing
export function FormChip({ f }: { f: Form | null }) {
  if (!f || f.tone === 'steady') return null;
  const hot = f.tone === 'hot';
  return (
    <span title={`Last 2 weeks: ${f.recent.toFixed(2)} a game in ${f.gp} games, against ${f.base.toFixed(2)} ${f.vs === 'season' ? 'over his season before that' : 'projected'}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-px text-[9px] font-black ${hot ? 'bg-orange-400/15 text-orange-200' : 'bg-sky-400/15 text-sky-200'}`}>
      {hot ? <Flame className="h-2.5 w-2.5" /> : <Snowflake className="h-2.5 w-2.5" />}{pctLabel(f.pct)}
    </span>
  );
}

function Line({ x, f, max, onInfo }: { x: Row; f: Form; max: number; onInfo: (id: number) => void }) {
  const hot = f.pct >= 0;
  const w = Math.min(100, (Math.abs(f.pct) / max) * 100);
  return (
    <button type="button" onClick={() => onInfo(x.p.id)} className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-white/[.04]">
      <Headshot p={x.p} size={30} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="break-words text-[13px] font-semibold leading-tight text-white">{x.p.name}</span>
          <SlotPill slot={x.r.slot} size="sm" />
        </span>
        <span className="num mt-0.5 block text-[11px] leading-tight text-slate-400">
          <b className="text-slate-100">{f.recent.toFixed(2)}</b> a game in {f.gp} · {f.vs === 'season' ? 'season' : 'proj'} {f.base.toFixed(2)}
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/[.06]">
          <span className={`block h-full rounded-full ${hot ? 'bg-gradient-to-r from-orange-500/70 to-orange-300' : 'bg-gradient-to-r from-sky-500/70 to-sky-300'}`} style={{ width: `${Math.max(6, w)}%` }} />
        </span>
      </span>
      <span className={`num shrink-0 text-right text-sm font-black ${hot ? 'text-orange-200' : 'text-sky-200'}`}>{pctLabel(f.pct)}</span>
    </button>
  );
}

export function FormCard({ roster, formOf, onInfo, mine }: { roster: Row[]; formOf: (p: Player) => Form | null; onInfo: (id: number) => void; mine: boolean }) {
  const [all, setAll] = useState(false);
  const rated = roster.map((x) => ({ x, f: formOf(x.p) })).filter((r): r is { x: Row; f: Form } => !!r.f);
  const hot = rated.filter((r) => r.f.tone === 'hot').sort((a, b) => b.f.pct - a.f.pct);
  const cold = rated.filter((r) => r.f.tone === 'cold').sort((a, b) => a.f.pct - b.f.pct);
  const steady = rated.length - hot.length - cold.length;
  const max = Math.max(0.5, ...rated.map((r) => Math.abs(r.f.pct)));
  const SHOW = 4;
  const cut = (l: typeof hot) => (all ? l : l.slice(0, SHOW));
  const more = hot.length > SHOW || cold.length > SHOW;
  // a starter going cold or a bench player going hot is the line worth reading first
  const benchHot = hot.filter((r) => r.x.r.slot === 'BN').length;
  const coldStart = cold.filter((r) => r.x.r.slot !== 'BN' && r.x.r.slot !== 'IR').length;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-white/[.06] bg-gradient-to-r from-orange-500/[.08] via-transparent to-sky-500/[.08] p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Flame className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">Hot and cold · last 2 weeks</div>
          <div className="text-xs text-mute">Points a game against what each player was expected to score</div>
        </div>
      </div>
      {!rated.length ? <div className="p-3.5 text-sm text-mute">Not enough games yet: a player needs three in the last two weeks.</div> : (
        <div className="p-2.5">
          {mine && (benchHot > 0 || coldStart > 0) && (
            <div className="mb-2 rounded-xl bg-white/[.04] px-3 py-2 text-[12px] leading-snug text-slate-200">
              {benchHot > 0 && <span>{benchHot} on your bench {benchHot === 1 ? 'is' : 'are'} running hot. </span>}
              {coldStart > 0 && <span>{coldStart} of your starters {coldStart === 1 ? 'has' : 'have'} gone cold.</span>}
            </div>
          )}
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>
              <div className="mb-0.5 flex items-center gap-1.5 px-1.5 text-[10px] font-black uppercase tracking-[.16em] text-orange-200"><Flame className="h-3.5 w-3.5" /> Over-performing <span className="text-mute">({hot.length})</span></div>
              {hot.length ? cut(hot).map((r) => <Line key={r.x.p.id} x={r.x} f={r.f} max={max} onInfo={onInfo} />) : <div className="px-1.5 py-1 text-xs text-mute">Nobody running hot.</div>}
            </div>
            <div>
              <div className="mb-0.5 flex items-center gap-1.5 px-1.5 text-[10px] font-black uppercase tracking-[.16em] text-sky-200"><Snowflake className="h-3.5 w-3.5" /> Under-performing <span className="text-mute">({cold.length})</span></div>
              {cold.length ? cut(cold).map((r) => <Line key={r.x.p.id} x={r.x} f={r.f} max={max} onInfo={onInfo} />) : <div className="px-1.5 py-1 text-xs text-mute">Nobody gone cold.</div>}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 px-1.5 text-[11px] text-mute">
            <span>{steady} playing to form · within a fifth of expected</span>
            {more && <button type="button" onClick={() => setAll(!all)} className="font-semibold text-sky-300">{all ? 'Fewer' : 'Show all'}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
