import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtPts } from '../lib/format';
import { Rank, Section, TeamBadge } from './ui';

// A head-to-head league (migration 118): each week every team meets one other and the higher started-player points
// win. The table is wins, losses and ties, then points for; the week's matchups show live.
export interface Matchup { id: number; week: number; starts: string; ends: string; home_team: number; away_team: number | null; home_pts: number; away_pts: number | null; status: 'upcoming' | 'live' | 'final' }
export interface H2HRow { team_id: number; w: number; l: number; t: number; pf: number; pa: number; rank: number }

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function useH2H() {
  const { league, standings } = useLeague();
  const [m, setM] = useState<Matchup[] | null>(null);
  const [rows, setRows] = useState<H2HRow[] | null>(null);
  const on = league?.format === 'h2h';
  useEffect(() => {
    if (!on) return;
    rpc<Matchup[]>('h2h_scores').then((x) => setM(x ?? []), () => setM([]));
    rpc<H2HRow[]>('h2h_standings').then((x) => setRows([...(x ?? [])].sort((a, b) => a.rank - b.rank)), () => setRows([]));
  }, [on, league?.updated_at, standings]);
  // the week on now, or the next one, or the last one played
  const current = m && (m.find((x) => x.status === 'live')?.week ?? m.find((x) => x.status === 'upcoming')?.week ?? m[m.length - 1]?.week);
  return { matchups: m, rows, week: current ?? null };
}

export function MatchupCard({ x }: { x: Matchup }) {
  const { team, me } = useLeague();
  const side = (id: number | null, pts: number | null, won: boolean) => {
    const t = id ? team(id) : undefined;
    return (
      <div className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-center ${won ? 'bg-gold/10 ring-1 ring-gold/40' : ''}`}>
        {t ? <TeamBadge team={t} size={36} /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10">💤</span>}
        <div className={`w-full break-words text-xs font-bold leading-tight ${t?.id === me?.id ? 'text-gold' : 'text-slate-100'}`}>{t?.name ?? 'Bye'}</div>
        {t && <div className={`num font-display text-2xl font-extrabold leading-none ${won ? 'text-gold' : 'text-white'}`}>{x.status === 'upcoming' ? '–' : fmtPts(Number(pts ?? 0))}</div>}
      </div>
    );
  };
  const done = x.status === 'final' && x.away_team != null;
  const homeWon = done && Number(x.home_pts) > Number(x.away_pts);
  const awayWon = done && Number(x.away_pts) > Number(x.home_pts);
  return (
    <div className="card p-2">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-mute">
        <span>{day(x.starts)} – {day(x.ends)}</span>
        {x.status === 'live' ? <span className="flex items-center gap-1 text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Live</span> : x.status === 'final' ? <span>Final</span> : <span>Upcoming</span>}
      </div>
      {x.away_team == null ? (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-mute">{team(x.home_team) && <TeamBadge team={team(x.home_team)!} size={24} />}{team(x.home_team)?.name} has the week off</div>
      ) : (
        <div className="flex items-stretch gap-1">{side(x.home_team, x.home_pts, homeWon)}<div className="self-center px-1 text-xs font-bold text-mute">vs</div>{side(x.away_team, x.away_pts, awayWon)}</div>
      )}
    </div>
  );
}

export function H2HTable({ rows }: { rows: H2HRow[] }) {
  const { team, me } = useLeague();
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-x-3 border-b border-white/[.06] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
        <span>#</span><span>Team</span><span className="text-right">W-L-T</span><span className="w-14 text-right">PF</span>
      </div>
      {rows.map((r) => {
        const t = team(r.team_id);
        return (
          <div key={r.team_id} className={`grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-x-3 px-3 py-2.5 ${r.team_id === me?.id ? 'bg-gold/[.06]' : ''}`}>
            <Rank n={r.rank} />
            <span className="flex min-w-0 items-center gap-2">{t && <TeamBadge team={t} size={26} />}<span className="min-w-0 break-words text-sm font-bold">{t?.name}</span></span>
            <span className="num text-right font-display text-lg font-extrabold">{r.w}-{r.l}-{r.t}</span>
            <span className="num w-14 text-right text-sm text-slate-300">{fmtPts(Number(r.pf))}</span>
          </div>
        );
      })}
    </div>
  );
}

export function HeadToHeadStandings() {
  const { matchups, rows, week } = useH2H();
  const { me } = useLeague();
  const [showAll, setShowAll] = useState(false);
  if (!matchups || !rows) return <div className="card h-48 animate-pulse" />;
  if (!matchups.length) return <div className="card p-4 text-sm text-mute">The schedule isn’t made yet. The commissioner makes it on the Commish page.</div>;
  const thisWeek = matchups.filter((x) => x.week === week);
  const mine = matchups.filter((x) => x.status === 'final' && (x.home_team === me?.id || x.away_team === me?.id));
  return (
    <div className="space-y-5">
      <Section title={`Week ${week} of ${matchups[matchups.length - 1].week}`}>
        <div className="grid gap-2 sm:grid-cols-2">{thisWeek.map((x) => <MatchupCard key={x.id} x={x} />)}</div>
      </Section>
      <Section title="The table">
        <H2HTable rows={rows} />
        <p className="mt-1 px-1 text-[11px] text-mute">A win is worth one, a tie a half; points for break ties. Each week runs Monday to Sunday.</p>
      </Section>
      {mine.length > 0 && (
        <Section title="Your weeks" right={mine.length > 3 ? <button className="text-xs text-sky-300" onClick={() => setShowAll(!showAll)}>{showAll ? 'Fewer' : 'All'}</button> : undefined}>
          <div className="grid gap-2 sm:grid-cols-2">{(showAll ? mine : mine.slice(-3)).reverse().map((x) => <MatchupCard key={x.id} x={x} />)}</div>
        </Section>
      )}
    </div>
  );
}

// Home: my matchup this week, then the table
export function H2HHome() {
  const { matchups, rows, week } = useH2H();
  const { me } = useLeague();
  if (!matchups || !rows) return <div className="card h-32 animate-pulse" />;
  const mine = matchups.find((x) => x.week === week && (x.home_team === me?.id || x.away_team === me?.id));
  return (
    <div className="space-y-2">
      {mine && <MatchupCard x={mine} />}
      <H2HTable rows={rows} />
    </div>
  );
}
