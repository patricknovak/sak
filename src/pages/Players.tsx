import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import type { Pos as PosT } from '../lib/types';
import { fmtPts } from '../lib/format';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { TeamBadge } from '../components/ui';

type SortKey = 'season' | 'last14' | 'proj' | 'last_fp';

export default function Players() {
  const { players, owner, team, season, league, me, rosters } = useLeague();
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<'ALL' | PosT>('ALL');
  const [who, setWho] = useState<'avail' | 'all' | 'taken'>('avail');
  const [sort, setSort] = useState<SortKey>(league?.phase === 'season' ? 'season' : 'proj');
  const [detail, setDetail] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);

  const val = (id: number, k: SortKey) => {
    const p = players.get(id)!;
    return k === 'season' ? season.get(id)?.fpts ?? 0 : k === 'last14' ? season.get(id)?.fpts14 ?? 0 : k === 'proj' ? p.proj : p.last_fp;
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...players.values()]
      .filter((p) => (who === 'all' ? true : who === 'avail' ? !owner.has(p.id) : owner.has(p.id)))
      .filter((p) => pos === 'ALL' || (pos === 'G' ? p.pos === 'G' : p.elig.includes(pos)))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.nhl_team?.toLowerCase() === needle)
      .sort((a, b) => val(b.id, sort) - val(a.id, sort));
  }, [players, owner, pos, who, q, sort, season]);

  const used = rosters.filter((r) => r.team_id === me?.id).length;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h1 className="h-display text-2xl">Players</h1>
        <div className="text-xs text-mute">Roster {used}/{Object.entries(league?.roster ?? {}).reduce((t, [k, v]) => t + (k === 'IR' ? 0 : v), 0)} {league?.phase !== 'season' && '· pickups open after the draft'}</div>
      </div>
      <div className="sticky top-12 z-20 -mx-3 space-y-2 border-b border-line bg-ice/95 px-3 py-2 backdrop-blur lg:top-0">
        <input className="input" placeholder="Search name or NHL team (e.g. TOR)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="scroll-x flex items-center gap-1">
          {(['ALL', 'C', 'LW', 'RW', 'D', 'G'] as const).map((x) => <button key={x} className={`tab px-2.5 py-1 ${pos === x ? 'tab-on' : 'bg-boards'}`} onClick={() => setPos(x)}>{x}</button>)}
          <span className="mx-1 h-5 w-px bg-line" />
          {([['avail', 'Available'], ['taken', 'Rostered'], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} className={`tab px-2.5 py-1 ${who === k ? 'tab-on' : 'bg-boards'}`} onClick={() => setWho(k)}>{l}</button>
          ))}
        </div>
        <div className="scroll-x flex gap-1 text-xs">
          {([['season', 'This season'], ['last14', 'Last 14 days'], ['proj', 'Projected'], ['last_fp', '2025-26']] as const).map(([k, l]) => (
            <button key={k} className={`rounded-full px-2.5 py-1 ${sort === k ? 'bg-sky-500 text-ice font-semibold' : 'text-mute'}`} onClick={() => setSort(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card divide-y divide-line">
        {list.slice(0, limit).map((p, i) => {
          const r = owner.get(p.id);
          return (
            <div key={p.id} className="flex items-center gap-2 px-2.5 py-2" onClick={() => setDetail(p.id)}>
              <span className="w-6 text-center text-[11px] text-mute">{i + 1}</span>
              <div className="min-w-0 flex-1"><PlayerRow p={p} /></div>
              {r && <TeamBadge team={team(r.team_id)} size={22} />}
              <div className="w-14 text-right">
                <div className="text-sm font-semibold">{fmtPts(val(p.id, sort), sort === 'proj' ? 0 : 1)}</div>
                <div className="text-[10px] text-mute">{sort === 'season' ? `${season.get(p.id)?.gp ?? 0} GP` : sort === 'last14' ? '14d' : sort === 'proj' ? 'proj' : "'25-26"}</div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="p-6 text-center text-sm text-mute">No players match.</div>}
      </div>
      {list.length > limit && <button className="btn-ghost w-full" onClick={() => setLimit(limit + 100)}>Show more</button>}
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
