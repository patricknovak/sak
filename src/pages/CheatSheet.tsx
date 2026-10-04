// The draft cheat sheet: one screen per GM with the holes on their roster, the best players still on the
// board at each of those positions, and the odds each one lasts until their next picks. Built from the
// same simulation the mock draft uses, and it keeps up with the live draft as picks land.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, RefreshCw, Star } from 'lucide-react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { projectedKeepers } from '../lib/grades';
import { useCategoryValues, useDraftValue, useSimValue } from '../components/PlayerFilters';
import { availabilityOdds, needsOf, type Outlook, type SimPick, type StartSlot } from '../lib/draftsim';
import { PlayerSheet } from '../components/PlayerCard';
import { NeedsStrip } from '../components/RosterNeeds';
import { Headshot, PageHeader, Pos, Section, useToast } from '../components/ui';

const SLOT_LABEL: Record<StartSlot, string> = { C: 'Centres', LW: 'Left wings', RW: 'Right wings', D: 'Defence', Util: 'Utility (any skater)', G: 'Goalies' };
const oddsClass = (v: number) => (v >= 70 ? 'bg-emerald-500/20 text-emerald-200' : v >= 35 ? 'bg-amber-400/20 text-amber-100' : 'bg-red-500/20 text-red-200');

export default function CheatSheet({ embedded = false }: { embedded?: boolean } = {}) {
  const { me, league, teams, players, rosters, picks, draft } = useLeague();
  const toast = useToast();
  const caps = league?.roster as Record<string, number> | undefined;
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [simming, setSimming] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const [queue, setQueue] = useState<Set<number>>(new Set());

  // the draft as it stands: order, traded picks, and every pick already made
  const board = useMemo<SimPick[]>(() => picks.filter((p) => p.season === draft?.season && p.overall).sort((a, b) => a.overall! - b.overall!)
    .map((p) => ({ overall: p.overall!, round: p.round, team: p.team_id, original: p.original_team, pid: p.player_id })), [picks, draft?.season]);
  const made = board.filter((b) => b.pid).length;
  const keepers = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const t of teams) {
      const rows = rosters.filter((r) => r.team_id === t.id);
      const kept = rows.some((r) => r.acquired === 'keeper') ? new Set(rows.filter((r) => r.acquired === 'keeper').map((r) => r.player_id))
        : projectedKeepers(rows, league?.keepers ?? 6, !!league?.top_scorer_rule);
      m.set(t.id, [...kept]);
    }
    return m;
  }, [teams, rosters, league?.keepers, league?.top_scorer_rule]);
  const gone = useMemo(() => new Set([...[...keepers.values()].flat(), ...board.filter((b) => b.pid).map((b) => b.pid!)]), [keepers, board]);
  const dv = useDraftValue();
  const simValue = useSimValue();
  const cv = useCategoryValues();
  const catOn = !!cv && cv.size > 0;   // a category league ranks and shows category value (migration 129)
  const pool = useMemo(() => [...players.values()].filter((p) => !gone.has(p.id)).sort((a, b) => dv(b) - dv(a)), [players, gone, dv]);
  const poolRank = useMemo(() => new Map(pool.map((p, i) => [p.id, i + 1])), [pool]);
  const mine = useMemo(() => [...(keepers.get(me?.id ?? -1) ?? []), ...board.filter((b) => b.team === me?.id && b.pid).map((b) => b.pid!)].map((id) => players.get(id)).filter(Boolean) as Player[], [keepers, board, me?.id, players]);
  const needs = useMemo(() => needsOf(mine, caps), [mine, caps]);
  const myPicks = board.filter((b) => b.team === me?.id && !b.pid).map((b) => b.overall);
  // one list per position that still needs bodies: starting gaps first, then depth under its balanced target
  const listSlots = (['C', 'LW', 'RW', 'D', 'G'] as StartSlot[]).map((s) => ({ s, start: needs.open[s], depth: Math.max(0, needs.depth[s].target - needs.depth[s].have - needs.open[s]) }))
    .filter((x) => x.start > 0 || x.depth > 0).sort((a, b) => b.start - a.start || b.depth - a.depth);

  const runOdds = () => {
    if (!me || !board.length) return;
    setSimming(true);
    setTimeout(() => { setOutlook(availabilityOdds(board, keepers, pool, players, me.id, league?.draft_rounds ?? 18, 25, caps, simValue)); setSimming(false); }, 30);
  };
  useEffect(() => { runOdds(); }, [made, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from('draft_queue').select('player_id').then(({ data }) => setQueue(new Set((data ?? []).map((r) => r.player_id))));
  }, [made]);
  const star = async (p: Player) => {
    if (!me || queue.has(p.id)) return;
    const { error } = await supabase.from('draft_queue').insert({ team_id: me.id, player_id: p.id, pos: queue.size });
    if (error) { toast(error.message, 'err'); return; }
    setQueue(new Set([...queue, p.id]));
    toast(`${p.name} added to your queue ⭐`);
  };

  const listFor = (slot: StartSlot) => pool.filter((p) => (slot === 'G' ? p.pos === 'G' : p.pos !== 'G' && (slot === 'Util' || p.elig.includes(slot)))).slice(0, 10);
  const oddsFor = (p: Player) => outlook?.odds.get(p.id) ?? null;
  const hurt = (p: Player) => /^(out|ir|injured|suspen|long)/i.test(p.injury_status ?? '');

  if (!me || me.role === 'spectator') return <div className="card p-5 text-sm text-mute">The cheat sheet is built for a GM’s roster. Spectators can watch the <Link to="/draft" className="text-sky-300">draft board</Link>.</div>;
  if (!board.length) return <div className="card p-5 text-sm text-mute">The draft order isn’t set yet, so there’s nothing to plan around. Check back once the commish posts it.</div>;

  const Odds = ({ p }: { p: Player }) => {
    const o = oddsFor(p);
    return o ? <>{o.slice(0, 3).map((v, k) => <span key={k} className={`num rounded-md px-1.5 py-0.5 text-[11px] font-bold ${oddsClass(v)}`} title={`${v}% chance he's there at pick #${outlook!.picks[k]}`}>{v}%</span>)}</>
      : <span className="text-[11px] text-mute">{simming ? 'simulating…' : '–'}</span>;
  };
  const Row = ({ p, i }: { p: Player; i: number }) => (
    <div className={`flex items-center gap-2 py-1.5 ${queue.has(p.id) ? 'bg-gold/[.06]' : ''}`}>
      <span className="num w-4 text-center text-[11px] text-mute">{i + 1}</span>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setDetail(p.id)}>
        <Headshot p={p} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.name}{hurt(p) && <span className="ml-1 chip bg-red-500/15 text-[10px] text-red-200">{p.injury_status}</span>}</span>
          <span className="block truncate text-[11px] text-mute"><Pos p={p.pos} className="mr-1 inline-flex" />{p.nhl_team} · #{poolRank.get(p.id)} on the board</span>
          <span className="mt-0.5 flex gap-1 sm:hidden"><Odds p={p} /></span>
        </span>
      </button>
      <span className="num w-9 text-right text-sm font-bold">{catOn ? (cv!.get(p.id) != null ? `${cv!.get(p.id)! > 0 ? '+' : ''}${cv!.get(p.id)!.toFixed(1)}` : '–') : Math.round(p.proj)}</span>
      <div className="hidden w-40 shrink-0 justify-end gap-1 sm:flex"><Odds p={p} /></div>
      <button className={`shrink-0 rounded-lg p-1.5 ${queue.has(p.id) ? 'text-gold' : 'text-white/30 hover:text-gold'}`} onClick={() => star(p)} title={queue.has(p.id) ? 'On your queue' : 'Add to my queue'}><Star size={16} fill={queue.has(p.id) ? 'currentColor' : 'none'} /></button>
    </div>
  );

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader icon={<ClipboardList size={22} className="text-gold" />} title="Draft cheat sheet" sub={draft?.status === 'live' ? `Live: pick #${draft.current_overall} on the clock` : `Your picks: ${myPicks.slice(0, 6).map((n) => '#' + n).join(', ')}${myPicks.length > 6 ? '…' : ''}`}
        right={<button className="btn btn-sm" disabled={simming} onClick={runOdds}><RefreshCw size={14} className={simming ? 'animate-spin' : ''} /> {simming ? 'Simulating' : 'Refresh odds'}</button>} />}

      <div className="card p-3">
        <div className="label mb-1.5">Your roster right now</div>
        <NeedsStrip players={mine} caps={caps} />
        <div className="mt-2 text-xs text-mute">
          {needs.gaps.length ? <>Starters still to fill: <b className="text-white">{needs.gaps.join(', ')}</b>.</> : <>Every starting slot is filled.</>}
          {needs.depthGaps.length ? <> Depth to reach a balanced 24: <b className="text-sky-200">{needs.depthGaps.join(', ')}</b>, then {needs.flexOpen} flex.</> : <> <span className="text-emerald-300">Balanced across every position.</span>{needs.flexOpen ? ` ${needs.flexOpen} flex spots left.` : ''}</>}
          {outlook && outlook.picks.length > 0 && <> The three percentages are the odds a player is still there at your next picks: <b className="text-white">{outlook.picks.slice(0, 3).map((n) => '#' + n).join(', ')}</b>, from 25 simulated drafts.</>}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      {listSlots.map(({ s: slot, start, depth }) => (
        <Section key={slot} title={`${SLOT_LABEL[slot]} · need ${start + depth}`} right={<span className="text-xs text-mute">{start ? `${start} starter${start > 1 ? 's' : ''}` : ''}{start && depth ? ' + ' : ''}{depth ? `${depth} depth` : ''} · best 10</span>}>
          <div className="card divide-y divide-white/[.06] px-2">{listFor(slot).map((p, i) => <Row key={p.id} p={p} i={i} />)}</div>
        </Section>
      ))}

      <Section title="Best available, any position" right={<span className="text-xs text-mute">{catOn ? 'by category value' : 'by projection'}</span>}>
        <div className="card divide-y divide-white/[.06] px-2">{pool.slice(0, 12).map((p, i) => <Row key={p.id} p={p} i={i} />)}</div>
      </Section>
      </div>

      <p className="px-1 text-xs text-mute">Tap ⭐ to add anyone to your draft queue; autodraft takes the top of your queue if you’re away. Green means he’ll almost surely be there, amber is a coin flip, red means take him now or forget him. Practise in the <Link to="/draft?t=mock" className="text-sky-300">mock draft</Link>.</p>
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
