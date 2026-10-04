// Trade analysis and the trade finder, used by the Trades page builder.
import { useEffect, useMemo, useState } from 'react';
import { useSticky } from '../lib/sticky';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { DraftPick, PickupStatus, Player } from '../lib/types';
import { fmtPts } from '../lib/format';
import { buyPlayers, evaluateSide, findTrades, gradeSide, makeValuer, partnerFit, positionRanks, posture, sellPlayers, verdict, POS, type Sched, type Side, type SideEval, type Suggestion, type TeamCtx } from '../lib/trade';
import { playoffDays } from '../lib/forecast';
import { etToday } from '../lib/format';
import { gradeColor } from '../lib/grades';
import { lineFor, minSample, statValue, fmtStat, TIMEFRAMES, type Timeframe } from '../lib/playerstats';
import { useNhlOdds, useProjDetails, useSeasonGames, toneCls, toneIcon } from '../lib/projections';
import { Headshot, Pos, TeamBadge } from './ui';
import { Sparkles } from 'lucide-react';
import { rosPg, scoutNums, trendLabel, useScoutCtx } from './TradeScout';
import { useCategoryValues } from './PlayerFilters';
import { buildModel, perGame as catPerGame, pointsScale } from '../lib/catpickup';
import { rosPerGame } from '../lib/lineup';

// every team's free-agent pickups left, read once and shared by every trade tool on the page
let pkCache: { at: number; rows: PickupStatus[] } | null = null;
export function usePickupStatus() {
  const [rows, setRows] = useState<PickupStatus[]>(pkCache?.rows ?? []);
  useEffect(() => {
    if (pkCache && Date.now() - pkCache.at < 60_000) return;
    supabase.from('pickup_status').select('*').then(({ data }) => { pkCache = { at: Date.now(), rows: (data ?? []) as PickupStatus[] }; setRows(pkCache.rows); });
  }, []);
  return rows;
}

export function useTradeValuer() {
  const { players, season, rosters, teams, league, draft, standings, picks } = useLeague();
  const pk = usePickupStatus();
  const rostered = useMemo(() => new Set(rosters.map((r) => r.player_id)), [rosters]);
  // a category league weighs a trade on its categories, put on a points scale so the grades read the same way
  const cats = league?.categories;
  const perGame = useMemo(() => {
    if (!cats?.length) return undefined;
    const all = [...players.values()];
    const model = buildModel(cats, all, season);
    const rates = new Map(all.map((p) => [p.id, catPerGame(p, season.get(p.id), cats)]));
    const pts = (p: Player) => { const s = season.get(p.id); return rosPerGame(Number(p.proj), p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp); };
    return pointsScale(model, rates, all, (p) => pts(p as Player), rostered) as (p: Player) => number;
  }, [cats, players, season, rostered]);
  const v = useMemo(() => makeValuer(players, season, rostered, Math.max(1, teams.length), draft?.season, perGame), [players, season, rostered, teams.length, draft?.season, perGame]);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const rosterMax = Object.entries(caps).filter(([k]) => k !== 'IR').reduce((t, [, n]) => t + n, 0) || 24;
  // how far along the season is (for buy / sell posture)
  const start = league?.season_start ? new Date(league.season_start).getTime() : 0;
  const end = start ? start + 197 * 86400000 : 0;
  const progress = league?.phase === 'season' && start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 0;
  const rosterOf = (t: number) => rosters.filter((r) => r.team_id === t).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
  // the schedule-aware lineup (daily lineups over the real schedule plus the playoffs), once the schedule loads
  const games = useSeasonGames();
  const nhl = useNhlOdds();
  const sched = useMemo<Sched | undefined>(() => (games && nhl && league
    ? { games, caps, from: etToday(), to: league.season_end ?? undefined, days: playoffDays(nhl), season, cache: new Map(), perGame }
    : undefined), [games, nhl, league, season, perGame]); // eslint-disable-line react-hooks/exhaustive-deps
  // a team as the trade search sees it: roster, who's on IR, pickups left, unused picks
  const ctxOf = (t: number): TeamCtx => ({
    team: t, roster: rosterOf(t), ir: new Set(rosters.filter((r) => r.team_id === t && r.slot === 'IR').map((r) => r.player_id)),
    pickupsLeft: pk.find((x) => x.team_id === t)?.remaining ?? 0, picks: picks.filter((k) => k.team_id === t && !k.player_id),
  });
  const pickupsLeft = (t: number) => pk.find((x) => x.team_id === t)?.remaining ?? 0;
  const irOf = (t: number) => new Set(rosters.filter((r) => r.team_id === t && r.slot === 'IR').map((r) => r.player_id));
  return { v, rosterMax, rosterOf, ctxOf, pickupsLeft, irOf, inSeason: league?.phase === 'season', standings, progress, sched };
}

const d = (n: number) => { const r = Math.round(n); return `${r > 0 ? '+' : ''}${r}`; };
const tone = (n: number) => (n > 2 ? 'text-emerald-300' : n < -2 ? 'text-red-300' : 'text-slate-300');

export function SideCard({ e, name, mine }: { e: SideEval; name: string; mine?: boolean }) {
  const { team } = useLeague();
  return (
    <div className={`rounded-xl border p-2.5 text-sm ${mine ? 'border-sky-400/30 bg-sky-500/[.06]' : 'border-white/[.08] bg-white/[.03]'}`}>
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold"><TeamBadge team={team(e.team)} size={18} />{name}</div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Starters</div><div className={`num font-bold ${tone(e.startersDelta)}`}>{d(e.startersDelta)}</div><div className="num text-[10px] text-mute">{fmtPts(e.startersBefore, 0)} → {fmtPts(e.startersAfter, 0)}</div></div>
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Depth</div><div className={`num font-bold ${tone(e.depthAfter - e.depthBefore)}`}>{d(e.depthAfter - e.depthBefore)}</div><div className="num text-[10px] text-mute">top-6 bench</div></div>
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Value in − out</div><div className={`num font-bold ${tone(e.net / 5)}`}>{d(e.net)}</div><div className="num text-[10px] text-mute">{fmtPts(e.valueIn, 0)} in · {fmtPts(e.valueOut, 0)} out</div></div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {e.pos.filter((p) => Math.abs(p.delta) >= 1).map((p) => <span key={p.pos} className={`flex items-center gap-1 rounded-full bg-white/[.05] px-1.5 py-0.5 text-[11px] ${tone(p.delta)}`}><Pos p={p.pos} className="min-w-0 px-1 py-0" />{d(p.delta)}</span>)}
        {e.pos.every((p) => Math.abs(p.delta) < 1) && <span className="text-[11px] text-mute">No starting spot changes hands.</span>}
      </div>
      {e.drops.length > 0 && <div className="mt-1 text-[11px] text-amber-200">✂️ {e.drops.some((x) => x.named) ? 'Drops' : 'Has to drop'} {e.drops.map((x) => `${x.p.name} (${Math.round(x.value)})`).join(', ')} to stay at {e.rosterAfter} active</div>}
      {e.fills.length > 0 && <div className="mt-1 text-[11px] text-emerald-200">➕ Open spot: {e.fills.map((x) => `${x.p.name} (${Math.round(x.value)})`).join(', ')} from free agency</div>}
      {e.warnings.map((w) => <div key={w} className="mt-1 text-[11px] text-amber-200">⚠️ {w}</div>)}
    </div>
  );
}

// the players a side gets and sends, each with his fantasy points: this season (and per game) and what he projects to
// score the rest of the way, with the totals both ways, so a grade always sits next to the points behind it
function MoveList({ inn, out, c }: { inn: Player[]; out: Player[]; c: ReturnType<typeof useScoutCtx> }) {
  // a category league also weighs each player on its categories (category value, migration 129)
  const cvMap = useCategoryValues();
  const cv = cvMap && cvMap.size ? cvMap : null;
  const cvFmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  const cvSum = (ps: Player[]) => ps.reduce((t, p) => t + (cv?.get(p.id) ?? 0), 0);
  if (!inn.length && !out.length) return null;
  const line = (p: Player) => {
    const n = scoutNums(p, c);
    const now = n.gp ? `${fmtPts(n.fp, 1)} FP · ${n.fpg != null ? n.fpg.toFixed(2) : '–'}/G (${n.gp} GP)` : n.lastGp ? `’25-26 ${fmtPts(n.last, 0)} FP` : `proj ${fmtPts(p.proj, 0)}`;
    return { now, ros: n.ros };
  };
  const total = (ps: Player[]) => ps.reduce((t, p) => { const n = scoutNums(p, c); return { fp: t.fp + n.fp, ros: t.ros + n.ros }; }, { fp: 0, ros: 0 });
  const block = (label: string, ps: Player[], sign: string, cls: string) => ps.length > 0 && (
    <div>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-mute"><span>{label}</span><span className="num normal-case tracking-normal">{fmtPts(total(ps).fp, 0)} FP · {fmtPts(total(ps).ros, 0)} ROS{cv && <> · <b className="text-gold">{cvFmt(cvSum(ps))}</b> cat</>}</span></div>
      {ps.map((p) => { const l = line(p); return (
        <div key={p.id} className="flex items-baseline gap-1.5 text-[12px]">
          <span className={`w-3 shrink-0 font-bold ${cls}`}>{sign}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate"><span className="font-semibold text-slate-100">{p.name}</span> <span className="text-mute">{p.elig.join('/')}</span></div>
            <div className="num text-[11px] text-slate-300">{l.now} · <b className="text-slate-100">{fmtPts(l.ros, 0)}</b> ROS{cv && <> · <b className="text-gold">{cv.get(p.id) != null ? cvFmt(cv.get(p.id)!) : '–'}</b> cat</>}</div>
          </div>
        </div>
      ); })}
    </div>
  );
  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-black/25 p-2">
      {block('Gets', inn, '+', 'text-emerald-300')}
      {block('Sends', out, '−', 'text-red-300')}
    </div>
  );
}

// the live read on whatever is in the builder (or on an offer): grades, what each lineup gains or loses, and
// every player in the deal side by side
export function TradeAnalysis({ sides, compact }: { sides: Side[]; compact?: boolean }) {
  const { me, team, league } = useLeague();
  // the league's own starting lineup, as the forecast plays it: 2C 2LW 2RW 3D 1Util 2G in SaK
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const lineupText = ['C', 'LW', 'RW', 'D', 'Util', 'G'].filter((k) => caps[k]).map((k) => `${caps[k]}${k}`).join(' ');
  const catMode = !!league?.categories?.length;
  const sc = useScoutCtx();
  const { v, rosterMax, sched } = useTradeValuer();
  const details = useProjDetails();
  const evals = useMemo(() => sides.map((s) => evaluateSide(s, v, rosterMax, sched)), [sides, v, rosterMax, sched]);
  const changed = sides.some((s) => s.before.length !== s.after.length || s.picksIn.length || s.picksOut.length || s.after.some((p) => !s.before.includes(p))
    || (s.pickupsIn ?? 0) + (s.pickupsOut ?? 0) + (s.coinsIn ?? 0) + (s.coinsOut ?? 0) > 0);
  if (!changed) return <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-mute">Tick players or picks and the analysis appears here: a grade for each side, what each lineup gains or loses, value both ways, and every player's numbers side by side.</div>;
  const name = (t: number) => (t === me?.id ? 'You' : team(t)?.gm_name ?? 'Them');
  const ageOf = (ps: Player[]) => { const a = ps.map((p) => details?.get(p.id)?.proj_meta?.age).filter((x): x is number => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  const grades = sides.map((s, i) => {
    const out = s.before.filter((p) => !s.after.includes(p)), inn = s.after.filter((p) => !s.before.includes(p));
    return gradeSide(evals[i], { outAge: ageOf(out), inAge: ageOf(inn) });
  });
  const ve = verdict(evals, name);
  const cls = { good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100', ok: 'border-white/10 bg-white/[.04] text-slate-200', warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100', bad: 'border-red-400/30 bg-red-500/10 text-red-100' }[ve.tone];
  const moving = sides.flatMap((s) => s.after.filter((p) => !s.before.includes(p)).map((p) => ({ p, to: s.team, from: sides.find((o) => o.before.includes(p))?.team })));
  return (
    <div className="space-y-2">
      <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${cls}`}>{ve.text}</div>
      <div className={`grid gap-2 ${grades.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {grades.map((g) => (
          <div key={g.team} className={`rounded-xl border p-2.5 ${g.team === me?.id ? 'border-sky-400/30 bg-sky-500/[.06]' : 'border-white/[.08] bg-white/[.03]'}`}>
            <div className="flex items-center gap-2">
              <TeamBadge team={team(g.team)} size={22} />
              <div className="min-w-0 flex-1 text-sm font-semibold">{name(g.team)}<div className="text-[10px] font-normal uppercase tracking-wider text-mute">Trade grade</div></div>
              <div className={`h-display text-4xl leading-none ${gradeColor(g.grade)}`}>{g.grade}</div>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[12px]">{g.notes.map((n) => <li key={n.text} className={toneCls[n.tone]}>{toneIcon[n.tone]} <span className="text-slate-200">{n.text}</span></li>)}</ul>
            {(() => { const s = sides.find((x) => x.team === g.team)!; return <MoveList c={sc} inn={s.after.filter((p) => !s.before.includes(p))} out={s.before.filter((p) => !s.after.includes(p))} />; })()}
          </div>
        ))}
      </div>
      {!compact && <div className={`grid gap-2 ${evals.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {evals.map((e) => <SideCard key={e.team} e={e} name={name(e.team)} mine={e.team === me?.id} />)}
      </div>}
      {moving.length > 0 && <TradeCompare moving={moving} />}
      <p className="px-1 text-[11px] text-mute">Grades weigh the lineup most, then value in and out, then depth, and dock deals that open a hole or take on an injury. Roster spots count: the side that takes in more players than it sends drops its weakest (or the ones its GM names), and the side that sends more gets the best free agent for the open spot if it has a pickup left. Picks are worth about what the player taken there projects to; pickups are worth what the best free agent adds over the weakest player, less for each one already in hand; coins are shown but don't count. Starters = each roster played out day by day over the rest of the real schedule and the playoffs, with the best lineup ({lineupText}) every night, from the projections blended with this season's pace.{catMode ? ' In a category league every number is your categories on a points scale: each player\'s category value (his pace in the league\'s categories against the draftable pool), scaled so a typical rostered skater or goalie is worth his points.' : ''} That's where multi-position players earn their keep: a C/LW fills whichever spot is empty that night. Value counts them about 5% higher.</p>
    </div>
  );
}

// every player in the deal (or in the comparison tray), every number: the outlook (projection and range, rest
// of season, games left, the week ahead, age), the form (this season and the last 7, 14 and 30 days, hot or
// cold against his own pace, last season) and any timeframe's skater or goalie categories. The best value in
// each column is marked, so the comparison reads at a glance.
type CView = 'outlook' | 'form' | 'skater' | 'goalie';
export function TradeCompare({ moving, title = 'Players in the deal', showTo = true, onClear }: { moving: { p: Player; to: number; from?: number }[]; title?: string; showTo?: boolean; onClear?: () => void }) {
  const { team, windows, season } = useLeague();
  const details = useProjDetails();
  const c = useScoutCtx();
  // the view, window and per-game choice carry from one deal to the next, and survive the page refreshing
  const [tf, setTf] = useSticky<Timeframe>('compare:tf', windows.size ? 'season' : 'last');
  const [view, setView] = useSticky<CView>('compare:view', windows.size ? 'form' : 'outlook');
  const [perGame, setPerGame] = useSticky('compare:pg', false);
  const tfOk: Timeframe = !windows.size && TIMEFRAMES.find((x) => x.k === tf)?.live ? 'last' : tf;
  const hasG = moving.some((m) => m.p.pos === 'G'), hasS = moving.some((m) => m.p.pos !== 'G');
  const cols = view === 'outlook' ? ['proj', 'range', 'ros', 'rospg', 'left', 'next7', 'age'] : view === 'form' ? ['gp', 'fp', 'fpg', 'w7', 'w14', 'w30', 'trend', 'last']
    : view === 'skater' ? ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'shpct'] : ['gp', 'w', 'l', 'svp', 'gaa', 'sho', 'sv'];
  const L: Record<string, string> = { proj: 'Proj', range: 'Bad–great year', ros: 'ROS', rospg: 'ROS/G', left: 'Games left', next7: 'Next 7d', age: 'Age', fp: 'FP', fpg: 'FP/G', w7: '7d FP', w14: '14d FP', w30: '30d FP', trend: 'Form', last: '’25-26', gp: 'GP', g: 'G', a: 'A', pts: 'P', pm: '+/-', ppp: 'PPP', sog: 'SOG', hit: 'HIT', blk: 'BLK', pim: 'PIM', shpct: 'S%', w: 'W', l: 'L', svp: 'SV%', gaa: 'GAA', sho: 'SO', sv: 'SV' };
  const list = moving.filter((m) => view === 'outlook' || view === 'form' || (view === 'goalie' ? m.p.pos === 'G' : m.p.pos !== 'G'));
  // the sortable number behind each cell, so the best in a column can be marked (lower wins for the stats that hurt)
  const raw = (p: Player, k: string): number | null => {
    const n = scoutNums(p, c);
    const line = lineFor(p, tfOk, windows.get(p.id), season.get(p.id));
    switch (k) {
      case 'proj': return p.proj; case 'range': return null; case 'ros': return n.ros; case 'rospg': return rosPg(p, c); case 'left': return n.left; case 'next7': return n.next7; case 'age': return null;
      case 'fp': return view === 'form' ? n.fp : line ? line.fp : null; case 'fpg': return view === 'form' ? n.fpg : line?.gp ? line.fp / line.gp : null;
      case 'w7': return n.w['7']?.fp ?? null; case 'w14': return n.w['14']?.fp ?? null; case 'w30': return n.w['30']?.fp ?? null; case 'trend': return n.trend; case 'last': return n.last;
      case 'gp': return view === 'form' ? n.gp : line?.gp ?? null;
      default: return statValue(line, k, perGame, minSample(tfOk));
    }
  };
  const lower = new Set(['l', 'gaa', 'pim']);
  const best = (k: string) => { const vs = list.map((m) => raw(m.p, k)).filter((v): v is number => v != null); return vs.length > 1 ? (lower.has(k) ? Math.min(...vs) : Math.max(...vs)) : null; };
  const cell = (p: Player, k: string) => {
    const n = scoutNums(p, c);
    const line = lineFor(p, tfOk, windows.get(p.id), season.get(p.id));
    if (k === 'proj') return fmtPts(p.proj, 0);
    if (k === 'range') return n.lo != null ? `${fmtPts(n.lo, 0)}–${fmtPts(n.hi, 0)}` : '–';
    if (k === 'ros') return fmtPts(n.ros, 0);
    if (k === 'rospg') return rosPg(p, c).toFixed(2);
    if (k === 'left') return n.left || '–';
    if (k === 'next7') return String(n.next7);
    if (k === 'age') return n.age ?? '–';
    if (k === 'w7' || k === 'w14' || k === 'w30') { const x = n.w[k.slice(1) as '7' | '14' | '30']; return x ? `${fmtPts(x.fp, 0)} (${x.gp})` : '–'; }
    if (k === 'trend') { const t = trendLabel(n.trend); return t ? <span className={t.cls}>{t.icon} {t.text}</span> : '–'; }
    if (k === 'last') return n.lastGp ? `${fmtPts(n.last, 0)} (${n.lastGp})` : '–';
    if (view === 'form' && k === 'gp') return n.gp || '–';
    if (view === 'form' && k === 'fp') return n.gp ? fmtPts(n.fp, 0) : '–';
    if (view === 'form' && k === 'fpg') return n.fpg != null ? n.fpg.toFixed(2) : '–';
    if (k === 'fp') return line ? fmtPts(line.fp, 0) : '–';
    if (k === 'fpg') return line?.gp ? (line.fp / line.gp).toFixed(2) : '–';
    return fmtStat(statValue(line, k, perGame && k !== 'gp', minSample(tfOk)), k, perGame && k !== 'gp');
  };
  return (
    <div className="overflow-hidden rounded-xl border border-white/[.08]">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/[.06] bg-white/[.02] p-2">
        <span className="label mr-1">{title}</span>
        {(['form', 'outlook', ...(hasS ? ['skater'] : []), ...(hasG ? ['goalie'] : [])] as CView[]).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${view === v ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{v === 'form' ? '📈 Form' : v === 'outlook' ? '🔭 Outlook' : v === 'skater' ? 'Skater stats' : 'Goalie stats'}</button>)}
        {(view === 'skater' || view === 'goalie') && <>
          <span className="mx-1 h-4 w-px bg-white/10" />
          {TIMEFRAMES.filter((x) => x.k !== 'proj' && x.k !== 'ros').map((x) => <button key={x.k} disabled={x.live && !windows.size} title={x.label} onClick={() => setTf(x.k)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-35 ${tfOk === x.k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`}>{x.short}</button>)}
          <button onClick={() => setPerGame(!perGame)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${perGame ? 'bg-emerald-500 text-ice' : 'bg-white/[.05] text-mute'}`}>Per game</button>
        </>}
        {onClear && <button onClick={onClear} className="ml-auto text-[11px] text-sky-300">Clear</button>}
      </div>
      <div className="scroll-x">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-mute"><tr><th className="px-2 py-1.5 text-left">Player</th>{showTo && <th className="px-2 text-left">To</th>}{cols.map((k) => <th key={k} className="whitespace-nowrap px-2 text-right">{L[k]}</th>)}</tr></thead>
          <tbody className="divide-y divide-white/[.05]">
            {list.map(({ p, to }) => {
              const f = details?.get(p.id)?.proj_meta?.factors ?? [];
              return (
                <tr key={p.id} className="align-top">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5"><Headshot p={p} size={24} /><div className="min-w-0"><div className="truncate font-semibold">{p.name}</div><div className="text-[10px] text-mute">{p.elig.join('/')} · {p.nhl_team}{!showTo && <> · {team(to)?.abbrev}</>}{p.injury_status && <span className="text-red-300"> · {p.injury_status}</span>}</div></div></div>
                    {view === 'outlook' && f.length > 0 && <ul className="mt-1 max-w-[260px] space-y-0.5 text-[10px] leading-snug">{f.slice(0, 3).map((x) => <li key={x.text} className={toneCls[x.tone]}>{toneIcon[x.tone]} <span className="text-slate-300">{x.text}</span></li>)}</ul>}
                  </td>
                  {showTo && <td className="whitespace-nowrap px-2 py-1.5"><span className="flex items-center gap-1"><TeamBadge team={team(to)} size={16} />{team(to)?.abbrev}</span></td>}
                  {cols.map((k) => { const b = best(k); const v = raw(p, k); const top = b != null && v != null && v === b; return <td key={k} className={`num whitespace-nowrap px-2 py-1.5 text-right ${top ? 'font-bold text-gold' : ''}`}>{cell(p, k)}</td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/[.06] px-2 py-1 text-[10px] text-mute">Gold marks the best in each column. Form: the last 14 days per game against his own pace this season (or his projection early on). ROS blends the projection with this season's pace as games pile up.</div>
    </div>
  );
}

// what the "Build this" button hands the builder: the partner and everything in the deal
export interface BuildSpec { partner: number; give: Player[]; get: Player[]; givePicks?: DraftPick[]; getPicks?: DraftPick[]; givePk?: number; getPk?: number }
export const specOf = (s: Suggestion): BuildSpec => ({ partner: s.partner, give: s.give, get: s.get, givePicks: s.givePicks, getPicks: s.getPicks, givePk: s.givePk, getPk: s.getPk });

const pickName = (k: DraftPick) => `${k.season} R${k.round} pick`;
// one side of a suggestion in words: players, picks and pickups
export const assetsText = (ps: Player[], ks: DraftPick[], pk: number) => {
  const parts = [...ps.map((p) => p.name), ...ks.map(pickName), ...(pk ? [`${pk} pickup${pk > 1 ? 's' : ''}`] : [])];
  return parts.length ? parts.join(' + ') : 'nothing';
};

// position chips: any, or a set of positions
function PosChips({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const chip = (on: boolean) => `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`;
  return (
    <div className="scroll-x flex items-center gap-1">
      <span className="label mr-1 shrink-0">{label}</span>
      <button className={chip(!value.length)} onClick={() => onChange([])}>Any</button>
      {POS.map((p) => <button key={p} className={chip(value.includes(p))} onClick={() => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p])}>{p}</button>)}
    </div>
  );
}

// one suggested deal, with the numbers that matter and what happens to the roster spots
export function SuggestionRow({ s, onBuild }: { s: Suggestion; onBuild: (b: BuildSpec) => void }) {
  const { team } = useLeague();
  const who = team(s.partner)?.gm_name ?? 'them';
  const spots = [
    ...s.me.drops.map((x) => `you drop ${x.p.name}`), ...s.me.fills.map((x) => `you add ${x.p.name} from free agency`),
    ...s.them.drops.map((x) => `${who} drops ${x.p.name}`), ...s.them.fills.map((x) => `${who} adds ${x.p.name} from free agency`),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
      <TeamBadge team={team(s.partner)} size={22} />
      <div className="min-w-0 flex-1">
        <div><span className="text-mute">You send</span> <b>{assetsText(s.give, s.givePicks, s.givePk)}</b> <span className="text-mute">for</span> <b>{assetsText(s.get, s.getPicks, s.getPk)}</b> <span className="text-mute">from {who}</span></div>
        <div className="text-[11px] text-mute">Your starters <span className={`num font-semibold ${tone(s.me.startersDelta)}`}>{d(s.me.startersDelta)}</span> · theirs <span className={`num font-semibold ${tone(s.them.startersDelta)}`}>{d(s.them.startersDelta)}</span> · value to you <span className="num">{d(s.me.net)}</span> · to them <span className="num">{d(s.them.net)}</span></div>
        <div className="text-[11px]">
          {s.me.pos.filter((p) => p.delta >= 3).length > 0 && <span className="mr-2 text-emerald-200">You: stronger at {s.me.pos.filter((p) => p.delta >= 3).map((p) => p.pos).join(', ')}.</span>}
          {s.them.startersDelta > 1 && <span className="text-sky-200">{who}: {s.them.pos.filter((p) => p.delta >= 3).length ? `stronger at ${s.them.pos.filter((p) => p.delta >= 3).map((p) => p.pos).join(', ')}` : 'a better lineup'}.</span>}
          {(s.givePicks.length > 0 || s.givePk > 0 || s.getPicks.length > 0 || s.getPk > 0) && s.kind === 'swap' && <span className="ml-1 text-gold">The {[...s.givePicks, ...s.getPicks].length ? 'pick' : 'pickups'} even{[...s.givePicks, ...s.getPicks].length + (s.givePk || s.getPk ? 1 : 0) > 1 ? '' : 's'} out the value.</span>}
        </div>
        {spots.length > 0 && <div className="text-[11px] text-amber-100/80">Roster spots: {spots.join('; ')}.</div>}
      </div>
      <button className="btn-ghost btn-sm shrink-0" onClick={() => onBuild(specOf(s))}>Build this</button>
    </div>
  );
}

// deals the computer likes: swaps that help both lineups, a player sold for picks and pickups, or a player bought with them
export function TradeFinder({ onBuild }: { onBuild: (b: BuildSpec) => void }) {
  const { me, teams, team, players, standings } = useLeague();
  const { v, rosterMax, rosterOf, ctxOf, progress, inSeason, sched } = useTradeValuer();
  const [mode, setMode] = useState<'swap' | 'sell' | 'buy'>('swap');
  const [partner, setPartner] = useState<number | 'any'>('any');
  const [winWin, setWinWin] = useState(true);
  const [balance, setBalance] = useState(true);
  const [wantPos, setWantPos] = useState<string[]>([]);
  const [givePos, setGivePos] = useState<string[]>([]);
  const [sell, setSell] = useState<number[]>([]);
  const [res, setRes] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stance = me && inSeason ? posture(me.id, standings, progress) : null;
  const my = me ? rosterOf(me.id) : [];
  const reset = () => setRes(null);
  const run = () => {
    if (!me) return;
    setBusy(true);
    setTimeout(() => {
      const partners = teams.filter((t) => t.id !== me.id && (partner === 'any' || t.id === partner)).map((t) => ctxOf(t.id));
      const mine = ctxOf(me.id);
      const limit = partner === 'any' ? 12 : 10;
      if (mode === 'swap') setRes(findTrades(mine, partners, v, rosterMax, { limit, winWin, sched, wantPos, givePos, balance }));
      else if (mode === 'sell') setRes(sell.length ? sellPlayers(mine, sell.map((id) => players.get(id)).filter((p): p is Player => !!p), partners, v, rosterMax) : []);
      else setRes(buyPlayers(mine, partners, v, rosterMax, { wantPos, limit }));
      setBusy(false);
    }, 30);
  };
  const weakest = useMemo(() => {
    if (!me) return null;
    const e = evaluateSide({ team: me.id, before: my, after: my, picksIn: [], picksOut: [] }, v, rosterMax);
    const all = teams.map((t) => evaluateSide({ team: t.id, before: rosterOf(t.id), after: rosterOf(t.id), picksIn: [], picksOut: [] }, v, rosterMax));
    return e.pos.map((p) => { const vals = all.map((a) => a.pos.find((x) => x.pos === p.pos)!.before); const rank = vals.filter((x) => x > p.before).length + 1; return { pos: p.pos, rank }; }).sort((a, b) => b.rank - a.rank);
  }, [me?.id, rosters_key(my), teams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const blurb = {
    swap: `Searches 1-for-1, 2-for-1, 1-for-2 and 2-for-2 swaps. ${winWin ? 'Win-win: both starting lineups have to get better and the value has to stay close, so the other GM has a reason to say yes. Fairest deals first.' : 'Any deal that makes your lineup better without making theirs much worse.'}${balance ? ' A close deal gets the smallest pick or pickups that evens it out.' : ''}`,
    sell: 'Pick who you want to move. For every GM, the best fair package of their draft picks and free-agent pickups, no player back, ranked by how much he helps their lineup.',
    buy: 'Players who make your lineup better, and the cheapest fair price for each in your picks and pickups (with one of your bench players if it takes it), best value first.',
  }[mode];
  const tab = (k: typeof mode, label: string) => <button key={k} className={`tab ${mode === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => { setMode(k); reset(); }}>{label}</button>;
  return (
    <div className="card space-y-2 p-3">
      <div>
        <div className="flex items-center gap-1.5 font-semibold"><Sparkles size={16} className="text-gold" /> Trade finder</div>
        <div className="mt-1.5 flex gap-1">{tab('swap', 'Swap players')}{tab('sell', 'Sell a player')}{tab('buy', 'Buy a player')}</div>
        <div className="mt-1.5 text-xs text-mute">{blurb}{weakest && weakest[0] && <> Your weakest spot in the league: <b>{weakest[0].pos}</b> (#{weakest[0].rank} of {teams.length}).</>}</div>
        {stance && <div className={`mt-1 text-xs ${stance.mode === 'sell' ? 'text-amber-200' : 'text-emerald-200'}`}>📈 {stance.text}</div>}
      </div>
      {mode !== 'sell' && <PosChips label="You want" value={wantPos} onChange={(x) => { setWantPos(x); reset(); }} />}
      {mode === 'swap' && <PosChips label="You'll move" value={givePos} onChange={(x) => { setGivePos(x); reset(); }} />}
      {mode === 'sell' && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {sell.map((id) => <button key={id} className="flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-xs" onClick={() => { setSell(sell.filter((x) => x !== id)); reset(); }}>{players.get(id)?.name} ✕</button>)}
          </div>
          {sell.length < 2 && (
            <select className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" value="" onChange={(e) => { if (e.target.value) { setSell([...sell, Number(e.target.value)]); reset(); } }}>
              <option value="">{sell.length ? 'Add a second player (optional)' : 'Who are you selling?'}</option>
              {[...my].filter((p) => !sell.includes(p.id)).sort((a, b) => v.player(b) - v.player(a)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.elig.join('/')} · {Math.round(v.player(p))} pts ROS</option>)}
            </select>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" value={partner} onChange={(e) => { setPartner(e.target.value === 'any' ? 'any' : Number(e.target.value)); reset(); }}>
          <option value="any">Any GM</option>
          {teams.filter((t) => t.id !== me?.id).map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.gm_name}</option>)}
        </select>
        {mode === 'swap' && <>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={winWin} onChange={(e) => { setWinWin(e.target.checked); reset(); }} />Win-win only</label>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={balance} onChange={(e) => { setBalance(e.target.checked); reset(); }} />Even out with picks or pickups</label>
        </>}
        <button className="btn-gold btn-sm" disabled={busy || (mode === 'sell' && !sell.length)} onClick={run}>{busy ? 'Thinking…' : res ? 'Search again' : mode === 'sell' ? 'Find buyers' : mode === 'buy' ? 'Find players' : 'Find trades'}</button>
      </div>
      {res && res.length === 0 && <div className="rounded-xl bg-white/[.04] p-3 text-sm text-mute">{mode === 'swap'
        ? <>Nothing that clears the bar{partner === 'any' ? '' : ` with ${team(partner as number)?.gm_name}`}{winWin ? ': no swap makes both lineups better at a fair price. Untick Win-win only, or widen the positions.' : '. Try another GM, or build one by hand and read the analysis.'}</>
        : mode === 'sell' ? 'No GM has a fair package of picks and pickups for that, or he wouldn’t help their lineup. Try a swap instead, or add a second player.'
        : 'Nobody available makes your lineup better at a price your picks and pickups can pay. Try another position or a swap.'}</div>}
      {res && res.length > 0 && (
        <div className="divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.08]">
          {res.map((s, i) => <SuggestionRow key={i} s={s} onBuild={onBuild} />)}
        </div>
      )}
      {!res && players.size === 0 && <div className="text-xs text-mute">Loading players…</div>}
    </div>
  );
}

// who needs what: every team's rank at each position, and the partners whose strengths cover your weak spots while
// your strengths cover theirs
export function TradeFit({ onPick }: { onPick?: (partner: number) => void }) {
  const { me, teams, team } = useLeague();
  const { v, ctxOf } = useTradeValuer();
  const ranks = useMemo(() => positionRanks(teams.map((t) => ctxOf(t.id)), v), [teams, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = me ? partnerFit(me.id, ranks, teams.length).slice(0, 3) : [];
  const cls = (r: number) => (r <= 2 ? 'bg-emerald-500/25 text-emerald-100' : r >= teams.length - 1 ? 'bg-red-500/20 text-red-100' : 'bg-white/[.04] text-slate-300');
  const order = [...teams].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
  return (
    <div className="card space-y-2 p-3">
      <div className="text-xs text-mute">Where every team ranks at each position (1 = deepest), from the players it would start. Green is a strength to trade from, red a need to trade for.</div>
      <div className="scroll-x">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-mute"><tr><th className="py-1 text-left">Team</th>{POS.map((p) => <th key={p} className="px-1 text-center">{p}</th>)}</tr></thead>
          <tbody>
            {order.map((t) => (
              <tr key={t.id} className={t.id === me?.id ? 'font-semibold' : ''}>
                <td className="whitespace-nowrap py-0.5 pr-2"><span className="flex items-center gap-1"><TeamBadge team={t} size={16} />{t.id === me?.id ? 'You' : t.gm_name}</span></td>
                {POS.map((p) => { const r = ranks.get(t.id)?.[p] ?? 0; return <td key={p} className="px-0.5 py-0.5 text-center"><span className={`num inline-block min-w-7 rounded px-1 ${cls(r)}`}>{r}</span></td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fit.length > 0 && (
        <div className="space-y-1">
          <div className="label">Best fits for you</div>
          {fit.map((f) => (
            <button key={f.team} className="flex w-full items-center gap-2 rounded-lg bg-white/[.03] px-2 py-1.5 text-left text-xs hover:bg-white/[.06]" onClick={() => onPick?.(f.team)}>
              <TeamBadge team={team(f.team)} size={18} />
              <span className="min-w-0 flex-1"><b>{team(f.team)?.gm_name}</b>{f.theyGive.length ? <> can spare <b>{f.theyGive.join(', ')}</b></> : ''}{f.theyGive.length && f.youGive.length ? ' and' : ''}{f.youGive.length ? <> needs <b>{f.youGive.join(', ')}</b>, where you're deep</> : ''}{!f.theyGive.length && !f.youGive.length ? ' is built a lot like you' : ''}.</span>
              {onPick && <span className="text-sky-300">Trade ›</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
const rosters_key = (ps: Player[]) => ps.map((p) => p.id).join(',');

export type { Side, DraftPick };
