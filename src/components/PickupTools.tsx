// Free agency tools for the Players page:
//  • Pickup advisor: every add/drop that makes your lineup better over the stretch you pick (next 7, 14, 30 days
//    or the rest of the season), measured by playing your roster out night by night over the real schedule.
//  • Roster vs available: any team's players at each position next to the best free agents there.
import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { gamesOf, rosPerGame, dressRate } from '../lib/lineup';
import { forecastTeam, type FPlayer } from '../lib/forecast';
import { useProjDetails, useSeasonGames, toneCls, toneIcon } from '../lib/projections';
import type { Player } from '../lib/types';
import { Headshot, Pos, TeamBadge, useAction } from './ui';
import { PlayerSheet } from './PlayerCard';
import { useCategoryValues } from './PlayerFilters';

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

interface Idea { add: Player; drop: Player | null; gain: number; games: number; filled: number; exp: number; dropExp: number }

export function PickupAdvisor() {
  const { me, league, players, rosters, owner, refresh } = useLeague();
  const games = useSeasonGames();
  const details = useProjDetails();
  const value = usePlayerValue();
  const { busy, run } = useAction();
  const [h, setH] = useState<Horizon>(14);
  const [pos, setPos] = useState<'All' | 'C' | 'LW' | 'RW' | 'D' | 'G'>('All');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const today = etToday();
  const to = h ? addDays(today, h - 1) : league?.season_end ?? addDays(today, 200);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const rosterMax = Object.entries(caps).filter(([k]) => k !== 'IR').reduce((t, [, n]) => t + n, 0);
  const mine = useMemo(() => rosters.filter((r) => r.team_id === me?.id), [rosters, me?.id]);
  const activeCount = mine.filter((r) => r.slot !== 'IR').length;
  const gamesIn = (p: Player) => (games ?? []).filter((g) => g.date >= today && g.date <= to && g.state !== 'PPD' && (g.home === p.nhl_team || g.away === p.nhl_team)).length;

  useEffect(() => {
    if (!games || !me || league?.phase !== 'season') return;
    setIdeas(null);
    const t = setTimeout(() => {
      const roster = mine.filter((r) => r.slot !== 'IR').map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
      const fp = roster.map(value);
      const base = forecastTeam(me.id, fp, games, caps, today, 0, to);
      // who could go: the players doing the least for this lineup over the stretch
      const drops = [...roster].sort((a, b) => ((base.players.get(a.id)?.pts ?? 0) + (base.players.get(a.id)?.benchPts ?? 0) * 0.2) - ((base.players.get(b.id)?.pts ?? 0) + (base.players.get(b.id)?.benchPts ?? 0) * 0.2)).slice(0, h ? 5 : 3);
      const n = h ? 40 : 20;
      const pool = [...players.values()].filter((p) => !owner.has(p.id) && p.proj > 0 && !hurt(p) && (pos === 'All' || (pos === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(pos))))
        .map((p) => ({ p, v: value(p), g: gamesIn(p) }))
        .sort((a, b) => b.v.proj / gamesOf(b.v) * dressRate(b.v) * (h ? b.g : 82) - a.v.proj / gamesOf(a.v) * dressRate(a.v) * (h ? a.g : 82)).slice(0, n);
      const out: Idea[] = [];
      for (const { p, v, g } of pool) {
        let bestIdea: Idea | null = null;
        const options: (Player | null)[] = activeCount < rosterMax ? [null, ...drops] : drops;
        for (const d of options) {
          const next = d ? fp.filter((x) => x.id !== d.id) : [...fp];
          next.push(v);
          const f = forecastTeam(me.id, next, games, caps, today, 0, to);
          const gain = f.ros - base.ros;
          if (!bestIdea || gain > bestIdea.gain) bestIdea = { add: p, drop: d, gain, games: g, filled: base.emptySlots - f.emptySlots, exp: v.proj / gamesOf(v) * dressRate(v), dropExp: d ? value(d).proj / gamesOf(d) * dressRate(d) : 0 };
        }
        if (bestIdea && bestIdea.gain > 0.5) out.push(bestIdea);
      }
      setIdeas(out.sort((a, b) => b.gain - a.gain).slice(0, 12));
    }, 30);
    return () => clearTimeout(t);
  }, [games, me?.id, h, pos, mine, players, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAdd = (i: Idea) => run(async () => {
    await rpc('add_player', { p_add: i.add.id, p_drop: i.drop?.id ?? null });
    await refresh(['rosters', 'standings']);
  }, `${i.add.name} added${i.drop ? `, ${i.drop.name} dropped` : ''}`);

  if (league?.phase !== 'season') return <div className="card p-4 text-sm text-mute">The pickup advisor opens once the season starts.</div>;
  if (!me || me.role === 'spectator') return <div className="card p-4 text-sm text-mute">The pickup advisor works on a GM’s roster.</div>;
  const span = h ? `the next ${h} days` : 'the rest of the season';
  return (
    <div className="space-y-2">
      <div className="card space-y-2 p-3">
        <div className="text-sm">Every free agent who would make your lineup better over <b>{span}</b>, with the best player to drop for him. It plays your roster out night by night over the real schedule, so games played, open slots and position fit all count.</div>
        <div className="flex flex-wrap items-center gap-1">
          {([7, 14, 30, 0] as Horizon[]).map((x) => <button key={x} onClick={() => setH(x)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${h === x ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{x ? `Next ${x} days` : 'Rest of season'}</button>)}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {(['All', 'C', 'LW', 'RW', 'D', 'G'] as const).map((x) => <button key={x} onClick={() => setPos(x)} className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${pos === x ? 'bg-white/15 text-white' : 'text-mute'}`}>{x}</button>)}
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
                      <span className="block truncate font-semibold">➕ {i.add.name} <span className="text-[11px] font-normal text-mute">{i.add.elig.join('/')} · {i.add.nhl_team}</span></span>
                      <span className="block text-[11px] text-slate-300">{i.games} games · {i.exp.toFixed(2)} expected/game{i.filled >= 1 ? ` · fills ${Math.round(i.filled)} empty slot-night${Math.round(i.filled) > 1 ? 's' : ''}` : ''}</span>
                      {f && <span className={`block truncate text-[11px] ${toneCls[f.tone]}`}>{toneIcon[f.tone]} <span className="text-slate-300">{f.text}</span></span>}
                      <span className="block truncate text-[11px] text-mute">{i.drop ? <>➖ drop {i.drop.name} ({i.drop.elig.join('/')}, {i.dropExp.toFixed(2)}/game)</> : 'you have an open roster spot'}</span>
                    </span>
                  </button>
                  <div className="text-right"><div className="num text-lg font-bold text-emerald-300">+{fmtPts(i.gain, 1)}</div><div className="text-[10px] text-mute">pts, {h ? `${h} days` : 'season'}</div></div>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => confirm(`Add ${i.add.name}${i.drop ? ` and drop ${i.drop.name}` : ''}?`) && doAdd(i)}>Add</button>
                </div>
              );
            })}
          </div>
        )}
      <p className="px-1 text-[11px] text-mute">Gain = projected lineup points over {span} with the move, minus without it. Free pickups are limited ({league?.max_acquisitions ?? 10} for the regular season and playoffs, +{league?.playoff_bonus_acq ?? 3} when the playoffs start; no paid extras, so trade with another GM for more), so short stretches favour streaming only when the gain is big.</p>
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

type Metric = 'ros' | 'proj' | 'pg' | 'season' | 'form' | 'cat';
const METRICS: { k: Metric; label: string }[] = [{ k: 'ros', label: 'Rest of season' }, { k: 'pg', label: 'Proj / game' }, { k: 'proj', label: 'Projection' }, { k: 'season', label: 'Season FP/G' }, { k: 'form', label: 'Last 14 FP/G' }];

export function RosterVsAvailable() {
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
  const POSS = ['C', 'LW', 'RW', 'D', 'G'] as const;
  const at = (p: Player, pos: string) => (pos === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(pos));
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
          const theirs = mine.filter((p) => at(p, pos)).sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1));
          const fas = avail.filter((p) => at(p, pos)).sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1)).slice(0, 5);
          const floor = theirs.length ? Math.min(...theirs.map((p) => val(p) ?? 0)) : 0;
          const weakest = theirs[theirs.length - 1];
          return (
            <div key={pos} className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-1.5"><Pos p={pos} /><span className="text-sm font-semibold">{theirs.length} on roster</span><span className="ml-auto text-[11px] text-mute">{fas.filter((p) => (val(p) ?? 0) > floor).length} free-agent upgrade{fas.filter((p) => (val(p) ?? 0) > floor).length === 1 ? '' : 's'}</span></div>
              <div className="grid grid-cols-2 divide-x divide-white/[.06]">
                <div className="divide-y divide-white/[.05]">
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-mute"><TeamBadge team={team(tid)} size={14} />{team(tid)?.abbrev}</div>
                  {theirs.map((p) => <button key={p.id} onClick={() => setDetail(p.id)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs"><Headshot p={p} size={20} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="num font-semibold">{fmt(val(p))}</span></button>)}
                  {theirs.length === 0 && <div className="px-2 py-2 text-xs text-amber-200">Nobody here</div>}
                </div>
                <div className="divide-y divide-white/[.05]">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-mute">Free agents</div>
                  {fas.map((p) => { const up = (val(p) ?? 0) > floor; return (
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
