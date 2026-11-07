// The computer across the table in Rink Duel. It reads the puck the way a player does (where is it going, can I get
// there, is it mine to shoot) and every level is the same brain with slower feet, slower eyes and a shakier aim.
import { GOAL_X0, GOAL_X1, H, MID, PAD_R, PUCK_R, W, predictX, speed, type Table } from './physics.ts';

export type Level = 'beer' | 'junior' | 'pro' | 'legend';
export interface LevelInfo { key: Level; name: string; who: string; emoji: string; blurb: string; feet: number; eyes: number; aim: number; nerve: number; track: number; whiff: number; banks: boolean }

// feet: paddle speed (units a second); eyes: seconds between reads; aim: how far off a shot can go (units);
// nerve: how far up the ice it will chase the puck (0 hangs back, 1 meets it at the red line); track: how far it
// follows the puck side to side when guarding; whiff: the chance it
// misreads a shot altogether and stays where it is; banks: plays the boards
export const LEVELS: LevelInfo[] = [
  { key: 'beer', name: 'Beer league', who: 'Sunday Night Stan', emoji: '🍺', blurb: 'Slow feet, big heart. Good for warming up the thumb.', feet: 420, eyes: 0.45, aim: 300, nerve: 0.15, track: 0.2, whiff: 0.5, banks: false },
  { key: 'junior', name: 'Junior', who: 'The Prospect', emoji: '🎒', blurb: 'Quick and eager, still learns the angles the hard way.', feet: 700, eyes: 0.3, aim: 200, nerve: 0.35, track: 0.35, whiff: 0.3, banks: false },
  { key: 'pro', name: 'Pro', who: 'The Grinder', emoji: '🥅', blurb: 'Reads your shot, takes away the middle, shoots for the corners.', feet: 1200, eyes: 0.16, aim: 110, nerve: 0.55, track: 0.5, whiff: 0.12, banks: true },
  { key: 'legend', name: 'Legend', who: 'The Wall', emoji: '👑', blurb: 'Banks it, fakes it, buries it. Beat this and you have bragging rights.', feet: 2100, eyes: 0.08, aim: 40, nerve: 0.8, track: 0.6, whiff: 0.03, banks: true },
];
export const levelOf = (k: string | null | undefined) => LEVELS.find((l) => l.key === k) ?? LEVELS[1];

export interface Brain { level: LevelInfo; next: number; mode: 'guard' | 'shoot' | 'block'; aimX: number; bank: number; windup: number; bx: number; by: number; read: boolean }
export const newBrain = (level: LevelInfo): Brain => ({ level, next: 0, mode: 'guard', aimX: W / 2, bank: 0, windup: 0, bx: W / 2, by: 175, read: false });

const DEF_Y = 175;                     // where it stands to guard (its goal is y = 0)
const rand = (a: number) => (Math.random() * 2 - 1) * a;

// set the computer's paddle (side 1, the top) going where it means to be; call it every frame
export function think(b: Brain, t: Table, now: number) {
  const pad = t.pads[1], p = t.puck, L = b.level;
  pad.max = L.feet;
  const mine = p.y < MID;                                  // the puck is in its half
  const coming = p.vy < -40;                               // heading at its goal
  const slow = speed(p) < 420;

  // a new read, every so often: what to do with this puck. Between reads it acts on the last one, which is how a
  // slower level gets caught out by a bank or a change of pace
  b.read = now >= b.next;
  if (b.read) {
    b.next = now + L.eyes * (0.7 + Math.random() * 0.6);
    if (mine && (slow || (!coming && p.y > pad.y - PAD_R))) {
      if (b.mode !== 'shoot') {
        b.mode = 'shoot';
        // pick a spot in the other net, or a bank off the boards for the levels that know how
        b.aimX = GOAL_X0 + 40 + Math.random() * (GOAL_X1 - GOAL_X0 - 80) + rand(L.aim);
        b.bank = L.banks && Math.random() < 0.35 ? (p.x < W / 2 ? 1 : -1) : 0;
        b.windup = now + 0.12 + Math.random() * 0.25;
      }
    } else if (coming) { if (b.mode !== 'block' && Math.random() < L.whiff) b.next = now + 0.5; else b.mode = 'block'; }
    else b.mode = 'guard';
  }

  if (b.mode === 'shoot') {
    if (!mine) { b.mode = 'guard'; return; }
    // aim through the puck at the target (a bank aims at its mirror image beyond the side boards)
    const goalY = H + 40;
    const ax = b.bank ? (b.bank > 0 ? 2 * W - b.aimX : -b.aimX) : b.aimX;
    let dx = ax - p.x, dy = goalY - p.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    // first line up behind it, then drive through it
    const behind = PUCK_R + PAD_R + 26;
    const bx = p.x - dx * behind, by = p.y - dy * behind;
    const lined = Math.hypot(pad.x - bx, pad.y - by) < 34;
    if (now < b.windup || !lined) { pad.tx = bx; pad.ty = Math.max(PAD_R, by); }
    else { pad.tx = p.x + dx * 140; pad.ty = p.y + dy * 140; }
    // a puck stuck against its own boards behind it: come round and dig it out
    if (p.y < pad.y - 10 && Math.abs(p.x - pad.x) < PAD_R + PUCK_R) pad.tx = p.x + (p.x < W / 2 ? 1 : -1) * (PAD_R + PUCK_R);
    return;
  }

  if (b.mode === 'block') {
    // meet the shot where it will cross the guard line, or a little further out on the braver levels
    if (b.read) {
      const meetY = DEF_Y + L.nerve * (MID - DEF_Y - PAD_R) * (p.y < MID ? 0.4 : 1);
      const hit = predictX(p, meetY) ?? predictX(p, DEF_Y);
      if (hit) {
        // the read is only as good as the eyes: off by up to half its aim error
        b.bx = hit.x + rand(L.aim * 0.5);
        b.by = hit.t < 0.12 ? meetY - 20 : meetY;
        // close enough to reach it: step into it for a counter-punch
        if (hit.t < 0.18 && L.nerve > 0.3) b.by = meetY + 40;
      } else { b.bx = W / 2 + (p.x - W / 2) * L.track; b.by = DEF_Y; }
    }
    pad.tx = b.bx; pad.ty = b.by;
    return;
  }

  // guard: between the puck and the middle of its net, drifting with the play
  // (a shaky level drifts off its angle and opens a side)
  if (b.read) { b.bx = W / 2 + (p.x - W / 2) * L.track + rand(L.aim * 0.5); b.by = DEF_Y + (mine ? 40 : 0); }
  pad.tx = b.bx; pad.ty = b.by;
}
