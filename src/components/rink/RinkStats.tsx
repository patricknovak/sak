// The standings for the league's table games: every member who has played, ranked by rating, with their goals, own
// goals, goals against, form and trend, the league's records, and a card per member with everything (lib/rink/stats.ts
// works it all out from the kept games). Rink Duel's are rink_games (migration 352); Rod Hockey's are rod_games
// (migration 354), with shots on goal, so its cards add shooting and save percentages.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Flame, Sparkles, Target, Timer, Trophy, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Team } from '../../lib/types';
import { Section, Sheet, Skeleton, TeamBadge } from '../ui';
import { rinkStats, savePct, shootPct, type LeagueRecords, type PlayerStats, type RinkGameRow, type RinkLevel } from '../../lib/rink/stats';
import { LEVELS as AIR_LEVELS } from '../../lib/rink/ai';
import { LEVELS as ROD_LEVELS } from '../../lib/rod/ai';

export type TableGame = 'air' | 'rod';
const levelsOf = (game: TableGame) => (game === 'rod' ? ROD_LEVELS : AIR_LEVELS);
const levelName = (k: RinkLevel | null, game: TableGame = 'air') => levelsOf(game).find((l) => l.key === k);
const winAtOf = (game: TableGame) => (game === 'rod' ? 5 : 7);
const one = (n: number | null, d = 1) => (n == null ? '—' : n.toFixed(d));
const pctS = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const mins = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const dayS = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function useRinkGames(refresh: number, game: TableGame = 'air') {
  const [rows, setRows] = useState<RinkGameRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    const base = 'id,match_id,home,away,level,home_goals,away_goals,home_own,away_own,home_best,away_best,secs,played_at';
    supabase.from(game === 'rod' ? 'rod_games' : 'rink_games').select(game === 'rod' ? `${base},home_shots,away_shots` : `${base},rally`)
      .order('played_at', { ascending: false }).limit(3000)
      .then(({ data, error }) => {
        if (!live) return;
        // the table arrives with migration 352; before it, the standings simply wait
        if (error) { setMissing(true); setRows([]); return; }
        setRows((data ?? []) as unknown as RinkGameRow[]);
      });
    return () => { live = false; };
  }, [refresh, game]);
  return { rows, missing };
}

export function RinkStats({ teams, me, refresh, game = 'air' }: { teams: Team[]; me: Team; refresh: number; game?: TableGame }) {
  const { rows, missing } = useRinkGames(refresh, game);
  const { players, records } = useMemo(() => rinkStats(rows ?? [], Date.now(), winAtOf(game)), [rows, game]);
  const [open, setOpen] = useState<number | null>(null);
  const team = (id: number | null) => teams.find((t) => t.id === id);
  const pick = players.find((p) => p.team === open) ?? null;

  if (rows == null) return <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (missing || !players.length) {
    return (
      <div className="card p-6 text-center">
        <div className="text-4xl">📊</div>
        <div className="mt-2 font-display text-xl font-extrabold uppercase">{missing ? 'The standings are on their way' : 'No games on the board yet'}</div>
        <p className="mx-auto mt-1 max-w-xs text-sm text-mute">{missing ? 'Every game played from here on will count. Check back soon.' : 'Finish a game against the computer or a member and it lands here: goals, own goals, goals against, the lot.'}</p>
      </div>
    );
  }
  const mine = players.find((p) => p.team === me.id);

  return (
    <div className="space-y-4">
      {mine && <MyLine p={mine} total={players.length} onOpen={() => setOpen(me.id)} />}
      <Records r={records} team={team} game={game} />

      <Section title="The rink standings" icon={<Trophy size={16} />} right={<span className="text-xs text-mute">tap a player</span>}>
        <div className="overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.02]">
          {players.map((p) => {
            const t = team(p.team);
            const diff = p.all.gf - p.all.ga;
            return (
              <button key={p.team} data-rink-row={p.team} onClick={() => setOpen(p.team)} className={`flex w-full items-center gap-2.5 border-b border-white/[.04] px-3 py-2.5 text-left last:border-0 active:bg-white/[.04] ${p.team === me.id ? 'bg-gold/[.07]' : ''}`}>
                <span className={`num grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${p.rank === 1 ? 'bg-gradient-to-b from-gold to-amber-600 text-ice' : p.rank === 2 ? 'bg-slate-300 text-ice' : p.rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/[.06] text-white/70'}`}>{p.rank}</span>
                <TeamBadge team={t} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight [overflow-wrap:anywhere]">{t?.name ?? 'Former member'}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-mute">
                    <span className="num font-bold text-white/85">{Math.round(p.rating)}</span><Trend p={p} />
                    <span className="flex gap-0.5">{p.form.map((f, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${f === 'W' ? 'bg-emerald-400' : 'bg-rose-400'}`} />)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="num block text-sm font-bold">{p.all.w}–{p.all.l}</span>
                  <span className="num block whitespace-nowrap text-[11px] text-mute">{p.all.gf}–{p.all.ga} <span className={diff > 0 ? 'text-emerald-300' : diff < 0 ? 'text-rose-300' : ''}>({diff > 0 ? '+' : ''}{diff})</span></span>
                  <span className="num block whitespace-nowrap text-[11px] text-mute">{p.all.own} OG</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs leading-relaxed text-mute">The rating starts at 1000. Beat someone rated above you and it climbs more; a game against the computer counts against its level at half the weight. Under each record: goals for and against, and OG, own goals (the ones put in your own net).</p>
      </Section>

      <Sheet open={!!pick} onClose={() => setOpen(null)} title={pick ? (team(pick.team)?.name ?? 'Player') : ''} wide>
        {pick && <PlayerCard p={pick} team={team} game={game} />}
      </Sheet>
    </div>
  );
}

function Trend({ p }: { p: PlayerStats }) {
  if (p.trend === 'new') return <span className="rounded bg-sky-400/15 px-1 text-[9px] font-black uppercase text-sky-200">new</span>;
  const I = p.trend === 'up' ? ArrowUpRight : p.trend === 'down' ? ArrowDownRight : ArrowRight;
  return <I size={13} className={p.trend === 'up' ? 'text-emerald-400' : p.trend === 'down' ? 'text-rose-400' : 'text-white/40'} />;
}

function MyLine({ p, total, onOpen }: { p: PlayerStats; total: number; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card relative w-full overflow-hidden p-0 text-left">
      <div className="absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,rgb(var(--gold-rgb)/.22),transparent_60%)]" />
      <div className="relative flex items-center gap-4 p-4">
        <div className="text-center">
          <div className="text-[10px] font-black uppercase tracking-[.16em] text-gold">Your rank</div>
          <div className="num font-display text-5xl font-extrabold leading-none">{p.rank}<span className="text-lg text-mute">/{total}</span></div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className="num font-display text-3xl font-extrabold">{Math.round(p.rating)}</span><span className="text-xs text-mute">rating</span><Trend p={p} /></div>
          <div className="mt-1 text-sm text-white/80">{p.all.w}–{p.all.l} · {p.all.gf} goals, {p.all.ga} against{p.all.own ? ` · ${p.all.own} own` : ''}</div>
          {p.streak && p.streak.n > 1 && <div className={`mt-1 text-xs font-bold ${p.streak.kind === 'W' ? 'text-emerald-300' : 'text-rose-300'}`}>{p.streak.kind === 'W' ? '🔥' : '🧊'} {p.streak.n} {p.streak.kind === 'W' ? 'wins' : 'losses'} in a row</div>}
        </div>
      </div>
    </button>
  );
}

function Records({ r, team, game }: { r: LeagueRecords; team: (id: number | null) => Team | undefined; game: TableGame }) {
  const items: { icon: React.ReactNode; label: string; value: string; who: string }[] = [];
  if (r.hardest) items.push({ icon: <Zap size={15} className="text-gold" />, label: 'Hardest goal', value: `${r.hardest.kmh} km/h`, who: team(r.hardest.team)?.name ?? '' });
  if (r.rally && game === 'air') items.push({ icon: <Flame size={15} className="text-orange-400" />, label: 'Longest rally', value: `${r.rally.n} exchanges`, who: r.rally.teams.map((t) => team(t)?.name ?? '').join(' v ') });
  if (r.rout) items.push({ icon: <Target size={15} className="text-sky-300" />, label: 'Biggest win', value: `${r.rout.gf}–${r.rout.ga}`, who: `${team(r.rout.team)?.name ?? ''} over ${r.rout.vs != null ? team(r.rout.vs)?.name ?? '' : levelName(r.rout.level, game)?.who ?? 'the computer'}` });
  if (r.sniper) items.push({ icon: <Target size={15} className="text-emerald-300" />, label: 'Sniper', value: pctS(r.sniper.pct), who: `${team(r.sniper.team)?.name ?? ''} · ${r.sniper.shots} shots` });
  if (r.wall) items.push({ icon: <span className="text-sm">🧱</span>, label: 'Brick wall', value: `${pctS(r.wall.pct)} saves`, who: `${team(r.wall.team)?.name ?? ''} · ${r.wall.shots} faced` });
  if (r.ownGoals) items.push({ icon: <span className="text-sm">🙈</span>, label: 'Own goal king', value: `${r.ownGoals.n} own goals`, who: team(r.ownGoals.team)?.name ?? '' });
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 px-1 text-xs text-mute">
        <span><b className="num text-white">{r.games}</b> games</span><span><b className="num text-white">{r.duels}</b> duels</span><span><b className="num text-white">{r.goals}</b> goals</span>
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {items.map((x) => (
            <div key={x.label} className="card p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.14em] text-mute">{x.icon}{x.label}</div>
              <div className="num mt-1 font-display text-xl font-extrabold leading-tight">{x.value}</div>
              <div className="text-xs leading-snug text-white/70">{x.who}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[.05] px-3 py-2 ring-1 ring-white/[.07]">
      <div className="text-[10px] font-black uppercase tracking-[.12em] text-mute">{label}</div>
      <div className="num text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-mute">{sub}</div>}
    </div>
  );
}

// a rating's path, game by game
function RatingChart({ path }: { path: { at: number; r: number }[] }) {
  if (path.length < 3) return null;
  const w = 320, h = 90, pad = 6;
  const lo = Math.min(...path.map((p) => p.r)), hi = Math.max(...path.map((p) => p.r));
  const span = Math.max(20, hi - lo);
  const x = (i: number) => pad + (i / (path.length - 1)) * (w - pad * 2);
  const y = (r: number) => h - pad - ((r - lo) / span) * (h - pad * 2);
  const d = path.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  const up = path[path.length - 1].r >= path[0].r;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" preserveAspectRatio="none" aria-label="Rating over time">
      <defs><linearGradient id="rk-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={up ? '#34d399' : '#fb7185'} stopOpacity=".35" /><stop offset="1" stopColor={up ? '#34d399' : '#fb7185'} stopOpacity="0" /></linearGradient></defs>
      <line x1={pad} x2={w - pad} y1={y(1000)} y2={y(1000)} stroke="white" strokeOpacity=".12" strokeDasharray="4 4" />
      <path d={`${d} L${x(path.length - 1)},${h} L${x(0)},${h} Z`} fill="url(#rk-area)" />
      <path d={d} fill="none" stroke={up ? '#34d399' : '#fb7185'} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Delta({ now, then, good = 'up', fmt }: { now: number | null; then: number | null; good?: 'up' | 'down'; fmt: (n: number | null) => string }) {
  const diff = now != null && then != null ? now - then : null;
  const better = diff == null || Math.abs(diff) < 0.01 ? null : (diff > 0) === (good === 'up');
  return (
    <span className="num">
      {fmt(now)}
      {diff != null && better != null && <span className={`ml-1 text-xs font-bold ${better ? 'text-emerald-400' : 'text-rose-400'}`}>{diff > 0 ? '▲' : '▼'}</span>}
      <span className="block text-[11px] font-normal text-mute">before {fmt(then)}</span>
    </span>
  );
}

function PlayerCard({ p, team, game }: { p: PlayerStats; team: (id: number | null) => Team | undefined; game: TableGame }) {
  const t = team(p.team);
  const h2h = [...p.vs.entries()].sort((a, b) => b[1].gp - a[1].gp);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TeamBadge team={t} size={52} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-mute">GM {t?.gm_name} · rank {p.rank}</div>
          <div className="flex items-baseline gap-2"><span className="num font-display text-4xl font-extrabold leading-none">{Math.round(p.rating)}</span><Trend p={p} /><span className="text-xs text-mute">peak {Math.round(p.peak)}</span></div>
        </div>
        <div className="flex gap-1">{p.form.map((f, i) => <span key={i} className={`grid h-6 w-6 place-items-center rounded-md text-[11px] font-black ${f === 'W' ? 'bg-emerald-500/25 text-emerald-200' : 'bg-rose-500/25 text-rose-200'}`}>{f}</span>)}</div>
      </div>
      <RatingChart path={p.path} />

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Played" value={p.all.gp} sub={`${p.duels.gp} duels`} />
        <Tile label="Won–lost" value={`${p.all.w}–${p.all.l}`} sub={pctS(p.all.gp ? p.all.w / p.all.gp : null)} />
        <Tile label="Goal diff" value={`${p.all.gf - p.all.ga > 0 ? '+' : ''}${p.all.gf - p.all.ga}`} />
        <Tile label="Goals" value={p.all.gf} sub={`${one(p.all.gp ? p.all.gf / p.all.gp : null)} a game`} />
        <Tile label="Against" value={p.all.ga} sub={`${one(p.all.gp ? p.all.ga / p.all.gp : null)} a game`} />
        <Tile label="Own goals" value={p.all.own} sub={p.all.own ? `1 every ${one(p.all.gp / p.all.own)} games` : 'clean'} />
        <Tile label="Hardest" value={p.best ? `${p.best}` : '—'} sub="km/h" />
        {game === 'rod'
          ? <Tile label="Shooting" value={pctS(shootPct(p.all))} sub={`${p.all.sf} shots`} />
          : <Tile label="Best rally" value={p.rally} sub="exchanges" />}
        <Tile label="Win streak" value={p.longestWin} sub="longest" />
        <Tile label="Shutouts" value={p.shutouts} />
        <Tile label="Comebacks" value={p.comebacks} sub={`won after ${winAtOf(game) - 2} against`} />
        {game === 'rod' && <Tile label="Saves" value={pctS(savePct(p.all))} sub={`${p.all.sa} faced`} />}
        {game === 'rod' && <Tile label="Shots / game" value={one(p.all.gp ? p.all.sf / p.all.gp : null)} sub={`${one(p.all.gp ? p.all.sa / p.all.gp : null)} against`} />}
        {game === 'rod' && <Tile label="Sharpest" value={p.all.gp ? `${Math.max(...p.games.map((s) => s.sf ? s.gf / Math.max(s.sf, s.gf) : 0)) * 100 | 0}%` : '—'} sub="one game" />}
        <Tile label="On ice" value={<span className="inline-flex items-center gap-1"><Timer size={14} />{mins(p.secs)}</span>} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute"><Sparkles size={13} />The last two weeks</div>
        {p.recent.gp === 0
          ? <div className="rounded-2xl bg-white/[.04] p-3 text-sm text-mute">No games in the last two weeks.</div>
          : (
            <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-4">
              <Tile label="Games" value={p.recent.gp} sub={`rating ${p.recent.ratingMove >= 0 ? '+' : ''}${Math.round(p.recent.ratingMove)}`} />
              <Tile label="Win %" value={<Delta now={p.recent.winPct} then={p.before.winPct} fmt={pctS} />} />
              <Tile label="Goals / game" value={<Delta now={p.recent.gfpg} then={p.before.gfpg} fmt={(n) => one(n)} />} />
              <Tile label="Against / game" value={<Delta now={p.recent.gapg} then={p.before.gapg} good="down" fmt={(n) => one(n)} />} />
            </div>
          )}
      </div>

      {p.cpu.gp > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute">Against the computer</div>
          <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-4">
            {levelsOf(game).map((l) => {
              const x = p.byLevel[l.key];
              return <Tile key={l.key} label={`${l.emoji} ${l.name}`} value={x ? `${x.w}–${x.l}` : '—'} sub={x ? `${x.gf}–${x.ga} goals` : 'not played'} />;
            })}
          </div>
        </div>
      )}

      {h2h.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute">Head to head</div>
          <div className="divide-y divide-white/[.05] rounded-2xl bg-white/[.03] ring-1 ring-white/[.06]">
            {h2h.map(([id, l]) => (
              <div key={id} className="flex items-center gap-2.5 px-3 py-2">
                <TeamBadge team={team(id)} size={26} />
                <span className="min-w-0 flex-1 truncate text-sm">{team(id)?.name ?? 'Former member'}</span>
                <span className={`num text-sm font-bold ${l.w > l.l ? 'text-emerald-300' : l.w < l.l ? 'text-rose-300' : ''}`}>{l.w}–{l.l}</span>
                <span className="num w-14 text-right text-xs text-mute">{l.gf}–{l.ga}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute">Recent games</div>
        <div className="divide-y divide-white/[.05] rounded-2xl bg-white/[.03] ring-1 ring-white/[.06]">
          {p.games.slice(0, 12).map((s) => {
            const lv = levelName(s.level, game);
            return (
              <div key={s.game.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-black ${s.won ? 'bg-emerald-500/25 text-emerald-200' : 'bg-rose-500/25 text-rose-200'}`}>{s.won ? 'W' : 'L'}</span>
                <span className="min-w-0 flex-1 text-sm leading-tight">
                  <span className="block truncate">{s.vs != null ? `v ${team(s.vs)?.name ?? 'Former member'}` : `v ${lv?.emoji ?? ''} ${lv?.who ?? 'the computer'}`}</span>
                  <span className="text-[11px] text-mute">{dayS(s.at)}{s.own ? ` · ${s.own} own goal${s.own > 1 ? 's' : ''}` : ''}{s.best ? ` · ${s.best} km/h` : ''}{game === 'rod' ? ` · ${s.sf}–${s.sa} shots` : ''}</span>
                </span>
                <span className="num text-sm font-bold">{s.gf}–{s.ga}</span>
                <span className={`num w-9 text-right text-[11px] font-bold ${s.after >= s.before ? 'text-emerald-400' : 'text-rose-400'}`}>{s.after >= s.before ? '+' : ''}{Math.round(s.after - s.before)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
