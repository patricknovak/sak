import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { PlayerRow } from '../components/PlayerCard';
import { PlayerFilterBar, StatTable, usePlayerFilter } from '../components/PlayerFilters';
import { TeamBadge, PageHeader } from '../components/ui';
import { Search } from 'lucide-react';

export default function Players() {
  const nav = useNavigate();
  const { players, owner, team, league, me, rosters } = useLeague();
  const pf = usePlayerFilter({ tf: league?.phase === 'season' ? 'season' : 'proj' });
  const [who, setWho] = useState<'avail' | 'all' | 'taken'>('avail');
  const [view, setView] = useState<'list' | 'table'>('list');
  const [limit, setLimit] = useState(100);

  const list = useMemo(() => pf.apply([...players.values()]
    .filter((p) => (who === 'all' ? true : who === 'avail' ? !owner.has(p.id) : owner.has(p.id)))), [players, owner, who, pf.apply]);

  const used = rosters.filter((r) => r.team_id === me?.id).length;
  const table = view === 'table' && pf.tf !== 'proj';

  return (
    <div className="space-y-3">
      <PageHeader icon={<Search size={22} className="text-blue" />} title="Players"
        sub={<>Roster {used}/{Object.entries(league?.roster ?? {}).reduce((t, [k, v]) => t + (k === 'IR' ? 0 : v), 0)} {league?.phase !== 'season' && '· pickups open after the draft'}</>} />
      <div className="sticky top-[calc(3rem+var(--banner,0px))] z-20 -mx-3 space-y-1.5 border-b border-line bg-ice/95 px-3 py-2 backdrop-blur lg:top-[var(--banner,0px)]">
        <PlayerFilterBar pf={pf}>
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          {([['avail', 'Available'], ['taken', 'Rostered'], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} className={`tab px-2.5 py-1 ${who === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setWho(k)}>{l}</button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          <button className={`tab px-2.5 py-1 ${!table ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setView('list')}>List</button>
          <button className={`tab px-2.5 py-1 ${table ? 'tab-on' : 'bg-white/[.05]'} disabled:opacity-40`} disabled={pf.tf === 'proj'} title={pf.tf === 'proj' ? 'Pick a timeframe with real stats' : 'Every stat in one table'} onClick={() => setView('table')}>Table</button>
        </PlayerFilterBar>
      </div>

      {table ? (
        <StatTable list={list.slice(0, limit)} pf={pf} onPlayer={(id) => nav(`/player/${id}`)}
          badge={(p) => { const r = owner.get(p.id); return r ? <span className="ml-1 font-semibold" style={{ color: team(r.team_id)?.color }}>{team(r.team_id)?.abbrev}</span> : null; }} />
      ) : (
        <div className="card divide-y divide-white/[.06]">
          {list.slice(0, limit).map((p, i) => {
            const r = owner.get(p.id);
            const l = pf.line(p);
            return (
              <div key={p.id} className="flex items-center gap-2 px-2.5 py-2" onClick={() => nav(`/player/${p.id}`)}>
                <span className="w-6 text-center text-[11px] text-mute">{i + 1}</span>
                <div className="min-w-0 flex-1"><PlayerRow p={p} /></div>
                {r && <TeamBadge team={team(r.team_id)} size={22} />}
                <div className="w-[4.5rem] text-right">
                  <div className="num text-sm font-semibold">{pf.fmt(p)}</div>
                  <div className="whitespace-nowrap text-[10px] text-mute">{pf.label}{l?.gp != null && pf.stat !== 'gp' ? ` · ${l.gp} GP` : ''}</div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="p-6 text-center text-sm text-mute">No players match.</div>}
        </div>
      )}
      {list.length > limit && <button className="btn-ghost w-full" onClick={() => setLimit(limit + 100)}>Show more ({list.length - limit} left)</button>}
    </div>
  );
}
