// Weekly pick'em (migration 170): every match of a round, pick the winner (or a draw where the sport has them), each
// pick locking at its own kick-off. In Confidence each pick also takes a number from 1 to the round's matches, the
// surest highest. Once a match kicks off it shows the pool's split and everyone's pick; once it's over, what yours
// earned. The round's points and the table come from the database on every read. The host (migration 172) can enter a
// round for a member who asked, and settle a match the feed left hanging, for this pool only, with the reason shown.
// Against the spread (migration 283) each pick carries the home side's line from the moment it was saved, and is right
// when its side covers it; the buttons show the line instead of the market's chances.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Lock, MessageCircle } from 'lucide-react';
import { fixtureThread, ThreadSheet, useChannelCounts } from './GameThread';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useAction } from './ui';
import { ShareButton, useCardBrand } from './ShareButton';
import { shareCard } from '../lib/shareCard';
import { Crest } from './Crest';
import type { Club } from '../pages/Picks';
import { chance, useMarket } from '../lib/market';
import { trackFirstCall } from '../lib/analytics';

type Side = 'H' | 'D' | 'A';
interface PkPick { pick: Side; conf?: number; line?: number; auto?: boolean }
export interface PkFixture {
  id: number; kickoff: string; state: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled'; minute: number | null;
  home: Club; away: Club; home_score: number | null; away_score: number | null; result: Side | null; locked: boolean;
  void?: boolean; host?: { reason: string } | null;
  // against the spread: the home side's line now, and what my pick's own line made of the result (P is a push)
  line?: number | null; mine_res?: Side | 'P' | null;
  mine: PkPick | null; picked: number; split: Record<Side, number> | null; calls: { team_id: number; pick: Side; conf: number | null; line?: number }[] | null;
}
export interface PkRound { round: number; first: string; last: string; matches: number; done: boolean; open: number; picked: number; points: number }
export interface PickemData {
  round: number; from_round: number; to_round: number; word: string; confidence: boolean; draws: boolean; size: number; ats?: boolean;
  // a missed pick: zero, or the favourite filled in when the game starts (migration 285)
  missed?: 'zero' | 'favourite';
  rounds: PkRound[]; fixtures: PkFixture[];
  // the round's tiebreaker (migration 284): the total in its last game, locked when it starts
  tiebreak?: { fixture: number; kickoff: string; home: Club; away: Club; locked: boolean; total: number | null; mine: number | null; word: string; cap: number } | null;
}

const TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const short = (c: Club) => c.short ?? c.name.slice(0, 3).toUpperCase();
// a side's spread, from the home side's line: the favourite gives points (−3.5), the underdog gets them (+3.5)
const spread = (homeLine: number, side: Side) => { const v = side === 'H' ? homeLine : -homeLine; return v === 0 ? 'even' : `${v > 0 ? '+' : '\u2212'}${Math.abs(v)}`; };
// who covered a home line: H, A, or P when the margin lands right on it
const cover = (h: number, a: number, homeLine: number): Side | 'P' => (h + homeLine > a ? 'H' : h + homeLine < a ? 'A' : 'P');

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
  // against the spread the host gives the final score too (migration 286): every pick is scored on its own line from it
  const [settle, setSettle] = useState<{ id: number; side: Side | 'void' | null; reason: string; h?: string; a?: string } | null>(null);
  const [data, setData] = useState<PickemData>(first);
  const [draft, setDraft] = useState<Record<number, PkPick | null>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [tbv, setTbv] = useState<string | null>(null);
  const { busy, run } = useAction();
  const market = useMarket(data.fixtures.map((f) => f.id));
  // each match's thread in the pool, with how busy it is
  const [thread, setThread] = useState<number | null>(null);
  const talk = useChannelCounts(useMemo(() => data.fixtures.map((f) => fixtureThread(f.id)), [data.fixtures]));
  const tf = data.fixtures.find((f) => f.id === thread);
  // a new board from the page (the minute refresh) replaces the round shown only when it is the same round
  useEffect(() => { if (first.round === data.round) setData(first); }, [first]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (round: number) => rpc<PickemData>('pool_pickem_board', { p_game: gameId, p_round: round }).then((d) => { if (d) { setData(d); setDraft({}); setTbv(null); } });
  const tb = data.tiebreak;
  const saveTb = () => run(async () => {
    await rpc('pool_game_pick', { p_game: gameId, p_thing: `t:${data.round}`, p_pick: { runs: Math.round(Number(tbv)) } });
    await go(data.round);
  }, 'Tiebreaker saved');

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
  // a long week (an NHL or NBA week is fifty games): every open match not yet picked goes to the market's favourite;
  // in Confidence the surest favourite takes the highest number still free. Nothing is saved until Save.
  const favOpen = data.ats ? [] : data.fixtures.filter((f) => !f.locked && !pickOf(f) && market.get(f.id));
  const pickFavourites = () => {
    const free = Array.from({ length: data.size }, (_, i) => data.size - i).filter((n) => ![...used.values()].includes(n) && !lockedNums.has(n));
    const next = { ...draft };
    [...favOpen].map((f) => { const mk = market.get(f.id)!; return { f, side: (mk.home >= mk.away ? 'H' : 'A') as Side, edge: Math.max(mk.home, mk.away) }; })
      .sort((a, b) => b.edge - a.edge)
      .forEach(({ f, side }) => { next[f.id] = { pick: side, ...(data.confidence ? { conf: free.shift() ?? 1 } : {}) }; });
    setDraft(next);
  };
  const save = () => run(async () => {
    const picks = data.fixtures.filter((f) => !f.locked && f.id in draft).map((f) => ({ fixture: f.id, pick: draft[f.id]?.pick ?? null, conf: draft[f.id]?.conf ?? null }));
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { round: data.round, picks } });
    else await rpc('pool_pickem_save', { p_game: gameId, p_round: data.round, p_picks: picks });
    if (!actAs) trackFirstCall('pickem');
    await go(data.round);
    reload();
  }, actAs ? `${actAs.name}'s picks are in` : 'Your picks are in');
  // the host's word on a match: a side, a draw or void, with the reason; null hands it back to the feed
  const settleSave = (fid: number, outcome: Side | 'void' | null, reason: string, score?: [number, number]) => run(async () => {
    await rpc('pool_result_set', { p_game: gameId, p_fixture: fid, p_outcome: outcome, p_reason: reason || null, ...(score && outcome !== 'void' ? { p_home: score[0], p_away: score[1] } : {}) });
    setSettle(null);
    await go(data.round);
    reload();
  }, outcome ? 'Settled for this pool' : 'Back to the feed');

  const r = data.rounds.find((x) => x.round === data.round);
  const idx = data.rounds.findIndex((x) => x.round === data.round);
  const openLeft = data.fixtures.filter((f) => !f.locked && !pickOf(f)).length;
  const missingConf = data.confidence && data.fixtures.some((f) => !f.locked && pickOf(f) && !pickOf(f)!.conf);
  const cardBrand = useCardBrand();
  // my round as a picture, once a pick has locked: the decided ones first, as many as fit
  const lockedMine = data.fixtures.filter((f) => f.locked && f.mine);
  const shareRound = () => {
    const side = (f: PkFixture, s: Side) => (s === 'H' ? short(f.home) : s === 'A' ? short(f.away) : 'Draw');
    // soccer names the home side first, football the visitors
    const rows = lockedMine.map((f) => ({ q: data.draws ? `${short(f.home)} v ${short(f.away)}` : `${short(f.away)} at ${short(f.home)}`,
      answer: `${side(f, f.mine!.pick)}${data.ats && f.mine!.line != null ? ` ${spread(f.mine!.line, f.mine!.pick)}` : ''}${data.confidence && f.mine!.conf ? ` · ${f.mine!.conf}` : ''}`,
      right: f.void || f.result == null || (data.ats && f.mine_res === 'P') ? null : (data.ats ? f.mine_res ?? f.result : f.result) === f.mine!.pick }))
      .sort((a, b) => Number(b.right != null) - Number(a.right != null));
    const hits = rows.filter((x) => x.right).length, decided = rows.filter((x) => x.right != null).length;
    return shareCard({ kind: 'sheet', eyebrow: 'My picks', brand: cardBrand, who: '', title: `${data.word} ${data.round}`,
      score: decided ? `${hits} of ${decided} right` : `${rows.length} picks in`, rows }, `My ${data.word} ${data.round} picks.`);
  };

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

      {canPick && favOpen.length >= 2 && (
        <button type="button" onClick={pickFavourites} className="flex w-full items-center gap-3 rounded-2xl border border-gold/30 bg-gold/[.07] p-3 text-left transition active:scale-[.99]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-lg">⚡</span>
          <span className="min-w-0 flex-1"><b className="block text-sm text-white">Pick the favourites</b><span className="block text-xs text-white/70">{favOpen.length} open {favOpen.length === 1 ? 'match' : 'matches'} go to the side the market likes{data.confidence ? ', the surest numbered highest' : ''}. Change any before you save.</span></span>
        </button>
      )}

      {data.fixtures.map((f, i) => {
        const p = pickOf(f);
        // a week of nightly games reads by day
        const day = new Date(f.kickoff).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
        const newDay = data.fixtures.length > 12 && (i === 0 || new Date(data.fixtures[i - 1].kickoff).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) !== day);
        const mk = data.ats ? undefined : market.get(f.id);
        const st = status(f);
        const done = f.result != null;
        // against the spread: the line a pick on this match carries (a saved pick keeps its own while it stays on that
        // side), and who covered it once it's over; the host's word, when given, says who covered
        const homeLine = !actAs && p && f.mine && p.pick === f.mine.pick && f.mine.line != null ? f.mine.line : (f.line ?? 0);
        const res: Side | 'P' | null = !data.ats || !done || f.host || f.home_score == null || f.away_score == null ? f.result
          : p && f.mine && p.pick === f.mine.pick && f.mine_res ? f.mine_res : cover(f.home_score, f.away_score ?? 0, homeLine);
        const right = done && p && p.pick === res;
        const sides: { k: Side; label: string; club?: Club }[] = [{ k: 'H', label: short(f.home), club: f.home }, ...(data.draws ? [{ k: 'D' as Side, label: 'Draw' }] : []), { k: 'A', label: short(f.away), club: f.away }];
        const total = f.split ? f.split.H + f.split.D + f.split.A : 0;
        return (
          <div key={f.id}>
          {newDay && <div className="mb-2 mt-1 flex items-center gap-3 px-1 text-[11px] font-black uppercase tracking-[.2em] text-mute">{day}<span className="h-px flex-1 bg-white/[.07]" /></div>}
          <div className={`card overflow-hidden ${done && p ? (right ? 'ring-1 ring-emerald-400/40' : 'opacity-90') : ''}`}>
            <div className="flex items-center gap-2 px-3 pt-3 text-[11px]">
              <span className={`font-bold uppercase tracking-wider ${st.live ? 'text-red-300' : 'text-mute'}`}>{st.live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />}{st.text}</span>
              {f.locked && !done && !f.void && <Lock className="h-3 w-3 text-mute" aria-label="Locked" />}
              <span className="ml-auto text-mute">{f.picked} picked</span>
              <button type="button" onClick={() => setThread(f.id)} aria-label="This match's thread" className={`-my-1 inline-flex items-center gap-1 rounded-full px-2 py-1 font-bold ring-1 ${talk.get(fixtureThread(f.id)) ? 'bg-sky-400/15 text-sky-200 ring-sky-400/30' : 'bg-white/[.04] text-slate-300 ring-white/10'}`}><MessageCircle className="h-3 w-3" />{talk.get(fixtureThread(f.id)) || 'Talk'}</button>
            </div>
            {/* the match: crests, names and the score once it's on */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
              {/* on a narrow phone the crest sits above the name, so a long one ("Jacksonville") keeps the whole column */}
              <div className="flex min-w-0 flex-col items-start gap-1 min-[400px]:flex-row min-[400px]:items-center min-[400px]:gap-2"><Crest c={f.home} size={30} /><span className="min-w-0 text-balance break-words text-[13px] font-semibold leading-tight text-white hyphens-auto min-[400px]:text-sm">{f.home.name}</span></div>
              <span className="num text-center font-display text-xl font-extrabold text-white">{f.home_score != null && f.state !== 'scheduled' ? `${f.home_score}–${f.away_score}` : <span className="text-sm text-mute">v</span>}</span>
              <div className="flex min-w-0 flex-col items-end gap-1 text-right min-[400px]:flex-row-reverse min-[400px]:items-center min-[400px]:gap-2"><Crest c={f.away} size={30} /><span className="min-w-0 text-balance break-words text-[13px] font-semibold leading-tight text-white hyphens-auto min-[400px]:text-sm">{f.away.name}</span></div>
            </div>
            {/* the pick: three (or two) buttons, then the confidence number */}
            <div className="flex items-center gap-1.5 px-3 pb-3">
              <div className={`grid flex-1 gap-1.5 ${data.draws ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {sides.map((s) => {
                  const on = p?.pick === s.k;
                  const won = done && res === s.k;
                  return (
                    <button key={s.k} type="button" disabled={f.locked || !canPick} onClick={() => choose(f, s.k)}
                      className={`flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold ring-1 transition ${on ? (done ? (won ? 'bg-emerald-400 text-[#0b1220] ring-emerald-300' : 'bg-red-400/25 text-red-100 ring-red-400/40') : 'bg-gold text-[#0b1220] ring-gold') : won ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/30' : 'bg-white/[.04] text-slate-200 ring-white/10 enabled:hover:bg-white/[.08]'} disabled:cursor-default`}>
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}{s.label}
                      {/* what the market gave this side before kick-off */}
                      {mk && <span className={`num font-semibold ${on ? 'opacity-70' : 'text-mute'}`}>{chance(s.k === 'H' ? mk.home : s.k === 'A' ? mk.away : mk.draw)}</span>}
                      {data.ats && s.k !== 'D' && <span className={`num font-semibold ${on ? 'opacity-70' : 'text-mute'}`}>{spread(homeLine, s.k)}</span>}
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
            {f.locked && !actAs && f.mine?.auto && <div className="border-t border-white/[.05] px-3 py-1.5 text-[11px] font-semibold text-sky-300">Picked for you at the start: the favourite</div>}
            {done && p && <div className={`border-t border-white/[.05] px-3 py-1.5 text-[11px] font-semibold ${right ? 'text-emerald-300' : 'text-mute'}`}>{right ? `${data.ats ? 'Covered' : 'Right'}: +${data.confidence ? p.conf : 1}` : res === 'P' ? 'A push: it landed right on the line' : data.ats ? 'Didn\u2019t cover' : 'Not this time'}</div>}
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
                {data.ats && settle.side !== 'void' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                    <span className="min-w-0 flex-1 basis-full min-[380px]:basis-auto">Final score, for the spread</span>
                    {(['h', 'a'] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1.5"><span className="text-[11px] font-bold text-mute">{short(k === 'h' ? f.home : f.away)}</span>
                      <input type="number" inputMode="numeric" min={0} step={1} aria-label={k === 'h' ? `${f.home.name} score` : `${f.away.name} score`} placeholder="0"
                        value={settle[k] ?? ''} className="input num h-9 w-16 px-1 text-center text-sm font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        onChange={(e) => {
                          const next = { ...settle, [k]: e.target.value };
                          const hh = Number(next.h), aa = Number(next.a);
                          // the result follows the score as it is typed
                          if (next.h && next.a) next.side = hh > aa ? 'H' : hh < aa ? 'A' : data.draws ? 'D' : next.side;
                          setSettle(next);
                        }} /></label>
                    ))}
                  </div>
                )}
                <input className="input w-full text-sm" maxLength={200} placeholder="Why: the feed stuck at half-time, it ended 2-0" value={settle.reason} onChange={(e) => setSettle({ ...settle, reason: e.target.value })} />
                <div className="flex gap-2">
                  <button type="button" className="btn-gold flex-1" disabled={busy || !settle.side || settle.reason.trim().length < 3 || (data.ats && settle.side !== 'void' && (!settle.h || !settle.a))}
                    onClick={() => settleSave(f.id, settle.side, settle.reason, data.ats && settle.h && settle.a ? [Math.round(Number(settle.h)), Math.round(Number(settle.a))] : undefined)}>Settle it</button>
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
                    <span key={c.team_id} className="rounded-full bg-white/[.05] px-2 py-0.5 text-[11px] text-slate-200 ring-1 ring-white/10">{name(c.team_id)}: <b>{c.pick === 'D' ? 'Draw' : short(c.pick === 'H' ? f.home : f.away)}{data.ats && c.line != null && c.pick !== 'D' ? ` ${spread(c.line, c.pick)}` : ''}</b>{c.conf ? ` ×${c.conf}` : ''}</span>
                  ))}</div>
                )}
              </button>
            )}
          </div>
          </div>
        );
      })}

      {/* the round's tiebreaker: the total in its last game */}
      {tb && !actAs && (
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] text-lg ring-1 ring-white/10">🎯</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white">Tiebreaker</div>
            <div className="text-[11px] leading-snug text-mute">Total {tb.word} in {data.draws ? `${short(tb.home)} v ${short(tb.away)}` : `${short(tb.away)} at ${short(tb.home)}`}, the {data.word.toLowerCase()}&rsquo;s last game{tb.locked ? '' : `, ${TIME.format(new Date(tb.kickoff))}`}. Closest breaks a tie.</div>
          </div>
          {tb.locked || !canPick ? (
            <div className="shrink-0 text-right">
              <div className="num font-display text-lg font-extrabold text-white">{tb.mine ?? '–'}</div>
              <div className="text-[10px] font-semibold text-mute">{tb.total != null ? (tb.mine != null ? `Final ${tb.total} · ${Math.abs(tb.mine - tb.total)} off` : `Final ${tb.total}`) : tb.mine != null ? 'Your call' : 'No call'}</div>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5">
              <input type="number" inputMode="numeric" min={0} max={tb.cap} step={1} aria-label="Tiebreaker total" placeholder="0"
                value={tbv ?? (tb.mine != null ? String(tb.mine) : '')} onChange={(e) => setTbv(e.target.value)}
                className="input num h-10 w-16 text-center text-base font-bold" />
              <button type="button" className="btn-gold h-10 px-3 text-xs" disabled={busy || tbv == null || tbv === '' || Number(tbv) < 0 || Number(tbv) > tb.cap || Number(tbv) === tb.mine} onClick={saveTb}>Save</button>
            </div>
          )}
        </div>
      )}

      {canPick && (dirty || openLeft > 0) && data.fixtures.some((f) => !f.locked) && (
        <div className="sticky bottom-24 z-10">
          <button type="button" className="btn-gold w-full py-3 shadow-[0_12px_30px_-10px_rgba(0,0,0,.8)]" disabled={busy || !dirty || missingConf} onClick={save}>
            {dirty ? (actAs ? `Save ${actAs.name}'s ${data.word.toLowerCase()} ${data.round} picks` : `Save my ${data.word.toLowerCase()} ${data.round} picks`) : `${openLeft} ${openLeft === 1 ? 'match' : 'matches'} still to pick`}
          </button>
        </div>
      )}
      {!actAs && lockedMine.length > 0 && <ShareButton className="btn-ghost w-full" label={`Share my ${data.word.toLowerCase()} ${data.round} picks`} make={shareRound} />}
      <p className="px-1 text-xs text-mute">
        {data.missed === 'favourite' && 'Forget one and it takes the favourite when the game starts. '}
        {data.ats && 'Against the spread: your pick takes the line shown when you save it (or the line at kick-off, if none is out yet), and keeps it while you stay on that side. Your side has to cover; landing right on the line is a push. '}
        {data.confidence ? `Number your picks from 1 to ${data.size}: your surest is ${data.size}, and a right pick earns its number. Taking a number another match has swaps the two.` : 'A right pick is a point.'} Each pick locks at its own kick-off{data.draws ? '; a draw is the result after ninety minutes' : data.ats ? '; a tie is scored against the line like any other result' : '; a tie counts for nobody'}. A postponed match counts for nobody.
      </p>
      <ThreadSheet channel={tf ? fixtureThread(tf.id) : null} onClose={() => setThread(null)} title={tf ? `${short(tf.home)} v ${short(tf.away)}` : ''}
        head={tf && (
          <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl p-3 ring-1 ${status(tf).live ? 'bg-red-400/[.07] ring-red-400/30' : 'bg-white/[.04] ring-white/[.06]'}`}>
            <div className="flex min-w-0 items-center gap-2"><Crest c={tf.home} size={26} /><span className="min-w-0 break-words text-[13px] font-semibold leading-tight text-white">{tf.home.name}</span></div>
            <div className="text-center"><div className="num font-display text-xl font-extrabold text-white">{tf.home_score != null && tf.state !== 'scheduled' ? `${tf.home_score}–${tf.away_score}` : 'v'}</div><div className={`text-[10px] font-bold uppercase tracking-wider ${status(tf).live ? 'text-red-300' : 'text-mute'}`}>{status(tf).text}</div></div>
            <div className="flex min-w-0 flex-row-reverse items-center gap-2 text-right"><Crest c={tf.away} size={26} /><span className="min-w-0 break-words text-[13px] font-semibold leading-tight text-white">{tf.away.name}</span></div>
          </div>
        )} />
    </div>
  );
}
