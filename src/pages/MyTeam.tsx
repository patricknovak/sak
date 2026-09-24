import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { Player, Roster, Slot, Transaction } from '../lib/types';
import { ago, etToday, fmtPts, ordinal } from '../lib/format';
import { PlayerRow } from '../components/PlayerCard';
import { TeamScout } from '../components/TeamScout';
import { LineupTools, useOptimizer } from '../components/LineupTools';
import { Pos, Section, TeamBadge, TeamName, useAction } from '../components/ui';

const STARTERS: Slot[] = ['C', 'LW', 'RW', 'D', 'Util', 'G'];

const slotOk = (p: Player, s: Slot) =>
  s === 'BN' || s === 'IR' ? true : s === 'Util' ? p.pos !== 'G' : s === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(s);

export default function MyTeam() {
  const { id } = useParams();
  const { me, league, teams, team, rosters, players, standings, season, games, gamesByTeam, refresh } = useLeague();
  const now = useNow(15_000);
  const nav = useNavigate();
  const { busy, run } = useAction();
  const teamId = id ? Number(id) : me?.id;
  const t = team(teamId);
  const mine = teamId === me?.id;
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setView('scout'); setSel(null); }, [teamId]);
  const [today, setToday] = useState<Map<number, { fpts: number; stats: Record<string, number> }>>(new Map());
  const [tx, setTx] = useState<Transaction[]>([]);
  const [view, setView] = useState<'scout' | 'lineup'>('scout');
  const [tools, setTools] = useState(false);

  const roster = useMemo(() => rosters.filter((r) => r.team_id === teamId).map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p), [rosters, players, teamId]);

  const opt = useOptimizer(roster);
  const PIN_NEXT: Record<string, 'start' | 'bench' | null> = { none: 'start', start: 'bench', bench: null };
  const cyclePin = (x: { r: Roster; p: Player }) => {
    const next = PIN_NEXT[x.r.pin ?? 'none'];
    run(async () => { await rpc('set_pin', { p_player: x.p.id, p_pin: next }); await refresh(['rosters']); },
      next === 'start' ? `📌 ${x.p.name} always starts when he plays` : next === 'bench' ? `🚫 ${x.p.name} stays on the bench` : `${x.p.name} unpinned`);
  };

  const rosterKey = roster.map((x) => x.p.id).join(',');
  useEffect(() => {
    if (!roster.length) return;
    const load = () => supabase.from('player_games').select('player_id,fpts,stats').eq('date', etToday()).in('player_id', roster.map((x) => x.p.id))
      .then(({ data }) => setToday(new Map((data ?? []).map((d) => [d.player_id, { fpts: Number(d.fpts), stats: d.stats }]))));
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [rosterKey, teamId]);

  useEffect(() => {
    if (!teamId) return;
    supabase.from('transactions').select('*').eq('team_id', teamId).order('id', { ascending: false }).limit(15).then(({ data }) => setTx((data ?? []) as Transaction[]));
  }, [teamId, rosters.length]);

  // games left this week (through Sunday, Eastern) for position planning
  const weekEnd = (() => { const d = new Date(etToday() + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.toISOString().slice(0, 10); })();
  const weekGames = (nhl: string | null) => games.filter((g) => g.date >= etToday() && g.date <= weekEnd && (g.home === nhl || g.away === nhl)).length;

  const locked = (p: Player) => {
    const g = gamesByTeam(p.nhl_team);
    return !!g && new Date(g.start_utc).getTime() <= now && !['PPD', 'CNCL'].includes(g.state);
  };

  // lay out slot instances
  const cap = (league?.roster ?? {}) as Record<Slot, number>;
  const bySlot = (s: Slot) => roster.filter((x) => x.r.slot === s).sort((a, b) => b.p.proj - a.p.proj);
  const rows: { slot: Slot; x?: { r: Roster; p: Player } }[] = [];
  for (const s of STARTERS) {
    const occ = bySlot(s);
    for (let i = 0; i < Math.max(cap[s] ?? 0, occ.length); i++) rows.push({ slot: s, x: occ[i] });
  }
  const bench = bySlot('BN');
  const ir = bySlot('IR');
  const selected = roster.find((x) => x.p.id === sel);

  const canTarget = (slot: Slot, occupant?: { p: Player; r: Roster }) => {
    if (!selected || !mine) return false;
    if (occupant?.p.id === selected.p.id) return false;
    if (!slotOk(selected.p, slot)) return false;
    if (occupant && locked(occupant.p)) return false;
    if (!occupant && slot === selected.r.slot) return false;
    if (!occupant && slot !== 'BN' && slot !== 'IR' && bySlot(slot).length >= (cap[slot] ?? 0)) return false;
    return true;
  };

  const tap = (slot: Slot, x?: { r: Roster; p: Player }) => {
    if (!mine || league?.phase === 'keepers') { if (x) nav(`/player/${x.p.id}`); return; }
    if (selected) {
      if (x?.p.id === selected.p.id) { setSel(null); return; }
      if (canTarget(slot, x)) {
        const who = selected.p;
        setSel(null);
        run(async () => { await rpc('move_player', { p_player: who.id, p_slot: slot, p_swap: x?.p.id ?? null }); await refresh(['rosters']); });
        return;
      }
      if (x && !locked(x.p)) { setSel(x.p.id); return; }
      setSel(null);
      return;
    }
    if (x) {
      if (locked(x.p)) { nav(`/player/${x.p.id}`); return; }
      setSel(x.p.id);
    }
  };

  const st = standings.find((s) => s.team_id === teamId);
  // before the season there's no lineup to set: show the roster with last season's numbers
  const offseason = league?.phase !== 'season';
  const anyStarter = rows.some((r) => r.x);
  const todayTotal = rows.filter((r) => r.x).reduce((tot, r) => tot + (today.get(r.x!.p.id)?.fpts ?? 0), 0);
  const benchedWithGames = bench.filter((x) => gamesByTeam(x.p.nhl_team) && !locked(x.p));
  const emptyStarters = rows.filter((r) => !r.x).length;

  const Row = ({ slot, x }: { slot: Slot; x?: { r: Roster; p: Player } }) => {
    const isSel = x && x.p.id === sel;
    const target = canTarget(slot, x);
    const g = x ? gamesByTeam(x.p.nhl_team) : undefined;
    const tp = x ? today.get(x.p.id) : undefined;
    const lk = x && locked(x.p);
    return (
      <div onClick={() => tap(slot, x)}
        className={`flex cursor-pointer items-center gap-2 px-2.5 py-2 transition ${isSel ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400' : target ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/60' : ''}`}>
        <Pos p={slot} className="w-10" />
        {x ? (
          <>
            <div className="min-w-0 flex-1"><PlayerRow p={x.p} dim={slot !== 'BN' && slot !== 'IR' && !g} /></div>
            {lk && <span title="Locked: game started" className="text-xs">🔒</span>}
            {mine && !offseason && (
              <button aria-label={`Pin ${x.p.name}`} title={x.r.pin === 'start' ? 'Pinned: always start' : x.r.pin === 'bench' ? 'Pinned: never start' : 'Pin: tap to always start / never start'}
                onClick={(e) => { e.stopPropagation(); cyclePin(x); }}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs transition hover:bg-white/10 ${x.r.pin ? '' : 'opacity-30'}`}>
                {x.r.pin === 'start' ? '📌' : x.r.pin === 'bench' ? '🚫' : '📍'}
              </button>
            )}
            <div className="min-w-14 shrink-0 text-right">
              <div className={`text-sm font-semibold ${tp && tp.fpts > 0 ? 'text-emerald-300' : ''}`}>{tp ? fmtPts(tp.fpts, 1) : g ? '–' : ''}</div>
              {offseason
                ? <div className="whitespace-nowrap text-[10px] text-mute">{fmtPts(x.p.last_fp, 0)} ’25-26</div>
                : <div className="whitespace-nowrap text-[10px] text-mute">{fmtPts(season.get(x.p.id)?.fpts ?? 0, 0)} szn · {weekGames(x.p.nhl_team)}g</div>}
            </div>
          </>
        ) : (
          <div className={`flex-1 text-sm ${target ? 'font-semibold text-emerald-300' : 'text-mute'}`}>{target ? 'Move here' : 'Empty'}</div>
        )}
      </div>
    );
  };

  if (!t) return null;
  return (
    <div className="space-y-4">
      <div className="card-hero flex flex-wrap items-center gap-3 p-4" style={{ '--tc': t.color } as React.CSSProperties}>
        <div className="pointer-events-none absolute -right-4 -top-6 select-none text-[120px] leading-none opacity-[.08]">{t.emoji}</div>
        <TeamBadge team={t} size={56} ring />
        <div className="relative min-w-0 flex-1">
          <h1 className="h-display text-shine truncate text-[28px] leading-tight">{t.name}</h1>
          <div className="text-xs text-white/70">GM {t.gm_name}{st && league?.phase === 'season' && <> · {ordinal(st.rank)} · {fmtPts(st.points)} pts · {st.moves}/{league?.max_acquisitions} pickups</>}</div>
          {t.motto && <div className="truncate text-xs italic text-white/60">“{t.motto}”</div>}
        </div>
        <select aria-label="View team" className="relative w-full rounded-xl border border-white/15 bg-black/30 px-2 py-1.5 text-sm backdrop-blur sm:w-auto" value={teamId} onChange={(e) => nav(Number(e.target.value) === me?.id ? '/team' : `/team/${e.target.value}`)}>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.id === me?.id ? '🏠 My team' : `${x.emoji} ${x.name}`}</option>)}
        </select>
      </div>

      {mine && league?.phase === 'season' && (
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1 text-sm">
            <div><span className="font-semibold">Today: {fmtPts(todayTotal)} pts</span> <span className="text-mute">· tap a player, then tap where he should go</span></div>
            {benchedWithGames.length > 0 && <div className="text-xs text-amber-300">⚠️ {benchedWithGames.length} benched player{benchedWithGames.length > 1 ? 's' : ''} playing today</div>}
            {emptyStarters > 0 && <div className="text-xs text-amber-300">⚠️ {emptyStarters} empty starting slot{emptyStarters > 1 ? 's' : ''}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-blue" disabled={busy || opt.busy} onClick={() => opt.apply(opt.plan('day'), 'today')}>✨ Optimize today</button>
            <button className="btn-ghost" onClick={() => setTools(true)}>⚙️ Lineup tools</button>
          </div>
          <div className="w-full text-xs text-mute">
            Auto-pilot: <button className="font-semibold text-sky-300 hover:underline" onClick={() => setTools(true)}>{me?.auto_mode && me.auto_mode !== 'off' ? `${me.auto_mode} mode · ${{ proj: 'projection', form: 'hot hand', season: 'season avg' }[me.auto_basis ?? 'proj']}` : 'off'}</button>
            {roster.some((x) => x.r.pin) && <> · {roster.filter((x) => x.r.pin).length} pinned</>}
          </div>
        </div>
      )}
      {mine && league?.phase !== 'season' && league?.phase !== 'keepers' && (
        <button className="card flex w-full items-center gap-3 p-3 text-left text-sm" onClick={() => setTools(true)}>
          <span className="text-2xl">⚙️</span>
          <span className="flex-1"><span className="font-semibold">Lineup tools</span><span className="block text-xs text-mute">Auto-pilot {me?.auto_mode && me.auto_mode !== 'off' ? `on (${me.auto_mode} mode)` : 'off'}: set it now and it takes over on opening night</span></span>
          <span className="text-mute">›</span>
        </button>
      )}
      {mine && <LineupTools open={tools} onClose={() => setTools(false)} roster={roster} />}
      {league?.phase === 'keepers' && mine && (
        <Link to="/keepers" className="card block bg-amber-500/10 p-3 text-sm text-amber-100">🔒 It’s keeper season: this is your 2025-26 roster. Pick who you keep →</Link>
      )}

      {!mine && (
        <div className="flex gap-1">
          <button className={`tab ${view === 'scout' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setView('scout')}>🔍 Scout & trade</button>
          <button className={`tab ${view === 'lineup' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setView('lineup')}>🏒 Lineup</button>
        </div>
      )}
      {!mine && view === 'scout' ? <TeamScout teamId={t.id} /> : <>
      <div className="grid gap-4 lg:grid-cols-2">
        {(!offseason || anyStarter) && (
          <Section title="Starters">
            <div className="card divide-y divide-white/[.06] overflow-hidden">{rows.map((r, i) => <Fragment key={i}>{Row({ slot: r.slot, x: r.x })}</Fragment>)}</div>
          </Section>
        )}
        <div className="space-y-4">
          <Section title={offseason && !anyStarter ? `Roster (${bench.length})` : `Bench (${bench.length}/${cap.BN ?? 12})`}>
            <div className="card divide-y divide-white/[.06] overflow-hidden">
              {bench.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'BN', x })}</Fragment>)}
              {selected && selected.r.slot !== 'BN' && Row({ slot: 'BN' })}
              {bench.length === 0 && !selected && <div className="p-3 text-sm text-mute">Empty bench.</div>}
            </div>
          </Section>
          <Section title={`IR (${ir.length}/${cap.IR ?? 2})`}>
            <div className="card divide-y divide-white/[.06] overflow-hidden">
              {ir.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'IR', x })}</Fragment>)}
              {selected && selected.r.slot !== 'IR' && ir.length < (cap.IR ?? 2) && Row({ slot: 'IR' })}
              {ir.length === 0 && !selected && <div className="p-3 text-xs text-mute">Injured players only (honour system; the commish is watching).</div>}
            </div>
          </Section>
          <Section title="Transactions">
            <div className="card divide-y divide-white/[.06]">
              {tx.length === 0 && <div className="p-3 text-sm text-mute">None yet.</div>}
              {tx.map((x) => (
                <div key={x.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span>{{ add: '➕', drop: '➖', trade: '🔄', draft: '📋', keeper: '🔒', release: '↩️', commish: '🛠️' }[x.type] ?? '•'}</span>
                  <span className="flex-1 truncate"><Link className="hover:underline" to={`/player/${x.player_id}`}>{players.get(x.player_id ?? 0)?.name}</Link> <span className="text-mute">{x.type}{x.other_team ? ` from ${team(x.other_team)?.abbrev}` : ''}{x.fee ? ` ($${x.fee})` : ''}</span></span>
                  <span className="text-xs text-mute">{ago(x.created_at, now)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
      {mine && <TeamScout teamId={t.id} hideRoster />}
      {!mine && <div className="text-center text-sm"><Link className="text-sky-300" to={`/trades?with=${teamId}`}>🔄 Propose a trade with <TeamName team={t} /></Link></div>}
      </>}
    </div>
  );
}
