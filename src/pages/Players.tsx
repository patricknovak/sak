import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { PlayerRow } from '../components/PlayerCard';
import { PlayerFilterBar, StatTable, usePlayerFilter } from '../components/PlayerFilters';
import { projLike } from '../lib/playerstats';
import { comingAvailable } from '../lib/keepers';
import { TeamBadge, PageHeader } from '../components/ui';
import { Search } from 'lucide-react';

export default function Players() {
  const nav = useNavigate();
  const { players, owner, team, league, me, rosters } = useLeague();
  const pf = usePlayerFilter({ tf: league?.phase === 'season' ? 'season' : 'proj' });
  const [q] = useSearchParams();
  const [who, setWho] = useState<'avail' | 'all' | 'taken' | 'coming'>(q.get('who') === 'coming' ? 'coming' : 'avail');
  // before keepers lock, each team's top scorer is already as good as available: he can't be kept
  const coming = useMemo(() => comingAvailable(players, rosters, league), [players, rosters, league]);
  const comingSet = useMemo(() => new Set(coming.map((p) => p.id)), [coming]);
  const [view, setView] = useState<'list' | 'table'>('list');
  const [limit, setLimit] = useState(100);

  const list = useMemo(() => pf.apply([...players.values()]
    .filter((p) => (who === 'all' ? true : who === 'coming' ? comingSet.has(p.id) : who === 'avail' ? !owner.has(p.id) || comingSet.has(p.id) : owner.has(p.id)))), [players, owner, who, pf.apply, comingSet]);
  const fromTeam = (p: { id: number }) => (comingSet.has(p.id) ? team(owner.get(p.id)?.team_id ?? 0) : undefined);

  const used = rosters.filter((r) => r.team_id === me?.id).length;
  const table = view === 'table' && !projLike(pf.tf);

  return (
    <div className="space-y-3">
      <PageHeader icon={<Search size={22} className="text-blue" />} title="Players"
        sub={<>Roster {used}/{Object.entries(league?.roster ?? {}).reduce((t, [k, v]) => t + (k === 'IR' ? 0 : v), 0)} {league?.phase !== 'season' && '· pickups open after the draft'}</>} />
      <div className="sticky top-[calc(3rem+var(--banner,0px))] z-20 -mx-3 space-y-1.5 border-b border-line bg-ice/95 px-3 py-2 backdrop-blur lg:top-[var(--banner,0px)]">
        <PlayerFilterBar pf={pf}>
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          {([['avail', 'Available'], ...(coming.length ? [['coming', '🔓 Coming available']] as const : []), ['taken', 'Rostered'], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} className={`tab px-2.5 py-1 ${who === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setWho(k)}>{l}</button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          <button className={`tab px-2.5 py-1 ${!table ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setView('list')}>List</button>
          <button className={`tab px-2.5 py-1 ${table ? 'tab-on' : 'bg-white/[.05]'} disabled:opacity-40`} disabled={projLike(pf.tf)} title={projLike(pf.tf) ? 'Pick a timeframe with real stats' : 'Every stat in one table'} onClick={() => setView('table')}>Table</button>
        </PlayerFilterBar>
      </div>

      {who === 'coming' && (
        <p className="px-1 text-xs text-mute">Each team’s top scorer from 2025-26 can’t be kept, so these players are back in the draft pool no matter what. Everyone else who isn’t kept joins them when keepers lock{league?.keeper_deadline ? ` (${new Date(league.keeper_deadline).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}.</p>
      )}
      {table ? (
        <StatTable list={list.slice(0, limit)} pf={pf} onPlayer={(id) => nav(`/player/${id}`)}
          badge={(p) => { const r = owner.get(p.id); const f = fromTeam(p); return f ? <span className="ml-1 font-semibold text-emerald-300" title={`${f.name}’s top scorer last season: can’t be kept`}>🔓 {f.abbrev}</span> : r ? <span className="ml-1 font-semibold" style={{ color: team(r.team_id)?.color }}>{team(r.team_id)?.abbrev}</span> : null; }} />
      ) : (
        <div className="card divide-y divide-white/[.06]">
          {list.slice(0, limit).map((p, i) => {
            const r = owner.get(p.id);
            const l = pf.line(p);
            return (
              <div key={p.id} className="flex items-center gap-2 px-2.5 py-2" onClick={() => nav(`/player/${p.id}`)}>
                <span className="w-6 text-center text-[11px] text-mute">{i + 1}</span>
                <div className="min-w-0 flex-1"><PlayerRow p={p} /></div>
                {fromTeam(p) ? <span className="chip shrink-0 bg-emerald-500/15 text-emerald-200" title={`${fromTeam(p)!.name}’s top scorer last season: can’t be kept`}>🔓 {fromTeam(p)!.abbrev}</span> : r && <TeamBadge team={team(r.team_id)} size={22} />}
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
