// Lineup New, one day: the lineup slot by slot with tonight's game, the lock, the expected or live points and the
// game-day status; two taps to move anyone (tap a player, the places he can go light up, tap one); warnings that fix
// themselves in a tap; and the optimizer as a list of changes with what each is worth, for this day or the days ahead.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Copy, FlaskConical, Lock, Sparkles, Trophy, X } from 'lucide-react';
import { useLeague } from '../../lib/store';
import { rpc } from '../../lib/supabase';
import { optimize, type Basis, type LContext } from '../../lib/lineup';
import { injuryBack } from '../../lib/format';
import { START, addDays, hurt, isStart, longDay, monthDay, useDayPoints, useLines, type Kit, type Row } from '../../lib/lineupKit';
import { Headshot, Sheet } from '../ui';
import { GameStatusChip, NewsDot } from '../GameStatus';
import { diffMoves, fmt1, GameLine, SlotPill, useSave } from './bits';
import type { Player } from '../../lib/types';

type Sel = { kind: 'player'; id: number } | { kind: 'empty'; slot: string } | null;

// the best lineup for a day from where it stands, as the auto-pilot works it out (pins respected)
export function useBest(kit: Kit) {
  const { season, me } = useLeague();
  const basis: Basis = me?.auto_basis ?? 'proj';
  const seasonMap = useMemo(() => new Map([...season].map(([k, v]) => [k, { gp: v.gp, fpts: v.fpts, gp14: v.gp14, fpts14: v.fpts14 }])), [season]);
  return (teamId: number, d: string, start: Map<number, string>) => {
    const ctx: LContext = { today: d, weekEnd: d, now: d === kit.today ? kit.nowMs : 0, games: kit.gamesOn.get(d) ?? [], season: seasonMap, caps: kit.caps, avail: kit.avail };
    const rows = kit.rosterOf(teamId).map((x) => ({ player_id: x.p.id, slot: start.get(x.p.id) ?? 'BN', pin: x.r.pin }));
    return optimize(rows, kit.players, 'day', basis, ctx).slots;
  };
}

// why a move: one line a GM can check
function reason(kit: Kit, p: Player, d: string, starting: boolean) {
  const g = kit.gameFor(p.nhl_team, d);
  if (!starting) {
    if (hurt(p)) return p.injury_status ?? 'hurt';
    if (!g) return 'no game';
    return `${fmt1(kit.expPts(p))} expected, less than who replaces him`;
  }
  const opp = g ? (g.home === p.nhl_team ? `vs ${g.away}` : `@${g.home}`) : '';
  return `${opp} · ${fmt1(kit.expPts(p))} expected${kit.light(d) ? ' · light night' : ''}`;
}

export function OptimizeSheet({ kit, teamId, day, open, onClose, initial = 1 }: { kit: Kit; teamId: number; day: string; open: boolean; onClose: () => void; initial?: number }) {
  const best = useBest(kit);
  const { save } = useSave();
  const { refresh } = useLeague();
  const [scope, setScope] = useState(initial);
  useEffect(() => { if (open) setScope(initial); }, [open, initial]);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => Array.from({ length: scope }, (_, i) => addDays(day, i)).filter((d) => d >= kit.today), [scope, day, kit.today]);
  // each day built on the one before, the way the planner's autofill does
  const plan = useMemo(() => {
    if (!open) return [];
    let prev = kit.lineupOf(teamId, days[0] ?? day).slots;
    return days.map((d, i) => {
      const cur = i === 0 ? prev : kit.lineupOf(teamId, d).slots;
      const next = best(teamId, d, i === 0 ? cur : prev);
      prev = next;
      const pts = (m: Map<number, string>) => kit.rosterOf(teamId).reduce((t, x) => t + (isStart(m.get(x.p.id)) && kit.gameFor(x.p.nhl_team, d) ? kit.expPts(x.p) : 0), 0);
      return { d, cur, next, gain: pts(next) - pts(cur), moves: diffMoves(cur, next) };
    });
  }, [open, days, teamId, kit, best, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = plan.reduce((t, x) => t + x.gain, 0);
  const changes = plan.filter((x) => x.moves.length);
  const apply = async () => {
    setBusy(true);
    try {
      if (plan.length === 1) {
        const x = plan[0];
        await save(x.d, x.next, x.cur, `Best lineup set for ${x.d === kit.today ? 'today' : monthDay(x.d)}`);
      } else {
        const today = plan.find((x) => x.d === kit.today && x.moves.length);
        if (today) await rpc('set_lineup', { p_slots: Object.fromEntries(today.moves.map((m) => [m.id, m.to])) });
        const later = plan.filter((x) => x.d > kit.today);
        if (later.length) await rpc('set_lineup_plans', { p_plans: Object.fromEntries(later.map((x) => [x.d, Object.fromEntries(x.next)])) });
        await Promise.all([refresh(['rosters', 'teams']), kit.loadPlans([teamId])]);
      }
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="The best lineup">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-black/25 p-1">
          {[[1, day === kit.today ? 'Today' : 'This day'], [3, '3 days'], [7, '7 days'], [14, '14 days']].map(([n, l]) => (
            <button key={n} type="button" onClick={() => setScope(n as number)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${scope === n ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{l}</button>
          ))}
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-400/15 to-transparent p-4 ring-1 ring-emerald-400/25">
          <div className="text-[11px] font-bold uppercase tracking-[.16em] text-emerald-200">Projected gain</div>
          <div className="num font-display text-3xl font-extrabold text-white">+{fmt1(total)} <span className="text-base text-white/60">pts</span></div>
          <div className="text-xs text-white/60">{changes.length ? `${changes.reduce((t, x) => t + x.moves.length, 0)} moves over ${changes.length} ${changes.length === 1 ? 'day' : 'days'}. Pins are respected; started games stay put.` : 'Already the best lineup for every day here.'}</div>
        </div>
        <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {changes.map((x) => (
            <div key={x.d}>
              <div className="mb-1.5 flex items-center justify-between text-xs"><b className="text-white">{x.d === kit.today ? 'Today' : longDay(x.d)}</b><span className="num font-bold text-emerald-300">+{fmt1(x.gain)}</span></div>
              <div className="space-y-1">
                {x.moves.map((m) => {
                  const p = kit.players.get(m.id)!;
                  return (
                    <div key={m.id} className="flex items-center gap-2.5 rounded-xl bg-white/[.04] px-2.5 py-2 ring-1 ring-white/[.06]">
                      <Headshot p={p} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-semibold text-white">{p.name}</div>
                        <div className="text-[11px] text-mute">{reason(kit, p, x.d, isStart(m.to))}</div>
                      </div>
                      <SlotPill slot={m.from} size="sm" /><ArrowRightLeft className="h-3 w-3 text-mute" /><SlotPill slot={m.to} size="sm" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-gold w-full py-3" disabled={busy || !changes.length} onClick={apply}>{busy ? 'Setting…' : changes.length ? `Make ${changes.reduce((t, x) => t + x.moves.length, 0)} moves` : 'Nothing to change'}</button>
      </div>
    </Sheet>
  );
}

export function DayView({ kit, teamId, day, readOnly, onInfo, onLeague }: { kit: Kit; teamId: number; day: string; readOnly: boolean; onInfo: (id: number) => void; onLeague?: () => void }) {
  const { gameStatus, me } = useLeague();
  const { save, busy } = useSave();
  const [sel, setSel] = useState<Sel>(null);
  const [opt, setOpt] = useState(false);
  // tonight's points so far (refreshed every minute while a game is on) and each player's line
  const { pts: live } = useDayPoints(kit, day);
  const lines = useLines(kit, [teamId], day);
  const roster = kit.rosterOf(teamId);
  const { slots: saved, source } = kit.lineupOf(teamId, day);
  // what if: moves stay on this phone until saved, with the difference they make shown as they are tried
  const [trial, setTrial] = useState<Map<number, string> | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const slots = trial ?? saved;
  const stats = kit.dayStats(teamId, day, slots);
  const savedStats = kit.dayStats(teamId, day, saved);
  const editable = !readOnly && day >= kit.today && me?.role !== 'spectator';
  useEffect(() => { setSel(null); setTrial(null); }, [day, teamId]);
  const trialMoves = trial ? diffMoves(saved, trial) : [];
  // where this lineup stands tonight against every other team's, on expected points
  const rank = useMemo(() => {
    const all = kit.teams.filter((t) => t.role !== 'spectator').map((t) => ({ id: t.id, pts: t.id === teamId ? stats.pts : kit.dayStats(t.id, day).pts }));
    all.sort((a, b) => b.pts - a.pts);
    return { at: all.findIndex((x) => x.id === teamId) + 1, of: all.length };
  }, [kit, teamId, day, stats.pts]);
  const livePts = roster.reduce((t, x) => t + (isStart(slots.get(x.p.id)) ? live.get(x.p.id) ?? 0 : 0), 0);

  const locked = (p: Player) => kit.lockedOn(p, day);
  const selP = sel?.kind === 'player' ? kit.players.get(sel.id) : undefined;
  const selSlot = sel?.kind === 'player' ? slots.get(sel.id) ?? 'BN' : sel?.kind === 'empty' ? sel.slot : null;
  // can this row take the selection?
  const target = (p: Player | null, slot: string) => {
    if (!sel || slot === 'IR') return false;
    if (sel.kind === 'empty') return !!p && !locked(p) && slots.get(p.id) !== 'IR' && slots.get(p.id) !== sel.slot && kit.canPlay(p, sel.slot);
    if (!selP || (p && p.id === selP.id)) return false;
    if (!p) return kit.canPlay(selP, slot);
    if (locked(p) || slots.get(p.id) === 'IR') return false;
    return kit.canPlay(selP, slot) && kit.canPlay(p, selSlot!);
  };
  const tap = async (p: Player | null, slot: string) => {
    if (!editable || busy) return;
    if (!sel) {
      if (p && !locked(p) && slot !== 'IR') setSel({ kind: 'player', id: p.id });
      else if (!p) setSel({ kind: 'empty', slot });
      return;
    }
    if (p && sel.kind === 'player' && p.id === sel.id) { setSel(null); return; }
    if (!target(p, slot)) { if (p && !locked(p) && slot !== 'IR') setSel({ kind: 'player', id: p.id }); else setSel(null); return; }
    const next = new Map(slots);
    let label = '';
    if (sel.kind === 'empty' && p) { next.set(p.id, sel.slot); label = `${p.last_name ?? p.name} to ${sel.slot}`; }
    else if (selP && !p) { next.set(selP.id, slot); label = `${selP.last_name ?? selP.name} to ${slot === 'BN' ? 'the bench' : slot}`; }
    else if (selP && p) { next.set(selP.id, slot); next.set(p.id, selSlot!); label = `${selP.last_name ?? selP.name} ⇄ ${p.last_name ?? p.name}`; }
    setSel(null);
    if (trial) { setTrial(next); return; }
    await save(day, next, slots, label);
  };

  // what needs fixing, each with its fix
  const benchedPlaying = roster.filter((x) => slots.get(x.p.id) === 'BN' && kit.gameFor(x.p.nhl_team, day) && !hurt(x.p) && !locked(x.p));
  const idleStarters = roster.filter((x) => isStart(slots.get(x.p.id)) && !kit.gameFor(x.p.nhl_team, day));
  const hurtStarters = roster.filter((x) => isStart(slots.get(x.p.id)) && hurt(x.p));
  const backupG = roster.filter((x) => slots.get(x.p.id) === 'G' && ['backup', 'out', 'scratched'].includes(gameStatus(x.p.id, day)?.status ?? ''));
  const warnings = editable ? [
    ...(stats.empty > 0 ? [`${stats.empty} empty starting ${stats.empty === 1 ? 'slot' : 'slots'}`] : []),
    ...(benchedPlaying.length && idleStarters.length ? [`${benchedPlaying.length} on the bench with a game while ${idleStarters.length} ${idleStarters.length === 1 ? 'starter sits' : 'starters sit'} idle`] : []),
    ...hurtStarters.map((x) => `${x.p.name} is ${x.p.injury_status}`),
    ...backupG.map((x) => `${x.p.name} isn't starting in goal`),
  ] : [];

  // rows by slot, with the empty slots shown as places to fill
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const x of roster) { const s = slots.get(x.p.id) ?? 'BN'; by.set(s, [...(by.get(s) ?? []), x]); }
    for (const v of by.values()) v.sort((a, b) => kit.expPts(b.p) - kit.expPts(a.p));
    return [...START, 'BN', 'IR'].map((s) => ({ slot: s, rows: by.get(s) ?? [], empty: (START as readonly string[]).includes(s) ? Math.max(0, (kit.caps[s] ?? 0) - (by.get(s)?.length ?? 0)) : 0 }))
      .filter((g) => g.rows.length || g.empty || (g.slot === 'BN' && sel?.kind === 'player' && isStart(selSlot ?? undefined)));
  }, [roster, slots, kit, sel, selSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  const Row = ({ x, slot }: { x: Row; slot: string }) => {
    const p = x.p, g = kit.gameFor(p.nhl_team, day), lk = locked(p);
    const isSel = sel?.kind === 'player' && sel.id === p.id;
    const can = target(p, slot);
    const dim = !!sel && !isSel && !can;
    const pts = live.has(p.id) && lk ? live.get(p.id)! : null;
    const moved = !!trial && saved.get(p.id) !== slot;
    return (
      <button type="button" onClick={() => tap(p, slot)}
        className={`group flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition ${isSel ? 'bg-gold/15 ring-2 ring-gold' : can ? 'bg-emerald-400/[.08] ring-2 ring-emerald-400/60' : 'ring-1 ring-white/[.06] hover:bg-white/[.04]'} ${dim ? 'opacity-40' : ''} ${!isStart(slot) && !isSel && !can ? 'bg-black/10' : ''} ${moved && !isSel && !can ? '!bg-violet-500/10 !ring-violet-300/40' : ''}`}>
        <SlotPill slot={slot} />
        <span role="button" tabIndex={-1} aria-label={`${p.name}'s card`} onClick={(e) => { e.stopPropagation(); onInfo(p.id); }} className="shrink-0 rounded-full transition hover:ring-2 hover:ring-white/30"><Headshot p={p} size={36} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="break-words font-semibold leading-tight text-white">{p.name}</span>
            {x.r.pin === 'start' && <span title="Pinned to start">📌</span>}{x.r.pin === 'bench' && <span title="Pinned to the bench">🚫</span>}
            {/^[LD]/.test(lines.get(p.id) ?? '') && <span className={`rounded-md px-1.5 py-px text-[9px] font-black ${lines.get(p.id)!.startsWith('L1') || lines.get(p.id) === 'D1' ? 'bg-gold/20 text-gold' : 'bg-white/[.08] text-slate-300'}`} title={lines.get(p.id)!.startsWith('L') ? `Forward line ${lines.get(p.id)!.slice(1)}, from the shift charts` : `Defence pair ${lines.get(p.id)!.slice(1)}, from the shift charts`}>{lines.get(p.id)}</span>}
            {kit.light(day) && g && isStart(slot) && <span className="rounded-full bg-sky-400/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-sky-200" title="A light night: five games or fewer">Light</span>}
            <GameStatusChip id={p.id} date={day} onClick={() => onInfo(p.id)} /><NewsDot id={p.id} onClick={() => onInfo(p.id)} />
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-semibold text-mute">{p.elig.join('/')} · {p.nhl_team}</span>
            <GameLine p={p} g={g} />
            {p.injury_status && <span className="text-[10px] font-semibold text-red-300">{p.injury_status}{injuryBack(p.injury_return) ? `, ${injuryBack(p.injury_return)}` : ''}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          {pts != null ? <span className="num text-base font-black text-gold">{fmt1(pts)}</span>
            : <span className={`num text-base font-black ${g && !hurt(p) ? 'text-white' : 'text-white/25'}`}>{g ? fmt1(kit.expPts(p)) : '–'}</span>}
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-mute">{lk && day === kit.today ? <><Lock className="h-2.5 w-2.5" /> {pts != null ? 'pts' : 'locked'}</> : 'exp'}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="card-hero p-4">
        <div className="relative flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[.18em] text-gold">{day === kit.today ? 'Tonight' : day < kit.today ? 'Played' : weekdayLong(day)}</div>
            <div className="h-display text-2xl leading-tight text-white">{longDay(day)}</div>
            <div className="mt-1 text-xs text-white/60">{source === 'own' ? 'Set for this day' : source === 'carried' ? 'Carried forward from an earlier day' : source === 'today' ? 'Today’s lineup, carried forward' : day === kit.today ? 'The live lineup' : ''} · {kit.nightSize(day)} NHL games{kit.light(day) ? ' · a light night' : ''}</div>
          </div>
          <div className="text-right">
            <div className="num font-display text-4xl font-extrabold leading-none text-white">{fmt1(day === kit.today && livePts > 0 ? livePts : stats.pts)}</div>
            <div className="text-[11px] text-white/60">{day === kit.today && livePts > 0 ? `pts so far · ${fmt1(stats.pts)} expected` : 'expected pts'}</div>
          </div>
        </div>
        <div className="relative mt-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-white/70">
            <span>{stats.playing} of {stats.slotsTotal} starters play{stats.benched > 0 && <span className="text-amber-200"> · {stats.benched} benched with a game</span>}</span>
            {rank.of > 1 && <button type="button" onClick={onLeague} className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 font-bold text-white ring-1 ring-white/15"><Trophy className="h-3 w-3 text-gold" /> {ordinal(rank.at)} of {rank.of} {day === kit.today ? 'tonight' : 'that day'}</button>}
          </div>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {Array.from({ length: stats.slotsTotal }, (_, i) => <span key={i} className={`flex-1 ${i < stats.playing ? 'bg-emerald-400' : i < stats.filled ? 'bg-white/25' : 'bg-red-400/60'}`} />)}
          </div>
        </div>
        {editable && !trial && (
          <div className="relative mt-3 flex gap-2">
            <button type="button" className="btn-gold inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3" onClick={() => setOpt(true)}><Sparkles className="h-4 w-4 shrink-0" /> Best lineup</button>
            <button type="button" className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap px-3" onClick={() => { setTrial(new Map(saved)); setSel(null); }} title="Try moves without saving them"><FlaskConical className="h-4 w-4" /> What if</button>
            <button type="button" aria-label="Copy this lineup ahead" title="Copy this lineup to the days ahead" className={`btn-ghost inline-flex items-center ${copying ? 'ring-1 ring-gold/60' : ''}`} onClick={() => setCopying(!copying)}><Copy className="h-4 w-4" /></button>
            {sel && <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={() => setSel(null)}><X className="h-4 w-4" /></button>}
          </div>
        )}
        {editable && !trial && copying && (
          <div className="relative mt-2 rounded-2xl bg-black/25 p-3 ring-1 ring-white/10">
            <div className="text-xs text-white/80">Use this lineup for the days after {day === kit.today ? 'today' : monthDay(day)}. It replaces any lineup saved for them; IR stays as it is.</div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[1, 3, 7, 14].map((n) => (
                <button key={n} type="button" disabled={copyBusy} className="rounded-xl bg-white/[.06] py-2 text-xs font-bold text-white ring-1 ring-white/10 hover:bg-white/10"
                  onClick={async () => {
                    setCopyBusy(true);
                    try {
                      const plan = Object.fromEntries(saved);
                      await rpc('set_lineup_plans', { p_plans: Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(day, i + 1), plan])) });
                      await kit.loadPlans([teamId]);
                      setCopying(false);
                    } finally { setCopyBusy(false); }
                  }}>{n === 1 ? 'Next day' : `Next ${n}`}</button>
              ))}
            </div>
          </div>
        )}
        {editable && trial && (
          <div className="fixed inset-x-0 bottom-[84px] z-40 px-4 md:bottom-6"><div className="mx-auto max-w-md rounded-2xl bg-[#1c1433]/95 p-3 shadow-[0_12px_32px_rgba(0,0,0,.55)] ring-1 ring-violet-300/40 backdrop-blur">
            <div className="flex items-center gap-2 text-sm text-violet-100">
              <FlaskConical className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{trialMoves.length ? <>Trying {trialMoves.length} {trialMoves.length === 1 ? 'move' : 'moves'}: <b className={stats.pts - savedStats.pts >= 0 ? 'text-emerald-300' : 'text-red-300'}>{stats.pts - savedStats.pts >= 0 ? '+' : ''}{fmt1(stats.pts - savedStats.pts)}</b> expected</> : 'What if: move anyone, nothing saves until you say.'}</span>
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-gold flex-1" disabled={busy || !trialMoves.length} onClick={async () => { if (await save(day, trial, saved, `${trialMoves.length} ${trialMoves.length === 1 ? 'move' : 'moves'} saved`)) setTrial(null); }}>Save {trialMoves.length || ''}</button>
              <button type="button" className="btn-ghost" onClick={() => { setTrial(null); setSel(null); }}>Discard</button>
            </div>
          </div></div>
        )}
      </div>

      {warnings.length > 0 && (
        <button type="button" onClick={() => setOpt(true)} className="flex w-full items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[.07] p-3 text-left">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 space-y-0.5 text-sm text-amber-100">{warnings.map((w) => <span key={w} className="block">{w}</span>)}</span>
          <span className="shrink-0 rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-[#0b1220]">Fix</span>
        </button>
      )}

      {editable && (
        <p className="px-1 text-xs text-mute">{sel ? (sel.kind === 'empty' ? `Tap who goes to ${sel.slot}.` : 'Tap where he goes: the green places fit. Tap him again to let go.') : 'Tap a player, then tap where he goes. Tap his photo for his card. Players whose game has started are locked.'}</p>
      )}

      {groups.map((gr) => (
        <div key={gr.slot}>
          <div className="mb-1 flex items-center gap-2 px-1"><span className="text-[10px] font-black uppercase tracking-[.2em] text-mute">{{ C: 'Centres', LW: 'Left wings', RW: 'Right wings', D: 'Defence', Util: 'Utility', G: 'Goalies', BN: 'Bench', IR: 'Injured reserve' }[gr.slot]}</span><span className="h-px flex-1 bg-white/[.06]" /></div>
          <div className="space-y-1.5">
            {gr.rows.map((x) => <Row key={x.p.id} x={x} slot={gr.slot} />)}
            {Array.from({ length: gr.empty }, (_, i) => {
              const can = target(null, gr.slot), isSel = sel?.kind === 'empty' && sel.slot === gr.slot;
              return (
                <button key={`e${i}`} type="button" onClick={() => tap(null, gr.slot)} disabled={!editable}
                  className={`flex w-full items-center gap-2.5 rounded-2xl border border-dashed px-2.5 py-3 text-left text-sm transition ${isSel ? 'border-gold bg-gold/10' : can ? 'border-emerald-400/70 bg-emerald-400/[.08]' : 'border-red-400/30 text-red-200/80'}`}>
                  <SlotPill slot={gr.slot} /> <span>Empty {gr.slot} slot{editable ? ': tap to fill' : ''}</span>
                </button>
              );
            })}
            {gr.slot === 'BN' && sel?.kind === 'player' && isStart(selSlot ?? undefined) && (
              <button type="button" onClick={() => tap(null, 'BN')} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-400/70 bg-emerald-400/[.06] px-3 py-2.5 text-sm font-semibold text-emerald-200">Move him to the bench</button>
            )}
          </div>
        </div>
      ))}
      {editable && <OptimizeSheet kit={kit} teamId={teamId} day={day} open={opt} onClose={() => setOpt(false)} />}
    </div>
  );
}

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };
const weekdayLong = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' });
