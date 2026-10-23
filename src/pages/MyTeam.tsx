// A team's page (#/team, #/team/:id): the hero, tonight's card and every lineup view in one place. Since 11 October
// 2026 it holds what Lineup New tried beside it: the lineup with an undo after every move, What if, the best lineup as
// a list of changes, warnings that fix in a tap and each player's line; the week grid; Daily lineups; the whole league
// on one board; any two lineups side by side; the insights; and the stats. Another team's page opens on scouting, with
// the same views read only.
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { useSticky } from '../lib/sticky';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLeague, useNow, useSport } from '../lib/store';
import { bestBall } from '../lib/features';
import { calledOff, hasStarted, isFinal, isLive } from '../lib/sport';
import { rpc, supabase } from '../lib/supabase';
import type { Player, Roster, Slot, Transaction } from '../lib/types';
import { ago, etToday, fmtPts, fmtTime, ordinal } from '../lib/format';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { TeamScout } from '../components/TeamScout';
import { TIMEFRAMES, lineFor, type Timeframe } from '../lib/playerstats';
import { LineupTools } from '../components/LineupTools';
import { Section, TeamBadge, TeamName, useAction } from '../components/ui';
import { irOk } from '../lib/lineup';
import { useLineupKit, useDayPoints, useLines, hurt, longDay, monthDay, weekday, type Kit } from '../lib/lineupKit';
import { GameLine, SaveProvider, SlotPill, diffMoves, fmt1, useSave } from '../components/lineup/bits';
import { OptimizeSheet } from '../components/lineup/OptimizeSheet';
import { SitStart, useSitStart, type Swap } from '../components/SitStart';

// the lineup (the page's first view) comes with the page; every other view, and the full-year forecast at the foot of
// it, loads the first time it's opened, so a GM checking tonight's lineup doesn't wait for the stats and the planner
const TeamStats = lazy(() => import('../components/TeamStats').then((m) => ({ default: m.TeamStats })));
const LineupPlanner = lazy(() => import('../components/LineupPlanner').then((m) => ({ default: m.LineupPlanner })));
const TeamForecastCard = lazy(() => import('../components/TeamForecast').then((m) => ({ default: m.TeamForecastCard })));
const WeekView = lazy(() => import('../components/lineup/WeekView').then((m) => ({ default: m.WeekView })));
const LeagueView = lazy(() => import('../components/lineup/LeagueView').then((m) => ({ default: m.LeagueView })));
const CompareView = lazy(() => import('../components/lineup/CompareView').then((m) => ({ default: m.CompareView })));
const InsightsView = lazy(() => import('../components/lineup/InsightsView').then((m) => ({ default: m.InsightsView })));
// what shows while one of them loads: a card the shape of a view, in the page's own colours
function ViewLoading({ tall = true }: { tall?: boolean }) {
  return <div className={`card animate-pulse ${tall ? 'h-72' : 'h-32'}`} />;
}

const STARTERS: Slot[] = ['C', 'LW', 'RW', 'D', 'Util', 'G'];

const slotOk = (p: Player, s: Slot) =>
  s === 'BN' ? true : s === 'IR' ? irOk(p.injury_status) : s === 'Util' ? p.pos !== 'G' : s === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(s);   // IR: injury report only, not suspensions

type View = 'scout' | 'lineup' | 'week' | 'plan' | 'league' | 'compare' | 'insights' | 'stats';
// the views that stay open while a GM flicks from team to team (the lineup and scouting follow whose page it is)
const KEEP: View[] = ['plan', 'stats', 'week', 'league', 'compare', 'insights'];
type Row = { r: Roster; p: Player };

// the lineup kit (tonight's games, expected points, every team's lineups a month ahead) and saving with an undo wrap
// the whole page, so every view saves the same way
export default function MyTeam() {
  const kit = useLineupKit(30);
  return <SaveProvider kit={kit}><TeamPage kit={kit} /></SaveProvider>;
}

function TeamPage({ kit }: { kit: Kit }) {
  const { id } = useParams();
  const { me, league, teams, team, rosters, players, standings, season, windows, games, gamesByTeam, gameStatus, refresh } = useLeague();
  const sport = useSport();
  const now = useNow(15_000);
  const nav = useNavigate();
  const { busy, run } = useAction();
  const teamId = id ? Number(id) : me?.id;
  const t = team(teamId);
  const mine = teamId === me?.id;
  const [sel, setSel] = useState<number | null>(null);
  const [info, setInfo] = useState<number | null>(null);
  // what if: trial moves kept on this phone, slot by player, until the GM saves or throws them away
  const [trial, setTrial] = useState<Map<number, string> | null>(null);
  const [opt, setOpt] = useState(false);
  // the day Daily lineups opens on when the week grid or the insights send a GM there
  const [planDay, setPlanDay] = useState<string | undefined>(undefined);
  // your own team remembers which tab you were on (another team's page always opens on the scouting view)
  const [view, setView] = useSticky<View>(id ? null : 'myteam:view', id ? 'scout' : 'lineup');
  // moving from team to team keeps the daily lineups, the stats, the week, the league, the comparison or the insights
  // open, so a GM can flick through every team's; a jump from the league board asks for a view of its own
  const nextView = useRef<View | null>(null);
  useEffect(() => {
    const n = nextView.current;
    nextView.current = null;
    setView((v) => n ?? (KEEP.includes(v) ? v : teamId === me?.id ? 'lineup' : 'scout'));
    setSel(null); setTrial(null);
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTeam = (tid: number, v: View) => {
    if (tid === teamId) { setView(v); return; }
    nextView.current = v;
    nav(tid === me?.id ? '/team' : `/team/${tid}`);
  };
  const [tx, setTx] = useState<Transaction[]>([]);
  const [pk, setPk] = useState<{ used: number; allowed: number } | null>(null);
  useEffect(() => { if (teamId) supabase.from('pickup_status').select('used,allowed').eq('team_id', teamId).maybeSingle().then(({ data }) => setPk(data as { used: number; allowed: number } | null)); }, [teamId, rosters]);
  // the stat line under each player in the lineup
  const liveOk = windows.size > 0;
  const [tf, setTf] = useSticky<Timeframe>('myteam:tf', league?.phase === 'season' ? 'season' : 'last');
  const tfOk: Timeframe = !liveOk && TIMEFRAMES.find((x) => x.k === tf)?.live ? 'last' : tf;
  // the stat line under each player, as pieces that wrap on a narrow phone rather than being cut off; fantasy points
  // first, the number that counts
  const statLine = (p: Player): string[] | null => {
    const l = lineFor(p, tfOk, windows.get(p.id), season.get(p.id));
    if (!l || tfOk === 'proj' || tfOk === 'ros') return null;
    const t = l.totals;
    if (!l.gp) return ['no games'];
    const fp = `${fmtPts(l.fp, 1)} FP`;
    return p.pos === 'G'
      ? [fp, `${l.gp} GP`, `${t.w ?? 0}-${t.l ?? 0}-${t.otl ?? 0}`, `${t.sa ? ((t.sv ?? 0) / t.sa).toFixed(3).replace(/^0/, '') : '–'} SV%`, `${((t.ga ?? 0) / l.gp).toFixed(2)} GAA`]
      : [fp, `${l.gp} GP`, `${t.g ?? 0} G ${t.a ?? 0} A`, `${t.pm != null && t.pm > 0 ? '+' : ''}${t.pm ?? 0} +/-`, `${t.sog ?? 0} SOG`, `${t.hit ?? 0} H ${t.blk ?? 0} B`];
  };
  const [tools, setTools] = useState(false);

  // the roster as saved, and as the page draws it: in What if, each player in his trial slot
  const saved0 = useMemo(() => rosters.filter((r) => r.team_id === teamId).map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p), [rosters, players, teamId]);
  const saved = useMemo(() => new Map(saved0.map((x) => [x.p.id, x.r.slot as string])), [saved0]);
  const roster = useMemo(() => (trial ? saved0.map((x) => ({ r: { ...x.r, slot: (trial.get(x.p.id) ?? x.r.slot) as Slot }, p: x.p })) : saved0), [saved0, trial]);
  const slots = trial ?? saved;
  const { save, busy: saving } = useSave();

  const PIN_NEXT: Record<string, 'start' | 'bench' | null> = { none: 'start', start: 'bench', bench: null };
  const cyclePin = (x: Row) => {
    const next = PIN_NEXT[x.r.pin ?? 'none'];
    run(async () => { await rpc('set_pin', { p_player: x.p.id, p_pin: next }); await refresh(['rosters']); },
      next === 'start' ? `📌 ${x.p.name} always starts when he plays` : next === 'bench' ? `🚫 ${x.p.name} stays on the bench` : `${x.p.name} unpinned`);
  };

  // tonight's points so far, read again every minute while a game is on, and each player's line from the shift charts
  const { pts: today } = useDayPoints(kit, kit.today);
  const lines = useLines(kit, teamId ? [teamId] : [], kit.today);

  // the views a GM can open here: Week, League, Compare and Insights are about the season's games
  const inSeason = league?.phase === 'season';
  const tabs: { k: View; label: string }[] = [
    ...(!mine ? [{ k: 'scout' as View, label: me?.role === 'spectator' ? '🔍 Scout' : '🔍 Scout & trade' }] : []),
    { k: 'lineup', label: '🏒 Lineup' },
    ...(inSeason ? [{ k: 'week' as View, label: '🗓️ Week' }] : []),
    ...(league?.phase !== 'keepers' ? [{ k: 'plan' as View, label: '📅 Daily lineups' }] : []),
    ...(inSeason ? [{ k: 'league' as View, label: '🏆 League' }, { k: 'compare' as View, label: '⚖️ Compare' }, { k: 'insights' as View, label: '💡 Insights' }] : []),
    { k: 'stats', label: '📊 Stats' },
  ];
  const cur: View = tabs.some((x) => x.k === view) ? view : mine ? 'lineup' : 'scout';
  // trial moves belong to the lineup: leaving it throws them away
  useEffect(() => { if (cur !== 'lineup') setTrial(null); }, [cur]);
  // the open tab scrolled into the row, so a remembered Insights isn't hidden off the right edge of a phone
  const tabRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tabRow.current, b = el?.querySelector<HTMLElement>('[data-on="1"]');
    if (el && b && (b.offsetLeft - el.offsetLeft < el.scrollLeft || b.offsetLeft - el.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = b.offsetLeft - el.offsetLeft - 16;
  }, [cur]);
  // the lineups ahead: the team on screen always, every team's once the league board or a comparison is open
  const gmIds = teams.filter((x) => x.role !== 'spectator').map((x) => x.id);
  useEffect(() => { if (teamId) kit.loadPlans([teamId]); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cur === 'league' || cur === 'compare') kit.loadPlans(gmIds); }, [cur, gmIds.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // the comparison opens against the team just above in the standings (the one to catch), else the next one down
  const [other, setOther] = useState<number | null>(null);
  useEffect(() => {
    if (!teamId || (other && other !== teamId)) return;
    const order = [...standings].sort((a, b) => a.rank - b.rank).map((x) => x.team_id);
    const i = order.indexOf(teamId);
    setOther((i >= 0 ? order[i - 1] ?? order[i + 1] : undefined) ?? gmIds.find((x) => x !== teamId) ?? null);
  }, [teamId, other, standings]); // eslint-disable-line react-hooks/exhaustive-deps
  // a day picked on the week grid or in the insights: today is the lineup, a day ahead its daily lineup
  const openDay = (d: string) => { if (d <= kit.today) setView('lineup'); else { setPlanDay(d); setView('plan'); } };

  useEffect(() => {
    if (!teamId) return;
    supabase.from('transactions').select('*').eq('team_id', teamId).order('id', { ascending: false }).limit(15).then(({ data }) => setTx((data ?? []) as Transaction[]));
  }, [teamId, rosters.length]);

  // games left this week (through Sunday, Eastern) for position planning
  const weekEnd = (() => { const d = new Date(etToday() + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.toISOString().slice(0, 10); })();
  const weekGames = (nhl: string | null) => games.filter((g) => g.date >= etToday() && g.date <= weekEnd && (g.home === nhl || g.away === nhl)).length;

  const locked = (p: Player) => {
    const g = gamesByTeam(p.nhl_team);
    return !!g && !calledOff(sport, g.state) && (new Date(g.start_utc).getTime() <= now || hasStarted(sport, g.state));
  };

  // lay out slot instances
  const cap = (league?.roster ?? {}) as Record<Slot, number>;
  const bySlot = (s: Slot) => roster.filter((x) => x.r.slot === s).sort((a, b) => b.p.proj - a.p.proj);
  const rows: { slot: Slot; x?: Row }[] = [];
  for (const s of STARTERS) {
    const occ = bySlot(s);
    for (let i = 0; i < Math.max(cap[s] ?? 0, occ.length); i++) rows.push({ slot: s, x: occ[i] });
  }
  const bench = bySlot('BN');
  const ir = bySlot('IR');
  const selected = roster.find((x) => x.p.id === sel);

  // coming off IR is free at any time, his game started or not (migration 309): tonight still counts him as he was at
  // puck drop. Every other move waits, and nobody goes onto IR once his game has started.
  const offIr = (x: Row, slot: Slot) => x.r.slot === 'IR' && slot !== 'IR';
  const canTarget = (slot: Slot, occupant?: Row) => {
    if (!selected || !mine) return false;
    if (occupant?.p.id === selected.p.id) return false;
    if (!slotOk(selected.p, slot)) return false;
    if (locked(selected.p) && !offIr(selected, slot)) return false;
    if (occupant && locked(occupant.p) && !offIr(occupant, selected.r.slot as Slot)) return false;
    if (!occupant && slot === selected.r.slot) return false;
    if (!occupant && slot !== 'BN' && slot !== 'IR' && bySlot(slot).length >= (cap[slot] ?? 0)) return false;
    // IR is set for real or not at all: What if leaves it as it is
    if (trial && (slot === 'IR' || selected.r.slot === 'IR')) return false;
    // a swap sends the other player to the selected one's place, or to the bench when he can't play it
    if (occupant && !slotOk(occupant.p, selected.r.slot) && selected.r.slot !== 'BN' && bench.length >= (cap.BN ?? 12)) return false;
    return true;
  };

  // a move as the lineup it makes: the player into the slot, and whoever was there into his old place (or the bench
  // when he can't play it), the way the server's single move has always worked
  const short = (p: Player) => p.last_name ?? p.name;
  const moved = (who: Row, slot: Slot, occ?: Row) => {
    const from = who.r.slot as Slot;
    const next = new Map(slots);
    next.set(who.p.id, slot);
    if (!occ) return { next, label: `${short(who.p)} to ${slot === 'BN' ? 'the bench' : slot}` };
    const back: Slot = slotOk(occ.p, from) ? from : 'BN';
    next.set(occ.p.id, back);
    return { next, label: back === from ? `${short(who.p)} ⇄ ${short(occ.p)}` : `${short(who.p)} to ${slot}, ${short(occ.p)} to the bench` };
  };
  const working = busy || saving;
  const tap = (slot: Slot, x?: Row) => {
    if (!mine || league?.phase === 'keepers') { if (x) nav(`/player/${x.p.id}`); return; }
    if (working) return;
    if (selected) {
      if (x?.p.id === selected.p.id) { setSel(null); return; }
      if (canTarget(slot, x)) {
        const who = selected;
        setSel(null);
        // on and off IR stays the single move it was (the lineup save leaves IR alone); everything else saves the
        // whole lineup, with an undo
        if (slot === 'IR' || who.r.slot === 'IR') {
          run(async () => { await rpc('move_player', { p_player: who.p.id, p_slot: slot, p_swap: x?.p.id ?? null }); await refresh(['rosters']); });
          return;
        }
        const m = moved(who, slot, x);
        if (trial) setTrial(m.next);
        else save(kit.today, m.next, saved, m.label);
        return;
      }
      if (x && (!locked(x.p) || x.r.slot === 'IR') && !(trial && x.r.slot === 'IR')) { setSel(x.p.id); return; }
      setSel(null);
      return;
    }
    if (x) {
      if (locked(x.p) && x.r.slot !== 'IR') { nav(`/player/${x.p.id}`); return; }
      if (trial && x.r.slot === 'IR') return;
      setSel(x.p.id);
    }
  };

  const st = standings.find((s) => s.team_id === teamId);
  // before the season there's no lineup to set: show the roster with last season's numbers
  const offseason = league?.phase !== 'season';
  const anyStarter = rows.some((r) => r.x);
  const todayTotal = rows.filter((r) => r.x).reduce((tot, r) => tot + (today.get(r.x!.p.id) ?? 0), 0);
  const benchTotal = [...bench, ...ir].reduce((tot, x) => tot + (today.get(x.p.id) ?? 0), 0);   // shown, never counted
  const emptyStarters = rows.filter((r) => !r.x).length;
  // who's actually on the ice tonight: starters whose club plays, out of the slots the league gives
  const playsToday = (p: Player) => { const g = gamesByTeam(p.nhl_team); return !!g && !calledOff(sport, g.state); };
  const starterSlots = rows.length;
  const playingStarters = rows.filter((r) => r.x && playsToday(r.x.p)).length;
  const gameDayStarters = roster.filter((x) => x.r.slot !== 'IR' && playsToday(x.p)).length;
  const benchPlaying = bench.filter((x) => playsToday(x.p));
  const benchIdle = bench.filter((x) => !playsToday(x.p));
  // starters who may not play tonight (a backup goalie, out, scratched, or a game-time call), while there's time
  const doubtful = rows.filter((r) => r.x && !locked(r.x.p) && ['backup', 'out', 'scratched', 'gtd'].includes(gameStatus(r.x.p.id)?.status ?? ''))
    .map((r) => ({ p: r.x!.p, s: gameStatus(r.x!.p.id)! }));
  // the next lineup lock: the earliest of my players' games today that hasn't started
  const nextLock = roster.map((x) => gamesByTeam(x.p.nhl_team)).filter((g): g is NonNullable<typeof g> => !!g && new Date(g.start_utc).getTime() > now && !calledOff(sport, g.state))
    .sort((a, b) => a.start_utc.localeCompare(b.start_utc))[0];
  // tonight at a glance: expected points, the league's rank on them, and who of mine is on the ice
  const expTonight = rows.reduce((tot, r) => tot + (r.x && playsToday(r.x.p) ? kit.expPts(r.x.p) : 0), 0);
  const anyStarted = rows.some((r) => r.x && locked(r.x.p));
  const nightRank = (() => {
    const gms = teams.filter((x) => x.role === 'gm');
    if (!gms.length || !teamId) return null;
    const mineExp = kit.dayStats(teamId, kit.today, slots).pts;
    return { rank: gms.filter((x) => x.id !== teamId && kit.dayStats(x.id, kit.today).pts > mineExp + 1e-9).length + 1, of: gms.length };
  })();
  const onIce = rows.filter((r) => r.x && playsToday(r.x.p)).map((r) => r.x!);
  const sitStart = useSitStart(kit, roster, (x) => locked(x.p), (x, slot) => slotOk(x.p, slot), rows.filter((r) => !r.x).map((r) => r.slot));
  // a sit or start swap is a move like any other: saved with an undo, or tried in What if
  const doSwap = (sw: Swap) => {
    const m = moved(sw.start, sw.slot, sw.sit ?? undefined);
    if (trial) { setTrial(m.next); return; }
    save(kit.today, m.next, saved, sw.sit ? `${short(sw.start.p)} starts, ${short(sw.sit.p)} sits` : `${short(sw.start.p)} starts at ${sw.slot}`);
  };

  // what needs fixing tonight, each with a tap to the thing it is about, and Fix for the best lineup
  const benchedPlaying = bench.filter((x) => playsToday(x.p) && !hurt(x.p) && !locked(x.p));
  const idleStarters = rows.filter((r) => r.x && !playsToday(r.x.p) && !locked(r.x.p));
  const hurtStarters = rows.filter((r) => r.x && hurt(r.x.p) && !locked(r.x.p)).map((r) => r.x!);
  const toBench = () => document.getElementById('bench-playing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const STATUS_WORDS: Record<string, string> = { backup: 'backup goalie tonight', out: 'out tonight', scratched: 'scratched tonight', gtd: 'a game-time call' };
  const warnings: { key: string; text: string; onClick?: () => void }[] = mine && !offseason ? [
    ...(emptyStarters > 0 ? [{ key: 'empty', text: `${emptyStarters} empty starting ${emptyStarters === 1 ? 'slot' : 'slots'}`, onClick: benchedPlaying.length ? toBench : undefined }] : []),
    ...(benchedPlaying.length && idleStarters.length ? [{ key: 'idle', text: `${benchedPlaying.length} on the bench with a game while ${idleStarters.length} ${idleStarters.length === 1 ? 'starter sits' : 'starters sit'} idle`, onClick: toBench }] : []),
    ...hurtStarters.map((x) => ({ key: `h${x.p.id}`, text: `${x.p.name} is ${x.p.injury_status}`, onClick: () => setInfo(x.p.id) })),
    ...doubtful.filter(({ p }) => !hurtStarters.some((h) => h.p.id === p.id))
      .map(({ p, s }) => ({ key: `d${p.id}`, text: `${p.name}: ${STATUS_WORDS[s.status] ?? s.status}`, onClick: () => setInfo(p.id) })),
  ] : [];
  // What if's running sum: the trial lineup's expected points against the saved one's
  const trialMoves = trial ? diffMoves(saved, trial) : [];
  const trialGain = trial && teamId ? kit.dayStats(teamId, kit.today, trial).pts - kit.dayStats(teamId, kit.today, saved).pts : 0;

  const Row = ({ slot, x }: { slot: Slot; x?: Row }) => {
    const isSel = x && x.p.id === sel;
    const target = canTarget(slot, x);
    const g = x ? gamesByTeam(x.p.nhl_team) : undefined;
    const tp = x ? today.get(x.p.id) : undefined;
    const lk = x && locked(x.p);
    const playing = !!g && !calledOff(sport, g.state);
    const live = !!g && isLive(sport, g.state);
    const done = !!g && isFinal(sport, g.state);
    const starter = slot !== 'BN' && slot !== 'IR';
    const parts = x ? statLine(x.p) : null;
    const tried = !!trial && !!x && saved.get(x.p.id) !== slot;
    const ln = x ? lines.get(x.p.id) : undefined;
    return (
      <div onClick={() => tap(slot, x)}
        className={`flex cursor-pointer items-start gap-2 border-l-[3px] px-2 py-2 transition sm:px-2.5 ${isSel ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400' : target ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/60' : tried ? 'bg-violet-500/10 ring-1 ring-inset ring-violet-300/40' : !offseason && x && live ? 'bg-gradient-to-r from-red-500/[.10] to-transparent' : !offseason && x && playing ? 'bg-gradient-to-r from-emerald-500/[.09] to-transparent' : ''} ${offseason || !x ? 'border-transparent' : live ? 'border-goal' : playing ? 'border-emerald-400/80' : starter ? 'border-white/15' : 'border-transparent'}`}>
        <span className="mt-1"><SlotPill slot={slot} /></span>
        {x ? (
          <>
            <div className="min-w-0 flex-1">
              <PlayerRow p={x.p} wrap dim={!offseason && starter && !playing} badges={!offseason && <>
                {/* his forward line or defence pair tonight, from the shift charts; the top line in the league's colour */}
                {ln && /^[LD]/.test(ln) && <span className={`rounded-md px-1.5 py-px text-[9px] font-black ${ln === 'L1' || ln === 'D1' ? 'bg-gold/20 text-gold' : 'bg-white/[.08] text-slate-300'}`} title={ln.startsWith('L') ? `Forward line ${ln.slice(1)}, from the shift charts` : `Defence pair ${ln.slice(1)}, from the shift charts`}>{ln}</span>}
                {kit.light(kit.today) && playing && starter && <span className="rounded-full bg-sky-400/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-sky-200" title="A light night: five games or fewer">Light</span>}
              </>} />
              {parts && (
                <div className="num mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-11 text-[11px] leading-tight text-slate-400">
                  {parts.map((t, i) => <span key={i} className={`whitespace-nowrap ${i === 0 ? 'font-semibold text-slate-200' : ''}`}>{t}</span>)}
                </div>
              )}
            </div>
            {/* the info and pin buttons stacked in a narrow column, so the player's details keep the width; each one's tap
                area reaches past its edges (about 48 by 36) so a thumb doesn't hit its neighbour */}
            <div className="-my-0.5 flex shrink-0 flex-col items-center">
              <button aria-label={`About ${x.p.name}`} title="Injury, game-day status, news and stats"
                onClick={(e) => { e.stopPropagation(); setInfo(x.p.id); }}
                className="relative grid h-8 w-8 place-items-center rounded-lg text-sm text-sky-300 transition after:absolute after:-inset-x-2 after:-inset-y-0.5 after:content-[''] hover:bg-white/10">ⓘ</button>
              {mine && !offseason && (
                <button aria-label={`Pin ${x.p.name}`} title={x.r.pin === 'start' ? 'Pinned: always start' : x.r.pin === 'bench' ? 'Pinned: never start' : 'Pin: tap to always start / never start'}
                  onClick={(e) => { e.stopPropagation(); cyclePin(x); }}
                  className={`relative grid h-8 w-8 place-items-center rounded-lg text-xs transition after:absolute after:-inset-x-2 after:-inset-y-0.5 after:content-[''] hover:bg-white/10 ${x.r.pin ? '' : 'opacity-30'}`}>
                  {x.r.pin === 'start' ? '📌' : x.r.pin === 'bench' ? '🚫' : '📍'}
                </button>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {offseason ? <div className="text-sm font-semibold">{fmtPts(x.p.last_fp, 0)}</div>
                : tp != null || done ? <div className={`text-sm font-semibold ${tp != null && tp > 0 ? 'text-emerald-300' : ''}`}>{fmtPts(tp ?? 0, 1)}{done && <span className="ml-1 text-[10px] font-normal text-mute">final</span>}</div>
                : live ? <div className="text-xs font-semibold text-goal">● LIVE</div>
                : playing ? <div className="text-right"><div className="num text-sm font-bold text-emerald-200">{fmt1(kit.expPts(x.p))}</div><div className="text-[9px] font-semibold uppercase tracking-wider text-mute">exp · {fmtTime(g!.start_utc)}</div></div>
                : <div className="inline-block whitespace-nowrap rounded-md bg-white/[.06] px-1.5 py-0.5 text-[11px] text-mute">No game</div>}
              {offseason
                ? <div className="whitespace-nowrap text-[10px] text-mute">’25-26</div>
                : <div className="text-right text-[10px] leading-tight text-mute"><div className="whitespace-nowrap">{fmtPts(season.get(x.p.id)?.fpts ?? 0, 0)} szn</div><div className="whitespace-nowrap">{weekGames(x.p.nhl_team)}g this wk</div></div>}
              {lk && <span title="Locked: his game has started. Lineup changes reopen tomorrow." className="text-xs">🔒</span>}
            </div>
          </>
        ) : (
          <div className={`flex-1 self-center text-sm ${target ? 'font-semibold text-emerald-300' : 'text-mute'}`}>{target ? 'Move here' : 'Empty'}</div>
        )}
      </div>
    );
  };

  if (!t) return null;
  if (t.role === 'spectator') {
    return (
      <div className="card-hero p-5 text-center" style={{ '--tc': t.color } as React.CSSProperties}>
        <div className="relative mx-auto w-fit"><TeamBadge team={t} size={64} ring /></div>
        <h1 className="h-display text-shine relative mt-3 text-3xl">{t.name}</h1>
        <p className="relative mt-1 text-sm text-white/70">🍿 Spectator pass: no roster, no lineup, just a great seat.{mine ? ' Head to the standings, the chat or the side bets.' : ''}</p>
        <div className="relative mt-4 flex justify-center gap-2"><Link to="/standings" className="btn-primary">Standings</Link><Link to="/chat" className="btn-ghost">Chat</Link></div>
      </div>
    );
  }
  return (
    <div className={`space-y-4 ${trial ? 'pb-36' : ''}`}>
      <PlayerSheet id={info} onClose={() => setInfo(null)} />
      <div className="card-hero flex flex-wrap items-center gap-3 p-4" style={{ '--tc': t.color } as React.CSSProperties}>
        <div className="pointer-events-none absolute -right-4 -top-6 select-none text-[120px] leading-none opacity-[.08]">{t.emoji}</div>
        <TeamBadge team={t} size={56} ring />
        <div className="relative min-w-0 flex-1">
          <h1 className="h-display text-shine break-words text-[clamp(21px,7.4vw,28px)] leading-[1.05]">{t.name}</h1>
          <div className="text-xs text-white/70">GM {t.gm_name}{st && league?.phase === 'season' && <> · {ordinal(st.rank)} · {fmtPts(st.points)} pts · {pk ? pk.used : st.moves}/{pk?.allowed ?? league?.max_acquisitions} pickups</>}</div>
          {t.motto && <div className="line-clamp-2 text-xs italic text-white/60">“{t.motto}”</div>}
        </div>
        <select aria-label="View team" className="relative w-full rounded-xl border border-white/15 bg-black/30 px-2 py-1.5 text-sm backdrop-blur sm:w-auto" value={teamId} onChange={(e) => nav(Number(e.target.value) === me?.id ? '/team' : `/team/${e.target.value}`)}>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.id === me?.id ? '🏠 My team' : `${x.emoji} ${x.name}`}</option>)}
        </select>
      </div>

      {mine && league?.phase === 'season' && (
        <div className="card-hero relative overflow-hidden p-4 sm:p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-gold">Tonight</div>
              <div className="h-display text-[clamp(17px,5.2vw,26px)] uppercase leading-tight text-white"><span className="sm:hidden">{weekday(kit.today)}, {monthDay(kit.today)}</span><span className="hidden sm:inline">{longDay(kit.today)}</span></div>
              <div className="text-xs text-white/70">{trial ? 'What if: trying moves, nothing saved yet' : 'The live lineup'} · {kit.nightSize(kit.today)} NHL {kit.nightSize(kit.today) === 1 ? 'game' : 'games'}{kit.light(kit.today) ? ' · a light night' : ''}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="num font-display text-4xl font-extrabold leading-none text-white">{anyStarted ? fmtPts(todayTotal) : fmt1(expTonight)}</div>
              <div className="text-[11px] text-white/60">{anyStarted ? 'points tonight' : 'expected pts'}</div>
            </div>
          </div>
          {/* the starting slots, lit for each starter who plays tonight */}
          <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-white/80"><b className={`num ${playingStarters < starterSlots && benchPlaying.length ? 'text-amber-300' : 'text-emerald-300'}`}>{playingStarters}</b> of {starterSlots} starters play{gameDayStarters === 0 ? ' · a quiet night for your roster' : ''}</span>
            {nightRank && <button type="button" onClick={() => setView('league')} className="chip border-gold/40 bg-gold/10 text-gold">🏆 {ordinal(nightRank.rank)} of {nightRank.of} tonight</button>}
          </div>
          <div className="relative mt-1.5 flex gap-1">
            {rows.map((r, i) => {
              const g = r.x ? gamesByTeam(r.x.p.nhl_team) : undefined;
              const on = !!r.x && playsToday(r.x.p);
              return <span key={i} className={`h-1.5 flex-1 rounded-full ${on && g && isLive(sport, g.state) ? 'animate-pulse bg-red-400' : on ? 'bg-emerald-400' : 'bg-white/15'}`} />;
            })}
          </div>
          {/* who of mine is on the ice tonight */}
          {onIce.length > 0 && (
            <div className="scroll-x relative mt-3 flex gap-1.5 pb-0.5">
              {onIce.map((x) => {
                const g = gamesByTeam(x.p.nhl_team);
                const tp = today.get(x.p.id);
                return (
                  <button key={x.p.id} type="button" onClick={() => setInfo(x.p.id)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-black/25 px-2 py-1.5 text-left ring-1 ring-white/10 hover:ring-gold/40">
                    <SlotPill slot={x.r.slot} size="sm" />
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-xs font-bold text-white">{x.p.last_name ?? x.p.name}{tp != null ? <span className="num ml-1 text-emerald-300">{fmtPts(tp, 1)}</span> : null}</span>
                      <span className="block"><GameLine p={x.p} g={g} /></span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {/* best ball (migration 276): the lineup here scores live; once the night is over it counts the best one */}
          {bestBall(league) && (
            <div className="relative mt-3 flex items-start gap-2.5 rounded-2xl border border-sky-400/25 bg-sky-400/[.07] p-3 text-[13px] leading-snug text-sky-100">
              <span className="text-base leading-none">🎯</span>
              <span><b className="text-white">Best ball.</b> Your lineup scores live tonight; once the games are over, the night counts the best lineup your players allowed.</span>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="relative mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-400/[.07] p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-snug text-amber-100">
                {warnings.map((w) => w.onClick
                  ? <button key={w.key} type="button" onClick={w.onClick} className="block text-left underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300">{w.text}</button>
                  : <span key={w.key} className="block">{w.text}</span>)}
              </div>
              {!trial && <button type="button" onClick={() => setOpt(true)} className="shrink-0 rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-[#0b1220]">Fix</button>}
            </div>
          )}
          <div className="relative mt-3 grid grid-cols-3 gap-2">
            {!trial && <>
              <button className="btn-gold col-span-2 whitespace-nowrap px-2" disabled={working} onClick={() => setOpt(true)}>✨ Best lineup tonight</button>
              <button className="btn-ghost inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-2" disabled={working} title="Try moves without saving them" onClick={() => { setTrial(new Map(saved)); setSel(null); }}><FlaskConical className="h-4 w-4 shrink-0" /> What if</button>
            </>}
            <button className="btn-ghost px-2 text-xs" onClick={() => document.getElementById('sit-start')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>⚖️ Sit or start{sitStart.swaps.length ? ` (${sitStart.swaps.length})` : ''}</button>
            <button className="btn-ghost px-2 text-xs" onClick={() => { setPlanDay(undefined); setView('plan'); }}>📅 Daily lineups</button>
            <button className="btn-ghost px-2 text-xs" onClick={() => setTools(true)}>⚙️ Tools</button>
          </div>
          <div className="relative mt-2 text-xs text-mute">
            🔒 Players lock at their {sport.words.start}{nextLock ? <>; next lock <span className="text-slate-200">{fmtTime(nextLock.start_utc)}</span> ({nextLock.away} @ {nextLock.home})</> : ''}. Auto-pilot <button className="font-semibold text-sky-300 hover:underline" onClick={() => setTools(true)}>{me?.auto_mode && me.auto_mode !== 'off' ? `on · ${{ proj: 'projection', form: 'hot hand', season: 'season avg', ros: 'rest of season' }[me.auto_basis ?? 'proj']}` : 'off'}</button>{roster.some((x) => x.r.pin) && <> · {roster.filter((x) => x.r.pin).length} pinned</>}{st?.bench ? <> · {fmtPts(st.bench)} benched this season</> : null}
          </div>
          {benchTotal > 0 && <div className="relative mt-1 text-xs text-amber-300" title="Points your bench and IR scored today. They don’t count.">{fmtPts(benchTotal)} left on the bench today</div>}
        </div>
      )}
      {mine && league?.phase !== 'season' && league?.phase !== 'keepers' && (
        <button className="card flex w-full items-center gap-3 p-3 text-left text-sm" onClick={() => setTools(true)}>
          <span className="text-2xl">⚙️</span>
          <span className="flex-1"><span className="font-semibold">Lineup tools</span><span className="block text-xs text-mute">Auto-pilot {me?.auto_mode && me.auto_mode !== 'off' ? 'on' : 'off'}: set it now and it takes over on opening night</span></span>
          <span className="text-mute">›</span>
        </button>
      )}
      {mine && <LineupTools open={tools} onClose={() => setTools(false)} roster={saved0} />}
      {mine && inSeason && <OptimizeSheet kit={kit} teamId={t.id} day={kit.today} open={opt} onClose={() => setOpt(false)} />}
      {/* What if: the trial's moves and what they're worth, then save them all (with an undo) or throw them away */}
      {mine && trial && cur === 'lineup' && (
        <div className="fixed inset-x-0 bottom-[84px] z-40 px-4 md:bottom-6"><div className="mx-auto max-w-md rounded-2xl bg-[#1c1433]/95 p-3 shadow-[0_12px_32px_rgba(0,0,0,.55)] ring-1 ring-violet-300/40 backdrop-blur">
          <div className="flex items-center gap-2 text-sm text-violet-100">
            <FlaskConical className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{trialMoves.length ? <>Trying {trialMoves.length} {trialMoves.length === 1 ? 'move' : 'moves'}: <b className={trialGain >= 0 ? 'text-emerald-300' : 'text-red-300'}>{trialGain >= 0 ? '+' : ''}{fmt1(trialGain)}</b> expected tonight</> : 'What if: move anyone, nothing saves until you say.'}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-gold flex-1" disabled={working || !trialMoves.length} onClick={async () => { if (await save(kit.today, trial, saved, `${trialMoves.length} ${trialMoves.length === 1 ? 'move' : 'moves'} saved`)) { setTrial(null); setSel(null); } }}>Save{trialMoves.length ? ` ${trialMoves.length}` : ''}</button>
            <button type="button" className="btn-ghost" onClick={() => { setTrial(null); setSel(null); }}>Discard</button>
          </div>
        </div></div>
      )}
      {league?.phase === 'keepers' && mine && (
        <Link to="/draft?t=keepers" className="card block bg-amber-500/10 p-3 text-sm text-amber-100">🔒 It’s keeper season: this is your 2025-26 roster. Pick who you keep →</Link>
      )}

      {/* the views, in a row that scrolls sideways on a phone */}
      <div ref={tabRow} className="scroll-x -mx-1 flex items-center gap-1 px-1 pb-0.5">
        {tabs.map((x) => (
          <button key={x.k} type="button" data-on={cur === x.k ? '1' : undefined} className={`tab whitespace-nowrap ${cur === x.k ? 'tab-on' : 'bg-white/[.05]'}`}
            onClick={() => { if (x.k === 'plan') setPlanDay(undefined); setView(x.k); }}>{x.label}</button>
        ))}
      </div>
      {cur === 'lineup' && (
        <div className="scroll-x -mt-2 flex items-center gap-1">
          <span className="mr-0.5 shrink-0 text-[10px] uppercase tracking-wider text-mute">Stat lines</span>
          {TIMEFRAMES.filter((x) => x.k !== 'proj' && x.k !== 'ros').map((x) => (
            <button key={x.k} disabled={x.live && !liveOk} title={x.live && !liveOk ? 'Once the season starts' : x.label} onClick={() => setTf(x.k)}
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-35 ${tfOk === x.k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`}>{x.short}</button>
          ))}
        </div>
      )}
      {cur !== 'lineup' && cur !== 'scout' ? <Suspense fallback={<ViewLoading />}>{
        cur === 'stats' ? <TeamStats teamId={t.id} />
        : cur === 'plan' ? <LineupPlanner roster={saved0} teamId={t.id} initialDay={planDay} />
        : cur === 'week' ? <WeekView kit={kit} teamId={t.id} from={kit.today} readOnly={!mine} onDay={openDay} onInfo={setInfo} />
        : cur === 'league' ? <LeagueView kit={kit} day={kit.today} onView={(tid) => goTeam(tid, 'lineup')}
            onCompare={(tid) => { setOther(tid); goTeam(me && me.role !== 'spectator' ? me.id : t.id, 'compare'); }} />
        : cur === 'compare' ? <CompareView kit={kit} teamId={t.id} other={other} setOther={setOther} day={kit.today} onInfo={setInfo} />
        : <InsightsView kit={kit} teamId={t.id} onDay={openDay} onInfo={setInfo} />
      }</Suspense>
        : cur === 'scout' ? <TeamScout teamId={t.id} />
        : <>
      <div className="grid gap-4 lg:grid-cols-2">
        {(!offseason || anyStarter) && (
          <Section title="Starters" className="min-w-0" right={!offseason ? <span className="text-xs text-mute"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />{playingStarters} of {starterSlots} play tonight</span> : undefined}>
            {mine && !offseason && <p className="mb-1.5 px-1 text-[11px] text-mute">{trial ? 'What if: tap a player, then the slot he should go to. Nothing saves until you tap Save.' : 'Tap a player, then tap the slot he should go to. Green bar: his club plays tonight. Grey: no game, he sits idle.'}</p>}
            <div className="card divide-y divide-white/[.06] overflow-hidden">{rows.map((r, i) => <Fragment key={i}>{Row({ slot: r.slot, x: r.x })}</Fragment>)}</div>
          </Section>
        )}
        <div className="min-w-0 space-y-4">
          {!offseason && roster.length > 1 && (
            <div id="sit-start" className="scroll-mt-20">
              <SitStart kit={kit} roster={roster} swaps={sitStart.swaps} exp={sitStart.exp} weekGames={weekGames} mine={mine} busy={working} onSwap={doSwap} onInfo={setInfo} />
            </div>
          )}
          {offseason && !anyStarter ? (
            <Section title={`Roster (${bench.length})`}>
              <div className="card divide-y divide-white/[.06] overflow-hidden">
                {bench.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'BN', x })}</Fragment>)}
                {bench.length === 0 && <div className="p-3 text-sm text-mute">Empty bench.</div>}
              </div>
            </Section>
          ) : (
            <>
              <div id="bench-playing" className="scroll-mt-20" />
              <Section title={`Bench · playing tonight (${benchPlaying.length})`} right={benchPlaying.length > 0 && (emptyStarters > 0 || rows.some((r) => r.x && !playsToday(r.x.p))) ? <span className="text-xs text-amber-300">could start</span> : undefined}>
                <div className="card divide-y divide-white/[.06] overflow-hidden">
                  {benchPlaying.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'BN', x })}</Fragment>)}
                  {selected && selected.r.slot !== 'BN' && Row({ slot: 'BN' })}
                  {benchPlaying.length === 0 && !selected && <div className="p-3 text-xs text-mute">Nobody on the bench has a game tonight{gameDayStarters > 0 ? ': everyone who plays is in' : ''}.</div>}
                </div>
              </Section>
              <Section title={`Bench · no game tonight (${benchIdle.length})`} right={<span className="text-xs text-mute">{bench.length}/{cap.BN ?? 12} bench spots</span>}>
                <div className="card divide-y divide-white/[.06] overflow-hidden">
                  {benchIdle.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'BN', x })}</Fragment>)}
                  {benchIdle.length === 0 && <div className="p-3 text-xs text-mute">Everyone on the bench plays tonight.</div>}
                </div>
              </Section>
            </>
          )}
          <Section title={`IR (${ir.length}/${cap.IR ?? 2})`}>
            <div className="card divide-y divide-white/[.06] overflow-hidden">
              {ir.map((x) => <Fragment key={x.p.id}>{Row({ slot: 'IR', x })}</Fragment>)}
              {selected && selected.r.slot !== 'IR' && !trial && ir.length < (cap.IR ?? 2) && Row({ slot: 'IR' })}
              {ir.length === 0 && !selected && <div className="p-3 text-xs text-mute">Injured players only, not suspended ones.</div>}
            </div>
            {mine && !offseason && (() => {
              const active = roster.filter((x) => x.r.slot !== 'IR').length;
              const max = Object.entries(cap).filter(([k]) => k !== 'IR').reduce((a, [, v]) => a + Number(v), 0);
              const healed = ir.filter((x) => !irOk(x.p.injury_status));
              return (
                <div className="mt-1 space-y-1 px-1 text-xs text-mute">
                  {healed.length > 0 && <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-emerald-200">💪 {healed.map((x) => x.p.name).join(' and ')} {healed.length > 1 ? 'are' : 'is'} off the injury report. {healed.length > 1 ? 'They can' : 'He can'} stay on IR as long as you like; {active >= max ? `to bring ${healed.length > 1 ? 'them' : 'him'} back, drop or trade someone first` : `tap to bring ${healed.length > 1 ? 'them' : 'him'} back`}.</div>}
                  <div>Each player on IR frees a roster spot ({active}/{max} active). IR moves are yours to make: lineup tools and auto-pilot leave IR alone. Bring a player off IR any time, even once his game has started (tonight counts him as he was at puck drop), as long as there's a free spot or someone to swap him with.</div>
                </div>
              );
            })()}
          </Section>
          <Section title="Transactions">
            <div className="card divide-y divide-white/[.06]">
              {tx.length === 0 && <div className="p-3 text-sm text-mute">None yet.</div>}
              {tx.map((x) => (
                <div key={x.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span>{{ add: '➕', drop: '➖', trade: '🔄', draft: '📋', keeper: '🔒', release: '↩️', commish: '🛠️' }[x.type] ?? '•'}</span>
                  <span className="flex-1 truncate"><Link className="hover:underline" to={`/player/${x.player_id}`}>{players.get(x.player_id ?? 0)?.name}</Link> <span className="text-mute">{x.type}{x.other_team ? ` from ${team(x.other_team)?.abbrev}` : ''}{x.fee ? ` ($${x.fee})` : ''}</span></span>
                  <span className="text-xs text-mute">{ago(x.created_at, now)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
      {(league?.phase === 'season' || league?.phase === 'offseason') && (
        <Section title="The long view" right={<span className="text-xs text-mute">full-year forecast</span>}>
          <Suspense fallback={<ViewLoading tall={false} />}><TeamForecastCard teamId={t.id} /></Suspense>
        </Section>
      )}
      {mine && <TeamScout teamId={t.id} hideRoster />}
      {!mine && <div className="text-center text-sm"><Link className="text-sky-300" to={`/trades?with=${teamId}`}>🔄 Propose a trade with <TeamName team={t} /></Link></div>}
      </>}
    </div>
  );
}
