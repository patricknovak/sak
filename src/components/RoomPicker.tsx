import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLeague } from '../lib/store';
import { useBrand } from '../lib/brand';
import type { Lounge } from '../lib/lounge';

// which room the chat shows: this pool's own chat or one of its lounges (migration 333), as one pill in the chat's
// filter row (24 October 2026, Patrick: the chat stacked three bars over the messages; the lounges' own row folded in
// here). The pill shows the room you're in; a gold dot says another room has posts today.
export function RoomPicker({ lounges, room, onChange }: { lounges: Lounge[]; room: Lounge | null; onChange: (key: string | null) => void }) {
  const { league } = useLeague();
  const brand = useBrand();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('touchstart', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const elsewhere = lounges.some((l) => l.key !== room?.key && l.today > 0);
  const pick = (key: string | null) => { onChange(key); setOpen(false); };
  const row = (active: boolean) => `flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm ${active ? 'bg-white/10 font-semibold' : 'hover:bg-white/[.06]'}`;
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Room: ${room ? `the ${room.name} lounge` : `${league?.name ?? 'your pool'}'s chat`}. Change room`}
        className={`relative flex items-center gap-1 rounded-full py-1.5 pl-2 pr-2 text-sm font-bold transition ${room ? 'bg-white text-ice' : 'bg-gold text-[#0b1220] shadow-[0_8px_20px_-10px_rgb(var(--gold-rgb)/.9)]'}`}>
        <span>{room ? room.emoji : '💬'}</span>
        <span className="max-w-[5.5rem] truncate">{room ? room.name : brand.short}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        {elsewhere && !open && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-[#070b16]" aria-label="New posts in another room today" />}
      </button>
      {open && (
        <div className="animate-pop absolute left-0 top-full z-30 mt-1.5 max-h-[60vh] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#121a2e]/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <button type="button" onClick={() => pick(null)} className={row(!room)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gold/15 text-base ring-1 ring-gold/30">💬</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{league?.name ?? 'Our chat'}</span><span className="block text-xs text-mute">Your league’s own chat</span></span>
          </button>
          <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.14em] text-mute">Lounges, shared with other pools</div>
          {lounges.map((l) => (
            <button type="button" key={l.key} onClick={() => pick(l.key)} className={row(room?.key === l.key)}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[.06] text-base">{l.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">The {l.name} lounge</span>
                <span className="block truncate text-xs text-mute">{l.here ? (l.today ? `${l.today} post${l.today === 1 ? '' : 's'} today` : 'Quiet today') : `Through ${(l.pools ?? []).map((p) => p.name).join(', ') || 'another pool'}`}</span>
              </span>
              {l.today > 0 && room?.key !== l.key && <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
