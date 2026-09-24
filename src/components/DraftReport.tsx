import { useMemo } from 'react';
import { useLeague } from '../lib/store';
import type { Player } from '../lib/types';
import { fmtPts } from '../lib/format';
import { gradeColor, gradeTeams, pickValues } from '../lib/grades';
import { PlayerRow } from './PlayerCard';
import { Section, TeamBadge, TeamName } from './ui';

// the real draft's report card: league-relative grades from keepers + picks, steals and reaches
export function DraftReport({ onPlayer }: { onPlayer?: (id: number) => void }) {
  const { teams, team, players, rosters, picks, draft, me } = useLeague();
  const data = useMemo(() => {
    const board = picks.filter((p) => p.season === draft?.season && p.player_id && p.overall);
    const kept = rosters.filter((r) => r.acquired === 'keeper');
    const keptIds = new Set(kept.map((r) => r.player_id));
    const pool = [...players.values()].filter((p) => !keptIds.has(p.id)).sort((a, b) => b.proj - a.proj);
    const poolRank = new Map(pool.map((p, i) => [p.id, i + 1]));
    const byTeam = new Map<number, Player[]>(teams.map((t) => [t.id, []]));
    for (const r of kept) { const p = players.get(r.player_id); if (p) byTeam.get(r.team_id)?.push(p); }
    const made = board.map((b) => ({ overall: b.overall!, team: b.team_id, player: players.get(b.player_id!)! })).filter((x) => x.player);
    for (const m of made) byTeam.get(m.team)?.push(m.player);
    const values = pickValues(made, poolRank);
    const steals = [...values].sort((a, b) => b.value - a.value).slice(0, 3);
    const reaches = [...values].filter((v) => v.overall <= 48).sort((a, b) => a.value - b.value).slice(0, 3);
    const bestPick = new Map<number, (typeof values)[number]>();
    for (const v of values) if (!bestPick.has(v.team) || v.value > bestPick.get(v.team)!.value) bestPick.set(v.team, v);
    return { grades: gradeTeams(byTeam), steals, reaches, bestPick, made: made.length };
  }, [teams, players, rosters, picks, draft?.season]);

  if (!data.made) return <div className="card p-4 text-sm text-mute">The report card appears once picks are made.</div>;
  const table = [...data.grades.values()].sort((a, b) => a.rank - b.rank);
  const Pick = ({ v, tone }: { v: (typeof data.steals)[number]; tone: 'good' | 'bad' }) => (
    <div className="px-3 py-2">
      <PlayerRow p={v.player} onClick={() => onPlayer?.(v.player.id)} sub={<span className="ml-1">· {team(v.team)?.gm_name}</span>}
        right={<div className="text-right text-xs"><div className="font-bold">#{v.overall}</div><div className={tone === 'good' ? 'text-emerald-300' : 'text-amber-300'}>{v.value > 0 ? `+${v.value}` : v.value} vs rank</div></div>} />
    </div>
  );
  return (
    <div className="space-y-4">
      <Section title="Draft grades">
        <div className="card divide-y divide-white/[.06]">
          {table.map((g) => {
            const best = data.bestPick.get(g.team);
            return (
              <div key={g.team} className={`flex items-center gap-3 px-3 py-2.5 ${g.team === me?.id ? 'bg-white/[.05]' : ''}`}>
                <span className="num w-5 text-center font-display text-lg text-mute">{g.rank}</span>
                <TeamBadge team={team(g.team)} size={32} />
                <div className="min-w-0 flex-1">
                  <TeamName link team={team(g.team)} className="block truncate text-sm" />
                  <div className="truncate text-[11px] text-mute">{fmtPts(g.starterPts, 0)} proj starters{best ? ` · best pick: ${best.player.last_name} #${best.overall}` : ''}</div>
                </div>
                <div className={`h-display text-3xl ${gradeColor(g.grade)}`}>{g.grade}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-1 px-1 text-xs text-mute">Grades compare each team’s best projected lineup (keepers + picks, with a little credit for depth) against the league.</p>
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="🥷 Steals"><div className="card divide-y divide-white/[.06]">{data.steals.map((v) => <Pick key={v.overall} v={v} tone="good" />)}</div></Section>
        <Section title="🚨 Reaches"><div className="card divide-y divide-white/[.06]">{data.reaches.map((v) => <Pick key={v.overall} v={v} tone="bad" />)}</div></Section>
      </div>
    </div>
  );
}
