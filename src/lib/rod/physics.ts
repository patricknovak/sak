// Rod Hockey (8 November 2026): table hockey on the phone, for every hockey league and pool. This is the table and
// everything that moves on it, with no drawing and no React, so the computer, the online match and the tests all play
// the same game.
//
// The table is a rod hockey game seen from above: six players a side, each riding his own slot cut in the ice (the
// goalie across his crease, the two defencemen across the ice in front of him, the three forwards up and down), each
// turning on his rod to swing his stick. Side 0 defends the bottom goal (y = H) and shoots up; side 1 is the same team
// turned round. A player's stick is a blade that sweeps round him: spin it into the puck and the puck flies.

export const W = 1000;
export const H = 1600;
export const MID = H / 2;
export const PUCK_R = 22;
export const BODY_R = 36;                     // the player, seen from above: helmet and shoulders
export const STICK = 96;                      // from his middle to the toe of the blade
export const BLADE_R = 12;                    // the stick's half-thickness
export const REACH = STICK + PUCK_R + 8;      // how close the puck must be for him to play it
export const GOAL_W = 250;                    // the mouth, centred
export const GOAL_X0 = (W - GOAL_W) / 2;
export const GOAL_X1 = GOAL_X0 + GOAL_W;
export const GOAL_D = 70;                     // how deep the net is behind the goal line
export const CORNER_R = 170;
export const MAX_PUCK = 3300;
export const WIN_AT = 5;                      // first to five

const WALL_E = 0.74;                          // the boards are dead-ish wood, not the air table's rubber
const BODY_E = 0.45;
const STICK_E = 0.55;
const DRAG = 0.62;                            // the puck slides on painted metal: it slows more than an air puck
const SUBSTEPS = 8;
const SPIN = 15;                              // how fast a player turns to face the puck, radians a second
const SWING = 0.17;                           // a shot's swing, seconds
const HOLD_MAX = 1.6;                         // a player can cradle the puck this long before it rolls off his blade

export type Side = 0 | 1;
export type Role = 'G' | 'LD' | 'RD' | 'LW' | 'C' | 'RW';
export interface Body { x: number; y: number; vx: number; vy: number }
// a slot, for side 0: from a to b. Side 1's is the same slot turned round the centre dot
export interface Slot { role: Role; num: number; ax: number; ay: number; bx: number; by: number }

export const SLOTS: Slot[] = [
  { role: 'G', num: 1, ax: GOAL_X0 + 34, ay: H - 78, bx: GOAL_X1 - 34, by: H - 78 },
  { role: 'LD', num: 4, ax: 105, ay: H - 445, bx: 465, by: H - 445 },
  { role: 'RD', num: 2, ax: 535, ay: H - 445, bx: 895, by: H - 445 },
  { role: 'LW', num: 9, ax: 150, ay: 175, bx: 150, by: H - 560 },
  { role: 'C', num: 19, ax: 430, ay: 300, bx: 430, by: H - 500 },
  { role: 'RW', num: 17, ax: 770, ay: 175, bx: 770, by: H - 560 },
];
export const isGoalie = (f: Fig) => f.role === 'G';

export interface Shot { dx: number; dy: number; power: number; until: number; tap: boolean; extra: number }
export interface Fig {
  side: Side; i: number; role: Role; num: number;
  ax: number; ay: number; ux: number; uy: number; len: number;   // the slot: start, direction, length
  t: number; tt: number;            // where he is on the slot (0..len) and where he's going
  x: number; y: number; vx: number; vy: number;
  th: number; w: number; tth: number | null;  // the stick's angle, its turning speed, where it's being turned to
  speed: number;                    // how fast he slides, units a second
  swing: number;                    // time left in a shot's swing (the stick spins through)
  spinDir: 1 | -1;
  shot: Shot | null;                // a shot asked for: it goes the moment the puck is on his stick
  carry: boolean;                   // his controller wants him to cradle the puck
  held: number;                     // how long he's had it on his blade
  cool: number;                     // after a shot or a poke, a moment before he can cradle again
  ghost: number;                    // just after his own shot the puck goes round him, not off his back
}
export interface Table {
  puck: Body; figs: Fig[];
  last: { side: Side; i: number } | null;     // who last played it on purpose: a shot, a pass, the cradle
  touch: { side: Side; i: number } | null;    // who last touched it at all, a deflection included
  clock: number;                    // seconds of play, for shots' windows
  hist: { t: number; x: number; y: number }[];  // where the puck has been lately, for the goalies' reaction
  holder: Fig | null;
}
export type TableEvent =
  | { kind: 'hit'; side: Side; i: number; power: number; shot: boolean }
  | { kind: 'wall'; power: number; post: boolean }
  // the goal side 0 or 1 defends: the other side scored. Own: the defending side touched it last
  | { kind: 'goal'; into: Side; own: boolean; by: { side: Side; i: number } | null }
  | { kind: 'shot'; side: Side; i: number; onNet: boolean; power: number };

export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);
export const speed = (b: { vx: number; vy: number }) => Math.hypot(b.vx, b.vy);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function makeFig(side: Side, i: number): Fig {
  const s = SLOTS[i];
  let ax = s.ax, ay = s.ay, bx = s.bx, by = s.by;
  if (side === 1) { ax = W - ax; ay = H - ay; bx = W - bx; by = H - by; }
  const len = Math.hypot(bx - ax, by - ay);
  const f: Fig = {
    side, i, role: s.role, num: s.num, ax, ay, ux: (bx - ax) / len, uy: (by - ay) / len, len,
    t: 0, tt: 0, x: ax, y: ay, vx: 0, vy: 0, th: side === 0 ? -Math.PI / 2 : Math.PI / 2, w: 0, tth: null,
    speed: 300, swing: 0, spinDir: 1, shot: null, carry: false, held: 0, cool: 0, ghost: 0,
  };
  return f;
}

// where each player lines up for a face-off: forwards at centre, the defence and the goalie in the middle of their slots
export function lineUp(t: Table) {
  for (const f of t.figs) {
    let at = f.len / 2;
    if (f.role === 'C' || f.role === 'LW' || f.role === 'RW') {
      // a forward's slot runs from deep in their zone (start) to his own blue line (end): face off at the red line
      at = clamp(Math.abs((MID + (f.side === 0 ? 90 : -90)) - f.ay) / Math.max(1e-6, Math.abs(f.uy)), 0, f.len);
    }
    f.t = f.tt = at;
    f.x = f.ax + f.ux * at; f.y = f.ay + f.uy * at;
    f.vx = f.vy = 0; f.w = 0; f.swing = 0; f.shot = null; f.held = 0; f.cool = 0;
    f.th = f.side === 0 ? -Math.PI / 2 : Math.PI / 2;
  }
}

export function newTable(): Table {
  const figs: Fig[] = [];
  for (const side of [0, 1] as Side[]) for (let i = 0; i < SLOTS.length; i++) figs.push(makeFig(side, i));
  const t: Table = { puck: { x: W / 2, y: MID, vx: 0, vy: 0 }, figs, last: null, touch: null, clock: 0, hist: [], holder: null };
  lineUp(t);
  return t;
}
export const figOf = (t: Table, side: Side, i: number) => t.figs[side * SLOTS.length + i];
export const sideFigs = (t: Table, side: Side) => t.figs.slice(side * SLOTS.length, side * SLOTS.length + SLOTS.length);

// the puck drop: it falls at the centre dot with a little life in it, so neither centre gets it for free
export function drop(t: Table, rnd = Math.random) {
  lineUp(t);
  const a = rnd() * Math.PI * 2;
  const v = 90 + rnd() * 120;
  t.puck = { x: W / 2, y: MID, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 };
  t.last = null; t.touch = null; t.holder = null; t.hist = [];
}

// the nearest point on a player's slot to (x, y), as a distance along it
export function along(f: Fig, x: number, y: number) {
  return clamp((x - f.ax) * f.ux + (y - f.ay) * f.uy, 0, f.len);
}
// how far the puck is from anywhere this player can be
export function slotDist(f: Fig, x: number, y: number) {
  const s = along(f, x, y);
  return Math.hypot(x - (f.ax + f.ux * s), y - (f.ay + f.uy * s));
}
export const inReach = (f: Fig, p: Body, extra = 0) => Math.hypot(p.x - f.x, p.y - f.y) <= REACH + extra;

// the player a side is running: the one nearest the puck, held a little so it doesn't flicker between two. The goalie
// only takes over when the puck is in his own end, near him.
export function pickActive(t: Table, side: Side, cur: number | null): number {
  const p = t.puck;
  let best = -1, bestD = Infinity;
  const cost = (f: Fig) => slotDist(f, p.x, p.y) + (f.role === 'G' ? 70 : 0)
    // a forward pinned at the end of his slot with the puck behind him is no use: prefer whoever is in front of it
    + (Math.hypot(p.x - (f.ax + f.ux * along(f, p.x, p.y)), p.y - (f.ay + f.uy * along(f, p.x, p.y))) > REACH ? 40 : 0);
  for (const f of sideFigs(t, side)) {
    const d = cost(f);
    if (d < bestD) { bestD = d; best = f.i; }
  }
  if (cur != null && cur !== best) {
    const c = cost(figOf(t, side, cur));
    if (c < bestD + 85) return cur;
  }
  return best;
}

// a shot: the player spins his stick through the puck toward (dx, dy). If the puck isn't on his stick yet, the swing
// waits a moment for it, which is how a one-timer works: swing as the pass arrives.
// 'late' is for a shot from the other phone online: it was aimed at a table a moment old, so it gets a longer window and
// a little more reach to find the puck
export function shoot(t: Table, f: Fig, dx: number, dy: number, power: number, tap = false, late = 0) {
  const d = Math.hypot(dx, dy) || 1;
  f.shot = { dx: dx / d, dy: dy / d, power: clamp(power, 500, MAX_PUCK), until: t.clock + 0.22 + late, tap, extra: late ? 45 : 0 };
  // which way the stick spins: the way that brings the blade through the puck toward the target
  const toPuck = Math.atan2(t.puck.y - f.y, t.puck.x - f.x);
  const cross = Math.cos(toPuck) * (dy / d) - Math.sin(toPuck) * (dx / d);
  f.spinDir = cross >= 0 ? 1 : -1;
  f.swing = SWING;
  f.held = 0; f.cool = 0.25;
}

const sh0 = (f: Fig) => f.shot?.extra ?? 0;

// where a puck going (vx, vy) from (x, y) crosses a goal line (y = lineY), boards ignored; null if it isn't going there
export function crossX(x: number, y: number, vx: number, vy: number, lineY: number): number | null {
  if (Math.abs(vy) < 1 || (lineY - y) * vy <= 0) return null;
  const k = (lineY - y) / vy;
  return x + vx * k;
}
// is a shot from (x, y) toward (dx, dy) on the net side 'into' defends
export function onNet(x: number, y: number, dx: number, dy: number, into: Side) {
  const lineY = into === 1 ? 0 : H;
  const cx = crossX(x, y, dx, dy, lineY);
  return cx != null && cx > GOAL_X0 - 4 && cx < GOAL_X1 + 4;
}

function moveFig(f: Fig, h: number) {
  f.tt = clamp(f.tt, 0, f.len);
  const d = f.tt - f.t, step = f.speed * h;
  const mv = Math.abs(d) <= step ? d : Math.sign(d) * step;
  f.t += mv;
  const nx = f.ax + f.ux * f.t, ny = f.ay + f.uy * f.t;
  f.vx = (nx - f.x) / h; f.vy = (ny - f.y) / h;
  f.x = nx; f.y = ny;
  // the stick: spinning through a shot, or turning to face where it's told (the puck, by default)
  const was = f.th;
  if (f.swing > 0) {
    f.swing -= h;
    f.th = wrap(f.th + f.spinDir * (Math.PI * 2.2 / SWING) * h);
  } else if (f.tth != null) {
    const da = wrap(f.tth - f.th), maxA = SPIN * h;
    f.th = wrap(f.th + clamp(da, -maxA, maxA));
  }
  f.w = wrap(f.th - was) / h;
  f.cool = Math.max(0, f.cool - h);
  f.ghost = Math.max(0, f.ghost - h);
}

// the puck against a circle that moves (a player's body)
function hitCircle(p: Body, cx: number, cy: number, cvx: number, cvy: number, r: number, e: number): number {
  const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
  if (d >= r + PUCK_R || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  p.x = cx + nx * (r + PUCK_R); p.y = cy + ny * (r + PUCK_R);
  const rvx = p.vx - cvx, rvy = p.vy - cvy, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny;
  return -vn;
}

// the puck against a player's stick: a blade that sweeps round him, carrying its speed into the puck where they meet
function hitStick(p: Body, f: Fig): number {
  const ex = f.x + Math.cos(f.th) * STICK, ey = f.y + Math.sin(f.th) * STICK;
  const sx = ex - f.x, sy = ey - f.y, l2 = sx * sx + sy * sy;
  const k = clamp(((p.x - f.x) * sx + (p.y - f.y) * sy) / l2, BODY_R / STICK, 1);
  const qx = f.x + sx * k, qy = f.y + sy * k;
  const dx = p.x - qx, dy = p.y - qy, d = Math.hypot(dx, dy);
  if (d >= BLADE_R + PUCK_R || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  p.x = qx + nx * (BLADE_R + PUCK_R); p.y = qy + ny * (BLADE_R + PUCK_R);
  // the blade's own speed at that point: the player sliding plus the stick turning
  const rx = qx - f.x, ry = qy - f.y;
  const bvx = f.vx - f.w * ry, bvy = f.vy + f.w * rx;
  const rvx = p.vx - bvx, rvy = p.vy - bvy, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + STICK_E) * vn * nx; p.vy -= (1 + STICK_E) * vn * ny;
  return -vn;
}

function capSpeed(p: Body) {
  const s = speed(p);
  if (s > MAX_PUCK) { p.vx *= MAX_PUCK / s; p.vy *= MAX_PUCK / s; }
}

function bounceOffPoint(p: Body, cx: number, cy: number, reach: number, out: TableEvent[], inside: boolean, post: boolean) {
  const dx = p.x - cx, dy = p.y - cy;
  const d = Math.hypot(dx, dy) || 0.0001;
  if (inside ? d <= reach : d >= reach) return;
  const nx = (inside ? -dx : dx) / d, ny = (inside ? -dy : dy) / d;
  const fix = inside ? d - reach : reach - d;
  p.x += nx * fix; p.y += ny * fix;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) {
    p.vx -= (1 + WALL_E) * vn * nx; p.vy -= (1 + WALL_E) * vn * ny;
    if (-vn > 120) out.push({ kind: 'wall', power: -vn, post });
  }
}

function boards(t: Table, out: TableEvent[], goals: boolean) {
  const p = t.puck, r = PUCK_R;
  const inMouth = p.x > GOAL_X0 + r * 0.2 && p.x < GOAL_X1 - r * 0.2;
  if (p.x < r) { p.x = r; if (p.vx < 0) { if (-p.vx > 120) out.push({ kind: 'wall', power: -p.vx, post: false }); p.vx = -p.vx * WALL_E; } }
  if (p.x > W - r) { p.x = W - r; if (p.vx > 0) { if (p.vx > 120) out.push({ kind: 'wall', power: p.vx, post: false }); p.vx = -p.vx * WALL_E; } }
  for (const end of [0, 1] as Side[]) {
    const lineY = end === 1 ? 0 : H;
    const past = end === 1 ? p.y < lineY + r : p.y > lineY - r;
    if (!past) continue;
    if (inMouth) {
      // in once the whole puck is over the line
      const inNet = end === 1 ? p.y < lineY - r : p.y > lineY + r;
      if (inNet) {
        if (goals) {
          // an own goal: the defending side played it last and nobody on the other side touched it since
          const own = t.last != null && t.last.side === end && (t.touch == null || t.touch.side === end);
          out.push({ kind: 'goal', into: end, own, by: t.last });
          return;
        }
        // the online guest waits to be told: hold it in the back of the net
        p.y = end === 1 ? lineY - r : lineY + r; p.vx = 0; p.vy = 0;
      }
      // the back and sides of the net
      const back = end === 1 ? -GOAL_D + r : H + GOAL_D - r;
      if (end === 1 ? p.y < back : p.y > back) { p.y = back; p.vy = -p.vy * 0.2; }
      continue;
    }
    p.y = end === 1 ? lineY + r : lineY - r;
    const into = end === 1 ? -p.vy : p.vy;
    if (into > 0) { if (into > 120) out.push({ kind: 'wall', power: into, post: false }); p.vy = -p.vy * WALL_E; }
  }
  for (const end of [0, 1]) {
    const y = end === 1 ? 0 : H;
    bounceOffPoint(p, GOAL_X0, y, r + 6, out, false, true);
    bounceOffPoint(p, GOAL_X1, y, r + 6, out, false, true);
  }
  const c = CORNER_R, reach = CORNER_R - r;
  for (const [cx, cy] of [[c, c], [W - c, c], [c, H - c], [W - c, H - c]]) {
    const inCorner = (cx < W / 2 ? p.x < cx : p.x > cx) && (cy < H / 2 ? p.y < cy : p.y > cy);
    if (inCorner) bounceOffPoint(p, cx, cy, reach, out, true, false);
  }
}

export interface StepOptions {
  goals?: boolean;                 // this phone calls goals (always, but for the online guest)
  puck?: boolean;                  // this phone moves the puck at all
}

// advance the table by dt seconds and say what happened
export function step(t: Table, dt: number, o: StepOptions = {}): TableEvent[] {
  const out: TableEvent[] = [];
  const goals = o.goals ?? true, movePuck = o.puck ?? true;
  const h = Math.min(dt, 1 / 20) / SUBSTEPS;
  const drag = Math.exp(-DRAG * h);
  const p = t.puck;
  for (let s = 0; s < SUBSTEPS; s++) {
    t.clock += h;
    for (const f of t.figs) {
      // every player turns with the puck: the one cradling it points his blade at it, the rest hold the stick out to
      // their forehand side of it, so a puck coming at them meets the blade rather than sliding down the shaft
      if (f.swing <= 0) {
        const a = Math.atan2(p.y - f.y, p.x - f.x);
        f.tth = t.holder === f ? a : wrap(a + (f.side === 0 ? 0.7 : -0.7));
      }
      moveFig(f, h);
    }
    if (!movePuck) continue;

    // a shot asked for goes the moment the puck is on the stick
    for (const f of t.figs) {
      if (!f.shot) continue;
      if (t.clock > f.shot.until) { f.shot = null; continue; }
      if (!inReach(f, p, 6 + sh0(f))) continue;
      const sh = f.shot;
      f.shot = null;
      const pw = sh.power * (0.97 + Math.random() * 0.06);
      p.vx = sh.dx * pw; p.vy = sh.dy * pw;
      // out in front of the blade, so the body doesn't swallow it
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d < BODY_R + PUCK_R + 4) { p.x = f.x + sh.dx * (BODY_R + PUCK_R + 6); p.y = f.y + sh.dy * (BODY_R + PUCK_R + 6); }
      t.last = { side: f.side, i: f.i }; t.touch = t.last;
      t.holder = null;
      f.swing = Math.max(f.swing, SWING * 0.6);
      f.ghost = 0.16;
      out.push({ kind: 'hit', side: f.side, i: f.i, power: pw, shot: true });
      out.push({ kind: 'shot', side: f.side, i: f.i, onNet: onNet(p.x, p.y, p.vx, p.vy, otherSide(f.side)), power: pw });
    }

    // the cradle: a player told to carry it, with the puck on his blade and not flying past, keeps it there
    let holder: Fig | null = null;
    for (const f of t.figs) {
      if (!f.carry || f.cool > 0 || f.swing > 0) { if (t.holder === f) t.holder = null; f.held = 0; continue; }
      const rvx = p.vx - f.vx, rvy = p.vy - f.vy;
      if (inReach(f, p, 4) && Math.hypot(rvx, rvy) < 900 && (!holder || f === t.holder)) holder = f;
    }
    if (holder) {
      if (t.holder !== holder) holder.held = 0;
      holder.held += h;
      if (holder.held > HOLD_MAX) {
        // it rolls off the blade, a little forward
        holder.cool = 0.6; holder.held = 0; t.holder = null;
        p.vx += (holder.side === 0 ? 0 : 0) + (Math.random() - 0.5) * 160; p.vy += holder.side === 0 ? -260 : 260;
      } else {
        t.holder = holder;
        const a = Math.atan2(p.y - holder.y, p.x - holder.x);
        const bx = holder.x + Math.cos(a) * (STICK - 14), by = holder.y + Math.sin(a) * (STICK - 14);
        p.vx = holder.vx + (bx - p.x) * 18; p.vy = holder.vy + (by - p.y) * 18;
        t.last = { side: holder.side, i: holder.i }; t.touch = t.last;
      }
    } else t.holder = null;

    p.x += p.vx * h; p.y += p.vy * h;
    if (!t.holder) { p.vx *= drag; p.vy *= drag; }

    // the boards are banked a touch along the sides and in the corners, so a dead puck rolls back into play
    const edge = 70;
    if (!t.holder) {
      if (p.x < edge) p.vx += 300 * h; else if (p.x > W - edge) p.vx -= 300 * h;
      if (p.y < edge && (p.x < GOAL_X0 || p.x > GOAL_X1)) p.vy += 300 * h;
      else if (p.y > H - edge && (p.x < GOAL_X0 || p.x > GOAL_X1)) p.vy -= 300 * h;
    }

    // bodies and sticks
    for (const f of t.figs) {
      if (t.holder === f || f.ghost > 0) continue;
      const bp = hitCircle(p, f.x, f.y, f.vx, f.vy, BODY_R, BODY_E);
      const sp = hitStick(p, f);
      const pw = Math.max(bp, sp);
      if (pw > 0) {
        // a stick on a puck held by the other side knocks it loose
        if (t.holder && t.holder.side !== f.side) { t.holder.cool = 0.5; t.holder.held = 0; t.holder = null; }
        if (pw > 40) {
          // a deflection doesn't change who played it: a shot that goes in off a defender is the shooter's goal
          if (!t.last) t.last = { side: f.side, i: f.i };
          t.touch = { side: f.side, i: f.i };
          out.push({ kind: 'hit', side: f.side, i: f.i, power: pw, shot: false });
        }
      }
    }
    capSpeed(p);
    boards(t, out, goals);
    if (out.some((e) => e.kind === 'goal')) break;
  }
  t.hist.push({ t: t.clock, x: p.x, y: p.y });
  while (t.hist.length > 2 && t.clock - t.hist[0].t > 0.5) t.hist.shift();
  return out;
}

// where the puck was 'lag' seconds ago (the goalies react to what they saw, not what is)
export function seen(t: Table, lag: number) {
  const at = t.clock - lag;
  for (let i = t.hist.length - 1; i >= 0; i--) if (t.hist[i].t <= at) return t.hist[i];
  return t.hist[0] ?? { t: t.clock, x: t.puck.x, y: t.puck.y };
}

// the players nobody is running: the goalie follows the puck across his crease; the others drift with it along their
// slots, slower, so a side always has someone in the way. Both sides play by the same rule.
export function autoPlay(t: Table, side: Side, active: number | null, goalieSpeed: number, goalieLag: number, support = 300) {
  const p = t.puck;
  for (const f of sideFigs(t, side)) {
    f.carry = f.i === active ? f.carry : false;
    if (f.i === active) continue;
    if (f.role === 'G') {
      const s = seen(t, goalieLag);
      f.speed = goalieSpeed;
      f.tt = along(f, s.x, f.y);
    } else {
      f.speed = support;
      f.tt = along(f, p.x, p.y);
    }
  }
}
