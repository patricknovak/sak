import { useEffect, useMemo, useState } from 'react';
import { RotoStandings } from '../components/RotoStandings';
import { HeadToHeadStandings } from '../components/HeadToHead';
import { useSticky } from '../lib/sticky';
import { Link } from 'react-router-dom';
import { useLeague, useSport } from '../lib/store';
import { bare, useBrand } from '../lib/brand';
import { selectAll, supabase } from '../lib/supabase';
import { fmtDate, fmtMoney, fmtPts } from '../lib/format';
import { Section, TeamBadge, PageHeader } from '../components/ui';
import type { Team } from '../lib/types';
import { Trophy } from 'lucide-react';
import { useHistory } from '../lib/history';
import { PLACES, prizes } from '../lib/prizes';
import { hasFeature } from '../lib/features';
import { PointsRace } from '../components/charts';
import { StandingsTable } from '../components/StandingsTable';

interface Daily { team_id: number; date: string; points: number }

// top three on the podium: 2nd, 1st, 3rd
function Podium({ rows, caption }: { rows: { t?: Team; name: string; gm: string; pts: number }[]; caption: string }) {
  const steps = [
    { r: rows[1], place: 2, h: 'h-20', medal: 'from-white via-[#cfd8ea] to-[#8a97b3]' },
    { r: rows[0], place: 1, h: 'h-28', medal: 'from-[#fff1b8] via-[#f7c548] to-[#b97c06]' },
    { r: rows[2], place: 3, h: 'h-14', medal: 'from-[#ffd2a8] via-[#d98b4a] to-[#8a4b1c]' },
  ];
  return (
    <div className="card-hero px-3 pb-0 pt-5" style={{ '--tc': 'var(--color-gold)' } as React.CSSProperties}>
      <div className="label relative mb-3 text-center text-white/70">{caption}</div>
      <div className="relative grid grid-cols-3 items-end gap-2">
        {steps.map(({ r, place, h, medal }) => r && (
          <div key={place} className="flex flex-col items-center">
            {place === 1 && <div className="mb-1 text-2xl drop-shadow-[0_0_12px_rgb(var(--gold-rgb)/.8)]">👑</div>}
            {r.t ? <TeamBadge team={r.t} size={place === 1 ? 58 : 46} ring={place === 1} /> : <div className="h-12 w-12 rounded-full bg-white/10" />}
            <div className="mt-1.5 w-full break-words text-center text-xs font-bold leading-tight">{r.name}</div>
            <div className="text-[10px] text-white/60">{r.gm}</div>
            <div className="num font-display text-base font-extrabold">{fmtPts(r.pts)}</div>
            <div className={`mt-1.5 w-full ${h} rounded-t-xl bg-gradient-to-b ${medal} grid place-items-start justify-center pt-1 shadow-[inset_0_1px_0_rgba(255,255,255,.6)]`}>
              <span className="font-display text-3xl font-extrabold text-black/40">{place}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

let poShown = false;

export default function Standings() {
  const { standings, playoffs, cup, team, teams, me, league } = useLeague();
  const lastSeason = useHistory().seasons[0];
  const brand = useBrand();
  const playoffsOn = playoffs.some((t) => Number(t.points) !== 0);
  const [view, setView] = useSticky<'regular' | 'playoffs' | 'cup'>('standings:view', playoffsOn ? 'playoffs' : 'regular');
  // once the playoffs start the page opens on them, once per visit; after that the GM's pick stays
  useEffect(() => { if (playoffsOn && !poShown) { poShown = true; setView('playoffs'); } }, [playoffsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const isPo = view === 'playoffs', isCup = view === 'cup';
  const [daily, setDaily] = useState<Daily[]>([]);
  useEffect(() => {
    selectAll<Daily>(isCup ? 'sak_cup_daily' : isPo ? 'playoff_daily' : 'team_daily', 'team_id,date,points', 1000, ['date', 'team_id']).then(setDaily, () => {});
  }, [standings, playoffs, isPo, isCup]);
  const table = useMemo(() => [...(isCup ? cup : isPo ? playoffs : standings)].sort((a, b) => a.rank - b.rank), [standings, playoffs, cup, isPo, isCup]);
  const money = prizes(league, teams.length);
  const useMoney = hasFeature(league, 'money');
  const pot = isCup ? money.cup : isPo ? money.playoffs : money.regular;
  const last = table[table.length - 1], second = table[table.length - 2];
  const scored = table.some((t) => Number(t.points) !== 0);

  // a head-to-head league ranks by wins; a rotisserie league by categories
  if (league?.format === 'h2h') return (
    <div className="space-y-5">
      <PageHeader icon={<Trophy size={22} className="text-gold" />} title="Standings" sub={`${league.season} season · head-to-head`} />
      <HeadToHeadStandings />
    </div>
  );
  if (league?.categories?.length) return (
    <div className="space-y-5">
      <PageHeader icon={<Trophy size={22} className="text-gold" />} title="Standings" sub={`${league.season} season · rotisserie`} />
      <RotoStandings />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={<Trophy size={22} className="text-gold" />} title="Standings" sub={`${league?.season} season`} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {([['regular', `🏒 ${brand.regular}`, 'Regular season', money.pots.regular], ['playoffs', `🔥 ${bare(brand.playoff)}`, 'Playoffs', money.pots.playoffs], ['cup', `🏆 ${brand.trophy}`, 'Full year', money.pots.cup]] as const).map(([k, trophy, label, pot]) => (
          <button key={k} onClick={() => setView(k)}
            className={`card p-3 text-left transition active:scale-[.98] ${k === 'cup' ? 'col-span-2 sm:col-span-1' : ''} ${view === k ? 'border-gold/40 shadow-[0_0_0_1px_rgb(var(--gold-rgb)/.25),0_12px_32px_-18px_rgb(var(--gold-rgb)/.7)]' : 'opacity-75'}`}
            style={view === k ? { background: 'linear-gradient(160deg, rgb(var(--gold-rgb)/.14), rgba(15,23,41,.8) 55%)' } : undefined}>
            <div className="label flex items-start justify-between gap-1.5"><span className="min-w-0 break-words leading-snug">{trophy}</span>{useMoney && <span className="shrink-0">{pot.pct}%</span>}</div>
            <div className="text-[10px] text-mute">{label}</div>
            {useMoney && <>
              <div className="num text-gold-shine mt-0.5 font-display text-2xl font-extrabold">{fmtMoney(pot.amount)}</div>
              <div className="num mt-0.5 text-[11px] text-mute">{pot.places.map((v, i) => `${PLACES[i]} ${fmtMoney(v)}`).join(' · ')}</div>
            </>}
          </button>
        ))}
      </div>

      {league?.phase !== 'season' && !scored && (
        <div className="card p-4 text-sm text-mute">The season hasn’t started. {league?.season_start ? <>Scoring begins {fmtDate(league.season_start)}.</> : <>Scoring begins with the first NHL night after the draft.</>}{lastSeason && <> Last season’s final table is on the <Link className="text-sky-300" to="/league">League page</Link>.</>}</div>
      )}
      {isPo && !scored && (
        <div className="card p-4 text-sm text-slate-300">🔥 <b>The {brand.short} playoffs</b> run alongside the NHL playoffs. The regular season table is saved as it stands, and everyone starts the playoffs at zero with their current roster, including any trades and pickups. Same daily lineups, same rules. Every fantasy point scored in an NHL playoff game counts here, and {useMoney ? <>the top three split {money.playoffPct}% of the prize pool for the {bare(brand.playoff)}</> : <>the top team takes the {bare(brand.playoff)}</>}. Players whose NHL team is eliminated stop scoring, so depth on deep playoff teams wins it.</div>
      )}
      {isCup && (
        <div className="card p-4 text-sm text-slate-300">🏆 <b>{brand.trophy}</b> goes to the best team over the whole year, from the draft to the Stanley Cup final: every regular season point plus every playoff point{useMoney ? <>, for {money.cupPct}% of the prize pool</> : null}. {!playoffsOn && 'Until the playoffs start it matches the regular season table.'} Odds for it are on the <Link className="text-sky-300" to="/draft?t=analysis">forecast page</Link>.</div>
      )}
      {scored && table.length >= 3
        ? <Podium caption={isCup ? `${bare(brand.trophy)} race right now` : isPo ? 'Playoff podium right now' : 'If the season ended today'} rows={table.slice(0, 3).map((s) => ({ t: team(s.team_id), name: team(s.team_id)?.name ?? '', gm: team(s.team_id)?.gm_name ?? '', pts: Number(s.points) }))} />
        : view === 'regular' && lastSeason && lastSeason.rows.length >= 3 && <Podium caption={`${lastSeason.season} final podium`} rows={lastSeason.rows.slice(0, 3).map((r) => ({ t: teams.find((x) => x.name === r.team), name: r.team, gm: r.gm, pts: r.points }))} />}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="space-y-2">
      <StandingsTable rows={table} view={view} pot={useMoney ? pot : []} peter={useMoney && view === 'regular'} />
      {scored && <p className="px-1 text-[11px] text-mute">🪑 Bench: points left on the bench and IR {isCup ? 'this year' : isPo ? 'in the playoffs' : 'this season'}, shown and never counted. Tonight’s bench is on the <Link className="text-sky-300" to="/scoreboard">scoreboard</Link>, every day of it on the <Link className="text-sky-300" to="/performance">Performance page</Link>.</p>}
      {useMoney && view === 'regular' && scored && last && second && (
        <p className="px-1 text-xs text-mute">🪣 {bare(brand.booby)} Punishment if the regular season ended now: {team(last.team_id)?.gm_name} owes {fmtMoney(Math.round((second.points - last.points) * 100) / 100)} to the {brand.fund}.</p>
      )}
      </div>
      <Section title={isCup ? `${bare(brand.trophy)} race` : isPo ? 'Playoff points race' : 'Points race'}>
        <div className="card p-3"><PointsRace daily={daily} focus={me?.id ?? 0} /></div>
      </Section>
      </div>
      {view === 'regular' && <Corrections />}
      {view === 'regular' && lastSeason && (
        <Section title={`Last season (${lastSeason.season})`}>
          <div className="card divide-y divide-white/[.06]">
            {lastSeason.rows.map((r, i) => (
              <div key={r.team} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-5 text-mute">{i + 1}</span><span className="flex-1">{r.team} <span className="text-mute">· {r.gm}</span></span>
                <span>{fmtPts(r.points, 2)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// every stat correction the NHL made after a game was final, and which teams it moved
function Corrections() {
  const { players } = useLeague();
  const start = useSport().words.start;
  const [rows, setRows] = useState<{ id: number; player_id: number; date: string; old_fpts: number; new_fpts: number; old_stats: Record<string, number>; new_stats: Record<string, number>; created_at: string }[]>([]);
  useEffect(() => {
    supabase.from('league_corrections').select('*').order('id', { ascending: false }).limit(12)
      .then(({ data }) => setRows((data ?? []).filter((r) => Number(r.new_fpts) !== Number(r.old_fpts))));
  }, []);
  if (!rows.length) return null;
  const diff = (o: Record<string, number>, n: Record<string, number>) => [...new Set([...Object.keys(o), ...Object.keys(n)])]
    .map((k) => [k, (n[k] ?? 0) - (o[k] ?? 0)] as const).filter(([, d]) => d).map(([k, d]) => `${k.toUpperCase()} ${d > 0 ? '+' : ''}${d}`).join(', ');
  return (
    <Section title="📝 Stat corrections" right={<span className="text-xs text-mute">rechecked daily, three weeks back every Monday</span>}>
      <div className="card divide-y divide-white/[.06]">
        {rows.map((r) => {
          const d = Number(r.new_fpts) - Number(r.old_fpts);
          return (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate"><b>{players.get(r.player_id)?.name ?? 'Player'}</b> <span className="text-xs text-mute">{fmtDate(r.date)} · {diff(r.old_stats, r.new_stats) || 'recalculated'}</span></span>
              <span className={`num font-semibold ${d > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{d > 0 ? '+' : ''}{fmtPts(d, 2)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 px-1 text-xs text-mute">Points follow the lineup at {start}: a correction counts for whoever started the player that night. Teams it moves get a note.</p>
    </Section>
  );
}
