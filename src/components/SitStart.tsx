// Sit or start (the Lineup page): with every starting slot filled and players on the bench, which ones should play
// tonight. Two parts: the swaps worth making (a benched player with a game who is expected to outscore a starter he
// can replace, with the reasons and a one-tap swap), and a head-to-head comparison of any two of the team's players,
// tonight and over the week, on the numbers a GM decides with. Expected points are Lineup New's: projected points per
// game times the chance he plays (src/lib/lineupKit.ts).
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Scale } from 'lucide-react';
import { useLeague } from '../lib/store';
import { fmtPts } from '../lib/format';
import { hurt, isStart, type Kit, type Row } from '../lib/lineupKit';
import { GameLine, SlotPill, fmt1 } from './lineupnew/bits';
import { PlayerTag } from './PlayerCard';
import type { Slot } from '../lib/types';

export interface Swap { start: Row; sit: Row | null; slot: Slot; gain: number; why: string[] }

const STATUS: Record<string, string> = { backup: 'backup goalie tonight', out: 'out tonight', scratched: 'scratched tonight', gtd: 'a game-time call' };

// fantasy points a game over a window, or null without a sample
function perGameIn(w: { gp: number; fpts: number } | undefined) { return w && w.gp > 0 ? w.fpts / w.gp : null; }

export function useSitStart(kit: Kit, roster: Row[], locked: (r: Row) => boolean, slotOk: (r: Row, s: Slot) => boolean, empty: Slot[] = []) {
  const { gameStatus, windows } = useLeague();
  const d = kit.today;
  return useMemo(() => {
    const exp = (x: Row) => (kit.gameFor(x.p.nhl_team, d) && !['out', 'scratched'].includes(gameStatus(x.p.id)?.status ?? '') ? kit.expPts(x.p) : 0);
    const starters = roster.filter((x) => isStart(x.r.slot) && !locked(x));
    const bench = roster.filter((x) => x.r.slot === 'BN' && !locked(x) && !hurt(x.p) && kit.gameFor(x.p.nhl_team, d));
    // every pairing worth a look, the biggest gains first, each player used once
    const pairs: Swap[] = [];
    for (const b of bench) for (const s of starters) {
      if (!slotOk(b, s.r.slot as Slot)) continue;
      const gain = exp(b) - exp(s);
      if (gain < 0.3) continue;
      const why: string[] = [];
      const sg = kit.gameFor(s.p.nhl_team, d);
      const st = gameStatus(s.p.id)?.status;
      if (!sg) why.push(`${s.p.last_name ?? s.p.name} has no game tonight`);
      else if (st && STATUS[st]) why.push(`${s.p.last_name ?? s.p.name} is ${STATUS[st]}`);
      const bf = perGameIn(windows.get(b.p.id)?.['14']), sf = perGameIn(windows.get(s.p.id)?.['14']);
      if (bf != null && sf != null && bf > sf) why.push(`${fmt1(bf)} FP a game over 14 days against ${fmt1(sf)}`);
      if (sg && kit.chance(b.p) > kit.chance(s.p) + 0.1) why.push(`more likely to dress (${Math.round(kit.chance(b.p) * 100)}% against ${Math.round(kit.chance(s.p) * 100)}%)`);
      if (!why.length) why.push(`${fmt1(kit.perGame(b.p))} projected a game against ${fmt1(kit.perGame(s.p))}`);
      pairs.push({ start: b, sit: s, slot: s.r.slot as Slot, gain, why });
    }
    // an empty starting slot: any benched player with a game who fits it
    for (const b of bench) for (const slot of new Set(empty)) {
      if (!slotOk(b, slot) || exp(b) < 0.3) continue;
      pairs.push({ start: b, sit: null, slot, gain: exp(b), why: [`the ${slot} slot is empty tonight`] });
    }
    pairs.sort((a, b) => b.gain - a.gain);
    const used = new Set<number>();
    const picks: Swap[] = [];
    const filled = new Map<string, number>();
    for (const x of pairs) {
      if (used.has(x.start.p.id) || (x.sit && used.has(x.sit.p.id))) continue;
      if (!x.sit && (filled.get(x.slot) ?? 0) >= empty.filter((e) => e === x.slot).length) continue;
      used.add(x.start.p.id); if (x.sit) used.add(x.sit.p.id); else filled.set(x.slot, (filled.get(x.slot) ?? 0) + 1);
      picks.push(x);
    }
    return { swaps: picks, exp };
  }, [kit, roster, locked, slotOk, gameStatus, windows, d, empty.join()]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function SitStart({ kit, roster, swaps, exp, weekGames, mine, busy, onSwap, onInfo }: {
  kit: Kit; roster: Row[]; swaps: Swap[]; exp: (x: Row) => number; weekGames: (nhl: string | null) => number; mine: boolean; busy: boolean;
  onSwap: (s: Swap) => void; onInfo: (id: number) => void;
}) {
  // open on the first swap worth making, else the best benched player with a game against the weakest starter (worked
  // out each time, so it settles once tonight's games have loaded); a pick of the GM's own replaces it
  const [picked, setPair] = useState<[number | null, number | null]>([null, null]);
  const def = (() => {
    if (swaps[0]?.sit) return [swaps[0].start.p.id, swaps[0].sit.p.id];
    const open = (x: Row) => !kit.lockedOn(x.p, kit.today);
    const bench = roster.filter((x) => x.r.slot === 'BN' && kit.gameFor(x.p.nhl_team, kit.today)).sort((a, b) => Number(open(b)) - Number(open(a)) || exp(b) - exp(a))[0];
    const weak = roster.filter((x) => isStart(x.r.slot)).sort((a, b) => Number(open(b)) - Number(open(a)) || exp(a) - exp(b))[0];
    return [bench?.p.id ?? null, weak?.p.id ?? null];
  })();
  const pair: [number | null, number | null] = [picked[0] ?? def[0], picked[1] ?? def[1]];
  const choices = roster.filter((x) => x.r.slot !== 'IR').sort((a, b) => a.p.name.localeCompare(b.p.name));
  const a = roster.find((x) => x.p.id === pair[0]);
  const b = roster.find((x) => x.p.id === pair[1]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold"><ArrowLeftRight className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">Sit or start</div>
          <div className="text-[11px] text-mute">{swaps.length ? `${swaps.length} swap${swaps.length > 1 ? 's' : ''} worth making tonight` : 'Your lineup already starts the best of who plays tonight'}</div>
        </div>
      </div>
      {swaps.length > 0 && (
        <div className="divide-y divide-white/[.05]">
          {swaps.map((s) => (
            <div key={s.start.p.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-200">Start</span>
                <PlayerTag p={s.start.p} className="font-semibold text-white" />
                {s.sit ? <>
                  <span className="text-mute">for</span>
                  <span className="rounded-md bg-white/[.07] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-300">Sit</span>
                  <PlayerTag p={s.sit.p} className="font-semibold text-slate-200" />
                </> : <span className="text-mute">in the empty <SlotPill slot={s.slot} size="sm" /> slot</span>}
                <span className="num ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-xs font-bold text-gold">+{fmt1(s.gain)} exp</span>
              </div>
              <ul className="space-y-0.5 text-[11px] text-slate-300">{s.why.map((w, i) => <li key={i}>• {w}</li>)}</ul>
              <div className="flex flex-wrap gap-2">
                {mine && <button className="btn-gold px-3 py-1.5 text-xs" disabled={busy} onClick={() => onSwap(s)}>{s.sit ? 'Swap them' : 'Start him'}</button>}
                {s.sit && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setPair([s.start.p.id, s.sit!.p.id])}><Scale className="mr-1 inline h-3.5 w-3.5" />Compare</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* head to head: any two of the team's players */}
      <div className="border-t border-white/[.06] bg-black/10 px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute"><Scale className="h-3.5 w-3.5" /> Compare two players</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {[0, 1].map((i) => (
            <select key={i} aria-label={i === 0 ? 'First player' : 'Second player'} value={pair[i] ?? ''} style={{ order: i === 0 ? 0 : 2 }}
              onChange={(e) => setPair((p) => (i === 0 ? [Number(e.target.value) || null, p[1] ?? pair[1]] : [p[0] ?? pair[0], Number(e.target.value) || null]))}
              className="input min-w-0 py-1.5 text-sm">
              <option value="">Pick a player</option>
              {choices.map((x) => <option key={x.p.id} value={x.p.id}>{x.p.name} · {x.r.slot}</option>)}
            </select>
          ))}
          <span className="order-1 text-xs font-bold text-mute">vs</span>
        </div>
        {a && b && a.p.id !== b.p.id ? <HeadToHead kit={kit} a={a} b={b} exp={exp} weekGames={weekGames} onInfo={onInfo} /> : <p className="mt-2 text-[11px] text-mute">Pick two of your players to see who should play.</p>}
      </div>
    </div>
  );
}

function HeadToHead({ kit, a, b, exp, weekGames, onInfo }: { kit: Kit; a: Row; b: Row; exp: (x: Row) => number; weekGames: (nhl: string | null) => number; onInfo: (id: number) => void }) {
  const { windows, season, gameStatus } = useLeague();
  const ga = kit.gameFor(a.p.nhl_team, kit.today), gb = kit.gameFor(b.p.nhl_team, kit.today);
  const ea = exp(a), eb = exp(b);
  const wa = weekGames(a.p.nhl_team) * kit.perGame(a.p) * kit.chance(a.p), wb = weekGames(b.p.nhl_team) * kit.perGame(b.p) * kit.chance(b.p);
  const fpg = (x: Row, k: string) => perGameIn(windows.get(x.p.id)?.[k]);
  const sz = (x: Row) => { const s = season.get(x.p.id); return s && s.gp ? s.fpts / s.gp : null; };
  // a row of the comparison: each side's value, the better one lit (higher is better unless said)
  const rows: { label: string; va: number | null; vb: number | null; fmt?: (n: number) => string }[] = [
    { label: 'Expected tonight', va: ea, vb: eb },
    { label: 'Expected this week', va: wa, vb: wb },
    { label: 'Games left this week', va: weekGames(a.p.nhl_team), vb: weekGames(b.p.nhl_team), fmt: (n) => String(n) },
    { label: 'Chance he plays', va: kit.chance(a.p), vb: kit.chance(b.p), fmt: (n) => `${Math.round(n * 100)}%` },
    { label: 'Projected a game', va: kit.perGame(a.p), vb: kit.perGame(b.p) },
    { label: 'FP a game, 7 days', va: fpg(a, '7'), vb: fpg(b, '7') },
    { label: 'FP a game, 14 days', va: fpg(a, '14'), vb: fpg(b, '14') },
    { label: 'FP a game, 30 days', va: fpg(a, '30'), vb: fpg(b, '30') },
    { label: 'FP a game, season', va: sz(a), vb: sz(b) },
  ];
  const tonight = !!(ga || gb);
  const [lead, margin, basis] = tonight ? [ea >= eb ? a : b, Math.abs(ea - eb), 'tonight'] : [wa >= wb ? a : b, Math.abs(wa - wb), 'this week'];
  const close = margin < 0.25;
  const status = (x: Row) => { const s = gameStatus(x.p.id)?.status; return s && STATUS[s] ? STATUS[s] : x.p.injury_status ?? null; };
  return (
    <div className="mt-3 space-y-2">
      <div className={`rounded-2xl px-3 py-2.5 text-sm ${close ? 'bg-white/[.05] text-slate-200' : 'bg-gold/10 text-white ring-1 ring-gold/30'}`}>
        {close ? <>Too close to call {basis}: {fmt1(margin)} expected points between them. Go with the hotter hand or the better matchup.</>
          : <><b className="text-gold">Start {lead.p.name}</b> {basis}: {fmt1(margin)} more expected points.</>}
      </div>
      <div className="overflow-hidden rounded-2xl ring-1 ring-white/[.07]">
        <div className="grid grid-cols-[1fr_minmax(0,1.1fr)_1fr] items-start gap-2 bg-white/[.04] px-3 py-2 text-xs">
          {[a, null, b].map((x, i) => x ? (
            <button key={i} type="button" onClick={() => onInfo(x.p.id)} className={`min-w-0 ${i === 0 ? 'text-left' : 'text-right'}`}>
              <div className={`flex items-center gap-1.5 ${i === 0 ? '' : 'flex-row-reverse'}`}><SlotPill slot={x.r.slot} size="sm" /><span className="break-words font-bold text-white">{x.p.last_name ?? x.p.name}</span></div>
              <div className={`mt-1 ${i === 0 ? '' : 'flex justify-end'}`}><GameLine p={x.p} g={i === 0 ? ga : gb} /></div>
              {status(x) && <div className="mt-0.5 text-[10px] text-amber-300">{status(x)}</div>}
            </button>
          ) : <span key={i} />)}
        </div>
        {rows.map((r) => {
          const f = r.fmt ?? ((n: number) => fmtPts(n, 1));
          const better = r.va != null && r.vb != null && r.va !== r.vb ? (r.va > r.vb ? 0 : 1) : null;
          return (
            <div key={r.label} className="grid grid-cols-[1fr_minmax(0,1.1fr)_1fr] items-center gap-2 border-t border-white/[.05] px-3 py-1.5 text-xs">
              <span className={`num text-left font-bold ${better === 0 ? 'text-gold' : 'text-slate-300'}`}>{r.va == null ? '–' : f(r.va)}</span>
              <span className="text-center text-[10px] uppercase tracking-wider text-mute">{r.label}</span>
              <span className={`num text-right font-bold ${better === 1 ? 'text-gold' : 'text-slate-300'}`}>{r.vb == null ? '–' : f(r.vb)}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] leading-snug text-mute">Expected = projected points a game × the chance he dresses (goalies: starts). A gold number is the better one.</p>
    </div>
  );
}
