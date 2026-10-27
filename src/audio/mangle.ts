/**
 * Mangling a sound, the resampling producer's way: tape speed (pitch and length together), pitch
 * without changing the length, a time stretch, stutter (the start of every beat repeated at 1/8,
 * 1/16 or 1/32), chop and shuffle (cells in a seeded new order), a gate pattern, bitcrush and
 * downsample, and a formant shift (the voice's size, not its pitch). Each works on plain arrays,
 * one per channel, and gives a new sound back levelled to the one it came from (never louder at
 * its peak), so nothing jumps out at the ears. The edits that use them are in mangleActions.ts.
 * Plain maths, so Node can unit-test it.
 */
import { lowpass, pitchShiftChannels } from './pitchShift';
import { stretchChannels } from './timeStretch';
import { detectPeriod, monoOf } from './plugins/userTable';

export type Channels = Float32Array[];

/** What can be done, with its settings. */
export type MangleOp =
  | { kind: 'tape'; semitones: number }
  | { kind: 'pitch'; semitones: number }
  | { kind: 'stretch'; factor: number }
  | { kind: 'stutter'; cell: number; beat: number }
  | { kind: 'shuffle'; cell: number; seed: number }
  | { kind: 'gate'; step: number; pattern: readonly boolean[] }
  | { kind: 'crush'; bits: number; downsample: number }
  | { kind: 'formant'; semitones: number };

/** Gate patterns, 16 steps each ("x" open). */
export const GATE_PATTERNS: Record<string, string> = {
  Trance: 'x.xx.xx.x.xx.xxx',
  Offbeat: '..x...x...x...x.',
  Chop: 'xx.xxx.xx.x.xxx.',
  Half: 'xxxxxxxx........',
};

/** Fade at every cut, seconds: short enough to keep the hits, long enough not to click. */
const EDGE = 0.002;

/** A seeded random number generator (mulberry32): the same seed, the same order. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const peakOf = (chs: Channels) => chs.reduce((m, ch) => ch.reduce((n, v) => Math.max(n, Math.abs(v)), m), 0);
const rmsOf = (chs: Channels) => {
  let sum = 0;
  let n = 0;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) {
    sum += ch[i] * ch[i];
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
};

/**
 * `out` turned to the loudness (RMS) of `input`, but with its peak no higher than the input's:
 * a crushed or gated copy comes back about as loud, never with a sudden jump.
 */
export function levelLike(out: Channels, input: Channels): Channels {
  const target = rmsOf(input);
  const now = rmsOf(out);
  if (!(now > 1e-9) || !(target > 0)) return out;
  let g = target / now;
  const peak = peakOf(out) * g;
  const ceiling = Math.max(1e-6, peakOf(input));
  if (peak > ceiling) g *= ceiling / peak;
  return out.map((ch) => ch.map((v) => v * g));
}

/** Cubic (Catmull-Rom) read of `x` at the fractional index `t` (silence outside it). */
function cubicAt(x: Float32Array, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const at = (k: number) => (k >= 0 && k < x.length ? x[k] : 0);
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Tape speed: played 2^(semitones/12) times as fast, so higher and shorter (or lower and longer). */
export function tape(input: Channels, semitones: number, sampleRate: number): Channels {
  const speed = 2 ** (semitones / 12);
  const length = Math.max(1, Math.round((input[0]?.length ?? 0) / speed));
  return input.map((ch) => {
    // Faster folds what's over the new Nyquist back down: take it off first
    const src = speed > 1 ? lowpass(ch, (0.45 * sampleRate) / speed, sampleRate) : ch;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = cubicAt(src, i * speed);
    return out;
  });
}

/** Cut `input` into cells of `cell` samples and put them back in the order `order` gives, a short fade at each join. */
function rearranged(input: Channels, cell: number, order: (k: number, cells: number) => number, sampleRate: number): Channels {
  const length = input[0]?.length ?? 0;
  const cells = Math.ceil(length / cell);
  const edge = Math.min(Math.floor(cell / 4), Math.round(EDGE * sampleRate));
  return input.map((ch) => {
    const out = new Float32Array(length);
    for (let k = 0; k < cells; k++) {
      const from = order(k, cells) * cell;
      const at = k * cell;
      const n = Math.min(cell, length - at, length - from);
      for (let i = 0; i < n; i++) {
        let g = 1;
        if (i < edge) g = i / edge;
        else if (n - i <= edge) g = (n - i) / edge;
        out[at + i] = ch[from + i] * g;
      }
    }
    return out;
  });
}

/** Stutter: the first `cell` samples of every `beat` samples repeated through the beat. */
export function stutter(input: Channels, cell: number, beat: number, sampleRate: number): Channels {
  const c = Math.max(16, Math.round(cell));
  const per = Math.max(1, Math.round(beat / c));
  return rearranged(input, c, (k) => k - (k % per), sampleRate);
}

/** Chop into cells of `cell` samples and play them in a new order, the same for the same seed (the first cell stays first). */
export function shuffle(input: Channels, cell: number, seed: number, sampleRate: number): Channels {
  const c = Math.max(16, Math.round(cell));
  const cells = Math.ceil((input[0]?.length ?? 0) / c);
  // (The last cell may be short: only whole cells move)
  const whole = Math.floor((input[0]?.length ?? 0) / c);
  const order = Array.from({ length: cells }, (_, i) => i);
  const rnd = seededRandom(seed);
  for (let i = whole - 1; i > 1; i--) {
    const j = 1 + Math.floor(rnd() * i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return rearranged(input, c, (k) => order[k], sampleRate);
}

/** A gate: open on the pattern's "on" steps (each `step` samples long, the pattern repeating), closed on the rest. */
export function gate(input: Channels, step: number, pattern: readonly boolean[], sampleRate: number): Channels {
  const s = Math.max(16, Math.round(step));
  const ramp = Math.min(Math.floor(s / 4), Math.round(0.003 * sampleRate));
  const length = input[0]?.length ?? 0;
  const env = new Float32Array(length);
  let g = 0;
  for (let i = 0; i < length; i++) {
    const open = pattern.length ? pattern[Math.floor(i / s) % pattern.length] : true;
    const target = open ? 1 : 0;
    g += Math.sign(target - g) * Math.min(Math.abs(target - g), 1 / Math.max(1, ramp));
    env[i] = g;
  }
  return input.map((ch) => ch.map((v, i) => v * env[i]));
}

/** Bitcrush and downsample: `bits` (2 to 16) of level, each value held for `downsample` samples. */
export function crush(input: Channels, bits: number, downsample: number): Channels {
  const steps = 2 ** (Math.max(2, Math.min(16, Math.round(bits))) - 1);
  const hold = Math.max(1, Math.round(downsample));
  return input.map((ch) => {
    const out = new Float32Array(ch.length);
    let held = 0;
    for (let i = 0; i < ch.length; i++) {
      if (i % hold === 0) held = Math.round(ch[i] * steps) / steps;
      out[i] = held;
    }
    return out;
  });
}

/**
 * Formant shift: the sound's resonances (a voice's size) move `semitones` while its pitch and
 * length stay. Pitch-synchronous: grains two periods long, read 2^(semitones/12) times as fast
 * (which moves the resonances), laid down a period apart as they were (which keeps the pitch).
 * The period is the one found in the sound, or 8 ms where nothing repeats clearly.
 */
export function formant(input: Channels, semitones: number, sampleRate: number): Channels {
  const length = input[0]?.length ?? 0;
  if (!length || Math.abs(semitones) < 1e-3) return input.map((ch) => ch.slice());
  const ratio = 2 ** (semitones / 12);
  const period = detectPeriod(monoOf(input), sampleRate) ?? 0.008 * sampleRate;
  const half = Math.max(8, Math.round(period));
  const grain = 2 * half;
  const win = Float32Array.from({ length: grain }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / grain));
  return input.map((ch) => {
    const src = ratio > 1 ? lowpass(ch, (0.45 * sampleRate) / ratio, sampleRate) : ch;
    const out = new Float32Array(length);
    const norm = new Float32Array(length);
    for (let c = -half; c < length; c += half) {
      for (let i = 0; i < grain; i++) {
        const at = c + i;
        if (at < 0 || at >= length) continue;
        // The grain, centred on c + half, read faster or slower about its centre
        const t = c + half + (i - half) * ratio;
        out[at] += cubicAt(src, t) * win[i];
        norm[at] += win[i];
      }
    }
    for (let i = 0; i < length; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
    return out;
  });
}

/** Do `op` to `input`, levelled to it (see levelLike). */
export function mangle(input: Channels, op: MangleOp, sampleRate: number): Channels {
  let out: Channels;
  switch (op.kind) {
    case 'tape':
      out = tape(input, op.semitones, sampleRate);
      break;
    case 'pitch':
      out = pitchShiftChannels(input, op.semitones, sampleRate);
      break;
    case 'stretch':
      out = stretchChannels(input, 1 / Math.max(0.25, Math.min(4, op.factor)), sampleRate);
      break;
    case 'stutter':
      out = stutter(input, op.cell, op.beat, sampleRate);
      break;
    case 'shuffle':
      out = shuffle(input, op.cell, op.seed, sampleRate);
      break;
    case 'gate':
      out = gate(input, op.step, op.pattern, sampleRate);
      break;
    case 'crush':
      out = crush(input, op.bits, op.downsample);
      break;
    case 'formant':
      out = formant(input, op.semitones, sampleRate);
      break;
  }
  return levelLike(out, input);
}

/** How much longer (or shorter) `op` makes a sound: 1 for most. */
export function lengthFactor(op: MangleOp): number {
  if (op.kind === 'tape') return 1 / 2 ** (op.semitones / 12);
  if (op.kind === 'stretch') return Math.max(0.25, Math.min(4, op.factor));
  return 1;
}

/** A few words for what `op` did, for the clip's name and its editor. */
export function mangleLabel(op: MangleOp): string {
  const st = (n: number) => `${n > 0 ? '+' : ''}${n}`;
  const note = (samplesPerBeat: number, cell: number) => `1/${Math.round((4 * samplesPerBeat) / cell)}`;
  switch (op.kind) {
    case 'tape':
      return op.semitones === -12 ? 'half speed' : op.semitones === 12 ? 'double speed' : `tape ${st(op.semitones)}`;
    case 'pitch':
      return `pitch ${st(op.semitones)}`;
    case 'stretch':
      return `stretch ×${op.factor}`;
    case 'stutter':
      return `stutter ${note(op.beat, op.cell)}`;
    case 'shuffle':
      return 'shuffled';
    case 'gate':
      return 'gated';
    case 'crush':
      return 'crushed';
    case 'formant':
      return `formant ${st(op.semitones)}`;
  }
}
