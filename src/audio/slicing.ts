import type { NoteEvent } from '../store/timelineTypes';
import { barsToDuration, MAX_SLICES, SLICE_KEY_BASE } from '../store/timelineTypes';

/**
 * Cutting a sound into slices for the Slicer: equal parts, or at the transients found in its
 * energy envelope. Plain maths on arrays, so Node can unit-test it.
 */

/** Hop between envelope frames, in seconds: transients are found to this resolution. */
export const ENVELOPE_HOP = 0.002;

/** Shortest slice Auto makes: two transients closer than this count as one. */
const MIN_GAP = 0.05;

/** `count` equal slices of [start, end). */
export function equalSlices(start: number, end: number, count: number): number[] {
  const n = Math.max(1, Math.min(MAX_SLICES, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => start + ((end - start) * i) / n);
}

/**
 * The sound's energy per ENVELOPE_HOP frame: the RMS of every channel over a window two hops
 * long, so a transient that falls between frames still shows in one of them.
 */
export function envelopeOf(channels: ReadonlyArray<Float32Array>, sampleRate: number, hop = ENVELOPE_HOP): Float32Array {
  const hopSamples = Math.max(1, Math.round(hop * sampleRate));
  const length = channels[0]?.length ?? 0;
  const frames = Math.ceil(length / hopSamples);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const i0 = f * hopSamples;
    const i1 = Math.min(length, i0 + 2 * hopSamples);
    let sum = 0;
    for (const data of channels) for (let i = i0; i < i1; i++) sum += data[i] * data[i];
    env[f] = Math.sqrt(sum / Math.max(1, (i1 - i0) * channels.length));
  }
  return env;
}

/**
 * Slice starts at the transients of [start, end): a frame whose energy jumps well above the
 * average of the 60 ms before it (by 12 dB at sensitivity 0, down to 3 dB at 1), is the loudest
 * such jump within MIN_GAP, and is above the noise floor. The slice is cut a little before the
 * jump, where the energy started to climb, so the attack isn't clipped. The first slice always
 * starts at `start`. If more are found than MAX_SLICES, the strongest are kept.
 */
export function transientSlices(env: Float32Array, hop: number, start: number, end: number, sensitivity = 0.5): number[] {
  const f0 = Math.max(0, Math.floor(start / hop));
  const f1 = Math.min(env.length, Math.ceil(end / hop));
  if (f1 <= f0) return [start];
  const thresholdDb = 12 - 9 * Math.max(0, Math.min(1, sensitivity));
  const threshold = Math.pow(10, thresholdDb / 20);
  const window = Math.max(1, Math.round(0.06 / hop));
  const gapFrames = Math.max(1, Math.round(MIN_GAP / hop));
  let loudest = 0;
  for (let f = f0; f < f1; f++) loudest = Math.max(loudest, env[f]);
  const floor = loudest * 0.02 + 1e-6;

  // How far each frame rises above the stretch before it
  const rise = new Float32Array(f1 - f0);
  let sum = 0;
  for (let f = f0; f < f1; f++) {
    const back = f - f0;
    const before = back > 0 ? sum / Math.min(back, window) : 0;
    rise[back] = env[f] > floor ? env[f] / (before + floor) : 0;
    sum += env[f];
    if (back >= window) sum -= env[f - window];
  }

  const found: Array<{ frame: number; rise: number }> = [];
  for (let k = 0; k < rise.length; k++) {
    if (rise[k] < threshold) continue;
    // The loudest jump within a gap either side
    let peak = true;
    for (let j = Math.max(0, k - gapFrames); j <= Math.min(rise.length - 1, k + gapFrames) && peak; j++) {
      if (j !== k && (rise[j] > rise[k] || (rise[j] === rise[k] && j < k))) peak = false;
    }
    if (!peak) continue;
    // Back up to where the climb began (at most 10 ms), so the slice keeps the attack
    let frame = k + f0;
    const earliest = Math.max(f0, frame - Math.round(0.01 / hop));
    while (frame > earliest && env[frame - 1] < env[frame] && env[frame - 1] > floor * 0.5) frame--;
    found.push({ frame, rise: rise[k] });
  }

  const strongest = found.length > MAX_SLICES - 1 ? found.sort((a, b) => b.rise - a.rise).slice(0, MAX_SLICES - 1) : found;
  const slices = [start];
  for (const { frame } of strongest.sort((a, b) => a.frame - b.frame)) {
    const at = frame * hop;
    if (at - slices[slices.length - 1] >= MIN_GAP && at < end - MIN_GAP / 2) slices.push(at);
  }
  return slices;
}

/** The end of slice `i`: the next slice's start, or the end of the sliced part. */
export function sliceEnd(slices: readonly number[], i: number, end: number): number {
  return i + 1 < slices.length ? slices[i + 1] : end;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note name ("C3" is 48, "Bb2" 46), or NaN for anything else. */
export function midiOf(note: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!m) return NaN;
  const semitone = NOTE_OFFSETS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + semitone;
}

/** The key that plays slice `index` ("C3" for the first). */
export function sliceKey(index: number): string {
  const midi = SLICE_KEY_BASE + index;
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Which slice a note plays (its index), or -1 for a key with no slice. */
export function sliceIndexOf(note: string, sliceCount: number): number {
  const i = midiOf(note) - SLICE_KEY_BASE;
  return i >= 0 && i < sliceCount ? i : -1;
}

/**
 * Notes that play the slices in order at their own times, for "Chop to Slicer": each slice on its
 * key, starting where it starts in the sound (from the clip's start) and lasting as long as it does,
 * at the given tempo. `seconds` is how much of the sound the clip covers.
 */
export function sliceNotes(slices: readonly number[], start: number, end: number, bpm: number, velocity = 0.9): Array<Omit<NoteEvent, 'id'>> {
  const barsPerSecond = bpm / 240;
  return slices.map((at, i) => ({
    note: sliceKey(i),
    startOffset: (at - start) * barsPerSecond,
    duration: barsToDuration((sliceEnd(slices, i, end) - at) * barsPerSecond),
    velocity,
  }));
}
