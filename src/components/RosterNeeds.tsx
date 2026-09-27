// Where a draft roster stands: each starting slot with who fills it, the gaps, and bench room. Used in the
// mock draft and the live draft room so a GM can watch the team balance out as the picks land.
import type { Player } from '../lib/types';
import { DEPTH_POS, FLEX, needsOf, START_SLOTS, type Needs, type StartSlot } from '../lib/draftsim';
import { Pos } from './ui';

const SLOT_COLOR: Record<StartSlot, string> = { C: 'rgba(56,189,248,.35)', LW: 'rgba(52,211,153,.35)', RW: 'rgba(167,139,250,.35)', D: 'rgba(251,191,36,.35)', Util: 'rgba(148,163,184,.35)', G: 'rgba(251,113,133,.35)' };

export function NeedsLine({ n }: { n: Needs }) {
  if (n.gaps.length) return <span>Starters still need <b className="text-amber-200">{n.gaps.join(', ')}</b>{n.depthGaps.length ? <span className="text-mute"> · depth after that: {n.depthGaps.join(', ')}</span> : null}</span>;
  if (n.depthGaps.length) return <span><span className="text-emerald-300">Starters full</span> · depth still needs <b className="text-sky-200">{n.depthGaps.join(', ')}</b></span>;
  return <span className="text-emerald-300">Balanced: every position at target{n.flexOpen ? `, ${n.flexOpen} flex left` : ''}</span>;
}

// one bar per position: starters (solid) then depth (lighter) against the balanced target
export function DepthBars({ n, caps, compact }: { n: Needs; caps?: Record<string, number>; compact?: boolean }) {
  const c = caps ?? { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2 };
  return (
    <div className={`grid gap-1.5 ${compact ? 'grid-cols-5' : 'grid-cols-5 sm:gap-2'}`}>
      {DEPTH_POS.map((k) => {
        const d = n.depth[k]; const starters = Math.min(d.have, c[k] ?? 0); const short = d.have < d.target;
        return (
          <div key={k} className={`rounded-lg px-1.5 py-1 ${short ? 'bg-amber-500/[.08]' : 'bg-emerald-500/[.08]'}`} title={`${k}: ${d.have} of ${d.target} (${c[k] ?? 0} start)`}>
            <div className="flex items-baseline justify-between text-[11px]"><span className="font-bold">{k}</span><span className={`num ${short ? 'text-amber-200' : 'text-emerald-200'}`}>{d.have}/{d.target}</span></div>
            <div className="mt-1 flex gap-[2px]">
              {Array.from({ length: d.target }).map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < starters ? 'bg-amber-300' : i < d.have ? 'bg-sky-400/80' : 'bg-white/10'}`} />)}
              {d.have > d.target && <span className="num text-[9px] text-mute">+{d.have - d.target}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// compact strip: one chip per slot with filled/needed, for the top of a player list
export function NeedsStrip({ players, caps, onPick }: { players: Player[]; caps?: Record<string, number>; onPick?: (id: number) => void }) {
  const n = needsOf(players, caps);
  return (
    <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
      {START_SLOTS.map((s) => {
        const cap = (caps ?? { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2 })[s] ?? 0;
        const full = n.open[s] === 0;
        return (
          <div key={s} className={`flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 ${full ? 'bg-white/[.05] text-mute' : 'bg-amber-500/15 text-amber-100'}`} title={n.filled[s].map((p) => p.name).join(', ') || 'empty'}>
            <span className="font-bold">{s}</span><span className="num">{n.filled[s].length}/{cap}</span>
          </div>
        );
      })}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" />
      {DEPTH_POS.map((k) => { const d = n.depth[k]; const short = d.have < d.target; return <div key={'d' + k} className={`flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 ${short ? 'bg-sky-500/15 text-sky-100' : 'bg-white/[.05] text-mute'}`} title={`${k} depth: ${d.have} of ${d.target} on the roster`}><span className="font-bold">{k}</span><span className="num">{d.have}/{d.target}</span></div>; })}
      <div className={`flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 ${n.flexOpen ? 'bg-white/[.05] text-mute' : 'bg-emerald-500/15 text-emerald-200'}`} title="Flex: any position once the targets are met"><span className="font-bold">Flex</span><span className="num">{FLEX - n.flexOpen}/{FLEX}</span></div>
      {onPick && null}
    </div>
  );
}

// the full picture for the My team tab
export function RosterNeeds({ players, caps, onPlayer, tag }: { players: Player[]; caps?: Record<string, number>; onPlayer?: (id: number) => void; tag?: (p: Player) => string | null }) {
  const n = needsOf(players, caps);
  const c = caps ?? { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2, BN: 12 };
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 text-sm"><NeedsLine n={n} /> · <span className="text-mute">{n.total} roster spot{n.total === 1 ? '' : 's'} left</span></div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {START_SLOTS.map((s) => (
          <div key={s} className="rounded-xl border border-white/[.08] p-2" style={{ background: `linear-gradient(180deg, ${SLOT_COLOR[s]}, rgba(15,23,41,.4))` }}>
            <div className="mb-1 flex items-center justify-between"><Pos p={s} /><span className="num text-xs text-mute">{n.filled[s].length}/{c[s] ?? 0}</span></div>
            {Array.from({ length: c[s] ?? 0 }).map((_, i) => {
              const p = n.filled[s][i];
              return p
                ? <button key={p.id} className="block w-full truncate text-left text-xs hover:underline" onClick={() => onPlayer?.(p.id)}>{p.last_name ?? p.name}{tag?.(p) ? <span className="ml-1 text-[10px] text-mute">{tag(p)}</span> : null}<span className="num float-right text-[10px] text-mute">{Math.round(p.proj)}</span></button>
                : <div key={i} className="rounded border border-dashed border-amber-300/40 px-1 text-[10px] text-amber-200">open</div>;
            })}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-2">
        <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold">Depth by position</span><span className="text-[11px] text-mute">solid = starter · blue = depth · target {DEPTH_POS.map((k) => `${k} ${n.depth[k].target}`).join(', ')} + {FLEX} flex</span></div>
        <DepthBars n={n} caps={c} />
      </div>
      <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-2">
        <div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold">Bench</span><span className="num text-mute">{n.bench.length}/{c.BN ?? 12}</span></div>
        {n.bench.length === 0 ? <div className="text-[11px] text-mute">Nobody on the bench yet.</div> : (
          <div className="flex flex-wrap gap-1">{n.bench.map((p) => <button key={p.id} className="chip py-0.5 text-[11px]" onClick={() => onPlayer?.(p.id)}><Pos p={p.pos} className="mr-1 px-1 text-[9px]" />{p.last_name ?? p.name}{tag?.(p) ? <span className="ml-1 text-mute">{tag(p)}</span> : null}</button>)}</div>
        )}
      </div>
    </div>
  );
}
