// Weekly pick'em (migration 170): every match of a round, pick the winner (or a draw where the sport has them), each
// pick locking at its own kick-off. In Confidence each pick also takes a number from 1 to the round's matches, the
// surest highest. Once a match kicks off it shows the pool's split and everyone's pick; once it's over, what yours
// earned. The round's points and the table come from the database on every read. The host (migration 172) can enter a
// round for a member who asked, and settle a match the feed left hanging, for this pool only, with the reason shown.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useAction } from './ui';
import { Crest } from './Crest';
import type { Club } from '../pages/Picks';
import { chance, useMarket } from '../lib/market';

type Side = 'H' | 'D' | 'A';
interface PkPick { pick: Side; conf?: number }
export interface PkFixture {
  id: number; kickoff: string; state: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled'; minute: number | null;
  home: Club; away: Club; home_score: number | null; away_score: number | null; result: Side | null; locked: boolean;
  void?: boolean; host?: { reason: string } | null;
  mine: PkPick | null; picked: number; split: Record<Side, number> | null; calls: { team_id: number; pick: Side; conf: number | null }[] | null;
}
export interface PkRound { round: number; first: string; last: string; matches: number; done: boolean; open: number; picked: number; points: number }
export interface PickemData {
  round: number; from_round: number; to_round: number; word: string; confidence: boolean; draws: boolean; size: number;
  rounds: PkRound[]; fixtures: PkFixture[];
}

const TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const short = (c: Club) => c.short ?? c.name.slice(0, 3).toUpperCase();

// where a match stands, in a few words
function status(f: PkFixture): { text: string; live: boolean } {
  if (f.host) return { text: f.void ? 'Void, set by the host' : 'Result set by the host', live: false };
  if (f.state === 'live') return { text: f.minute ? `${f.minute}'` : 'Live', live: true };
  if (f.state === 'final') return { text: 'Full time', live: false };
  if (f.state === 'postponed') return { text: 'Postponed: counts for nobody', live: false };
  if (f.state === 'cancelled') return { text: 'Called off: counts for nobody', live: false };
  return { text: f.locked ? 'Kicked off' : TIME.format(new Date(f.kickoff)), live: false };
}

export function PickemGame({ gameId, first, status: gameStatus, name, reload, actAs }: {
  gameId: number; first: PickemData; status: 'open' | 'done'; name: (id: number) => string; reload: () => void;
  // the host entering a round for a member: a clean slate (their picks stay private), saved as theirs
  actAs?: { team: number; name: string };
}) {
  const { me } = useLeague();
  const host = !!me?.is_commish && gameStatus === 'open' && !actAs;
  const [settle, setSettle] = useState<{ id: number; side: Side | 'void' | null; reason: string } | null>(null);
  const [data, setData] = useState<PickemData>(first);
  const [draft, setDraft] = useState<Record<number, PkPick | null>>({});
  const [open, setOpen] = useState<number | null>(null);
  const { busy, run } = useAction();
  const market = useMarket(data.fixtures.map((f) => f.id));
  // a new board from the page (the minute refresh) replaces the round shown only when it is the same round
  useEffect(() => { if (first.round === data.round) setData(first); }, [first]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (round: number) => rpc<PickemData>('pool_pickem_board', { p_game: gameId, p_round: round }).then((d) => { if (d) { setData(d); setDraft({}); } });

  const pickOf = (f: PkFixture): PkPick | null => (f.id in draft ? draft[f.id] : actAs ? null : f.mine);
  const dirty = Object.keys(draft).length > 0;
  const canPick = gameStatus === 'open' && (me?.role === 'gm' || !!actAs);
  // the numbers taken this round, by match (locked picks keep theirs)
  const used = useMemo(() => {
    const m = new Map<number, number>();
    data.fixtures.forEach((f) => { const p = pickOf(f); if (p?.conf) m.set(f.id, p.conf); });
    return m;
  }, [data, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const freeTop = () => { for (let n = data.size; n >= 1; n--) if (![...used.values()].includes(n)) return n; return 1; };

  const choose = (f: PkFixture, side: Side) => {
    const cur = pickOf(f);
    if (cur?.pick === side) { setDraft({ ...draft, [f.id]: null }); return; }
    setDraft({ ...draft, [f.id]: { pick: side, ...(data.confidence ? { conf: cur?.conf ?? freeTop() } : {}) } });
  };
  // a number already on another open match swaps with it; a locked one can't be taken
  const setConf = (f: PkFixture, n: number) => {
    const cur = pickOf(f);
    if (!cur) return;
    const next = { ...draft, [f.id]: { ...cur, conf: n } };
    const other = data.fixtures.find((x) => x.id !== f.id && used.get(x.id) === n);
    if (other && !other.locked) { const op = pickOf(other)!; next[other.id] = { ...op, conf: cur.conf }; }
    setDraft(next);
  };
  const lockedNums = new Set(actAs ? [] : data.fixtures.filter((f) => f.locked && f.mine?.conf).map((f) => f.mine!.conf!));
  const save = () => run(async () => {
    const picks = data.fixtures.filter((f) => !f.locked && f.id in draft).map((f) => ({ fixture: f.id, pick: draft[f.id]?.pick ?? null, conf: draft[f.id]?.conf ?? null }));
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { round: data.round, picks } });
    else await rpc('pool_pickem_save', { p_game: gameId, p_round: data.round, p_picks: picks });
    await go(data.round);
    reload();
  }, actAs ? `${actAs.name}'s picks are in` : 'Your picks are in');
  // the host's word on a match: a side, a draw or void, with the reason; null hands it back to the feed
  const settleSave = (fid: number, outcome: Side | 'void' | null, reason: string) => run(async () => {
    await rpc('pool_result_set', { p_game: gameId, p_fixture: fid, p_outcome: outcome, p_reason: reason || null });
    setSettle(null);
    await go(data.round);
    reload();
  }, outcome ? 'Settled for this pool' : 'Back to the feed');

  const r = data.rounds.find((x) => x.round === data.round);
  const idx = data.rounds.findIndex((x) => x.round === data.round);
  const openLeft = data.fixtures.filter((f) => !f.locked && !pickOf(f)).length;
  const missingConf = data.confidence && data.fixtures.some((f) => !f.locked && pickOf(f) && !pickOf(f)!.conf);

  return (
    <div className="space-y-3">
      {/* the round, with the ones either side a tap away */}
      <div className="card-hero flex items-center gap-2 p-3">
        <button type="button" aria-label="Previous round" disabled={idx <= 0} onClick={() => go(data.rounds[idx - 1].round)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-25"><ChevronLeft className="h-5 w-5" /></button>
        <div className="relative min-w-0 flex-1 text-center">
          <div className="font-display text-xl font-extrabold text-white">{data.word} {data.round}</div>
          <div className="text-[11px] text-white/70">{r ? (actAs ? `${r.matches} matches · picking for ${actAs.name}` : r.done ? `Played · you got ${r.points} ${r.points === 1 ? 'point' : 'points'}` : `${r.matches} matches · ${r.picked} of ${r.matches} picked${r.open < r.matches && r.open > 0 ? ` · ${r.open} still to kick off` : ''}`) : ''}</div>
        </div>
        <button type="button" aria-label="Next round" disabled={idx < 0 || idx >= data.rounds.length - 1} onClick={() => go(data.rounds[idx + 1].round)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-25"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {data.fixtures.map((f) => {
        const p = pickOf(f);
        const mk = market.get(f.id);
        const st = status(f);
        const done = f.result != null;
        const right = done && p && p.pick === f.result;
        const sides: { k: Side; label: string; club?: Club }[] = [{ k: 'H', label: short(f.home), club: f.home }, ...(data.draws ? [{ k: 'D' as Side, label: 'Draw' }] : []), { k: 'A', label: short(f.away), club: f.away }];
        const total = f.split ? f.split.H + f.split.D + f.split.A : 0;
        return (
          <div key={f.id} className={`card overflow-hidden ${done && p ? (right ? 'ring-1 ring-emerald-400/40' : 'opacity-90') : ''}`}>
            <div className="flex items-center gap-2 px-3 pt-3 text-[11px]">
              <span className={`font-bold uppercase tracking-wider ${st.live ? 'text-red-300' : 'text-mute'}`}>{st.live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />}{st.text}</span>
              {f.locked && !done && !f.void && <Lock className="h-3 w-3 text-mute" aria-label="Locked" />}
              <span className="ml-auto text-mute">{f.picked} picked</span>
            </div>
            {/* the match: crests, names and the score once it's on */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2"><Crest c={f.home} size={30} /><span className="min-w-0 text-balance break-words text-[13px] font-semibold leading-tight text-white min-[400px]:text-sm">{f.home.name}</span></div>
              <span className="num text-center font-display text-xl font-extrabold text-white">{f.home_score != null && f.state !== 'scheduled' ? `${f.home_score}–${f.away_score}` : <span className="text-sm text-mute">v</span>}</span>
              <div className="flex min-w-0 flex-row-reverse items-center gap-2 text-right"><Crest c={f.away} size={30} /><span className="min-w-0 text-balance break-words text-[13px] font-semibold leading-tight text-white min-[400px]:text-sm">{f.away.name}</span></div>
            </div>
            {/* the pick: three (or two) buttons, then the confidence number */}
            <div className="flex items-center gap-1.5 px-3 pb-3">
              <div className={`grid flex-1 gap-1.5 ${data.draws ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {sides.map((s) => {
                  const on = p?.pick === s.k;
                  const won = done && f.result === s.k;
                  return (
                    <button key={s.k} type="button" disabled={f.locked || !canPick} onClick={() => choose(f, s.k)}
                      className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold ring-1 transition ${on ? (done ? (won ? 'bg-emerald-400 text-[#0b1220] ring-emerald-300' : 'bg-red-400/25 text-red-100 ring-red-400/40') : 'bg-gold text-[#0b1220] ring-gold') : won ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/30' : 'bg-white/[.04] text-slate-200 ring-white/10 enabled:hover:bg-white/[.08]'} disabled:cursor-default`}>
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}{s.label}
                      {/* what the market gave this side before kick-off */}
                      {mk && <span className={`num font-semibold ${on ? 'opacity-70' : 'text-mute'}`}>{chance(s.k === 'H' ? mk.home : s.k === 'A' ? mk.away : mk.draw)}</span>}
                    </button>
                  );
                })}
              </div>
              {data.confidence && p && (
                f.locked || !canPick ? <span className="num grid h-10 w-11 shrink-0 place-items-center rounded-xl bg-white/[.06] text-sm font-black text-white ring-1 ring-white/10" title="Confidence">×{p.conf ?? '–'}</span>
                  : <select aria-label={`Confidence for ${f.home.name} v ${f.away.name}`} value={p.conf ?? ''} onChange={(e) => setConf(f, Number(e.target.value))}
                      className="num h-10 w-14 shrink-0 rounded-xl bg-gold/15 px-1 text-center text-sm font-black text-gold ring-1 ring-gold/40">
                      {Array.from({ length: data.size }, (_, i) => data.size - i).map((n) => <option key={n} value={n} disabled={lockedNums.has(n) && p.conf !== n}>×{n}</option>)}
                    </select>
              )}
            </div>
            {done && p && <div className={`border-t border-white/[.05] px-3 py-1.5 text-[11px] font-semibold ${right ? 'text-emerald-300' : 'text-mute'}`}>{right ? `Right: +${data.confidence ? p.conf : 1}` : 'Not this time'}</div>}
            {/* the host's word, for everyone to see */}
            {f.host && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-amber-400/20 bg-amber-400/[.06] px-3 py-2 text-[11px] text-amber-100">
                <span className="min-w-0 flex-1"><b>The host settled this one{f.void ? ' as void' : ''}:</b> {f.host.reason}</span>
                {host && <button type="button" disabled={busy} onClick={() => settleSave(f.id, null, '')} className="shrink-0 font-semibold text-sky-300">Hand back to the feed</button>}
              </div>
            )}
            {/* the host settles a match that has kicked off: the feed stalled, or got it wrong */}
            {host && f.locked && !f.host && (settle?.id === f.id ? (
              <div className="space-y-2 border-t border-white/[.05] bg-white/[.02] px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-mute">Settle it for this pool</div>
                <div className={`grid gap-1.5 ${data.draws ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  {[...sides.map((x) => ({ k: x.k as Side | 'void', label: x.k === 'D' ? 'Draw' : `${x.label} win` })), { k: 'void' as const, label: 'Void' }].map((x) => (
                    <button key={x.k} type="button" onClick={() => setSettle({ ...settle, side: x.k })}
                      className={`rounded-xl px-2 py-2 text-xs font-bold ring-1 ${settle.side === x.k ? 'bg-amber-300 text-[#0b1220] ring-amber-200' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>{x.label}</button>
                  ))}
                </div>
                <input className="input w-full text-sm" maxLength={200} placeholder="Why: the feed stuck at half-time, it ended 2-0" value={settle.reason} onChange={(e) => setSettle({ ...settle, reason: e.target.value })} />
                <div className="flex gap-2">
                  <button type="button" className="btn-gold flex-1" disabled={busy || !settle.side || settle.reason.trim().length < 3} onClick={() => settleSave(f.id, settle.side, settle.reason)}>Settle it</button>
                  <button type="button" className="btn-ghost" onClick={() => setSettle(null)}>Cancel</button>
                </div>
                <p className="text-[11px] leading-snug text-mute">Only this pool reads it, and everyone sees why. The match itself stays as the feed has it.</p>
              </div>
            ) : (
              <button type="button" onClick={() => setSettle({ id: f.id, side: null, reason: '' })} className="block w-full border-t border-white/[.05] px-3 py-1.5 text-left text-[11px] font-semibold text-sky-300">Settle by hand</button>
            ))}
            {/* the pool's split, once it has kicked off */}
            {f.split && total > 0 && (
              <button type="button" onClick={() => setOpen(open === f.id ? null : f.id)} className="block w-full border-t border-white/[.05] px-3 py-2 text-left">
                <div className="flex h-2 overflow-hidden rounded-full bg-white/[.06]">
                  {(['H', 'D', 'A'] as Side[]).filter((k) => f.split![k] > 0).map((k) => <span key={k} style={{ width: `${(f.split![k] / total) * 100}%`, background: k === 'H' ? (f.home.color ?? 'rgb(var(--gold-rgb))') : k === 'A' ? (f.away.color ?? '#38bdf8') : '#94a3b8' }} />)}
                </div>
                <div className="mt-1 flex justify-between text-[10px] font-semibold text-mute">
                  <span>{short(f.home)} {Math.round((f.split.H / total) * 100)}%</span>{data.draws && <span>Draw {Math.round((f.split.D / total) * 100)}%</span>}<span>{short(f.away)} {Math.round((f.split.A / total) * 100)}%</span>
                </div>
                {open === f.id && f.calls && (
                  <div className="mt-2 flex flex-wrap gap-1.5">{f.calls.map((c) => (
                    <span key={c.team_id} className="rounded-full bg-white/[.05] px-2 py-0.5 text-[11px] text-slate-200 ring-1 ring-white/10">{name(c.team_id)}: <b>{c.pick === 'D' ? 'Draw' : short(c.pick === 'H' ? f.home : f.away)}</b>{c.conf ? ` ×${c.conf}` : ''}</span>
                  ))}</div>
                )}
              </button>
            )}
          </div>
        );
      })}

      {canPick && (dirty || openLeft > 0) && data.fixtures.some((f) => !f.locked) && (
        <div className="sticky bottom-24 z-10">
          <button type="button" className="btn-gold w-full py-3 shadow-[0_12px_30px_-10px_rgba(0,0,0,.8)]" disabled={busy || !dirty || missingConf} onClick={save}>
            {dirty ? (actAs ? `Save ${actAs.name}'s ${data.word.toLowerCase()} ${data.round} picks` : `Save my ${data.word.toLowerCase()} ${data.round} picks`) : `${openLeft} ${openLeft === 1 ? 'match' : 'matches'} still to pick`}
          </button>
        </div>
      )}
      <p className="px-1 text-xs text-mute">
        {data.confidence ? `Number your picks from 1 to ${data.size}: your surest is ${data.size}, and a right pick earns its number. Taking a number another match has swaps the two.` : 'A right pick is a point.'} Each pick locks at its own kick-off{data.draws ? '; a draw is the result after ninety minutes' : '; a tie counts for nobody'}. A postponed match counts for nobody.
      </p>
    </div>
  );
}
