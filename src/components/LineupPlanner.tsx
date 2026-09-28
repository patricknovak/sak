// Daily lineups, Yahoo-style: pick any day up to 60 days out and set exactly who starts where, with every stat
// on the page to decide it. Today saves straight to the live lineup; future days save as plans that become the
// live lineup that morning (and the auto-pilot leaves them alone). Plans carry forward: a day with no plan of its
// own uses the last plan before it, or today's lineup.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Copy, Save, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { optimize, slotOk as canPlay, gamesOf, dressRate, type Basis, type LContext } from '../lib/lineup';
import { lineFor, minSample, rosPoints, statValue, fmtStat, TIMEFRAMES, type Timeframe } from '../lib/playerstats';
import { useProjDetails, useSeasonGames } from '../lib/projections';
import type { Game, Player, Roster, Slot } from '../lib/types';
import { Headshot, useAction } from './ui';

type Row = { r: Roster; p: Player };
const START: Slot[] = ['C', 'LW', 'RW', 'D', 'Util', 'G'];
const ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, Util: 4, G: 5, BN: 6, IR: 7 };
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' });
const monthDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hurt = (p: Player) => !!p.injury_status && /^(out|ir|injured|long|suspen)/i.test(p.injury_status);
const addDaysLocal = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// the stat groups the grid can show
type View = 'fantasy' | 'skater' | 'points' | 'goalie' | 'proj';
const VIEWS: { k: View; label: string }[] = [
  { k: 'fantasy', label: 'Fantasy value' }, { k: 'points', label: 'Points by category' }, { k: 'skater', label: 'Skater stats' },
  { k: 'goalie', label: 'Goalie stats' }, { k: 'proj', label: 'Projected line' },
];
const SK = ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'gwg', 'shpct'];
const GO = ['gp', 'gs', 'w', 'l', 'otl', 'sv', 'ga', 'svp', 'gaa', 'sho'];
const FILTERS = ['All', 'C', 'LW', 'RW', 'D', 'G', 'Starting', 'Bench', 'Playing'] as const;
type Filter = (typeof FILTERS)[number];

export function LineupPlanner({ roster }: { roster: Row[] }) {
  const { me, league, players, windows, season, refresh, serverOffset } = useLeague();
  const games = useSeasonGames();
  const details = useProjDetails();
  const { busy, run } = useAction();
  const today = etToday();
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const end = league?.season_end && league.season_end < addDays(today, 60) ? league.season_end : addDays(today, 60);
  const days = useMemo(() => { const out: string[] = []; for (let d = today; d <= end; d = addDays(d, 1)) out.push(d); return out; }, [today, end]);
  const [day, setDay] = useState(today);
  const [plans, setPlans] = useState<Map<string, Map<number, string>>>(new Map());
  const [draft, setDraft] = useState<Map<number, string> | null>(null);   // unsaved edits for the selected day
  const [view, setView] = useState<View>('fantasy');
  const [tf, setTf] = useState<Timeframe>(league?.phase === 'season' && windows.size ? 'season' : 'proj');
  const [perGame, setPerGame] = useState(false);
  const [filter, setFilter] = useState<Filter>('All');
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const [copyTo, setCopyTo] = useState(7);

  const loadPlans = () => { if (me) supabase.from('lineup_plans').select('date,player_id,slot').eq('team_id', me.id).gt('date', today).then(({ data }) => {
    const m = new Map<string, Map<number, string>>();
    for (const r of data ?? []) { const x = m.get(r.date) ?? new Map(); x.set(r.player_id, r.slot); m.set(r.date, x); }
    setPlans(m);
  }); };
  useEffect(loadPlans, [me?.id, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(null); }, [day]);

  const liveSlots = useMemo(() => new Map(roster.map((x) => [x.p.id, x.r.slot as string])), [roster]);
  // what a day looks like before any edits: its own plan, else the last plan before it, else today's lineup
  const effective = (d: string): { slots: Map<number, string>; source: string | null } => {
    if (d === today) return { slots: liveSlots, source: null };
    let from: string | null = null;
    for (const k of plans.keys()) if (k <= d && (!from || k > from)) from = k;
    const base = from ? plans.get(from)! : liveSlots;
    const slots = new Map<number, string>();
    for (const x of roster) slots.set(x.p.id, base.get(x.p.id) ?? (x.r.slot === 'IR' ? 'IR' : 'BN'));
    return { slots, source: from === d ? 'own' : from };
  };
  const eff = effective(day);
  const slots = draft ?? eff.slots;
  const dirty = !!draft && [...draft].some(([id, s]) => eff.slots.get(id) !== s);

  const gamesOn = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const g of games ?? []) { if (g.state === 'PPD' || g.state === 'CNCL') continue; m.set(g.date, [...(m.get(g.date) ?? []), g]); }
    return m;
  }, [games]);
  const gameFor = (p: Player, d: string) => (gamesOn.get(d) ?? []).find((g) => g.home === p.nhl_team || g.away === p.nhl_team);
  const nowMs = Date.now() + serverOffset;
  const locked = (p: Player) => { if (day !== today) return false; const g = gameFor(p, today); return !!g && new Date(g.start_utc).getTime() <= nowMs; };
  const perGameProj = (p: Player) => p.proj / gamesOf(p);
  // expected points on a night his team plays: per game × the chance he dresses (or starts, for a goalie)
  const expPts = (p: Player) => (hurt(p) ? 0 : perGameProj(p) * dressRate(p));

  // per-day summary for the date strip
  const summary = (d: string) => {
    const s = effective(d).slots;
    let playing = 0, benched = 0, pts = 0;
    for (const x of roster) {
      const g = gameFor(x.p, d);
      if (!g) continue;
      const slot = s.get(x.p.id) ?? 'BN';
      if (START.includes(slot as Slot)) { playing++; pts += expPts(x.p); } else if (slot === 'BN' && !hurt(x.p)) benched++;
    }
    return { playing, benched, pts };
  };

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const s of slots.values()) c[s] = (c[s] ?? 0) + 1; return c; }, [slots]);
  const over = Object.entries(counts).filter(([s, n]) => s !== 'BN' && n > (caps[s] ?? 0)).map(([s, n]) => `${n - (caps[s] ?? 0)} too many at ${s}`);
  const setSlot = (id: number, s: string) => setDraft(new Map([...slots, [id, s]]));

  const ctxFor = (d: string): LContext => ({ today: d, weekEnd: d, now: d === today ? nowMs : 0, games: gamesOn.get(d) ?? [], season: new Map([...season].map(([k, v]) => [k, { gp: v.gp, fpts: v.fpts, gp14: v.gp14, fpts14: v.fpts14 }])), caps });
  const basis: Basis = me?.auto_basis ?? 'proj';
  const optimizeDay = (d: string, start: Map<number, string>) => {
    const rows = roster.map((x) => ({ player_id: x.p.id, slot: start.get(x.p.id) ?? 'BN', pin: x.r.pin }));
    return optimize(rows, players, 'day', basis, ctxFor(d)).slots;
  };

  const save = () => run(async () => {
    if (!draft) return;
    if (day === today) {
      const moves = Object.fromEntries([...draft].filter(([id, s]) => liveSlots.get(id) !== s).map(([id, s]) => [id, s]));
      await rpc('set_lineup', { p_slots: moves });
      await refresh(['rosters', 'teams']);
    } else {
      await rpc('set_lineup_plans', { p_plans: { [day]: Object.fromEntries(draft) } });
      loadPlans();
    }
    setDraft(null);
  }, day === today ? 'Today’s lineup saved' : `Lineup saved for ${monthDay(day)} ✅`);

  const copyAhead = () => run(async () => {
    const base = slots;
    const targets = days.filter((d) => d > day && d > today).slice(0, copyTo);
    if (!targets.length) return;
    await rpc('set_lineup_plans', { p_plans: Object.fromEntries(targets.map((d) => [d, Object.fromEntries(base)])) });
    if (draft && day !== today) await rpc('set_lineup_plans', { p_plans: { [day]: Object.fromEntries(draft) } });
    loadPlans(); setDraft(null);
  }, `Copied to the next ${Math.min(copyTo, days.filter((d) => d > day).length)} days`);

  // the best lineup for every day in a stretch, each day built on the one before
  const optimizeAhead = (n: number) => run(async () => {
    const targets = days.filter((d) => d > today).slice(0, n);
    let prev = effective(targets[0] ?? today).slots;
    const out: Record<string, Record<number, string>> = {};
    for (const d of targets) { const s = optimizeDay(d, prev); out[d] = Object.fromEntries(s); prev = s; }
    await rpc('set_lineup_plans', { p_plans: out });
    loadPlans(); setDraft(null);
  }, `Best lineup set for the next ${n} days ✨ (pins respected)`);

  const clearDay = () => run(async () => { await rpc('clear_lineup_plans', { p_dates: [day] }); loadPlans(); setDraft(null); }, 'Plan cleared: this day carries forward again');

  // stats for the grid
  const tfOk: Timeframe = !windows.size && TIMEFRAMES.find((x) => x.k === tf)?.live ? 'last' : tf;
  const w = league?.scoring;
  const cols = (() => {
    if (view === 'fantasy') return ['fpg', 'ros', 'fp', 'fp14', 'wk', 'n30'];
    if (view === 'skater') return SK;
    if (view === 'goalie') return GO;
    if (view === 'proj') return ['pgp', 'pg', 'pa', 'ppts', 'ppm', 'pppp', 'psog', 'phit', 'pblk', 'prange'];
    return [...Object.keys(w?.skater ?? {}), ...Object.keys(w?.goalie ?? {}).map((k) => 'g:' + k)];
  })();
  const LABEL: Record<string, string> = {
    fpg: 'Proj/G', ros: 'ROS', fp: 'FP', fp14: 'FP/G 14d', wk: 'Games 7d', n30: 'Games 30d', pgp: 'GP', pg: 'G', pa: 'A', ppts: 'P', ppm: '+/-', pppp: 'PPP', psog: 'SOG', phit: 'HIT', pblk: 'BLK', prange: 'Range',
    gp: 'GP', gs: 'GS', g: 'G', a: 'A', pts: 'P', pm: '+/-', ppp: 'PPP', sog: 'SOG', hit: 'HIT', blk: 'BLK', pim: 'PIM', gwg: 'GWG', shpct: 'S%', w: 'W', l: 'L', otl: 'OTL', sv: 'SV', ga: 'GA', svp: 'SV%', gaa: 'GAA', sho: 'SO',
  };
  const gamesIn = (p: Player, from: string, n: number) => { let c = 0; for (let i = 0; i < n; i++) if (gameFor(p, addDays(from, i))) c++; return c; };
  const value = (p: Player, k: string): number | null => {
    const line = lineFor(p, tfOk, windows.get(p.id), season.get(p.id));
    if (k === 'fpg') return perGameProj(p);
    if (k === 'ros') return rosPoints(p, season.get(p.id));
    if (k === 'fp') return line ? (perGame && line.gp ? line.fp / line.gp : line.fp) : null;
    if (k === 'fp14') { const x = windows.get(p.id)?.['14']; return x && x.gp ? x.fpts / x.gp : null; }
    if (k === 'wk') return gamesIn(p, day, 7);
    if (k === 'n30') return gamesIn(p, day, 30);
    if (k.startsWith('p') && view === 'proj') {
      const st = details?.get(p.id)?.proj_stats;
      if (k === 'prange') { const m = details?.get(p.id)?.proj_meta; return m ? p.proj * m.hi - p.proj * m.lo : null; }
      const key = { pgp: 'gp', pg: 'g', pa: 'a', ppts: 'pts', ppm: 'pm', pppp: 'ppp', psog: 'sog', phit: 'hit', pblk: 'blk' }[k]!;
      if (!st) return null;
      const v = p.pos === 'G' ? { gp: st.gs, g: st.w, a: st.sv, pts: st.sho }[key as 'gp'] ?? null : st[key];
      return v == null ? null : perGame && st.gp ? v / st.gp : v;
    }
    if (view === 'points') {
      const goalie = k.startsWith('g:');
      const key = goalie ? k.slice(2) : k;
      if (goalie !== (p.pos === 'G') || !line) return null;
      const wt = (goalie ? w?.goalie : w?.skater)?.[key] ?? 0;
      const v = line.totals[key];
      if (v == null) return tfOk === 'proj' ? null : 0;
      return (perGame && line.gp ? v / line.gp : v) * wt;
    }
    return statValue(line, k, perGame, minSample(tfOk));
  };
  const fmt = (k: string, v: number | null) => {
    if (v == null) return '–';
    if (['fpg', 'fp14'].includes(k)) return v.toFixed(2);
    if (k === 'prange') return `±${Math.round(v / 2)}`;
    if (['ros', 'fp'].includes(k) || view === 'points') return fmtPts(v, perGame || view === 'points' ? 1 : 0);
    if (['wk', 'n30'].includes(k)) return String(v);
    if (view === 'proj') return perGame ? v.toFixed(2) : String(Math.round(v));
    return fmtStat(v, k, perGame);
  };
  const pointsLabel = (k: string) => { const key = k.startsWith('g:') ? k.slice(2) : k; return (LABEL[key] ?? key.toUpperCase()) + (k.startsWith('g:') ? ' (G)' : ''); };
  const goalieCols = view === 'goalie';

  const rows = useMemo(() => {
    let list = roster.filter((x) => {
      const s = slots.get(x.p.id) ?? 'BN';
      if (filter === 'All') return true;
      if (filter === 'Starting') return START.includes(s as Slot);
      if (filter === 'Bench') return s === 'BN' || s === 'IR';
      if (filter === 'Playing') return !!gameFor(x.p, day);
      if (filter === 'G') return x.p.pos === 'G';
      return x.p.pos !== 'G' && x.p.elig.includes(filter);
    });
    if (goalieCols) list = list.filter((x) => x.p.pos === 'G');
    if (view === 'skater') list = list.filter((x) => x.p.pos !== 'G');
    if (sort) return [...list].sort((a, b) => ((value(b.p, sort.k) ?? -1e9) - (value(a.p, sort.k) ?? -1e9)) * sort.dir);
    return [...list].sort((a, b) => ORDER[slots.get(a.p.id) ?? 'BN'] - ORDER[slots.get(b.p.id) ?? 'BN'] || b.p.proj - a.p.proj);
  }, [roster, slots, filter, sort, view, tfOk, perGame, day, details, gamesOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // today's counts follow the edits on screen, not the saved lineup
  const playingNow = roster.filter((x) => START.includes((slots.get(x.p.id) ?? 'BN') as Slot) && gameFor(x.p, day)).length;
  const emptyOnGameDay = START.reduce((t, s) => t + Math.max(0, (caps[s] ?? 0) - (counts[s] ?? 0)), 0);
  const benchedPlaying = roster.filter((x) => (slots.get(x.p.id) === 'BN') && gameFor(x.p, day) && !hurt(x.p));
  const idleStarters = roster.filter((x) => START.includes((slots.get(x.p.id) ?? 'BN') as Slot) && !gameFor(x.p, day));
  const dayPts = roster.reduce((t, x) => t + (START.includes((slots.get(x.p.id) ?? 'BN') as Slot) && gameFor(x.p, day) ? expPts(x.p) : 0), 0);

  // start / sit: what the best lineup for this day changes, with the reason for each call
  const best = useMemo(() => (games ? optimizeDay(day, slots) : null), [games, day, slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const isStart = (s?: string) => START.includes((s ?? 'BN') as Slot);
  const bestPts = best ? roster.reduce((t, x) => t + (isStart(best.get(x.p.id)) && gameFor(x.p, day) ? expPts(x.p) : 0), 0) : dayPts;
  const toStart = best ? roster.filter((x) => isStart(best.get(x.p.id)) && !isStart(slots.get(x.p.id))) : [];
  const toSit = best ? roster.filter((x) => !isStart(best.get(x.p.id)) && isStart(slots.get(x.p.id))) : [];
  const form = (p: Player) => { const x = windows.get(p.id)?.['14']; return x && x.gp >= 2 ? x.fpts / x.gp : null; };
  const why = (p: Player, starting: boolean) => {
    const g = gameFor(p, day);
    if (!starting) {
      if (hurt(p)) return `${p.injury_status}`;
      if (!g) return 'no game this day';
      return `${expPts(p).toFixed(2)} expected: less than who replaces him`;
    }
    const f = form(p);
    const b2b = p.pos === 'G' && gameFor(p, addDaysLocal(day, -1)) ? ' · back-to-back, may not start' : '';
    return `${g ? (g.home === p.nhl_team ? 'vs ' + g.away : '@' + g.home) : ''} · ${expPts(p).toFixed(2)} expected${f != null ? ` · ${f.toFixed(2)}/g last 14 days` : ''}${b2b}`;
  };
  // close calls: a starter and the best bench option for his slot, both playing, within 15%
  const closeCalls = useMemo(() => {
    const out: { slot: string; a: Row; b: Row }[] = [];
    for (const a of roster) {
      const sa = slots.get(a.p.id);
      if (!isStart(sa) || sa === 'G' || !gameFor(a.p, day) || hurt(a.p)) continue;
      const alt = roster.filter((b) => slots.get(b.p.id) === 'BN' && gameFor(b.p, day) && !hurt(b.p) && canPlay(b.p, sa!))
        .sort((x, y) => expPts(y.p) - expPts(x.p))[0];
      if (alt && Math.abs(expPts(alt.p) - expPts(a.p)) <= 0.15 * Math.max(expPts(a.p), expPts(alt.p)) && !out.some((o) => o.b.p.id === alt.p.id)) out.push({ slot: sa!, a, b: alt });
    }
    return out.slice(0, 4);
  }, [roster, slots, day, gamesOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cmp, setCmp] = useState<number[]>([]);
  const toggleCmp = (id: number) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-4)));

  return (
    <div className="space-y-3">
      {/* the date strip */}
      <div className="card p-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-mute"><CalendarDays size={14} /> Pick a day. Set it now, up to {Math.round((new Date(end).getTime() - new Date(today).getTime()) / 86400000)} days out.</div>
        <div className="scroll-x flex gap-1 pb-1">
          {days.map((d) => {
            const s = games ? summary(d) : null;
            const own = plans.has(d);
            const on = d === day;
            return (
              <button key={d} onClick={() => setDay(d)} className={`relative flex w-[58px] shrink-0 flex-col items-center rounded-xl border px-1 py-1.5 text-center transition ${on ? 'border-gold bg-gold/15' : 'border-white/[.07] bg-white/[.03] hover:bg-white/[.07]'}`}>
                <span className="text-[10px] font-semibold uppercase text-mute">{d === today ? 'Today' : dayLabel(d)}</span>
                <span className="text-sm font-bold">{monthDay(d).replace(/^\w+ /, '')}</span>
                <span className="text-[9px] text-mute">{monthDay(d).split(' ')[0]}</span>
                {s && <span className={`num mt-0.5 rounded-full px-1.5 text-[10px] font-bold ${s.benched > 0 ? 'bg-amber-500/20 text-amber-200' : s.playing ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/[.05] text-mute'}`} title={`${s.playing} starters playing${s.benched ? `, ${s.benched} benched with a game` : ''}`}>{s.playing}{s.benched ? `+${s.benched}` : ''}</span>}
                {own && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-400" title="Lineup set for this day" />}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 px-1 text-[10px] text-mute">
          <span><span className="rounded-full bg-emerald-500/20 px-1 text-emerald-200">5</span> starters with a game</span>
          <span><span className="rounded-full bg-amber-500/20 px-1 text-amber-200">5+2</span> and 2 benched who play</span>
          <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />lineup saved for that day</span>
        </div>
      </div>

      {/* the day */}
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{day === today ? 'Today' : new Date(day + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}</div>
            <div className="text-xs text-mute">
              {day === today ? 'Live lineup: saves immediately. Players whose game has started are locked.'
                : eff.source === 'own' ? 'You set this day. It becomes your live lineup that morning.'
                : eff.source ? `No lineup of its own yet: carries forward from ${monthDay(eff.source)}.`
                : me?.auto_mode && me.auto_mode !== 'off' ? 'Nothing saved: your auto-pilot will set the best lineup that morning. Save a lineup to take over.'
                : 'Nothing saved: today’s lineup carries forward. Save to set this day.'}
            </div>
          </div>
          <div className="text-right text-xs"><div className="num text-base font-bold text-emerald-300">{fmtPts(dayPts, 1)}</div><div className="text-mute">projected pts</div></div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="chip">{playingNow} of {roster.filter((x) => gameFor(x.p, day)).length} with games in the lineup</span>
          {benchedPlaying.length > 0 && <span className="chip bg-amber-500/15 text-amber-200">⚠️ {benchedPlaying.length} benched with a game</span>}
          {idleStarters.length > 0 && <span className="chip bg-white/[.05] text-mute">{idleStarters.length} starters idle</span>}
          {emptyOnGameDay > 0 && <span className="chip bg-amber-500/15 text-amber-200">{emptyOnGameDay} empty starting slot{emptyOnGameDay > 1 ? 's' : ''}</span>}
          {over.map((o) => <span key={o} className="chip bg-red-500/20 text-red-200">⛔ {o}</span>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn-blue btn-sm" disabled={busy || !games} onClick={() => setDraft(optimizeDay(day, slots))}><Sparkles size={14} /> Optimize this day</button>
          <button className="btn-primary btn-sm" disabled={busy || !dirty || over.length > 0} onClick={save}><Save size={14} /> Save{dirty ? '' : 'd'}</button>
          {dirty && <button className="btn-ghost btn-sm" onClick={() => setDraft(null)}><Undo2 size={14} /> Undo</button>}
          {day !== today && eff.source === 'own' && !dirty && <button className="btn-ghost btn-sm text-red-300" disabled={busy} onClick={clearDay}><Trash2 size={14} /> Clear day</button>}
          <span className="ml-auto flex items-center gap-1">
            <select aria-label="Copy to how many days" className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-xs" value={copyTo} onChange={(e) => setCopyTo(Number(e.target.value))}>
              {[3, 7, 14, 30, 60].map((n) => <option key={n} value={n}>next {n} days</option>)}
            </select>
            <button className="btn-ghost btn-sm" disabled={busy || over.length > 0} onClick={copyAhead} title="Use this lineup for the following days"><Copy size={14} /> Copy</button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[.06] pt-2 text-xs">
          <span className="text-mute">Autofill the best lineup day by day:</span>
          {[7, 14, 30].map((n) => <button key={n} className="btn-ghost btn-sm" disabled={busy || !games} onClick={() => confirm(`Set the best lineup for each of the next ${n} days? It replaces any lineup you already saved for those days. Pins are respected.`) && optimizeAhead(n)}>Next {n} days</button>)}
        </div>
      </div>

      {/* start / sit */}
      {best && (
        <div className="card space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold">Start / sit{day === today ? ' today' : ` · ${monthDay(day)}`}</div>
            {toStart.length === 0 ? <span className="chip bg-emerald-500/15 text-emerald-200">✅ This is already the best lineup for the day</span>
              : <span className="chip bg-sky-500/15 text-sky-100">+{fmtPts(bestPts - dayPts, 1)} projected pts with {toStart.length} change{toStart.length > 1 ? 's' : ''}</span>}
            {toStart.length > 0 && <button className="btn-blue btn-sm ml-auto" onClick={() => setDraft(best)}><Sparkles size={14} /> Make these changes</button>}
          </div>
          {toStart.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[.05] p-2">
                <div className="label mb-1 text-emerald-200">▲ Start</div>
                {toStart.map((x) => <div key={x.p.id} className="py-1 text-sm"><span className="font-semibold">{x.p.name}</span> <span className="text-[11px] text-mute">{x.p.elig.join('/')} → {best.get(x.p.id)}</span><div className="text-[11px] text-slate-300">{why(x.p, true)}</div></div>)}
              </div>
              <div className="rounded-xl border border-red-400/20 bg-red-500/[.05] p-2">
                <div className="label mb-1 text-red-200">▼ Sit</div>
                {toSit.map((x) => <div key={x.p.id} className="py-1 text-sm"><span className="font-semibold">{x.p.name}</span> <span className="text-[11px] text-mute">{slots.get(x.p.id)} → bench</span><div className="text-[11px] text-slate-300">{why(x.p, false)}</div></div>)}
              </div>
            </div>
          )}
          {closeCalls.length > 0 && (
            <div>
              <div className="label mb-1">Close calls</div>
              <div className="space-y-1">{closeCalls.map(({ slot, a, b }) => {
                const edge = expPts(a.p) >= expPts(b.p) ? a : b;
                return (
                  <div key={a.p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-white/[.03] px-2 py-1.5 text-xs">
                    <span className="chip px-1.5 py-0">{slot}</span>
                    <span><b>{a.p.name}</b> {expPts(a.p).toFixed(2)}</span><span className="text-mute">vs</span><span><b>{b.p.name}</b> {expPts(b.p).toFixed(2)}</span>
                    <span className="text-mute">· edge {edge.p.last_name ?? edge.p.name}{form(edge.p) != null ? `, ${form(edge.p)!.toFixed(2)}/g lately` : ''}</span>
                    <button className="ml-auto text-sky-300 hover:underline" onClick={() => setCmp([a.p.id, b.p.id])}>Compare</button>
                  </div>
                );
              })}</div>
            </div>
          )}
          {cmp.length >= 2 && (() => {
            const ps = cmp.map((id) => roster.find((x) => x.p.id === id)).filter((x): x is Row => !!x);
            const top = [...ps].sort((x, y) => (gameFor(y.p, day) ? expPts(y.p) : 0) - (gameFor(x.p, day) ? expPts(x.p) : 0))[0];
            const rowsC: [string, (p: Player) => string][] = [
              ['Game', (p) => { const g = gameFor(p, day); return g ? `${g.home === p.nhl_team ? 'vs ' + g.away : '@' + g.home} ${new Date(g.start_utc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'no game'; }],
              ['Expected pts', (p) => (gameFor(p, day) ? expPts(p).toFixed(2) : '0')],
              ['Projected / game', (p) => perGameProj(p).toFixed(2)],
              ['Plays (chance)', (p) => `${Math.round(dressRate(p) * 100)}%`],
              ['Season FP/G', (p) => { const x = season.get(p.id); return x && x.gp ? (x.fpts / x.gp).toFixed(2) : '–'; }],
              ['Last 14 days', (p) => (form(p) != null ? `${form(p)!.toFixed(2)}/g` : '–')],
              ['Games next 7 days', (p) => String(gamesIn(p, day, 7))],
              ['Rest of season', (p) => fmtPts(rosPoints(p, season.get(p.id)), 0)],
              ['Status', (p) => p.injury_status ?? 'healthy'],
            ];
            return (
              <div className="rounded-xl border border-white/[.08]">
                <div className="flex items-center justify-between border-b border-white/[.06] px-2 py-1.5"><span className="label">Head to head{day === today ? ' today' : ` · ${monthDay(day)}`}</span><button className="text-xs text-mute" onClick={() => setCmp([])}>Close</button></div>
                <div className="scroll-x"><table className="w-full text-xs">
                  <thead><tr><th className="px-2 py-1 text-left text-mute" />{ps.map((x) => <th key={x.p.id} className={`px-2 py-1 text-left ${x === top ? 'text-emerald-300' : ''}`}>{x.p.name}{x === top ? ' ✓' : ''}<div className="text-[10px] font-normal text-mute">{x.p.elig.join('/')} · now {slots.get(x.p.id)}</div></th>)}</tr></thead>
                  <tbody className="divide-y divide-white/[.05]">{rowsC.map(([l, f]) => <tr key={l}><td className="whitespace-nowrap px-2 py-1 text-mute">{l}</td>{ps.map((x) => <td key={x.p.id} className="num whitespace-nowrap px-2 py-1">{f(x.p)}</td>)}</tr>)}</tbody>
                </table></div>
                <div className="px-2 py-1.5 text-[11px] text-slate-300">Verdict: start <b>{top.p.name}</b>{gameFor(top.p, day) ? '' : ' (nobody here plays this day)'}. {details?.get(top.p.id)?.proj_meta?.factors?.[0]?.text ?? ''}</div>
              </div>
            );
          })()}
          <p className="text-[11px] text-mute">Expected points = projected points per game × the chance he plays (goalies: the chance he starts). Tick ⚖️ on any two to four players in the grid to compare them head to head.</p>
        </div>
      )}

      {/* the grid */}
      <div className="card overflow-hidden">
        <div className="space-y-1.5 border-b border-white/[.06] p-2">
          <div className="scroll-x flex gap-1">
            {VIEWS.map((v) => <button key={v.k} onClick={() => { setView(v.k); setSort(null); }} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${view === v.k ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{v.label}</button>)}
          </div>
          <div className="scroll-x flex items-center gap-1">
            {view !== 'proj' && TIMEFRAMES.filter((x) => x.k !== 'ros').map((x) => (
              <button key={x.k} disabled={x.live && !windows.size} title={x.label} onClick={() => setTf(x.k)} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-35 ${tfOk === x.k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`}>{x.short}</button>
            ))}
            {view !== 'fantasy' && <button onClick={() => setPerGame(!perGame)} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${perGame ? 'bg-emerald-500 text-ice' : 'bg-white/[.05] text-mute'}`}>Per game</button>}
          </div>
          <div className="scroll-x flex gap-1">
            {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold ${filter === f ? 'bg-white/15 text-white' : 'text-mute hover:text-slate-200'}`}>{f}</button>)}
          </div>
        </div>
        <div className="scroll-x">
          <table className="w-full text-xs">
            <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
              <tr>
                <th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Slot</th>
                <th className="sticky left-[62px] z-10 bg-rink px-2 text-left">Player</th>
                <th className="px-2 text-left">{day === today ? 'Today' : monthDay(day)}</th>
                {cols.map((k) => (
                  <th key={k} className="cursor-pointer whitespace-nowrap px-2 text-right hover:text-white" onClick={() => setSort(sort?.k === k ? (sort.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 })}>
                    {view === 'points' ? pointsLabel(k) : LABEL[k] ?? k}{sort?.k === k ? (sort.dir === 1 ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.05]">
              {rows.map(({ p, r }) => {
                const s = slots.get(p.id) ?? 'BN';
                const g = gameFor(p, day);
                const lk = locked(p);
                const options = [...START.filter((x) => canPlay(p, x)), 'BN', ...(hurt(p) || s === 'IR' ? ['IR'] : [])];
                const changed = draft && eff.slots.get(p.id) !== s;
                return (
                  <tr key={p.id} className={`${START.includes(s as Slot) ? '' : 'text-slate-400'} ${changed ? 'bg-sky-500/[.08]' : ''}`}>
                    <td className="sticky left-0 z-10 bg-rink px-2 py-1">
                      <select aria-label={`Slot for ${p.name}`} disabled={lk || me?.role === 'spectator'} value={s} onChange={(e) => setSlot(p.id, e.target.value)}
                        className={`w-[52px] rounded-md border px-1 py-0.5 text-[11px] font-bold ${START.includes(s as Slot) ? 'border-sky-400/40 bg-sky-500/15 text-sky-100' : 'border-white/10 bg-black/40 text-slate-300'} disabled:opacity-60`}>
                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="sticky left-[62px] z-10 max-w-[170px] bg-rink px-2">
                      <div className="flex items-center gap-1.5">
                        <Headshot p={p} size={22} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-100"><button aria-label={`Compare ${p.name}`} title="Compare" onClick={() => toggleCmp(p.id)} className={`mr-1 ${cmp.includes(p.id) ? '' : 'opacity-30 hover:opacity-80'}`}>⚖️</button>{p.name}{r.pin === 'start' ? ' 📌' : r.pin === 'bench' ? ' 🚫' : ''}{lk ? ' 🔒' : ''}</div>
                          <div className="truncate text-[10px] text-mute">{p.elig.join('/')} · {p.nhl_team}{p.injury_status ? <span className="text-red-300"> · {p.injury_status}</span> : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2">{g ? <span className={START.includes(s as Slot) ? 'text-emerald-300' : 'text-amber-200'}>{g.home === p.nhl_team ? 'vs ' + g.away : '@' + g.home} <span className="text-mute">{new Date(g.start_utc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></span> : <span className="text-white/20">no game</span>}</td>
                    {cols.map((k) => <td key={k} className="num whitespace-nowrap px-2 text-right">{fmt(k, value(p, k))}</td>)}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={cols.length + 3} className="p-3 text-center text-mute">No players match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">
          {view === 'points' ? 'Fantasy points each category produced under the league’s scoring. Tap a column to sort.' : view === 'proj' ? 'The SAK projection for the full season (goalies: GP = starts, G = wins, A = saves, P = shutouts). Range = the gap between a bad year and a great year.' : view === 'fantasy' ? 'Proj/G = projected fantasy points per game. ROS = rest of season. FP uses the timeframe below. Games = NHL games from the selected day.' : 'Tap a column to sort. Per game divides by games played.'}
        </div>
      </div>
    </div>
  );
}
