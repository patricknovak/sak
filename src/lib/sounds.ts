// Draft night sounds, synthesized with WebAudio so there's nothing to download: a goal horn when a pick
// lands (or it's your turn), ticks in the last ten seconds. Off by default on phones, on for the TV board.
const KEY = 'sak-sounds';
let ctx: AudioContext | null = null;
const ac = () => {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
};

export const soundsOn = (fallback = false) => { try { const v = localStorage.getItem(KEY); return v == null ? fallback : v === '1'; } catch { return fallback; } };
export const setSounds = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ } if (on) unlockAudio(); };
// browsers only let audio start after a tap; call this from any click handler
export const unlockAudio = () => { ac(); };

function tone(c: AudioContext, type: OscillatorType, freq: number, t0: number, dur: number, gain: number, glide?: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}

// arena goal horn: a fat detuned chord that swells, then a fade
export function horn(big = false) {
  const c = ac(); if (!c) return;
  const t = c.currentTime, dur = big ? 2.2 : 1.2;
  for (const [f, g] of [[146.8, 0.16], [220, 0.12], [293.7, 0.1], [369.9, 0.06]] as [number, number][]) {
    tone(c, 'sawtooth', f, t, dur, g); tone(c, 'sawtooth', f * 1.006, t, dur, g * 0.7); tone(c, 'square', f / 2, t, dur, g * 0.35);
  }
}
// clock tick under ten seconds (higher and sharper in the last three)
export function tick(urgent = false) {
  const c = ac(); if (!c) return;
  tone(c, 'square', urgent ? 1320 : 880, c.currentTime, urgent ? 0.09 : 0.06, urgent ? 0.12 : 0.07);
}
// short "the pick is in" sting
export function sting() {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  tone(c, 'triangle', 523, t, 0.12, 0.15); tone(c, 'triangle', 659, t + 0.1, 0.12, 0.15); tone(c, 'triangle', 784, t + 0.2, 0.3, 0.18);
}
// buzzer when the clock runs out
export function buzzer() {
  const c = ac(); if (!c) return;
  tone(c, 'square', 180, c.currentTime, 0.9, 0.14); tone(c, 'sawtooth', 183, c.currentTime, 0.9, 0.1);
}
