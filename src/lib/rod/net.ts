// Rod Hockey online (8 November 2026). Nothing is stored while it's played: a challenge goes over Rink Duel's lobby
// (lib/rink/net.ts, the invite naming its game 'rod'), and a match is its own realtime topic,
// 'rod:<league>:<match id>', with presence (who's at the table) and the play itself.
//
// The play: the challenger's phone (side 0) runs the table. Twelve players and a puck all moving at once can't be
// split between two phones the way Rink Duel's two paddles are, so one phone keeps the truth and the other sends what
// its thumb is doing: which player it's running, where on his slot it wants him, whether it's cradling, and each shot.
// The challenger's phone sends the whole table back twenty times a second; the other phone draws it a moment behind,
// smoothly, with its own player moving under its thumb at once.

export type RodPhase = 'wait' | 'count' | 'play' | 'goal' | 'paused' | 'over' | 'gone' | 'taken';

// the table, from the phone that runs it
export interface RodState {
  f: number[];                     // each player: where on his slot (whole units) and his stick's angle (hundredths)
  p: [number, number, number, number];
  sc: [number, number];
  sh: [number, number];            // shots on goal
  ph: RodPhase;
  a: [number, number];             // the player each side is running
  hd: number;                      // who's cradling the puck (-1: nobody)
  ev?: number[];                   // what just happened, for the sound: kind (0 hit, 1 boards, 2 post), side, power
}
// the other phone's thumb
export interface RodInput { a: number; tt: number; on: boolean; c: boolean }

export type RodMsg =
  | { type: 'take'; guest: number }
  | { type: 'goal'; by: 0 | 1; kmh: number; own: boolean; sc: [number, number]; kind: GoalKind }
  | { type: 'shot'; id: number; a: number; dx: number; dy: number; p: number; tap: boolean }
  | { type: 'again'; from: number }
  | { type: 'bye'; from: number };

export type GoalKind = 'goal' | 'one-timer' | 'bar-down' | 'snipe' | 'wraparound';
