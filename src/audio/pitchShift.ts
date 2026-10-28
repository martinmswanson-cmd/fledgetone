/**
 * Re-pitching a recording without changing its length, for moving a sample into the song's key:
 * time-stretch it (timeStretch.ts, same pitch; the phase vocoder for anything tonal, so a chord
 * stays a clean chord) by the pitch ratio, then read the stretched copy back at that ratio through
 * a band-limited resampler (resample.ts), which puts the length back and moves the pitch without
 * aliasing. Plain arrays, so Node can unit-test it.
 */
import { stretchChannels, type StretchAnalysis } from './timeStretch';
import { resample } from './resample';

/**
 * `input` (one array per channel) moved `semitones` up (or down, negative), as long as it was.
 * Fractions of a semitone work too (a sample 20 cents flat moves +0.2).
 */
export function pitchShiftChannels(input: readonly Float32Array[], semitones: number, sampleRate: number, analysis?: StretchAnalysis): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || Math.abs(semitones) < 1e-4) return input.map((ch) => ch.slice());
  const ratio = 2 ** (semitones / 12);
  // `ratio` times as long at the same pitch (stretchChannels plays 1/ratio times as fast)...
  const long = stretchChannels(input, 1 / ratio, sampleRate, analysis);
  // ...then read `ratio` times as fast: the original length, `ratio` times the pitch (the
  // resampler takes off what would fold over the new Nyquist)
  return long.map((ch) => resample(ch, ratio, length));
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
