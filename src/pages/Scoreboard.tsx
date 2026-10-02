// Game night, live: every NHL game on the slate, and every team's points as they come in, starter by starter.
// Step back a day (or any number of days) to review a night that is already in the books.
// The bench is tracked too: what each GM left on the bench and IR that night and over the season so far.
// Bench points are shown and never counted; they come from the same puck-drop freeze-frames as the starters.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { selectAll, supabase } from '../lib/supabase';
import { fmtDate, fmtPts, fmtTime, readable } from '../lib/format';
import { NhlLogo, PageHeader, Pos, Section, TeamBadge } from '../components/ui';
import type { Game } from '../lib/types';
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import { BoxScore, scoringLine } from '../components/BoxScore';

type Snap = { team_id: number; player_id: number; slot: string; game_id: number };
type PG = { player_id: number; game_id: number; fpts: number; stats: Record<string, number>; nhl_team: string | null };
type BenchDay = { team_id: number; date: string; points: number; game_type: number };
const LIVE = new Set(['LIVE', 'CRIT']);
const DONE = new Set(['OFF', 'FINAL']);

function gameLabel(g: Game) {
  if (g.state === 'PPD') return 'Postponed';
  if (g.state === 'CNCL') return 'Cancelled';
  if (DONE.has(g.state)) return 'Final';
  if (LIVE.has(g.state)) return `${/^\d+$/.test(g.period ?? '') ? 'P' + g.period : g.period ?? ''} ${g.clock ?? ''}`.trim() || 'Live';
  return fmtTime(g.start_utc);
}
const BENCH = ['BN', 'IR'];
// the NHL game id carries its kind: 2026020123 is a regular-season game, 2026030111 a playoff game
const isPlayoffGame = (g: Game) => String(g.id).slice(4, 6) === '03';
// a player's game from his side: his club first (the one he played for that night), the opponent, the score
// with his club's goals first, and where the game stands
function matchup(g: Game, club: string | null | undefined) {
  const home = club ? club === g.home : true;
  const mine = home ? g.home : g.away, opp = home ? g.away : g.home;
  const my = home ? g.home_score : g.away_score, their = home ? g.away_score : g.home_score;
  const started = LIVE.has(g.state) || DONE.has(g.state);
  const extra = DONE.has(g.state) && g.period && !/^\d+$/.test(g.period) ? `/${g.period}` : '';
  return {
    teams: `${mine} ${home ? 'vs' : '@'} ${opp}`,
    score: started && my != null && their != null ? `${my}–${their}` : null,
    tone: !started || my == null || their == null || my === their ? 'text-slate-300' : my > their ? 'text-emerald-300' : 'text-red-300',
    status: DONE.has(g.state) ? `Final${extra}` : gameLabel(g),
  };
}
const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);

export default function Scoreboard() {
  const { me, teams, players, rosters, games, league, standings, leagueDay } = useLeague();
  const now = useNow(30_000);
  // ?day=YYYY-MM-DD opens a past night; without it the page follows the league day
  const [params, setParams] = useSearchParams();
  const asked = params.get('day');
  const today = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked < leagueDay ? asked : leagueDay;
  const past = today !== leagueDay;
  const goTo = (d: string) => { if (d >= leagueDay) params.delete('day'); else params.set('day', d); setParams(params, { replace: true }); setOpen(me?.id ?? null); };
  const seasonStart = league?.season_start ?? null;
  const slate = useMemo(() => games.filter((g) => g.date === today).sort((a, b) => a.start_utc.localeCompare(b.start_utc)), [games, today]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [pgs, setPgs] = useState<PG[]>([]);
  const [open, setOpen] = useState<number | null>(me?.id ?? null);
  const [box, setBox] = useState<Game | null>(null);
  const [benchDays, setBenchDays] = useState<BenchDay[]>([]);

  // freeze-frames are taken at puck drop, box scores every minute: poll both while the page is open
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from('lineup_snapshots').select('team_id,player_id,slot,game_id').eq('date', today),
        supabase.from('player_games').select('player_id,game_id,fpts,stats,nhl_team').eq('date', today),
      ]);
      if (!alive) return;
      setSnaps((s ?? []) as Snap[]);
      setPgs(((p ?? []) as PG[]).map((x) => ({ ...x, fpts: Number(x.fpts) })));
    };
    load();
    if (past) return () => { alive = false; };
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; window.clearInterval(i); };
  }, [today, slate.length, past]);

  // every earlier night's bench, for the season tally (tonight's comes from the box scores below)
  useEffect(() => {
    selectAll<BenchDay>('team_bench_daily', 'team_id,date,points,game_type', 1000, ['date', 'team_id', 'game_type'])
      .then((r) => setBenchDays(r.map((x) => ({ ...x, points: Number(x.points) }))), () => setBenchDays([]));
  }, [today]);

  const gameOf = (nhl: string | null) => slate.find((g) => g.home === nhl || g.away === nhl);
  const pgBy = useMemo(() => new Map(pgs.map((p) => [`${p.game_id}:${p.player_id}`, p])), [pgs]);
  // starters tonight: the frozen lineup once a game has started, the current lineup before that
  // one side of a team's night: the frozen lineup once a game has started, the current lineup before that
  const side = (teamId: number, bench: boolean) => {
    const mine = (slot: string) => BENCH.includes(slot) === bench;
    const live = snaps.filter((s) => s.team_id === teamId && mine(s.slot));
    const frozen = new Set(snaps.filter((s) => s.team_id === teamId).map((s) => s.player_id));
    const pending = (past ? [] : rosters).filter((r) => r.team_id === teamId && mine(r.slot) && !frozen.has(r.player_id))
      .map((r) => ({ team_id: teamId, player_id: r.player_id, slot: r.slot, game: gameOf(players.get(r.player_id)?.nhl_team ?? null) }))
      .filter((r) => r.game && !DONE.has(r.game.state) && !LIVE.has(r.game.state));
    return [
      ...live.map((s) => { const g = slate.find((x) => x.id === s.game_id); const pg = pgBy.get(`${s.game_id}:${s.player_id}`); return { ...s, game: g, pg, pts: pg?.fpts ?? 0 }; }),
      ...pending.map((s) => ({ ...s, game_id: s.game!.id, pg: undefined as PG | undefined, pts: 0 })),
    ].sort((a, b) => b.pts - a.pts || (a.game?.start_utc ?? '').localeCompare(b.game?.start_utc ?? ''));
  };
  // the season tally follows the table the night belongs to: playoff nights add up the playoff bench
  const playoffNight = slate.some(isPlayoffGame);
  const rows = useMemo(() => teams.map((t) => {
    const lines = side(t.id, false);
    const benchLines = side(t.id, true);
    const pts = lines.reduce((n, l) => n + l.pts, 0);
    const bench = benchLines.reduce((n, l) => n + l.pts, 0);
    const before = benchDays.filter((b) => b.team_id === t.id && b.date < today && b.game_type === (playoffNight ? 3 : 2)).reduce((n, b) => n + b.points, 0);
    const done = lines.filter((l) => l.game && DONE.has(l.game.state)).length;
    const playing = lines.filter((l) => l.game && LIVE.has(l.game.state)).length;
    return { t, lines, pts, done, playing, left: lines.length - done - playing, benchLines, bench, benchScored: benchLines.some((l) => l.pg), benchSeason: before + bench };
  }).sort((a, b) => b.pts - a.pts || a.t.id - b.t.id), [teams, snaps, rosters, players, slate, pgBy, benchDays, today, playoffNight]); // eslint-disable-line react-hooks/exhaustive-deps
  // one player's line on a team card; bench lines are dimmed and their points shown in amber
  const renderLine = (l: ReturnType<typeof side>[number], bench = false) => {
    const p = players.get(l.player_id);
    const st = l.pg?.stats ?? {};
    const g = l.game;
    const goalie = p?.pos === 'G';
    const line = scoringLine(st, (goalie ? league?.scoring.goalie : league?.scoring.skater) ?? {}, goalie) || 'no scoring yet';
    const mu = g ? matchup(g, l.pg?.nhl_team ?? p?.nhl_team) : null;
    return (
      <Link key={l.player_id} to={`/player/${l.player_id}`} className={`flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/[.03] ${bench ? 'bg-amber-500/[.02]' : ''}`}>
        <Pos p={l.slot} className={`min-w-0 px-1 py-0 ${bench ? 'opacity-60' : ''}`} />
        <span className="min-w-0 flex-1"><span className={`block truncate font-semibold ${bench ? 'text-slate-300' : ''}`}>{p?.name}</span>
          <span className="block truncate text-[11px] text-mute">{l.pg ? line : g ? (LIVE.has(g.state) || DONE.has(g.state) ? 'no scoring yet' : `puck drop ${fmtTime(g.start_utc)}`) : ''}</span></span>
        {mu && (
          <span className="w-[86px] shrink-0 text-right leading-tight">
            <span className="block truncate text-[11px] font-semibold text-slate-200">{mu.teams}</span>
            <span className="block truncate text-[10px]">
              {mu.score && <span className={`num font-bold ${mu.tone}`}>{mu.score}</span>}
              {mu.score && <span className="text-mute"> · </span>}
              <span className={LIVE.has(g!.state) ? 'text-goal' : 'text-mute'}>{mu.status}</span>
            </span>
          </span>
        )}
        <span className={`num w-12 text-right font-bold ${l.pts < 0 ? 'text-red-300' : bench ? 'text-amber-200/90' : ''}`}>{l.pg ? fmtPts(l.pts) : '–'}</span>
      </Link>
    );
  };
  const benchTable = useMemo(() => [...rows].sort((a, b) => b.bench - a.bench || b.benchSeason - a.benchSeason || a.t.id - b.t.id), [rows]);
  const benchAny = rows.some((r) => r.benchScored || r.benchSeason !== 0);
  const scored = standings.some((s) => Number(s.points) !== 0);
  const rankOf = (id: number) => (scored ? standings.find((s) => s.team_id === id)?.rank : undefined);
  const anyLive = slate.some((g) => LIVE.has(g.state));

  return (
    <div className="space-y-4">
      <PageHeader icon={<Radio size={22} className={anyLive ? 'animate-pulse text-goal' : past ? 'text-mute' : 'text-goal'} />} title={past ? 'Scoreboard' : 'Live scoreboard'}
        sub={past ? `${fmtDate(today)} · ${slate.length ? `${slate.length} NHL game${slate.length > 1 ? 's' : ''}, final` : 'no NHL games'}` : slate.length ? `${slate.length} NHL game${slate.length > 1 ? 's' : ''} tonight · updates every minute` : 'No NHL games today.'}
        right={<div className="flex items-center gap-1">
          <button className="btn-ghost btn-sm px-2" aria-label="Previous day" disabled={!!seasonStart && addDays(today, -1) < seasonStart} onClick={() => goTo(addDays(today, -1))}><ChevronLeft size={16} /></button>
          <button className="btn-ghost btn-sm px-2" aria-label="Next day" disabled={!past} onClick={() => goTo(addDays(today, 1))}><ChevronRight size={16} /></button>
          {past && <button className="btn-ghost btn-sm" onClick={() => goTo(leagueDay)}>Tonight</button>}
        </div>} />
      <Link to="/nhl" className="card flex items-center gap-3 p-3 text-sm transition active:scale-[.99]"><span className="text-2xl">🏒</span><span className="flex-1"><span className="font-semibold">Every NHL game, live</span><span className="block text-xs text-mute">Scores, goals with highlight clips, box scores, standings, schedule and team radio.</span></span><span className="text-mute">›</span></Link>
      {past && <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-3 text-sm text-slate-300">A night that is in the books: the lineups as they were locked at each puck drop and every point that counted. Step back further with the arrows, or review any stretch on the <Link to="/performance" className="text-sky-300">Performance page</Link>.</div>}
      {!past && league?.phase !== 'season' && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">The season hasn’t started. Once it does, this page follows every game night live: NHL scores up top, your starters’ points below.</div>}

      {slate.length > 0 && (
        <div className="scroll-x flex gap-2">
          {slate.map((g) => {
            const live = LIVE.has(g.state);
            return (
              <button type="button" key={g.id} onClick={() => setBox(g)} title="Open the box score"
                className={`w-40 shrink-0 rounded-2xl border p-2.5 text-left transition hover:border-sky-400/50 ${live ? 'border-goal/40 bg-goal/[.07]' : 'border-white/[.07] bg-white/[.03]'}`}>
                <div className={`mb-1.5 text-[10px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}{gameLabel(g)}</div>
                {[[g.away, g.away_score], [g.home, g.home_score]].map(([abbr, score]) => (
                  <div key={String(abbr)} className="flex items-center gap-1.5 py-0.5 text-sm"><NhlLogo abbr={String(abbr)} size={18} /><span className="flex-1 font-semibold">{abbr}</span><span className="num font-bold">{score ?? ''}</span></div>
                ))}
                <div className="mt-1 text-[10px] text-sky-300">{live || ['OFF', 'FINAL'].includes(g.state) ? 'Box score ›' : 'Preview ›'}</div>
              </button>
            );
          })}
        </div>
      )}

      <Section title={past ? `Points on ${fmtDate(today)}` : 'Tonight’s points'} right={<span className="text-xs text-mute">tap a team for every starter</span>}>
        <div className="grid items-start gap-2 xl:grid-cols-2">
          {rows.map(({ t, lines, pts, done, playing, left, benchLines, bench, benchScored, benchSeason }, i) => {
            const isOpen = open === t.id;
            const top = lines.filter((l) => l.pg).slice(0, 3);
            return (
              <div key={t.id} id={`sb-${t.id}`} className={`card scroll-mt-20 overflow-hidden ${t.id === me?.id ? 'ring-1 ring-sky-400/40' : ''}`}>
                <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(isOpen ? null : t.id)}>
                  <span className="num w-5 text-center text-sm font-bold text-mute">{i + 1}</span>
                  <TeamBadge team={t} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{t.name} <span className="text-xs font-normal text-mute">· {t.gm_name}{rankOf(t.id) ? ` · ${rankOf(t.id)}${['st', 'nd', 'rd'][(rankOf(t.id)! - 1)] ?? 'th'} overall` : ''}</span></div>
                    <div className="truncate text-xs text-mute">
                      {lines.length === 0 ? (past ? 'No starters with a game' : 'No starters with a game tonight') : `${playing ? `${playing} playing · ` : ''}${done} done · ${left} to come`}
                      {top.length > 0 && <> · {top.map((l) => `${players.get(l.player_id)?.last_name} ${fmtPts(l.pts)}`).join(', ')}</>}
                    </div>
                  </div>
                  <div className="text-right"><div className="num font-display text-2xl font-extrabold" style={{ color: readable(t.color) }}>{fmtPts(pts)}</div><div className="text-[10px] text-mute">{past ? 'that night' : 'tonight'}</div>
                    {benchScored && <div className="num text-[10px] font-semibold text-amber-200" title="Points on the bench and IR: shown, never counted">🪑 {fmtPts(bench)} benched</div>}</div>
                </button>
                {isOpen && (
                  <div className="divide-y divide-white/[.05] border-t border-white/[.06]">
                    {lines.map((l) => renderLine(l))}
                    {lines.length === 0 && <div className="p-3 text-xs text-mute">Nobody in {t.gm_name}’s starting lineup {past ? 'played that night' : 'plays tonight'}.</div>}
                    {benchLines.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 bg-amber-500/[.06] px-3 py-1.5 text-[11px]">
                          <span className="font-semibold uppercase tracking-wider text-amber-200">🪑 Bench & IR</span>
                          <span className="flex-1 text-mute">shown, never counted</span>
                          <span className="num text-amber-200">{fmtPts(bench)} {past ? 'that night' : 'tonight'} · {fmtPts(benchSeason)} {playoffNight ? 'playoffs' : 'season'}</span>
                        </div>
                        {benchLines.map((l) => renderLine(l, true))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {benchAny && (
        <Section title="🪑 Left on the bench" right={<span className="text-xs text-mute">shown, never counted</span>}>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[.04] text-left text-[11px] uppercase tracking-wider text-mute">
                <tr><th className="px-3 py-2">Team</th><th className="px-2 text-right">{past ? 'That night' : 'Tonight'}</th><th className="px-3 text-right" title={`Bench and IR points ${playoffNight ? 'in the playoffs' : 'this regular season'}${past ? ', through that night' : ', tonight included'}`}>{playoffNight ? 'Playoffs' : 'Season'}</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[.06]">
                {benchTable.map(({ t, bench, benchScored, benchSeason, benchLines }) => {
                  const top = benchLines.find((l) => l.pg && l.pts > 0 && players.get(l.player_id));
                  return (
                    <tr key={t.id} className={t.id === me?.id ? 'bg-white/[.05]' : ''}>
                      <td className="px-3 py-2">
                        <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => { setOpen(t.id); document.getElementById(`sb-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                          <TeamBadge team={t} size={26} />
                          <span className="min-w-0"><span className="block truncate font-semibold">{t.gm_name}</span>
                            <span className="block truncate text-[11px] text-mute">{top ? `${players.get(top.player_id)?.last_name ?? players.get(top.player_id)?.name} ${fmtPts(top.pts)} on the bench` : t.name}</span></span>
                        </button>
                      </td>
                      <td className={`num px-2 text-right font-semibold ${bench > 0 ? 'text-amber-200' : 'text-mute'}`}>{benchScored ? fmtPts(bench) : '–'}</td>
                      <td className="num px-3 text-right text-slate-300">{benchSeason ? fmtPts(benchSeason) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Points the bench and IR scored{past ? ' that night' : ' tonight'}, and the {playoffNight ? 'playoff' : 'season'} total{past ? ' through that night' : ' so far'}. Every day of it, team by team, is on the <Link to="/performance" className="text-sky-300">Performance page</Link>.</div>
          </div>
        </Section>
      )}
      <BoxScore game={box ? slate.find((g) => g.id === box.id) ?? box : null} onClose={() => setBox(null)} />
      {past ? <p className="px-1 text-center text-[11px] text-mute">Final box scores. Stat corrections from the NHL can still move a line for up to a month.</p>
        : <p className="px-1 text-center text-[11px] text-mute">Points follow the NHL box scores, which update about once a minute. Last check {new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.</p>}
    </div>
  );
}
