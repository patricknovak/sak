import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, ChevronDown, Grid3x3, ListChecks, Lock, ListOrdered, Minus, Plus, Swords, Trophy, Users } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Empty, PageHeader, Section, TeamBadge, useAction } from '../components/ui';
import { Crest } from '../components/Crest';
import { KINDS, PICKEM_PRESETS, PRESETS, SIZES, SQUARES_DEFAULT, START_WORD, gridLabel, paysFor, type PickemPreset, type PoolEvent, type SeriesPreset, type SquaresRules } from '../lib/poolGames';
import { SquaresGame, type SquaresData } from '../components/Squares';
import { PickemGame, type PickemData } from '../components/Pickem';
import { BracketGame, type BracketData } from '../components/Bracket';
import { BoxPoolGame, type BoxData } from '../components/BoxPool';
import { useSurvivor } from './Survivor';

// The pool's games (migration 165, docs/POOL-TYPES.md): Pick the series (each series' winner and how many games it
// goes, locked at its Game 1) and Rank the teams (the clubs in order; every win pays its club's rank). Points, the most
// still possible and the table come from the database on every read, so a result lands the moment the feed has it.
// Everyone else's picks show once a series starts. Squares (migration 167) and weekly pick'em (migration 170) have their
// own components.

export interface Club { id: number; name: string; short: string | null; logo: string | null; color: string | null }
interface Pick { winner: number; games: number }
interface Series {
  id: number; round: number; label: string; short: string | null; best_of: number; high: Club | null; low: Club | null;
  high_wins: number; low_wins: number; winner: number | null; state: 'scheduled' | 'live' | 'final'; starts_at: string | null; tbd: boolean;
  locked: boolean; mine: Pick | null; points: number | null; calls: (Pick & { team_id: number })[] | null; picked: number;
  next: { kickoff: string; game_no: number; state: string; home: number; home_score: number | null; away_score: number | null;
    detail: { inning?: number | null; half?: string | null; tbd?: boolean; probables?: { home: string | null; away: string | null } } | null } | null;
}
interface RankClub extends Club { alive: boolean; in_field: boolean; wins: number; left: number }
interface TableRow { team_id: number; points: number; possible: number; right: number; exact: number; picked: number; tiebreak: number | null }
export interface GameBoard {
  id: number; kind: 'series' | 'rank' | 'squares' | 'pickem' | 'bracket' | 'players'; title: string; status: 'open' | 'done'; winners: number[] | null; competition: string; competition_name: string; me: number;
  rules: { preset?: string; from_round: number; points?: Record<string, number>; length?: Record<string, number>; exact_only?: boolean };
  rounds: { round: number; label: string; best_of: number }[]; table: TableRow[];
  series?: Series[]; tiebreak?: { locks_at: string | null; locked: boolean; mine: number | null; label: string };
  rank?: { locks_at: string | null; locked: boolean; round_label: string; field: number; clubs: RankClub[]; mine: number[] | null; orders: { team_id: number; order: number[] }[] | null };
  squares?: SquaresData;
  pickem?: PickemData;
  bracket?: BracketData;
  // the sport's words (migration 190): what starts a game, what a tiebreaker counts and how high it goes
  words?: Words;
  players?: BoxData;
}
export interface PoolGame { id: number; kind: 'series' | 'rank' | 'squares' | 'pickem' | 'bracket' | 'players'; series?: number | null; title: string; status: 'open' | 'done'; competition: string; to_pick: number; next_lock: string | null }

export function usePoolGames() {
  const { me, league } = useLeague();
  const [games, setGames] = useState<PoolGame[] | null>(null);
  const load = useCallback(() => rpc<PoolGame[]>('pool_games_list').then((g) => setGames(g ?? []), () => setGames([])), []);
  useEffect(() => { if (me) load(); }, [me?.id, league?.league_id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { games, reload: load };
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const lockText = (iso: string | null, tbd = false) => {
  if (!iso) return 'date to be set';
  const d = new Date(iso);
  return tbd ? `${DAY.format(d)}, time to be set` : `${DAY.format(d)}, ${TIME.format(d)}`;
};
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };
const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const hue = (c: Club | null | undefined) => c?.color ?? 'rgb(var(--gold-rgb))';
// a game's sport words, with baseball's for an older server that doesn't send them; `guess` is where a tiebreaker starts
export interface Words { start: string; score: string; cap: number }
// single games all the way (the NFL's playoffs): no lengths to call, and the final is one game
export const singles = (b: { rounds?: { best_of: number }[] }) => !!b.rounds?.length && b.rounds.every((r) => r.best_of === 1);
export const lastGameOf = (label: string, single: boolean) => (single ? `the ${label}` : `the last game of the ${label}`);
export const wordsOf = (b: { words?: Words }) => {
  const w = b.words ?? { start: 'first pitch', score: 'runs', cap: 60 };
  return { ...w, guess: w.score === 'points' ? 45 : w.score === 'goals' ? 3 : 8 };
};

const ICON = { series: Swords, rank: ListOrdered, squares: Grid3x3, pickem: ListChecks, bracket: Trophy, players: Users } as const;

// a series' wins as dots: the number it takes to win, filled as they come
function WinDots({ wins, need, color }: { wins: number; need: number; color: string }) {
  return (
    <span className="flex gap-1" aria-label={`${wins} of ${need} wins`}>
      {Array.from({ length: need }, (_, i) => <span key={i} className="h-2 w-2 rounded-full ring-1 ring-white/20" style={{ background: i < wins ? color : 'transparent' }} />)}
    </span>
  );
}

// how far along a series is, in words
function seriesState(s: Series): string {
  const a = s.high, b = s.low;
  if (!a || !b) return s.starts_at ? `Starts ${lockText(s.starts_at, s.tbd)}` : 'Clubs to be decided';
  if (s.state === 'final') { const w = s.winner === a.id ? a : b; return s.best_of === 1 ? `${w.short ?? w.name} win` : `${w.short ?? w.name} win it in ${s.high_wins + s.low_wins}`; }
  if (s.state === 'scheduled') return s.best_of === 1 ? lockText(s.starts_at, s.tbd) : `Game 1 · ${lockText(s.starts_at, s.tbd)}`;
  // a single game under way: just live
  if (s.best_of === 1) return 'Live';
  const lead = s.high_wins === s.low_wins ? `Tied ${s.high_wins}-${s.low_wins}` : s.high_wins > s.low_wins ? `${a.short} lead ${s.high_wins}-${s.low_wins}` : `${b.short} lead ${s.low_wins}-${s.high_wins}`;
  const n = s.next;
  if (n?.state === 'live') return `${lead} · Game ${n.game_no} live${n.detail?.inning ? `, ${n.detail.half === 'Top' ? 'top' : 'bottom'} ${ordinal(n.detail.inning)}` : ''}`;
  return n ? `${lead} · Game ${n.game_no} ${lockText(n.kickoff, n.detail?.tbd)}` : lead;
}

// one series: tap a club, then how many games; locked, it shows your pick, the pool's split and what it scored
function SeriesCard({ s, board, onPick, busy, name }: { s: Series; board: GameBoard; onPick: (s: Series, p: Partial<Pick>) => void; busy: boolean; name: (id: number) => string }) {
  const [open, setOpen] = useState(false);
  const need = Math.floor(s.best_of / 2) + 1;
  const lengths = Array.from({ length: s.best_of - need + 1 }, (_, i) => need + i);
  const clubs = [s.high, s.low];
  const canPick = !s.locked && !!s.high && !!s.low && board.status === 'open';
  const winPts = board.rules.points?.[String(s.round)] ?? 1, lenPts = board.rules.length?.[String(s.round)] ?? 0;
  const calls = s.calls ?? [];
  const share = (id: number) => (calls.length ? Math.round((calls.filter((c) => c.winner === id).length / calls.length) * 100) : 0);
  const mineHue = hue(clubs.find((c) => c?.id === s.mine?.winner));
  return (
    <div className="card overflow-hidden" style={s.mine ? { borderColor: `color-mix(in srgb, ${mineHue} 45%, transparent)` } : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-white/[.06] px-3.5 py-2.5">
        <span className="text-[11px] font-black uppercase tracking-[.16em] text-white">{s.short ?? s.label}</span>
        <span className={`text-[11px] ${s.state === 'live' && s.next?.state === 'live' ? 'font-bold text-red-300' : 'text-mute'}`}>{seriesState(s)}</span>
      </div>
      <div className="space-y-1.5 p-2.5">
        {clubs.map((c, i) => {
          if (!c) return <div key={i} className="flex h-14 items-center gap-3 rounded-2xl border border-dashed border-white/10 px-3 text-sm text-mute"><span className="h-8 w-8 rounded-full bg-white/[.05]" />To be decided</div>;
          const wins = c.id === s.high?.id ? s.high_wins : s.low_wins;
          const picked = s.mine?.winner === c.id;
          const won = s.state === 'final' && s.winner === c.id, out = s.state === 'final' && s.winner !== c.id;
          return (
            <button key={c.id} type="button" disabled={!canPick || busy} onClick={() => onPick(s, { winner: c.id })}
              className={`relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 text-left transition enabled:active:scale-[.99] ${picked ? 'ring-2' : 'ring-1 ring-white/10 enabled:hover:bg-white/[.05]'} ${out ? 'opacity-50' : ''}`}
              style={picked ? { background: `color-mix(in srgb, ${hue(c)} 16%, transparent)`, ['--tw-ring-color' as string]: hue(c) } : undefined}>
              {s.locked && calls.length > 0 && <span className="absolute inset-y-0 left-0 opacity-[.12]" style={{ width: `${share(c.id)}%`, background: hue(c) }} />}
              <Crest c={c} size={34} />
              <span className="relative min-w-0 flex-1">
                <span className="block break-words font-bold leading-tight text-white">{c.name}</span>
                <span className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-mute">
                  {i === 0 ? (wordsOf(board).start === 'puck drop' ? 'Home ice' : 'Home field') : 'Visitors'}{(s.state !== 'scheduled') && <WinDots wins={wins} need={need} color={hue(c)} />}
                </span>
              </span>
              {s.locked && calls.length > 0 && <span className="num relative shrink-0 text-sm font-black text-white/80">{share(c.id)}%</span>}
              {won && <Trophy className="relative h-5 w-5 shrink-0 text-gold" />}
              {picked && !s.locked && <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#0b1220]" style={{ background: hue(c) }}><Check className="h-4 w-4" strokeWidth={3} /></span>}
            </button>
          );
        })}
        {canPick && s.mine && s.best_of > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="mr-1 text-[11px] font-semibold text-mute">In</span>
            {lengths.map((n) => (
              <button key={n} type="button" disabled={busy} onClick={() => onPick(s, { games: n })}
                className={`num h-9 min-w-[2.75rem] rounded-xl px-2 text-sm font-black ring-1 transition ${s.mine?.games === n ? 'bg-gold text-[#0b1220] ring-gold' : 'bg-white/[.04] text-white ring-white/10 hover:bg-white/10'}`}>{n}</button>
            ))}
            <span className="ml-auto text-[11px] text-mute">games</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] px-3.5 py-2 text-[11px]">
        {s.mine ? (
          <span className="flex items-center gap-1.5 text-slate-200">
            {s.locked && <Lock className="h-3 w-3 text-mute" />}
            Your pick: <b className="text-white">{clubs.find((c) => c?.id === s.mine!.winner)?.short}{s.best_of > 1 ? ` in ${s.mine.games}` : ''}</b>
            {s.points != null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ring-1 ${s.points > 0 ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30' : 'bg-white/[.06] text-mute ring-white/10'}`}>+{s.points}</span>}
          </span>
        ) : canPick ? <span className="text-amber-200">{s.best_of > 1 ? 'Tap who wins, then how many games' : 'Tap who wins'}</span>
          : s.locked ? <span className="text-mute">No pick</span> : <span className="text-mute">Opens when both clubs are set</span>}
        <span className="text-mute">{board.rules.exact_only ? (s.best_of === 1 ? pts(winPts) : `${pts(winPts)} for both`) : s.best_of === 1 ? pts(winPts + lenPts) : `${pts(winPts)}${lenPts ? ` · +${lenPts} length` : ''}`}</span>
      </div>
      {s.locked && calls.length > 0 && (
        <div className="border-t border-white/[.06]">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3.5 py-2 text-[11px] font-semibold text-sky-300">
            Everyone&apos;s picks ({calls.length}) <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {calls.map((c) => {
                const cl = clubs.find((x) => x?.id === c.winner);
                const right = s.state === 'final' && c.winner === s.winner;
                return (
                  <span key={c.team_id} className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2.5 pr-2 text-[11px] ring-1 ${c.team_id === board.me ? 'bg-gold/10 ring-gold/30' : 'bg-white/[.04] ring-white/10'}`}>
                    <span className="font-semibold text-white">{name(c.team_id)}</span>
                    <b className="text-slate-200" style={{ color: hue(cl) }}>{cl?.short} in {c.games}</b>{right && <Check className="h-3 w-3 text-emerald-300" />}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// a game's picks for yourself, or (the host, migration 172) for a member who asked: their own picks stay private, so
// the host starts from a blank slate and what they save replaces the member's
const savePick = (board: GameBoard, thing: string, pick: unknown, actAs?: { team: number }) => actAs
  ? rpc('pool_host_pick', { p_game: board.id, p_team: actAs.team, p_pick: { thing, pick } })
  : rpc('pool_game_pick', { p_game: board.id, p_thing: thing, p_pick: pick });

function SeriesGame({ board, reload, name, actAs }: { board: GameBoard; reload: () => void; name: (id: number) => string; actAs?: { team: number; name: string } }) {
  const { busy, run } = useAction();
  const [local, setLocal] = useState<Record<number, Partial<Pick>>>({});
  const [runs, setRuns] = useState<number | null>(null);
  useEffect(() => { if (!actAs) setLocal({}); }, [board]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => (board.series ?? []).map((s) => {
    const base = actAs ? null : s.mine;
    return { ...s, mine: (local[s.id] ? { ...base, ...local[s.id] } : base) as Pick | null };
  }), [board, local, actAs]);
  const onPick = (s: Series, p: Partial<Pick>) => {
    // a single game (the NFL's playoffs) has only one length: the winner is the whole pick
    const next = { ...(s.mine ?? {}), ...p, ...(s.best_of === 1 ? { games: 1 } : {}) } as Partial<Pick>;
    setLocal((l) => ({ ...l, [s.id]: next }));
    if (next.winner && next.games) run(async () => { await savePick(board, `s:${s.id}`, next, actAs); reload(); }, actAs ? `Saved for ${actAs.name}` : undefined);
  };
  const rounds = board.rounds.map((r) => ({ ...r, list: series.filter((s) => s.round === r.round) })).filter((r) => r.list.length);
  const tb = board.tiebreak;
  const w = wordsOf(board);
  const tbv = runs ?? tb?.mine ?? w.guess;
  return (
    <>
      {rounds.map((r) => (
        <Section key={r.round} title={r.label} right={<span className="text-xs text-mute">{r.best_of === 1 ? 'Single games' : `Best of ${r.best_of}`}</span>}>
          <div className="grid gap-3 md:grid-cols-2">{r.list.map((s) => <SeriesCard key={s.id} s={s} board={board} onPick={onPick} busy={busy} name={name} />)}</div>
        </Section>
      ))}
      {tb && board.status === 'open' && !actAs && (
        <Section title="The tiebreaker">
          <div className="card flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">Total {w.score} in {lastGameOf(tb.label, singles(board))}</div>
              <div className="text-xs text-mute">{tb.locked ? 'Locked' : `Locks ${lockText(tb.locks_at)}`}. Closest breaks a tie on points.</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="One fewer" disabled={tb.locked || busy || tbv <= 0} onClick={() => setRuns(Math.max(0, tbv - 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
              <div className={`num grid h-10 w-12 place-items-center rounded-xl bg-black/30 text-xl font-black ${tb.mine == null && runs == null ? 'text-white/40' : 'text-white'}`}>{tbv}</div>
              <button type="button" aria-label="One more" disabled={tb.locked || busy || tbv >= w.cap} onClick={() => setRuns(Math.min(w.cap, tbv + 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
            </div>
            {!tb.locked && (runs != null && runs !== tb.mine || tb.mine == null) && (
              <button type="button" className="btn-gold w-full" disabled={busy} onClick={() => run(async () => { await rpc('pool_game_pick', { p_game: board.id, p_thing: 'tiebreak', p_pick: { runs: tbv } }); setRuns(null); reload(); }, 'Tiebreaker saved')}>
                Save {tbv} {w.score}
              </button>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function RankGame({ board, reload, name, actAs }: { board: GameBoard; reload: () => void; name: (id: number) => string; actAs?: { team: number; name: string } }) {
  const { busy, run } = useAction();
  const rk = board.rank!;
  const byId = useMemo(() => new Map(rk.clubs.map((c) => [c.id, c])), [rk.clubs]);
  const base = useMemo(() => {
    const mine = (actAs ? [] : rk.mine ?? []).filter((id) => byId.has(id));
    const rest = rk.clubs.filter((c) => c.alive && !mine.includes(c.id)).map((c) => c.id);
    return [...mine, ...rest];
  }, [rk, byId, actAs]);
  const [order, setOrder] = useState<number[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOrder(null); }, [board]);
  const list = order ?? base;
  const dirty = !!order && order.join() !== (rk.mine ?? []).join();
  const move = (i: number, d: number) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setOrder(n); };
  // the value each place is worth once the field is set: the clubs of the starting round in this order, N down to 1
  const field = list.filter((id) => byId.get(id)?.in_field);
  const value = (id: number) => { const k = field.indexOf(id); return k < 0 ? null : (rk.field || field.length) - k; };
  return (
    <Section title={`The ${rk.round_label}`} right={<span className="text-xs text-mute">{rk.locked ? 'Locked' : `Locks ${lockText(rk.locks_at)}`}</span>}>
      <div className="card divide-y divide-white/[.05] overflow-hidden">
        {list.map((id, i) => {
          const c = byId.get(id)!;
          const v = value(id);
          return (
            <div key={id} className={`flex items-center gap-3 px-3 py-2.5 ${!c.alive ? 'opacity-45' : ''}`}>
              <span className="num w-5 shrink-0 text-center text-sm font-black text-mute">{i + 1}</span>
              <Crest c={c} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold leading-tight text-white">{c.name}</span>
                <span className="block text-[11px] text-mute">{!c.alive ? 'Out' : rk.locked ? `${c.wins} ${c.wins === 1 ? 'win' : 'wins'} · up to ${c.left} more` : c.in_field ? 'In the field' : 'Still to qualify'}</span>
              </span>
              {v != null && <span className="num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black text-[#0b1220]" style={{ background: hue(c) }}>×{v}</span>}
              {!rk.locked && (
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-mute">
        {rk.locked ? 'Each win pays its club’s number.' : `At the lock the ${rk.field || 'clubs'} in the ${rk.round_label} are ranked in your order: your top club pays ${rk.field || 'the most'} for every game it wins, your last pays 1. Clubs out by then don't count.`}
      </p>
      {!rk.locked && (actAs || dirty || !rk.mine) && board.status === 'open' && (
        <button type="button" className="btn-gold mt-3 w-full py-3" disabled={busy} onClick={() => run(async () => { await savePick(board, 'rank', { order: list }, actAs); reload(); }, actAs ? `${actAs.name}’s order is in` : 'Your order is in')}>
          {actAs ? `Save this order for ${actAs.name}` : rk.mine ? 'Save the new order' : 'Lock in this order'}
        </button>
      )}
      {rk.orders && rk.orders.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-sky-300">Everyone&apos;s order ({rk.orders.length}) <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} /></button>
          {open && <div className="space-y-1.5 px-3 pb-3">{rk.orders.map((o) => (
            <div key={o.team_id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="w-20 shrink-0 truncate font-semibold text-white">{name(o.team_id)}</span>
              {o.order.filter((id) => byId.get(id)?.in_field).map((id) => <span key={id} className="rounded-full bg-white/[.05] px-2 py-0.5 font-bold ring-1 ring-white/10" style={{ color: hue(byId.get(id)) }}>{byId.get(id)?.short}</span>)}
            </div>))}</div>}
        </div>
      )}
    </Section>
  );
}

// a box pool's size: Classic is ten boxes of six, Quick five of five
const BOX_PRESETS = [{ key: 'classic', label: 'Classic', line: 'Ten boxes of six.' }, { key: 'quick', label: 'Quick', line: 'Five boxes of five.' }];

// a bracket's scoring: Classic doubles each round, Flat is a point a series
const BRACKET_PRESETS = [{ key: 'classic', label: 'Classic', line: 'Each round worth double the one before.' }, { key: 'flat', label: 'Flat', line: 'A point for every right winner.' }];

// the rules, written down from the game's own settings (docs/POOL-TYPES.md §6): what scores, when picks lock, what a
// late joiner plays, what happens to a game called off, how a tie is broken, and what the host may do. They can change
// only until the first lock (migration 172), and everyone hears when they do.
function GameRules({ board }: { board: GameBoard }) {
  const [open, setOpen] = useState(false);
  const pk = board.pickem, rk = board.rank;
  const lines: string[] = [];
  if (pk) {
    lines.push(pk.confidence
      ? `Pick every match${pk.draws ? ' (either side or a draw)' : ''} and give each a number from 1 to the size of the round, each number once a round. A right pick earns its number.`
      : `Pick the winner of every match${pk.draws ? ', or a draw' : ''}. A right pick is worth a point.`);
    lines.push(`It runs from ${pk.word} ${pk.from_round} to ${pk.word} ${pk.to_round}. Each pick locks at its own kick-off, and you can change it until then.`);
    lines.push(pk.draws ? 'The result after ninety minutes and stoppage time counts: extra time and penalties don’t.' : 'A tie counts for nobody: no one picked it.');
    lines.push('Join any time: you play every match still to kick off. A match called off counts for nobody.');
    lines.push('The most points wins. A tie on points shares it.');
  } else if (board.kind === 'series') {
    const rs = board.rounds.filter((r) => r.round >= board.rules.from_round);
    for (const r of rs) {
      const p = board.rules.points?.[r.round] ?? 1, l = board.rules.length?.[r.round] ?? 0;
      // a single game's length is always right, so its points ride with the winner
      const one = r.best_of === 1 && !board.rules.exact_only ? p + l : null;
      lines.push(one != null ? `${r.label}: ${one} ${one === 1 ? 'point' : 'points'} for the winner.` : board.rules.exact_only
        ? `${r.label}: ${p} ${p === 1 ? 'point' : 'points'} only when the winner and the number of games are both right.`
        : `${r.label}: ${p} ${p === 1 ? 'point' : 'points'} for the winner${l ? `, ${l} more when the number of games is right too` : ''}.`);
    }
    lines.push(`Each series locks at the ${wordsOf(board).start} of its first game; a later round opens to picks once its matchup is set.`);
    lines.push('Join any time: you play every series still to start.');
    if (board.tiebreak) lines.push(`A tie on points goes to whoever is closest on the total ${wordsOf(board).score} in ${lastGameOf(board.tiebreak.label, singles(board))}.`);
  } else if (board.bracket) {
    const br = board.bracket;
    const byRound = [...new Map(br.series.map((x) => [x.round, x])).values()];
    lines.push(`Pick the winner of every series, from the ${byRound[0]?.label ?? 'first round'} to the ${byRound[byRound.length - 1]?.label ?? 'final'}, all before the first game; a later winner is one you picked in a series before it.`);
    lines.push(byRound.map((x) => `${x.label}: ${x.points} ${x.points === 1 ? 'point' : 'points'}`).join(' · ') + ', for each right winner.');
    lines.push('The whole bracket locks with the first game, and you can change it until then.');
    lines.push('A pick whose club is knocked out can’t score, so what’s still possible shrinks as the clubs go out.');
    if (br.tiebreak.label) lines.push(`A tie on points goes to whoever is closest on the total ${wordsOf(board).score} in ${lastGameOf(br.tiebreak.label, br.series.every((x) => x.best_of === 1))}.`);
  } else if (board.players) {
    const bp = board.players, s = bp.scoring;
    lines.push(`Take one player from each of the ${bp.boxes.length} boxes. The boxes were dealt when the pool started: the players expected to score the most in these nights, forwards first, then defence, then goalies, the best in box 1.`);
    lines.push(`A goal is worth ${s.g}, an assist ${s.a}, a goalie’s win ${s.w}${s.sho ? ` and a shutout ${s.sho} more` : ''}. Every game from ${new Date(`${bp.from}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} to ${new Date(`${bp.to}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} counts, live as it’s played.`);
    lines.push('Your team locks at the first puck drop of the first night, and you can change it until then. A player who gets hurt stays on your team.');
    lines.push('The most points wins. A tie on points shares it.');
  } else if (rk) {
    lines.push(`Put the clubs in order once. At the first ${wordsOf(board).start} of the ${rk.round_label} the ${rk.field || ''} clubs still in are ranked in your order: your top club pays ${rk.field || 'the most'} for every game it wins, your last pays 1.`.replace('the  clubs', 'the clubs'));
    lines.push('Clubs out by the lock don’t count, and your order is final from then on.');
    lines.push('The most points wins. A tie on points shares it.');
  } else return null;
  lines.push('Everyone’s picks stay hidden until they lock; the pool’s split shows after.');
  lines.push(`The host can enter a pick for you if you ask (you’ll hear about it)${pk ? ', and settle a match the feed gets wrong, with the reason shown on the match' : ''}.`);
  lines.push('Points only: nothing is bought, sold or paid.');
  const frozen = board.status === 'done' || (pk ? pk.round > pk.from_round || pk.fixtures.some((f) => f.locked && f.picked > 0) : board.bracket ? board.bracket.locked : board.players ? board.players.locked : rk ? rk.locked : !!board.series?.some((s) => s.locked));
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block font-semibold text-white">The rules</span>
          <span className="block text-[11px] text-mute">{frozen ? 'Set before the first lock and fixed since' : 'The host can change them until the first lock; you’ll hear if they do'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-mute transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="space-y-2 border-t border-white/[.06] px-4 py-3 text-sm leading-snug text-slate-200">
          {lines.map((l, i) => <li key={i} className="flex gap-2.5"><span className="num mt-px w-4 shrink-0 text-right text-xs font-black text-gold">{i + 1}</span><span className="min-w-0">{l}</span></li>)}
        </ol>
      )}
    </div>
  );
}

function GameTable({ board }: { board: GameBoard }) {
  const { teams } = useLeague();
  return (
    <Section title="The table">
      <div className="card divide-y divide-white/[.05] p-1">
        {board.table.map((r, i) => {
          const t = teams.find((x) => x.id === r.team_id);
          return (
            <div key={r.team_id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${r.team_id === board.me ? 'bg-gold/[.06]' : ''}`}>
              <span className={`num w-5 shrink-0 text-center text-sm font-black ${i === 0 && r.points > 0 ? 'text-gold' : 'text-mute'}`}>{i + 1}</span>
              <TeamBadge team={t} size={32} />
              <div className="min-w-0 flex-1">
                <div className="break-words font-semibold text-white">{t?.gm_name ?? t?.name}</div>
                <div className="text-[11px] text-mute">{board.kind === 'squares' ? `${r.picked} ${r.picked === 1 ? 'square' : 'squares'} · ${r.right} ${r.right === 1 ? 'hit' : 'hits'}`
                  : `${board.kind === 'series' ? (singles(board) ? `${r.right} right · ${r.picked} picked` : `${r.right} right · ${r.exact} with the length · ${r.picked} picked`) : board.kind === 'pickem' ? `${r.right} right · ${r.picked} picked` : board.kind === 'bracket' ? (r.picked ? `${r.right} right` : 'No bracket yet') : r.picked ? 'Ranked' : 'Not ranked yet'}${r.possible != null ? ` · up to ${r.possible}` : ''}`}</div>
              </div>
              <span className="num shrink-0 text-xl font-black text-white">{r.points}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-mute">{board.kind === 'squares' ? 'Coins each player’s squares have taken.' : `Up to: the most each player can still finish with${board.kind === 'pickem' ? ', every match still to come picked right' : ''}. ${board.kind === 'series' ? 'A tie goes to the closest tiebreaker.' : ''}`}</p>
    </Section>
  );
}

// the cards on the pool's home: one per game, with what is waiting on you
export function PoolGameCards() {
  const { me } = useLeague();
  const { games } = usePoolGames();
  if (!games?.length) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {games.map((g) => {
        const Icon = ICON[g.kind] ?? Swords;
        return (
          <Link key={g.id} to={`/picks?g=${g.id}`} className="card-hero flex items-center gap-3 p-4 transition hover:border-gold/40">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15"><Icon className="h-6 w-6 text-gold" /></span>
            <span className="relative min-w-0 flex-1">
              <span className="block font-semibold text-white">{g.title}</span>
              <span className="block text-xs text-white/70">{g.status === 'done' ? 'Done: see who won' : g.next_lock ? `${g.kind === 'squares' ? 'Grid closes' : 'Next lock'} ${lockText(g.next_lock)}` : g.kind === 'squares' ? 'Digits drawn: follow the games' : 'Picks open as each round is set'}</span>
            </span>
            {g.status === 'open' && me?.role === 'gm' && (g.to_pick > 0
              ? <span className="chip relative shrink-0 border-amber-400/40 text-amber-200">{g.kind === 'rank' ? 'To rank' : g.kind === 'squares' ? 'Claim a square' : `${g.to_pick} to pick`}</span>
              : <span className="chip relative shrink-0 border-emerald-400/40 text-emerald-200">All in</span>)}
          </Link>
        );
      })}
    </div>
  );
}

export default function Picks() {
  const { me, teams } = useLeague();
  const [params, setParams] = useSearchParams();
  const { games } = usePoolGames();
  const gid = Number(params.get('g')) || games?.[0]?.id || null;
  const [board, setBoard] = useState<GameBoard | null | undefined>(undefined);
  const [actAs, setActAs] = useState<{ team: number; name: string } | null>(null);
  const now = useNow(60000);
  const load = useCallback(() => { if (gid) rpc<GameBoard>('pool_game_board', { p_game: gid }).then(setBoard, () => setBoard(null)); }, [gid]);
  useEffect(() => { setBoard(undefined); load(); }, [load]);
  useEffect(() => { load(); }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: number) => { const t = teams.find((x) => x.id === id); return t?.gm_name ?? t?.name ?? '?'; };

  if (games && !games.length) return (
    <div className="space-y-5">
      <PageHeader icon={<Swords className="h-6 w-6 text-gold" />} title="Picks" sub="Series, rankings and more" />
      <Empty icon="⚾" title="No games in this pool yet">{me?.is_commish ? <Link to="/host" className="btn-gold mt-3 inline-block">Add one from the Host page</Link> : 'The host adds them.'}</Empty>
    </div>
  );
  if (!board) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  const rank = board.table.findIndex((r) => r.team_id === board.me);
  const mine = board.table[rank];
  const Icon = ICON[board.kind] ?? Swords;
  const winners = (board.winners ?? []).map(name);
  const sq = board.squares;
  const pk = board.pickem;
  const sub = pk ? (pk.confidence ? 'Confidence: number your picks, a right one earns its number' : 'A point for every right pick')
    : sq ? `${sq.cost} coins a square · ${sq.pay_when === 'innings' ? 'pays after the 3rd, 6th and final' : sq.pay_when === 'quarters' ? 'pays every quarter' : sq.pay_when === 'periods' ? 'pays every period' : 'pays on the final score'}`
    : board.kind === 'series'
    ? (board.rules.exact_only ? 'Winner and length both right, or nothing' : `Points by round: ${board.rounds.map((r) => (board.rules.points?.[String(r.round)] ?? 1) + (singles(board) ? board.rules.length?.[String(r.round)] ?? 0 : 0)).join('-')}${singles(board) ? '' : `, plus ${board.rounds.map((r) => board.rules.length?.[String(r.round)]).join('-')} for the length`}`)
    : board.players ? `One player from each of ${board.players.boxes.length} boxes · goals and assists`
    : board.bracket ? `Every winner to the final · ${[...new Map(board.bracket.series.map((x) => [x.round, x.points])).values()].join('-')} points by round`
    : 'Every win pays its club’s rank';

  return (
    <div className="space-y-5 pb-10">
      <PageHeader icon={<Icon className="h-6 w-6 text-gold" />} title={board.title} sub={`${board.competition_name} · ${sub}`} right={board.competition?.startsWith('mlb') ? <Link to="/sport/mlb" className="text-xs font-semibold text-sky-300">Scores and bracket →</Link> : undefined} />
      {games && games.length > 1 && (
        <div className="scroll-x flex gap-1.5">
          {games.map((g) => { const I = ICON[g.kind] ?? Swords; return (
            <button key={g.id} type="button" onClick={() => setParams({ g: String(g.id) })} className={`tab inline-flex shrink-0 items-center gap-1.5 ${g.id === board.id ? 'tab-on' : 'bg-white/[.05]'}`}>
              <I className="h-4 w-4" /> {g.title}{g.to_pick > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />}
            </button>); })}
        </div>
      )}
      {board.status === 'done' ? (
        <div className="card-hero p-5 text-center"><div className="relative"><div className="text-5xl">🏆</div><div className="h-display text-shine mt-2 text-3xl">{winners.join(' and ') || 'Nobody'}</div><div className="mt-1 text-sm text-white/70">{sq ? `took the most coins in ${board.title}` : `won ${board.title}`}</div></div></div>
      ) : mine && !sq && (
        <div className="grid grid-cols-3 gap-2">
          {[['Rank', ordinal(rank + 1), `of ${board.table.length}`], ['Points', String(mine.points), board.kind === 'series' || board.kind === 'pickem' ? `${mine.right} right` : board.kind === 'players' ? `${mine.right} G · ${mine.exact} A` : 'so far'], board.kind === 'players' ? ['Picked by', String(board.players?.picked ?? 0), 'in the pool'] : ['Up to', String(mine.possible), 'still possible']].map(([k, v, s]) => (
            <div key={k} className="rounded-2xl border border-white/10 bg-white/[.04] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[.18em] text-mute">{k}</div>
              <div className="num mt-0.5 text-2xl font-black text-white">{v}</div>
              <div className="text-[11px] text-mute">{s}</div>
            </div>
          ))}
        </div>
      )}
      {actAs && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[.08] p-3 text-sm text-amber-100">
          <span className="min-w-0 flex-1"><b>Entering picks for {actAs.name}.</b> Their own picks stay private; what you save here replaces theirs{pk ? ' for these matches' : board.kind === 'rank' || board.kind === 'bracket' || board.kind === 'players' ? '' : ' for each series you pick'}.</span>
          <button type="button" className="btn-ghost shrink-0" onClick={() => setActAs(null)}>Done</button>
        </div>
      )}
      {pk ? <PickemGame key={`${board.id}-${actAs?.team ?? 'me'}`} gameId={board.id} first={pk} status={board.status} name={name} reload={load} actAs={actAs ?? undefined} />
        : sq ? <SquaresGame data={sq} gameId={board.id} status={board.status} reload={load} name={name} />
        : board.kind === 'bracket' && board.bracket ? <BracketGame key={`${board.id}-${actAs?.team ?? 'me'}`} gameId={board.id} data={board.bracket} words={wordsOf(board)} status={board.status} reload={load} actAs={actAs ?? undefined} />
        : board.kind === 'players' && board.players ? <BoxPoolGame key={`${board.id}-${actAs?.team ?? 'me'}`} gameId={board.id} data={board.players} status={board.status} reload={load} actAs={actAs ?? undefined} />
        : board.kind === 'series' ? <SeriesGame key={`${board.id}-${actAs?.team ?? 'me'}`} board={board} reload={load} name={name} actAs={actAs ?? undefined} />
        : board.kind === 'rank' ? <RankGame key={`${board.id}-${actAs?.team ?? 'me'}`} board={board} reload={load} name={name} actAs={actAs ?? undefined} />
        : <div className="card p-4 text-sm text-mute">This kind of game is newer than this page. Pull down to refresh, or reopen the app.</div>}
      {me?.is_commish && board.status === 'open' && !actAs && <HostDesk board={board} reload={load} onActAs={setActAs} />}
      <GameTable board={board} />
      <GameRules board={board} />
    </div>
  );
}

// the host's desk for a game (migration 172): its rules until the first lock, and picks entered for a member who asked.
// A pick'em match is settled by hand from its own card.
function HostDesk({ board, reload, onActAs }: { board: GameBoard; reload: () => void; onActAs: (a: { team: number; name: string }) => void }) {
  const { teams, me } = useLeague();
  const { busy, run } = useAction();
  const pk = board.pickem;
  const [preset, setPreset] = useState<string>(board.rules.preset ?? 'classic');
  const [toRound, setToRound] = useState<number>(pk?.to_round ?? 0);
  // a box pool's window ('week', 'month', 'season'): the same key a series game uses for its length points
  const boxLen = board.kind === 'players' ? String((board.rules as { length?: unknown }).length ?? 'month') : 'month';
  const [len, setLen] = useState<string>(boxLen);
  if (board.kind !== 'pickem' && board.kind !== 'series' && board.kind !== 'rank' && board.kind !== 'bracket' && board.kind !== 'players') return null;
  const rules = board.kind !== 'rank';
  // the server has the last word; this hides the rules once the game has plainly locked
  const locked = pk ? pk.round > pk.from_round || pk.fixtures.some((f) => f.locked && f.picked > 0) : board.bracket ? board.bracket.locked : board.players ? board.players.locked : !!board.series?.some((s) => s.locked);
  // a box pool's boxes stay once a team is in, like a pick'em's scoring
  const picked = pk ? pk.fixtures.some((f) => f.picked > 0) : board.players ? board.players.picked > 0 : false;
  const presetLock = !!pk || board.kind === 'players';
  const members = teams.filter((t) => t.role === 'gm' && t.id !== me?.id);
  const changed = preset !== (board.rules.preset ?? 'classic') || (pk && toRound !== pk.to_round) || (board.kind === 'players' && len !== boxLen);
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${on ? 'bg-gold text-[#0b1220] ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10'} disabled:opacity-40`;
  return (
    <Section title="Host">
      <div className="card space-y-4 p-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute">The rules</div>
          {!rules ? <p className="text-sm text-mute">Rank the teams has no rules to change: every win pays the rank its club was given.</p>
            : locked ? <p className="text-sm text-mute">The rules froze at the first lock, so everyone plays the game they joined.</p> : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(pk ? PICKEM_PRESETS : board.kind === 'bracket' ? BRACKET_PRESETS : board.kind === 'players' ? BOX_PRESETS : PRESETS).map((x) => (
                  <button key={x.key} type="button" disabled={presetLock && picked && x.key !== preset} onClick={() => setPreset(x.key)} className={chip(preset === x.key)}>{x.label}</button>
                ))}
              </div>
              {presetLock && picked && <p className="text-[11px] text-mute">{pk ? 'Picks are in, so the scoring stays.' : 'Teams are in, so the boxes stay.'}</p>}
              {board.kind === 'players' && (
                <div className="flex flex-wrap gap-1.5">
                  {[['week', 'A week'], ['month', 'Four weeks'], ['season', 'The season']].map(([k, l]) => (
                    <button key={k} type="button" disabled={picked && k !== len} onClick={() => setLen(k)} className={chip(len === k)}>{l}</button>
                  ))}
                </div>
              )}
              {pk && pk.rounds.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-slate-200">Runs to
                  <select className="input py-1.5 text-sm" value={toRound} onChange={(e) => setToRound(Number(e.target.value))}>
                    {pk.rounds.map((r) => <option key={r.round} value={r.round}>{pk.word} {r.round}</option>)}
                  </select>
                </label>
              )}
              <button type="button" className="btn-gold w-full" disabled={busy || !changed}
                onClick={() => run(async () => { await rpc('pool_game_set_rules', { p_game: board.id, p_rules: { preset, ...(pk ? { to_round: toRound } : {}), ...(board.kind === 'players' ? { length: len } : {}) } }); reload(); }, 'The rules are changed')}>
                Change the rules
              </button>
              <p className="text-[11px] leading-snug text-mute">Rules can change until the first lock; the pool hears about it.</p>
            </div>
          )}
        </div>
        {members.length > 0 && !(board.kind === 'rank' && board.rank?.locked) && !(board.kind === 'bracket' && board.bracket?.locked) && !(board.kind === 'players' && board.players?.locked) && (
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute">Pick for a player who asked</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((t) => <button key={t.id} type="button" onClick={() => onActAs({ team: t.id, name: t.gm_name ?? t.name })} className={chip(false)}>{t.gm_name ?? t.name}</button>)}
            </div>
          </div>
        )}
        {pk && <p className="text-[11px] leading-snug text-mute">A match the feed got wrong or left hanging: tap Settle by hand on its card once it has kicked off.</p>}
      </div>
    </Section>
  );
}

// the host adds a game the pool doesn't run yet, on an event that still has a round to start from; squares go on any
// series still to start that has no grid yet
export function HostGames() {
  const { games, reload } = usePoolGames();
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const [preset, setPreset] = useState<SeriesPreset>('classic');
  const [pkPreset, setPkPreset] = useState<PickemPreset>('classic');
  const [grid, setGrid] = useState<Omit<SquaresRules, 'series'>>(SQUARES_DEFAULT);
  const [on, setOn] = useState<number | null>(null);
  const { busy, run } = useAction();
  const nav = useNavigate();
  // last one standing lives in its own tables, one at a time per pool
  const { board: survivor } = useSurvivor();
  useEffect(() => { rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents(e ?? []), () => setEvents([])); }, []);
  const offers = events.flatMap((e) => e.kinds.filter((k) => k in KINDS && !(k === 'survivor' && survivor?.status === 'open')
    && !games?.some((g) => g.competition === e.competition && g.kind === k && g.status === 'open')).map((k) => ({ e, k })));
  const grids = events.flatMap((e) => (e.grids ?? []).filter((s) => !games?.some((g) => g.kind === 'squares' && g.series === s.id && g.status === 'open')).map((s) => ({ e, s })));
  const series = grids.find((x) => x.s.id === on) ?? grids[0];
  if (!games || (!offers.length && !grids.length)) return null;
  return (
    <Section title="Add a game">
      <div className="space-y-2">
        {offers.map(({ e, k }) => (
          <div key={e.competition + k} className="card space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-xl">{KINDS[k].emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white">{KINDS[k].title} <span className="text-mute">· {e.name}</span></div>
                <div className="text-xs text-mute">{KINDS[k].line} {k === 'players' ? `From ${e.open_label}, four weeks; first puck drop ${lockText(e.next_lock)}.` : <>From {k === 'pickem' || k === 'survivor' ? e.open_label : `the ${e.open_label}`}{k === 'survivor' ? ` to ${e.final_label}` : ''}, first lock {lockText(e.next_lock)}.</>}</div>
              </div>
            </div>
            {k === 'pickem' && (
              <div>
                <div className="flex flex-wrap gap-1.5">{PICKEM_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPkPreset(p.key)} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${pkPreset === p.key ? 'bg-gold text-[#0b1220] ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>{p.label}</button>)}</div>
                <p className="mt-1.5 text-[11px] leading-snug text-mute">{PICKEM_PRESETS.find((p) => p.key === pkPreset)!.line}</p>
              </div>
            )}
            {k === 'series' && (
              <div className="flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${preset === p.key ? 'bg-gold text-[#0b1220] ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>{p.label}</button>)}</div>
            )}
            <button type="button" className="btn-gold w-full" disabled={busy}
              onClick={() => run(async () => { await rpc('pool_game_start', { p_kind: k, p_competition: e.competition, p_rules: k === 'series' ? { preset } : k === 'pickem' ? { preset: pkPreset } : {} }); if (k === 'survivor') nav('/survivor'); else reload(); }, `${KINDS[k].title} is on`)}>
              Start {KINDS[k].title.toLowerCase()}
            </button>
          </div>
        ))}
        {series && (
          <div className="card space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-xl">{KINDS.squares.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white">{KINDS.squares.title} <span className="text-mute">· {series.e.name}</span></div>
                <div className="text-xs text-mute">{KINDS.squares.line}</div>
              </div>
            </div>
            <SquaresKnobs grids={grids.map((x) => x.s)} on={series.s.id} setOn={setOn} grid={grid} setGrid={setGrid} sport={series.e.sport} />
            <button type="button" className="btn-gold w-full" disabled={busy}
              onClick={() => run(async () => { await rpc('pool_game_start', { p_kind: 'squares', p_competition: series.e.competition, p_rules: { ...grid, series: series.s.id } }); reload(); setOn(null); }, 'The grid is open')}>
              Open the grid
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

// a grid's settings: which series, its size, the price of a square, when it pays and how often the digits are drawn
export function SquaresKnobs({ grids, on, setOn, grid, setGrid, dark, sport }: {
  grids: { id: number; label: string; high: string | null; low: string | null; starts_at: string | null; tbd: boolean; round: number; short: string | null; best_of: number }[];
  on: number; setOn: (id: number) => void; grid: Omit<SquaresRules, 'series'>; setGrid: (g: Omit<SquaresRules, 'series'>) => void; dark?: boolean; sport?: string;
}) {
  // the sport's own checkpoints: a choice it can't use (baseball's innings on a football grid) falls back to its first
  const pays = paysFor(sport);
  useEffect(() => { if (!pays.some((p) => p.key === grid.pays)) setGrid({ ...grid, pays: pays[0].key }); }, [sport]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (sel: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${sel ? (dark ? 'bg-white text-[#0b1220] ring-white' : 'bg-gold text-[#0b1220] ring-gold') : 'bg-white/[.04] text-slate-200 ring-white/10'}`;
  const row = (label: string, children: React.ReactNode, note?: string) => (
    <div><div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute">{label}</div><div className="flex flex-wrap gap-1.5">{children}</div>{note && <p className="mt-1.5 text-[11px] leading-snug text-mute">{note}</p>}</div>
  );
  const cur = grids.find((g) => g.id === on);
  return (
    <div className="space-y-3">
      {grids.length > 1 && row('On', grids.map((g) => <button key={g.id} type="button" onClick={() => setOn(g.id)} className={chip(g.id === on)}>{g.short ?? g.label}{g.high && g.low ? ` · ${g.high} v ${g.low}` : ''}</button>))}
      {cur && <p className="text-xs text-slate-300">{gridLabel(cur)} · {cur.best_of === 1 ? `${(START_WORD[sport ?? ''] ?? 'start').replace(/^./, (c) => c.toUpperCase())} ${lockText(cur.starts_at, cur.tbd)}` : `Game 1 ${lockText(cur.starts_at, cur.tbd)} · up to ${cur.best_of} games`}</p>}
      {row('Grid', SIZES.map((x) => <button key={x.key} type="button" onClick={() => setGrid({ ...grid, size: x.key })} className={chip(grid.size === x.key)}>{x.label}</button>), SIZES.find((x) => x.key === grid.size)!.line)}
      {row('A square costs', [5, 10, 25, 50].map((c) => <button key={c} type="button" onClick={() => setGrid({ ...grid, cost: c })} className={chip(grid.cost === c)}>{c} coins</button>),
        `A full grid is a pot of ${(grid.cost * grid.size * grid.size).toLocaleString()} coins.`)}
      {row('Pays', pays.map((x) => <button key={x.key} type="button" onClick={() => setGrid({ ...grid, pays: x.key })} className={chip(grid.pays === x.key)}>{x.label}</button>), (pays.find((x) => x.key === grid.pays) ?? pays[0]).line)}
      {(cur?.best_of ?? 2) > 1 && row('Digits', ([['once', 'One draw'], ['each', 'Fresh each game']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setGrid({ ...grid, digits: k })} className={chip(grid.digits === k)}>{l}</button>),
        grid.digits === 'once' ? 'The same numbers all series: a good square stays good.' : 'New numbers every game, so a bad square gets another chance.')}
    </div>
  );
}
