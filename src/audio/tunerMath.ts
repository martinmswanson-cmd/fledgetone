/**
 * The tuner's maths: the pitch of a stretch of sound, and the note it's nearest to. The pitch is
 * found the way McLeod and Wyvill's "A smarter way to find pitch" does it: how alike the sound is
 * to itself moved along by each lag (normalised, so loudness doesn't matter), taking the first
 * lag at which it's nearly as alike as it ever gets, which is one period (not two, and not a
 * strong overtone's). Plain maths, so Node can unit-test it.
 */

/** The lowest and highest pitch it looks for: a five-string bass's low B to the top of a guitar's or a voice's range */
export const TUNER_LOW_HZ = 28;
export const TUNER_HIGH_HZ = 1800;
/** Quieter than this (about -50 dBFS) there's nothing to tune */
const SILENCE_RMS = 0.003;
/** How alike to itself, a period on, a sound must be to count as a note (1 is exactly) */
const CLEAR = 0.85;

export interface TunerPitch {
  hz: number;
  /** How clearly it's a note, CLEAR to 1 */
  clarity: number;
}

/** The pitch of `x` (a stretch of sound at `rate`), or null for silence, noise, or anything that isn't one clear note. */
export function tunerPitch(x: ArrayLike<number>, rate: number, lowHz = TUNER_LOW_HZ, highHz = TUNER_HIGH_HZ): TunerPitch | null {
  const n = x.length;
  let energy = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n || 1;
  for (let i = 0; i < n; i++) energy += (x[i] - mean) * (x[i] - mean);
  if (!(energy > 0) || Math.sqrt(energy / n) < SILENCE_RMS) return null;
  const minLag = Math.max(2, Math.floor(rate / highHz));
  // (At least two periods of the lowest note must fit, and half the stretch stays to compare)
  const maxLag = Math.min(Math.ceil(rate / lowHz), Math.floor(n / 2));
  if (maxLag <= minLag + 2) return null;
  const alike = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let both = 0;
    let each = 0;
    for (let i = 0, end = n - lag; i < end; i++) {
      const a = x[i] - mean;
      const b = x[i + lag] - mean;
      both += a * b;
      each += a * a + b * b;
    }
    alike[lag] = each > 0 ? (2 * both) / each : 0;
  }
  // Past the first dip under zero (lag 0 is always 1): the peaks from there on are whole periods
  let from = 1;
  while (from <= maxLag && alike[from] > 0) from++;
  if (from > maxLag) return null;
  let best = 0;
  for (let lag = Math.max(from, minLag); lag <= maxLag; lag++) if (alike[lag] > best && alike[lag] >= alike[lag - 1] && alike[lag] >= alike[lag + 1]) best = alike[lag];
  if (best < CLEAR) return null;
  for (let lag = Math.max(from, minLag); lag <= maxLag; lag++) {
    if (alike[lag] < best * 0.93 || alike[lag] < alike[lag - 1] || alike[lag] < alike[lag + 1]) continue;
    // The top of the peak lies between samples: a parabola through its three points finds it
    const [a, b, c] = [alike[lag - 1], alike[lag], alike[lag + 1]];
    const bend = a - 2 * b + c;
    const offset = bend < 0 ? (0.5 * (a - c)) / bend : 0;
    return { hz: rate / (lag + offset), clarity: Math.min(1, b) };
  }
  return null;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface TunerNote {
  /** "A", "C♯"... */
  name: string;
  /** The octave, middle C being C4 */
  octave: number;
  /** MIDI note number */
  midi: number;
  /** How far the pitch is from the note: -50 (flat) to +50 (sharp) hundredths of a semitone */
  cents: number;
  /** The note's own pitch */
  hz: number;
}

/** The note nearest to `hz` with A4 tuned to `a4` Hz, and how far off it the pitch is. */
export function tunerNote(hz: number, a4 = 440): TunerNote {
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return { name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, midi, cents: (exact - midi) * 100, hz: a4 * 2 ** ((midi - 69) / 12) };
}

/** The middle of the last few readings: a single wrong one (an octave slip as a note starts) doesn't show. */
export function steadyHz(recent: readonly number[]): number | null {
  if (!recent.length) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
