import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtDateTime, fmtPts } from '../lib/format';
import { PlayerRow, usePlayerSheet } from '../components/PlayerCard';
import { PlayerFilterBar, StatTable, usePlayerFilter } from '../components/PlayerFilters';
import { lineFor } from '../lib/playerstats';
import { comingAvailable } from '../lib/keepers';
import { Pos } from '../components/ui';
import type { Player } from '../lib/types';
import { Section, TeamBadge, TeamName, useAction, PageHeader, Countdown } from '../components/ui';
import { Lock } from 'lucide-react';
import { KeeperReport } from '../components/KeeperReport';
import confetti from 'canvas-confetti';

export default function Keepers() {
  const { me, league, teams, rosters, players, team, refresh } = useLeague();
  const now = useNow(1000);
  const { busy, run } = useAction();
  const { open, sheet } = usePlayerSheet();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<'last' | 'proj' | 'pg' | 'pos'>('last');
  const [view, setView] = useState<'list' | 'table'>('list');
  const pf = usePlayerFilter({ tf: 'last' });
  const phase = league?.phase;
  const max = league?.keepers ?? 6;
  const coming = useMemo(() => comingAvailable(players, rosters, league).filter((p) => rosters.find((r) => r.player_id === p.id)?.team_id !== me?.id), [players, rosters, league, me?.id]);

  const mineRaw = useMemo(() => rosters.filter((r) => r.team_id === me?.id)
    .map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p), [rosters, players, me]);
  // rank at his position across the whole pool, and roughly where he'd go if he went back in the draft
  const posRank = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const p of players.values()) by.set(p.pos, [...(by.get(p.pos) ?? []), p.proj]);
    for (const v of by.values()) v.sort((a, b) => b - a);
    return (p: Player) => (by.get(p.pos)?.findIndex((v) => v <= p.proj) ?? -1) + 1;
  }, [players]);
  const nTeams = Math.max(1, teams.length);
  const draftRound = (p: Player) => (p.rank ? Math.max(1, Math.ceil(p.rank / nTeams)) : null);
  const pgLast = (p: Player) => { const gp = p.last_stats?.gp; return gp ? p.last_fp / gp : 0; };
  const POS_ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };
  const mine = useMemo(() => [...mineRaw].sort((a, b) =>
    sort === 'proj' ? b.p.proj - a.p.proj
    : sort === 'pg' ? pgLast(b.p) - pgLast(a.p)
    : sort === 'pos' ? (POS_ORDER[a.p.pos] - POS_ORDER[b.p.pos]) || b.p.proj - a.p.proj
    : (b.r.prev_fp ?? 0) - (a.r.prev_fp ?? 0)), [mineRaw, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  // same rule as the server's top_scorer(): highest 2025-26 points, ties to the lower player id
  const top = league?.top_scorer_rule
    ? mine.filter((x) => x.r.prev_fp != null).sort((a, b) => b.r.prev_fp! - a.r.prev_fp! || a.p.id - b.p.id)[0]?.r.player_id
    : undefined;

  useEffect(() => {
    setSel(new Set(mine.filter((x) => x.r.keeper).map((x) => x.r.player_id)));
  }, [mine.map((x) => `${x.r.player_id}:${x.r.keeper}`).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggested keepers: best projections, at most two goalies (only two start), never the banned top scorer
  const suggested = useMemo(() => {
    const out: number[] = []; let g = 0;
    for (const x of [...mineRaw].sort((a, b) => b.p.proj - a.p.proj)) {
      if (x.p.id === top || out.length >= max) continue;
      if (x.p.pos === 'G') { if (g >= 2) continue; g++; }
      out.push(x.p.id);
    }
    return out;
  }, [mineRaw, top, max]);
  const selPlayers = mineRaw.filter((x) => sel.has(x.p.id)).map((x) => x.p);
  const posCount = (ps: Player[], k: string) => ps.filter((p) => p.pos === k).length;
  const selProj = selPlayers.reduce((t, p) => t + p.proj, 0);
  const sugProj = mineRaw.filter((x) => suggested.includes(x.p.id)).reduce((t, x) => t + x.p.proj, 0);
  const warnings: string[] = [];
  if (posCount(selPlayers, 'G') > 2) warnings.push(`${posCount(selPlayers, 'G')} goalies: only two start`);
  for (const p of selPlayers) if (p.injury_status && /out|ir|long/i.test(p.injury_status)) warnings.push(`${p.name} is listed ${p.injury_status}`);
  const lastLine = (p: Player) => {
    const l = lineFor(p, 'last');
    if (!l || !l.gp) return 'no games last season';
    const t = l.totals;
    return p.pos === 'G'
      ? `${l.gp} GP · ${t.w ?? 0}-${t.l ?? 0}-${t.otl ?? 0} · ${t.sa ? ((t.sv ?? 0) / t.sa).toFixed(3).replace(/^0/, '') : '–'} SV% · ${((t.ga ?? 0) / l.gp).toFixed(2)} GAA`
      : `${l.gp} GP · ${t.g ?? 0} G ${t.a ?? 0} A · ${t.pm != null && t.pm > 0 ? '+' : ''}${t.pm ?? 0} · ${t.sog ?? 0} SOG · ${t.hit ?? 0} H ${t.blk ?? 0} B`;
  };
  const tableList = useMemo(() => pf.apply(mineRaw.map((x) => x.p)), [pf.apply, mineRaw]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute hover:text-slate-200'}`;

  const toggle = (id: number) => {
    if (id === top) return;
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else if (n.size < max) n.add(id);
    setSel(n);
  };
  const deadline = league?.keeper_deadline ? new Date(league.keeper_deadline).getTime() : null;
  const closed = phase !== 'keepers' || (deadline != null && now > deadline && !me?.is_commish);
  const dirty = mine.some((x) => x.r.keeper !== sel.has(x.r.player_id));

  if (phase === 'keepers' && me?.role === 'spectator') {
    return (
      <div className="space-y-4">
        <PageHeader icon={<Lock size={22} className="text-gold" />} title="Keepers" sub="Being picked right now" />
        <div className="card p-5 text-sm text-mute">Every GM keeps up to {max} players from last season. Their picks stay secret until the commish finalizes them{deadline ? ` after ${fmtDateTime(league!.keeper_deadline!)}` : ''}, then they show up here.</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {teams.map((t) => (
            <div key={t.id} className={`card flex items-center gap-2 px-3 py-2.5 ${t.keepers_submitted ? 'border-emerald-400/30' : ''}`}>
              <TeamBadge team={t} size={24} /><div className="min-w-0 flex-1 truncate text-sm">{t.gm_name}</div><span>{t.keepers_submitted ? '✅' : '⏳'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (phase !== 'keepers') {
    // keepers are final: show everyone's
    return (
      <div className="space-y-4">
        <PageHeader icon={<Lock size={22} className="text-gold" />} title="Keepers" sub={`${league?.season} · locked in and revealed`} />
        <KeeperReport onPlayer={open} />
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => {
            const ks = rosters.filter((r) => r.team_id === t.id && r.acquired === 'keeper').map((r) => players.get(r.player_id)!).filter(Boolean)
              .sort((a, b) => b.proj - a.proj);
            return (
              <div key={t.id} className="card p-3">
                <div className="mb-2 flex items-center gap-2"><TeamBadge team={t} size={26} /><TeamName link team={t} /><span className="ml-auto text-xs text-mute">{t.gm_name}</span></div>
                <div className="space-y-2">{ks.map((p) => <PlayerRow key={p.id} p={p} onClick={() => open(p.id)} right={<span className="text-xs text-mute">{fmtPts(p.proj, 0)}</span>} />)}</div>
              </div>
            );
          })}
        </div>
        {sheet}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card-hero p-4" style={{ '--tc': me?.color ?? '#f7c548' } as React.CSSProperties}>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="label flex items-center gap-1.5 text-white/70"><Lock size={12} /> Keeper selection</div>
            <h1 className="h-display text-shine mt-1 text-3xl leading-none">Pick your keepers</h1>
            <p className="mt-1.5 max-w-md text-sm text-white/70">Keep up to {max} from your 2025-26 roster. Everyone else goes back in the pool for the draft.</p>
          </div>
          {deadline && (
            <div>
              <div className="label mb-1.5 text-white/70">Deadline</div>
              <Countdown ms={deadline - now} size="md" />
              <div className="mt-1 text-xs text-white/60">{fmtDateTime(league!.keeper_deadline!)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="sticky top-[calc(3rem+var(--banner,0px))] z-20 -mx-3 flex items-center gap-3 border-y border-white/[.07] bg-[#070c18]/80 px-3 py-2.5 backdrop-blur-xl lg:top-[var(--banner,0px)]">
        <div className="flex gap-1">
          {Array.from({ length: max }).map((_, i) => (
            <span key={i} className={`h-3 w-6 rounded-full transition-all duration-300 ${i < sel.size ? 'bg-gradient-to-b from-emerald-300 to-emerald-500 shadow-[0_0_10px_rgba(52,211,153,.7)]' : 'bg-white/[.08]'}`} />
          ))}
        </div>
        <span className="num text-sm font-bold">{sel.size}/{max}</span>
        <div className="flex-1" />
        <button className="btn-primary" disabled={busy || closed || !dirty}
          onClick={() => run(async () => {
            await rpc('set_keepers', { p_players: [...sel] }); await refresh(['rosters', 'teams']);
            try { confetti({ particleCount: 120, spread: 90, origin: { y: 0.3 }, colors: [me?.color ?? '#ef2a4f', '#ffffff', '#f7c548'], disableForReducedMotion: true, zIndex: 70 }); } catch { /* no canvas */ }
          }, 'Keepers locked in 🔒')}>
          {closed ? 'Closed' : dirty ? 'Save keepers' : me?.keepers_submitted ? 'Saved ✓' : 'Save keepers'}
        </button>
      </div>

      {/* keeper tools: suggestion, balance, sort and a full stats table */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold">🧠 Keeper helper</div>
            <div className="text-xs text-mute">Best {max} by projection (max two goalies) add up to <span className="num font-semibold text-slate-200">{fmtPts(sugProj, 0)}</span> projected points{sel.size > 0 && <> · your {sel.size} pick{sel.size > 1 ? 's' : ''}: <span className="num font-semibold text-slate-200">{fmtPts(selProj, 0)}</span></>}. Rd = about where he’d go if you let him back into the draft.</div>
          </div>
          <button className="btn-ghost btn-sm" disabled={closed} onClick={() => setSel(new Set(suggested))}>✨ Use suggested {max}</button>
          {sel.size > 0 && <button className="btn-ghost btn-sm" disabled={closed} onClick={() => setSel(new Set())}>Clear</button>}
        </div>
        {sel.size > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {['C', 'LW', 'RW', 'D', 'G'].map((k) => <span key={k} className="flex items-center gap-1 rounded-full bg-white/[.05] px-2 py-0.5"><Pos p={k} className="min-w-0 px-1 py-0" /><span className="num font-semibold">{posCount(selPlayers, k)}</span></span>)}
            {warnings.map((w) => <span key={w} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-200">⚠️ {w}</span>)}
          </div>
        )}
        <div className="scroll-x mt-2 flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-mute">Sort</span>
          {([['last', '’25-26 pts'], ['proj', 'Projection'], ['pg', 'Pts / game'], ['pos', 'Position']] as const).map(([k, l]) => <button key={k} className={chip(sort === k)} onClick={() => setSort(k)}>{l}</button>)}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <button className={chip(view === 'list')} onClick={() => setView('list')}>List</button>
          <button className={chip(view === 'table')} onClick={() => setView('table')}>All stats</button>
        </div>
      </div>

      {view === 'table' ? (
        <div className="space-y-2">
          <PlayerFilterBar pf={pf} compact hideSearch />
          <StatTable list={tableList} pf={pf} onPlayer={open} badge={(p) => sel.has(p.id) ? <span className="ml-1 rounded bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-200">KEEP</span> : p.id === top ? <span className="ml-1 rounded bg-red-500/20 px-1 text-[10px] font-bold text-red-200">TOP</span> : null} />
          <p className="px-1 text-xs text-mute">Tap a player for his page. Switch back to List to tick your keepers.</p>
        </div>
      ) : (
      <div className="card divide-y divide-white/[.06] overflow-hidden">
        {mine.map(({ r, p }) => {
          const on = sel.has(p.id);
          const banned = p.id === top;
          const rd = draftRound(p);
          const delta = p.proj - p.last_fp;
          return (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 transition ${on ? 'bg-gradient-to-r from-emerald-500/15 to-transparent shadow-[inset_3px_0_0_#34d399]' : ''} ${banned ? 'bg-red-500/[.05]' : ''}`}>
              <button disabled={banned || closed} onClick={() => toggle(p.id)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-sm font-bold transition ${on ? 'animate-pop border-emerald-300 bg-gradient-to-b from-emerald-300 to-emerald-500 text-ice shadow-[0_0_14px_-2px_rgba(52,211,153,.8)]' : 'border-white/15 bg-white/[.03]'} ${banned ? 'opacity-50' : ''}`}>
                {banned ? '🚫' : on ? '✓' : ''}
              </button>
              <div className="min-w-0 flex-1 overflow-hidden">
                <PlayerRow p={p} onClick={() => open(p.id)}
                  sub={banned ? <span className="ml-1 font-semibold text-red-300" title="Top scorer: goes back into the draft">· can’t keep</span> : undefined} />
                <div className="num mt-0.5 truncate pl-12 text-[10px] text-slate-400">{lastLine(p)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-12 text-[10px]">
                  {p.rank && <span className="rounded bg-white/[.06] px-1 text-mute" title="Projection rank, all players">#{p.rank} overall</span>}
                  <span className="rounded bg-white/[.06] px-1 text-mute" title="Projection rank at his position">{p.pos} #{posRank(p)}</span>
                  {rd && <span className={`rounded px-1 ${rd <= 3 ? 'bg-emerald-500/20 text-emerald-200' : rd <= 8 ? 'bg-white/[.06] text-slate-300' : 'bg-white/[.06] text-mute'}`} title="About where he’d be drafted if you let him go">≈ Rd {rd}</span>}
                  {suggested.includes(p.id) && !on && <span className="rounded bg-sky-500/20 px-1 text-sky-200">suggested</span>}
                  {Math.abs(delta) >= 15 && <span className={`rounded px-1 ${delta > 0 ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`} title="Projection vs last season">{delta > 0 ? '▲' : '▼'} {fmtPts(Math.abs(delta), 0)} vs ’25-26</span>}
                </div>
              </div>
              <div className="w-20 shrink-0 text-right">
                <div className="num text-sm font-bold">{fmtPts(r.prev_fp)}</div>
                <div className="text-[10px] text-mute">proj {fmtPts(p.proj, 0)}</div>
                {(p.last_stats?.gp ?? 0) > 0 && <div className="num text-[10px] text-mute">{pgLast(p).toFixed(2)}/gp</div>}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {coming.length > 0 && (
        <Section title="Top players coming available" right={<Link to="/players?who=coming" className="text-xs text-sky-300">All {coming.length} →</Link>}>
          <p className="mb-2 px-1 text-xs text-mute">Every team’s top scorer from last season goes back in the pool, so these are sure things for draft night. Plan your keepers around who’ll be there.</p>
          <div className="card divide-y divide-white/[.06]">
            {coming.slice(0, 8).map((p, i) => {
              const from = team(rosters.find((r) => r.player_id === p.id)?.team_id ?? 0);
              return (
                <div key={p.id} className="flex items-center gap-2 px-2.5 py-2">
                  <span className="w-5 text-center text-[11px] text-mute">{i + 1}</span>
                  <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => open(p.id)} sub={from ? <span className="ml-1 text-[10px] text-mute">· {from.name}</span> : undefined} /></div>
                  <div className="w-16 text-right"><div className="num text-sm font-semibold">{fmtPts(p.proj, 0)}</div><div className="text-[10px] text-mute">proj</div></div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <KeeperReport onPlayer={open} />

      <Section title="Who's locked in">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {teams.map((t) => (
            <div key={t.id} className={`card flex items-center gap-2 px-3 py-2.5 ${t.keepers_submitted ? 'border-emerald-400/30' : ''}`}>
              <TeamBadge team={t} size={24} />
              <div className="min-w-0 flex-1 truncate text-sm">{t.gm_name}</div>
              <span>{t.keepers_submitted ? '✅' : '⏳'}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">
          Teams that don’t submit get their top {max} eligible players by last season’s points. Keepers are revealed when the commish finalizes them.
          {' '}{team(me?.id)?.is_commish && <Link to="/commish" className="text-sky-300">Finalize in Commissioner tools →</Link>}
        </p>
      </Section>
      {sheet}
    </div>
  );
}
