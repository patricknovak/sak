import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { countdown, fmtDateTime, fmtPts } from '../lib/format';
import { PlayerRow, usePlayerSheet } from '../components/PlayerCard';
import { Section, TeamBadge, TeamName, useAction } from '../components/ui';

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

  if (phase !== 'keepers') {
    // keepers are final: show everyone's
    return (
      <div className="space-y-4">
        <h1 className="h-display text-2xl">{league?.season} Keepers</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => {
            const ks = rosters.filter((r) => r.team_id === t.id && r.acquired === 'keeper').map((r) => players.get(r.player_id)!).filter(Boolean)
              .sort((a, b) => b.proj - a.proj);
            return (
              <div key={t.id} className="card p-3">
                <div className="mb-2 flex items-center gap-2"><TeamBadge team={t} size={26} /><TeamName team={t} /><span className="ml-auto text-xs text-mute">{t.gm_name}</span></div>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h-display text-2xl">Pick your keepers</h1>
          <p className="text-sm text-mute">Keep up to {max} from your 2025-26 roster. Everyone else goes back in the pool for the draft.</p>
        </div>
        {deadline && (
          <div className="text-right">
            <div className="label">Deadline</div>
            <div className="font-display text-2xl font-bold">{countdown(deadline - now)}</div>
            <div className="text-xs text-mute">{fmtDateTime(league!.keeper_deadline!)}</div>
          </div>
        )}
      </div>

      <div className="sticky top-[calc(3rem+var(--banner,0px))] z-20 -mx-3 flex items-center gap-3 border-y border-line bg-ice/95 px-3 py-2 backdrop-blur lg:top-[var(--banner,0px)]">
        <div className="flex gap-1">
          {Array.from({ length: max }).map((_, i) => (
            <span key={i} className={`h-3 w-6 rounded-full ${i < sel.size ? 'bg-emerald-400' : 'bg-boards'}`} />
          ))}
        </div>
        <span className="text-sm font-semibold">{sel.size}/{max}</span>
        <div className="flex-1" />
        <button className="btn-primary" disabled={busy || closed || !dirty}
          onClick={() => run(async () => { await rpc('set_keepers', { p_players: [...sel] }); await refresh(['rosters', 'teams']); }, 'Keepers locked in 🔒')}>
          {closed ? 'Closed' : dirty ? 'Save keepers' : me?.keepers_submitted ? 'Saved ✓' : 'Save keepers'}
        </button>
      </div>

      <div className="card divide-y divide-line">
        {mine.map(({ r, p }) => {
          const on = sel.has(p.id);
          const banned = p.id === top;
          return (
            <div key={p.id} className={`flex items-center gap-2 px-3 py-2.5 ${on ? 'bg-emerald-500/10' : ''}`}>
              <button disabled={banned || closed} onClick={() => toggle(p.id)}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-sm ${on ? 'border-emerald-400 bg-emerald-500 text-ice' : 'border-line'} ${banned ? 'opacity-40' : ''}`}>
                {banned ? '🚫' : on ? '✓' : ''}
              </button>
              <div className="min-w-0 flex-1">
                <PlayerRow p={p} onClick={() => open(p.id)}
                  sub={banned ? <span className="ml-1 font-semibold text-red-300">· top scorer, returns to draft</span> : undefined} />
              </div>
              <div className="w-20 text-right">
                <div className="text-sm font-semibold">{fmtPts(r.prev_fp)}</div>
                <div className="text-[10px] text-mute">proj {fmtPts(p.proj, 0)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Section title="Who's locked in">
        <div className="card grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-rink px-3 py-2.5">
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
