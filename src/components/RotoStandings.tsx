import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { categoryOf, fmtCat } from '../lib/categories';
import { Rank, TeamBadge } from './ui';

// A rotisserie league's table (category_standings): every team's season totals in the league's categories, ranked
// team against team; first in a category earns as many points as there are teams, last earns one, ties share. A card
// per team, its categories as chips (the leader in each one lit gold), so the whole table fits a phone without a
// sideways scroll.
export interface RotoRow { team_id: number; total: number; rank: number; cats: Record<string, { value: number | null; pts: number }> }

export function useRoto() {
  const { league, standings } = useLeague();
  const [rows, setRows] = useState<RotoRow[] | null>(null);
  const on = !!league?.categories?.length;
  useEffect(() => {
    if (!on) return;
    rpc<RotoRow[]>('category_standings').then((r) => setRows([...(r ?? [])].sort((a, b) => a.rank - b.rank || b.total - a.total)), () => setRows([]));
  }, [on, league?.updated_at, standings]);
  return rows;
}

export function RotoStandings() {
  const { league, team, me } = useLeague();
  const rows = useRoto();
  const cats = league?.categories ?? [];
  if (!rows) return <div className="card h-48 animate-pulse" />;
  const n = rows.length;
  const best = (k: string) => Math.max(...rows.map((r) => Number(r.cats[k]?.pts ?? 0)));
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-mute">Rotisserie, {cats.length} categories: first in a category earns {n} points, last earns 1, ties share. Counted from the players each team starts.</p>
      {rows.map((r) => {
        const t = team(r.team_id);
        return (
          <div key={r.team_id} className={`card p-3 ${r.team_id === me?.id ? 'ring-1 ring-gold/40' : ''}`}>
            <div className="flex items-center gap-3">
              <Rank n={r.rank} />
              {t && <TeamBadge team={t} size={34} />}
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-bold text-slate-100">{t?.name}</div>
                <div className="text-xs text-mute">{t?.gm_name}</div>
              </div>
              <div className="text-right"><div className="num font-display text-2xl font-extrabold leading-none text-white">{Math.round(Number(r.total) * 10) / 10}</div><div className="text-[10px] uppercase tracking-wider text-mute">roto pts</div></div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {cats.map((k) => {
                const c = r.cats[k];
                const lead = c && Number(c.pts) === best(k) && Number(c.pts) > 0;
                return (
                  <span key={k} title={categoryOf(k)?.label} className={`inline-flex items-baseline gap-1 rounded-lg border px-1.5 py-0.5 text-[11px] ${lead ? 'border-gold/50 bg-gold/10' : 'border-white/10 bg-white/[.04]'}`}>
                    <span className="font-semibold text-mute">{categoryOf(k)?.short ?? k}</span>
                    <span className="num font-bold text-slate-100">{fmtCat(k, c?.value)}</span>
                    <span className={`num rounded px-1 text-[10px] font-bold ${lead ? 'bg-gold text-ice' : 'bg-white/10 text-slate-300'}`}>{Math.round(Number(c?.pts ?? 0) * 10) / 10}</span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// the short version, for Home: rank, team, roto points
export function RotoMini() {
  const { team } = useLeague();
  const rows = useRoto();
  if (!rows) return <div className="card h-32 animate-pulse" />;
  return (
    <div className="card divide-y divide-white/[.06] overflow-hidden">
      {rows.map((r) => {
        const t = team(r.team_id);
        return (
          <div key={r.team_id} className="flex items-center gap-3 px-3 py-2.5">
            <Rank n={r.rank} />
            {t && <TeamBadge team={t} size={30} />}
            <div className="min-w-0 flex-1 break-words text-sm font-bold">{t?.name}</div>
            <div className="num font-display text-lg font-extrabold">{Math.round(Number(r.total) * 10) / 10}</div>
          </div>
        );
      })}
    </div>
  );
}
