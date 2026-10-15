import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fmtPts } from '../lib/format';
import { TeamBadge, TeamName } from './ui';

// The guillotine (migration 278): every Monday, once Sunday's games are final, the team with the fewest points that
// week is cut and its players go back to free agency. The card shows the week so far, lowest first (the one on the
// block in red), and everyone already cut; the last team standing wins.
interface Cut { team_id: number; week_start: string; week_end: string; points: number; alive: number }

const monday = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function GuillotineCard() {
  const { league, teams, team, leagueDay } = useLeague();
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [week, setWeek] = useState<Map<number, number>>(new Map());
  const start = monday(leagueDay);
  useEffect(() => {
    let live = true;
    supabase.from('guillotine_cuts').select('team_id,week_start,week_end,points,alive').order('week_start')
      .then(({ data }) => { if (live) setCuts((data ?? []) as Cut[]); }, () => { if (live) setCuts([]); });
    supabase.from('team_daily').select('team_id,points').gte('date', start).lte('date', leagueDay)
      .then(({ data }) => {
        if (!live) return;
        const m = new Map<number, number>();
        for (const r of (data ?? []) as { team_id: number; points: number }[]) m.set(r.team_id, (m.get(r.team_id) ?? 0) + Number(r.points));
        setWeek(m);
      }, () => {});
    return () => { live = false; };
  }, [league?.league_id, start, leagueDay]);
  const cutIds = useMemo(() => new Set((cuts ?? []).map((c) => c.team_id)), [cuts]);
  const alive = teams.filter((t) => t.role === 'gm' && !cutIds.has(t.id))
    .map((t) => ({ t, pts: week.get(t.id) ?? 0 })).sort((a, b) => a.pts - b.pts || b.t.id - a.t.id);
  if (!cuts) return <div className="h-40 animate-pulse rounded-3xl bg-white/[.04]" />;
  const winner = alive.length === 1 ? alive[0].t : null;
  // switched on midweek, this week isn't judged (migration 281): the first is the next full week
  const from = league?.info?.guillotine_from as string | undefined;
  const judged = !from || start > from;
  const next = (() => { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  return (
    <div className="card relative overflow-hidden p-4" style={{ background: 'linear-gradient(140deg, rgba(244,63,94,.14), rgba(15,23,41,.85) 55%)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="label flex items-center gap-1.5 text-rose-300"><span className="text-base leading-none">🪓</span> The guillotine</div>
        <span className="text-[11px] text-mute">{winner ? 'Done' : `${alive.length} left`}</span>
      </div>
      {winner ? (
        <div className="mt-3 flex items-center gap-3">
          <TeamBadge team={winner} size={44} ring />
          <div><div className="font-display text-xl font-extrabold text-white"><TeamName team={winner} /></div><div className="text-sm text-gold">The last team standing</div></div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-white/70">{judged
            ? <>Week of {short(start)}: the fewest points by Sunday's last game is cut Monday, and their players hit free agency.</>
            : <>The first week judged starts Monday, {short(next)}: from then, each week's fewest points is cut, and their players hit free agency. This week is a free one.</>}</p>
          <div className="mt-3 space-y-1.5">
            {alive.slice(0, 4).map(({ t, pts }, i) => (
              <div key={t.id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${i === 0 && judged ? 'bg-rose-500/15 ring-1 ring-rose-400/40' : 'bg-white/[.03]'}`}>
                <TeamBadge team={t} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight text-white"><TeamName team={t} /></span>
                  {i === 0 && judged && <span className="block text-[10px] font-black uppercase tracking-wider text-rose-300">On the block</span>}
                </span>
                <span className="num w-12 shrink-0 text-right text-sm font-bold text-white">{fmtPts(pts, 1)}</span>
              </div>
            ))}
            {alive.length > 4 && <div className="px-2.5 text-[11px] text-mute">and {alive.length - 4} more, safe so far</div>}
          </div>
        </>
      )}
      {cuts.length > 0 && (
        <div className="mt-3 border-t border-white/[.07] pt-2.5">
          <div className="text-[10px] font-black uppercase tracking-[.18em] text-mute">Cut</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...cuts].reverse().map((c) => {
              const t = team(c.team_id);
              return (
                <span key={c.team_id} className="chip gap-1.5 border-white/10 bg-white/[.04] text-[11px] text-white/70">
                  <TeamBadge team={t} size={16} /><span className="line-through decoration-rose-400/70">{t?.name ?? 'A team'}</span>
                  <span className="text-mute">wk of {short(c.week_start)} · {fmtPts(Number(c.points), 1)}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
