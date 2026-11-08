// Rink Duel's sound, made on the phone (no files to load): the clack of a hit, the boards, the horn, the buzzer.
// Every sound is a few oscillators and a burst of noise; muting is remembered on this phone.

const KEY = 'rink-mute';
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
export const muted = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setMuted = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window */ } };

// a phone only plays sound once a tap has started it
export function wake() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* no audio */ }
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', at = 0, slide?: number) {
  if (!ctx || muted()) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function burst(dur: number, gain: number, cutoff: number, at = 0) {
  if (!ctx || !noise || muted()) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = 'bandpass'; f.frequency.value = cutoff; f.Q.value = 1.4;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(ctx.destination);
  s.start(t); s.stop(t + dur);
}

const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* no vibration */ } };

export const sfx = {
  // the clack: louder and brighter the harder it's hit
  hit(power: number, mine: boolean) {
    const p = Math.min(1, power / 2600);
    burst(0.06, 0.25 + p * 0.5, 2200 + p * 2600);
    tone(320 + p * 420, 0.07, 0.08 + p * 0.12, 'triangle');
    if (mine) buzz(p > 0.6 ? 22 : 10);
  },
  wall(power: number) {
    const p = Math.min(1, power / 2600);
    burst(0.09, 0.12 + p * 0.3, 700 + p * 600);
    tone(110 + p * 60, 0.1, 0.05 + p * 0.08, 'sine');
  },
  // the goal horn: a low, wide chord that swells and holds
  horn() {
    [146.8, 185, 220, 293.7].forEach((f, i) => tone(f, 1.6, 0.09 - i * 0.012, 'sawtooth', 0, f * 0.985));
    burst(0.5, 0.25, 900, 0.02);
    buzz([90, 50, 140]);
  },
  // scored on: a short, sour buzzer
  against() {
    tone(98, 0.55, 0.12, 'square', 0, 82);
    buzz(160);
  },
  beep(last = false) { tone(last ? 1175 : 784, last ? 0.32 : 0.14, 0.14, 'square'); },
  fire() { tone(220, 0.5, 0.08, 'sawtooth', 0, 880); burst(0.4, 0.2, 3000); },
  // Rod Hockey: the ring of the post, the whip of a stick spinning through, the crowd, a big save
  post() { tone(1568, 0.5, 0.12, 'sine', 0, 1480); tone(2349, 0.35, 0.05, 'sine'); buzz(25); },
  swing(power: number) { const p = Math.min(1, power / 3000); burst(0.12, 0.08 + p * 0.18, 1400 + p * 2400); },
  crowd() { burst(0.5, 0.18, 600, 0.05); burst(1.1, 0.12, 900, 0.25); burst(0.9, 0.08, 1300, 0.6); },
  save() { burst(0.07, 0.35, 900); tone(140, 0.12, 0.12, 'triangle'); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 0.12, 'triangle', i * 0.12)); buzz([40, 40, 40, 40, 120]); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.32, 0.1, 'triangle', i * 0.16)); },
};
