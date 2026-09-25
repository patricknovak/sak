// Small SVG charts: the points race (one line per team, team colors, legend + end labels + tap to focus,
// crosshair tooltip) and a player's game-by-game form (bars plus a rolling average line).
import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { fmtDate, fmtPts, readable } from '../lib/format';
import { TeamBadge } from './ui';

const INK = { primary: '#e7ecf7', secondary: '#b8c2d9', muted: '#8b97b5', grid: '#26324f' };
const ROLL = 5;

// fits n labels of height h into [0, H] keeping their order and nudging apart
function spread(ys: number[], h: number, H: number) {
  const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  let last = -Infinity;
  const out = new Array(ys.length).fill(0);
  for (const p of idx) { const y = Math.max(p.y, last + h); out[p.i] = y; last = y; }
  const over = out.length ? Math.max(0, Math.max(...out) - H) : 0;
  return out.map((y) => y - over);
}

export function PointsRace({ daily, focus: initial }: { daily: { team_id: number; date: string; points: number }[]; focus: number }) {
  const { team, teams } = useLeague();
  const [focus, setFocus] = useState<number>(initial);
  const [hover, setHover] = useState<number | null>(null);
  const dates = useMemo(() => [...new Set(daily.map((d) => d.date))].sort(), [daily]);
  const series = useMemo(() => teams.map((t) => {
    let acc = 0;
    const by = new Map(daily.filter((d) => d.team_id === t.id).map((d) => [d.date, Number(d.points)]));
    return { t: t.id, pts: dates.map((d) => (acc += by.get(d) ?? 0)) };
  }), [teams, daily, dates]);
  if (dates.length < 2) return <div className="p-6 text-center text-sm text-mute">The points race chart appears after a couple of game days.</div>;
  const W = 640, H = 240, P = { l: 40, r: 78, t: 10, b: 22 };
  const max = Math.max(...series.flatMap((s) => s.pts), 1);
  const x = (i: number) => P.l + (i / (dates.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = (pts: number[]) => pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const color = (t: number) => readable(team(t)?.color ?? '#888');
  const order = [...series].sort((a, b) => (a.t === focus ? 1 : 0) - (b.t === focus ? 1 : 0));
  const ends = spread(series.map((s) => y(s.pts[s.pts.length - 1])), 12, H - P.b);
  const at = hover ?? dates.length - 1;
  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Cumulative points by team" onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (dates.length - 1)))));
          }}
          onTouchMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.touches[0].clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (dates.length - 1)))));
          }}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke={INK.grid} strokeWidth={1} />
              <text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize={10} fill={INK.muted}>{Math.round(max * f)}</text></g>
          ))}
          <text x={P.l} y={H - 6} fontSize={10} fill={INK.muted}>{fmtDate(dates[0])}</text>
          <text x={W - P.r} y={H - 6} fontSize={10} fill={INK.muted} textAnchor="end">{fmtDate(dates[dates.length - 1])}</text>
          {order.map((s) => (
            <path key={s.t} d={path(s.pts)} fill="none" strokeWidth={s.t === focus ? 2.5 : 1.5} strokeLinejoin="round" strokeLinecap="round"
              stroke={color(s.t)} opacity={s.t === focus ? 1 : 0.55} style={s.t === focus ? { filter: `drop-shadow(0 0 5px ${color(s.t)})` } : undefined} />
          ))}
          {series.map((s, i) => (
            <g key={s.t} onClick={() => setFocus(s.t)} style={{ cursor: 'pointer' }}>
              <circle cx={x(dates.length - 1)} cy={y(s.pts[s.pts.length - 1])} r={s.t === focus ? 4 : 3} fill={color(s.t)} stroke="#0b1222" strokeWidth={1.5} />
              <text x={W - P.r + 8} y={ends[i] + 4} fontSize={10} fontWeight={s.t === focus ? 700 : 500} fill={s.t === focus ? INK.primary : INK.secondary}>{team(s.t)?.gm_name}</text>
            </g>
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke={INK.muted} strokeDasharray="3 3" />
              {series.map((s) => <circle key={s.t} cx={x(hover)} cy={y(s.pts[hover])} r={s.t === focus ? 4 : 2.5} fill={color(s.t)} stroke="#0b1222" strokeWidth={1.5} />)}
            </g>
          )}
        </svg>
        {hover != null && (
          <div className={`pointer-events-none absolute top-2 rounded-xl border border-white/10 bg-[#0b1222]/95 p-2 text-xs shadow-xl backdrop-blur ${hover > dates.length / 2 ? 'left-2' : 'right-2'}`}>
            <div className="mb-1 font-semibold">{fmtDate(dates[hover])}</div>
            {[...series].sort((a, b) => b.pts[at] - a.pts[at]).map((s) => (
              <div key={s.t} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color(s.t) }} /><span className={s.t === focus ? 'font-semibold' : 'text-slate-300'}>{team(s.t)?.gm_name}</span></span><span className="num">{fmtPts(s.pts[hover])}</span></div>
            ))}
          </div>
        )}
      </div>
      {/* legend: badge + name, tap to focus (identity is never color alone) */}
      <div className="mt-2 flex flex-wrap gap-1">
        {[...series].sort((a, b) => b.pts[at] - a.pts[at]).map((s, i) => (
          <button key={s.t} onClick={() => setFocus(s.t)} className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] transition ${s.t === focus ? 'bg-white/[.12] font-semibold text-white ring-1 ring-white/20' : 'bg-white/[.04] text-slate-300 hover:bg-white/[.08]'}`}>
            <TeamBadge team={team(s.t)} size={16} /><span className="num text-mute">{i + 1}</span>{team(s.t)?.gm_name}<span className="num text-mute">{fmtPts(s.pts[at])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// game-by-game fantasy points as bars, with a rolling average line over them
export function FormChart({ games, color, height = 120 }: { games: { game_id: number; date: string; fpts: number }[]; color: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, P = { l: 30, r: 8, t: 8, b: 18 };
  const n = games.length;
  if (n < 2) return null;
  const roll = games.map((_, i) => { const w = games.slice(Math.max(0, i - ROLL + 1), i + 1); return w.reduce((t, g) => t + g.fpts, 0) / w.length; });
  const max = Math.max(1, ...games.map((g) => Math.abs(g.fpts)), ...roll.map(Math.abs));
  const min = Math.min(0, ...games.map((g) => g.fpts));
  const y = (v: number) => P.t + ((max - v) / (max - min)) * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / n;
  const x = (i: number) => P.l + i * bw;
  const c = readable(color);
  const line = roll.map((v, i) => `${i ? 'L' : 'M'}${(x(i) + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fantasy points by game" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.floor((((e.clientX - r.left) / r.width) * W - P.l) / bw)))); }}>
        {[max, 0].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={INK.grid} /><text x={P.l - 5} y={y(v) + 4} textAnchor="end" fontSize={10} fill={INK.muted}>{Math.round(v)}</text></g>)}
        {games.map((g, i) => (
          <rect key={g.game_id} x={x(i) + 1} width={Math.max(1, bw - 2)} y={Math.min(y(0), y(g.fpts))} height={Math.max(1, Math.abs(y(g.fpts) - y(0)))} rx={2}
            fill={g.fpts >= 0 ? c : '#ef4444'} opacity={hover == null || hover === i ? 0.85 : 0.45} />
        ))}
        <path d={line} fill="none" stroke={INK.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <circle cx={x(hover) + bw / 2} cy={y(roll[hover])} r={4} fill={INK.primary} stroke="#0b1222" strokeWidth={1.5} />}
        <text x={P.l} y={H - 5} fontSize={10} fill={INK.muted}>{fmtDate(games[0].date)}</text>
        <text x={W - P.r} y={H - 5} fontSize={10} fill={INK.muted} textAnchor="end">{fmtDate(games[n - 1].date)}</text>
      </svg>
      {hover != null && (
        <div className={`pointer-events-none absolute top-1 rounded-lg border border-white/10 bg-[#0b1222]/95 px-2 py-1 text-xs shadow-xl ${hover > n / 2 ? 'left-8' : 'right-2'}`}>
          <div className="font-semibold">{fmtDate(games[hover].date)}</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />Game <span className="num">{fmtPts(games[hover].fpts, 1)}</span></div>
          <div className="flex items-center gap-1.5"><span className="h-0.5 w-2 bg-white" />{ROLL}-game avg <span className="num">{fmtPts(roll[hover], 2)}</span></div>
        </div>
      )}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-mute"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />points per game</span><span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-white" />{ROLL}-game average</span></div>
    </div>
  );
}

// a tiny inline trend for lists: last games as a stroke, no axes, the number beside it carries the value
export function Sparkline({ values, color, width = 72, height = 22 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values.map(Math.abs));
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - (Math.max(0, v) / max) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={readable(color)} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} fill={readable(color)} />
    </svg>
  );
}
