import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { DraftPick, Player, Pos as PosT } from '../lib/types';
import { countdown, fmtDateTime, fmtPts, readable } from '../lib/format';
import { ChatPanel } from '../components/ChatPanel';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { Countdown, Headshot, Sheet, Pos, TeamBadge, TeamName, TeamStack, Toggle, useAction, useToast } from '../components/ui';
import { ClockRing, POS_BG, celebrate, useWide } from '../components/draftkit';
import { PushCard } from '../components/PushCard';
import { DraftReport } from '../components/DraftReport';

type Tab = 'players' | 'board' | 'queue' | 'team' | 'chat';
const POSITIONS: ('ALL' | PosT)[] = ['ALL', 'C', 'LW', 'RW', 'D', 'G'];

export default function Draft() {
  const { me, league, teams, team, players, rosters, owner, picks, draft, online, refresh } = useLeague();
  const now = useNow(500);
  const { busy, run: runRaw } = useAction();
  const toast = useToast();
  const wide = useWide();
  const run = (fn: () => Promise<unknown>, ok?: string) => runRaw(async () => { await fn(); await refresh(['draft', 'picks', 'league', 'rosters', 'teams']); }, ok);
  const [tab, setTab] = useState<Tab>('players');
  const [report, setReport] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<'ALL' | PosT>('ALL');
  const [sort, setSort] = useState<'proj' | 'last_fp'>('proj');
  const [queue, setQueue] = useState<number[]>([]);
  const [detail, setDetail] = useState<number | null>(null);
  const [flash, setFlash] = useState<DraftPick | null>(null);

  const season = draft?.season;
  const board = useMemo(() => picks.filter((p) => p.season === season && p.overall).sort((a, b) => a.overall! - b.overall!), [picks, season]);
  const order = useMemo(() => board.filter((p) => p.round === 1).map((p) => p.original_team), [board]);
  const current = board.find((p) => p.overall === draft?.current_overall);
  const myTurn = draft?.status === 'live' && current?.team_id === me?.id;
  const remaining = draft?.status === 'paused' ? (draft.paused_remaining ?? 0) * 1000 : draft?.deadline ? new Date(draft.deadline).getTime() - now : 0;
  const upcoming = board.filter((p) => !p.player_id && p.overall! > (draft?.current_overall ?? 0)).slice(0, 6);
  const myNext = board.find((p) => !p.player_id && p.team_id === me?.id);
  const picksUntilMine = myNext && current ? myNext.overall! - current.overall! : null;
  const made = board.filter((p) => p.player_id).length;

  // my queue
  const loadQueue = useCallback(async () => {
    const { data } = await supabase.from('draft_queue').select('player_id,pos').order('pos');
    setQueue((data ?? []).map((r) => r.player_id));
  }, []);
  useEffect(() => { loadQueue(); }, [loadQueue, made]);
  // quick taps would race delete+insert, so saves run one at a time and always write the latest queue
  const pendingQueue = useRef<number[] | null>(null);
  const savingQueue = useRef(false);
  const saveQueue = async (ids: number[]) => {
    setQueue(ids);
    if (!me) return;
    pendingQueue.current = ids;
    if (savingQueue.current) return;
    savingQueue.current = true;
    try {
      while (pendingQueue.current) {
        const next = pendingQueue.current;
        pendingQueue.current = null;
        const del = await supabase.from('draft_queue').delete().eq('team_id', me.id);
        const ins = next.length ? await supabase.from('draft_queue').insert(next.map((player_id, i) => ({ team_id: me.id, player_id, pos: i }))) : { error: null };
        if (del.error || ins.error) toast('Couldn’t save your queue. Try again.', 'err');
      }
    } finally { savingQueue.current = false; }
  };
  const toggleQueue = (id: number) => saveQueue(queue.includes(id) ? queue.filter((x) => x !== id) : [...queue, id]);

  // pick announcement
  const lastSeen = useRef<number>(made);
  useEffect(() => {
    if (made > lastSeen.current) {
      const latest = [...board].reverse().find((p) => p.player_id);
      if (latest) {
        setFlash(latest); setTimeout(() => setFlash(null), 4200);
        const tc = team(latest.team_id)?.color ?? '#4cc3ff';
        celebrate([tc, '#ffffff', '#f7c548'], latest.team_id === me?.id || latest.overall === 1);
      }
    }
    lastSeen.current = made;
  }, [made]);

  // before keepers are final every rostered player might come back, so show the whole pool
  const preKeepers = league?.phase === 'keepers';
  const taken = (id: number) => !preKeepers && owner.has(id);
  // each team's 2025-26 top scorer can't be kept, so he's a sure thing for the draft
  const banned = useMemo(() => {
    const best = new Map<number, { id: number; fp: number }>();
    if (league?.top_scorer_rule) for (const r of rosters) {
      if (r.prev_fp == null) continue;
      const b = best.get(r.team_id);
      if (!b || r.prev_fp > b.fp || (r.prev_fp === b.fp && r.player_id < b.id)) best.set(r.team_id, { id: r.player_id, fp: r.prev_fp });
    }
    return new Set([...best.values()].map((b) => b.id));
  }, [rosters, league?.top_scorer_rule]);
  const available = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...players.values()]
      .filter((p) => preKeepers || !owner.has(p.id))
      .filter((p) => pos === 'ALL' || (pos === 'G' ? p.pos === 'G' : p.elig.includes(pos)))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.nhl_team?.toLowerCase() === needle)
      .sort((a, b) => (b[sort] as number) - (a[sort] as number))
      .slice(0, 150);
  }, [players, owner, pos, q, sort, preKeepers]);

  const draftPlayer = (p: Player) => run(async () => {
    await rpc('draft_pick', { p_player: p.id });
    setDetail(null);
    await refresh(['draft', 'picks', 'rosters']);
  }, `You drafted ${p.name}!`);

  const myRoster = rosters.filter((r) => r.team_id === me?.id).map((r) => players.get(r.player_id)!).filter(Boolean);
  const countBy = (ps: Player[], k: PosT) => ps.filter((p) => p.pos === k).length;
  const needs: Record<PosT, number> = { C: 2, LW: 2, RW: 2, D: 3, G: 2 };

  const clockColor = remaining < 10_000 ? 'text-red-400' : remaining < 30_000 ? 'text-amber-300' : 'text-white';
  const status = draft?.status ?? 'scheduled';

  const PlayersTab = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-2">
        <input className="input" placeholder="Search players or team (e.g. EDM)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex items-center gap-1.5">
          <div className="scroll-x flex flex-1 gap-1">
            {POSITIONS.map((x) => <button key={x} className={`tab px-2.5 py-1 ${pos === x ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setPos(x)}>{x}</button>)}
          </div>
          <select className="rounded-lg border border-line bg-boards px-2 py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as 'proj')}>
            <option value="proj">Projected</option>
            <option value="last_fp">2025-26 pts</option>
          </select>
        </div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-white/[.06] overflow-y-auto">
        {available.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 px-2 py-2">
            <span className="w-6 text-center text-[11px] text-mute">{i + 1}</span>
            <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => setDetail(p.id)} /></div>
            <div className="w-12 text-right">
              <div className="text-sm font-semibold">{fmtPts(sort === 'proj' ? p.proj : p.last_fp, 0)}</div>
              {preKeepers && owner.has(p.id) && !banned.has(p.id)
                ? <div className="text-[10px] font-semibold text-amber-300" title="On a 2025-26 roster: could still be kept">{team(owner.get(p.id)!.team_id)?.abbrev}?</div>
                : <div className="text-[10px] text-mute">{sort === 'proj' ? 'proj' : "'25-26"}</div>}
            </div>
            <button className={`grid h-9 w-9 place-items-center rounded-lg text-lg ${queue.includes(p.id) ? 'text-amber-300' : 'text-mute'}`} onClick={() => toggleQueue(p.id)} title="Queue">
              {queue.includes(p.id) ? '★' : '☆'}
            </button>
            {myTurn && <button className="btn-primary btn-sm shrink-0" disabled={busy} onClick={() => draftPlayer(p)}>Draft</button>}
          </div>
        ))}
      </div>
    </div>
  );

  const BoardTab = (
    <div className="min-h-0 flex-1 overflow-auto">
      {board.length === 0 ? <div className="p-6 text-center text-sm text-mute">The draft order hasn’t been set yet.</div> : (
        <table className="w-max border-separate border-spacing-1 p-1 text-xs">
          <thead className="sticky top-0 z-10 bg-[#0b1222]/95 backdrop-blur">
            <tr>
              <th className="w-7" />
              {order.map((t) => (
                <th key={t} className="w-28 px-1 py-1 text-left">
                  <div className="flex items-center gap-1"><TeamBadge team={team(t)} size={18} /><span className="truncate">{team(t)?.gm_name}</span></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-center font-bold text-mute">K</td>
              {order.map((t) => (
                <td key={t} className="align-top">
                  <div className="space-y-0.5 rounded-lg border border-gold/20 bg-gold/[.06] p-1">
                    {rosters.filter((r) => r.team_id === t && r.acquired === 'keeper').map((r) => players.get(r.player_id)).filter(Boolean).map((p) => (
                      <div key={p!.id} className="flex items-center gap-1 truncate"><Pos p={p!.pos} className="min-w-0 px-1" /><span className="truncate">{p!.last_name}</span></div>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
            {Array.from({ length: league?.draft_rounds ?? 0 }).map((_, ri) => {
              const round = ri + 1;
              const row = board.filter((p) => p.round === round);
              return (
                <tr key={round}>
                  <td className="text-center font-bold text-mute">{round}</td>
                  {order.map((t) => {
                    const pk = row.find((p) => p.original_team === t);
                    if (!pk) return <td key={t} />;
                    const pl = pk.player_id ? players.get(pk.player_id) : undefined;
                    const isNow = pk.overall === draft?.current_overall && status !== 'done';
                    const traded = pk.team_id !== pk.original_team;
                    return (
                      <td key={t}>
                        <button onClick={() => pl && setDetail(pl.id)}
                          style={pl ? { background: POS_BG[pl.pos], boxShadow: `inset 3px 0 0 ${readable(team(pk.team_id)?.color ?? '#888')}` } : undefined}
                          className={`h-12 w-28 rounded-lg border px-1.5 py-1 text-left transition ${isNow ? 'pulse-ring border-goal bg-goal/20' : pl ? 'border-white/10 hover:brightness-125' : 'border-dashed border-white/10'} ${pk.team_id === me?.id && !pl ? 'border-sky-400/60 bg-sky-400/[.06]' : ''}`}>
                          <div className="flex items-center justify-between text-[10px] text-mute">
                            <span>#{pk.overall}{pk.auto ? ' 🤖' : ''}</span>
                            {traded && <span title={`Owned by ${team(pk.team_id)?.name}`}>→{team(pk.team_id)?.abbrev}</span>}
                          </div>
                          {pl ? (
                            <div className="flex items-center gap-1"><Pos p={pl.pos} className="min-w-0 px-1" /><span className="truncate font-semibold">{pl.last_name}</span></div>
                          ) : isNow ? <div className="font-semibold text-goal">On clock</div> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const QueueTab = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="card mb-2 flex items-center justify-between gap-2 p-3">
        <div className="text-sm"><div className="font-semibold">Autodraft</div><div className="text-xs text-mute">If on (or your clock runs out) the site picks from your queue, then best available.</div></div>
        <Toggle on={!!me?.autodraft} onChange={(v) => run(async () => { await rpc('set_autodraft', { p_on: v }); await refresh(['teams']); }, v ? 'Autodraft on 🤖' : 'Autodraft off')} />
      </div>
      {queue.length === 0 && <div className="p-6 text-center text-sm text-mute">Star (☆) players to line them up here. Your queue is private.</div>}
      <div className="card divide-y divide-white/[.06]">
        {queue.map((id, i) => {
          const p = players.get(id);
          if (!p) return null;
          const gone = taken(id);
          return (
            <div key={id} className="flex items-center gap-2 px-2 py-2">
              <span className="w-5 text-center text-xs text-mute">{i + 1}</span>
              <div className="min-w-0 flex-1"><PlayerRow p={p} dim={gone} onClick={() => setDetail(id)} /></div>
              <button className="btn-ghost btn-sm" disabled={i === 0} onClick={() => { const n = [...queue]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveQueue(n); }}>↑</button>
              <button className="btn-ghost btn-sm" disabled={i === queue.length - 1} onClick={() => { const n = [...queue]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; saveQueue(n); }}>↓</button>
              <button className="btn-ghost btn-sm" onClick={() => toggleQueue(id)}>✕</button>
              {myTurn && !gone && <button className="btn-primary btn-sm" onClick={() => draftPlayer(p)}>Draft</button>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const TeamTab = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="mb-2 grid grid-cols-5 gap-1.5">
        {(Object.keys(needs) as PosT[]).map((k) => {
          const n = countBy(myRoster, k);
          return (
            <div key={k} className={`rounded-xl p-2 text-center ${n >= needs[k] ? 'bg-emerald-500/15' : 'bg-boards'}`}>
              <Pos p={k} /><div className="mt-1 font-display text-xl font-bold">{n}</div><div className="text-[10px] text-mute">start {needs[k]}</div>
            </div>
          );
        })}
      </div>
      <div className="card divide-y divide-white/[.06]">
        {myRoster.sort((a, b) => b.proj - a.proj).map((p) => {
          const r = owner.get(p.id);
          return (
            <div key={p.id} className="flex items-center gap-2 px-2 py-2">
              <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => setDetail(p.id)} /></div>
              <span className="chip">{r?.acquired === 'keeper' ? 'K' : `#${board.find((b) => b.player_id === p.id)?.overall ?? ''}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const Lobby = (
    <div className="card-hero p-4" style={{ '--tc': '#4cc3ff' } as React.CSSProperties}>
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label text-white/70">Draft night · puck drops in</div>
          <div className="mt-2">{league?.draft_at ? <Countdown ms={new Date(league.draft_at).getTime() - now} /> : <span className="h-display text-3xl">TBD</span>}</div>
          <div className="mt-1 text-xs text-white/60">{league?.draft_at && fmtDateTime(league.draft_at)} · {league?.pick_seconds}s clock · {league?.draft_rounds} rounds · {league?.snake ? 'snake' : 'straight'}</div>
        </div>
        {me?.is_commish && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={busy || league?.phase === 'keepers'} onClick={() => confirm('Randomize the draft order? This is the lottery!') && run(() => rpc('draft_randomize_order'), 'Draft order set 🎲')}>🎲 Randomize order</button>
            <button className="btn-primary" disabled={busy || !draft?.order_set || league?.phase === 'keepers'} onClick={() => confirm('Start the draft now?') && run(() => rpc('draft_start'), 'Draft is live!')}>🟢 Start draft</button>
          </div>
        )}
      </div>
      {league?.phase === 'keepers' && <p className="relative mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2.5 text-xs text-amber-100">Keepers aren’t final yet, so the whole pool shows. A team tag in amber (e.g. HIP?) under the points means that player could still be kept. Star anyone now to build your queue; kept players drop out automatically.</p>}
      {order.length > 0 && (
        <div className="relative mt-4">
          <div className="label mb-1.5 text-white/70">Draft order</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {order.map((t, i) => (
              <div key={t} className="animate-pop flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5" style={{ animationDelay: `${i * 120}ms` }}>
                <span className="num font-display text-lg font-bold text-white/50">{i + 1}</span><TeamBadge team={team(t)} size={24} /><span className="truncate text-sm">{team(t)?.gm_name}</span>
                {online.has(t) && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />}
              </div>
            ))}
          </div>
        </div>
      )}
      <Link to="/mock" className="relative mt-4 flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3 transition active:scale-[.98]"><span className="text-2xl">🧪</span><span className="flex-1"><span className="block font-bold">Practice with a mock draft</span><span className="text-xs text-white/70">You vs. 7 bot GMs using today’s keepers. Get graded at the end.</span></span><span className="text-sky-300">→</span></Link>
      <div className="relative mt-3"><PushCard hideWhenOn compact /></div>
      <div className="relative mt-4 flex items-center gap-2 text-xs text-white/70">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.9)]" />
        <TeamStack teams={teams.filter((t) => online.has(t.id))} size={22} />
        <span>{teams.filter((t) => online.has(t.id)).length} in the draft room</span>
      </div>
    </div>
  );

  const tabs: { k: Tab; label: string }[] = [
    { k: 'players', label: 'Players' }, { k: 'board', label: 'Board' }, { k: 'queue', label: `Queue${queue.length ? ` (${queue.length})` : ''}` },
    { k: 'team', label: 'My team' }, { k: 'chat', label: 'Chat' },
  ];

  return (
    <div className="-mx-3 -my-3 flex overflow-x-hidden h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] flex-col sm:-mx-5 lg:m-0 lg:h-[calc(100dvh-3rem)]">
      {/* clock */}
      {(status === 'live' || status === 'paused') && current ? (
        <div className={`relative overflow-hidden border-b border-white/[.08] px-3 py-2.5 ${myTurn ? 'shadow-[inset_0_0_40px_rgba(239,42,79,.35)]' : ''}`}
          style={{ background: `linear-gradient(110deg, color-mix(in oklab, ${team(current.team_id)?.color ?? '#4cc3ff'} ${myTurn ? 55 : 35}%, #0b1222), #0b1222 70%)` }}>
          <div className="relative flex items-center gap-3">
            <ClockRing frac={status === 'paused' ? 1 : remaining / ((league?.pick_seconds ?? 90) * 1000)} color={readable(team(current.team_id)?.color ?? '#4cc3ff')}>
              <TeamBadge team={team(current.team_id)} size={44} />
            </ClockRing>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Round {current.round} · Pick {current.overall} of {board.length}{current.team_id !== current.original_team && ` · via ${team(current.original_team)?.abbrev}`}</div>
              <div className="h-display truncate text-xl leading-tight">{myTurn ? <span className="text-white">⏰ Your pick!</span> : <TeamName team={team(current.team_id)} />}</div>
            </div>
            <div className={`num font-display text-5xl font-extrabold leading-none ${clockColor} ${remaining < 10_000 && status !== 'paused' ? 'animate-pulse' : ''}`}>{status === 'paused' ? '⏸' : countdown(remaining)}</div>
          </div>
          <div className="scroll-x mt-1.5 flex items-center gap-1.5 text-[11px] text-mute">
            <span className="shrink-0">Up next:</span>
            {upcoming.map((p) => <span key={p.id} className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${p.team_id === me?.id ? 'bg-sky-500/20 text-sky-200' : 'bg-boards'}`}><TeamBadge team={team(p.team_id)} size={14} />{team(p.team_id)?.gm_name}</span>)}
            {picksUntilMine != null && picksUntilMine > 0 && <span className="ml-auto shrink-0 text-sky-300">You pick in {picksUntilMine}</span>}
          </div>
        </div>
      ) : status === 'done' ? (
        <div className="border-b border-white/[.08] bg-gradient-to-r from-emerald-500/20 via-emerald-500/5 to-emerald-500/20 px-3 py-4 text-center">
          <div className="h-display text-gold-shine text-2xl">🏁 Draft complete</div>
          <div className="text-xs text-mute">{made} picks made. Set your lineup on My Team, then start chirping.</div>
          <button className="btn-gold btn-sm mt-2" onClick={() => setReport(true)}>📊 Draft report card</button>
        </div>
      ) : (
        <div className="p-3">{Lobby}</div>
      )}

      {/* commish controls */}
      {me?.is_commish && (status === 'live' || status === 'paused') && (
        <div className="flex gap-1.5 border-b border-line bg-rink/60 px-3 py-1.5">
          <span className="self-center text-[11px] text-mute">Commish:</span>
          {status === 'live' ? <button className="btn-ghost btn-sm" onClick={() => run(() => rpc('draft_pause'))}>⏸ Pause</button>
            : <button className="btn-ghost btn-sm" onClick={() => run(() => rpc('draft_resume'))}>▶️ Resume</button>}
          <button className="btn-ghost btn-sm" onClick={() => confirm('Undo the last pick?') && run(() => rpc('draft_undo'), 'Pick undone')}>↩️ Undo</button>
          {!myTurn && <span className="self-center text-[11px] text-mute">Tap a player → “Pick for team” to draft on someone’s behalf</span>}
        </div>
      )}

      {/* mobile tabs */}
      <div className="scroll-x flex gap-1 border-b border-line px-2 py-1.5 lg:hidden">
        {tabs.map((t) => <button key={t.k} className={`tab ${tab === t.k ? 'tab-on' : ''}`} onClick={() => setTab(t.k)}>{t.label}</button>)}
      </div>

      {/* phone: one tab at a time; desktop: players | board+queue | chat */}
      {!wide && <div className="flex min-h-0 flex-1">
        {tab === 'players' && PlayersTab}
        {tab === 'board' && BoardTab}
        {tab === 'queue' && QueueTab}
        {tab === 'team' && TeamTab}
        {tab === 'chat' && <ChatPanel channel="draft" compact className="flex-1" />}
      </div>}
      {wide && <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,360px)_minmax(0,1fr)_minmax(260px,320px)] gap-3 pt-3">
        <div className="card flex min-h-0 flex-col overflow-hidden">{PlayersTab}</div>
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="card flex min-h-0 flex-[3] flex-col overflow-hidden">{BoardTab}</div>
          <div className="card flex min-h-0 flex-[2] flex-col overflow-hidden">
            <div className="flex gap-1 border-b border-line p-1.5">
              <button className={`tab ${tab !== 'team' ? 'tab-on' : ''}`} onClick={() => setTab('queue')}>Queue</button>
              <button className={`tab ${tab === 'team' ? 'tab-on' : ''}`} onClick={() => setTab('team')}>My team</button>
            </div>
            {tab === 'team' ? TeamTab : QueueTab}
          </div>
        </div>
        <div className="card flex min-h-0 flex-col overflow-hidden"><div className="border-b border-line px-3 py-2 text-sm font-semibold">💬 Draft chat</div><ChatPanel channel="draft" compact className="flex-1" /></div>
      </div>}

      {/* pick announcement */}
      {flash && (() => {
        const p = players.get(flash.player_id!);
        return (
          <div className="pointer-events-none fixed inset-x-0 top-20 z-[65] flex justify-center px-4">
            <div className="animate-pop shine w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]"
              style={{ background: `radial-gradient(120% 100% at 0% 0%, ${team(flash.team_id)?.color}, #0b1222 70%)` }}>
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[.2em] text-white/80">
                <span>🚨 The pick is in</span><span className="num">#{flash.overall}{flash.auto ? ' · auto' : ''}</span>
              </div>
              <div className="flex items-center gap-4 p-4">
                <Headshot p={p} size={76} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-white/85"><TeamBadge team={team(flash.team_id)} size={18} />{team(flash.team_id)?.name} select</div>
                  <div className="h-display text-shine truncate text-3xl leading-none">{p?.name}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-white/70"><Pos p={p?.pos ?? 'C'} />{p?.nhl_team} · {fmtPts(p?.proj ?? 0, 0)} proj</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <Sheet open={report} onClose={() => setReport(false)} title="📊 Draft report card" wide><DraftReport onPlayer={(id) => { setReport(false); setDetail(id); }} /></Sheet>

      <PlayerSheet id={detail} onClose={() => setDetail(null)} actions={detail && !taken(detail) ? (
        <>
          {myTurn && <button className="btn-primary" disabled={busy} onClick={() => draftPlayer(players.get(detail)!)}>Draft {players.get(detail)?.last_name}</button>}
          {me?.is_commish && !myTurn && status === 'live' && (
            <button className="btn-ghost" disabled={busy} onClick={() => confirm(`Pick ${players.get(detail)?.name} for ${team(current?.team_id)?.name}?`) && draftPlayer(players.get(detail)!)}>🛠️ Pick for {team(current?.team_id)?.abbrev}</button>
          )}
          <button className="btn-ghost" onClick={() => toggleQueue(detail)}>{queue.includes(detail) ? '★ Queued' : '☆ Queue'}</button>
        </>
      ) : undefined} />
    </div>
  );
}
