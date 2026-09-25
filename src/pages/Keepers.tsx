import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtDateTime, fmtPts } from '../lib/format';
import { PlayerRow, usePlayerSheet } from '../components/PlayerCard';
import { Section, TeamBadge, TeamName, useAction, PageHeader, Countdown } from '../components/ui';
import { Lock } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function Keepers() {
  const { me, league, teams, rosters, players, team, refresh } = useLeague();
  const now = useNow(1000);
  const { busy, run } = useAction();
  const { open, sheet } = usePlayerSheet();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const phase = league?.phase;
  const max = league?.keepers ?? 6;

  const mine = useMemo(() => rosters.filter((r) => r.team_id === me?.id)
    .map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p)
    .sort((a, b) => (b.r.prev_fp ?? 0) - (a.r.prev_fp ?? 0)), [rosters, players, me]);
  // same rule as the server's top_scorer(): highest 2025-26 points, ties to the lower player id
  const top = league?.top_scorer_rule
    ? mine.filter((x) => x.r.prev_fp != null).sort((a, b) => b.r.prev_fp! - a.r.prev_fp! || a.p.id - b.p.id)[0]?.r.player_id
    : undefined;

  useEffect(() => {
    setSel(new Set(mine.filter((x) => x.r.keeper).map((x) => x.r.player_id)));
  }, [mine.map((x) => `${x.r.player_id}:${x.r.keeper}`).join()]);

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

      <div className="card divide-y divide-white/[.06] overflow-hidden">
        {mine.map(({ r, p }) => {
          const on = sel.has(p.id);
          const banned = p.id === top;
          return (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 transition ${on ? 'bg-gradient-to-r from-emerald-500/15 to-transparent shadow-[inset_3px_0_0_#34d399]' : ''} ${banned ? 'bg-red-500/[.05]' : ''}`}>
              <button disabled={banned || closed} onClick={() => toggle(p.id)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-sm font-bold transition ${on ? 'animate-pop border-emerald-300 bg-gradient-to-b from-emerald-300 to-emerald-500 text-ice shadow-[0_0_14px_-2px_rgba(52,211,153,.8)]' : 'border-white/15 bg-white/[.03]'} ${banned ? 'opacity-50' : ''}`}>
                {banned ? '🚫' : on ? '✓' : ''}
              </button>
              <div className="min-w-0 flex-1">
                <PlayerRow p={p} onClick={() => open(p.id)}
                  sub={banned ? <span className="ml-1 font-semibold text-red-300" title="Top scorer: goes back into the draft">· can’t keep</span> : undefined} />
              </div>
              <div className="w-20 text-right">
                <div className="num text-sm font-bold">{fmtPts(r.prev_fp)}</div>
                <div className="text-[10px] text-mute">proj {fmtPts(p.proj, 0)}</div>
              </div>
            </div>
          );
        })}
      </div>

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
