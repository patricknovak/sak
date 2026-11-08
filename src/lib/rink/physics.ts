// Rink Duel (7 November 2026): thumb air hockey for hockey leagues and pools. This is the table and everything that
// moves on it, with no drawing and no React, so the computer, the online match and the tests all play the same game.
//
// One table, measured in table units: side 0 defends the bottom goal (y = H), side 1 the top goal (y = 0). Each player
// sees their own end at the bottom of the phone; the online guest's screen is simply this table turned round.

export const W = 1000;
export const H = 1720;
export const MID = H / 2;
export const PUCK_R = 36;
export const PAD_R = 62;
export const GOAL_W = 380;                    // the mouth, centred
export const GOAL_X0 = (W - GOAL_W) / 2;
export const GOAL_X1 = GOAL_X0 + GOAL_W;
export const CORNER_R = 150;                  // rounded boards, so a puck never dies in a corner
export const MAX_PUCK = 3400;                 // units a second: a full-power shot crosses the table in half a second
export const WIN_AT = 7;                      // first to seven
export const HEAT_AT = 6;                     // six straight exchanges and the puck catches fire: that goal counts two

const WALL_E = 0.9;                           // how lively the boards are
const PAD_E = 0.92;                           // how lively a paddle is
const DRAG = 0.42;                            // the air cushion: speed lost per second, as a share
const SUBSTEPS = 6;

export type Side = 0 | 1;
export interface Body { x: number; y: number; vx: number; vy: number }
export interface Paddle extends Body { tx: number; ty: number; max: number }
export interface Table { puck: Body; pads: [Paddle, Paddle]; last: Side | null; heat: number }
export type TableEvent =
  | { kind: 'hit'; side: Side; power: number }
  | { kind: 'wall'; power: number }
  // the goal side 0 or 1 defends: the other side scored. Own: the defender touched it last (into their own net)
  | { kind: 'goal'; into: Side; own: boolean };

export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);
export const hot = (t: Table) => t.heat >= HEAT_AT;

// where each paddle may go: its own half, edge to the red line, never into its own net
export function clampPad(side: Side, x: number, y: number): [number, number] {
  const cx = Math.min(W - PAD_R, Math.max(PAD_R, x));
  const cy = side === 0 ? Math.min(H - PAD_R, Math.max(MID + PAD_R, y)) : Math.min(MID - PAD_R, Math.max(PAD_R, y));
  return [cx, cy];
}

export const homeOf = (side: Side): [number, number] => [W / 2, side === 0 ? H - 210 : 210];

export function newTable(): Table {
  const pad = (s: Side): Paddle => { const [x, y] = homeOf(s); return { x, y, vx: 0, vy: 0, tx: x, ty: y, max: 6000 }; };
  return { puck: { x: W / 2, y: MID, vx: 0, vy: 0 }, pads: [pad(0), pad(1)], last: null, heat: 0 };
}

// a face-off: the puck sits still in the half of the side that takes it (whoever was just scored on)
export function faceoff(t: Table, to: Side) {
  t.puck = { x: W / 2, y: to === 0 ? MID + 230 : MID - 230, vx: 0, vy: 0 };
  t.last = null;
  t.heat = 0;
  for (const s of [0, 1] as Side[]) {
    const [x, y] = homeOf(s);
    Object.assign(t.pads[s], { x, y, vx: 0, vy: 0, tx: x, ty: y });
  }
}

export const speed = (b: { vx: number; vy: number }) => Math.hypot(b.vx, b.vy);
function capSpeed(b: Body) {
  const s = speed(b);
  if (s > MAX_PUCK) { b.vx *= MAX_PUCK / s; b.vy *= MAX_PUCK / s; }
}

// bounce the puck off a fixed point (a goal post) or a corner's curve
function bounceOffPoint(p: Body, cx: number, cy: number, reach: number, out: TableEvent[], inside = false) {
  const dx = p.x - cx, dy = p.y - cy;
  const d = Math.hypot(dx, dy) || 0.0001;
  // a post pushes the puck away when it's closer than its radius; a corner's curve pushes it back in when it strays out
  if (inside ? d <= reach : d >= reach) return;
  const nx = (inside ? -dx : dx) / d, ny = (inside ? -dy : dy) / d;
  const fix = inside ? d - reach : reach - d;
  p.x += nx * fix; p.y += ny * fix;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) {
    p.vx -= (1 + WALL_E) * vn * nx; p.vy -= (1 + WALL_E) * vn * ny;
    if (-vn > 120) out.push({ kind: 'wall', power: -vn });
  }
}

function boards(t: Table, out: TableEvent[], goals: boolean) {
  const p = t.puck, r = PUCK_R;
  const inMouth = p.x > GOAL_X0 + r * 0.25 && p.x < GOAL_X1 - r * 0.25;
  // the side boards
  if (p.x < r) { p.x = r; if (p.vx < 0) { if (-p.vx > 120) out.push({ kind: 'wall', power: -p.vx }); p.vx = -p.vx * WALL_E; } }
  if (p.x > W - r) { p.x = W - r; if (p.vx > 0) { if (p.vx > 120) out.push({ kind: 'wall', power: p.vx }); p.vx = -p.vx * WALL_E; } }
  // the end boards, open at the mouth
  for (const end of [0, 1] as Side[]) {
    const wallY = end === 1 ? 0 : H;
    const past = end === 1 ? p.y < wallY + r : p.y > wallY - r;
    if (!past) continue;
    if (inMouth) {
      // through the mouth: in once the whole puck has crossed the line
      const inNet = end === 1 ? p.y < wallY - r * 0.6 : p.y > wallY + r * 0.6;
      if (inNet) {
        if (goals) { out.push({ kind: 'goal', into: end, own: t.last === end }); return; }
        // the online match's other phone waits to be told about a goal rather than calling it
        p.y = end === 1 ? wallY - r * 0.6 : wallY + r * 0.6;
        p.vx = 0; p.vy = 0;
      }
      continue;
    }
    p.y = end === 1 ? wallY + r : wallY - r;
    const into = end === 1 ? -p.vy : p.vy;
    if (into > 0) { if (into > 120) out.push({ kind: 'wall', power: into }); p.vy = -p.vy * WALL_E; }
  }
  // the posts
  for (const end of [0, 1]) {
    const y = end === 1 ? 0 : H;
    bounceOffPoint(p, GOAL_X0, y, r, out);
    bounceOffPoint(p, GOAL_X1, y, r, out);
  }
  // the rounded corners: the puck's centre stays inside a circle of (corner - puck) radius
  const c = CORNER_R, reach = CORNER_R - r;
  for (const [cx, cy] of [[c, c], [W - c, c], [c, H - c], [W - c, H - c]]) {
    const inCorner = (cx < W / 2 ? p.x < cx : p.x > cx) && (cy < H / 2 ? p.y < cy : p.y > cy);
    if (inCorner) bounceOffPoint(p, cx, cy, reach, out, true);
  }
}

function movePaddle(pad: Paddle, side: Side, dt: number) {
  const [tx, ty] = clampPad(side, pad.tx, pad.ty);
  let dx = tx - pad.x, dy = ty - pad.y;
  const d = Math.hypot(dx, dy), step = pad.max * dt;
  if (d > step) { dx *= step / d; dy *= step / d; }
  pad.vx = dx / dt; pad.vy = dy / dt;
  pad.x += dx; pad.y += dy;
}

function paddleHit(t: Table, side: Side, out: TableEvent[]) {
  const p = t.puck, pad = t.pads[side];
  const dx = p.x - pad.x, dy = p.y - pad.y;
  const d = Math.hypot(dx, dy), reach = PUCK_R + PAD_R;
  if (d >= reach) return;
  const nx = d ? dx / d : 0, ny = d ? dy / d : side === 0 ? -1 : 1;
  p.x = pad.x + nx * reach; p.y = pad.y + ny * reach;
  // the paddle is a wall that moves: bounce off it in its own frame, then carry its speed
  const rvx = p.vx - pad.vx, rvy = p.vy - pad.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const before = speed(p);
    p.vx -= (1 + PAD_E) * vn * nx; p.vy -= (1 + PAD_E) * vn * ny;
    capSpeed(p);
    const power = Math.max(-vn, Math.abs(speed(p) - before));
    // a rally is an exchange: the heat climbs only when the other side touches it next
    if (t.last !== side) { if (t.last != null) t.heat++; t.last = side; }
    out.push({ kind: 'hit', side, power });
  }
}

export interface StepOptions {
  goals?: boolean;               // this phone calls goals (the computer game always; online, the puck's owner)
  puck?: boolean;                // this phone moves the puck at all
  hits?: [boolean, boolean];     // which paddles this phone lets touch the puck
}

// advance the table by dt seconds and say what happened
export function step(t: Table, dt: number, o: StepOptions = {}): TableEvent[] {
  const out: TableEvent[] = [];
  const goals = o.goals ?? true, movePuck = o.puck ?? true, hits = o.hits ?? [true, true];
  const h = Math.min(dt, 1 / 20) / SUBSTEPS;
  const drag = Math.exp(-DRAG * h);
  for (let i = 0; i < SUBSTEPS; i++) {
    movePaddle(t.pads[0], 0, h);
    movePaddle(t.pads[1], 1, h);
    if (!movePuck) continue;
    const p = t.puck;
    p.x += p.vx * h; p.y += p.vy * h;
    p.vx *= drag; p.vy *= drag;
    if (hits[0]) paddleHit(t, 0, out);
    if (hits[1]) paddleHit(t, 1, out);
    boards(t, out, goals);
    if (out.some((e) => e.kind === 'goal')) break;
  }
  return out;
}

// where the puck will cross a line across the table (y = lineY), boards included, if nothing touches it: the computer's
// read of a shot. Null when it's going the other way or will die first.
export function predictX(p: Body, lineY: number): { x: number; t: number } | null {
  if (Math.abs(p.vy) < 30 || (lineY - p.y) * p.vy <= 0) return null;
  // the drag slows it: the time to cover the distance, if it ever does
  const k = DRAG, dist = Math.abs(lineY - p.y), v = Math.abs(p.vy);
  const reachable = v / k;
  if (dist >= reachable) return null;
  const t = -Math.log(1 - (dist * k) / v) / k;
  // sideways, under the same drag, folded off the side boards
  const span = W - 2 * PUCK_R;
  let x = p.x - PUCK_R + (p.vx / k) * (1 - Math.exp(-k * t));
  x = ((x % (2 * span)) + 2 * span) % (2 * span);
  if (x > span) x = 2 * span - x;
  return { x: x + PUCK_R, t };
}
