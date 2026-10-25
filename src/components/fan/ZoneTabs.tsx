// A fan zone's pages (25 October 2026): the overview, the analysis, the outlook, the history, and the pulse at the end,
// each its own link (so each unfurls with its own picture through worker/fans.ts). Drawn in the club's colour.
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';

export type ZoneTab = [key: string, label: string];

export function ZoneTabs({ base, tabs, current, pulse }: { base: string; tabs: ZoneTab[]; current: string; pulse: string }) {
  return (
    <nav aria-label="Pages" className="scroll-x -mx-1 flex gap-1.5 px-1">
      {tabs.map(([k, label]) => {
        const on = k === current;
        return (
          <Link key={k} to={k ? `${base}/${k}` : base} aria-current={on ? 'page' : undefined}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-bold transition ${on ? 'shadow-[0_8px_22px_-12px_rgb(var(--club-rgb)/.9)]' : 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.08]'}`}
            style={on ? { background: 'rgb(var(--club-rgb))', color: 'var(--club-ink, #fff)' } : undefined}>{label}</Link>
        );
      })}
      <Link to={pulse} className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[.04] px-3.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/[.08]"><Activity className="h-3.5 w-3.5" style={{ color: 'var(--club)' }} />Pulse</Link>
    </nav>
  );
}
