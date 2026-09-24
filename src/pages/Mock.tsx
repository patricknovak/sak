import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, RotateCcw, Share2 } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Player, Pos as PosT } from '../lib/types';
import { fmtPts, readable } from '../lib/format';
import { gradeColor, gradeTeams, lineupStrength, pickValues, projectedKeepers } from '../lib/grades';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { Headshot, PageHeader, Pos, Section, TeamBadge, TeamName, useToast } from '../components/ui';
import { ClockRing, POS_BG, celebrate } from '../components/draftkit';

type Phase = 'setup' | 'live' | 'done';
type Tab = 'avail' | 'board' | 'team';
interface MockPick { overall: number; round: number; team: number; pid: number | null }

const CAPS: Record<string, number> = { C: 7, LW: 7, RW: 7, D: 9, G: 4 };
const POSITIONS: ('ALL' | PosT)[] = ['ALL', 'C', 'LW', 'RW', 'D', 'G'];

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default function Mock() {
  const { me, league, teams, team, players, rosters } = useLeague();
  const toast = useToast();
  const now = useNow(250);
  const [phase, setPhase] = useState<Phase>('setup');
  const [slot, setSlot] = useState(0); // 0 = random
  const [rounds, setRounds] = useState(12);
  const [clock, setClock] = useState(30);
  const [order, setOrder] = useState<number[]>([]);
  const [board, setBoard] = useState<MockPick[]>([]);
  const [tab, setTab] = useState<Tab>('avail');
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<'ALL' | PosT>('ALL');
  const [detail, setDetail] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [flash, setFlash] = useState<MockPick | null>(null);

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

  const taken = useMemo(() => new Set(board.filter((b) => b.pid).map((b) => b.pid!)), [board]);
  const current = board.find((b) => !b.pid);
  const myTurn = phase === 'live' && current?.team === me?.id;
  const teamPlayers = (t: number) => [...(keepers.get(t) ?? []), ...board.filter((b) => b.team === t && b.pid).map((b) => b.pid!)]
    .map((id) => players.get(id)).filter(Boolean) as Player[];

  // bots: best projection with a little noise, respecting positional caps and grabbing goalies in time
  const botPick = (t: number): Player | undefined => {
    const mine = teamPlayers(t);
    const count = (k: string) => mine.filter((p) => p.pos === k).length;
    const round = current?.round ?? 1;
    const cands = pool.filter((p) => !taken.has(p.id) && count(p.pos) < (CAPS[p.pos] ?? 9)).slice(0, 40)
      .map((p) => {
        let v = p.proj * (0.9 + Math.random() * 0.2);
        if (p.pos === 'G' && count('G') < 2 && round >= 5) v *= 1.2;
        if (p.pos === 'G' && count('G') >= 3) v *= 0.6;
        if (p.injury_status === 'Out' || p.injury_status === 'Suspension') v *= 0.8;
        return { p, v };
      }).sort((a, b) => b.v - a.v);
    return (Math.random() < 0.2 ? cands[Math.floor(Math.random() * Math.min(3, cands.length))] : cands[0])?.p;
  };

  const makePick = (p: Player) => {
    if (!current) return;
    const done: MockPick = { ...current, pid: p.id };
    setBoard((b) => b.map((x) => (x.overall === current.overall ? done : x)));
    setFlash(done); setTimeout(() => setFlash((f) => (f?.overall === done.overall ? null : f)), 1800);
    if (done.team === me?.id) celebrate([me.color, '#ffffff', '#f7c548']);
  };

  // run the bots, and my clock
  const botTimer = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'live') return;
    if (!current) { setPhase('done'); setDeadline(null); celebrate(['#f7c548', '#ffffff', me?.color ?? '#ef2a4f'], true); return; }
    if (current.team === me?.id) { setDeadline(clock ? Date.now() + clock * 1000 : null); return; }
    setDeadline(null);
    botTimer.current = window.setTimeout(() => { const p = botPick(current.team); if (p) makePick(p); }, 650);
    return () => { if (botTimer.current) clearTimeout(botTimer.current); };
  }, [phase, current?.overall]);
  useEffect(() => {
    if (myTurn && deadline && now > deadline) { const p = botPick(me!.id); if (p) { toast('Clock ran out: autopicked ' + p.name, 'info'); makePick(p); } }
  }, [now > (deadline ?? Infinity)]);

  const start = () => {
    if (!me) return;
    const others = shuffle(teams.map((t) => t.id).filter((id) => id !== me.id));
    const at = (slot || 1 + Math.floor(Math.random() * teams.length)) - 1;
    const ord = [...others.slice(0, at), me.id, ...others.slice(at)];
    const picks: MockPick[] = [];
    for (let r = 1; r <= rounds; r++) (r % 2 ? ord : [...ord].reverse()).forEach((t) => picks.push({ overall: picks.length + 1, round: r, team: t, pid: null }));
    setOrder(ord); setBoard(picks); setTab('avail'); setPhase('live');
  };

  const available = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter((p) => !taken.has(p.id))
      .filter((p) => pos === 'ALL' || (pos === 'G' ? p.pos === 'G' : p.elig.includes(pos)))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.nhl_team?.toLowerCase() === needle)
      .slice(0, 80);
  }, [pool, taken, pos, q]);

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
    const body = `🧪 Mock draft from slot ${order.indexOf(me.id) + 1}: graded ${g.grade} (${g.rank}${['st', 'nd', 'rd'][g.rank - 1] ?? 'th'} of ${order.length}).${best ? ` Steal: ${best.player.name} at #${best.overall}.` : ''} Sunday can’t come fast enough.`;
    const { error } = await supabase.from('messages').insert({ channel: 'general', team_id: me.id, body });
    if (error) toast(error.message, 'err'); else toast('Posted to Trash Talk 🔥');
  };

  if (!me) return null;
  const upcoming = board.filter((b) => !b.pid).slice(1, 7);
  const untilMine = current ? board.filter((b) => !b.pid).findIndex((b) => b.team === me.id) : -1;
  const remaining = deadline ? deadline - now : 0;

  if (phase === 'setup') {
    const Opt = <T extends number>({ v, set, opts, fmt }: { v: T; set: (x: T) => void; opts: T[]; fmt: (x: T) => string }) => (
      <div className="flex flex-wrap gap-1.5">{opts.map((o) => <button key={o} className={`tab ${v === o ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => set(o)}>{fmt(o)}</button>)}</div>
    );
    return (
      <div className="space-y-4">
        <PageHeader icon={<FlaskConical size={22} className="text-clover" />} title="Mock Draft" sub="Practice against bot GMs. Nothing here counts." />
        <div className="card-hero space-y-4 p-4" style={{ '--tc': me.color } as React.CSSProperties}>
          <div className="relative">
            <div className="label mb-1.5 text-white/70">Your draft slot</div>
            <Opt v={slot} set={setSlot} opts={[0, ...teams.map((_, i) => i + 1)]} fmt={(x) => (x ? `#${x}` : '🎲 Random')} />
          </div>
          <div className="relative">
            <div className="label mb-1.5 text-white/70">Rounds</div>
            <Opt v={rounds} set={setRounds} opts={[6, 12, 18]} fmt={(x) => `${x} rounds`} />
          </div>
          <div className="relative">
            <div className="label mb-1.5 text-white/70">Your pick clock</div>
            <Opt v={clock} set={setClock} opts={[0, 30, 90]} fmt={(x) => (x ? `${x}s` : 'No clock')} />
          </div>
          <p className="relative text-xs text-white/60">Everyone keeps the keepers they’ve saved so far (or the ones the site would pick for them). The bots draft the best projected player with a little chaos, and grab goalies in time.</p>
          <button className="btn-primary relative w-full py-3 text-base" onClick={start}>🧪 Start the mock</button>
        </div>
        <Link to="/draft" className="block text-center text-sm text-sky-300">← Back to the real draft room</Link>
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
          <div className="label relative text-white/70">Your mock draft grade</div>
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
        <Section title="Report card">
          <div className="card divide-y divide-white/[.06]">
            {table.map((g) => (
              <div key={g.team} className={`flex items-center gap-3 px-3 py-2.5 ${g.team === me.id ? 'bg-white/[.05]' : ''}`}>
                <span className="num w-5 text-center font-display text-lg text-mute">{g.rank}</span>
                <TeamBadge team={team(g.team)} size={30} />
                <div className="min-w-0 flex-1"><TeamName team={team(g.team)} className="block truncate text-sm" /><div className="text-[11px] text-mute">{fmtPts(g.starterPts, 0)} proj starters</div></div>
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
  return (
    <div className="space-y-3">
      <div className="card-hero sticky top-[calc(3.25rem+var(--banner,0px))] z-20 p-3 lg:top-2" style={{ '--tc': onClock?.color } as React.CSSProperties}>
        <div className="relative flex items-center gap-3">
          <ClockRing frac={myTurn && clock ? remaining / (clock * 1000) : 1} color={readable(onClock?.color ?? '#4cc3ff')}>
            <TeamBadge team={onClock} size={44} />
          </ClockRing>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">🧪 Mock · Round {current?.round} · Pick {current?.overall} of {board.length}</div>
            <div className="h-display truncate text-xl leading-tight">{myTurn ? '⏰ Your pick!' : <TeamName team={onClock} />}</div>
            <div className="text-[11px] text-white/60">{myTurn ? 'Tap Draft on anyone below' : untilMine > 0 ? `You pick in ${untilMine}` : 'Bots are thinking…'}</div>
          </div>
          {myTurn && clock > 0 && <div className={`num font-display text-4xl font-extrabold ${remaining < 10_000 ? 'animate-pulse text-red-400' : ''}`}>{Math.max(0, Math.ceil(remaining / 1000))}</div>}
        </div>
        <div className="scroll-x relative mt-2 flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="shrink-0">Up next:</span>
          {upcoming.map((p) => <span key={p.overall} className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${p.team === me.id ? 'bg-sky-500/25 text-sky-100' : 'bg-black/25'}`}><TeamBadge team={team(p.team)} size={14} />{team(p.team)?.gm_name}</span>)}
        </div>
      </div>

      <div className="flex gap-1">
        {([['avail', 'Available'], ['board', 'Board'], ['team', 'My team']] as const).map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>)}
        <button className="tab ml-auto bg-white/[.05]" onClick={() => confirm('Quit this mock?') && setPhase('setup')}>Quit</button>
      </div>

      {tab === 'avail' && (
        <div className="card overflow-hidden">
          <div className="space-y-2 border-b border-white/[.07] p-2">
            <input className="input" placeholder="Search players or team" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="scroll-x flex gap-1">{POSITIONS.map((x) => <button key={x} className={`tab px-2.5 py-1 ${pos === x ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPos(x)}>{x}</button>)}</div>
          </div>
          <div className="divide-y divide-white/[.06]">
            {available.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-2">
                <span className="w-7 text-center text-[11px] text-mute">{poolRank.get(p.id)}</span>
                <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => setDetail(p.id)} /></div>
                <div className="w-11 text-right"><div className="num text-sm font-bold">{fmtPts(p.proj, 0)}</div><div className="text-[10px] text-mute">proj</div></div>
                {myTurn && <button className="btn-primary btn-sm shrink-0" onClick={() => makePick(p)}>Draft</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'board' && (
        <div className="card overflow-auto p-1">
          <table className="w-max border-separate border-spacing-1 text-xs">
            <thead><tr><th className="w-6" />{order.map((t) => <th key={t} className="w-24 px-1 text-left"><div className="flex items-center gap-1"><TeamBadge team={team(t)} size={16} /><span className="truncate">{team(t)?.gm_name}</span></div></th>)}</tr></thead>
            <tbody>
              {Array.from({ length: rounds }).map((_, ri) => (
                <tr key={ri}><td className="text-center font-bold text-mute">{ri + 1}</td>
                  {order.map((t) => {
                    const pk = board.find((b) => b.round === ri + 1 && b.team === t);
                    const pl = pk?.pid ? players.get(pk.pid) : undefined;
                    const isNow = pk && pk.overall === current?.overall;
                    return (
                      <td key={t}><div className={`h-11 w-24 rounded-lg border px-1.5 py-1 ${isNow ? 'pulse-ring border-goal bg-goal/20' : pl ? 'border-white/10' : 'border-dashed border-white/10'}`} style={pl ? { background: POS_BG[pl.pos] } : undefined}>
                        <div className="text-[10px] text-mute">#{pk?.overall}</div>
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

      {tab === 'team' && (() => {
        const lu = lineupStrength(teamPlayers(me.id));
        return (
          <div className="card divide-y divide-white/[.06]">
            <div className="px-3 py-2 text-xs text-mute">Keepers + your picks · {fmtPts(lu.starterPts, 0)} projected from your best lineup</div>
            {lu.starters.map((s) => <div key={s.p.id} className="flex items-center gap-2 px-3 py-2"><Pos p={s.slot} className="w-10" /><div className="min-w-0 flex-1"><PlayerRow p={s.p} right={<span className="num text-sm font-bold">{fmtPts(s.p.proj, 0)}</span>} /></div></div>)}
            {lu.bench.map((p) => <div key={p.id} className="flex items-center gap-2 px-3 py-2 opacity-70"><Pos p="BN" className="w-10" /><div className="min-w-0 flex-1"><PlayerRow p={p} right={<span className="num text-sm">{fmtPts(p.proj, 0)}</span>} /></div></div>)}
          </div>
        );
      })()}

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
