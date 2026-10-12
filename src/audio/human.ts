import type { TrackFx } from '../store/timelineTypes';

/**
 * The Human insert's maths: how far one note drifts from what's written, the way a player never
 * hits the same note quite the same way twice. Nothing here is random at play time: each note's
 * drift comes from a hash of its clip, its id and where it sits, so the song sounds the same on
 * every play, in the WAV export and in a frozen track, yet no two notes are alike (a copied clip
 * is a new clip, so it drifts differently from the one it was copied from).
 */

/** At full Timing a note lands up to this late (seconds). Late only: an export can't play early. */
export const HUMAN_MAX_LATE = 0.015;
/** At full Dynamics a note is up to this much softer or harder (a fraction of its velocity). */
export const HUMAN_MAX_DYNAMICS = 0.3;
/** At full Pitch a note is up to this many cents sharp or flat. */
export const HUMAN_MAX_CENTS = 12;

export interface NoteDrift {
  /** Seconds after the written time */
  late: number;
  /** Multiplies the velocity */
  gain: number;
  /** Cents sharp (+) or flat (-) */
  cents: number;
}

/** A 32-bit FNV-1a hash of `text`. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Three numbers in [0, 1) from one seed (mulberry32). */
function draws(seed: number): [number, number, number, number, number, number] {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next(), next(), next(), next()];
}

/** Two uniform draws make a triangle in [-1, 1]: mostly small drifts, the odd bigger one. */
const triangle = (a: number, b: number) => a + b - 1;

/** How far the note with this seed drifts under these Human settings. */
export function noteDrift(seed: number, human: TrackFx['human']): NoteDrift {
  const [t1, t2, d1, d2, p1, p2] = draws(seed);
  return {
    // Centred on half the range, so notes fall either side of a slightly laid-back beat
    late: HUMAN_MAX_LATE * human.timing * (0.5 + 0.5 * triangle(t1, t2)),
    gain: 1 + HUMAN_MAX_DYNAMICS * human.dynamics * triangle(d1, d2),
    cents: HUMAN_MAX_CENTS * human.pitch * triangle(p1, p2),
  };
}

/** A note name moved by `cents`, as a frequency every pitched instrument reads ("261.78hz"). */
export function detuned(note: string, cents: number, frequencyOf: (note: string) => number): string {
  if (Math.abs(cents) < 0.05) return note;
  const hz = frequencyOf(note);
  if (!Number.isFinite(hz) || hz <= 0) return note;
  return `${(hz * 2 ** (cents / 1200)).toFixed(3)}hz`;
}
