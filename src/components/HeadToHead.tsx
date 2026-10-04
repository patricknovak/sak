import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLeague, useSport } from '../lib/store';
import { calledOff, notStarted } from '../lib/sport';
import { rpc } from '../lib/supabase';
import { fmtPts, readable } from '../lib/format';
import { useBrand } from '../lib/brand';
import { categoryOf, fmtCat } from '../lib/categories';
import { forecastTeam, winChance, type FPlayer } from '../lib/forecast';
import { gamesOf, rosPerGame } from '../lib/lineup';
import { useSeasonGames } from '../lib/projections';
import type { Player } from '../lib/types';
import { Headshot, Pos, Rank, Section, Sheet, TeamBadge } from './ui';

// A head-to-head league (migration 118): each week every team meets one other and the higher started-player points
// win. The table is wins, losses and ties, then points for; the week's matchups show live.
export interface Matchup { id: number; week: number; starts: string; ends: string; home_team: number; away_team: number | null; home_pts: number; away_pts: number | null; status: 'upcoming' | 'live' | 'final';
  // a category league (migration 121): the scores are categories won, and each category's values and winner
  cats?: Record<string, { a: number | null; b: number | null; win: 'a' | 'b' | 'tie' }> | null }
export interface H2HRow { team_id: number; w: number; l: number; t: number; pf: number; pa: number; rank: number; seed?: number }   // seed: the order with no ties (migration 128)
// a playoff meeting (migration 120): worked out on read from the table and the weeks' points
export interface BracketGame {
  round: number; slot: number; week: number; starts: string; ends: string; high_seed: number | null; high_team: number | null;
  low_seed: number | null; low_team: number | null; high_pts: number | null; low_pts: number | null;
  status: 'upcoming' | 'live' | 'final' | 'bye'; winner: number | null; seeded: boolean;
}

// a category league's scores are categories won, whole numbers; a points league's are fantasy points
const useScore = () => {
  const { league } = useLeague();
  const cat = !!league?.categories?.length;
  return { cat, score: (v: number | null | undefined) => (cat ? String(Math.round(Number(v ?? 0))) : fmtPts(Number(v ?? 0))) };
};

const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function useH2H() {
  const { league, standings } = useLeague();
  const [m, setM] = useState<Matchup[] | null>(null);
  const [rows, setRows] = useState<H2HRow[] | null>(null);
  const [bracket, setBracket] = useState<BracketGame[]>([]);
  const on = league?.format === 'h2h';
  const spots = on ? league?.h2h_playoffs ?? 0 : 0;
  useEffect(() => {
    if (!on) return;
    rpc<Matchup[]>('h2h_scores').then((x) => setM(x ?? []), () => setM([]));
    rpc<H2HRow[]>('h2h_standings').then((x) => setRows([...(x ?? [])].sort((a, b) => (a.seed ?? a.rank) - (b.seed ?? b.rank))), () => setRows([]));
    if (spots >= 2) rpc<BracketGame[]>('h2h_bracket').then((x) => setBracket(x ?? []), () => setBracket([]));
    else setBracket([]);
  }, [on, spots, league?.updated_at, standings]);
  // the week on now, or the next one, or the last one played
  const current = m && (m.find((x) => x.status === 'live')?.week ?? m.find((x) => x.status === 'upcoming')?.week ?? m[m.length - 1]?.week);
  // the playoffs are on once the regular season is over (the seeds hold)
  const playoffsOn = bracket.length > 0 && bracket[0].seeded;
  return { matchups: m, rows, week: current ?? null, bracket, spots, playoffsOn };
}

// the round's name, counted back from the final
const roundName = (r: number, of: number) => ['Final', 'Semifinals', 'Quarterfinals'][of - r] ?? `Round ${r}`;
const meetingName = (r: number, of: number) => ['final', 'semifinal', 'quarterfinal'][of - r] ?? `round ${r} meeting`;

// one playoff meeting: the higher seed on top, the winner in gold, a bye as a week off
export function BracketCard({ g, all }: { g: BracketGame; all: BracketGame[] }) {
  const { team, me } = useLeague();
  const { score } = useScore();
  // a side not decided yet: the winner of the meeting that feeds it
  const feeders = all.filter((x) => x.round === g.round - 1 && (x.slot === g.slot * 2 - 1 || x.slot === g.slot * 2)).filter((x) => x.winner == null);
  const of = Math.max(...all.map((x) => x.round));
  const pending = feeders.map((x) => x.high_seed && x.low_seed ? `Winner of #${x.high_seed} v #${x.low_seed}` : `Winner of ${meetingName(x.round, of)} ${x.slot}`);
  const row = (seed: number | null, id: number | null, pts: number | null, fallback: string) => {
    const t = id ? team(id) : undefined;
    const won = g.status === 'final' && g.winner != null && g.winner === id;
    const lost = g.status === 'final' && g.winner != null && id != null && g.winner !== id;
    return (
      <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${won ? 'bg-gold/10 ring-1 ring-gold/40' : ''} ${lost ? 'opacity-45' : ''}`}>
        <span className="num w-5 shrink-0 text-center text-[11px] font-bold text-mute">{seed ?? ''}</span>
        {t ? <TeamBadge team={t} size={26} /> : <span className="h-[26px] w-[26px] shrink-0 rounded-full border border-dashed border-white/20" />}
        <span className={`min-w-0 flex-1 break-words text-sm font-bold leading-tight ${t ? (t.id === me?.id ? 'text-gold' : 'text-slate-100') : 'font-medium text-mute'}`}>{t?.name ?? fallback}</span>
        {(g.status === 'live' || g.status === 'final') && <span className={`num font-display text-lg font-extrabold leading-none ${won ? 'text-gold' : 'text-white'}`}>{score(pts)}</span>}
        {won && <span className="text-xs" aria-label="through">✓</span>}
      </div>
    );
  };
  return (
    <div className={`card p-1.5 ${g.status === 'live' ? 'ring-1 ring-red-400/40' : ''}`}>
      <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-mute">
        <span>{day(g.starts)} – {day(g.ends)}</span>
        {g.status === 'live' ? <span className="flex items-center gap-1 text-red-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Live</span>
          : g.status === 'final' ? <span>Final</span> : g.status === 'bye' ? <span className="text-gold/80">Bye</span> : <span>Upcoming</span>}
      </div>
      {row(g.high_seed, g.high_team, g.high_pts, pending[0] ?? 'To be decided')}
      {g.status === 'bye'
        ? <p className="px-2 pb-1 pt-0.5 text-[11px] text-mute">A week off, straight through to the next round.</p>
        : row(g.low_seed, g.low_team, g.low_pts, pending[g.high_team == null ? 1 : 0] ?? 'To be decided')}
    </div>
  );
}

// the whole bracket: round by round, the champion on top once the final is played
export function Bracket({ games, spots }: { games: BracketGame[]; spots: number }) {
  const { team } = useLeague();
  const brand = useBrand();
  if (!games.length) return null;
  const rounds = Math.max(...games.map((g) => g.round));
  const final = games.find((g) => g.round === rounds);
  const champ = final?.status === 'final' && final.winner ? team(final.winner) : undefined;
  const seeded = games[0].seeded;
  return (
    <div className="space-y-3">
      {champ && (
        <div className="card relative overflow-hidden p-4 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--gold-rgb)/.28),transparent_65%)]" />
          <div className="relative text-3xl">🏆</div>
          <div className="relative mt-1 text-[11px] font-bold uppercase tracking-[.2em] text-gold">Champions · {brand.trophy}</div>
          <div className="relative mt-2 flex items-center justify-center gap-2"><TeamBadge team={champ} size={40} ring /><span className="break-words font-display text-2xl font-extrabold">{champ.name}</span></div>
        </div>
      )}
      <p className="px-1 text-xs text-mute">
        {seeded ? `The top ${spots} from the table, one week a round.` : `If the regular season ended today: the top ${spots} from the table, one week a round.`}
        {' '}A tie goes to the higher seed.
      </p>
      <div className="grid gap-3 sm:grid-flow-col sm:auto-cols-fr">
        {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
          <div key={r} className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">{roundName(r, rounds)}</span>
              <span className="text-[10px] text-mute">Week {games.find((g) => g.round === r)?.week}</span>
            </div>
            <div className="space-y-2 sm:flex sm:h-[calc(100%-1.5rem)] sm:flex-col sm:justify-around sm:space-y-0 sm:gap-2">
              {games.filter((g) => g.round === r).map((g) => <BracketCard key={`${g.round}-${g.slot}`} g={g} all={games} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// a matchup player by player (migration 127): each side's started players that week, most points first
function MatchupPlayers({ x, onClose }: { x: Matchup; onClose: () => void }) {
  const { team, players, me } = useLeague();
  const { cat, score } = useScore();
  const [rows, setRows] = useState<{ team_id: number; player_id: number; pts: number; games: number }[] | null>(null);
  useEffect(() => { rpc<typeof rows>('h2h_matchup_players', { p_matchup: x.id }).then((r) => setRows(r ?? []), () => setRows([])); }, [x.id]);
  const col = (id: number, total: number | null) => {
    const t = team(id);
    const mine = (rows ?? []).filter((r) => r.team_id === id).sort((a, b) => Number(b.pts) - Number(a.pts));
    return (
      <div className="min-w-0">
        <div className="mb-2 flex flex-col items-center gap-1 text-center">
          {t && <TeamBadge team={t} size={34} />}
          <div className={`w-full break-words text-xs font-bold leading-tight ${id === me?.id ? 'text-gold' : 'text-slate-100'}`}>{t?.name}</div>
          <div className="num font-display text-2xl font-extrabold leading-none text-white">{score(total)}</div>
          {cat && <div className="text-[9px] font-bold uppercase tracking-wider text-mute">categories</div>}
        </div>
        <div className="space-y-1">
          {mine.map((r) => {
            const p = players.get(r.player_id);
            return (
              <a key={r.player_id} href={`#/player/${r.player_id}`} className="flex items-center gap-1.5 rounded-lg bg-white/[.04] px-1.5 py-1 hover:bg-white/[.07]">
                <Headshot p={p} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[11px] font-semibold leading-tight text-slate-100">{p?.name ?? 'Player'}</span>
                  <span className="flex items-center gap-1 text-[10px] text-mute">{p && <Pos p={p.pos} />}{r.games} GP</span>
                </span>
                {!cat && <span className="num shrink-0 text-xs font-bold text-white">{fmtPts(Number(r.pts))}</span>}
              </a>
            );
          })}
          {rows && !mine.length && <p className="px-1 py-2 text-center text-[11px] text-mute">Nobody started yet.</p>}
        </div>
      </div>
    );
  };
  return (
    <Sheet open onClose={onClose} title={`Week ${x.week} · ${day(x.starts)} – ${day(x.ends)}`}>
      {!rows ? <div className="card h-40 animate-pulse" /> : (
        <>
          <div className="grid grid-cols-2 gap-2">{col(x.home_team, x.home_pts)}{x.away_team != null && col(x.away_team, x.away_pts)}</div>
          <p className="mt-3 text-[11px] text-mute">{cat ? 'Games each started player has played this week; the categories decide it.' : 'Fantasy points from each player while he was in the lineup this week; the bench and IR never count.'}</p>
        </>
      )}
    </Sheet>
  );
}

// A points matchup's chances while it can still turn: each side's points so far plus the rest of the week played out
// night by night with its roster (the same forecast the season odds use: each player's projection blended with his
// pace, his NHL games, his chance of dressing, the best lineup each night), and the week's spread of luck around it
// (a team's points swing about 1.2 × the square root of what it expects). A game of tonight's counts once it's on the
// board; the ones still to come are forecast.
function useWinChance(x: Matchup) {
  const { league, rosters, players, season, games: today, leagueDay } = useLeague();
  const sport = useSport();
  const sched = useSeasonGames();
  const on = !!sched && x.away_team != null && x.status !== 'final' && !league?.categories?.length;
  return useMemo(() => {
    if (!on || x.away_team == null) return null;
    const caps = (league?.roster ?? {}) as Record<string, number>;
    // tonight's games already on (or over) are in the points on the board: the forecast plays only the ones to come,
    // so a player in a late game keeps what he's expected to add
    const begun = new Set(today.filter((g) => g.date === leagueDay && !notStarted(sport, g.state) && !calledOff(sport, g.state)).map((g) => g.id));
    const ahead = begun.size ? sched!.filter((g) => !(g.id != null && begun.has(g.id))) : sched!;
    const from = x.status === 'upcoming' ? x.starts : leagueDay;
    const value = (p: Player): FPlayer => { const s = season.get(p.id); return { ...p, proj: rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp) * gamesOf(p) }; };
    const side = (t: number) => {
      const roster = rosters.filter((r) => r.team_id === t && r.slot !== 'IR').map((r) => players.get(r.player_id)).filter((p): p is Player => !!p).map(value);
      return from > x.ends ? 0 : forecastTeam(t, roster, ahead, caps, from, 0, x.ends).ros;
    };
    const hr = side(x.home_team), ar = side(x.away_team);
    if (x.status === 'upcoming' && hr + ar <= 0) return null;   // nothing scheduled to go on
    const hNow = x.status === 'upcoming' ? 0 : Number(x.home_pts ?? 0), aNow = x.status === 'upcoming' ? 0 : Number(x.away_pts ?? 0);
    const home = winChance(hNow, hr, aNow, ar);
    return { home, homeProj: hNow + hr, awayProj: aNow + ar };
  }, [on, x, sched, rosters, players, season, today, leagueDay, league?.roster, league?.categories]);
}

function WinBar({ x }: { x: Matchup }) {
  const { team } = useLeague();
  const c = useWinChance(x);
  if (!c || x.away_team == null) return null;
  const h = team(x.home_team), a = team(x.away_team);
  // 100% only once nothing is left to play; while games remain the long shot keeps at least 1%
  const hp = c.home <= 0 || c.home >= 1 ? Math.round(c.home * 100) : Math.min(99, Math.max(1, Math.round(c.home * 100))), ap = 100 - hp;
  // a sure thing still shows a sliver of the other side, so the bar reads as a contest
  const w = Math.min(97, Math.max(3, c.home * 100));
  return (
    <div className="mt-1.5 px-1">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="num font-bold" style={{ color: readable(h?.color ?? '#fff') }}>{hp}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{x.status === 'upcoming' ? 'Projected' : 'Win chance'}</span>
        <span className="num font-bold" style={{ color: readable(a?.color ?? '#fff') }}>{ap}%</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <span className="rounded-l-full" style={{ width: `${w}%`, background: h?.color ?? '#94a3b8' }} />
        <span className="flex-1 rounded-r-full" style={{ background: a?.color ?? '#64748b' }} />
      </div>
      <div className="mt-1 text-center text-[10px] text-mute">projected <span className="num text-slate-300">{fmtPts(c.homeProj)}</span> – <span className="num text-slate-300">{fmtPts(c.awayProj)}</span></div>
    </div>
  );
}

export function MatchupCard({ x }: { x: Matchup }) {
  const { team, me, league } = useLeague();
  const { cat, score } = useScore();
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState(false);
  const side = (id: number | null, pts: number | null, won: boolean) => {
    const t = id ? team(id) : undefined;
    return (
      <div className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-center ${won ? 'bg-gold/10 ring-1 ring-gold/40' : ''}`}>
        {t ? <TeamBadge team={t} size={36} /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10">💤</span>}
        <div className={`w-full break-words text-xs font-bold leading-tight ${t?.id === me?.id ? 'text-gold' : 'text-slate-100'}`}>{t?.name ?? 'Bye'}</div>
        {t && <div className={`num font-display text-2xl font-extrabold leading-none ${won ? 'text-gold' : 'text-white'}`}>{x.status === 'upcoming' ? '–' : score(pts)}</div>}
        {t && cat && x.status !== 'upcoming' && <div className="text-[9px] font-bold uppercase tracking-wider text-mute">categories</div>}
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
        <button type="button" disabled={x.status === 'upcoming'} onClick={() => setPlayers(true)} aria-label="Player by player"
          className="flex w-full items-stretch gap-1 rounded-xl text-left transition enabled:hover:bg-white/[.03]">
          {side(x.home_team, x.home_pts, homeWon)}<div className="self-center px-1 text-xs font-bold text-mute">vs</div>{side(x.away_team, x.away_pts, awayWon)}
        </button>
      )}
      {!cat && <WinBar x={x} />}
      {x.away_team != null && x.status !== 'upcoming' && !cat && (
        <button type="button" onClick={() => setPlayers(true)} className="mt-1 w-full rounded-lg py-1 text-[11px] font-semibold text-sky-300 hover:bg-white/[.04]">Player by player ›</button>
      )}
      {players && <MatchupPlayers x={x} onClose={() => setPlayers(false)} />}
      {cat && x.cats && x.away_team != null && x.status !== 'upcoming' && (
        <>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setOpen(!open)} className="rounded-lg py-1 text-[11px] font-semibold text-sky-300 hover:bg-white/[.04]">
              {open ? 'Hide the categories' : `Category by category${(() => { const t = Object.values(x.cats).filter((c) => c.win === 'tie').length; return t ? ` · ${t} tied` : ''; })()}`}
            </button>
            <button type="button" onClick={() => setPlayers(true)} className="rounded-lg py-1 text-[11px] font-semibold text-sky-300 hover:bg-white/[.04]">Player by player ›</button>
          </div>
          {open && (
            <div className="mt-1 divide-y divide-white/[.05] rounded-lg bg-black/20 text-sm">
              {(league?.categories ?? Object.keys(x.cats)).filter((k) => x.cats![k]).map((k) => {
                const c = x.cats![k];
                return (
                  <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1.5">
                    <span className={`num text-right ${c.win === 'a' ? 'font-bold text-gold' : 'text-slate-300'}`}>{fmtCat(k, c.a)}</span>
                    <span className="w-16 text-center text-[10px] font-bold uppercase tracking-wider text-mute" title={categoryOf(k)?.label}>{categoryOf(k)?.short ?? k}</span>
                    <span className={`num ${c.win === 'b' ? 'font-bold text-gold' : 'text-slate-300'}`}>{fmtCat(k, c.b)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// max points for: what each team's lineups could have scored in the weeks it played (finished weeks, as points for
// counts them), the best lineup every night from the same players (lineup_efficiency). A points league only; a bye
// week counts toward neither number.
function useMaxPf(matchups?: Matchup[] | null) {
  const { league, leagueDay } = useLeague();
  const on = !!matchups?.length && !league?.categories?.length;
  const [eff, setEff] = useState<{ team_id: number; date: string; game_type: number; best: number }[] | null>(null);
  useEffect(() => {
    if (!on) { setEff(null); return; }
    rpc<{ team_id: number; date: string; game_type: number; best: number }[]>('lineup_efficiency', { p_from: null, p_to: leagueDay }).then((x) => setEff(x ?? []), () => setEff([]));
  }, [on, leagueDay]);
  return useMemo(() => {
    if (!on || !eff?.length) return null;
    const out = new Map<number, number>();
    for (const x of matchups!) {
      if (x.status !== 'final' || x.away_team == null) continue;
      for (const t of [x.home_team, x.away_team]) {
        const sum = eff.filter((e) => e.team_id === t && e.game_type === 2 && e.date >= x.starts && e.date <= x.ends).reduce((n, e) => n + Number(e.best), 0);
        out.set(t, (out.get(t) ?? 0) + sum);
      }
    }
    return out;
  }, [on, eff, matchups]);
}

export function H2HTable({ rows, cut = 0, matchups }: { rows: H2HRow[]; cut?: number; matchups?: Matchup[] | null }) {
  const { team, me } = useLeague();
  const { cat, score } = useScore();
  const maxPf = useMaxPf(matchups);
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-x-3 border-b border-white/[.06] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
        <span>#</span><span>Team</span><span className="text-right">W-L-T</span><span className="w-14 text-right" title={cat ? 'Categories won' : maxPf ? 'Points for, and the most the best lineups could have scored' : 'Points for'}>{cat ? 'Cats' : 'PF'}</span>
      </div>
      {rows.map((r, i) => {
        const t = team(r.team_id);
        return (
          <div key={r.team_id}>
          {cut > 0 && i === cut && (
            <div className="flex items-center gap-2 px-3 py-1 text-[9px] font-bold uppercase tracking-[.18em] text-gold/80">
              <span className="h-px flex-1 border-t border-dashed border-gold/40" />Playoff line<span className="h-px flex-1 border-t border-dashed border-gold/40" />
            </div>
          )}
          <div className={`grid grid-cols-[1.5rem_1fr_auto_auto] items-center gap-x-3 px-3 py-2.5 ${r.team_id === me?.id ? 'bg-gold/[.06]' : ''}`}>
            <Rank n={r.rank} />
            <span className="flex min-w-0 items-center gap-2">{t && <TeamBadge team={t} size={26} />}<span className="min-w-0 break-words text-sm font-bold">{t?.name}</span></span>
            <span className="num text-right font-display text-lg font-extrabold">{r.w}-{r.l}-{r.t}</span>
            <span className="num w-14 text-right text-sm text-slate-300">{score(r.pf)}{maxPf?.has(r.team_id) && <span className="block text-[10px] leading-tight text-mute">of {fmtPts(maxPf.get(r.team_id)!, 0)}</span>}</span>
          </div>
          </div>
        );
      })}
    </div>
  );
}

export function HeadToHeadStandings() {
  const { matchups, rows, week, bracket, spots, playoffsOn } = useH2H();
  const { me } = useLeague();
  const { cat } = useScore();
  const [showAll, setShowAll] = useState(false);
  if (!matchups || !rows) return <div className="card h-48 animate-pulse" />;
  if (!matchups.length) return <H2HPreseason />;
  const thisWeek = matchups.filter((x) => x.week === week);
  const mine = matchups.filter((x) => x.status === 'final' && (x.home_team === me?.id || x.away_team === me?.id));
  const playoffs = bracket.length > 0 && <Section title="The playoffs"><Bracket games={bracket} spots={spots} /></Section>;
  return (
    <div className="space-y-5">
      {playoffsOn ? playoffs : (
        <Section title={`Week ${week} of ${matchups[matchups.length - 1].week}`}>
          <div className="grid gap-2 sm:grid-cols-2">{thisWeek.map((x) => <MatchupCard key={x.id} x={x} />)}</div>
        </Section>
      )}
      <Section title={playoffsOn ? 'The regular season' : 'The table'}>
        <H2HTable rows={rows} cut={Math.min(spots, rows.length)} matchups={matchups} />
        <p className="mt-1 px-1 text-[11px] text-mute">{cat ? 'Win more of the categories to win the week. ' : ''}A win is worth one, a tie a half; {cat ? 'categories won' : 'points for'} break ties. Each week runs Monday to Sunday.{spots >= 2 && ` The top ${spots} make the playoffs.`}</p>
      </Section>
      {!playoffsOn && playoffs}
      {mine.length > 0 && (
        <Section title="Your weeks" right={mine.length > 3 ? <button className="text-xs text-sky-300" onClick={() => setShowAll(!showAll)}>{showAll ? 'Fewer' : 'All'}</button> : undefined}>
          <div className="grid gap-2 sm:grid-cols-2">{(showAll ? mine : mine.slice(-3)).reverse().map((x) => <MatchupCard key={x.id} x={x} />)}</div>
        </Section>
      )}
    </div>
  );
}

// before the schedule exists: what the format is, the field at 0-0-0, and the commissioner's way to the schedule
function H2HPreseason() {
  const { league, teams, me } = useLeague();
  const { cat } = useScore();
  const spots = league?.h2h_playoffs ?? 0;
  const facts = [
    ['📅', 'One opponent a week', 'Monday to Sunday, every team meets every other in turn.'],
    [cat ? '📊' : '🏒', cat ? 'Win the categories' : 'Outscore them', cat ? `Take more of the ${league?.categories?.length} categories than your opponent to win the week.` : 'More fantasy points from your starters wins the week.'],
    ['🏆', spots >= 2 ? `Top ${spots} make the playoffs` : 'The table decides it', spots >= 2 ? 'A bracket over the season’s last weeks, one week a round.' : 'Wins, losses and ties, then points for.'],
  ];
  return (
    <div className="space-y-4">
      <div className="card-hero p-4" style={{ '--tc': 'var(--color-gold)' } as React.CSSProperties}>
        <div className="relative">
          <div className="label text-white/60">⚔️ Head-to-head · {league?.season}</div>
          <h2 className="h-display text-shine mt-0.5 text-2xl leading-none">Week by week</h2>
          <div className="mt-3 space-y-2">
            {facts.map(([icon, title, body]) => (
              <div key={title} className="flex items-start gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-base">{icon}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold text-white">{title}</span><span className="block text-xs text-white/60">{body}</span></span>
              </div>
            ))}
          </div>
          {me?.is_commish ? (
            <Link to="/commish" className="btn-primary mt-4 flex w-full items-center justify-center gap-2">Make the schedule <ArrowRight size={16} /></Link>
          ) : <p className="mt-4 text-xs text-white/60">The schedule comes out once the commissioner makes it.</p>}
        </div>
      </div>
      <Section title="The field">
        <div className="grid grid-cols-2 gap-2">
          {teams.filter((t) => t.role === 'gm').map((t) => (
            <div key={t.id} className={`card flex items-center gap-2 p-2.5 ${t.id === me?.id ? 'ring-1 ring-gold/40' : ''}`}>
              <TeamBadge team={t} size={30} />
              <span className="min-w-0 flex-1">
                <span className={`block break-words text-sm font-bold leading-tight ${t.id === me?.id ? 'text-gold' : 'text-slate-100'}`}>{t.name}</span>
                <span className="num block text-[11px] text-mute">0-0-0</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// Home: my matchup this week, then the table
export function H2HHome() {
  const { matchups, rows, week, bracket, spots, playoffsOn } = useH2H();
  const { me } = useLeague();
  if (!matchups || !rows) return <div className="card h-32 animate-pulse" />;
  const mine = matchups.find((x) => x.week === week && (x.home_team === me?.id || x.away_team === me?.id));
  if (playoffsOn) {
    // the playoffs: my latest meeting, or the round being played if I'm out
    const mineGames = bracket.filter((g) => g.high_team === me?.id || g.low_team === me?.id);
    const myGame = mineGames[mineGames.length - 1];
    const now = bracket.find((g) => g.status === 'live') ?? bracket.find((g) => g.status === 'upcoming') ?? bracket[bracket.length - 1];
    const show = myGame && (myGame.winner == null || myGame.winner === me?.id || myGame.round === now.round) ? myGame : now;
    const rounds = Math.max(...bracket.map((g) => g.round));
    return (
      <div className="space-y-2">
        <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-gold">Playoffs · {roundName(show.round, rounds)}</div>
        <BracketCard g={show} all={bracket} />
        <H2HTable rows={rows} cut={Math.min(spots, rows.length)} matchups={matchups} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {mine && <MatchupCard x={mine} />}
      <H2HTable rows={rows} cut={Math.min(spots, rows.length)} matchups={matchups} />
    </div>
  );
}
