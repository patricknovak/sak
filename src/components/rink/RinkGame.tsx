// Rink Duel's table on the phone: the whole screen, your end at the bottom, your thumb on the paddle. Plays the
// computer (lib/rink/ai.ts) or another member live (lib/rink/net.ts); the table itself is lib/rink/physics.ts.
import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Team } from '../../lib/types';
import { TeamBadge } from '../ui';
import {
  CORNER_R, GOAL_W, GOAL_X0, GOAL_X1, H, HEAT_AT, MAX_PUCK, MID, PAD_R, PUCK_R, W, WIN_AT,
  faceoff, hot, newTable, otherSide, speed, step, type Side, type Table, type TableEvent,
} from '../../lib/rink/physics';
import { newBrain, think, type LevelInfo } from '../../lib/rink/ai';
import { muted, setMuted, sfx, wake } from '../../lib/rink/sound';
import type { MatchMsg, StateMsg } from '../../lib/rink/net';

export type RinkMode =
  | { kind: 'cpu'; level: LevelInfo }
  | { kind: 'online'; match: string; side: Side; vs: number | null };

export interface RinkResult { won: boolean; sc: [number, number]; best: number; rally: number }

type Phase = 'wait' | 'count' | 'play' | 'goal' | 'paused' | 'over' | 'gone' | 'taken';
interface Banner { id: number; tone: 'for' | 'against' | 'fire'; big: string; small?: string }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number }

const GOLD_FALLBACK = '#f7c548';
const RIVAL = '#ff3b5c';
const SEND_EVERY = 1 / 15;
const kmh = (s: number) => Math.round((s / MAX_PUCK) * 165);

export function RinkGame({ me, mode, league, teams, ice, onExit, onResult }: {
  me: Team; mode: RinkMode; league: number; teams: Team[]; ice: string; onExit: () => void; onResult?: (r: RinkResult) => void;
}) {
  const online = mode.kind === 'online';
  const mySide: Side = online ? mode.side : 0;
  const theirSide = otherSide(mySide);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sc, setSc] = useState<[number, number]>([0, 0]);
  const [phase, setPhase] = useState<Phase>(online ? 'wait' : 'count');
  const [count, setCount] = useState(3);
  const [heat, setHeat] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [mute, setMute] = useState(muted());
  const [opp, setOpp] = useState<Team | null>(online && mode.vs != null ? teams.find((t) => t.id === mode.vs) ?? null : null);
  const [result, setResult] = useState<RinkResult | null>(null);
  const [again, setAgain] = useState<{ me: boolean; them: boolean }>({ me: false, them: false });
  const ctl = useRef<{ pause: () => void; resume: () => void; rematch: () => void; quit: () => void } | null>(null);
  const resultCb = useRef(onResult);
  resultCb.current = onResult;

  const cpuName = mode.kind === 'cpu' ? mode.level.who : null;
  const oppName = cpuName ?? opp?.name ?? 'Your opponent';
  const oppRef = useRef(oppName);
  oppRef.current = oppName;

  // the page under the table doesn't scroll or bounce while you play
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
    const GOLD = css.getPropertyValue('--color-gold').trim() || GOLD_FALLBACK;
    const flip = mySide === 1;

    const t: Table = newTable();
    faceoff(t, online ? 1 : 0);
    // the browser checks drive a stand-in thumb from the table's own numbers, in development builds only
    if (import.meta.env.DEV) (window as unknown as { __rink?: unknown }).__rink = { t, scale: () => scale, off: () => [offX, offY] };
    const brain = mode.kind === 'cpu' ? newBrain(mode.level) : null;
    const S = {
      phase: (online ? 'wait' : 'count') as Phase,
      countFrom: performance.now() / 1000, lastBeep: -1,
      goalUntil: 0, goalEnd: 0 as Side, light: { end: 0 as Side, until: 0 },
      sc: [0, 0] as [number, number],
      owner: !online || mySide === 1,          // the first face-off goes to the challenged side
      mineSince: 0,
      remote: { x: t.pads[theirSide].x, y: t.pads[theirSide].y, vx: 0, vy: 0, at: 0 },
      lastRecv: performance.now() / 1000, lastSend: 0, lastWall: 0,
      guest: null as number | null, againMe: false, againThem: false,
      best: 0, rally: 0, heatShown: 0,
      trail: [] as { x: number; y: number }[], sparks: [] as Spark[], rings: [] as { x: number; y: number; t: number; c: string }[],
      shake: 0, target: null as { x: number; y: number } | null, over: false,
    };
    const now = () => performance.now() / 1000;
    const setP = (p: Phase) => { S.phase = p; setPhase(p); };
    const flash = (b: Omit<Banner, 'id'>) => setBanner({ ...b, id: Math.random() });

    // ── layout: the table fills the space between the two bars, boards and all
    let scale = 1, offX = 0, offY = 0, dpr = 1, cw = 0, ch = 0;
    let rinkImg: HTMLCanvasElement | null = null;
    const BOARD = 22;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cw = r.width; ch = r.height; dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
      scale = Math.min((cw - 8) / (W + BOARD * 2), (ch - 8) / (H + BOARD * 2));
      offX = (cw - W * scale) / 2; offY = (ch - H * scale) / 2;
      rinkImg = drawRink(GOLD, ice, scale * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── your thumb: the paddle sits just above it, so you can see what you're hitting
    const toTable = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      let x = (e.clientX - r.left - offX) / scale, y = (e.clientY - r.top - offY) / scale;
      const lift = e.pointerType === 'mouse' ? 0 : PAD_R * 1.25;
      y -= lift;
      if (flip) { x = W - x; y = H - y; }
      return { x, y };
    };
    const onDown = (e: PointerEvent) => { wake(); S.target = toTable(e); try { wrap.setPointerCapture(e.pointerId); } catch { /* fine */ } };
    const onMove = (e: PointerEvent) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) S.target = toTable(e); };
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);

    // ── the other phone
    let chan: RealtimeChannel | null = null;
    const send = (event: 'm' | 's', payload: MatchMsg | StateMsg) => { chan?.send({ type: 'broadcast', event, payload }).catch(() => {}); };
    const sendState = (handTo?: Side) => {
      const p = t.pads[mySide], b = t.puck;
      const holds = S.owner || handTo != null;
      send('s', {
        s: mySide, p: [p.x, p.y, p.vx, p.vy],
        ...(holds ? { b: [b.x, b.y, b.vx, b.vy] as [number, number, number, number] } : {}),
        o: handTo ?? (S.owner ? mySide : -1), sc: S.sc, h: t.heat,
      } as StateMsg);
      S.lastSend = now();
    };
    const startCount = () => { S.countFrom = now(); S.lastBeep = -1; setP('count'); };
    const reset = () => {
      S.sc = [0, 0]; setSc([0, 0]); S.over = false; S.best = 0; S.rally = 0;
      S.againMe = false; S.againThem = false; setAgain({ me: false, them: false }); setResult(null);
      faceoff(t, online ? 1 : 0); S.owner = !online || mySide === 1; setHeat(0); S.heatShown = 0;
      startCount();
    };

    const adopt = (b: [number, number, number, number]) => {
      // where it is now, give or take the trip across: carry it on a few hundredths of a second
      t.puck = { x: b[0] + b[2] * 0.04, y: b[1] + b[3] * 0.04, vx: b[2], vy: b[3] };
    };
    const onState = (m: StateMsg) => {
      const n = now();
      S.lastRecv = n;
      S.remote = { x: m.p[0], y: m.p[1], vx: m.p[2], vy: m.p[3], at: n };
      const merged: [number, number] = [Math.max(S.sc[0], m.sc[0]), Math.max(S.sc[1], m.sc[1])];
      if (merged[0] !== S.sc[0] || merged[1] !== S.sc[1]) { S.sc = merged; setSc(merged); }
      if (S.phase !== 'play') return;
      if (m.o === m.s && m.b) {
        // they hold it. If we both think we do, it's whoever's half it's in (the challenger's on the line)
        const inMine = mySide === 0 ? t.puck.y > MID : t.puck.y < MID;
        if (S.owner && inMine) return;
        S.owner = false; adopt(m.b); t.heat = m.h;
      } else if (m.o === mySide && m.b && !S.owner) {
        S.owner = true; adopt(m.b); t.heat = m.h; S.mineSince = 0;
      }
    };

    const finish = (won: boolean) => {
      S.over = true;
      const r: RinkResult = { won, sc: [S.sc[mySide], S.sc[theirSide]], best: S.best, rally: S.rally };
      setResult(r); setP('over');
      resultCb.current?.(r);
      if (won) {
        sfx.win();
        confetti({ particleCount: 140, spread: 80, origin: { y: 0.75 }, colors: [GOLD, '#ffffff', '#4cc3ff'] });
      } else sfx.lose();
    };

    // a goal, called here or told by the other phone
    const goal = (by: Side, pts: number, k: number, told?: [number, number]) => {
      if (S.phase === 'goal' || S.over) return;
      const into = otherSide(by);
      if (told) S.sc = [Math.max(S.sc[0], told[0]), Math.max(S.sc[1], told[1])];
      else S.sc[by] += pts;
      setSc([...S.sc] as [number, number]);
      S.goalUntil = now() + 1.8; S.goalEnd = into; S.light = { end: into, until: now() + 1.8 };
      S.shake = 16;
      if (by === mySide) {
        S.best = Math.max(S.best, k);
        sfx.horn();
        flash({ tone: 'for', big: pts > 1 ? 'Double goal!' : 'Goal!', small: `${k} km/h${pts > 1 ? ' · hot puck counts two' : ''}` });
      } else {
        sfx.against();
        flash({ tone: 'against', big: pts > 1 ? 'Burned. Two.' : 'Scored on', small: `${oppRef.current} · ${k} km/h` });
      }
      // a shower of light out of the net it went into
      const gy = into === 1 ? 0 : H;
      for (let i = 0; i < 70; i++) {
        const a = (into === 1 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 2.2;
        const v = 300 + Math.random() * 1100;
        S.sparks.push({ x: GOAL_X0 + Math.random() * GOAL_W, y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.6 + Math.random() * 0.8, c: by === mySide ? GOLD : RIVAL, r: 4 + Math.random() * 6 });
      }
      t.puck.vx = 0; t.puck.vy = 0;
      setP('goal');
      if (online && !told) send('m', { type: 'goal', by, pts, sc: S.sc, kmh: k });
    };

    const onMsg = (m: MatchMsg) => {
      if (m.type === 'take') {
        if (mySide === 1) {
          if (m.guest === me.id) { S.lastRecv = now(); if (S.phase === 'wait') startCount(); }
          else if (S.phase === 'wait') setP('taken');
        }
      } else if (m.type === 'goal') goal(m.by, m.pts, m.kmh, m.sc);
      else if (m.type === 'again') { S.againThem = true; setAgain((a) => ({ ...a, them: true })); if (S.againMe) reset(); }
      else if (m.type === 'bye') { if (!S.over) setP('gone'); }
    };

    if (mode.kind === 'online') {
      const key = String(me.id);
      chan = supabase.channel(`rink:${league}:${mode.match}`, { config: { broadcast: { self: false }, presence: { key } } })
        .on('broadcast', { event: 's' }, ({ payload }) => onState(payload as StateMsg))
        .on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload as MatchMsg))
        .on('presence', { event: 'sync' }, () => {
          const here = Object.keys(chan!.presenceState()).map(Number);
          const them = here.filter((k) => k !== me.id);
          if (mySide === 0 && S.phase === 'wait') {
            // the challenger takes the one they asked, or the first to answer an open challenge
            const guest = mode.vs != null ? them.find((k) => k === mode.vs) : them[0];
            if (guest != null) {
              S.guest = guest;
              setOpp(teams.find((x) => x.id === guest) ?? null);
              send('m', { type: 'take', guest });
              // and once more a moment later, in case the first went before they were listening
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

    const handle = (ev: TableEvent[]) => {
      for (const e of ev) {
        if (e.kind === 'hit') {
          sfx.hit(e.power, e.side === mySide);
          const c = e.side === mySide ? GOLD : RIVAL;
          S.rings.push({ x: t.puck.x, y: t.puck.y, t: 0, c });
          const n = Math.min(26, 4 + e.power / 160);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = 200 + Math.random() * (e.power * 0.5);
            S.sparks.push({ x: t.puck.x, y: t.puck.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.25 + Math.random() * 0.35, c: hot(t) ? '#ff8a1f' : c, r: 2 + Math.random() * 3 });
          }
          if (e.power > 2100) S.shake = Math.max(S.shake, 7);
          // online, touching it in your half makes it yours
          if (online && !S.owner && e.side === mySide) { S.owner = true; S.mineSince = 0; sendState(); }
        } else if (e.kind === 'wall') {
          if (now() - S.lastWall > 0.05) { sfx.wall(e.power); S.lastWall = now(); }
        } else if (e.kind === 'goal') {
          const by = otherSide(e.into);
          goal(by, hot(t) ? 2 : 1, kmh(speed(t.puck)));
        }
      }
      if (t.heat !== S.heatShown) {
        if (t.heat >= HEAT_AT && S.heatShown < HEAT_AT) { sfx.fire(); flash({ tone: 'fire', big: 'Hot puck!', small: 'The next goal counts two' }); }
        S.heatShown = t.heat; S.rally = Math.max(S.rally, t.heat); setHeat(t.heat);
      }
    };

    // ── the loop
    let raf = 0, last = now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const n = now();
      const dt = Math.min(0.05, n - last);
      last = n;

      // your paddle goes where your thumb is
      const mine = t.pads[mySide];
      mine.max = 7000;
      if (S.target) { mine.tx = S.target.x; mine.ty = S.target.y; }
      // theirs: the computer's mind, or where the other phone last said it was, carried on a moment
      if (brain && S.phase === 'play') think(brain, t, n);
      if (brain && S.phase !== 'play') { const [hx, hy] = [W / 2, 175]; t.pads[1].tx = hx; t.pads[1].ty = hy; t.pads[1].max = 1500; }
      if (online) {
        const r = S.remote, age = Math.min(0.12, n - r.at);
        const pad = t.pads[theirSide];
        pad.tx = r.x + r.vx * age; pad.ty = r.y + r.vy * age; pad.max = 9000;
      }

      if (S.phase === 'count') {
        const left = 3 - Math.floor(n - S.countFrom);
        if (left !== S.lastBeep) { S.lastBeep = left; setCount(Math.max(0, left)); if (left > 0) sfx.beep(); else sfx.beep(true); }
        if (n - S.countFrom >= 3.4) setP('play');
        handle(step(t, dt, { puck: false }));
      } else if (S.phase === 'play') {
        if (online) {
          const theirsBy = mySide === 0 ? MID - PUCK_R : MID + PUCK_R;
          const inTheirs = mySide === 0 ? t.puck.y < theirsBy : t.puck.y > theirsBy;
          const inMine = mySide === 0 ? t.puck.y > MID + PUCK_R : t.puck.y < MID - PUCK_R;
          if (S.owner && inTheirs) { S.owner = false; sendState(theirSide); }
          else if (!S.owner && inMine) {
            // it's been sitting on my side a while and nobody's handed it over: take it
            if (!S.mineSince) S.mineSince = n;
            else if (n - S.mineSince > 0.3) { S.owner = true; S.mineSince = 0; sendState(); }
          } else S.mineSince = 0;
          const ev = step(t, dt, { goals: S.owner, hits: S.owner ? [true, true] : [mySide === 0, mySide === 1] });
          handle(ev);
          if (n - S.lastRecv > 7 && !S.over) setP('gone');
        } else handle(step(t, dt));
      } else if (S.phase === 'goal') {
        handle(step(t, dt, { puck: false }));
        if (n >= S.goalUntil) {
          const won = S.sc[mySide] >= WIN_AT, lost = S.sc[theirSide] >= WIN_AT;
          if (won || lost) finish(won);
          else {
            // whoever was scored on takes the face-off in their own half
            faceoff(t, S.goalEnd);
            S.owner = !online || S.goalEnd === mySide;
            S.heatShown = 0; setHeat(0);
            setP('play');
          }
        }
      } else if (S.phase === 'wait' || S.phase === 'over' || S.phase === 'gone' || S.phase === 'taken') {
        handle(step(t, dt, { puck: false }));
      }
      if (online && (S.phase === 'play' || S.phase === 'count' || S.phase === 'goal') && n - S.lastSend >= SEND_EVERY) sendState();

      // ── effects
      S.trail.unshift({ x: t.puck.x, y: t.puck.y });
      if (S.trail.length > 16) S.trail.pop();
      for (const s of S.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.92; s.vy *= 0.92; }
      S.sparks = S.sparks.filter((s) => s.life < s.max);
      for (const r of S.rings) r.t += dt;
      S.rings = S.rings.filter((r) => r.t < 0.35);
      S.shake *= Math.pow(0.002, dt);

      draw();
    };

    const draw = () => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const sx = (Math.random() - 0.5) * S.shake, sy = (Math.random() - 0.5) * S.shake;
      if (rinkImg) g.drawImage(rinkImg, (offX - BOARD * scale + sx) * dpr - rinkPad * dpr, (offY - BOARD * scale + sy) * dpr - rinkPad * dpr);
      g.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx) * dpr, (offY + sy) * dpr);
      if (flip) { g.translate(W, H); g.rotate(Math.PI); }
      const n = now();

      // the goal light behind the net that was just scored on
      if (n < S.light.until) {
        const a = 0.55 * Math.max(0, (S.light.until - n) / 1.8) * (0.6 + 0.4 * Math.sin(n * 30));
        const y = S.light.end === 1 ? 0 : H;
        const gr = g.createRadialGradient(W / 2, y, 10, W / 2, y, 700);
        gr.addColorStop(0, `rgba(255,40,70,${a})`); gr.addColorStop(1, 'rgba(255,40,70,0)');
        g.fillStyle = gr; g.fillRect(0, y === 0 ? 0 : H - 700, W, 700);
      }

      // the puck's tail: ice-blue when it's moving, fire once it's hot
      const fire = hot(t);
      const sp = speed(t.puck);
      if (sp > 250) {
        for (let i = S.trail.length - 1; i >= 1; i--) {
          const p = S.trail[i], k = 1 - i / S.trail.length;
          g.beginPath(); g.arc(p.x, p.y, PUCK_R * (0.35 + 0.6 * k), 0, Math.PI * 2);
          g.fillStyle = fire ? `rgba(255,${Math.round(90 + 120 * k)},40,${0.42 * k})` : `rgba(120,200,255,${0.22 * k * Math.min(1, sp / 1500)})`;
          g.fill();
        }
      }
      if (fire && S.phase === 'play') {
        for (let i = 0; i < 2; i++) S.sparks.push({ x: t.puck.x + (Math.random() - 0.5) * PUCK_R, y: t.puck.y + (Math.random() - 0.5) * PUCK_R, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, life: 0, max: 0.35, c: Math.random() < 0.5 ? '#ffb020' : '#ff4d1f', r: 3 + Math.random() * 4 });
      }

      // hit rings
      for (const r of S.rings) {
        const k = r.t / 0.35;
        g.beginPath(); g.arc(r.x, r.y, PUCK_R + k * 110, 0, Math.PI * 2);
        g.strokeStyle = hexA(r.c, 0.6 * (1 - k)); g.lineWidth = 6 * (1 - k) + 1; g.stroke();
      }

      // the paddles
      paddle(g, t.pads[theirSide].x, t.pads[theirSide].y, RIVAL);
      paddle(g, t.pads[mySide].x, t.pads[mySide].y, GOLD);

      // the puck
      const p = t.puck;
      g.save();
      g.shadowColor = fire ? '#ff7a1a' : sp > 1600 ? '#7fd3ff' : 'rgba(0,0,0,.6)';
      g.shadowBlur = fire ? 40 : sp > 1600 ? 26 : 12;
      const pg = g.createRadialGradient(p.x - 10, p.y - 12, 4, p.x, p.y, PUCK_R);
      pg.addColorStop(0, fire ? '#5a2408' : '#3a4150'); pg.addColorStop(1, fire ? '#200800' : '#07090d');
      g.beginPath(); g.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2); g.fillStyle = pg; g.fill();
      g.restore();
      g.beginPath(); g.arc(p.x, p.y, PUCK_R - 3, 0, Math.PI * 2);
      g.strokeStyle = fire ? 'rgba(255,170,60,.9)' : 'rgba(255,255,255,.22)'; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(p.x, p.y, PUCK_R * 0.55, 0, Math.PI * 2);
      g.strokeStyle = fire ? 'rgba(255,120,40,.6)' : 'rgba(255,255,255,.08)'; g.lineWidth = 2; g.stroke();

      // sparks
      for (const s of S.sparks) {
        const k = 1 - s.life / s.max;
        g.beginPath(); g.arc(s.x, s.y, s.r * k + 0.5, 0, Math.PI * 2);
        g.fillStyle = hexA(s.c, k); g.fill();
      }
    };

    raf = requestAnimationFrame(frame);

    ctl.current = {
      pause: () => { if (S.phase === 'play' && !online) setP('paused'); },
      resume: () => { if (S.phase === 'paused') { last = now(); startCount(); } },
      rematch: () => {
        if (!online) { reset(); return; }
        S.againMe = true; setAgain((a) => ({ ...a, me: true }));
        send('m', { type: 'again', from: me.id });
        if (S.againThem) reset();
      },
      quit: () => { if (online) send('m', { type: 'bye', from: me.id }); },
    };
    // a phone that goes to the background pauses the computer game
    const onHide = () => { if (document.visibilityState === 'hidden') ctl.current?.pause(); };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onHide);
      if (chan) { if (!S.over) send('m', { type: 'bye', from: me.id }); supabase.removeChannel(chan); }
    };
    // one game per mount: the page mounts a fresh table for a new opponent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), 1700);
    return () => clearTimeout(id);
  }, [banner]);

  const quit = () => { ctl.current?.quit(); onExit(); };
  const myScore = sc[mySide], theirScore = sc[theirSide];
  const sub = mode.kind === 'cpu' ? `${mode.level.emoji} ${mode.level.name}` : opp ? `GM ${opp.gm_name}` : 'Waiting…';

  return (
    <div className="fixed inset-0 z-[55] flex select-none flex-col bg-[radial-gradient(120%_80%_at_50%_0%,#0d1a33_0%,#05080f_60%)] text-white" style={{ touchAction: 'none' }}>
      <style>{RINK_CSS}</style>
      {/* them */}
      <div className="pt-safe shrink-0 px-3">
        <div className="flex h-14 items-center gap-2.5">
          {mode.kind === 'cpu'
            ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-rose-800 text-lg shadow-[0_0_18px_-4px_#ff3b5c]">{mode.level.emoji}</span>
            : <TeamBadge team={opp ?? undefined} size={36} />}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{oppName}</div>
            <div className="truncate text-[11px] text-white/55">{sub}</div>
          </div>
          {heat > 0 && phase === 'play' && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-black tracking-wide ${heat >= HEAT_AT ? 'rink-fire bg-gradient-to-r from-orange-500 to-red-600 text-white' : 'bg-white/10 text-white/70'}`}>
              {heat >= HEAT_AT ? '🔥 HOT' : `Rally ${heat}`}
            </span>
          )}
          <div className="num w-10 text-right font-display text-4xl font-extrabold tabular-nums text-rose-300 drop-shadow-[0_0_12px_rgba(255,59,92,.6)]">{theirScore}</div>
        </div>
      </div>

      {/* the table */}
      <div ref={wrapRef} className="relative min-h-0 flex-1" style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} className="absolute inset-0" />
        {phase === 'count' && count > 0 && <div key={count} className="rink-pop pointer-events-none absolute inset-0 grid place-items-center font-display text-[120px] font-extrabold text-white/90 drop-shadow-[0_0_30px_rgb(var(--gold-rgb)/.8)]">{count}</div>}
        {phase === 'count' && count === 0 && <div className="rink-pop pointer-events-none absolute inset-0 grid place-items-center font-display text-7xl font-extrabold uppercase text-gold drop-shadow-[0_0_30px_rgb(var(--gold-rgb)/.8)]">Drop it!</div>}
        {banner && (
          <div key={banner.id} className="rink-pop pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center">
            <div className={`font-display text-[clamp(2.5rem,14vw,3.75rem)] leading-none font-extrabold uppercase tracking-wide ${banner.tone === 'for' ? 'text-gold drop-shadow-[0_0_28px_rgb(var(--gold-rgb)/.9)]' : banner.tone === 'fire' ? 'rink-fire-text' : 'text-rose-300 drop-shadow-[0_0_24px_rgba(255,59,92,.8)]'}`}>{banner.big}</div>
            {banner.small && <div className="mt-2 inline-block rounded-full bg-[#05080f]/75 px-3 py-1 text-sm font-semibold text-white">{banner.small}</div>}
          </div>
        )}
        {phase === 'wait' && (
          <Overlay>
            <div className="rink-pulse mx-auto mb-3 h-14 w-14 rounded-full border-4 border-gold/70" />
            <div className="font-display text-2xl font-extrabold uppercase">Waiting for {opp ? opp.name : 'a taker'}</div>
            <p className="mt-1 text-sm text-white/70">{opp ? 'They have the challenge. Warm up your thumb.' : 'Your challenge is in the chat. The first to tap it plays you.'}</p>
            <button className="btn-ghost mt-4" onClick={quit}>Call it off</button>
          </Overlay>
        )}
        {phase === 'paused' && (
          <Overlay>
            <div className="font-display text-3xl font-extrabold uppercase">Timeout</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-gold" onClick={() => ctl.current?.resume()}><Play size={16} /> Back on the ice</button>
              <button className="btn-ghost" onClick={quit}>Leave</button>
            </div>
          </Overlay>
        )}
        {phase === 'gone' && (
          <Overlay>
            <div className="text-4xl">📡</div>
            <div className="mt-1 font-display text-2xl font-extrabold uppercase">{oppName} left the rink</div>
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
            <div className="mx-auto mt-3 grid max-w-xs grid-cols-2 gap-2 text-left">
              <div className="rounded-2xl bg-white/[.06] px-3 py-2 ring-1 ring-white/10"><div className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">Hardest goal</div><div className="num text-lg font-bold">{result.best ? `${result.best} km/h` : '—'}</div></div>
              <div className="rounded-2xl bg-white/[.06] px-3 py-2 ring-1 ring-white/10"><div className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">Longest rally</div><div className="num text-lg font-bold">{result.rally}</div></div>
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
            <div className="truncate text-[11px] text-white/55">You · first to {WIN_AT}</div>
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

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/55 px-6 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rink-pop w-full max-w-sm rounded-[28px] border border-white/10 bg-gradient-to-b from-[#16213b]/95 to-[#0a1222]/95 p-5 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]">{children}</div>
    </div>
  );
}

// a colour with an alpha, from #rrggbb
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// a striker: a glowing ring in the player's colour round a raised knob
function paddle(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
  g.save();
  g.shadowColor = c; g.shadowBlur = 30;
  const base = g.createRadialGradient(x - 18, y - 22, 6, x, y, PAD_R);
  base.addColorStop(0, hexA(c, 1)); base.addColorStop(0.7, hexA(c, 0.85)); base.addColorStop(1, hexA(c, 0.55));
  g.beginPath(); g.arc(x, y, PAD_R, 0, Math.PI * 2); g.fillStyle = base; g.fill();
  g.restore();
  g.beginPath(); g.arc(x, y, PAD_R - 7, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 5; g.stroke();
  const knob = g.createRadialGradient(x - 8, y - 10, 2, x, y, PAD_R * 0.45);
  knob.addColorStop(0, 'rgba(255,255,255,.95)'); knob.addColorStop(0.4, hexA(c, 1)); knob.addColorStop(1, 'rgba(0,0,0,.35)');
  g.beginPath(); g.arc(x, y, PAD_R * 0.42, 0, Math.PI * 2); g.fillStyle = knob; g.fill();
}

// the rink, drawn once per size: boards, ice, lines, creases, the nets, the league's name at centre ice
const rinkPad = 40;
function drawRink(gold: string, ice: string, k: number): HTMLCanvasElement {
  const B = 22;
  const c = document.createElement('canvas');
  c.width = Math.ceil((W + B * 2) * k + rinkPad * 2 * (k > 0 ? 1 : 1));
  c.height = Math.ceil((H + B * 2) * k + rinkPad * 2);
  const g = c.getContext('2d')!;
  g.translate(rinkPad, rinkPad);
  g.scale(k, k);
  g.translate(B, B);
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // the boards: a lit rim in the league's colour
  g.save();
  round(-B, -B, W + B * 2, H + B * 2, CORNER_R + B);
  g.shadowColor = gold; g.shadowBlur = 36;
  const rim = g.createLinearGradient(0, -B, 0, H + B);
  rim.addColorStop(0, '#1c2a46'); rim.addColorStop(0.5, '#25365a'); rim.addColorStop(1, '#1c2a46');
  g.fillStyle = rim; g.fill();
  g.restore();
  round(-B + 4, -B + 4, W + B * 2 - 8, H + B * 2 - 8, CORNER_R + B - 4);
  g.strokeStyle = hexA(gold.startsWith('#') ? gold : GOLD_FALLBACK, 0.75); g.lineWidth = 3; g.stroke();
  // the ice
  round(0, 0, W, H, CORNER_R);
  const ic = g.createLinearGradient(0, 0, W, H);
  ic.addColorStop(0, '#e9f4ff'); ic.addColorStop(0.5, '#d6e9fb'); ic.addColorStop(1, '#e6f2ff');
  g.fillStyle = ic; g.fill();
  g.save();
  g.clip();
  // skate scratches, the same every time
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.strokeStyle = 'rgba(120,150,190,.10)'; g.lineWidth = 1.5;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, l = 60 + rnd() * 220;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 20, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // the air holes of the table, faint
  g.fillStyle = 'rgba(70,100,140,.10)';
  for (let y = 40; y < H; y += 56) for (let x = 40 + ((y / 56) % 2) * 28; x < W; x += 56) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  // centre ice: the league's name
  g.save();
  g.translate(W / 2, MID);
  g.font = '900 120px "Barlow Condensed", Inter, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,40,80,.07)';
  g.fillText(ice.toUpperCase().slice(0, 14), 0, 0);
  g.restore();
  // blue lines and the red line
  g.fillStyle = 'rgba(30,110,230,.55)';
  g.fillRect(0, MID - 330 - 9, W, 18); g.fillRect(0, MID + 330 - 9, W, 18);
  g.fillStyle = 'rgba(225,30,60,.7)';
  g.fillRect(0, MID - 7, W, 14);
  g.strokeStyle = 'rgba(225,30,60,.7)'; g.setLineDash([22, 14]); g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, MID - 12); g.lineTo(W, MID - 12); g.moveTo(0, MID + 12); g.lineTo(W, MID + 12); g.stroke();
  g.setLineDash([]);
  // centre circle and dot
  g.strokeStyle = 'rgba(30,110,230,.6)'; g.lineWidth = 6;
  g.beginPath(); g.arc(W / 2, MID, 170, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(30,110,230,.8)'; g.beginPath(); g.arc(W / 2, MID, 14, 0, Math.PI * 2); g.fill();
  // face-off circles in each zone
  for (const y of [MID - 560, MID + 560]) for (const x of [250, W - 250]) {
    g.strokeStyle = 'rgba(225,30,60,.35)'; g.lineWidth = 5;
    g.beginPath(); g.arc(x, y, 120, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(225,30,60,.55)'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
  }
  // the creases
  for (const end of [0, 1]) {
    const y = end === 1 ? 0 : H;
    g.beginPath(); g.arc(W / 2, y, GOAL_W / 2 + 30, end === 1 ? 0 : Math.PI, end === 1 ? Math.PI : Math.PI * 2);
    g.fillStyle = 'rgba(70,160,255,.22)'; g.fill();
    g.strokeStyle = 'rgba(225,30,60,.6)'; g.lineWidth = 5; g.stroke();
    g.fillStyle = 'rgba(225,30,60,.75)'; g.fillRect(0, end === 1 ? 60 : H - 66, W, 6);
  }
  g.restore();
  // the nets: a dark mouth in the boards with a glowing frame
  for (const end of [0, 1]) {
    const y = end === 1 ? -B - 2 : H - 2;
    g.fillStyle = '#05080f';
    g.fillRect(GOAL_X0, y, GOAL_W, B + 4);
    g.save();
    g.shadowColor = '#ff3b5c'; g.shadowBlur = 18;
    g.strokeStyle = '#ff5a74'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(GOAL_X0, end === 1 ? 0 : H); g.lineTo(GOAL_X0, end === 1 ? -B : H + B); g.moveTo(GOAL_X1, end === 1 ? 0 : H); g.lineTo(GOAL_X1, end === 1 ? -B : H + B); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5;
    for (let x = GOAL_X0 + 16; x < GOAL_X1; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + B + 4); g.stroke(); }
  }
  return c;
}

const RINK_CSS = `
@keyframes rink-pop { 0% { transform: scale(.6); opacity: 0 } 45% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
.rink-pop { animation: rink-pop .38s cubic-bezier(.2,.9,.3,1.3) both }
@keyframes rink-pulse { 0%,100% { transform: scale(.85); opacity: .5 } 50% { transform: scale(1.1); opacity: 1 } }
.rink-pulse { animation: rink-pulse 1.2s ease-in-out infinite }
@keyframes rink-fire { 0%,100% { box-shadow: 0 0 10px #ff7a1a } 50% { box-shadow: 0 0 22px #ff3b1a } }
.rink-fire { animation: rink-fire .6s ease-in-out infinite }
.rink-fire-text { background: linear-gradient(180deg,#ffe08a,#ff8a1f 55%,#ff3b1a); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 22px rgba(255,120,30,.8)) }
`;
