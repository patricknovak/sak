// The fan zone's small pieces (24 October 2026): a section head, filter chips, a share bar, a record line, a club's mark.
// Drawn in the club's colour through the page's --club variables.
import { useState, type ReactNode } from 'react';
import { NhlLogo } from '../ui';
import { darkLogo } from '../../lib/fanVoice';

// each league's own mark, for its board (ESPN's, drawn for a dark ground and a light one)
const LEAGUE_MARK: Record<string, [string, string]> = {
  nfl: ['https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png', 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nfl.png'],
  nba: ['https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nba.png'],
  epl: ['https://a.espncdn.com/i/leaguelogos/soccer/500/23.png', 'https://a.espncdn.com/i/leaguelogos/soccer/500-dark/23.png'],
};
// a club's mark in any league: the NHL's from its own feed, the rest from ESPN's (`light` for a white tile), and the
// club's code in a ring when there is none
export function ClubMark({ league, code, logo, size = 26, light }: { league: string; code: string; logo?: string | null; size?: number; light?: boolean }) {
  const [err, setErr] = useState(false);
  if (league === 'nhl') return <NhlLogo abbr={code} size={size} light={light} />;
  const board = code === league.toUpperCase() ? LEAGUE_MARK[league] : null;
  const src = board ? board[light ? 0 : 1] : light ? logo : darkLogo(logo);
  if (!src || err) return <span className={`grid shrink-0 place-items-center rounded-full font-display font-extrabold ${light ? 'bg-slate-900 text-white' : 'bg-white/10 text-white'}`} style={{ width: size, height: size, fontSize: Math.max(8, size * 0.32) }}>{code}</span>;
  return <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setErr(true)} className="inline-block shrink-0 object-contain" style={{ width: size, height: size }} />;
}

export function Head({ id, title, sub, right }: { id: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div id={`fz-${id}`} className="scroll-mt-16 px-1">
      <div className="flex items-end gap-2">
        <h2 className="h-display flex min-w-0 flex-1 items-center gap-2 text-xl text-white"><span className="h-5 w-1 shrink-0 rounded-full" style={{ background: 'var(--club)' }} />{title}</h2>
        {right}
      </div>
      {sub && <p className="mt-0.5 text-sm text-mute">{sub}</p>}
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange, label }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="scroll-x flex gap-1.5">
      {items.map(([k, v]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${value === k ? 'text-white' : 'border border-white/10 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'}`}
          style={value === k ? { background: 'rgb(var(--club-rgb) / .9)' } : undefined}>{v}</button>
      ))}
    </div>
  );
}

// a 0-1 share as a bar, with the league's average (or any mark) as a tick
export function ShareBar({ value, mark, tone = 'club', h = 'h-2' }: { value: number; mark?: number | null; tone?: 'club' | 'good' | 'bad' | 'plain'; h?: string }) {
  const bg = tone === 'good' ? 'rgb(52 211 153)' : tone === 'bad' ? 'rgb(248 113 113)' : tone === 'plain' ? 'rgb(148 163 184)' : 'rgb(var(--club-rgb))';
  return (
    <div className={`relative ${h} rounded-full bg-white/[.06]`}>
      <div className={`${h} rounded-full`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: bg }} />
      {mark != null && <span className="absolute -top-0.5 h-[calc(100%+4px)] w-0.5 rounded bg-white/70" style={{ left: `${Math.min(100, Math.max(0, mark * 100))}%` }} aria-hidden />}
    </div>
  );
}

export const recordOf = (w: number, l: number, otl?: number | null) => `${w}-${l}${otl ? `-${otl}` : otl === 0 ? '-0' : ''}`;
export const pctStr = (v: number, digits = 3) => v.toFixed(digits).replace(/^0/, '');

export function ShowMore({ open, total, shown, onClick, what = '' }: { open: boolean; total: number; shown: number; onClick: () => void; what?: string }) {
  if (total <= shown && !open) return null;
  return <button type="button" onClick={onClick} className="mt-2 text-sm font-semibold text-sky-300">{open ? 'Show fewer' : `Show all ${total}${what ? ` ${what}` : ''}`}</button>;
}

export function RankChip({ rank, of = 32, low }: { rank: number | null | undefined; of?: number; low?: boolean }) {
  if (rank == null) return null;
  const third = Math.round(of / 3);
  const good = low ? rank > of - third : rank <= third, bad = low ? rank <= third : rank > of - third;
  const w = `${rank}${rank % 10 === 1 && rank % 100 !== 11 ? 'st' : rank % 10 === 2 && rank % 100 !== 12 ? 'nd' : rank % 10 === 3 && rank % 100 !== 13 ? 'rd' : 'th'}`;
  return <span className={`num shrink-0 rounded-full px-1.5 py-px text-[11px] font-bold ring-1 ${good ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/25' : bad ? 'bg-red-500/10 text-red-300 ring-red-400/25' : 'bg-white/[.05] text-slate-300 ring-white/10'}`}>{w}</span>;
}
