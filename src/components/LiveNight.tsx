// Game night, told the way a GM watches it (16 October 2026, Patrick: "more beautiful and entertaining and useful for
// all GMs when they are watching live updates"): your night at a glance and where it's heading, the season race as it
// would stand if the night ended now, the night's stars, and a ticker of what just happened (each goal, assist, win
// and shutout by a rostered player, the moment the box score moves), with a goal horn for your own starters.
// Everything here is read from what the scoreboard already holds (the store's tonight's points, the puck-drop
// lineups): no extra calls to the database.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { Player, Standing, Team } from '../lib/types';
import { fmtPts, ordinal, readable } from '../lib/format';
import { gamesOf } from '../lib/lineup';
import { Headshot, TeamBadge } from './ui';
import { PlayerTag } from './PlayerCard';

export type NightLine = { player_id: number; slot: string; pts: number; pg?: { fpts: number; stats: Record<string, number> } };
export type NightRow = { t: Team; lines: NightLine[]; pts: number; done: number; playing: number; left: number; doneIds: Set<number>; playingIds: Set<number> };

// ---------- the ticker: what just happened ----------
export type NightEvent = { id: string; at: number; player_id: number; team_id: number | null; bench: boolean; delta: number; what: string; icon: string; big: boolean };
type Box = { player_id: number; fpts: number; stats: Record<string, number> };

// what moved in a player's line, in hockey words: a goal is the headline, then an assist, a win, a shutout; a goal
// against is the goalie's bad news. Shots, hits and the rest only make the ticker once they add up to a point or more.
const TELL: [string, string, string][] = [['g', '🚨', 'Goal'], ['a', '🍎', 'Assist'], ['w', '🥅', 'Win'], ['sho', '🧱', 'Shutout'], ['ga', '😬', 'Goal against']];
function tell(before: Record<string, number>, after: Record<string, number>, delta: number): { what: string; icon: string; big: boolean } | null {
  for (const [k, icon, word] of TELL) {
    const n = (after[k] ?? 0) - (before[k] ?? 0);
    if (n > 0) return { what: n > 1 ? `${n} ${word === 'Assist' ? 'assists' : word === 'Goal' ? 'goals' : word.toLowerCase() + 's'}` : word, icon, big: k === 'g' || k === 'w' || k === 'sho' };
  }
  if (Math.abs(delta) >= 1) return { what: delta > 0 ? 'Points up' : 'Points down', icon: delta > 0 ? '📈' : '📉', big: false };
  return null;
}

// the night's moments, kept for the tab's session so a reload doesn't lose them; the first read of a night only sets the
// mark, so nothing that happened before you opened the page is told as if it just did
export function useNightFeed(key: string, on: boolean, boxes: Box[], owner: (id: number) => { team_id: number; bench: boolean } | null, onMine?: (e: NightEvent) => void) {
  const store = `sak-night:${key}`;
  const [events, setEvents] = useState<NightEvent[]>(() => { try { return JSON.parse(sessionStorage.getItem(store) ?? '[]'); } catch { return []; } });
  const [flash, setFlash] = useState<Map<number, { d: number; at: number }>>(new Map());
  const prev = useRef<{ key: string; m: Map<number, Box> } | null>(null);
  useEffect(() => { try { setEvents(JSON.parse(sessionStorage.getItem(store) ?? '[]')); } catch { setEvents([]); } }, [store]);
  useEffect(() => {
    const m = new Map(boxes.map((b) => [b.player_id, b]));
    const was = prev.current;
    prev.current = { key, m };
    if (!on || !was || was.key !== key || !was.m.size) return;
    const now = Date.now();
    const fresh: NightEvent[] = [];
    const lit = new Map<number, { d: number; at: number }>();
    for (const [id, b] of m) {
      const o = was.m.get(id);
      const delta = Math.round((b.fpts - (o?.fpts ?? 0)) * 10) / 10;
      const st = o?.stats ?? {};
      const own = owner(id);
      if (!own) continue;
      if (delta !== 0) lit.set(id, { d: delta, at: now });
      const t = tell(st, b.stats ?? {}, delta);
      if (t) fresh.push({ id: `${id}:${now}`, at: now, player_id: id, team_id: own.team_id, bench: own.bench, delta, ...t });
    }
    if (lit.size) setFlash((f) => { const n = new Map([...f].filter(([, x]) => now - x.at < 120_000)); lit.forEach((v, k) => n.set(k, v)); return n; });
    if (!fresh.length) return;
    fresh.sort((a, b) => Number(b.big) - Number(a.big) || b.delta - a.delta);
    fresh.forEach((e) => onMine?.(e));
    setEvents((ev) => {
      const next = [...fresh, ...ev].slice(0, 40);
      try { sessionStorage.setItem(store, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [boxes, key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return { events, flash };
}

// one sound engine for the page, woken by a tap (phones start it muted until someone touches the screen)
let actx: AudioContext | null = null;
const audio = () => {
  try { actx ??= new AudioContext(); if (actx.state === 'suspended') actx.resume().catch(() => {}); return actx; } catch { return null; }
};
// a goal horn, made on the spot (no sound file to load): a low, wide chord that swells and fades
export function goalHorn() {
  try {
    const ctx = audio();
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.12);
    out.gain.setValueAtTime(0.18, ctx.currentTime + 1.4);
    out.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.1);
    out.connect(ctx.destination);
    for (const f of [110, 138.6, 164.8, 220]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.25;
      o.connect(g); g.connect(out); o.start(); o.stop(ctx.currentTime + 2.2);
    }
    navigator.vibrate?.([120, 60, 120, 60, 300]);
  } catch { /* no audio */ }
}
export function useHorn(): [boolean, (v: boolean) => void] {
  const [on, set] = useState(() => { try { return localStorage.getItem('sak-horn') === '1'; } catch { return false; } });
  // the horn was left on: the first touch on the page wakes the sound so the next goal is heard
  useEffect(() => {
    if (!on) return;
    const wake = () => { audio(); };
    document.addEventListener('pointerdown', wake, { once: true });
    return () => document.removeEventListener('pointerdown', wake);
  }, [on]);
  return [on, (v) => { set(v); try { localStorage.setItem('sak-horn', v ? '1' : '0'); } catch { /* private mode */ } if (v) goalHorn(); }];
}
export function HornToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => set(!on)} title={on ? 'Goal horn on for your starters' : 'Turn on a goal horn for your starters'}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${on ? 'bg-goal/20 text-rose-100 ring-1 ring-goal/40' : 'bg-white/[.05] text-mute ring-1 ring-white/10'}`}>
      {on ? <Volume2 size={13} /> : <VolumeX size={13} />}Horn
    </button>
  );
}

// ---------- your night ----------
// per-game projection, the same numbers the lineup tools use
const perGame = (p?: Player) => (p ? p.proj / Math.max(1, gamesOf(p)) : 0);
export function YourNight({ rows, me, players, past }: { rows: NightRow[]; me: Team | null; players: Map<number, Player>; past: boolean }) {
  const i = rows.findIndex((r) => r.t.id === me?.id);
  const r = i >= 0 ? rows[i] : null;
  const leader = rows[0];
  if (!leader || !rows.some((x) => x.lines.length)) return null;
  // where the night is heading: points in, plus each starter still to play at his per-game pace, and half of it for
  // anyone on the ice now
  const pace = (x: NightRow) => x.pts + x.lines.reduce((n, l) => n + (x.playingIds.has(l.player_id) ? perGame(players.get(l.player_id)) / 2 : !x.doneIds.has(l.player_id) && !x.playingIds.has(l.player_id) ? perGame(players.get(l.player_id)) : 0), 0);
  if (!r) {
    // a spectator: the night's leader takes the card
    return (
      <div className="card-hero p-4" style={{ '--tc': leader.t.color } as React.CSSProperties}>
        <div className="text-[10px] font-black uppercase tracking-[.18em] text-white/70">{past ? 'Won the night' : 'Leading the night'}</div>
        <div className="mt-2 flex items-center gap-3"><TeamBadge team={leader.t} size={44} /><div className="min-w-0 flex-1"><div className="break-words font-display text-lg font-extrabold leading-tight">{leader.t.name}</div><div className="text-xs text-white/70">{leader.t.gm_name}</div></div><div className="num font-display text-3xl font-extrabold">{fmtPts(leader.pts)}</div></div>
      </div>
    );
  }
  const ahead = i > 0 ? rows[i - 1] : null;
  const behind = rows[i + 1] ?? null;
  const n = Math.max(1, r.lines.length);
  const proj = pace(r);
  return (
    <div className="card-hero p-4" style={{ '--tc': me?.color } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[.18em] text-white/70">{past ? 'Your night' : 'Your night, live'}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num font-display text-5xl font-extrabold leading-none text-white drop-shadow-[0_4px_18px_rgba(0,0,0,.4)]">{fmtPts(r.pts)}</span>
            <span className="text-sm font-semibold text-white/80">pts</span>
          </div>
          <div className="mt-1.5 text-sm font-semibold text-white/90">
            {ordinal(i + 1)} of {rows.length} {past ? 'that night' : 'tonight'}
            {ahead ? <span className="font-normal text-white/70"> · {fmtPts(ahead.pts - r.pts)} behind {ahead.t.gm_name}</span>
              : behind ? <span className="font-normal text-white/70"> · {fmtPts(r.pts - behind.pts)} clear of {behind.t.gm_name}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {!past && r.left + r.playing > 0 && <>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">On pace for</div>
            <div className="num font-display text-2xl font-extrabold text-white">{fmtPts(proj)}</div>
          </>}
        </div>
      </div>
      {r.lines.length > 0 && (
        <>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-black/30 ring-1 ring-inset ring-white/10" aria-hidden>
            <span className="bg-white/70" style={{ width: `${(r.done / n) * 100}%` }} />
            <span className="animate-pulse bg-goal" style={{ width: `${(r.playing / n) * 100}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-white/80">
            {r.playing > 0 && <span className="text-rose-100">● {r.playing} on the ice</span>}
            <span>{r.done} done</span>
            <span>{r.left} still to play</span>
          </div>
        </>
      )}
      {r.lines.length === 0 && <div className="mt-2 text-sm text-white/75">Nobody in your starting lineup {past ? 'played that night' : 'plays tonight'}.</div>}
    </div>
  );
}

// ---------- the race, live ----------
// the season table as it stands if the night ended now: each team's total before tonight plus tonight's points, and how
// far it has moved since puck drop. The standings view counts today's points in its total, so "before" takes them out.
export function LiveRace({ rows, standings, me, onTeam }: { rows: NightRow[]; standings: Standing[]; me: Team | null; onTeam: (id: number) => void }) {
  const race = useMemo(() => {
    const tonight = new Map(rows.map((r) => [r.t.id, r.pts]));
    const list = rows.map((r) => {
      const s = standings.find((x) => x.team_id === r.t.id);
      const before = s ? Number(s.points) - Number(s.today ?? 0) : 0;
      return { t: r.t, before, now: before + (tonight.get(r.t.id) ?? 0), tonight: tonight.get(r.t.id) ?? 0 };
    });
    const startRank = new Map([...list].sort((a, b) => b.before - a.before || a.t.id - b.t.id).map((x, i) => [x.t.id, i + 1]));
    return [...list].sort((a, b) => b.now - a.now || a.t.id - b.t.id).map((x, i) => ({ ...x, rank: i + 1, moved: (startRank.get(x.t.id) ?? i + 1) - (i + 1) }));
  }, [rows, standings]);
  if (!race.length || race.every((x) => x.now === 0)) return null;
  const top = race[0].now || 1;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/[.06] px-3 py-2">
        <span className="text-[11px] font-black uppercase tracking-[.16em] text-mute">If it ended now</span>
        <span className="text-[10px] text-mute">season total · tonight · since puck drop</span>
      </div>
      <div className="divide-y divide-white/[.05]">
        {race.map((x, i) => (
          <button key={x.t.id} type="button" onClick={() => onTeam(x.t.id)} className={`relative flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[.03] ${x.t.id === me?.id ? 'bg-sky-400/[.07]' : ''}`}>
            {/* the bar behind the row: each team's total against the leader's */}
            <span className="pointer-events-none absolute inset-y-1 left-0 rounded-r-lg opacity-[.13]" style={{ width: `${Math.max(4, (x.now / top) * 100)}%`, background: x.t.color }} aria-hidden />
            <span className="num relative w-5 shrink-0 text-center text-sm font-extrabold text-slate-300">{x.rank}</span>
            <span className={`relative w-7 shrink-0 text-center text-[11px] font-black ${x.moved > 0 ? 'text-emerald-300' : x.moved < 0 ? 'text-red-300' : 'text-white/20'}`}>{x.moved > 0 ? `▲${x.moved}` : x.moved < 0 ? `▼${-x.moved}` : '–'}</span>
            <TeamBadge team={x.t} size={26} />
            <span className="relative min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{x.t.gm_name}{x.t.id === me?.id ? ' (you)' : ''}</span>
              {i > 0 && <span className="block text-[10px] text-mute">{fmtPts(race[i - 1].now - x.now)} back of {race[i - 1].t.gm_name}</span>}
            </span>
            <span className="relative shrink-0 text-right">
              <span className="num block text-sm font-extrabold">{fmtPts(x.now)}</span>
              <span className={`num block text-[10px] font-bold ${x.tonight > 0 ? 'text-emerald-300' : 'text-mute'}`}>{x.tonight > 0 ? '+' : ''}{fmtPts(x.tonight)} tonight</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- the night's stars ----------
export function NightStars({ rows, players, past }: { rows: NightRow[]; players: Map<number, Player>; past: boolean }) {
  const stars = useMemo(() => rows.flatMap((r) => r.lines.filter((l) => l.pg && l.pts > 0).map((l) => ({ l, t: r.t }))).sort((a, b) => b.l.pts - a.l.pts).slice(0, 3), [rows]);
  if (!stars.length) return null;
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="card p-3">
      <div className="mb-2 text-[11px] font-black uppercase tracking-[.16em] text-mute">⭐ Stars of the night{past ? '' : ' so far'}</div>
      <div className="grid grid-cols-3 gap-2">
        {stars.map(({ l, t }, i) => {
          const p = players.get(l.player_id);
          return (
            <div key={l.player_id} className="relative flex min-w-0 flex-col items-center rounded-2xl border border-white/[.07] bg-white/[.03] px-1.5 pb-2 pt-3 text-center">
              <span className="absolute left-1.5 top-1 text-base">{medal[i]}</span>
              <Headshot p={p} size={44} />
              <div className="mt-1.5 w-full text-xs font-bold leading-tight">{p ? <PlayerTag p={p} className="break-words" /> : `#${l.player_id}`}</div>
              <div className="num mt-0.5 font-display text-lg font-extrabold leading-none" style={{ color: readable(t.color) }}>{fmtPts(l.pts)}</div>
              <div className="mt-1 flex max-w-full items-center gap-1 text-[10px] text-mute"><TeamBadge team={t} size={14} /><span className="truncate">{t.gm_name}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- the ticker ----------
export function NightTicker({ events, players, team, me, live }: { events: NightEvent[]; players: Map<number, Player>; team: (id: number | null) => Team | undefined; me: Team | null; live: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 6);
  const since = (at: number) => { const m = Math.floor((Date.now() - at) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; };
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2">
        {live && <span className="h-2 w-2 animate-pulse rounded-full bg-goal shadow-[0_0_8px_rgba(239,42,79,.9)]" />}
        <span className="text-[11px] font-black uppercase tracking-[.16em] text-mute">Just happened</span>
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-mute">{live ? 'Every goal, assist and win by a rostered player lands here the moment the box score moves. Keep this page open.' : 'The ticker runs while games are on.'}</div>
      ) : (
        <div className="divide-y divide-white/[.05]">
          {shown.map((e) => {
            const p = players.get(e.player_id);
            const t = team(e.team_id);
            const mine = !!me && e.team_id === me.id;
            return (
              <div key={e.id} className={`flex items-center gap-2.5 px-3 py-2 ${mine && !e.bench ? 'bg-gradient-to-r from-goal/[.14] to-transparent' : ''} ${Date.now() - e.at < 20_000 ? 'animate-pop' : ''}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ${e.big ? 'bg-goal/20 ring-1 ring-goal/40' : 'bg-white/[.05] ring-1 ring-white/10'}`}>{e.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 text-sm leading-tight">
                    <span className={`font-extrabold ${e.big ? 'text-white' : 'text-slate-200'}`}>{e.what}</span>
                    {p ? <PlayerTag p={p} className="font-semibold" /> : <span>#{e.player_id}</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-mute">
                    {t && <TeamBadge team={t} size={14} />}<span className="truncate">{t?.gm_name}{e.bench ? ', on the bench' : ''} · {since(e.at)}</span>
                  </div>
                </div>
                <span className={`num shrink-0 rounded-lg px-2 py-0.5 text-sm font-extrabold ${e.bench ? 'bg-amber-500/10 text-amber-200' : e.delta >= 0 ? 'bg-emerald-400/15 text-emerald-200' : 'bg-red-400/15 text-red-200'}`}>{e.delta > 0 ? '+' : ''}{fmtPts(e.delta)}</span>
              </div>
            );
          })}
          {events.length > 6 && <button type="button" onClick={() => setAll(!all)} className="w-full py-2 text-center text-xs font-semibold text-sky-300">{all ? 'Show less' : `Show all ${events.length}`}</button>}
        </div>
      )}
    </div>
  );
}

// ---------- the night's goals ----------
// Every goal of the night that a rostered player scored or set up, from the NHL's own scores feed (nhl-hub, cached at
// the edge: one read for the whole slate), so the list is full the moment the page opens, not only what changed while
// it was open. Read again each minute while a game is on; a night in the books reads once.
type FeedGoal = { period: number; time: string; playerId: number; name: string; team: string; strength: string; away: number; home: number; assists: { playerId: number; name: string }[] };
type FeedGame = { id: number; start: string; state: string; home: { abbrev: string }; away: { abbrev: string }; goals?: FeedGoal[] };
export type NightGoal = { key: string; at: number; game: FeedGame; goal: FeedGoal; people: { id: number; name: string; role: 'g' | 'a'; team_id: number; bench: boolean; pts: number }[] };

export function useNightGoals(day: string, live: boolean, owner: (id: number) => { team_id: number; bench: boolean } | null, weights: Record<string, number> | undefined) {
  const [games, setGames] = useState<FeedGame[] | null>(null);
  useEffect(() => {
    let dead = false;
    const read = () => import('../lib/nhlhub').then(({ hub }) => hub<{ games?: FeedGame[] }>('scores', { date: day })).then((s) => { if (!dead) setGames(s?.games ?? []); }, () => { if (!dead) setGames((g) => g ?? []); });
    read();
    if (!live) return () => { dead = true; };
    const i = setInterval(() => { if (document.visibilityState === 'visible') read(); }, 60_000);
    return () => { dead = true; clearInterval(i); };
  }, [day, live]);
  return useMemo(() => {
    if (!games) return null;
    const w = weights ?? {};
    const out: NightGoal[] = [];
    for (const g of games) for (const [i, goal] of (g.goals ?? []).entries()) {
      // what the goal was worth to each rostered player in it: the goal or the assist, and the power-play or shorthanded point
      const extra = goal.strength === 'pp' ? (w.ppp ?? 0) : goal.strength === 'sh' ? (w.shp ?? 0) : 0;
      const people = [{ id: goal.playerId, name: goal.name, role: 'g' as const }, ...goal.assists.map((a) => ({ id: a.playerId, name: a.name, role: 'a' as const }))]
        .map((x) => { const o = owner(x.id); return o ? { ...x, team_id: o.team_id, bench: o.bench, pts: (x.role === 'g' ? (w.g ?? 0) : (w.a ?? 0)) + extra } : null; })
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (!people.length) continue;
      const [mm, ss] = goal.time.split(':').map(Number);
      // roughly when it went in: the puck drop, the periods before it with their intermissions, the clock into this one
      const at = Date.parse(g.start) + ((goal.period - 1) * 38 + (mm || 0) + (ss || 0) / 60) * 60_000;
      out.push({ key: `${g.id}:${i}`, at, game: g, goal, people });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [games, weights, owner]);
}

export function NightGoals({ goals, players, team, me, live, past }: { goals: NightGoal[]; players: Map<number, Player>; team: (id: number | null) => Team | undefined; me: Team | null; live: boolean; past: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? goals : goals.slice(0, 6);
  const per = (n: number) => (n <= 3 ? `P${n}` : n === 4 ? 'OT' : 'SO');
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2">
        {live && <span className="h-2 w-2 animate-pulse rounded-full bg-goal shadow-[0_0_8px_rgba(239,42,79,.9)]" />}
        <span className="text-[11px] font-black uppercase tracking-[.16em] text-mute">{past ? 'The night’s goals' : 'Goals tonight'}</span>
        <span className="ml-auto text-[10px] text-mute">{goals.length} with a rostered player</span>
      </div>
      {goals.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-mute">{live ? 'No goal by a rostered player yet. Each one lands here as it goes in.' : 'No goals by rostered players yet tonight.'}</div>
      ) : (
        <div className="divide-y divide-white/[.05]">
          {shown.map((x) => {
            const mine = !!me && x.people.some((p) => p.team_id === me.id && !p.bench);
            const scorer = x.people.find((p) => p.role === 'g');
            const helpers = x.people.filter((p) => p.role === 'a');
            const g = x.game;
            const tag = (p: (typeof x.people)[number]) => {
              const t = team(p.team_id);
              const pl = players.get(p.id);
              return (
                <span key={`${p.role}${p.id}`} className={`inline-flex items-center gap-1 ${p.bench ? 'opacity-70' : ''}`}>
                  {pl ? <PlayerTag p={pl} className="font-semibold" /> : <span className="font-semibold">{p.name}</span>}
                  {t && <TeamBadge team={t} size={14} />}
                  <span className={`num rounded px-1 text-[10px] font-extrabold ${p.bench ? 'bg-amber-500/10 text-amber-200' : 'bg-emerald-400/15 text-emerald-200'}`}>+{fmtPts(p.pts)}{p.bench ? ' 🪑' : ''}</span>
                </span>
              );
            };
            return (
              <div key={x.key} className={`flex items-start gap-2.5 px-3 py-2 ${mine ? 'bg-gradient-to-r from-goal/[.14] to-transparent' : ''}`}>
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ${scorer ? 'bg-goal/20 ring-1 ring-goal/40' : 'bg-white/[.05] ring-1 ring-white/10'}`}>{scorer ? '🚨' : '🍎'}</span>
                <div className="min-w-0 flex-1 text-sm leading-snug">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    {scorer ? tag(scorer) : <span className="text-slate-300">Goal by {x.goal.name}</span>}
                  </div>
                  {helpers.length > 0 && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-slate-300"><span className="text-mute">{scorer ? 'from' : 'set up by'}</span>{helpers.map(tag)}</div>}
                  <div className="mt-0.5 text-[11px] text-mute">
                    {g.away.abbrev} {x.goal.away}–{x.goal.home} {g.home.abbrev} · {per(x.goal.period)} {x.goal.time}{x.goal.strength === 'pp' ? ' · power play' : x.goal.strength === 'sh' ? ' · shorthanded' : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {goals.length > 6 && <button type="button" onClick={() => setAll(!all)} className="w-full py-2 text-center text-xs font-semibold text-sky-300">{all ? 'Show less' : `Show all ${goals.length}`}</button>}
        </div>
      )}
    </div>
  );
}
