// A player's outlook from the SAK projection model: the projected line, a bad-year / great-year range, the
// reasons behind the number, the last three seasons and what's left this season.
import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fmtPts } from '../lib/format';
import { rosPoints } from '../lib/playerstats';
import { PROJ_G, PROJ_SK, toneCls, toneIcon } from '../lib/projections';
import type { Player, ProjDetail } from '../lib/types';

const LBL: Record<string, string> = { g: 'G', a: 'A', pts: 'P', pm: '+/-', ppp: 'PPP', sog: 'SOG', hit: 'HIT', blk: 'BLK', pim: 'PIM', gwg: 'GWG', gs: 'GS', w: 'W', l: 'L', otl: 'OTL', sv: 'SV', ga: 'GA', sho: 'SO', svp: 'SV%' };

export function ProjOutlook({ p }: { p: Player }) {
  const { season } = useLeague();
  const [d, setD] = useState<ProjDetail | null | undefined>(undefined);
  useEffect(() => {
    setD(undefined);
    supabase.from('players').select('id,proj_stats,proj_gp,proj_meta').eq('id', p.id).maybeSingle().then(({ data }) => setD((data as ProjDetail) ?? null));
  }, [p.id]);
  if (d === undefined) return <div className="mt-3 h-24 animate-pulse rounded-xl bg-white/[.04]" />;
  const m = d?.proj_meta, st = d?.proj_stats;
  if (!m || !st) return null;
  const goalie = p.pos === 'G';
  const s = season.get(p.id);
  const ros = rosPoints(p, s);
  const lo = p.proj * m.lo, hi = p.proj * m.hi;
  const maxHist = Math.max(hi, ...m.hist.map((h) => h.fp), 1);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-white/[.08] bg-white/[.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="label">2026-27 outlook</div>
        <div className="text-[11px] text-mute">{m.age != null && `age ${m.age} · `}{goalie ? `${d.proj_gp} starts` : `${d.proj_gp} games`} · {m.fpg.toFixed(2)} pts/game</div>
      </div>
      {/* range: bad year, projection, great year */}
      <div>
        <div className="relative h-2.5 rounded-full bg-white/[.05]">
          <div className="absolute h-2.5 rounded-full bg-gradient-to-r from-red-400/40 via-sky-400/50 to-emerald-400/50" style={{ left: `${(lo / maxHist) * 100}%`, width: `${((hi - lo) / maxHist) * 100}%` }} />
          <div className="absolute -top-1 h-4.5 w-1 rounded bg-white" style={{ left: `${(p.proj / maxHist) * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px]"><span className="text-red-200">Bad year {fmtPts(lo, 0)}</span><span className="font-semibold">Projected {fmtPts(p.proj, 0)}</span><span className="text-emerald-200">Great year {fmtPts(hi, 0)}</span></div>
      </div>
      <div className="scroll-x flex gap-1.5">
        {(goalie ? PROJ_G : PROJ_SK).map((k) => (
          <div key={k} className="min-w-11 rounded-lg bg-ice px-1.5 py-1 text-center">
            <div className="text-[10px] text-mute">{LBL[k]}</div>
            <div className="num text-sm font-semibold">{st[k] == null ? '–' : k === 'svp' ? st[k].toFixed(3).replace(/^0/, '') : Math.round(st[k])}</div>
          </div>
        ))}
      </div>
      {m.factors.length > 0 && (
        <ul className="space-y-0.5 text-xs">{m.factors.map((f) => <li key={f.text} className={toneCls[f.tone]}>{toneIcon[f.tone]} <span className="text-slate-200">{f.text}</span></li>)}</ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 items-end gap-1.5">
          {[...m.hist].reverse().map((h) => (
            <div key={h.s} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="num text-[10px] text-mute">{fmtPts(h.fp, 0)}</div>
              <div className="w-full rounded-t bg-white/15" style={{ height: `${Math.max(3, (h.fp / maxHist) * 44)}px` }} />
              <div className="text-[10px] text-mute">{h.s.slice(2)} · {h.gp}gp</div>
            </div>
          ))}
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <div className="num text-[10px] font-semibold text-sky-200">{fmtPts(p.proj, 0)}</div>
            <div className="w-full rounded-t bg-sky-400/60" style={{ height: `${Math.max(3, (p.proj / maxHist) * 44)}px` }} />
            <div className="text-[10px] text-sky-200">26-27 proj</div>
          </div>
        </div>
        {s && s.gp > 0 && <div className="shrink-0 rounded-lg bg-white/[.04] px-2 py-1 text-center text-[11px]"><div className="text-mute">Rest of season</div><div className="num text-base font-bold">{fmtPts(ros, 0)}</div><div className="text-mute">{fmtPts(s.fpts, 0)} so far</div></div>}
      </div>
    </div>
  );
}
