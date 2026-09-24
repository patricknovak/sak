import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Player, Team } from '../lib/types';
import { NHL_COLORS, readable, teamLogo } from '../lib/format';

export function TeamBadge({ team, size = 32, ring }: { team?: Team; size?: number; ring?: boolean }) {
  if (!team) return <div className="rounded-full bg-boards" style={{ width: size, height: size }} />;
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full ${ring ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-ice' : ''}`}
      style={{
        width: size, height: size, fontSize: size * 0.5,
        background: `radial-gradient(circle at 32% 24%, color-mix(in oklab, ${team.color} 55%, white) 0%, ${team.color} 45%, color-mix(in oklab, ${team.color} 55%, black) 100%)`,
        boxShadow: `inset 0 -${Math.max(2, size / 12)}px ${size / 5}px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.45), 0 ${size / 8}px ${size / 3}px -${size / 6}px ${team.color}`,
      }}
      title={team.name}
    >
      <span className="leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,.5)]">{team.emoji}</span>
    </div>
  );
}

// a team's name in its colour; with `link` it opens that team's page
export function TeamName({ team, className = '', link }: { team?: Team; className?: string; link?: boolean }) {
  if (!team) return <span className={className}>Free agent</span>;
  if (link) {
    return (
      <Link to={`/team/${team.id}`} onClick={(e) => e.stopPropagation()} className={`font-semibold underline-offset-2 hover:underline ${className}`} style={{ color: readable(team.color) }}>
        {team.name}
      </Link>
    );
  }
  return <span className={`font-semibold ${className}`} style={{ color: readable(team.color) }}>{team.name}</span>;
}

export function Headshot({ p, size = 40 }: { p?: Player; size?: number }) {
  const [err, setErr] = useState(false);
  const c = (p?.nhl_team && NHL_COLORS[p.nhl_team]) || '#243152';
  const bg = `radial-gradient(circle at 50% 30%, color-mix(in oklab, ${c} 70%, white 10%), color-mix(in oklab, ${c} 55%, #070c18) 75%)`;
  if (!p?.headshot || err) {
    return (
      <div className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white/80 ring-1 ring-white/10" style={{ width: size, height: size, fontSize: size * 0.38, background: bg }}>
        {p ? (p.first?.[0] ?? '') + (p.last_name?.[0] ?? '') : '?'}
      </div>
    );
  }
  return (
    <img src={p.headshot} alt="" loading="lazy" onError={() => setErr(true)}
      className="shrink-0 rounded-full object-cover ring-1 ring-white/15" style={{ width: size, height: size, background: bg }} />
  );
}

export function NhlLogo({ abbr, size = 18 }: { abbr?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  if (!abbr || err) return null;
  return <img src={teamLogo(abbr)} alt={abbr} width={size} height={size} onError={() => setErr(true)} className="inline-block shrink-0" />;
}

const POS_COLORS: Record<string, string> = {
  C: 'bg-sky-400/15 text-sky-300 ring-sky-400/25', LW: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/25', RW: 'bg-violet-400/15 text-violet-300 ring-violet-400/25',
  D: 'bg-amber-400/15 text-amber-300 ring-amber-400/25', G: 'bg-rose-400/15 text-rose-300 ring-rose-400/25', Util: 'bg-slate-400/15 text-slate-300 ring-slate-400/25',
  BN: 'bg-white/[.04] text-slate-400 ring-white/10', IR: 'bg-red-500/15 text-red-300 ring-red-400/25',
};
export function Pos({ p, className = '' }: { p: string; className?: string }) {
  return <span className={`inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide ring-1 ring-inset ${POS_COLORS[p] ?? POS_COLORS.BN} ${className}`}>{p}</span>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`} />;
}

export function Empty({ icon = '🏒', title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-white/[.04] text-4xl ring-1 ring-white/10">{icon}</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="text-sm text-mute">{children}</div>}
    </div>
  );
}

export function Section({ title, right, children, className = '', icon }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <h2 className="h-display flex items-center gap-2 text-lg text-slate-100">
          {icon ?? <span className="h-4 w-1 rounded-full bg-gradient-to-b from-goal to-blue" />}
          {title}
        </h2>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        className={`animate-slideup pb-safe max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-white/10 bg-gradient-to-b from-[#16213b] to-rink shadow-[0_-20px_60px_-20px_rgba(0,0,0,.8)] sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/[.07] bg-[#16213b]/90 px-4 pb-3 pt-4 backdrop-blur-xl">
          <div className="absolute left-1/2 top-1.5 mx-auto h-1 w-10 -translate-x-1/2 rounded-full bg-white/20 sm:hidden" />
          <div className="min-w-0 truncate text-[15px] font-bold">{title}</div>
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
          <div key={t.id} className={`animate-slideup pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur-xl ${
            t.kind === 'err' ? 'border-red-400/30 bg-red-600/90 text-white' : t.kind === 'info' ? 'border-sky-300/30 bg-sky-500/90 text-ice' : 'border-emerald-300/30 bg-emerald-500/90 text-ice'}`}>
            <span>{t.kind === 'err' ? '⚠️' : t.kind === 'info' ? '💬' : '✅'}</span>{t.text}
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
    <button type="button" onClick={() => onChange(!on)} className="flex min-h-10 items-center gap-2 text-sm">
      <span className={`relative h-6 w-10 rounded-full transition ${on ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_14px_-2px_rgba(52,211,153,.7)]' : 'border border-white/10 bg-white/[.06]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.04] px-3 py-2">
      <div className="label">{label}</div>
      <div className="num font-display text-2xl font-extrabold leading-tight">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

// page title with an icon tile and optional subtitle/actions
export function PageHeader({ icon, title, sub, right }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-white/15 to-white/[.03] text-white ring-1 ring-white/15 shadow-[0_10px_24px_-12px_rgba(76,195,255,.6)]">{icon}</div>
      <div className="min-w-0 flex-1">
        <h1 className="h-display text-shine truncate text-[26px] leading-none">{title}</h1>
        {sub && <div className="mt-1 text-sm text-mute">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// arena scoreboard countdown: DD HH MM SS tiles
export function Countdown({ ms, size = 'lg' }: { ms: number; size?: 'md' | 'lg' }) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const parts = [
    { v: Math.floor(t / 86400), l: 'days' }, { v: Math.floor((t % 86400) / 3600), l: 'hrs' },
    { v: Math.floor((t % 3600) / 60), l: 'min' }, { v: t % 60, l: 'sec' },
  ];
  const big = size === 'lg';
  return (
    <div className="flex items-end gap-1.5">
      {parts.map((p, i) => (
        <div key={p.l} className="flex items-end gap-1.5">
          <div className="flex flex-col items-center">
            <div className={`num relative grid place-items-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-[#1b2745] to-[#0b1222] font-display font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_8px_18px_-10px_rgba(0,0,0,.9)] ${big ? 'h-14 w-14 text-[34px]' : 'h-10 w-10 text-2xl'}`}>
              <span className="absolute inset-x-0 top-1/2 h-px bg-black/50" />
              {String(p.v).padStart(2, '0')}
            </div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-[.18em] text-mute">{p.l}</div>
          </div>
          {i < 3 && <div className={`pb-5 font-display font-bold text-white/30 ${big ? 'text-2xl' : 'text-lg'}`}>:</div>}
        </div>
      ))}
    </div>
  );
}

// 1/2/3 get medals, everyone else a plain number
export function Rank({ n }: { n: number }) {
  const medal = ['from-[#fff1b8] via-[#f7c548] to-[#b97c06] text-[#3b2a00]', 'from-white via-[#cfd8ea] to-[#8a97b3] text-[#1b2438]', 'from-[#ffd2a8] via-[#d98b4a] to-[#8a4b1c] text-[#2e1606]'][n - 1];
  if (!medal) return <span className="num grid h-7 w-7 shrink-0 place-items-center font-display text-lg font-bold text-mute">{n}</span>;
  return <span className={`num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br font-display text-base font-extrabold shadow-[0_4px_12px_-4px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.6)] ${medal}`}>{n}</span>;
}

// avatar stack for "who's here"
export function TeamStack({ teams, size = 24 }: { teams: Team[]; size?: number }) {
  return (
    <div className="flex -space-x-2">
      {teams.map((t) => <div key={t.id} className="rounded-full ring-2 ring-[#0b1222]"><TeamBadge team={t} size={size} /></div>)}
    </div>
  );
}

// a gold St. Patrick coin
export function Coin({ size = 18 }: { size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full align-middle"
      style={{ width: size, height: size, fontSize: size * 0.55, background: 'radial-gradient(circle at 35% 30%, #fff5c2, #f7c548 45%, #b8860b)', boxShadow: `inset 0 -${size / 10}px ${size / 6}px rgba(120,80,0,.5), 0 0 ${size / 2}px -${size / 6}px #f7c548` }}>
      <span className="leading-none">☘️</span>
    </span>
  );
}
