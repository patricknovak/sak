import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, RotateCcw, Share2, FastForward, Flag } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { fmtPts, readable } from '../lib/format';
import { gradeColor, gradeTeams, lineupStrength, pickValues, projectedKeepers } from '../lib/grades';
import { availabilityOdds, botChoose, fitFor, needsOf, simulateDraft, type Outlook, type SimPick } from '../lib/draftsim';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { PlayerFilterBar, usePlayerFilter } from '../components/PlayerFilters';
import { NeedsStrip, RosterNeeds } from '../components/RosterNeeds';
import { Headshot, PageHeader, Pos, Section, TeamBadge, TeamName, useToast } from '../components/ui';
import { ClockRing, POS_BG, celebrate } from '../components/draftkit';

type Phase = 'setup' | 'live' | 'done';
type Tab = 'avail' | 'board' | 'team';
type Mode = 'real' | 'custom';

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default function Mock() {
  const { me, league, teams, team, players, rosters, picks, draft } = useLeague();
  const toast = useToast();
  const now = useNow(250);
  const caps = (league?.roster as Record<string, number> | undefined) ?? undefined;
  // the real draft as it stands: tomorrow's order, traded picks, and any picks already made
  const realBoard = useMemo<SimPick[]>(() => picks.filter((p) => p.season === draft?.season && p.overall).sort((a, b) => a.overall! - b.overall!)
    .map((p) => ({ overall: p.overall!, round: p.round, team: p.team_id, original: p.original_team, pid: p.player_id })), [picks, draft?.season]);
  const realReady = realBoard.length > 0 && draft?.status !== 'done';
  const [mode, setMode] = useState<Mode>('real');
  const [phase, setPhase] = useState<Phase>('setup');
  const [slot, setSlot] = useState(0); // 0 = random
  const [rounds, setRounds] = useState(12);
  const [clock, setClock] = useState(30);
  const [order, setOrder] = useState<number[]>([]);
  const [board, setBoard] = useState<SimPick[]>([]);
  const [tab, setTab] = useState<Tab>('avail');
  const pf = usePlayerFilter({ tf: 'proj' });
  const [detail, setDetail] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [flash, setFlash] = useState<SimPick | null>(null);
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [simming, setSimming] = useState(false);
  useEffect(() => { if (!realReady) setMode('custom'); }, [realReady]);

  // everyone's keepers as they stand today (saved picks, or the default the server would use)
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
  const keptIds = useMemo(() => new Set([...keepers.values()].flat()), [keepers]);
  const pool = useMemo(() => [...players.values()].filter((p) => !keptIds.has(p.id)).sort((a, b) => b.proj - a.proj), [players, keptIds]);
  const poolRank = useMemo(() => new Map(pool.map((p, i) => [p.id, i + 1])), [pool]);
  const totalRounds = mode === 'real' ? (league?.draft_rounds ?? 18) : rounds;

  const taken = useMemo(() => new Set(board.filter((b) => b.pid).map((b) => b.pid!)), [board]);
  const current = board.find((b) => !b.pid);
  const myTurn = phase === 'live' && current?.team === me?.id;
  const teamPlayers = (t: number) => [...(keepers.get(t) ?? []), ...board.filter((b) => b.team === t && b.pid).map((b) => b.pid!)]
    .map((id) => players.get(id)).filter(Boolean) as Player[];
  const myPlayers = me ? teamPlayers(me.id) : [];
  const myNeeds = useMemo(() => needsOf(myPlayers, caps), [myPlayers.length, board, caps]); // eslint-disable-line react-hooks/exhaustive-deps

  const botPick = (t: number): Player | undefined => botChoose(teamPlayers(t), pool.filter((p) => !taken.has(p.id)), current?.round ?? 1, totalRounds, Math.random, caps);

  const makePick = (p: Player) => {
    if (!current) return;
    const done: SimPick = { ...current, pid: p.id };
    setBoard((b) => b.map((x) => (x.overall === current.overall ? done : x)));
    setFlash(done); setTimeout(() => setFlash((f) => (f?.overall === done.overall ? null : f)), 1800);
    if (done.team === me?.id) celebrate([me.color, '#ffffff', '#f7c548']);
  };

  // run the bots, and my clock. A bot always picks someone (best available if its own logic finds nobody),
  // and if the pool is truly empty the mock just ends, so it can never sit on "thinking" forever.
  const botTimer = useRef<number | null>(null);
  const lastChange = useRef(Date.now());
  useEffect(() => { lastChange.current = Date.now(); }, [current?.overall]);
  const runBot = () => {
    if (!current || current.team === me?.id) return;
    const p = botPick(current.team) ?? pool.find((x) => !taken.has(x.id));
    if (p) makePick(p); else setPhase('done');
  };
  useEffect(() => {
    if (phase !== 'live') return;
    if (!current) { setPhase('done'); setDeadline(null); celebrate(['#f7c548', '#ffffff', me?.color ?? '#ef2a4f'], true); return; }
    if (current.team === me?.id) { setDeadline(clock ? Date.now() + clock * 1000 : null); return; }
    setDeadline(null);
    botTimer.current = window.setTimeout(runBot, 650);
    return () => { if (botTimer.current) clearTimeout(botTimer.current); };
  }, [phase, current?.overall, pool.length]);
  // watchdog: a phone that slept mid-pick can lose the timer above; the clock tick catches it
  useEffect(() => {
    if (phase === 'live' && current && current.team !== me?.id && Date.now() - lastChange.current > 4000) { lastChange.current = Date.now(); runBot(); }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (myTurn && deadline && now > deadline) { const p = botPick(me!.id); if (p) { toast('Clock ran out: autopicked ' + p.name, 'info'); makePick(p); } }
  }, [now > (deadline ?? Infinity)]);

  const start = () => {
    if (!me) return;
    if (mode === 'real') {
      const ord = realBoard.filter((b) => b.round === 1).map((b) => b.original);
      setOrder(ord); setBoard(realBoard.map((b) => ({ ...b }))); setTab('avail'); setPhase('live');
      return;
    }
    const others = shuffle(teams.map((t) => t.id).filter((id) => id !== me.id));
    const at = (slot || 1 + Math.floor(Math.random() * teams.length)) - 1;
    const ord = [...others.slice(0, at), me.id, ...others.slice(at)];
    const out: SimPick[] = [];
    for (let r = 1; r <= rounds; r++) (r % 2 ? ord : [...ord].reverse()).forEach((t) => out.push({ overall: out.length + 1, round: r, team: t, original: t, pid: null }));
    setOrder(ord); setBoard(out); setTab('avail'); setPhase('live');
  };
  // jump ahead: bots pick until it's me, or all the way to the end
  const simTo = (stopAt: 'human' | 'end') => {
    if (!me) return;
    if (botTimer.current) clearTimeout(botTimer.current);
    const res = simulateDraft(board, keepers, pool, players, { rounds: totalRounds, human: me.id, stopAt, caps });
    setBoard(res);
    const last = [...res].reverse().find((b) => b.pid && !board.find((x) => x.overall === b.overall)?.pid);
    if (last) { setFlash(last); setTimeout(() => setFlash((f) => (f?.overall === last.overall ? null : f)), 1800); }
  };
  const runOutlook = () => {
    if (!me) return;
    setSimming(true);
    setTimeout(() => { setOutlook(availabilityOdds(realBoard, keepers, pool, players, me.id, league?.draft_rounds ?? 18, 25, caps)); setSimming(false); }, 30);
  };
  // during a live mock: the odds each player on the list lasts until my next pick (a lighter sim, on demand)
  const liveOdds = useMemo(() => {
    if (phase !== 'live' || !me || !current || myTurn) return null;
    const o = availabilityOdds(board, keepers, pool, players, me.id, totalRounds, 12, caps);
    return o.picks.length ? { pick: o.picks[0], odds: new Map([...o.odds].map(([id, v]) => [id, v[0]])) } : null;
  }, [phase, current?.overall]); // eslint-disable-line react-hooks/exhaustive-deps

  const available = useMemo(() => pf.apply(pool.filter((p) => !taken.has(p.id))).slice(0, 80), [pool, taken, pf.apply]);
  const poolReady = pool.length >= 50 && teams.length >= 2;

  const grades = useMemo(() => (phase === 'done' ? gradeTeams(new Map(order.map((t) => [t, teamPlayers(t)]))) : null), [phase]);
  const mySteals = useMemo(() => {
    if (phase !== 'done' || !me) return [];
    const mine = board.filter((b) => b.team === me.id && b.pid).map((b) => ({ overall: b.overall, team: b.team, player: players.get(b.pid!)! })).filter((x) => x.player);
    return pickValues(mine, poolRank).sort((a, b) => b.value - a.value);
  }, [phase]);

  const share = async () => {
    if (!me || !grades) return;
    const g = grades.get(me.id)!;
    const best = mySteals[0];
    const body = `🧪 ${mode === 'real' ? 'Dress rehearsal of tomorrow’s draft' : `Mock draft from slot ${order.indexOf(me.id) + 1}`}: graded ${g.grade} (${g.rank}${['st', 'nd', 'rd'][g.rank - 1] ?? 'th'} of ${order.length}).${best ? ` Steal: ${best.player.name} at #${best.overall}.` : ''} Draft night can’t come fast enough.`;
    const { error } = await supabase.from('messages').insert({ channel: 'general', team_id: me.id, body });
    if (error) toast(error.message, 'err'); else toast('Posted to Trash Talk 🔥');
  };

  if (!me) return null;
  const upcoming = board.filter((b) => !b.pid).slice(1, 7);
  const untilMine = current ? board.filter((b) => !b.pid).findIndex((b) => b.team === me.id) : -1;
  const remaining = deadline ? deadline - now : 0;
  const myRealPicks = realBoard.filter((b) => b.team === me.id && !b.pid);
  const fitTag = (p: Player) => { const f = fitFor(p, myNeeds); return f === 'BN' ? 'bench' : `fills ${f}`; };

  if (phase === 'setup') {
    const Opt = <T extends number>({ v, set, opts, fmt }: { v: T; set: (x: T) => void; opts: T[]; fmt: (x: T) => string }) => (
      <div className="flex flex-wrap gap-1.5">{opts.map((o) => <button key={o} className={`tab ${v === o ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => set(o)}>{fmt(o)}</button>)}</div>
    );
    const keptCount = teams.filter((t) => t.keepers_submitted).length;
    return (
      <div className="space-y-4">
        <PageHeader icon={<FlaskConical size={22} className="text-clover" />} title="Mock Draft" sub="Practice against bot GMs. Nothing here counts." />
        <div className="card-hero space-y-4 p-4" style={{ '--tc': me.color } as React.CSSProperties}>
          {realReady && (
            <div className="relative">
              <div className="label mb-1.5 text-white/70">What to run</div>
              <div className="flex flex-wrap gap-1.5">
                <button className={`tab ${mode === 'real' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setMode('real')}>🎯 Dress rehearsal: the real draft</button>
                <button className={`tab ${mode === 'custom' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setMode('custom')}>🧪 Custom mock</button>
              </div>
              {mode === 'real' && <p className="mt-1.5 text-xs text-white/60">The real order, {league?.draft_rounds} rounds, {league?.snake ? 'snake' : 'straight'}, traded picks where they landed, and everyone’s keepers as saved today ({keptCount} of {teams.length} GMs locked in). Your picks: {myRealPicks.slice(0, 6).map((b) => `#${b.overall}`).join(', ')}{myRealPicks.length > 6 ? '…' : ''}.</p>}
            </div>
          )}
          {mode === 'custom' && (
            <>
              <div className="relative">
                <div className="label mb-1.5 text-white/70">Your draft slot</div>
                <Opt v={slot} set={setSlot} opts={[0, ...teams.map((_, i) => i + 1)]} fmt={(x) => (x ? `#${x}` : '🎲 Random')} />
              </div>
              <div className="relative">
                <div className="label mb-1.5 text-white/70">Rounds</div>
                <Opt v={rounds} set={setRounds} opts={[6, 12, 18]} fmt={(x) => `${x} rounds`} />
              </div>
            </>
          )}
          <div className="relative">
            <div className="label mb-1.5 text-white/70">Your pick clock</div>
            <Opt v={clock} set={setClock} opts={[0, 30, 90]} fmt={(x) => (x ? `${x}s` : 'No clock')} />
          </div>
          <p className="relative text-xs text-white/60">Everyone keeps the keepers they’ve saved so far (or the ones the site would pick for them). The bots draft the best projected player with a little chaos, fill their starting slots, and grab goalies in time. Jump ahead any time with “Sim to my pick”.</p>
          <button className="btn-primary relative w-full py-3 text-base" disabled={!poolReady} onClick={start}>{poolReady ? (mode === 'real' ? '🎯 Start the dress rehearsal' : '🧪 Start the mock') : 'Loading the player pool…'}</button>
          {!poolReady && <p className="relative text-center text-xs text-white/60">Still loading after a few seconds? <button className="underline" onClick={() => location.reload()}>Reload the page</button>.</p>}
        </div>

        {mode === 'real' && realReady && (
          <Section title="🔮 Who’ll be there at your picks" right={<button className="btn btn-sm" disabled={simming || !poolReady} onClick={runOutlook}>{simming ? 'Simulating…' : outlook ? 'Run again' : 'Run 25 simulations'}</button>}>
            {!outlook ? <div className="card p-3 text-sm text-mute">Runs the whole draft 25 times with every GM on bot logic and counts how often each player is still on the board when your picks come up. Takes a second.</div> : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-mute"><tr><th className="px-3 py-2 text-left">Player</th><th className="text-right">Proj</th>{outlook.picks.map((ov) => <th key={ov} className="px-2 text-right">at #{ov}</th>)}</tr></thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {pool.slice(0, 120).filter((p) => (outlook.odds.get(p.id)?.[0] ?? 0) >= 10 || (outlook.odds.get(p.id)?.[outlook.picks.length - 1] ?? 0) >= 40).slice(0, 40).map((p) => (
                      <tr key={p.id} className="hover:bg-white/[.03]">
                        <td className="px-3 py-1.5"><button className="flex items-center gap-2 text-left" onClick={() => setDetail(p.id)}><Pos p={p.pos} className="px-1 text-[10px]" /><span className="truncate">{p.name}</span><span className="text-[11px] text-mute">{p.nhl_team}</span></button></td>
                        <td className="num text-right">{Math.round(p.proj)}</td>
                        {outlook.picks.map((ov, i) => { const v = outlook.odds.get(p.id)?.[i] ?? 0; return <td key={ov} className={`num px-2 text-right ${v >= 70 ? 'text-emerald-300' : v >= 35 ? 'text-amber-200' : v > 0 ? 'text-mute' : 'text-red-300/70'}`}>{v}%</td>; })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] text-mute">Green: probably yours if you want him. Amber: a coin flip. Red: gone. Bots don’t know anyone’s queue, so surprises still happen.</p>
              </div>
            )}
          </Section>
        )}
        <Link to="/draft" className="block text-center text-sm text-sky-300">← Back to the real draft room</Link>
        <PlayerSheet id={detail} onClose={() => setDetail(null)} />
      </div>
    );
  }

  if (phase === 'done' && grades) {
    const table = [...grades.values()].sort((a, b) => a.rank - b.rank);
    const mine = grades.get(me.id)!;
    const lineup = lineupStrength(teamPlayers(me.id));
    return (
      <div className="space-y-4">
        <div className="card-hero p-5 text-center" style={{ '--tc': me.color } as React.CSSProperties}>
          <div className="label relative text-white/70">Your {mode === 'real' ? 'dress rehearsal' : 'mock draft'} grade</div>
          <div className={`h-display relative mt-1 text-7xl leading-none drop-shadow-[0_0_24px_rgba(255,255,255,.25)] ${gradeColor(mine.grade)}`}>{mine.grade}</div>
          <div className="relative mt-1 text-sm text-white/70">{mine.rank}{['st', 'nd', 'rd'][mine.rank - 1] ?? 'th'} of {table.length} · {fmtPts(mine.starterPts, 0)} projected from your starters</div>
          <div className="relative mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => setPhase('setup')}><RotateCcw size={16} /> Run it back</button>
            <button className="btn-ghost" onClick={share}><Share2 size={16} /> Post to Trash Talk</button>
          </div>
        </div>
        {mySteals.length > 0 && (
          <Section title="Your best value picks">
            <div className="card divide-y divide-white/[.06]">
              {mySteals.slice(0, 3).map((s) => (
                <div key={s.overall} className="px-3 py-2"><PlayerRow p={s.player} onClick={() => setDetail(s.player.id)} right={<div className="text-right text-xs"><div className="font-bold">#{s.overall}</div><div className={s.value > 0 ? 'text-emerald-300' : 'text-mute'}>{s.value > 0 ? `+${s.value} value` : 'on time'}</div></div>} /></div>
              ))}
            </div>
          </Section>
        )}
        <Section title="How your roster balanced out"><RosterNeeds players={teamPlayers(me.id)} caps={caps} onPlayer={setDetail} tag={(p) => (keptIds.has(p.id) ? 'K' : `#${board.find((b) => b.pid === p.id)?.overall ?? ''}`)} /></Section>
        <Section title="Report card">
          <div className="card divide-y divide-white/[.06]">
            {table.map((g) => (
              <div key={g.team} className={`flex items-center gap-3 px-3 py-2.5 ${g.team === me.id ? 'bg-white/[.05]' : ''}`}>
                <span className="num w-5 text-center font-display text-lg text-mute">{g.rank}</span>
                <TeamBadge team={team(g.team)} size={30} />
                <div className="min-w-0 flex-1"><TeamName team={team(g.team)} className="block truncate text-sm" /><div className="text-[11px] text-mute">{fmtPts(g.starterPts, 0)} proj starters · {needsOf(teamPlayers(g.team), caps).gaps.join(', ') || 'starters full'}</div></div>
                <div className={`h-display text-3xl ${gradeColor(g.grade)}`}>{g.grade}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Your projected lineup">
          <div className="card divide-y divide-white/[.06]">
            {lineup.starters.map((s) => <div key={s.p.id} className="flex items-center gap-2 px-3 py-2"><Pos p={s.slot} className="w-10" /><div className="min-w-0 flex-1"><PlayerRow p={s.p} onClick={() => setDetail(s.p.id)} right={<span className="num text-sm font-bold">{fmtPts(s.p.proj, 0)}</span>} /></div></div>)}
          </div>
        </Section>
        <PlayerSheet id={detail} onClose={() => setDetail(null)} />
      </div>
    );
  }

  // live mock
  const onClock = team(current?.team);
  const bestBy = (k: string) => pool.filter((p) => !taken.has(p.id) && (k === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(k)))[0];
  return (
    <div className="space-y-3">
      <div className="card-hero sticky top-[calc(3.25rem+var(--banner,0px))] z-20 p-3 lg:top-2" style={{ '--tc': onClock?.color } as React.CSSProperties}>
        <div className="relative flex items-center gap-3">
          <ClockRing frac={myTurn && clock ? remaining / (clock * 1000) : 1} color={readable(onClock?.color ?? '#4cc3ff')}>
            <TeamBadge team={onClock} size={44} />
          </ClockRing>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{mode === 'real' ? '🎯 Rehearsal' : '🧪 Mock'} · Round {current?.round} · Pick {current?.overall} of {board.length}{current && current.team !== current.original ? ` · via ${team(current.original)?.abbrev}` : ''}</div>
            <div className="h-display truncate text-xl leading-tight">{myTurn ? '⏰ Your pick!' : <TeamName team={onClock} />}</div>
            <div className="text-[11px] text-white/60">{myTurn ? 'Tap Draft on anyone below' : untilMine > 0 ? `You pick in ${untilMine}` : 'Bots are thinking…'}</div>
          </div>
          {myTurn && clock > 0 && <div className={`num font-display text-4xl font-extrabold ${remaining < 10_000 ? 'animate-pulse text-red-400' : ''}`}>{Math.max(0, Math.ceil(remaining / 1000))}</div>}
        </div>
        <div className="scroll-x relative mt-2 flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="shrink-0">Up next:</span>
          {upcoming.map((p) => <span key={p.overall} className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${p.team === me.id ? 'bg-sky-500/25 text-sky-100' : 'bg-black/25'}`}><TeamBadge team={team(p.team)} size={14} />{team(p.team)?.gm_name}</span>)}
        </div>
        <div className="relative mt-2 flex flex-wrap gap-1.5">
          {!myTurn && untilMine > 0 && <button className="btn btn-sm" onClick={() => simTo('human')}><FastForward size={14} /> Sim to my pick</button>}
          <button className="btn-ghost btn-sm" onClick={() => confirm('Let the bots finish the whole draft, including your picks?') && simTo('end')}><Flag size={14} /> Sim the rest</button>
        </div>
      </div>

      <div className="flex gap-1">
        {([['avail', 'Available'], ['board', 'Board'], ['team', 'My team']] as const).map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>)}
        <button className="tab ml-auto bg-white/[.05]" onClick={() => confirm('Quit this mock?') && setPhase('setup')}>Quit</button>
      </div>

      {tab === 'avail' && (
        <div className="card overflow-hidden">
          <div className="border-b border-white/[.07] px-2 py-1.5"><NeedsStrip players={myPlayers} caps={caps} /></div>
          {myTurn && (
            <div className="scroll-x flex gap-1.5 border-b border-white/[.07] p-2 text-xs">
              <span className="shrink-0 self-center text-mute">Best by position:</span>
              {['C', 'LW', 'RW', 'D', 'G'].map((k) => { const p = bestBy(k); return p ? <button key={k} className={`chip shrink-0 py-1 ${myNeeds.open[k as 'C'] > 0 ? 'border-amber-300/40 bg-amber-500/10' : ''}`} onClick={() => setDetail(p.id)}><b>{k}</b> {p.last_name} <span className="text-mute">{Math.round(p.proj)}</span></button> : null; })}
            </div>
          )}
          <div className="border-b border-white/[.07] p-2"><PlayerFilterBar pf={pf} compact /></div>
          <div className="divide-y divide-white/[.06]">
            {available.map((p) => {
              const rank = poolRank.get(p.id) ?? 999;
              const value = current ? rank - current.overall : 0;
              const odds = liveOdds?.odds.get(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 px-2 py-2">
                  <span className="w-7 text-center text-[11px] text-mute">{rank}</span>
                  <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => setDetail(p.id)} sub={<span className={`ml-1 rounded px-1 text-[10px] ${fitFor(p, myNeeds) === 'BN' ? 'bg-white/[.06] text-mute' : 'bg-amber-500/15 text-amber-200'}`}>{fitTag(p)}</span>} /></div>
                  <div className="w-20 text-right">
                    <div className="num text-sm font-bold">{pf.fmt(p)}</div>
                    <div className="whitespace-nowrap text-[10px] text-mute">{myTurn && value > 8 ? <span className="text-emerald-300">+{value} value</span> : odds != null && !myTurn ? <span className={odds >= 70 ? 'text-emerald-300' : odds >= 35 ? 'text-amber-200' : 'text-red-300/80'}>{odds}% at #{liveOdds!.pick}</span> : pf.label}</div>
                  </div>
                  {myTurn && <button className="btn-primary btn-sm shrink-0" onClick={() => makePick(p)}>Draft</button>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'board' && (
        <div className="card overflow-auto p-1">
          <table className="w-max border-separate border-spacing-1 text-xs">
            <thead><tr><th className="w-6" />{order.map((t) => <th key={t} className="w-24 px-1 text-left"><div className="flex items-center gap-1"><TeamBadge team={team(t)} size={16} /><span className="truncate">{team(t)?.gm_name}</span></div></th>)}</tr></thead>
            <tbody>
              {Array.from({ length: totalRounds }).map((_, ri) => (
                <tr key={ri}><td className="text-center font-bold text-mute">{ri + 1}</td>
                  {order.map((t) => {
                    const pk = board.find((b) => b.round === ri + 1 && b.original === t);
                    const pl = pk?.pid ? players.get(pk.pid) : undefined;
                    const isNow = pk && pk.overall === current?.overall;
                    const traded = pk && pk.team !== pk.original;
                    return (
                      <td key={t}><div className={`h-11 w-24 rounded-lg border px-1.5 py-1 ${isNow ? 'pulse-ring border-goal bg-goal/20' : pl ? 'border-white/10' : 'border-dashed border-white/10'} ${pk?.team === me.id && !pl ? 'border-sky-400/60' : ''}`} style={pl ? { background: POS_BG[pl.pos], boxShadow: traded ? `inset 3px 0 0 ${readable(team(pk!.team)?.color ?? '#888')}` : undefined } : undefined}>
                        <div className="flex justify-between text-[10px] text-mute"><span>#{pk?.overall}</span>{traded && <span>→{team(pk!.team)?.abbrev}</span>}</div>
                        {pl ? <div className="truncate font-semibold">{pl.last_name}</div> : isNow ? <div className="font-semibold text-goal">On clock</div> : null}
                      </div></td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-3">
          <RosterNeeds players={myPlayers} caps={caps} onPlayer={setDetail} tag={(p) => (keptIds.has(p.id) ? 'K' : `#${board.find((b) => b.pid === p.id)?.overall ?? ''}`)} />
          <div className="card px-3 py-2 text-xs text-mute">{fmtPts(lineupStrength(myPlayers).starterPts, 0)} projected from your best lineup · your picks left: {board.filter((b) => b.team === me.id && !b.pid).map((b) => `#${b.overall}`).join(', ') || 'none'}</div>
        </div>
      )}

      {flash && flash.pid && (() => {
        const p = players.get(flash.pid);
        return (
          <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[65] flex justify-center px-4 lg:bottom-8">
            <div className="animate-pop flex items-center gap-3 rounded-2xl border border-white/15 px-3 py-2 shadow-2xl" style={{ background: `linear-gradient(120deg, ${team(flash.team)?.color}, #0b1222 75%)` }}>
              <Headshot p={p} size={40} />
              <div className="text-sm"><div className="text-[10px] font-bold uppercase tracking-wider text-white/70">#{flash.overall} · {team(flash.team)?.gm_name}</div><div className="font-bold">{p?.name}</div></div>
            </div>
          </div>
        );
      })()}

      <PlayerSheet id={detail} onClose={() => setDetail(null)} actions={detail && myTurn && !taken.has(detail) && !keptIds.has(detail) ? (
        <button className="btn-primary" onClick={() => { makePick(players.get(detail)!); setDetail(null); }}>Draft {players.get(detail)?.last_name}</button>
      ) : undefined} />
    </div>
  );
}
