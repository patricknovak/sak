import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLeague } from '../lib/store';
import { TeamBadge } from './ui';

// one GM, or all of them: a pill that opens the league's people (the chat's filter, the league's transactions, the
// players table's "vs available"), each with their badge, team and whether they're online
export function GmPicker({ value, onChange, allLabel = 'Every GM', spectators = true, allowAll = true, className = '' }: {
  value: number | null; onChange: (id: number | null) => void; allLabel?: string; spectators?: boolean; allowAll?: boolean; className?: string;
}) {
  const { me, teams, spectators: specs, online } = useLeague();
  const people = [...teams, ...(spectators ? specs : [])];
  const cur = people.find((t) => t.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('touchstart', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); };
  }, [open]);
  const row = (active: boolean) => `flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm ${active ? 'bg-white/10 font-semibold' : 'hover:bg-white/[.06]'}`;
  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-2.5 text-sm font-semibold transition ${cur ? 'bg-white text-ice' : 'border border-white/[.08] bg-white/[.05] text-slate-200'}`}>
        {cur ? <TeamBadge team={cur} size={20} /> : <span className="grid h-5 w-5 place-items-center text-sm">👥</span>}
        <span className="max-w-[7.5rem] truncate">{cur ? cur.gm_name : allLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="animate-pop absolute left-0 top-full z-30 mt-1.5 max-h-[60vh] w-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#121a2e]/95 p-1.5 shadow-2xl backdrop-blur-xl">
          {allowAll && (
            <button type="button" onClick={() => { onChange(null); setOpen(false); }} className={row(!cur)}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[.06] text-base">👥</span>{allLabel}
            </button>
          )}
          {people.map((t) => (
            <button type="button" key={t.id} onClick={() => { onChange(t.id); setOpen(false); }} className={row(cur?.id === t.id)}>
              <TeamBadge team={t} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{t.gm_name}{t.id === me?.id ? ' (you)' : ''}</span><span className="block truncate text-xs text-mute">{t.role === 'spectator' ? 'Spectator' : t.name}</span></span>
              {online.has(t.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="Online" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
