// Rod Hockey's table on the phone: the whole screen, your end at the bottom. Your thumb runs whichever of your six
// players is nearest the puck: drag to slide him along his slot, flick toward the net to spin his stick through it,
// tap to snap a quick shot. Plays the computer (lib/rod/ai.ts) or another member live (lib/rod/net.ts); the table
// itself is lib/rod/physics.ts.
import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Team } from '../../lib/types';
import { TeamBadge } from '../ui';
import {
  BLADE_R, BODY_R, CORNER_R, GOAL_D, GOAL_W, GOAL_X0, GOAL_X1, H, MAX_PUCK, MID, PUCK_R, REACH, SLOTS, STICK, W, WIN_AT,
  autoPlay, figOf, inReach, lineUp, newTable, otherSide, pickActive, shoot, slotDist, speed, step,
  type Fig, type Side, type Table, type TableEvent,
} from '../../lib/rod/physics';
import { newBrain, think, type LevelInfo } from '../../lib/rod/ai';
import { muted, setMuted, sfx, wake } from '../../lib/rink/sound';
import { newMatchId } from '../../lib/rink/net';
import type { GoalKind, RodInput, RodMsg, RodPhase, RodState } from '../../lib/rod/net';

export type RodMode =
  | { kind: 'cpu'; level: LevelInfo }
  | { kind: 'online'; match: string; side: Side; vs: number | null };

export interface RodResult { won: boolean; sc: [number, number]; best: number; shots: [number, number]; own: number }

type Phase = RodPhase;
interface Banner { id: number; tone: 'for' | 'against' | 'info'; big: string; small?: string }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number }
interface Float { x: number; y: number; text: string; c: string; t: number }

const GOLD_FALLBACK = '#f7c548';
const RIVAL = '#ff3b5c';
const HANDS = 1750;            // how fast your thumb slides your player
const MY_GOALIE = 520;         // a person's goalie, run by the table: the same for both phones online
const MY_GLAG = 0.12;
const GAIN = 1.55;             // a thumb's move is a bigger move on the table
const FLICK = 1500;            // a release faster than this (table units a second) is a shot
const SEND_EVERY = 1 / 20;
const BOARD = 24;
const TIPS = 'rod-tips';
const kmh = (s: number) => Math.round((s / MAX_PUCK) * 150);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (n: number) => Math.round(n);

export function RodGame({ me, mode, league, teams, ice, onExit, onResult, onRecorded }: {
  me: Team; mode: RodMode; league: number; teams: Team[]; ice: string; onExit: () => void; onResult?: (r: RodResult) => void;
  onRecorded?: () => void;   // the game is kept: the standings can read it again
}) {
  const online = mode.kind === 'online';
  const mySide: Side = online ? mode.side : 0;
  const theirSide = otherSide(mySide);
  const host = !online || mySide === 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sc, setSc] = useState<[number, number]>([0, 0]);
  const [sog, setSog] = useState<[number, number]>([0, 0]);
  const [phase, setPhase] = useState<Phase>(online ? 'wait' : 'count');
  const [count, setCount] = useState(3);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [mute, setMute] = useState(muted());
  const [opp, setOpp] = useState<Team | null>(online && mode.vs != null ? teams.find((t) => t.id === mode.vs) ?? null : null);
  const [result, setResult] = useState<RodResult | null>(null);
  const [again, setAgain] = useState<{ me: boolean; them: boolean }>({ me: false, them: false });
  const [tips, setTips] = useState(() => { try { return localStorage.getItem(TIPS) !== '1'; } catch { return true; } });
  const ctl = useRef<{ pause: () => void; resume: () => void; rematch: () => void; quit: () => void } | null>(null);
  const resultCb = useRef(onResult);
  resultCb.current = onResult;
  const recorded = useRef(onRecorded);
  recorded.current = onRecorded;

  const cpuName = mode.kind === 'cpu' ? mode.level.who : null;
  const oppName = cpuName ?? opp?.name ?? 'Your opponent';
  const oppRef = useRef(oppName);
  oppRef.current = oppName;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(document.documentElement);
    const GOLD = (css.getPropertyValue('--color-gold').trim() || GOLD_FALLBACK);
    const flip = mySide === 1;
    const now = () => performance.now() / 1000;

    const t: Table = newTable();
    const brain = mode.kind === 'cpu' ? newBrain(mode.level, 1) : null;
    const S = {
      phase: (online ? 'wait' : 'count') as Phase,
      countFrom: now(), lastBeep: -1, goalUntil: 0, light: { end: 0 as Side, until: 0 },
      sc: [0, 0] as [number, number], shots: [0, 0] as [number, number], own: [0, 0] as [number, number],
      bestBy: [0, 0] as [number, number], best: 0, began: now(), gameNo: 1, over: false,
      active: null as number | null,
      touch: null as null | { id: number; x: number; y: number; t0: number; moved: number; samples: { x: number; y: number; t: number }[] },
      myT: 0, predT: null as number | null,
      // the phone that runs the table: the other phone's thumb, and the shots it has asked for
      remote: { a: 4, tt: 0, on: false, c: false } as RodInput, seen: new Set<number>(), seq: 0,
      // the other phone: the tables it has been sent, newest last
      snaps: [] as { at: number; s: RodState }[],
      lastRecv: now(), lastSend: 0, guest: null as number | null, againMe: false, againThem: false,
      ev: [] as number[], lastWall: 0,
      lastShot: [null, null] as ({ at: number; onNet: boolean; i: number; pw: number } | null)[],
      lastPass: [null, null] as ({ at: number; i: number } | null)[],
      lastPost: 0, dead: 0,
      trail: [] as { x: number; y: number }[], sparks: [] as Spark[], rings: [] as { x: number; y: number; t: number; c: string }[],
      floats: [] as Float[], shake: 0,
    };
    const setP = (p: Phase) => { S.phase = p; setPhase(p); };
    const flash = (b: Omit<Banner, 'id'>) => setBanner({ ...b, id: Math.random() });
    if (import.meta.env.DEV) (window as unknown as { __rod?: unknown }).__rod = { t, S, scale: () => scale, off: () => [offX, offY] };

    // ── layout: the table and its nets fill the space between the two bars
    let scale = 1, offX = 0, offY = 0, dpr = 1, cw = 0, ch = 0;
    let tableImg: HTMLCanvasElement | null = null;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cw = r.width; ch = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
      scale = Math.min((cw - 6) / (W + BOARD * 2), (ch - 6) / (H + (BOARD + GOAL_D) * 2));
      offX = (cw - W * scale) / 2; offY = (ch - H * scale) / 2;
      tableImg = drawTable(GOLD, ice, scale * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const myFig = (): Fig | null => (S.active == null ? null : figOf(t, mySide, S.active));

    // ── your thumb
    const toTable = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      let x = (e.clientX - r.left - offX) / scale, y = (e.clientY - r.top - offY) / scale;
      if (flip) { x = W - x; y = H - y; }
      return { x, y };
    };
    const onDown = (e: PointerEvent) => {
      wake();
      if (S.touch) return;
      const p = toTable(e), n = now();
      S.touch = { id: e.pointerId, x: p.x, y: p.y, t0: n, moved: 0, samples: [{ ...p, t: n }] };
      const f = myFig();
      S.myT = f ? f.t : 0;
      if (tips && S.phase === 'play') hideTips();
      try { wrap.setPointerCapture(e.pointerId); } catch { /* fine */ }
    };
    const onMove = (e: PointerEvent) => {
      const tc = S.touch;
      if (!tc || e.pointerId !== tc.id) return;
      const p = toTable(e), n = now();
      const dx = p.x - tc.x, dy = p.y - tc.y;
      const prev = tc.samples[tc.samples.length - 1];
      const sp = Math.hypot(dx, dy) / Math.max(0.004, n - prev.t);
      tc.x = p.x; tc.y = p.y; tc.moved += Math.hypot(dx, dy);
      tc.samples.push({ ...p, t: n });
      while (tc.samples.length > 2 && n - tc.samples[0].t > 0.14) tc.samples.shift();
      // a slow drag slides your player along his slot; a fast one is the start of a shot, and leaves him where he is
      const f = myFig();
      if (f && sp < FLICK * 0.85) S.myT = clamp(S.myT + (dx * f.ux + dy * f.uy) * GAIN, 0, f.len);
    };
    const onUp = (e: PointerEvent) => {
      const tc = S.touch;
      if (!tc || e.pointerId !== tc.id) return;
      S.touch = null;
      const n = now();
      const first = tc.samples.find((s) => n - s.t <= 0.1) ?? tc.samples[0];
      const last = tc.samples[tc.samples.length - 1];
      const dt = Math.max(0.016, last.t - first.t);
      const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt, sp = Math.hypot(vx, vy);
      if (S.phase !== 'play') return;
      if (sp > FLICK && n - last.t < 0.08) myShot(vx, vy, clamp(sp * 0.82, 1300, MAX_PUCK), false);
      else if (tc.moved < 16 && n - tc.t0 < 0.3) myShot(0, 0, 2300, true);
    };
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    const hideTips = () => { setTips(false); try { localStorage.setItem(TIPS, '1'); } catch { /* private window */ } };

    // where a shot goes: a flick near the net is helped onto it; a tap snaps it at the side the goalie isn't on
    const aim = (side: Side, f: Fig, dx: number, dy: number, tap: boolean): [number, number] => {
      const into = otherSide(side), lineY = into === 1 ? 0 : H, p = t.puck;
      if (tap) {
        const gk = figOf(t, into, 0);
        const x = (gk.x < W / 2 ? GOAL_X1 - 34 : GOAL_X0 + 34) + (Math.random() - 0.5) * 70;
        return [x - p.x, lineY - p.y];
      }
      // heading for the net end at all? find where it would cross the goal line, and pull a near miss inside the posts
      const toward = into === 1 ? dy < 0 : dy > 0;
      if (!toward) return [dx, dy];
      const k = (lineY - p.y) / dy, cx = p.x + dx * k;
      if (cx > GOAL_X0 - 150 && cx < GOAL_X1 + 150) {
        const in_ = clamp(cx, GOAL_X0 + 26, GOAL_X1 - 26);
        const ax = in_ - p.x, ay = lineY - p.y, al = Math.hypot(ax, ay), dl = Math.hypot(dx, dy);
        return [dx / dl * 0.35 + ax / al * 0.65, dy / dl * 0.35 + ay / al * 0.65];
      }
      void f;
      return [dx, dy];
    };
    const myShot = (dx: number, dy: number, power: number, tap: boolean) => {
      const f = myFig();
      if (!f) return;
      const [ax, ay] = aim(mySide, f, dx, dy, tap);
      sfx.swing(power);
      if (host) shoot(t, f, ax, ay, power, tap);
      else {
        // the other phone takes the shot; the swing shows here at once
        f.swing = 0.17;
        send('m', { type: 'shot', id: ++S.seq, a: f.i, dx: ax, dy: ay, p: power, tap });
      }
    };

    // ── the other phone
    let chan: RealtimeChannel | null = null;
    const send = (event: 'm' | 's' | 'i', payload: RodMsg | RodState | RodInput) => { chan?.send({ type: 'broadcast', event, payload }).catch(() => {}); };
    const sendState = () => {
      const f: number[] = [];
      for (const x of t.figs) f.push(r1(x.t), r1(x.th * 100));
      const p = t.puck;
      const a0 = S.active ?? 4, a1 = mode.kind === 'online' ? S.remote.a : 4;
      send('s', {
        f, p: [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy)], sc: S.sc, sh: S.shots, ph: S.phase, a: [a0, a1],
        hd: t.holder ? t.holder.side * 6 + t.holder.i : -1, ...(S.ev.length ? { ev: S.ev } : {}),
      });
      S.ev = [];
      S.lastSend = now();
    };
    const sendInput = () => {
      send('i', { a: S.active ?? 4, tt: r1(S.myT), on: !!S.touch, c: !!S.touch });
      S.lastSend = now();
    };

    const startCount = (short = false) => {
      S.countFrom = now() - (short ? 2.6 : 0); S.lastBeep = short ? 0 : -1;
      lineUp(t); t.puck = { x: W / 2, y: MID, vx: 0, vy: 0 }; t.last = null; t.touch = null; t.holder = null;
      setP('count');
    };
    const reset = () => {
      S.sc = [0, 0]; setSc([0, 0]); S.shots = [0, 0]; setSog([0, 0]); S.own = [0, 0]; S.bestBy = [0, 0]; S.best = 0;
      S.over = false; S.began = now(); S.gameNo++;
      S.againMe = false; S.againThem = false; setAgain({ me: false, them: false }); setResult(null);
      startCount();
    };

    const finish = (won: boolean) => {
      if (S.over) return;
      S.over = true;
      const r: RodResult = { won, sc: [S.sc[mySide], S.sc[theirSide]], best: S.best, shots: [S.shots[mySide], S.shots[theirSide]], own: S.own[mySide] };
      setResult(r); setP('over');
      record();
      resultCb.current?.(r);
      if (won) { sfx.win(); confetti({ particleCount: 150, spread: 85, origin: { y: 0.75 }, colors: [GOLD, '#ffffff', '#4cc3ff'] }); }
      else sfx.lose();
    };

    // the league keeps the game (rod_games, migration 354): the player against the computer records it, and in a duel
    // the challenger's phone does (side 0), so it's told once
    const record = () => {
      if (online && mySide !== 0) return;
      const away = online ? (S.guest ?? mode.vs) : null;
      if (online && away == null) return;
      supabase.rpc('rod_record', {
        p_match: online ? `${mode.match}-${S.gameNo}` : `${newMatchId()}${newMatchId()}`.slice(0, 16),
        p_away: away, p_level: mode.kind === 'cpu' ? mode.level.key : null,
        p_home_goals: S.sc[0], p_away_goals: S.sc[1], p_home_own: S.own[0], p_away_own: S.own[1],
        p_home_shots: S.shots[0], p_away_shots: S.shots[1], p_home_best: S.bestBy[0], p_away_best: S.bestBy[1],
        p_secs: Math.round(now() - S.began),
      }).then(({ error }) => { if (!error) recorded.current?.(); }, () => {});
    };

    // a goal, called here or told by the phone that runs the table
    const goal = (by: Side, k: number, own: boolean, kind: GoalKind, told?: [number, number]) => {
      if (S.phase === 'goal' || S.over) return;
      const into = otherSide(by);
      if (own) S.own[into]++;
      else S.bestBy[by] = Math.max(S.bestBy[by], k);
      if (told) S.sc = [Math.max(S.sc[0], told[0]), Math.max(S.sc[1], told[1])];
      else S.sc[by] += 1;
      setSc([...S.sc] as [number, number]);
      S.goalUntil = now() + 2.1; S.light = { end: into, until: now() + 2.1 };
      S.shake = 18;
      const name: Record<GoalKind, string> = { goal: 'Goal!', 'one-timer': 'One-timer!', 'bar-down': 'Bar down!', snipe: 'Top cheese!', wraparound: 'Wraparound!' };
      if (by === mySide) {
        if (!own) S.best = Math.max(S.best, k);
        sfx.horn(); sfx.crowd();
        flash(own
          ? { tone: 'for', big: 'Own goal!', small: `${oppRef.current} put it in their own net` }
          : { tone: 'for', big: name[kind], small: `${k} km/h` });
      } else {
        sfx.against();
        flash(own
          ? { tone: 'against', big: 'Own goal', small: 'Into your own net. Ouch.' }
          : { tone: 'against', big: kind === 'goal' ? 'Scored on' : name[kind].replace('!', ''), small: `${oppRef.current} · ${k} km/h` });
      }
      const gy = into === 1 ? -GOAL_D / 2 : H + GOAL_D / 2;
      for (let i = 0; i < 80; i++) {
        const a = (into === 1 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 2.4;
        const v = 300 + Math.random() * 1200;
        S.sparks.push({ x: GOAL_X0 + Math.random() * GOAL_W, y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.6 + Math.random() * 0.9, c: by === mySide ? GOLD : RIVAL, r: 4 + Math.random() * 7 });
      }
      t.puck.vx = 0; t.puck.vy = 0;
      setP('goal');
      if (online && host) send('m', { type: 'goal', by, kmh: k, own, sc: S.sc, kind });
    };

    const onMsg = (m: RodMsg) => {
      if (m.type === 'take') {
        if (mySide === 1) {
          if (m.guest === me.id) { S.lastRecv = now(); }
          else if (S.phase === 'wait') setP('taken');
        }
      } else if (m.type === 'goal') { if (!host) goal(m.by, m.kmh, m.own, m.kind, m.sc); }
      else if (m.type === 'shot') {
        if (!host || S.seen.has(m.id) || S.phase !== 'play') return;
        S.seen.add(m.id);
        const f = figOf(t, 1, m.a);
        // the trip across the network: the swing gets a little longer and a little more reach to find the puck
        shoot(t, f, m.dx, m.dy, m.p, m.tap, 0.18);
      } else if (m.type === 'again') { S.againThem = true; setAgain((a) => ({ ...a, them: true })); if (S.againMe && host) reset(); }
      else if (m.type === 'bye') { if (!S.over) setP('gone'); }
    };
    const onInput = (m: RodInput) => { S.lastRecv = now(); S.remote = m; };
    const onState = (m: RodState) => {
      const n = now();
      S.lastRecv = n;
      S.snaps.push({ at: n, s: m });
      while (S.snaps.length > 6) S.snaps.shift();
      if (m.sc[0] !== S.sc[0] || m.sc[1] !== S.sc[1]) { S.sc = [Math.max(S.sc[0], m.sc[0]), Math.max(S.sc[1], m.sc[1])]; setSc([...S.sc] as [number, number]); }
      if (m.sh[0] !== S.shots[0] || m.sh[1] !== S.shots[1]) { S.shots = [...m.sh] as [number, number]; setSog([...m.sh] as [number, number]); }
      if (m.ev) for (let i = 0; i + 2 < m.ev.length; i += 3) sound(m.ev[i], m.ev[i + 1] as Side, m.ev[i + 2]);
      // follow the phone that runs it
      if (m.ph !== S.phase && !S.over) {
        if (m.ph === 'count' && (S.phase === 'wait' || S.phase === 'over' || S.phase === 'goal')) {
          if (S.phase === 'over') { S.over = false; S.gameNo++; setResult(null); S.againMe = false; S.againThem = false; setAgain({ me: false, them: false }); S.own = [0, 0]; S.best = 0; S.bestBy = [0, 0]; }
          startCount(S.phase === 'goal');
        } else if (m.ph === 'play' || m.ph === 'goal') { if (S.phase !== 'goal' || m.ph !== 'goal') setP(m.ph); }
        else if (m.ph === 'over') finish(S.sc[mySide] > S.sc[theirSide]);
      } else if (S.over && m.ph === 'count') {
        S.over = false; S.gameNo++; setResult(null); S.againMe = false; S.againThem = false; setAgain({ me: false, them: false });
        S.own = [0, 0]; S.best = 0; S.bestBy = [0, 0];
        startCount();
      }
    };

    if (mode.kind === 'online') {
      const key = String(me.id);
      chan = supabase.channel(`rod:${league}:${mode.match}`, { config: { broadcast: { self: false }, presence: { key } } })
        .on('broadcast', { event: 's' }, ({ payload }) => onState(payload as RodState))
        .on('broadcast', { event: 'i' }, ({ payload }) => onInput(payload as RodInput))
        .on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload as RodMsg))
        .on('presence', { event: 'sync' }, () => {
          const here = Object.keys(chan!.presenceState()).map(Number);
          const them = here.filter((k) => k !== me.id);
          if (mySide === 0 && S.phase === 'wait') {
            const guest = mode.vs != null ? them.find((k) => k === mode.vs) : them[0];
            if (guest != null) {
              S.guest = guest;
              setOpp(teams.find((x) => x.id === guest) ?? null);
              send('m', { type: 'take', guest });
              setTimeout(() => send('m', { type: 'take', guest }), 700);
              S.lastRecv = now();
              startCount();
            }
          } else if (S.phase !== 'wait' && S.phase !== 'over' && S.phase !== 'taken') {
            const other = mySide === 0 ? S.guest : mode.vs;
            if (other != null && !here.includes(other) && now() - S.lastRecv > 3) setP('gone');
          }
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') chan?.track({ at: Date.now() }); });
    }

    // the sound of what happened (and, on the phone that runs the table, a note of it for the other phone)
    const sound = (kind: number, side: Side, power: number) => {
      if (kind === 0) sfx.hit(power, side === mySide);
      else if (kind === 2) sfx.post();
      else if (now() - S.lastWall > 0.05) { sfx.wall(power); S.lastWall = now(); }
    };
    const handle = (ev: TableEvent[]) => {
      const n = now();
      for (const e of ev) {
        if (e.kind === 'hit') {
          sound(0, e.side, e.power);
          if (online) S.ev.push(0, e.side, r1(e.power));
          const c = e.side === mySide ? GOLD : RIVAL;
          S.rings.push({ x: t.puck.x, y: t.puck.y, t: 0, c });
          const k = Math.min(22, 3 + e.power / 170);
          for (let i = 0; i < k; i++) {
            const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * (e.power * 0.45);
            S.sparks.push({ x: t.puck.x, y: t.puck.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.2 + Math.random() * 0.3, c, r: 2 + Math.random() * 3 });
          }
          if (e.power > 2300) S.shake = Math.max(S.shake, 6);
          // a save: the goalie gets a piece of a shot that was on net. Anyone else touching it first blocked it.
          const ls = S.lastShot[otherSide(e.side)];
          if (!e.shot && ls && e.i !== 0 && n - ls.at > 0.05) S.lastShot[otherSide(e.side)] = null;
          if (e.i === 0 && !e.shot && ls && ls.onNet && n - ls.at < 0.8) {
            S.lastShot[otherSide(e.side)] = null;
            S.shots[otherSide(e.side)]++; setSog([...S.shots] as [number, number]);
            sfx.save();
            S.floats.push({ x: t.puck.x, y: t.puck.y - 40, text: e.power > 1500 ? 'ROBBED!' : 'SAVE', c: e.side === mySide ? GOLD : '#ffffff', t: 0 });
          }
        } else if (e.kind === 'wall') {
          if (e.post) { S.lastPost = n; sound(2, 0, e.power); if (online) S.ev.push(2, 0, r1(e.power)); }
          else { sound(1, 0, e.power); if (online && n - S.lastWall < 0.01) S.ev.push(1, 0, r1(e.power)); }
        } else if (e.kind === 'shot') {
          // a shot on goal is one the goalie has to stop or that goes in: one blocked on the way doesn't count
          if (e.onNet) S.lastShot[e.side] = { at: n, onNet: true, i: e.i, pw: e.power };
          else S.lastPass[e.side] = { at: n, i: e.i };
        } else if (e.kind === 'goal') {
          const by = otherSide(e.into);
          let kind: GoalKind = 'goal';
          const shotBy = S.lastShot[by], pass = S.lastPass[by];
          // how hard it was hit: off the stick, not what's left of it at the line
          const k = kmh(Math.max(speed(t.puck), shotBy && n - shotBy.at < 1.5 ? shotBy.pw : 0));
          if (!e.own) {
            if (n - S.lastPost < 0.35) kind = 'bar-down';
            else if (shotBy && pass && pass.i !== shotBy.i && shotBy.at - pass.at < 0.9 && shotBy.at > pass.at) kind = 'one-timer';
            else if (k >= 112) kind = 'snipe';
          }
          // a goal is a shot on goal, whatever it went in off
          if (!e.own) { S.shots[by]++; setSog([...S.shots] as [number, number]); }
          S.lastShot = [null, null]; S.lastPass = [null, null];
          goal(by, k, e.own, kind);
        }
      }
    };

    // the other phone: draw the table it was sent, a moment behind so it moves smoothly
    const applySnaps = (n: number) => {
      const at = n - 0.07;
      const sn = S.snaps;
      if (!sn.length) return;
      let a = sn[0], b = sn[sn.length - 1];
      for (let i = 0; i < sn.length - 1; i++) if (sn[i].at <= at && sn[i + 1].at >= at) { a = sn[i]; b = sn[i + 1]; break; }
      const k = b.at === a.at ? 1 : clamp((at - a.at) / (b.at - a.at), 0, 1.4);
      for (let i = 0; i < t.figs.length; i++) {
        const f = t.figs[i];
        const ta = a.s.f[i * 2], tb = b.s.f[i * 2];
        const tha = a.s.f[i * 2 + 1] / 100, thb = b.s.f[i * 2 + 1] / 100;
        let pos = ta + (tb - ta) * Math.min(1, k);
        // your own player moves under your thumb at once, not when the table comes back
        if (f.side === mySide && f.i === S.active && S.predT != null) pos = S.predT;
        f.t = pos; f.x = f.ax + f.ux * pos; f.y = f.ay + f.uy * pos;
        if (f.swing > 0) f.swing -= 1 / 60;
        else { let d = thb - tha; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; f.th = tha + d * Math.min(1, k); }
      }
      const pa = a.s.p, pb = b.s.p;
      const kk = Math.min(1, k);
      let px = pa[0] + (pb[0] - pa[0]) * kk, py = pa[1] + (pb[1] - pa[1]) * kk;
      if (k > 1) { px += pb[2] * (k - 1) * (b.at - a.at); py += pb[3] * (k - 1) * (b.at - a.at); }
      t.puck = { x: px, y: py, vx: pb[2], vy: pb[3] };
      t.holder = b.s.hd >= 0 ? t.figs[b.s.hd] : null;
    };

    // ── the loop
    let raf = 0, last = now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const n = now();
      const dt = Math.min(0.05, n - last);
      last = n;

      if (host) {
        // your side: the player nearest the puck is yours to run; hold him while your thumb is down
        if (!S.touch) S.active = pickActive(t, mySide, S.active);
        else if (S.active != null && !(t.holder && t.holder.side === mySide && t.holder.i === S.active)) {
          // your thumb stays on him while he can still get to it; once it's clearly someone else's puck, it moves over
          const cur = slotDist(figOf(t, mySide, S.active), t.puck.x, t.puck.y);
          const nx = pickActive(t, mySide, null);
          if (nx !== S.active && cur > REACH + 30 && slotDist(figOf(t, mySide, nx), t.puck.x, t.puck.y) < cur - 150) {
            S.active = nx; S.myT = figOf(t, mySide, nx).t;
          }
        }
        autoPlay(t, mySide, S.touch ? S.active : null, MY_GOALIE, MY_GLAG);
        const f = myFig();
        if (f && S.touch) { f.speed = HANDS; f.tt = S.myT; f.carry = true; }
        // theirs: the computer, or the other phone's thumb
        if (brain) {
          if (S.phase === 'play') think(brain, t, n);
          else autoPlay(t, 1, null, mode.kind === 'cpu' ? mode.level.goalie : MY_GOALIE, 0.1);
        } else if (online) {
          const r = S.remote;
          autoPlay(t, theirSide, r.on ? r.a : null, MY_GOALIE, MY_GLAG);
          if (r.on) { const g2 = figOf(t, theirSide, clamp(r.a, 0, SLOTS.length - 1)); g2.speed = HANDS; g2.tt = r.tt; g2.carry = r.c; }
        }

        if (S.phase === 'count') {
          const left = 3 - Math.floor(n - S.countFrom);
          if (left !== S.lastBeep) { S.lastBeep = left; setCount(Math.max(0, left)); if (left > 0) sfx.beep(); else sfx.beep(true); }
          step(t, dt, { puck: false });
          if (n - S.countFrom >= 3.35) {
            // the drop: a little life in it, so neither centre gets it for free
            const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 120;
            t.puck.vx = Math.cos(a) * v; t.puck.vy = Math.sin(a) * v * 0.5;
            setP('play');
          }
        } else if (S.phase === 'play') {
          handle(step(t, dt));
          // a dead puck: nobody's playing it (sitting still, out of reach or pinned on the boards): drop it again
          const anyone = t.figs.some((x) => inReach(x, t.puck, 24));
          if (speed(t.puck) < 60 && !t.holder) {
            S.dead += dt;
            if (S.dead > (anyone ? 3 : 2.2)) { S.dead = 0; flash({ tone: 'info', big: 'Dead puck', small: 'Back to centre' }); startCount(true); }
          } else S.dead = 0;
          if (online && n - S.lastRecv > 7 && !S.over) setP('gone');
        } else if (S.phase === 'goal') {
          step(t, dt, { puck: false });
          if (n >= S.goalUntil) {
            const won = S.sc[mySide] >= WIN_AT, lost = S.sc[theirSide] >= WIN_AT;
            if (won || lost) finish(won);
            else startCount(true);
          }
        } else step(t, dt, { puck: false });
        if (online && n - S.lastSend >= SEND_EVERY) sendState();
      } else {
        // the other phone
        if (!S.touch) { S.active = pickActive(t, mySide, S.active); S.predT = null; }
        else {
          const f = myFig();
          if (f) {
            const cur = S.predT ?? f.t, d = S.myT - cur, stp = HANDS * dt;
            S.predT = cur + (Math.abs(d) <= stp ? d : Math.sign(d) * stp);
          }
        }
        applySnaps(n);
        if (S.phase === 'count') {
          const left = 3 - Math.floor(n - S.countFrom);
          if (left !== S.lastBeep && left >= 0) { S.lastBeep = left; setCount(Math.max(0, left)); if (left > 0) sfx.beep(); else sfx.beep(true); }
        }
        if (S.phase !== 'wait' && S.phase !== 'over' && n - S.lastRecv > 7 && !S.over) setP('gone');
        if (n - S.lastSend >= SEND_EVERY) sendInput();
      }

      // ── effects
      S.trail.unshift({ x: t.puck.x, y: t.puck.y });
      if (S.trail.length > 14) S.trail.pop();
      for (const s of S.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.92; s.vy *= 0.92; }
      S.sparks = S.sparks.filter((s) => s.life < s.max);
      for (const r of S.rings) r.t += dt;
      S.rings = S.rings.filter((r) => r.t < 0.3);
      for (const f of S.floats) f.t += dt;
      S.floats = S.floats.filter((f) => f.t < 0.9);
      S.shake *= Math.pow(0.002, dt);
      draw(n);
    };

    const draw = (n: number) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const sx = (Math.random() - 0.5) * S.shake, sy = (Math.random() - 0.5) * S.shake;
      // the picture carries a margin of TPAD device pixels round the frame, for the glow
      if (tableImg) g.drawImage(tableImg, (offX + sx - BOARD * scale) * dpr - TPAD, (offY + sy - (BOARD + GOAL_D) * scale) * dpr - TPAD);
      g.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * dpr, (offY + sy) * dpr);
      if (flip) { g.translate(W, H); g.rotate(Math.PI); }

      // the goal light
      if (n < S.light.until) {
        const a = 0.55 * Math.max(0, (S.light.until - n) / 2.1) * (0.6 + 0.4 * Math.sin(n * 30));
        const y = S.light.end === 1 ? 0 : H;
        const gr = g.createRadialGradient(W / 2, y, 10, W / 2, y, 650);
        gr.addColorStop(0, `rgba(255,40,70,${a})`); gr.addColorStop(1, 'rgba(255,40,70,0)');
        g.fillStyle = gr; g.fillRect(0, y === 0 ? 0 : H - 650, W, 650);
      }

      // the slot of the player you're running, lit
      const mf = myFig();
      if (mf && S.phase !== 'over') {
        const pulse = 0.35 + 0.25 * Math.sin(n * 6);
        g.save();
        g.lineCap = 'round'; g.strokeStyle = hexA(GOLD, S.touch ? 0.7 : pulse); g.lineWidth = 12;
        g.shadowColor = GOLD; g.shadowBlur = 18;
        g.beginPath(); g.moveTo(mf.ax, mf.ay); g.lineTo(mf.ax + mf.ux * mf.len, mf.ay + mf.uy * mf.len); g.stroke();
        g.restore();
      }

      // the puck's tail
      const sp = speed(t.puck);
      if (sp > 300) {
        for (let i = S.trail.length - 1; i >= 1; i--) {
          const p = S.trail[i], k = 1 - i / S.trail.length;
          g.beginPath(); g.arc(p.x, p.y, PUCK_R * (0.35 + 0.6 * k), 0, Math.PI * 2);
          g.fillStyle = sp > 2200 ? `rgba(255,${Math.round(150 + 80 * k)},90,${0.35 * k})` : `rgba(120,200,255,${0.25 * k * Math.min(1, sp / 1500)})`;
          g.fill();
        }
      }
      for (const r of S.rings) {
        const k = r.t / 0.3;
        g.beginPath(); g.arc(r.x, r.y, PUCK_R + k * 80, 0, Math.PI * 2);
        g.strokeStyle = hexA(r.c, 0.6 * (1 - k)); g.lineWidth = 5 * (1 - k) + 1; g.stroke();
      }

      // the players: theirs, then yours, the one you're running last so he's on top
      const order = [...t.figs].sort((a, b) => (a.side === mySide ? 1 : 0) - (b.side === mySide ? 1 : 0) || (a === mf ? 1 : 0) - (b === mf ? 1 : 0));
      for (const f of order) player(g, f, f.side === mySide ? GOLD : RIVAL, f === mf, t, flip, n);

      // the puck
      const p = t.puck;
      g.save();
      g.shadowColor = sp > 2200 ? '#ffb15a' : 'rgba(0,0,0,.55)'; g.shadowBlur = sp > 2200 ? 26 : 8;
      g.shadowOffsetY = 3;
      const pg = g.createRadialGradient(p.x - 6, p.y - 7, 2, p.x, p.y, PUCK_R);
      pg.addColorStop(0, '#454c5a'); pg.addColorStop(1, '#07090d');
      g.beginPath(); g.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2); g.fillStyle = pg; g.fill();
      g.restore();
      g.beginPath(); g.arc(p.x, p.y, PUCK_R - 3, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2.5; g.stroke();

      for (const s of S.sparks) {
        const k = 1 - s.life / s.max;
        g.beginPath(); g.arc(s.x, s.y, s.r * k + 0.5, 0, Math.PI * 2);
        g.fillStyle = hexA(s.c, k); g.fill();
      }
      // floating words: a save
      for (const f of S.floats) {
        const k = f.t / 0.9;
        g.save();
        g.translate(f.x, f.y - k * 70);
        if (flip) g.rotate(Math.PI);
        g.font = '900 54px "Barlow Condensed", Inter, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 8; g.strokeStyle = `rgba(5,8,15,${0.8 * (1 - k)})`; g.strokeText(f.text, 0, 0);
        g.fillStyle = hexA(f.c.startsWith('#') ? f.c : GOLD_FALLBACK, 1 - k); g.fillText(f.text, 0, 0);
        g.restore();
      }
    };

    raf = requestAnimationFrame(frame);

    ctl.current = {
      pause: () => { if (S.phase === 'play' && !online) setP('paused'); },
      resume: () => { if (S.phase === 'paused') { last = now(); S.countFrom = now() - 1; S.lastBeep = -1; setP('count'); } },
      rematch: () => {
        if (!online) { reset(); return; }
        S.againMe = true; setAgain((a) => ({ ...a, me: true }));
        send('m', { type: 'again', from: me.id });
        if (S.againThem && host) reset();
      },
      quit: () => { if (online) send('m', { type: 'bye', from: me.id }); },
    };
    const onHide = () => { if (document.visibilityState === 'hidden') ctl.current?.pause(); };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      wrap.removeEventListener('pointercancel', onUp);
      document.removeEventListener('visibilitychange', onHide);
      if (chan) { if (!S.over) send('m', { type: 'bye', from: me.id }); supabase.removeChannel(chan); }
    };
    // one game per mount: the page mounts a fresh table for a new opponent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), 1800);
    return () => clearTimeout(id);
  }, [banner]);

  const quit = () => { ctl.current?.quit(); onExit(); };
  const myScore = sc[mySide], theirScore = sc[theirSide];
  const sub = mode.kind === 'cpu' ? `${mode.level.emoji} ${mode.level.name}` : opp ? `GM ${opp.gm_name}` : 'Waiting…';

  return (
    <div className="fixed inset-0 z-[55] flex select-none flex-col bg-[radial-gradient(120%_80%_at_50%_0%,#13203d_0%,#05080f_62%)] text-white" style={{ touchAction: 'none' }}>
      <style>{ROD_CSS}</style>
      {/* them */}
      <div className="pt-safe shrink-0 px-3">
        <div className="flex h-14 items-center gap-2.5">
          {mode.kind === 'cpu'
            ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-rose-800 text-lg shadow-[0_0_18px_-4px_#ff3b5c]">{mode.level.emoji}</span>
            : <TeamBadge team={opp ?? undefined} size={36} />}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{oppName}</div>
            <div className="truncate text-[11px] text-white/55">{sub} · <span className="num">{sog[theirSide]}</span> {sog[theirSide] === 1 ? 'shot' : 'shots'}</div>
          </div>
          <div className="num w-10 text-right font-display text-4xl font-extrabold tabular-nums text-rose-300 drop-shadow-[0_0_12px_rgba(255,59,92,.6)]">{theirScore}</div>
        </div>
      </div>

      {/* the table */}
      <div ref={wrapRef} className="relative min-h-0 flex-1" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} className="absolute inset-0" />
        {phase === 'count' && count > 0 && <div key={count} className="rod-pop pointer-events-none absolute inset-0 grid place-items-center font-display text-[110px] font-extrabold text-white/90 drop-shadow-[0_0_30px_rgb(var(--gold-rgb)/.8)]">{count}</div>}
        {phase === 'count' && count === 0 && <div className="rod-pop pointer-events-none absolute inset-0 grid place-items-center font-display text-6xl font-extrabold uppercase text-gold drop-shadow-[0_0_30px_rgb(var(--gold-rgb)/.8)]">Drop it!</div>}
        {tips && (phase === 'count' || phase === 'play') && (
          <div className="pointer-events-none absolute inset-x-3 top-2 flex justify-center">
            <div className="rod-pop max-w-sm rounded-2xl border border-gold/30 bg-[#05080f]/85 px-3 py-2 text-[12px] leading-snug text-white/90 shadow-xl backdrop-blur">
              <div className="mb-0.5 text-[10px] font-black uppercase tracking-[.16em] text-gold">How to play</div>
              <div>👆 <b>Drag</b> to slide your glowing player along his slot. Hold and he cradles the puck.</div>
              <div>💨 <b>Flick</b> toward the net to shoot. <b>Tap</b> for a quick snap shot.</div>
            </div>
          </div>
        )}
        {banner && (
          <div key={banner.id} className="rod-pop pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center">
            <div className={`font-display text-[clamp(2.4rem,13vw,3.6rem)] font-extrabold uppercase leading-none tracking-wide ${banner.tone === 'for' ? 'text-gold drop-shadow-[0_0_28px_rgb(var(--gold-rgb)/.9)]' : banner.tone === 'info' ? 'text-white/90 drop-shadow-[0_0_18px_rgba(120,200,255,.7)]' : 'text-rose-300 drop-shadow-[0_0_24px_rgba(255,59,92,.8)]'}`}>{banner.big}</div>
            {banner.small && <div className="mt-2 inline-block rounded-full bg-[#05080f]/75 px-3 py-1 text-sm font-semibold text-white">{banner.small}</div>}
          </div>
        )}
        {phase === 'wait' && (
          <Overlay>
            <div className="rod-pulse mx-auto mb-3 h-14 w-14 rounded-full border-4 border-gold/70" />
            <div className="font-display text-2xl font-extrabold uppercase">Waiting for {opp ? opp.name : 'a taker'}</div>
            <p className="mt-1 text-sm text-white/70">{opp ? 'They have the challenge. Loosen up the wrists.' : 'Your challenge is in the chat. The first to tap it plays you.'}</p>
            <button className="btn-ghost mt-4" onClick={quit}>Call it off</button>
          </Overlay>
        )}
        {phase === 'paused' && (
          <Overlay>
            <div className="font-display text-3xl font-extrabold uppercase">Timeout</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-gold" onClick={() => ctl.current?.resume()}><Play size={16} /> Back to the table</button>
              <button className="btn-ghost" onClick={quit}>Leave</button>
            </div>
          </Overlay>
        )}
        {phase === 'gone' && (
          <Overlay>
            <div className="text-4xl">📡</div>
            <div className="mt-1 font-display text-2xl font-extrabold uppercase">{oppName} left the table</div>
            <p className="mt-1 text-sm text-white/70">The game stops here. {myScore}–{theirScore} when they went.</p>
            <button className="btn-gold mt-4" onClick={onExit}>Back to the lobby</button>
          </Overlay>
        )}
        {phase === 'taken' && (
          <Overlay>
            <div className="text-4xl">🏒</div>
            <div className="mt-1 font-display text-2xl font-extrabold uppercase">Someone beat you to it</div>
            <p className="mt-1 text-sm text-white/70">Another member took this challenge first. Throw down one of your own.</p>
            <button className="btn-gold mt-4" onClick={onExit}>Back to the lobby</button>
          </Overlay>
        )}
        {phase === 'over' && result && (
          <Overlay>
            <div className="text-5xl">{result.won ? '🏆' : '🥅'}</div>
            <div className={`mt-1 font-display text-4xl font-extrabold uppercase ${result.won ? 'text-gold' : 'text-white'}`}>{result.won ? 'You win' : `${oppName} wins`}</div>
            <div className="num mt-1 font-display text-5xl font-extrabold tabular-nums">{result.sc[0]}<span className="mx-2 text-white/40">–</span>{result.sc[1]}</div>
            <div className="mx-auto mt-3 grid max-w-xs grid-cols-3 gap-2 text-left">
              <Stat label="Shots" value={`${result.shots[0]}–${result.shots[1]}`} />
              <Stat label="Shooting" value={result.shots[0] ? `${Math.round((100 * result.sc[0]) / Math.max(result.shots[0], result.sc[0]))}%` : '—'} />
              <Stat label="Hardest" value={result.best ? `${result.best}` : '—'} sub="km/h" />
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button className="btn-gold" disabled={online && again.me} onClick={() => ctl.current?.rematch()}>
                {online ? (again.me ? (again.them ? 'Starting…' : 'Waiting on them…') : again.them ? 'They want a rematch: go' : 'Rematch') : 'Run it back'}
              </button>
              <button className="btn-ghost" onClick={quit}>Lobby</button>
            </div>
          </Overlay>
        )}
      </div>

      {/* you */}
      <div className="pb-safe shrink-0 px-3">
        <div className="flex h-14 items-center gap-2.5">
          <TeamBadge team={me} size={36} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{me.name}</div>
            <div className="truncate text-[11px] text-white/55">You · <span className="num">{sog[mySide]}</span> {sog[mySide] === 1 ? 'shot' : 'shots'} · first to {WIN_AT}</div>
          </div>
          <div className="num w-10 font-display text-4xl font-extrabold tabular-nums text-gold drop-shadow-[0_0_12px_rgb(var(--gold-rgb)/.6)]">{myScore}</div>
          <button className="grid h-10 w-10 place-items-center rounded-full bg-white/[.07] ring-1 ring-white/10" aria-label={mute ? 'Sound on' : 'Sound off'} onClick={() => { setMuted(!mute); setMute(!mute); }}>
            {mute ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {!online && phase === 'play'
            ? <button className="grid h-10 w-10 place-items-center rounded-full bg-white/[.07] ring-1 ring-white/10" aria-label="Pause" onClick={() => ctl.current?.pause()}><Pause size={18} /></button>
            : <button className="grid h-10 w-10 place-items-center rounded-full bg-white/[.07] ring-1 ring-white/10" aria-label="Leave the game" onClick={quit}><X size={18} /></button>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white/[.06] px-2.5 py-2 ring-1 ring-white/10">
      <div className="text-[9px] font-black uppercase tracking-[.14em] text-white/50">{label}</div>
      <div className="num text-base font-bold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-white/45">{sub}</div>}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/55 px-6 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rod-pop w-full max-w-sm rounded-[28px] border border-white/10 bg-gradient-to-b from-[#16213b]/95 to-[#0a1222]/95 p-5 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]">{children}</div>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function shade(hex: string, k: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const c = [0, 2, 4].map((i) => clamp(Math.round(parseInt(h.slice(i, i + 2), 16) * k), 0, 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// a player seen from above: the stick (shaft and taped blade), the shoulders in his colours, the helmet, his number
function player(g: CanvasRenderingContext2D, f: Fig, c: string, active: boolean, t: Table, flip: boolean, n: number) {
  const { x, y, th } = f;
  const goalie = f.role === 'G';
  // he squares up to the puck
  const face = Math.atan2(t.puck.y - y, t.puck.x - x);
  // the ring under the one you're running
  if (active) {
    g.save();
    const r = BODY_R + 16 + Math.sin(n * 7) * 3;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = hexA(c.startsWith('#') ? c : GOLD_FALLBACK, 0.16); g.fill();
    g.lineWidth = 4; g.strokeStyle = hexA(c.startsWith('#') ? c : GOLD_FALLBACK, 0.9); g.shadowColor = c; g.shadowBlur = 16; g.stroke();
    g.restore();
  }
  // shadow
  g.beginPath(); g.ellipse(x + 5, y + 7, BODY_R * 1.05, BODY_R * 0.9, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(10,20,40,.22)'; g.fill();
  // the stick
  const hx = x + Math.cos(th) * (BODY_R * 0.55), hy = y + Math.sin(th) * (BODY_R * 0.55);
  const bx = x + Math.cos(th) * (STICK - 22), by = y + Math.sin(th) * (STICK - 22);
  const tx = x + Math.cos(th) * STICK, ty = y + Math.sin(th) * STICK;
  g.lineCap = 'round';
  g.strokeStyle = '#1b1f27'; g.lineWidth = 11;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(bx, by); g.stroke();
  g.strokeStyle = goalie ? '#d9a35a' : '#c98f4a'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(bx, by); g.stroke();
  // the blade, taped white, a touch wider
  g.strokeStyle = '#0d1018'; g.lineWidth = BLADE_R * 2 + 3;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
  g.strokeStyle = '#f4f6fb'; g.lineWidth = BLADE_R * 2 - 3;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
  g.strokeStyle = 'rgba(20,24,34,.55)'; g.lineWidth = 3;
  const mx = (bx + tx) / 2, my = (by + ty) / 2, px = -Math.sin(th) * (BLADE_R - 2), py = Math.cos(th) * (BLADE_R - 2);
  g.beginPath(); g.moveTo(mx + px, my + py); g.lineTo(mx - px, my - py); g.stroke();
  // shoulders: square to the puck
  g.save();
  g.translate(x, y); g.rotate(face + Math.PI / 2);
  const sw = goalie ? BODY_R * 1.25 : BODY_R, sh = goalie ? BODY_R * 0.78 : BODY_R * 0.66;
  const body = g.createLinearGradient(-sw, -sh, sw, sh);
  body.addColorStop(0, shade(c.startsWith('#') ? c : GOLD_FALLBACK, 1.15)); body.addColorStop(0.55, c); body.addColorStop(1, shade(c.startsWith('#') ? c : GOLD_FALLBACK, 0.6));
  g.beginPath(); g.ellipse(0, 0, sw, sh, 0, 0, Math.PI * 2); g.fillStyle = body; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(5,8,15,.55)'; g.stroke();
  // a stripe across the shoulders, and the goalie's pads
  g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(-sw * 0.92, -2.5, sw * 1.84, 5);
  if (goalie) {
    g.fillStyle = '#f2f4f8'; g.strokeStyle = 'rgba(5,8,15,.6)'; g.lineWidth = 2;
    for (const sx of [-1, 1]) { g.beginPath(); g.roundRect(sx * sw * 0.72 - 9, -sh - 6, 18, sh * 2 + 12, 7); g.fill(); g.stroke(); }
  }
  g.restore();
  // the helmet
  const hg = g.createRadialGradient(x - 5, y - 6, 2, x, y, 17);
  hg.addColorStop(0, '#5a6274'); hg.addColorStop(1, '#0a0d14');
  g.beginPath(); g.arc(x, y, goalie ? 18 : 16, 0, Math.PI * 2); g.fillStyle = goalie ? '#e9edf5' : hg; g.fill();
  if (goalie) { g.strokeStyle = '#1b1f27'; g.lineWidth = 2; for (const d of [-6, 0, 6]) { g.beginPath(); g.moveTo(x - 10, y + d); g.lineTo(x + 10, y + d); g.stroke(); } }
  // his number, readable from your side
  g.save();
  g.translate(x, y);
  if (flip) g.rotate(Math.PI);
  g.font = '800 17px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = goalie ? '#0a0d14' : 'rgba(255,255,255,.92)';
  if (!goalie) g.fillText(String(f.num), 0, 1);
  g.restore();
}

// the table, drawn once per size: the frame, the ice and its lines, the slots each player rides in, the nets
const TPAD = 30;
function drawTable(gold: string, ice: string, k: number): HTMLCanvasElement {
  const B = BOARD, D = GOAL_D;
  const c = document.createElement('canvas');
  c.width = Math.ceil((W + B * 2) * k + TPAD * 2);
  c.height = Math.ceil((H + (B + D) * 2) * k + TPAD * 2);
  const g = c.getContext('2d')!;
  g.translate(TPAD, TPAD);
  g.scale(k, k);
  g.translate(B, B + D);
  const goldHex = gold.startsWith('#') ? gold : GOLD_FALLBACK;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // the nets, behind the goal lines: a dark box with mesh and a red frame
  for (const end of [0, 1]) {
    const y0 = end === 1 ? -D - 4 : H - 2;
    g.save();
    round(GOAL_X0 - 14, y0, GOAL_W + 28, D + 6, 18);
    g.fillStyle = '#0b0f18'; g.fill();
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1.5;
    for (let x = GOAL_X0 - 14; x < GOAL_X1 + 14; x += 14) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 10, y0 + D + 6); g.stroke(); g.beginPath(); g.moveTo(x + 10, y0); g.lineTo(x, y0 + D + 6); g.stroke(); }
    g.restore();
    g.save();
    g.shadowColor = '#ff3b5c'; g.shadowBlur = 16;
    g.strokeStyle = '#ff4d68'; g.lineWidth = 7; g.lineJoin = 'round';
    g.beginPath();
    if (end === 1) { g.moveTo(GOAL_X0, 0); g.lineTo(GOAL_X0, -D + 10); g.quadraticCurveTo(GOAL_X0, -D, GOAL_X0 + 10, -D); g.lineTo(GOAL_X1 - 10, -D); g.quadraticCurveTo(GOAL_X1, -D, GOAL_X1, -D + 10); g.lineTo(GOAL_X1, 0); }
    else { g.moveTo(GOAL_X0, H); g.lineTo(GOAL_X0, H + D - 10); g.quadraticCurveTo(GOAL_X0, H + D, GOAL_X0 + 10, H + D); g.lineTo(GOAL_X1 - 10, H + D); g.quadraticCurveTo(GOAL_X1, H + D, GOAL_X1, H + D - 10); g.lineTo(GOAL_X1, H); }
    g.stroke();
    g.restore();
  }
  // the frame: lit rim in the league's colour, open at the mouths
  g.save();
  round(-B, -B, W + B * 2, H + B * 2, CORNER_R + B);
  g.shadowColor = gold; g.shadowBlur = 34;
  const rim = g.createLinearGradient(0, -B, 0, H + B);
  rim.addColorStop(0, '#1d2a45'); rim.addColorStop(0.5, '#2a3b60'); rim.addColorStop(1, '#1d2a45');
  g.fillStyle = rim; g.fill();
  g.restore();
  round(-B + 4, -B + 4, W + B * 2 - 8, H + B * 2 - 8, CORNER_R + B - 4);
  g.strokeStyle = hexA(goldHex, 0.75); g.lineWidth = 3; g.stroke();
  // the ice: painted metal, a sheen across it
  round(0, 0, W, H, CORNER_R);
  const ic = g.createLinearGradient(0, 0, W, H);
  ic.addColorStop(0, '#f1f7ff'); ic.addColorStop(0.45, '#dcebfb'); ic.addColorStop(1, '#eaf3ff');
  g.fillStyle = ic; g.fill();
  g.save();
  g.clip();
  const sheen = g.createLinearGradient(0, 0, W, H * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,.35)'); sheen.addColorStop(0.56, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  // centre ice: the league's name
  g.save();
  g.translate(W / 2, MID);
  g.font = '900 120px "Barlow Condensed", Inter, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,40,80,.07)';
  g.fillText(ice.toUpperCase().slice(0, 14), 0, 0);
  g.restore();
  // the lines
  g.fillStyle = 'rgba(30,110,230,.55)';
  g.fillRect(0, MID - 300 - 9, W, 18); g.fillRect(0, MID + 300 - 9, W, 18);
  g.fillStyle = 'rgba(225,30,60,.7)'; g.fillRect(0, MID - 7, W, 14);
  g.strokeStyle = 'rgba(30,110,230,.6)'; g.lineWidth = 6;
  g.beginPath(); g.arc(W / 2, MID, 150, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(30,110,230,.85)'; g.beginPath(); g.arc(W / 2, MID, 16, 0, Math.PI * 2); g.fill();
  for (const y of [MID - 520, MID + 520]) for (const x of [260, W - 260]) {
    g.strokeStyle = 'rgba(225,30,60,.32)'; g.lineWidth = 5;
    g.beginPath(); g.arc(x, y, 110, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(225,30,60,.5)'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
  }
  // the creases
  for (const end of [0, 1]) {
    const y = end === 1 ? 0 : H;
    g.beginPath(); g.arc(W / 2, y, GOAL_W / 2 + 34, end === 1 ? 0 : Math.PI, end === 1 ? Math.PI : Math.PI * 2);
    g.fillStyle = 'rgba(70,160,255,.25)'; g.fill();
    g.strokeStyle = 'rgba(225,30,60,.6)'; g.lineWidth = 5; g.stroke();
  }
  // the slots: a groove cut in the ice for every player to ride in
  for (const side of [0, 1]) for (const s of SLOTS) {
    let ax = s.ax, ay = s.ay, bx = s.bx, by = s.by;
    if (side === 1) { ax = W - ax; ay = H - ay; bx = W - bx; by = H - by; }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 20;
    g.beginPath(); g.moveTo(ax + 1, ay + 2); g.lineTo(bx + 1, by + 2); g.stroke();
    g.strokeStyle = 'rgba(28,44,74,.55)'; g.lineWidth = 15;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.strokeStyle = 'rgba(8,14,28,.75)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  g.restore();
  // a hint of the reach each player has, nothing more: the table reads clean
  void REACH;
  return c;
}

const ROD_CSS = `
@keyframes rod-pop { 0% { transform: scale(.6); opacity: 0 } 45% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
.rod-pop { animation: rod-pop .38s cubic-bezier(.2,.9,.3,1.3) both }
@keyframes rod-pulse { 0%,100% { transform: scale(.85); opacity: .5 } 50% { transform: scale(1.1); opacity: 1 } }
.rod-pulse { animation: rod-pulse 1.2s ease-in-out infinite }
`;
