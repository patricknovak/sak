// Free agency tools for the Players page:
//  • Pickup advisor: every add/drop that makes your lineup better over the stretch you pick (next 7, 14, 30 days
//    or the rest of the season), measured by playing your roster out night by night over the real schedule.
//  • Roster vs available: any team's players at each position next to the best free agents there.
import { useEffect, useMemo, useState } from 'react';
import { useLeague, useSport } from '../lib/store';
import { calledOff, notStarted, plays, positionKeys } from '../lib/sport';
import { rpc } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { gamesOf, rosPerGame, dressRate } from '../lib/lineup';
import { forecastTeam, type FPlayer } from '../lib/forecast';
import { useProjDetails, useSeasonGames, toneCls, toneIcon } from '../lib/projections';
import type { Player } from '../lib/types';
import { Headshot, Pos, TeamBadge, useAction } from './ui';
import { PlayerSheet } from './PlayerCard';
import { useCategoryValues } from './PlayerFilters';
import { useRoto } from './RotoStandings';
import { buildModel, categoryDelta, contribution, perGame, scorePerGame, isGoalieCat } from '../lib/catpickup';
import { categoryOf, fmtCat } from '../lib/categories';

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hurt = (p: Player) => !!p.injury_status && /^(out|ir|injured|long|suspen)/i.test(p.injury_status);
type Horizon = 7 | 14 | 30 | 0;   // 0 = rest of season

// a player valued for what's left: the projection blended with this season's pace
function usePlayerValue() {
  const { season } = useLeague();
  return (p: Player): FPlayer => {
    const s = season.get(p.id);
    const pg = rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp);
    return { ...p, proj: pg * gamesOf(p) };
  };
}

interface Idea { add: Player; drop: Player | null; gain: number; games: number; filled: number; exp: number; dropExp: number; cats?: Record<string, number> }

// the games a season line covers, as the lineup forecast counts them
const gpOf = (p: Player) => (p.proj_gp && p.proj_gp > 0 ? p.proj_gp : p.pos === 'G' ? 58 : 80);

export function PickupAdvisor() {
  const { me, league, players, rosters, owner, refresh, season, games: tonight, leagueDay } = useLeague();
  const games = useSeasonGames();
  const details = useProjDetails();
  const pointsValue = usePlayerValue();
  // a category league weighs a move by what it does for the categories the team trails in, not by fantasy points
  const cats = useMemo(() => league?.categories ?? [], [league?.categories]);
  const catOn = cats.length > 0;
  const roto = useRoto();
  const myRow = roto?.find((r) => r.team_id === me?.id);
  // the model changes when the team's places in the table do, not every time the standings refresh (every minute
  // while games are on): a new model would clear the list and play every move out again
  const needSig = !roto ? '' : `${roto.length}|${cats.map((k) => myRow?.cats[k]?.pts ?? '-').join(',')}`;
  const model = useMemo(() => {
    if (!catOn || !needSig) return null;
    const pts = Object.fromEntries(cats.map((k) => [k, Number(myRow?.cats[k]?.pts ?? 0)]));
    return buildModel(cats, [...players.values()], season, myRow ? { pts, teams: roto!.length } : undefined);
  }, [catOn, cats, needSig, players]); // eslint-disable-line react-hooks/exhaustive-deps
  const rates = useMemo(() => {
    if (!model) return null;
    return new Map([...players.values()].map((p) => [p.id, perGame(p, season.get(p.id), cats)]));
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = (p: Player): FPlayer => (model && rates ? { ...p, proj: scorePerGame(model, rates.get(p.id) ?? null, p) * gpOf(p) } : pointsValue(p));
  const { busy, run } = useAction();
  const [h, setH] = useState<Horizon>(14);
  const sport = useSport();
  // tonight's games already under way are no use to a player picked up now (the call is scored on the games that start
  // after it), so the advisor plays only the ones still to come
  const begunKey = tonight.filter((g) => g.date === leagueDay && !notStarted(sport, g.state) && !calledOff(sport, g.state)).map((g) => g.id).join();
  const ahead = useMemo(() => {
    if (!games) return null;
    const begun = new Set(begunKey.split(',').filter(Boolean).map(Number));
    return begun.size ? games.filter((g) => !(g.id != null && begun.has(g.id))) : games;
  }, [games, begunKey]);
  const [pos, setPos] = useState<string>('All');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const today = etToday();
  const to = h ? addDays(today, h - 1) : league?.season_end ?? addDays(today, 200);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const rosterMax = Object.entries(caps).filter(([k]) => k !== 'IR').reduce((t, [, n]) => t + n, 0);
  const mine = useMemo(() => rosters.filter((r) => r.team_id === me?.id), [rosters, me?.id]);
  const activeCount = mine.filter((r) => r.slot !== 'IR').length;
  const gamesIn = (p: Player) => (ahead ?? []).filter((g) => g.date >= today && g.date <= to && !calledOff(sport, g.state) && (g.home === p.nhl_team || g.away === p.nhl_team)).length;

  useEffect(() => {
    if (!ahead || !me || league?.phase !== 'season' || (catOn && !model)) return;
    setIdeas(null);
    const t = setTimeout(() => {
      const roster = mine.filter((r) => r.slot !== 'IR').map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
      const fp = roster.map(value);
      const base = forecastTeam(me.id, fp, ahead, caps, today, 0, to);
      // who could go: the players doing the least for this lineup over the stretch
      const drops = [...roster].sort((a, b) => ((base.players.get(a.id)?.pts ?? 0) + (base.players.get(a.id)?.benchPts ?? 0) * 0.2) - ((base.players.get(b.id)?.pts ?? 0) + (base.players.get(b.id)?.benchPts ?? 0) * 0.2)).slice(0, h ? 5 : 3);
      const n = h ? 40 : 20;
      const rank = (x: { v: FPlayer; g: number }) => x.v.proj / gamesOf(x.v) * dressRate(x.v) * (h ? x.g : 82);
      const free = [...players.values()].filter((p) => !owner.has(p.id) && p.proj > 0 && !hurt(p) && (pos === 'All' || plays(sport, p, pos)))
        .map((p) => ({ p, v: value(p), g: gamesIn(p) }));
      // category values aren't on one scale across skaters and goalies, so each group brings its own best
      const pool = catOn
        ? [...free.filter((x) => x.p.pos !== 'G').sort((a, b) => rank(b) - rank(a)).slice(0, Math.round(n * 0.75)), ...free.filter((x) => x.p.pos === 'G').sort((a, b) => rank(b) - rank(a)).slice(0, Math.round(n * 0.25))]
        : free.sort((a, b) => rank(b) - rank(a)).slice(0, n);
      const posOf = new Map([...roster, ...pool.map((x) => x.p)].map((p) => [p.id, p.pos]));
      const out: Idea[] = [];
      for (const { p, v, g } of pool) {
        let bestIdea: Idea | null = null;
        const options: (Player | null)[] = activeCount < rosterMax ? [null, ...drops] : drops;
        for (const d of options) {
          const next = d ? fp.filter((x) => x.id !== d.id) : [...fp];
          next.push(v);
          const f = forecastTeam(me.id, next, ahead, caps, today, 0, to);
          const gain = f.ros - base.ros;
          if (!bestIdea || gain > bestIdea.gain) bestIdea = { add: p, drop: d, gain, games: g, filled: base.emptySlots - f.emptySlots, exp: v.proj / gamesOf(v) * dressRate(v), dropExp: d ? value(d).proj / gamesOf(d) * dressRate(d) : 0,
            cats: model && rates ? categoryDelta(model, rates, posOf, base.players, f.players) : undefined };
        }
        // a category gain is a share of the lineup's weighted output: worth showing from half a percent
        if (bestIdea && bestIdea.gain > (catOn ? Math.max(0.05, base.ros * 0.005) : 0.5)) out.push(catOn ? { ...bestIdea, gain: bestIdea.gain / Math.max(base.ros, bestIdea.gain) * 100 } : bestIdea);
      }
      setIdeas(out.sort((a, b) => b.gain - a.gain).slice(0, 12));
    }, 30);
    return () => clearTimeout(t);
  }, [ahead, me?.id, h, pos, mine, players, owner, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAdd = (i: Idea) => run(async () => {
    await rpc('add_player', { p_add: i.add.id, p_drop: i.drop?.id ?? null });
    // the prediction log (migration 138): what the advisor promised, scored once the stretch is over (points leagues;
    // a category league's gain is a share, not points)
    if (!catOn) rpc('log_pickup_call', { p_add: i.add.id, p_drop: i.drop?.id ?? null, p_gain: Math.round(i.gain * 100) / 100, p_to: to }).catch(() => {});
    await refresh(['rosters', 'standings']);
  }, `${i.add.name} added${i.drop ? `, ${i.drop.name} dropped` : ''}`);

  if (league?.phase !== 'season') return <div className="card p-4 text-sm text-mute">The pickup advisor opens once the season starts.</div>;
  if (!me || me.role === 'spectator') return <div className="card p-4 text-sm text-mute">The pickup advisor works on a GM’s roster.</div>;
  const span = h ? `the next ${h} days` : 'the rest of the season';
  return (
    <div className="space-y-2">
      <div className="card space-y-2 p-3">
        <div className="text-sm">Every free agent who would make your lineup better over <b>{span}</b>{catOn ? ' in your categories' : ''}, with the best player to drop for him. It plays your roster out night by night over the real schedule, so games played, open slots and position fit all count.</div>
        {model && <NeedLine weight={model.weight} pts={myRow?.cats} teams={roto?.length ?? 0} />}
        <div className="flex flex-wrap items-center gap-1">
          {([7, 14, 30, 0] as Horizon[]).map((x) => <button key={x} onClick={() => setH(x)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${h === x ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{x ? `Next ${x} days` : 'Rest of season'}</button>)}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {['All', ...positionKeys(sport)].map((x) => <button key={x} onClick={() => setPos(x)} className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${pos === x ? 'bg-white/15 text-white' : 'text-mute'}`}>{x}</button>)}
        </div>
      </div>
      {!ideas ? <div className="card p-6 text-center text-sm text-mute">Playing out {span} with every free agent…</div>
        : ideas.length === 0 ? <div className="card p-4 text-sm text-mute">No free agent{pos === 'All' ? '' : ` at ${pos}`} makes your lineup better over {span}. Your roster is in good shape; check back after injuries or a hot streak.</div>
        : (
          <div className="card divide-y divide-white/[.06]">
            {ideas.map((i) => {
              const f = details?.get(i.add.id)?.proj_meta?.factors?.[0];
              return (
                <div key={i.add.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setDetail(i.add.id)}>
                    <Headshot p={i.add} size={36} />
                    <span className="min-w-0">
                      <span className="block break-words font-semibold">➕ {i.add.name} <span className="text-[11px] font-normal text-mute">{i.add.elig.join('/')} · {i.add.nhl_team}</span></span>
                      <span className="block text-[11px] text-slate-300">{i.games} games{model && rates ? bestAt(model, rates.get(i.add.id) ?? null, i.add) : ` · ${i.exp.toFixed(2)} expected/game`}{i.filled >= 1 ? ` · fills ${Math.round(i.filled)} empty slot-night${Math.round(i.filled) > 1 ? 's' : ''}` : ''}</span>
                      {f && !catOn && <span className={`block truncate text-[11px] ${toneCls[f.tone]}`}>{toneIcon[f.tone]} <span className="text-slate-300">{f.text}</span></span>}
                      <span className="block break-words text-[11px] text-mute">{i.drop ? <>➖ drop {i.drop.name} ({i.drop.elig.join('/')}{catOn ? '' : `, ${i.dropExp.toFixed(2)}/game`})</> : 'you have an open roster spot'}</span>
                    </span>
                  </button>
                  <div className="text-right"><div className="num text-lg font-bold text-emerald-300">+{catOn ? `${i.gain.toFixed(1)}%` : fmtPts(i.gain, 1)}</div><div className="text-[10px] text-mute">{catOn ? 'categories' : 'pts'}, {h ? `${h} days` : 'season'}</div></div>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => confirm(`Add ${i.add.name}${i.drop ? ` and drop ${i.drop.name}` : ''}?`) && doAdd(i)}>Add</button>
                  {i.cats && model && <CatChips d={i.cats} model={model} />}
                </div>
              );
            })}
          </div>
        )}
      <p className="px-1 text-[11px] text-mute">{catOn ? <>Gain = how much more your lineup does in your categories over {span} with the move, weighted to the ones you trail in and on one scale (a category counts by how much it varies between players), as a share of what it does now.</> : <>Gain = projected lineup points over {span} with the move, minus without it.</>} Free pickups are limited ({league?.max_acquisitions ?? 10} for the regular season and playoffs, +{league?.playoff_bonus_acq ?? 3} when the playoffs start; no paid extras, so trade with another GM for more), so short stretches favour streaming only when the gain is big.</p>
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// where the team trails, from the category table: the categories the advisor leans toward
function NeedLine({ weight, pts, teams }: { weight: Record<string, number>; pts?: Record<string, { pts: number }>; teams: number }) {
  const behind = Object.entries(weight).filter(([, w]) => w > 1.15).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (Object.values(weight).every((w) => w === 1)) return <div className="text-[11px] text-mute">Every category counts the same until the table separates.</div>;
  if (!behind.length) return <div className="text-[11px] text-mute">You’re in the top half of every category, so the advisor weighs them nearly evenly, a little more where you’re lowest.</div>;
  const place = (k: string) => { const n = Math.round(teams + 1 - Number(pts?.[k]?.pts ?? teams)); return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`; };
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-mute">Leaning to where you trail:</span>
      {behind.map(([k]) => <span key={k} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 font-semibold text-rose-200">{categoryOf(k)?.short ?? k} <span className="num font-normal text-rose-300/80">{place(k)}</span></span>)}
    </div>
  );
}

// a free agent's two strongest categories against the pool
function bestAt(m: ReturnType<typeof buildModel>, r: Record<string, number> | null, p: Player) {
  if (!r) return '';
  const top = m.cats.filter((k) => isGoalieCat(k) === (p.pos === 'G')).map((k) => [k, contribution(k, r, m.avg) / m.scale[k]] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.length ? ` · best at ${top.map(([k]) => categoryOf(k)?.short ?? k).join(', ')}` : '';
}

// what the move does to each category over the stretch, the biggest effects first (counting stats in their units)
function CatChips({ d, model }: { d: Record<string, number>; model: ReturnType<typeof buildModel> }) {
  const rows = Object.entries(d).map(([k, v]) => ({ k, v, w: Math.abs(categoryOf(k)?.rate ? v : v / model.scale[k]) }))
    .filter((x) => x.w >= 0.05).sort((a, b) => b.w - a.w).slice(0, 5);
  if (!rows.length) return null;
  return (
    <div className="flex w-full flex-wrap gap-1 pl-11">
      {rows.map(({ k, v }) => {
        const c = categoryOf(k), up = v > 0;
        return (
          <span key={k} className={`inline-flex items-baseline gap-1 rounded-lg border px-1.5 py-0.5 text-[11px] ${up ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-rose-400/30 bg-rose-400/10'}`}>
            <span className="font-semibold text-mute">{c?.short ?? k}</span>
            <span className={`num font-bold ${up ? 'text-emerald-300' : 'text-rose-300'}`}>{c?.rate ? (up ? '▲' : '▼') : `${up ? '+' : '−'}${fmtCat(k, Math.abs(v))}`}</span>
          </span>
        );
      })}
    </div>
  );
}

type Metric = 'ros' | 'proj' | 'pg' | 'season' | 'form' | 'cat';
const METRICS: { k: Metric; label: string }[] = [{ k: 'ros', label: 'Rest of season' }, { k: 'pg', label: 'Proj / game' }, { k: 'proj', label: 'Projection' }, { k: 'season', label: 'Season FP/G' }, { k: 'form', label: 'Last 14 FP/G' }];

export function RosterVsAvailable() {
  const sport = useSport();
  const { me, teams, team, players, rosters, owner, season, windows } = useLeague();
  const [tid, setTid] = useState<number>(me?.id && me.role !== 'spectator' ? me.id : teams.find((t) => t.role !== 'spectator')?.id ?? 1);
  // a category league compares on category value (migration 129), and opens on it
  const cv = useCategoryValues();
  const catOn = !!cv && cv.size > 0;
  const [picked, setMetric] = useState<Metric | null>(null);
  const metric: Metric = picked ?? (catOn ? 'cat' : 'ros');
  const metrics = catOn ? [{ k: 'cat' as Metric, label: 'Category value' }, ...METRICS] : METRICS;
  const [detail, setDetail] = useState<number | null>(null);
  const val = (p: Player): number | null => {
    if (metric === 'cat') return cv?.get(p.id) ?? null;
    const s = season.get(p.id);
    if (metric === 'proj') return p.proj;
    if (metric === 'pg') return p.proj / gamesOf(p);
    if (metric === 'ros') return rosPerGame(p.proj, p.pos, s?.gp ?? 0, s?.fpts ?? 0, p.proj_gp) * Math.max(0, gamesOf(p) - (s?.gp ?? 0));
    if (metric === 'season') return s && s.gp >= 3 ? s.fpts / s.gp : null;
    const w = windows.get(p.id)?.['14'];
    return w && w.gp >= 2 ? w.fpts / w.gp : null;
  };
  const fmt = (v: number | null) => (v == null ? '–' : metric === 'cat' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : metric === 'pg' || metric === 'season' || metric === 'form' ? v.toFixed(2) : fmtPts(v, 0));
  const POSS = positionKeys(sport);
  const at = (p: Player, pos: string) => plays(sport, p, pos);
  const mine = rosters.filter((r) => r.team_id === tid).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
  const avail = [...players.values()].filter((p) => !owner.has(p.id) && p.proj > 0);
  return (
    <div className="space-y-2">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" value={tid} onChange={(e) => setTid(Number(e.target.value))}>
          {teams.filter((t) => t.role !== 'spectator').map((t) => <option key={t.id} value={t.id}>{t.id === me?.id ? '🏠 My team' : `${t.emoji} ${t.name}`}</option>)}
        </select>
        <div className="scroll-x flex gap-1">{metrics.map((m) => <button key={m.k} onClick={() => setMetric(m.k)} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${metric === m.k ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{m.label}</button>)}</div>
        <div className="w-full text-[11px] text-mute">Each position: {team(tid)?.gm_name}’s players next to the five best free agents there. Green = a free agent better than {team(tid)?.gm_name}’s weakest player at that position.</div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {POSS.map((pos) => {
          // a category value is a z-score, often below zero: a player without one sorts last and is never an upgrade
          const missing = metric === 'cat' ? -1e9 : -1;
          const theirs = mine.filter((p) => at(p, pos)).sort((a, b) => (val(b) ?? missing) - (val(a) ?? missing));
          const fas = avail.filter((p) => at(p, pos)).sort((a, b) => (val(b) ?? missing) - (val(a) ?? missing)).slice(0, 5);
          const known = theirs.map((p) => val(p)).filter((v): v is number => v != null);
          const floor = metric === 'cat' ? (known.length ? Math.min(...known) : -1e9) : theirs.length ? Math.min(...theirs.map((p) => val(p) ?? 0)) : 0;
          const better = (p: Player) => (metric === 'cat' ? val(p) != null && val(p)! > floor : (val(p) ?? 0) > floor);
          const weakest = theirs[theirs.length - 1];
          return (
            <div key={pos} className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-1.5"><Pos p={pos} /><span className="text-sm font-semibold">{theirs.length} on roster</span><span className="ml-auto text-[11px] text-mute">{fas.filter(better).length} free-agent upgrade{fas.filter(better).length === 1 ? '' : 's'}</span></div>
              <div className="grid grid-cols-2 divide-x divide-white/[.06]">
                <div className="divide-y divide-white/[.05]">
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-mute"><TeamBadge team={team(tid)} size={14} />{team(tid)?.abbrev}</div>
                  {theirs.map((p) => <button key={p.id} onClick={() => setDetail(p.id)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs"><Headshot p={p} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="num font-semibold">{fmt(val(p))}</span></button>)}
                  {theirs.length === 0 && <div className="px-2 py-2 text-xs text-amber-200">Nobody here</div>}
                </div>
                <div className="divide-y divide-white/[.05]">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-mute">Free agents</div>
                  {fas.map((p) => { const up = better(p); return (
                    <button key={p.id} onClick={() => setDetail(p.id)} className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs ${up ? 'bg-emerald-500/[.08]' : ''}`} title={up && weakest ? `Better than ${weakest.name}` : undefined}>
                      <Headshot p={p} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}{p.injury_status ? <span className="text-red-300"> ·{p.injury_status.split(' ')[0]}</span> : ''}</span><span className={`num font-semibold ${up ? 'text-emerald-300' : ''}`}>{fmt(val(p))}</span>
                    </button>); })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
