// The computer across the table in Rod Hockey. It runs one player at a time, the one nearest the puck, the way a
// person does: slide him to the puck, maybe cradle it a moment to change the angle, then shoot for the corner the
// goalie isn't covering, or move it up to a forward. Every level is the same brain with slower hands, slower eyes and a
// shakier aim, and its goalie reacts later.
import {
  GOAL_X0, GOAL_X1, H, REACH, W, along, autoPlay, figOf, inReach, pickActive, shoot, sideFigs, speed,
  type Fig, type Side, type Table,
} from './physics.ts';

export type Level = 'beer' | 'junior' | 'pro' | 'legend';
export interface LevelInfo {
  key: Level; name: string; who: string; emoji: string; blurb: string;
  hands: number;      // how fast it slides its player, units a second
  react: number;      // seconds the puck sits on its stick before it does anything with it
  aim: number;        // how far off a shot can go at the goal line, units
  power: number;      // shot speed, units a second
  goalie: number;     // its goalie's speed across the crease
  glag: number;       // how late its goalie reads the puck, seconds
  dangle: number;     // the chance it cradles the puck to change the angle before shooting
  pass: number;       // the chance a defenceman moves it up to a forward rather than firing from the point
  support: number;    // how quickly the players it isn't running drift into the puck's way
}

export const LEVELS: LevelInfo[] = [
  { key: 'beer', name: 'Beer league', who: 'Sunday Night Stan', emoji: '🍺', blurb: 'Slow hands, big heart. Shoots it at the logo.', hands: 520, react: 0.5, aim: 150, power: 1500, goalie: 200, glag: 0.3, dangle: 0, pass: 0.1, support: 170 },
  { key: 'junior', name: 'Junior', who: 'The Prospect', emoji: '🎒', blurb: 'Quick hands, finds the corners now and then.', hands: 800, react: 0.32, aim: 95, power: 1900, goalie: 330, glag: 0.2, dangle: 0.15, pass: 0.3, support: 230 },
  { key: 'pro', name: 'Pro', who: 'The Grinder', emoji: '🥅', blurb: 'Moves it up, changes the angle, picks the open side.', hands: 1150, react: 0.2, aim: 55, power: 2400, goalie: 500, glag: 0.12, dangle: 0.4, pass: 0.5, support: 290 },
  { key: 'legend', name: 'Legend', who: 'The Wizard', emoji: '👑', blurb: 'Dangles, one-times, goes bar down. Beat this and it’s yours to brag about.', hands: 1500, react: 0.1, aim: 26, power: 2900, goalie: 620, glag: 0.08, dangle: 0.6, pass: 0.6, support: 340 },
];
export const levelOf = (k: string | null | undefined) => LEVELS.find((l) => l.key === k) ?? LEVELS[1];

export interface Brain {
  level: LevelInfo; side: Side; active: number | null;
  onStick: number;        // since when the puck has been on its active player's stick (0: it isn't)
  plan: 'shoot' | 'dangle' | 'pass' | null; until: number; dangleTo: number;
}
export const newBrain = (level: LevelInfo, side: Side = 1): Brain => ({ level, side, active: null, onStick: 0, plan: null, until: 0, dangleTo: 0 });

const rand = (a: number) => (Math.random() * 2 - 1) * a;
const forward = (f: Fig) => f.role === 'C' || f.role === 'LW' || f.role === 'RW';

// where it aims on the goal it's shooting at: the side the goalie isn't on, give or take its aim
function target(t: Table, side: Side, L: LevelInfo): [number, number] {
  const into: Side = side === 0 ? 1 : 0;
  const g = figOf(t, into, 0);
  const lineY = into === 1 ? 0 : H;
  const far = g.x < W / 2 ? GOAL_X1 - 30 : GOAL_X0 + 30;
  const near = g.x < W / 2 ? GOAL_X0 + 30 : GOAL_X1 - 30;
  // mostly the open side; now and then the near post, to keep a goalie honest
  const x = (Math.random() < 0.8 ? far : near) + rand(L.aim);
  return [x, lineY];
}

// run the computer's side for this frame
export function think(b: Brain, t: Table, now: number) {
  const L = b.level, side = b.side, p = t.puck;
  b.active = pickActive(t, side, b.active);
  autoPlay(t, side, b.active, L.goalie, L.glag, L.support);
  const f = figOf(t, side, b.active);
  f.speed = L.hands;

  // slide to where the puck will be in a moment (a better level reads further ahead)
  const ahead = 0.04 + (L.hands / 1500) * 0.14;
  const px = p.x + p.vx * ahead, py = p.y + p.vy * ahead;
  if (b.plan === 'dangle' && t.holder === f) f.tt = b.dangleTo;
  else f.tt = along(f, px, py);

  const on = inReach(f, p);
  if (!on) { b.onStick = 0; b.plan = null; f.carry = false; return; }
  if (!b.onStick) {
    b.onStick = now;
    // what to do with it, decided once it's on the stick
    const r = Math.random();
    b.plan = !forward(f) && r < L.pass ? 'pass' : speed(p) < 700 && Math.random() < L.dangle ? 'dangle' : 'shoot';
    if (b.plan === 'dangle') {
      // slide it a little along the slot to open an angle, then let it go
      b.dangleTo = Math.max(0, Math.min(f.len, f.t + (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 120)));
      b.until = now + 0.35 + Math.random() * 0.45;
    }
  }
  if (b.plan === 'dangle') {
    f.carry = true;
    if (now < b.until && t.holder === f) return;
    if (now < b.until && now - b.onStick < 0.25) return;      // still gathering it
    b.plan = 'shoot';
  }
  f.carry = false;
  if (now - b.onStick < L.react || f.shot || f.swing > 0) return;
  if (b.plan === 'pass') {
    // up to the forward with the most room ahead of him
    const fwd = sideFigs(t, side).filter(forward).sort((a, c) => (side === 1 ? c.y - a.y : a.y - c.y))[Math.floor(Math.random() * 2)];
    if (fwd && Math.hypot(fwd.x - f.x, fwd.y - f.y) > REACH * 1.5) {
      shoot(t, f, fwd.x + rand(L.aim * 0.6) - p.x, fwd.y - p.y, L.power * 0.7);
      b.plan = null; b.onStick = now + 0.45;
      return;
    }
  }
  const [tx, ty] = target(t, side, L);
  shoot(t, f, tx - p.x, ty - p.y, L.power * (0.9 + Math.random() * 0.15));
  // a breath before it shoots again: a person can't fire the rebound back the same instant either
  b.plan = null; b.onStick = now + 0.45;
}
