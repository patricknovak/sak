import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Player, Team } from '../lib/types';
import { readable, teamLogo } from '../lib/format';

export function TeamBadge({ team, size = 32, ring }: { team?: Team; size?: number; ring?: boolean }) {
  if (!team) return <div className="rounded-full bg-boards" style={{ width: size, height: size }} />;
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full ${ring ? 'ring-2 ring-white/80' : ''}`}
      style={{ width: size, height: size, background: `radial-gradient(circle at 30% 25%, ${team.color}ee, ${team.color}88)`, fontSize: size * 0.5 }}
      title={team.name}
    >
      <span className="leading-none">{team.emoji}</span>
    </div>
  );
}

export function TeamName({ team, className = '' }: { team?: Team; className?: string }) {
  if (!team) return <span className={className}>Free agent</span>;
  return <span className={`font-semibold ${className}`} style={{ color: readable(team.color) }}>{team.name}</span>;
}

export function Headshot({ p, size = 40 }: { p?: Player; size?: number }) {
  const [err, setErr] = useState(false);
  if (!p?.headshot || err) {
    return (
      <div className="grid shrink-0 place-items-center rounded-full bg-boards font-display text-mute" style={{ width: size, height: size, fontSize: size * 0.38 }}>
        {p ? (p.first?.[0] ?? '') + (p.last_name?.[0] ?? '') : '?'}
      </div>
    );
  }
  return (
    <img src={p.headshot} alt="" loading="lazy" onError={() => setErr(true)}
      className="shrink-0 rounded-full bg-gradient-to-b from-boards to-rink object-cover" style={{ width: size, height: size }} />
  );
}

export function NhlLogo({ abbr, size = 18 }: { abbr?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  if (!abbr || err) return null;
  return <img src={teamLogo(abbr)} alt={abbr} width={size} height={size} onError={() => setErr(true)} className="inline-block shrink-0" />;
}

const POS_COLORS: Record<string, string> = {
  C: 'bg-sky-500/15 text-sky-300', LW: 'bg-emerald-500/15 text-emerald-300', RW: 'bg-violet-500/15 text-violet-300',
  D: 'bg-amber-500/15 text-amber-300', G: 'bg-rose-500/15 text-rose-300', Util: 'bg-slate-500/20 text-slate-300',
  BN: 'bg-slate-700/40 text-slate-400', IR: 'bg-red-900/40 text-red-300',
};
export function Pos({ p, className = '' }: { p: string; className?: string }) {
  return <span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${POS_COLORS[p] ?? POS_COLORS.BN} ${className}`}>{p}</span>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`} />;
}

export function Empty({ icon = '🏒', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="text-sm text-mute">{children}</div>}
    </div>
  );
}

export function Section({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="h-display text-lg text-slate-100">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// bottom sheet on phones, centred dialog on desktop
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className={`animate-slideup pb-safe max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-rink sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-rink/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto h-1 w-10 rounded-full bg-line sm:hidden absolute left-1/2 top-1.5 -translate-x-1/2" />
          <div className="min-w-0 truncate font-semibold">{title}</div>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ── toasts
type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-safe">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-slideup pointer-events-auto max-w-md rounded-2xl px-4 py-2.5 text-sm font-medium shadow-2xl ${
            t.kind === 'err' ? 'bg-red-600 text-white' : t.kind === 'info' ? 'bg-sky-500 text-ice' : 'bg-emerald-500 text-ice'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// run an async action with toast feedback
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message || 'Something went wrong', 'err');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm">
      <span className={`relative h-6 w-10 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-boards border border-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-boards/60 px-3 py-2">
      <div className="label">{label}</div>
      <div className="font-display text-2xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}
