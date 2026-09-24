import { useEffect, useState, type ReactNode } from 'react';
import confetti from 'canvas-confetti';

// shrinking ring around the team on the clock
export function ClockRing({ frac, color, size = 56, children }: { frac: number; color: string; size?: number; children: ReactNode }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  const stroke = f < 0.12 ? '#ef2a4f' : f < 0.33 ? '#f7c548' : color;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} style={{ transition: 'stroke-dashoffset .5s linear, stroke .3s', filter: `drop-shadow(0 0 6px ${stroke})` }} />
      </svg>
      {children}
    </div>
  );
}

// a burst of confetti in the drafting team's colours
export function celebrate(colors: string[], big = false) {
  try {
    const base = { colors, disableForReducedMotion: true, zIndex: 70 };
    confetti({ ...base, particleCount: big ? 160 : 60, spread: big ? 100 : 70, startVelocity: big ? 48 : 36, origin: { y: 0.25 } });
    if (big) setTimeout(() => { confetti({ ...base, particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } }); confetti({ ...base, particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } }); }, 250);
  } catch { /* no canvas */ }
}

// draft board cells tinted by position, like the big boards on draft night
export const POS_BG: Record<string, string> = {
  C: 'linear-gradient(180deg, rgba(56,189,248,.28), rgba(56,189,248,.12))', LW: 'linear-gradient(180deg, rgba(52,211,153,.28), rgba(52,211,153,.12))',
  RW: 'linear-gradient(180deg, rgba(167,139,250,.30), rgba(167,139,250,.12))', D: 'linear-gradient(180deg, rgba(251,191,36,.28), rgba(251,191,36,.10))',
  G: 'linear-gradient(180deg, rgba(251,113,133,.30), rgba(251,113,133,.12))',
};

// render just one layout (phone tabs or the desktop grid) instead of hiding the other with CSS
export function useWide() {
  const mq = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(mq).matches);
  useEffect(() => {
    const m = window.matchMedia(mq);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

