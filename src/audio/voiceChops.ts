/**
 * Chop my voice: a sung or spoken take cut into its syllables, each tuned onto a note and laid on
 * the keys, so the take becomes an instrument that plays its own syllables as a chopped hook.
 *
 * - Syllables: the take's level every 10 ms; a syllable is a stretch above the take's floor (20 dB
 *   under its loudest 10 ms, or 12 dB over its quietest, whichever is higher), cut again where the
 *   level jumps (a new consonant: 6 dB over the 50 ms before) or where the voice moves to a new
 *   note and stays there (over 1.5 semitones for 80 ms: a sung tune on one vowel). Bits under
 *   80 ms are dropped, anything past MAX_CHOP_SECONDS cut short.
 * - Note: the syllable's pitch (YIN, vocalTune.ts) where it's loudest; its note is the nearest
 *   semitone. A syllable with too little pitch in it (a breath, an S) has none and plays as it is.
 * - Keys: each pitched syllable on its own note; two on one note, the later moves to the nearest
 *   free key within MAX_MOVE semitones (tuned there), else the quieter of them is left out. The
 *   unpitched ones go on the free keys under the lowest. Each plays the keys from halfway to its
 *   neighbours, at most REACH semitones from its own.
 * - Tuning: each syllable moved onto its key (TD-PSOLA), keeping `keep` of its wobble around its
 *   note, so it sings the note but doesn't go robotic.
 *
 * Plain arrays, so Node can unit-test it; voiceChopActions.ts does the rest.
 */
import { detectPitch, hzToMidi, psola, type PitchFrame } from './vocalTune';

export const MAX_CHOPS = 16;
export const MAX_CHOP_SECONDS = 1.2;
const MIN_CHOP_SECONDS = 0.08;
const HOP = 0.01;
/** Semitones a syllable may be moved to a free key */
export const MAX_MOVE = 2;
/** Semitones a syllable plays either side of its key, at most */
export const REACH = 6;
/** How much of a syllable's wobble around its note is kept when it's tuned */
export const KEEP_WOBBLE = 0.4;

export interface Syllable {
  /** Seconds into the sound */
  start: number;
  end: number;
  /** Its pitch where it's loudest (MIDI, fractional), or null when it has too little pitch */
  midi: number | null;
  /** Its loud part's level, dB */
  level: number;
}

/** Level of each 10 ms frame, dB. */
export function frameLevels(x: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(HOP * rate));
  const n = Math.floor(x.length / hop);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    out[f] = 10 * Math.log10(s / hop + 1e-12);
  }
  return out;
}

const pitchOf = (frames: readonly PitchFrame[], f: number): number | null => {
  const hz = frames[f]?.hz ?? 0;
  return hz > 0 ? hzToMidi(hz) : null;
};

/** The middle value of a list (null for none). */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The take's syllables, in time order (see the file's notes). At most MAX_CHOPS: the loudest are kept. */
export function findSyllables(x: Float32Array, rate: number, frames: readonly PitchFrame[] = detectPitch(x, rate)): Syllable[] {
  const db = frameLevels(x, rate);
  if (!db.length) return [];
  let top = -Infinity;
  let bottom = Infinity;
  for (const v of db) {
    top = Math.max(top, v);
    bottom = Math.min(bottom, v);
  }
  if (top < -70) return [];
  const floor = Math.max(top - 20, bottom + 12);
  const cuts: Array<[number, number]> = [];
  let f = 0;
  while (f < db.length) {
    if (db[f] < floor) {
      f++;
      continue;
    }
    let g = f;
    while (g < db.length && db[g] >= floor - 3) g++;
    cuts.push([f, g]);
    f = g;
  }
  // Cut again at new consonants and new notes
  const parts: Array<[number, number]> = [];
  const minFrames = Math.round(MIN_CHOP_SECONDS / HOP);
  for (const [a, b] of cuts) {
    let from = a;
    for (let k = a + minFrames; k < b - minFrames; k++) {
      const before = Math.max(from, k - 5);
      let mean = 0;
      for (let j = before; j < k; j++) mean += db[j];
      mean /= Math.max(1, k - before);
      const jump = db[k] - mean >= 6 && db[k] - db[k - 1] >= 3;
      const p0 = median(rangePitches(frames, Math.max(from, k - 8), k));
      const p1 = median(rangePitches(frames, k, Math.min(b, k + 8)));
      const step = p0 !== null && p1 !== null && Math.abs(p1 - p0) > 1.5 && steady(frames, k, Math.min(b, k + 8), p1);
      if ((jump || step) && k - from >= minFrames) {
        parts.push([from, k]);
        from = k;
      }
    }
    parts.push([from, b]);
  }
  const maxFrames = Math.round(MAX_CHOP_SECONDS / HOP);
  let found: Syllable[] = parts
    .filter(([a, b]) => b - a >= minFrames)
    .map(([a, b]) => {
      const e = Math.min(b, a + maxFrames);
      const levels = Array.from(db.subarray(a, e)).sort((p, q) => p - q);
      const level = levels[Math.floor(levels.length * 0.9)] ?? -100;
      // Pitch over its loud half
      const loud: number[] = [];
      let voiced = 0;
      for (let k = a; k < e; k++) {
        const p = pitchOf(frames, k);
        if (p === null) continue;
        voiced++;
        if (db[k] >= level - 6) loud.push(p);
      }
      const midi = voiced >= Math.max(4, 0.3 * (e - a)) ? median(loud.length >= 3 ? loud : rangePitches(frames, a, e)) : null;
      return { start: a * HOP, end: e * HOP, midi, level };
    });
  if (found.length > MAX_CHOPS) {
    const keep = new Set([...found].sort((p, q) => q.level - p.level).slice(0, MAX_CHOPS));
    found = found.filter((s) => keep.has(s));
  }
  return found;
}

function rangePitches(frames: readonly PitchFrame[], a: number, b: number): number[] {
  const out: number[] = [];
  for (let k = a; k < b; k++) {
    const p = pitchOf(frames, k);
    if (p !== null) out.push(p);
  }
  return out;
}

/** The voice stays within a semitone of `at` over frames [a, b). */
function steady(frames: readonly PitchFrame[], a: number, b: number, at: number): boolean {
  const ps = rangePitches(frames, a, b);
  return ps.length >= (b - a) * 0.75 && ps.every((p) => Math.abs(p - at) <= 1);
}

export interface ChopKey {
  /** Which syllable (index into the list given) */
  index: number;
  /** The key it plays at its own (tuned) pitch, MIDI */
  root: number;
  /** The keys it plays on (MIDI, inclusive) */
  lo: number;
  hi: number;
}

/** Each syllable's key and the keys it plays on (see the file's notes). Sorted by key. */
export function layoutChops(syllables: readonly Syllable[]): ChopKey[] {
  const taken = new Map<number, number>();
  const pitched = syllables.map((s, i) => ({ s, i })).filter((p) => p.s.midi !== null);
  for (const { s, i } of pitched) {
    const want = Math.round(s.midi!);
    let placed = false;
    for (let d = 0; d <= MAX_MOVE && !placed; d++) {
      // The nearer side first
      const sides = d === 0 ? [0] : s.midi! - want >= 0 ? [d, -d] : [-d, d];
      for (const side of sides) {
        if (!taken.has(want + side)) {
          taken.set(want + side, i);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      // The quieter of it and whoever has its note is left out
      const other = taken.get(want)!;
      if (syllables[other].level < s.level) taken.set(want, i);
    }
  }
  const unpitched = syllables.map((s, i) => ({ s, i })).filter((p) => p.s.midi === null);
  if (unpitched.length) {
    let key = (taken.size ? Math.min(...taken.keys()) : 62) - 1;
    for (const { i } of unpitched) {
      while (taken.has(key)) key--;
      if (key < 24) break;
      taken.set(key, i);
      key--;
    }
  }
  const roots = [...taken.keys()].sort((a, b) => a - b);
  return roots.map((root, k) => {
    const below = roots[k - 1];
    const above = roots[k + 1];
    const lo = below === undefined ? root - REACH : Math.max(root - REACH, Math.floor((below + root) / 2) + 1);
    const hi = above === undefined ? root + REACH : Math.min(root + REACH, Math.floor((root + above) / 2));
    return { index: taken.get(root)!, root, lo: Math.max(0, lo), hi: Math.min(127, hi) };
  });
}

/**
 * A syllable sung on `root`: its stretch of `x` (with `frames`, the whole take's pitch), moved
 * there keeping KEEP_WOBBLE of its wobble around its note; an unpitched one as it is. 3 ms in,
 * 15 ms out.
 */
export function tuneChop(x: Float32Array, rate: number, frames: readonly PitchFrame[], s: Syllable, root: number, keep = KEEP_WOBBLE): Float32Array {
  const a = Math.max(0, Math.round(s.start * rate));
  const b = Math.min(x.length, Math.round(s.end * rate));
  const part = x.slice(a, b);
  let out: Float32Array = part;
  if (s.midi !== null) {
    const f0 = Math.round(s.start / HOP);
    const local = frames.slice(f0, Math.ceil(s.end / HOP) + 1).map((f) => ({ ...f, time: f.time - f0 * HOP }));
    const centre = s.midi;
    const shift = local.map((f) => (f.hz > 0 ? root - centre - (1 - keep) * (hzToMidi(f.hz) - centre) : 0));
    out = psola(part, rate, local, shift);
  }
  const fadeIn = Math.min(out.length, Math.round(0.003 * rate));
  const fadeOut = Math.min(out.length, Math.round(0.015 * rate));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut;
  return out;
}

/** Gain that brings a chop's loud part to `targetDb`, with its peak kept under -1 dBFS. */
export function chopGain(y: Float32Array, rate: number, targetDb = -16): number {
  const db = Array.from(frameLevels(y, rate)).sort((p, q) => p - q);
  const level = db[Math.floor(db.length * 0.9)] ?? -100;
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) return 1;
  return Math.min(10 ** ((targetDb - level) / 20), 10 ** (-1 / 20) / peak);
}
