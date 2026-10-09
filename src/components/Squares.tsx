// Squares (migrations 167 and 200, docs/POOL-TYPES.md §2.6): the grid on one series, in coins, in the sport's words
// (innings and the first pitch for baseball, quarters and kickoff for football). Before the draw: tap squares to
// claim them (or let the grid pick), tap your own to hand them back; everyone's claims show as they land. Once the grid
// fills or Game 1 starts, the digits appear on the edges and every checkpoint (after the 3rd, the 6th, the final) lights
// the square the score names, with the coins it took. The square leading a game on now pulses.
import { useMemo, useState } from 'react';
import { Coins, Dices, Hash, Lock, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useCoins } from '../lib/pool';
import { useAction } from './ui';
import { ShareButton, useCardBrand } from './ShareButton';
import { shareCard } from '../lib/shareCard';
import { Crest } from './Crest';
import type { Team } from '../lib/types';

export interface SqClub { id: number; name: string; short: string | null; logo: string | null; color: string | null }
export interface SqGame {
  fixture: number; game_no: number; state: string; kickoff: string; top_home: boolean; top_runs: number | null; side_runs: number | null;
  detail: { inning?: number | null; half?: string | null; outs?: number | null } | null;
  innings: { n: number; top: number | null; side: number | null }[];
  now: { cell: string; to: string | null; team_id: number | null } | null;
}
export interface SqPay { game_no: number; point: number; top_runs: number; side_runs: number; cell: string; paid_cell: string | null; team_id: number | null; coins: number; at: string }
export interface SquaresData {
  series: { id: number | null; fixture?: number | null; label: string; short: string | null; best_of: number; state: string; starts_at: string | null; tbd: boolean; winner: number | null; top_wins: number; side_wins: number };
  top: SqClub | null; side: SqClub | null;
  size: 5 | 10; cost: number; cap: number; pay_when: 'innings' | 'quarters' | 'periods' | 'final'; digits: 'once' | 'each'; points: number[]; weights: number[];
  // the sport's words (migration 200); an older server sends none, which is baseball's
  words?: SqWords;
  locks_at: string | null; locked: boolean; claimed: number; pot: number;
  claims: { cell: string; team_id: number }[];
  draw: { seed: string; at: string; why: string; sets: { top: number[]; side: number[] }[] } | null;
  games: SqGame[]; pays: SqPay[]; paid: number;
}

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };
export interface SqWords { start: string; score: string; period: string }
const BASEBALL: SqWords = { start: 'first pitch', score: 'runs', period: 'inning' };
// a checkpoint, in the sport's words: after the 3rd (baseball), after the 1st quarter and the half (football)
export const pointLabel = (p: number, period = 'inning') => (p === 0 ? 'Final' : period === 'quarter' && p === 2 ? 'Half'
  : period === 'inning' ? `After the ${ordinal(p)}` : `After the ${ordinal(p)} ${period}`);
const pointShort = (p: number, period = 'inning') => (p === 0 ? 'F' : period === 'quarter' ? (p === 2 ? 'Half' : `Q${p}`) : period === 'period' ? `P${p}` : ordinal(p));
// how many periods a game has, for its line score
const PERIODS: Record<string, number> = { inning: 9, quarter: 4, period: 3, half: 2 };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const DT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const cellOf = (r: number, c: number) => `sq:${r}:${c}`;
const clubHue = (c: SqClub | null) => c?.color ?? 'rgb(var(--gold-rgb))';

// the digits on one edge, for a column or row: one on a 10 by 10 grid, two on a 5 by 5
const edge = (digits: number[] | undefined, i: number, size: number) => {
  if (!digits) return null;
  const k = 10 / size;
  return digits.slice(i * k, i * k + k);
};

export function SquaresGame({ data, gameId, status, reload, name }: { data: SquaresData; gameId: number; status: 'open' | 'done'; reload: () => void; name: (id: number) => string }) {
  const { me, teams } = useLeague();
  const { coins, reloadCoins } = useCoins(me?.id);
  const { busy, run } = useAction();
  const [pick, setPick] = useState<Set<string>>(new Set());
  const team = (id: number | null | undefined) => teams.find((t) => t.id === id);
  const owner = useMemo(() => new Map(data.claims.map((c) => [c.cell, c.team_id])), [data.claims]);
  const size = data.size;
  const open = status === 'open' && !data.locked;
  const canClaim = open && me?.role === 'gm';
  const mine = data.claims.filter((c) => c.team_id === me?.id).length;
  const w = data.words ?? BASEBALL;
  // one game (a Super Bowl) needs no game numbers
  const single = data.series.best_of === 1;
  // a grid on one game of an NFL week (migration 217): away at home, under its week
  const week = !!data.series.fixture;

  // the game the edges show: the one on now, else the next to play, else the last played
  const live = data.games.find((g) => g.state === 'live');
  const defaultGame = live?.game_no ?? data.games.find((g) => g.state !== 'final')?.game_no ?? data.games[data.games.length - 1]?.game_no ?? 1;
  const [gameNo, setGameNo] = useState<number | null>(null);
  const shown = gameNo ?? defaultGame;
  const set = data.draw ? data.draw.sets[Math.min(shown, data.draw.sets.length) - 1] ?? data.draw.sets[0] : null;
  const shownGame = data.games.find((g) => g.game_no === shown);

  // the squares that took coins: in the game shown (a fresh draw each game), or across the series (one draw)
  const hits = useMemo(() => {
    const m = new Map<string, { coins: number; points: number[] }>();
    for (const p of data.pays) {
      if (!p.paid_cell || p.coins <= 0) continue;
      if (data.digits === 'each' && p.game_no !== shown) continue;
      const h = m.get(p.paid_cell) ?? { coins: 0, points: [] };
      h.coins += p.coins; h.points.push(p.point);
      m.set(p.paid_cell, h);
    }
    return m;
  }, [data.pays, data.digits, shown]);
  const leading = shownGame?.state === 'live' ? shownGame.now : null;
  const cardBrand = useCardBrand();
  // my squares as a picture once the digits are drawn: each one's numbers and what it has taken
  const shareMine = () => {
    // the digits of the game on show (a grid drawn for every game has a set each)
    const first = set ?? data.draw!.sets[0];
    const cells = data.claims.filter((c) => c.team_id === me?.id).map((c) => c.cell);
    const took = (cell: string) => data.pays.filter((p) => p.paid_cell === cell && p.coins > 0).reduce((s, p) => s + p.coins, 0);
    const rows = cells.map((cell) => {
      const [, r, c] = cell.split(':').map(Number);
      const coins = took(cell);
      return { q: `${topName} ${(edge(first.top, c, size) ?? []).join('/')} · ${sideName} ${(edge(first.side, r, size) ?? []).join('/')}`,
        answer: coins > 0 ? `+${coins.toLocaleString()}` : '–', right: coins > 0 ? true : null };
    }).sort((a, b) => Number(b.right) - Number(a.right));
    const total = cells.reduce((s, cell) => s + took(cell), 0);
    return shareCard({ kind: 'sheet', eyebrow: 'My squares', brand: cardBrand, who: '', title: `${top && side ? `${top.name} v ${side.name}` : data.series.label}${data.draw!.sets.length > 1 ? ` · Game ${Math.min(shown, data.draw!.sets.length)}` : ''}`,
      score: total > 0 ? `${total.toLocaleString()} ${cardBrand.coin.name.toLowerCase()} won` : `${cells.length} ${cells.length === 1 ? 'square' : 'squares'}`, rows },
      total > 0 ? `My squares took ${total.toLocaleString()} ${cardBrand.coin.name.toLowerCase()}.` : 'My squares.');
  };

  const picked = [...pick];
  const toClaim = picked.filter((c) => !owner.has(c));
  const toGive = picked.filter((c) => owner.get(c) === me?.id);
  const capLeft = data.cap > 0 ? data.cap - mine : Infinity;
  const left = size * size - data.claimed;
  const tap = (cell: string) => {
    if (!canClaim) return;
    const o = owner.get(cell);
    if (o && o !== me?.id) return;
    setPick((p) => { const n = new Set(p); if (n.has(cell)) n.delete(cell); else n.add(cell); return n; });
  };
  const after = () => { setPick(new Set()); reload(); reloadCoins(); };
  const claim = (cells: string[], random = 0) => run(async () => { await rpc('pool_squares_claim', { p_game: gameId, p_cells: cells, p_random: random }); after(); },
    random ? `${random === 1 ? 'A square' : `${random} squares`} picked for you` : `${cells.length === 1 ? 'Square' : `${cells.length} squares`} claimed`);
  const giveBack = (cells: string[]) => run(async () => { await rpc('pool_squares_release', { p_game: gameId, p_cells: cells }); after(); }, 'Handed back, coins refunded');

  // what each checkpoint of a game pays from the pot as it stands
  const share = (w: number) => Math.floor((data.pot * w) / (100 * data.series.best_of));
  const holders = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of data.claims) m.set(c.team_id, (m.get(c.team_id) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [data.claims]);
  const won = (id: number) => data.pays.filter((p) => p.team_id === id).reduce((s, p) => s + p.coins, 0);
  const top = data.top, side = data.side;
  const topName = top?.short ?? top?.name ?? 'Home field', sideName = side?.short ?? side?.name ?? 'Visitors';
  const cellPx = size === 10 ? 'text-[13px]' : 'text-2xl';

  return (
    <div className="space-y-4">
      {/* the state of the grid */}
      <div className="card-hero overflow-hidden p-4">
        <div className="relative space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">{top && <Crest c={top} size={36} />}{side && <Crest c={side} size={36} />}</div>
            <div className="min-w-0 flex-1">
              <div className="break-words font-bold leading-tight text-white">{top && side ? (week ? `${side.name} at ${top.name}` : `${top.name} v ${side.name}`) : `${data.series.label}, matchup to be set`}</div>
              <div className="text-xs text-white/70">
                {week && `${data.series.label} · `}
                {data.series.state === 'final' ? (single && data.games[0] ? `Final: ${topName} ${data.games[0].top_runs ?? 0}, ${sideName} ${data.games[0].side_runs ?? 0}`
                    : `Over: ${data.series.top_wins > data.series.side_wins ? topName : sideName} win it ${Math.max(data.series.top_wins, data.series.side_wins)}-${Math.min(data.series.top_wins, data.series.side_wins)}`)
                  : data.series.state === 'live' ? (single ? 'On now' : `${topName} ${data.series.top_wins} · ${sideName} ${data.series.side_wins} in the series`)
                  : data.locks_at ? `${single ? cap(w.start) : 'Game 1'} ${DT.format(new Date(data.locks_at))}${data.series.tbd ? ' (time to be set)' : ''}` : 'Dates to be set'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['Pot', data.pot.toLocaleString(), 'coins'], ['Squares', `${data.claimed}`, `of ${size * size}`], ['Yours', `${mine}`, data.cap ? `up to ${data.cap}` : `${data.cost} coins each`]].map(([k, v, s]) => (
              <div key={k} className="rounded-2xl bg-black/25 px-3 py-2 ring-1 ring-white/10">
                <div className="text-[10px] font-bold uppercase tracking-[.16em] text-white/60">{k}</div>
                <div className="num text-xl font-black leading-tight text-white">{v}</div>
                <div className="text-[10px] text-white/60">{s}</div>
              </div>
            ))}
          </div>
          {!data.draw && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(data.claimed / (size * size)) * 100}%` }} /></div>
              <p className="mt-1.5 text-[11px] text-white/70">{status === 'done' ? 'Nobody claimed a square.' : `${left} left. The digits are drawn the moment the grid fills, or at ${single ? '' : 'Game 1’s '}${w.start}.`}</p>
            </div>
          )}
          {live && data.draw && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-xs ring-1 ring-red-400/30">
              <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" /></span>
              <span className="min-w-0 flex-1 text-white">
                <b>{single ? 'Live' : `Game ${live.game_no}`}</b>{live.detail?.inning ? `, ${live.detail.half === 'Top' ? 'top' : 'bottom'} ${ordinal(live.detail.inning)}` : ''}: {topName} {live.top_runs ?? 0}, {sideName} {live.side_runs ?? 0}.
                {live.now?.team_id ? <> Leading: <b>{name(live.now.team_id)}</b>{live.now.to !== live.now.cell ? ' (next square along)' : ''}</> : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* the game the edges show, when each game has its own digits */}
      {data.draw && data.digits === 'each' && data.draw.sets.length > 1 && (
        <div className="scroll-x -mx-1 flex gap-1.5 px-1">
          {data.draw.sets.map((_, i) => {
            const g = data.games.find((x) => x.game_no === i + 1);
            return (
              <button key={i} type="button" onClick={() => setGameNo(i + 1)} className={`tab inline-flex shrink-0 items-center gap-1.5 ${shown === i + 1 ? 'tab-on' : 'bg-white/[.05]'}`}>
                Game {i + 1}{g?.state === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}{g?.state === 'final' && <span className="text-[10px] text-mute">F</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* the grid */}
      <div className="card p-2.5 sm:p-3">
        <div className="mb-1.5 flex items-center gap-1.5 pl-7 text-[11px] font-black uppercase tracking-[.14em]" style={{ color: clubHue(top) }}>
          {top && <Crest c={top} size={18} />} {topName} <span className="text-white/40">{w.score} →</span>
        </div>
        <div className="flex gap-1">
          <div className="flex w-6 shrink-0 items-center justify-center">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-black uppercase tracking-[.14em] [writing-mode:vertical-rl] rotate-180" style={{ color: clubHue(side) }}>
              {sideName} <span className="text-white/40">{w.score} →</span>
            </span>
          </div>
          <div className="grid min-w-0 flex-1 gap-[3px]" style={{ gridTemplateColumns: `minmax(1.4rem, .7fr) repeat(${size}, minmax(0, 1fr))` }}>
            <div className="grid place-items-center rounded-md bg-white/[.03] text-white/30"><Hash className="h-3 w-3" /></div>
            {Array.from({ length: size }, (_, c) => (
              <div key={c} className="num grid place-items-center rounded-md py-1 text-[11px] font-black leading-none" style={{ background: `color-mix(in srgb, ${clubHue(top)} 22%, transparent)` }}>
                {set ? <span className={size === 5 ? 'flex flex-col items-center gap-0.5' : ''}>{edge(set.top, c, size)!.map((d) => <span key={d}>{d}</span>)}</span> : <span className="text-white/40">?</span>}
              </div>
            ))}
            {Array.from({ length: size }, (_, r) => [
              <div key={`h${r}`} className="num grid place-items-center rounded-md px-0.5 text-[11px] font-black leading-none" style={{ background: `color-mix(in srgb, ${clubHue(side)} 22%, transparent)` }}>
                {set ? <span className={size === 5 ? 'flex gap-1' : ''}>{edge(set.side, r, size)!.map((d) => <span key={d}>{d}</span>)}</span> : <span className="text-white/40">?</span>}
              </div>,
              ...Array.from({ length: size }, (_, c) => {
                const cell = cellOf(r, c);
                const o = owner.get(cell);
                const t = team(o);
                const sel = pick.has(cell);
                const hit = hits.get(cell);
                const lead = leading?.to === cell;
                const isMine = o != null && o === me?.id;
                return (
                  <Square key={cell} t={t} mine={isMine} sel={sel} giving={sel && isMine} hit={hit} lead={lead} free={o == null} tappable={canClaim && (o == null || isMine)}
                    textSize={cellPx} period={w.period} onTap={() => tap(cell)} label={`Row ${r + 1}, column ${c + 1}${t ? `: ${t.gm_name}` : ', free'}`} />
                );
              }),
            ])}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-mute">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-gold" /> Yours</span>
          {data.draw && <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3 text-gold" /> Took coins{data.digits === 'each' ? ` in Game ${shown}` : ''}</span>}
          {data.draw && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 animate-pulse rounded-sm bg-red-400/70" /> Leading now</span>}
          {canClaim && <span>Tap free squares to claim, yours to hand back</span>}
        </div>
      </div>

      {/* claiming */}
      {canClaim && (
        <div className="card space-y-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-300">{data.cost} coins a square{data.cap ? ` · up to ${data.cap} each` : ''}</span>
            {coins != null && <span className="inline-flex items-center gap-1 font-semibold text-gold"><Coins className="h-3.5 w-3.5" /> {coins.toLocaleString()} to spend</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, Math.max(2, Math.min(5, left, capLeft))].map((n) => (
              <button key={n} type="button" disabled={busy || left < n || capLeft < n} onClick={() => claim([], n)}
                className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-white/[.05] px-3 py-2.5 text-sm font-bold text-white ring-1 ring-white/10 transition enabled:hover:bg-white/10 disabled:opacity-40">
                <Dices className="h-4 w-4 text-gold" /> Pick {n} for me
              </button>
            ))}
          </div>
        </div>
      )}
      {canClaim && pick.size > 0 && (
        <div className="fixed inset-x-0 bottom-[84px] z-40 px-4 md:bottom-6">
          <div className="mx-auto flex max-w-md flex-wrap items-center gap-2 rounded-2xl bg-[#0f1a2e]/95 px-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,.5)] ring-1 ring-white/15 backdrop-blur">
            <span className="min-w-0 flex-1 text-sm text-white">
              {toClaim.length > 0 && <b>{toClaim.length} to claim · {toClaim.length * data.cost} coins</b>}
              {toClaim.length > 0 && toGive.length > 0 && <br />}
              {toGive.length > 0 && <span className="text-rose-200">{toGive.length} to hand back</span>}
            </span>
            <button type="button" onClick={() => setPick(new Set())} className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-mute">Clear</button>
            {toGive.length > 0 && <button type="button" disabled={busy} onClick={() => giveBack(toGive)} className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-100 ring-1 ring-rose-400/40"><RotateCcw className="h-3.5 w-3.5" /> Hand back</button>}
            {toClaim.length > 0 && <button type="button" disabled={busy} onClick={() => claim(toClaim)} className="btn-gold px-4 py-1.5 text-sm">Claim</button>}
          </div>
        </div>
      )}

      {/* what it pays */}
      <div className="card p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="label">{single ? 'What it pays' : 'What each game pays'}</span>
          <span className="text-[11px] text-mute">{single ? 'One game' : `${data.series.best_of} games at most · the last final takes the rest`}</span>
        </div>
        <div className={`grid gap-2 ${data.points.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : data.points.length === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {data.points.map((p, i) => (
            <div key={p} className="rounded-2xl bg-white/[.04] px-3 py-2 text-center ring-1 ring-white/10">
              <div className="text-[10px] font-bold uppercase tracking-[.14em] text-mute">{pointLabel(p, w.period)}</div>
              <div className="num text-lg font-black text-gold">{share(data.weights[i]).toLocaleString()}</div>
              <div className="text-[10px] text-mute">{data.weights[i]}%{single ? '' : ' of a game'}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-mute">The last digit of each club&apos;s {w.score} names the square. An empty square passes its coins along the row to the next claimed one. {data.draw ? '' : 'Amounts grow with the pot until the draw.'}</p>
      </div>

      {/* every game so far */}
      {data.games.length > 0 && data.draw && (
        <div className="space-y-2">
          <div className="label px-1">{single ? 'The game' : 'Game by game'}</div>
          {data.games.map((g) => {
            const pays = data.pays.filter((p) => p.game_no === g.game_no);
            return (
              <div key={g.fixture} className="card overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-white/[.06] px-3.5 py-2">
                  <span className="text-[11px] font-black uppercase tracking-[.16em] text-white">{single ? data.series.label : `Game ${g.game_no}`}</span>
                  <span className={`num text-xs font-bold ${g.state === 'live' ? 'text-red-300' : 'text-slate-200'}`}>
                    {g.top_runs != null ? `${topName} ${g.top_runs} · ${sideName} ${g.side_runs}` : DT.format(new Date(g.kickoff))}{g.state === 'final' ? ' · F' : g.state === 'live' ? ' · live' : ''}
                  </span>
                </div>
                {g.innings.length > 0 && <LineScore g={g} topName={topName} sideName={sideName} points={data.points} periods={PERIODS[w.period] ?? 9} />}
                <div className="flex flex-wrap gap-1.5 p-2.5">
                  {data.points.map((p) => {
                    const x = pays.find((y) => y.point === p);
                    if (!x) return <span key={p} className="rounded-full bg-white/[.03] px-2.5 py-1 text-[11px] text-mute ring-1 ring-white/[.06]">{pointLabel(p, w.period)} · to come</span>;
                    const t = team(x.team_id);
                    return (
                      <span key={p} className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-[11px] ring-1 ${x.team_id === me?.id ? 'bg-gold/15 ring-gold/40' : 'bg-white/[.04] ring-white/10'}`}>
                        <span className="grid h-5 w-5 place-items-center rounded-full text-xs" style={{ background: t ? `color-mix(in srgb, ${t.color} 40%, transparent)` : undefined }}>{t?.emoji ?? '·'}</span>
                        <b className="text-white">{pointShort(p, w.period)}</b><span className="num text-slate-300">{x.top_runs}-{x.side_runs}</span>
                        <span className="font-semibold text-white">{t?.gm_name ?? 'nobody'}</span>
                        <span className="num font-black text-gold">+{x.coins}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* who holds what */}
      {holders.length > 0 && (
        <div className="card p-3.5">
          <div className="label mb-2">On the grid</div>
          <div className="flex flex-wrap gap-1.5">
            {holders.map(([id, n]) => {
              const t = team(id);
              return (
                <span key={id} className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs ring-1 ${id === me?.id ? 'bg-gold/10 ring-gold/40' : 'bg-white/[.04] ring-white/10'}`}>
                  <span className="grid h-6 w-6 place-items-center rounded-full text-sm" style={{ background: t ? `color-mix(in srgb, ${t.color} 45%, transparent)` : undefined }}>{t?.emoji}</span>
                  <span className="font-semibold text-white">{t?.gm_name ?? name(id)}</span>
                  <span className="num text-mute">{n}</span>
                  {won(id) > 0 && <span className="num font-black text-gold">+{won(id)}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* the draw, checkable */}
      {data.draw && mine > 0 && <ShareButton className="btn-ghost w-full" label="Share my squares" make={shareMine} />}
      {data.draw ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-white/[.06] bg-white/[.02] p-3 text-[11px] leading-snug text-mute">
          <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-emerald-300" />
          <span className="min-w-0 break-words">
            Drawn {DT.format(new Date(data.draw.at))}, {data.draw.why === 'full' ? 'the moment the grid filled' : `at ${data.draw.why === 'first pitch' ? 'the first pitch' : data.draw.why}`}{data.digits === 'each' ? ', fresh digits for each game' : ''}.
            Seed <code className="rounded bg-white/[.06] px-1 text-slate-300">{data.draw.seed}</code>: each digit sits in the order of md5(seed:game:side:digit), so anyone can check it.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-2xl border border-white/[.06] bg-white/[.02] p-3 text-[11px] leading-snug text-mute">
          {open ? <Sparkles className="mt-px h-4 w-4 shrink-0 text-gold" /> : <Lock className="mt-px h-4 w-4 shrink-0" />}
          <span>Nobody knows the digits yet, not even the host. They are shuffled from a random seed when the draw happens, and the seed is shown here so the draw can be checked.</span>
        </div>
      )}
    </div>
  );
}

// one square: its owner's emoji on their colour, yours ringed in gold, a pick waiting dashed, coins it took in a badge
function Square({ t, mine, sel, giving, hit, lead, free, tappable, textSize, period, onTap, label }: {
  t: Team | undefined; mine: boolean; sel: boolean; giving: boolean; hit: { coins: number; points: number[] } | undefined; lead: boolean; free: boolean;
  tappable: boolean; textSize: string; period: string; onTap: () => void; label: string;
}) {
  const bg = t ? `color-mix(in srgb, ${t.color} ${hit ? 70 : 34}%, #0b1220)` : undefined;
  return (
    <button type="button" aria-label={label} onClick={onTap} disabled={!tappable}
      className={`relative grid aspect-square min-w-0 place-items-center rounded-md transition ${textSize}
        ${free ? (sel ? 'bg-gold/25 outline-dashed outline-2 -outline-offset-2 outline-gold' : 'bg-white/[.035] ring-1 ring-white/[.06]') : ''}
        ${mine && !giving ? 'ring-2 ring-gold' : ''} ${giving ? 'opacity-50 ring-2 ring-rose-400' : ''}
        ${lead ? 'z-10 animate-pulse ring-2 ring-red-400 shadow-[0_0_14px_rgba(248,113,113,.6)]' : ''}
        ${hit ? 'shadow-[0_0_12px_rgb(var(--gold-rgb)/.45)]' : ''} ${tappable ? 'active:scale-95' : ''}`}
      style={bg ? { background: bg } : undefined}>
      {t ? <span className="leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,.5)]">{t.emoji}</span>
        : sel ? <span className="text-[10px] font-black text-gold">+</span> : null}
      {hit && (
        <span className="num absolute -right-1 -top-1 z-10 rounded-full bg-gold px-1 text-[8px] font-black leading-[12px] text-[#0b1220] shadow">
          {hit.points.length > 1 ? `×${hit.points.length}` : hit.points[0] === 0 ? 'F' : pointShort(hit.points[0], period)}
        </span>
      )}
    </button>
  );
}

// a game's score by period (innings, quarters), the checkpoints marked
function LineScore({ g, topName, sideName, points, periods }: { g: SqGame; topName: string; sideName: string; points: number[]; periods: number }) {
  const n = Math.max(periods, ...g.innings.map((i) => i.n));
  const by = new Map(g.innings.map((i) => [i.n, i]));
  return (
    <div className="scroll-x px-2.5 pt-2">
      <table className="num w-full min-w-[300px] text-center text-[11px]">
        <thead><tr className="text-mute">
          <th className="w-12 text-left font-semibold" />
          {Array.from({ length: n }, (_, i) => <th key={i} className={`font-semibold ${points.includes(i + 1) ? 'text-gold' : ''}`}>{i + 1}</th>)}
          <th className="pl-1 font-bold text-white">R</th>
        </tr></thead>
        <tbody>
          {([['top', topName, g.top_runs], ['side', sideName, g.side_runs]] as const).map(([k, nm, r]) => (
            <tr key={k} className="text-slate-200">
              <td className="text-left font-bold text-white">{nm}</td>
              {Array.from({ length: n }, (_, i) => { const v = by.get(i + 1)?.[k]; return <td key={i} className={points.includes(i + 1) ? 'bg-gold/[.07]' : ''}>{v ?? (g.state === 'final' && by.has(i + 1) ? 'x' : '')}</td>; })}
              <td className="pl-1 font-black text-white">{r ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
