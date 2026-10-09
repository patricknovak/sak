// A sport's centre (#/sport/<sport>, docs/POOL-TYPES.md §5), built like NHL centre for the sports a pool plays on.
// Baseball first: the postseason's scoreboard day by day (each game's line score by inning with runs, hits and
// errors, the inning and the outs while it is on, the probable pitchers before it starts, the series as it stands)
// and the bracket round by round. A pool that runs Pick the series sees its own pick on every series. It reads the
// shared event tables mlb-sync fills (series, fixtures, fixture_periods), every minute while a game is on.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Radio, Trophy, Tv } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { Empty, PageHeader } from '../components/ui';
import { Crest } from '../components/Crest';
import { usePoolGames, type Club, type GameBoard } from './Picks';
import { useSticky } from '../lib/sticky';

interface Fixture {
  id: number; kickoff: string; date: string; state: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled'; status: string | null;
  home_club: number; away_club: number; home_score: number | null; away_score: number | null; series_id: number | null; game_no: number | null; venue: string | null;
  detail: { hits?: { home: number | null; away: number | null }; errors?: { home: number | null; away: number | null }; inning?: number | null; half?: string | null; outs?: number | null;
    probables?: { home: string | null; away: string | null }; tbd?: boolean; if_necessary?: boolean; series_status?: string | null } | null;
}
interface Series { id: number; round: number; label: string; short: string | null; best_of: number; high_club: number | null; low_club: number | null; high_wins: number; low_wins: number; winner: number | null; state: string; starts_at: string | null; sort: number }
interface Period { fixture_id: number; n: number; home: number | null; away: number | null }
interface Competition { id: string; name: string; sport: string; tz: string }

const NAMES: Record<string, string> = { mlb: 'MLB centre', nfl: 'NFL playoffs' };
const dayKey = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };

// everything the centre shows for a competition, refreshed every minute while a game is on
function useEvent(sport: string) {
  const [comp, setComp] = useState<Competition | null | undefined>(undefined);
  const [clubs, setClubs] = useState<Map<number, Club>>(new Map());
  const [series, setSeries] = useState<Series[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [periods, setPeriods] = useState<Map<number, Period[]>>(new Map());
  const load = useCallback(async () => {
    // the sport's postseason, played in series (migration 187: the NFL's season in weeks has its own centre)
    const { data: cs } = await supabase.from('competitions').select('id,name,sport,tz').eq('sport', sport).eq('active', true).eq('format', 'series').order('sort').limit(1);
    const c = (cs?.[0] as Competition | undefined) ?? null;
    setComp(c);
    if (!c) return;
    const [{ data: cl }, { data: se }, { data: fx }] = await Promise.all([
      supabase.from('clubs').select('id,name,short,logo,color').eq('sport', sport),
      supabase.from('series').select('*').eq('competition', c.id),
      supabase.from('fixtures').select('id,kickoff,date,state,status,home_club,away_club,home_score,away_score,series_id,game_no,venue,detail').eq('competition', c.id).order('kickoff'),
    ]);
    setClubs(new Map(((cl ?? []) as Club[]).map((x) => [x.id, x])));
    setSeries((se ?? []) as Series[]);
    const f = (fx ?? []) as Fixture[];
    setFixtures(f);
    const ids = f.filter((x) => x.state !== 'scheduled').map((x) => x.id);
    if (ids.length) {
      const { data: pe } = await supabase.from('fixture_periods').select('fixture_id,n,home,away').in('fixture_id', ids).limit(5000);
      const m = new Map<number, Period[]>();
      for (const p of (pe ?? []) as Period[]) m.set(p.fixture_id, [...(m.get(p.fixture_id) ?? []), p]);
      for (const v of m.values()) v.sort((a, b) => a.n - b.n);
      setPeriods(m);
    }
  }, [sport]);
  useEffect(() => { load(); }, [load]);
  const live = fixtures.some((f) => f.state === 'live');
  const now = useNow(live ? 60000 : 600000);
  useEffect(() => { load(); }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  return { comp, clubs, series, fixtures, periods, live };
}

// the pool's own picks on this event's series, when it runs Pick the series on it
function usePoolPicks(competition: string | undefined) {
  const { kind } = useLeague();
  const { games } = usePoolGames();
  const [board, setBoard] = useState<GameBoard | null>(null);
  const g = games?.find((x) => x.kind === 'series' && x.competition === competition);
  useEffect(() => { if (kind === 'predict' && g) rpc<GameBoard>('pool_game_board', { p_game: g.id }).then(setBoard, () => setBoard(null)); }, [g?.id, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return { board, gameId: g?.id };
}

function Outs({ n }: { n: number }) {
  return <span className="inline-flex gap-0.5" aria-label={`${n} out`}>{[0, 1, 2].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < n ? 'bg-amber-300' : 'bg-white/15'}`} />)}</span>;
}

function GameCard({ f, clubs, periods, series, pick, baseball }: { f: Fixture; clubs: Map<number, Club>; periods: Period[]; series?: Series; pick?: { winner: number; games: number } | null; baseball: boolean }) {
  const home = clubs.get(f.home_club), away = clubs.get(f.away_club);
  const d = f.detail ?? {};
  const live = f.state === 'live', done = f.state === 'final';
  const innings = Math.max(9, ...periods.map((p) => p.n));
  const row = (c: Club | undefined, side: 'home' | 'away') => {
    const runs = side === 'home' ? f.home_score : f.away_score, other = side === 'home' ? f.away_score : f.home_score;
    const won = done && runs != null && other != null && runs > other;
    const prob = d.probables?.[side];
    const wins = series ? (series.high_club === c?.id ? series.high_wins : series.low_club === c?.id ? series.low_wins : 0) : 0;
    return (
      <div className={`flex items-center gap-3 ${done && !won ? 'opacity-60' : ''}`}>
        {c && <Crest c={c} size={32} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2"><span className="break-words font-bold text-white">{c?.name}</span>{pick?.winner === c?.id && <span className="rounded-full bg-gold/20 px-1.5 text-[9px] font-black uppercase tracking-wider text-gold">Your pick</span>}</div>
          <div className="text-[11px] text-mute">{f.state === 'scheduled' ? (baseball ? (prob ? prob : 'Probable to be named') : '') : series && series.best_of > 1 ? `${wins} ${wins === 1 ? 'win' : 'wins'} in the series` : ''}</div>
        </div>
        <span className={`num shrink-0 text-2xl font-black ${won ? 'text-white' : 'text-slate-300'}`}>{runs ?? ''}</span>
      </div>
    );
  };
  return (
    <div className={`card overflow-hidden ${live ? 'border-red-400/40 shadow-[0_0_24px_rgba(248,113,113,.12)]' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.06] px-3.5 py-2 text-[11px]">
        <span className="font-black uppercase tracking-[.14em] text-white">{series?.short ?? ''}{f.game_no && (series?.best_of ?? 2) > 1 ? ` · Game ${f.game_no}` : ''}{d.if_necessary && f.state === 'scheduled' ? ' · if needed' : ''}</span>
        {live ? <span className="inline-flex items-center gap-1.5 font-bold text-red-300"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" /></span>{d.half === 'Top' ? 'Top' : d.half === 'Bottom' ? 'Bot' : d.half ?? ''} {d.inning ? ord(d.inning) : ''} {d.outs != null && <Outs n={d.outs} />}</span>
          : <span className="text-mute">{done ? 'Final' : f.state === 'postponed' ? 'Postponed' : f.state === 'cancelled' ? 'Cancelled' : d.tbd ? 'Time to be set' : time(f.kickoff)}</span>}
      </div>
      <div className="space-y-2.5 px-3.5 py-3">{row(away, 'away')}{row(home, 'home')}</div>
      {periods.length > 0 && (
        <div className="scroll-x border-t border-white/[.06] px-2 py-2">
          <table className="num w-full text-center text-[11px]">
            <thead><tr className="text-mute"><th className="w-12 px-1 text-left font-semibold" />{Array.from({ length: innings }, (_, i) => <th key={i} className="px-1 font-semibold">{i + 1}</th>)}<th className="border-l border-white/10 px-1.5 font-black text-white">R</th><th className="px-1.5">H</th><th className="px-1.5">E</th></tr></thead>
            <tbody>
              {(['away', 'home'] as const).map((side) => (
                <tr key={side} className="text-slate-200">
                  <td className="px-1 text-left font-bold text-white">{(side === 'home' ? home : away)?.short}</td>
                  {Array.from({ length: innings }, (_, i) => { const p = periods.find((x) => x.n === i + 1); const v = p?.[side]; return <td key={i} className={`px-1 ${v ? 'font-black text-white' : 'text-slate-400'}`}>{v ?? (p ? 'x' : '')}</td>; })}
                  <td className="border-l border-white/10 px-1.5 font-black text-white">{side === 'home' ? f.home_score : f.away_score}</td>
                  <td className="px-1.5">{d.hits?.[side] ?? ''}</td><td className="px-1.5">{d.errors?.[side] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] px-3.5 py-2 text-[11px] text-mute">
        <span>{d.series_status ?? ''}</span>{f.venue && <span>{f.venue}</span>}
      </div>
    </div>
  );
}

function SeriesCard({ s, clubs, pick, split }: { s: Series; clubs: Map<number, Club>; pick?: { winner: number; games: number } | null; split?: Map<number, number> }) {
  const need = Math.floor(s.best_of / 2) + 1;
  const side = (id: number | null, wins: number) => {
    const c = id ? clubs.get(id) : undefined;
    const won = s.winner != null && s.winner === id, out = s.winner != null && s.winner !== id;
    return (
      <div className={`flex items-center gap-2.5 ${out ? 'opacity-45' : ''}`}>
        {c ? <Crest c={c} size={26} /> : <span className="h-[26px] w-[26px] rounded-full bg-white/[.06]" />}
        <span className="min-w-0 flex-1 break-words text-sm font-bold text-white">{c?.name ?? 'To be decided'}</span>
        {pick?.winner === id && id && <span className="rounded-full bg-gold/20 px-1.5 text-[9px] font-black uppercase text-gold">Pick · {pick.games}</span>}
        {split?.get(id ?? -1) != null && <span className="num text-[10px] font-bold text-mute">{split.get(id!)}%</span>}
        <span className="flex gap-1">{Array.from({ length: need }, (_, i) => <span key={i} className="h-2 w-2 rounded-full ring-1 ring-white/20" style={{ background: i < wins ? c?.color ?? 'rgb(var(--gold-rgb))' : 'transparent' }} />)}</span>
        {won && <Trophy className="h-4 w-4 shrink-0 text-gold" />}
      </div>
    );
  };
  return (
    <div className={`card space-y-2 p-3 ${s.state === 'live' ? 'border-white/20' : ''}`}>
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[.14em]"><span className="text-white">{s.short ?? s.label}</span><span className="text-mute">{s.state === 'final' ? 'Final' : s.state === 'live' ? `Best of ${s.best_of}` : s.starts_at ? new Date(s.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span></div>
      {side(s.high_club, s.high_wins)}{side(s.low_club, s.low_wins)}
    </div>
  );
}

export default function SportCentre() {
  const { sport = 'mlb' } = useParams();
  const { comp, clubs, series, fixtures, periods, live } = useEvent(sport);
  const { board, gameId } = usePoolPicks(comp?.id);
  const [tab, setTab] = useSticky<'scores' | 'bracket'>(`centre:${sport}:tab`, 'scores');
  const tz = comp?.tz ?? 'America/New_York';
  const days = useMemo(() => [...new Set(fixtures.map((f) => f.date ?? dayKey(f.kickoff, tz)))].sort(), [fixtures, tz]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  // open on today, or the next day with games, or the last one played
  const initial = days.find((d) => d >= today) ?? days[days.length - 1];
  const [day, setDay] = useState<string | null>(null);
  const shown = day ?? initial ?? null;
  const games = fixtures.filter((f) => (f.date ?? dayKey(f.kickoff, tz)) === shown);
  // the strip opens on the day shown
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = strip.current?.querySelector<HTMLElement>('[data-on="1"]'); if (el && strip.current) strip.current.scrollLeft = Math.max(0, el.offsetLeft - strip.current.offsetLeft - 80); }, [shown, tab, days.length]);
  const seriesById = new Map(series.map((s) => [s.id, s]));
  const picks = new Map((board?.series ?? []).map((s) => [s.id, s.mine]));
  const splits = new Map((board?.series ?? []).filter((s) => s.calls?.length).map((s) => {
    const n = s.calls!.length, m = new Map<number, number>();
    for (const c of s.calls!) m.set(c.winner, (m.get(c.winner) ?? 0) + 1);
    for (const [k, v] of m) m.set(k, Math.round((v / n) * 100));
    return [s.id, m];
  }));
  // the round being played first, then the ones still to come, then the ones done
  const all = [...new Set(series.map((s) => s.round))].sort((a, b) => a - b);
  const cur = all.find((r) => series.some((s) => s.round === r && s.state !== 'final')) ?? all[all.length - 1];
  const rounds = [...all.filter((r) => r >= cur), ...all.filter((r) => r < cur).reverse()];

  if (comp === undefined) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!comp) return <Empty icon="📺" title="Nothing on yet">This sport has no event running right now.</Empty>;
  return (
    <div className="space-y-4 pb-10">
      <PageHeader icon={<Tv className="h-6 w-6 text-gold" />} title={NAMES[sport] ?? `${sport.toUpperCase()} centre`} sub={comp.name}
        right={gameId ? <Link to={`/picks?g=${gameId}`} className="text-xs font-semibold text-sky-300">Your picks →</Link> : undefined} />
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
        {([['scores', 'Scores', CalendarDays], ['bracket', 'Bracket', Trophy]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold ${tab === k ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}><I className="h-4 w-4" /> {l}{k === 'scores' && live && <Radio className="h-3.5 w-3.5 animate-pulse text-red-400" />}</button>
        ))}
      </div>

      {tab === 'scores' && (
        <>
          <div ref={strip} className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
            {days.map((d) => {
              const on = d === shown, n = fixtures.filter((f) => (f.date ?? dayKey(f.kickoff, tz)) === d).length;
              const anyLive = fixtures.some((f) => f.date === d && f.state === 'live');
              return (
                <button key={d} data-on={on ? '1' : '0'} type="button" onClick={() => setDay(d)} className={`flex w-[60px] shrink-0 flex-col items-center rounded-2xl border px-1 py-1.5 ${on ? 'border-gold bg-gold/15' : d < today ? 'border-white/[.05] bg-black/20' : 'border-white/[.08] bg-white/[.03]'}`}>
                  <span className="text-[9px] font-bold uppercase text-mute">{d === today ? 'Today' : dayLabel(d).split(',')[0]}</span>
                  <span className="text-sm font-black text-white">{dayLabel(d).replace(/^\w+,?\s*/, '')}</span>
                  <span className={`text-[9px] font-bold ${anyLive ? 'text-red-300' : 'text-mute'}`}>{anyLive ? 'Live' : `${n} ${n === 1 ? 'game' : 'games'}`}</span>
                </button>
              );
            })}
          </div>
          {!games.length ? <div className="card p-4 text-sm text-mute">No games this day.</div> : (
            <div className="grid gap-3 md:grid-cols-2">
              {games.map((f) => <GameCard key={f.id} baseball={sport === 'mlb'} f={f} clubs={clubs} periods={periods.get(f.id) ?? []} series={f.series_id ? seriesById.get(f.series_id) : undefined} pick={f.series_id ? picks.get(f.series_id) : null} />)}
            </div>
          )}
        </>
      )}

      {tab === 'bracket' && (
        <div className="space-y-4">
          {rounds.map((r) => {
            const list = series.filter((s) => s.round === r).sort((a, b) => a.sort - b.sort || a.id - b.id);
            return (
              <div key={r}>
                <div className="mb-2 flex items-center gap-2 px-1"><span className="text-[10px] font-black uppercase tracking-[.2em] text-mute">{list[0]?.label.replace(/^(AL|NL) /, '')}</span><span className="h-px flex-1 bg-white/[.06]" /></div>
                <div className="grid gap-2 sm:grid-cols-2">{list.map((s) => <SeriesCard key={s.id} s={s} clubs={clubs} pick={picks.get(s.id)} split={splits.get(s.id)} />)}</div>
              </div>
            );
          })}
          {board && <p className="px-1 text-[11px] text-mute">Your picks show on each series; the pool&apos;s split shows once a series starts.</p>}
        </div>
      )}
      <p className="px-1 text-[11px] text-mute">{sport === 'mlb' ? 'From MLB’s public feed' : 'From the league’s public scoreboard'}, every two minutes while games are on.</p>
    </div>
  );
}
