/**
 * Re-pitching a recording without changing its length, for moving a sample into the song's key:
 * time-stretch it (timeStretch.ts, same pitch) by the pitch ratio, then read the stretched copy
 * back at that ratio, which puts the length back and moves the pitch. Plain arrays, so Node can
 * unit-test it.
 */
import { stretchChannels } from './timeStretch';

/** Cubic (Catmull-Rom) read of `x` at the fractional index `t`. */
function cubicAt(x: Float32Array, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const at = (k: number) => x[Math.max(0, Math.min(x.length - 1, k))];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * `input` (one array per channel) moved `semitones` up (or down, negative), as long as it was.
 * Fractions of a semitone work too (a sample 20 cents flat moves +0.2).
 */
export function pitchShiftChannels(input: readonly Float32Array[], semitones: number, sampleRate: number): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || Math.abs(semitones) < 1e-4) return input.map((ch) => ch.slice());
  const ratio = 2 ** (semitones / 12);
  // `ratio` times as long at the same pitch (stretchChannels plays 1/ratio times as fast)...
  const long = stretchChannels(input, 1 / ratio, sampleRate);
  // ...then read `ratio` times as fast: the original length, `ratio` times the pitch. Reading
  // faster folds anything over the new Nyquist back down, so take it off first
  return long.map((ch) => {
    const src = ratio > 1 ? lowpass(ch, (0.45 * sampleRate) / ratio, sampleRate) : ch;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = cubicAt(src, i * ratio);
    return out;
  });
}

/** A 4th-order (two biquads) Butterworth low-pass at `hz`, run forwards. */
export function lowpass(x: Float32Array, hz: number, sampleRate: number): Float32Array {
  let y = x;
  for (const q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.49)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = (1 - cos) / 2 / a0;
    const b1 = (1 - cos) / a0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    const out = new Float32Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return y;
}
