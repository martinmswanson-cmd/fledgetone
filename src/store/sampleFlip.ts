/**
 * Flipping a sample: chopping it into up to 16 slices (at its transients, into equal parts, or
 * where you put the markers), laying the chops on a Drum Rack's 16 pads, writing a starting
 * pattern that plays them back in a new order on the beat grid ("Chop and play", seeded so the
 * same idea always comes back the same), and the low cut that clears a sample's bass for an 808.
 * Plain maths, so Node can unit-test it.
 */
import type { DrumRack, NoteEvent, RackPad, TrackFx } from './timelineTypes';
import { barsToDuration, RACK_PADS } from './timelineTypes';
import { emptyPad, padNote, RACK_FADE_MAX } from './sampleKits';
import { equalSlices, transientSlices } from '../audio/slicing';
import { seededRandom } from '../audio/seededNoise';
import { hashSeed } from '../audio/human';

/** As many chops as a pad controller has pads. */
export const MAX_CHOPS = RACK_PADS;
/** The shortest chop, seconds: markers can't come closer than this. */
export const MIN_CHOP = 0.03;
/** How a sample is chopped: at its hits, into equal parts, or by hand (markers placed and dragged). */
export type ChopMode = 'transients' | 'equal' | 'hand';
/** Each chop's fade in and out by default, seconds: enough that a cut mid-note doesn't click. */
export const DEFAULT_CHOP_FADE = 0.005;

/**
 * Where to chop [start, end): `count` equal parts, or at its transients (the strongest, up to 16;
 * `sensitivity` 0 finds only the hardest hits, 1 the faintest). Each list starts at `start`.
 */
export function chopStarts(env: Float32Array, hop: number, start: number, end: number, mode: Exclude<ChopMode, 'hand'>, count: number, sensitivity = 0.5): number[] {
  if (mode === 'equal') return equalSlices(start, end, Math.max(1, Math.min(MAX_CHOPS, Math.round(count))));
  const found = transientSlices(env, hop, start, end, sensitivity);
  if (found.length <= MAX_CHOPS) return found;
  // The strongest: how far each cut's energy rises over the 60 ms before it
  const rise = (at: number) => {
    const f = Math.round(at / hop);
    const back = Math.max(1, Math.round(0.06 / hop));
    let before = 0;
    for (let k = Math.max(0, f - back); k < f; k++) before += env[k] ?? 0;
    let after = 0;
    for (let k = f; k < Math.min(env.length, f + 3); k++) after = Math.max(after, env[k]);
    return after / (before / back + 1e-6);
  };
  const kept = found
    .slice(1)
    .map((at) => ({ at, rise: rise(at) }))
    .sort((a, b) => b.rise - a.rise || a.at - b.at)
    .slice(0, MAX_CHOPS - 1)
    .map((c) => c.at)
    .sort((a, b) => a - b);
  return [found[0], ...kept];
}

/** The cuts with marker `i` (not the first: it is the start of the part) dragged to `at`, kept between its neighbours. */
export function moveChop(cuts: readonly number[], i: number, at: number, end: number): number[] {
  if (i <= 0 || i >= cuts.length || !Number.isFinite(at)) return [...cuts];
  const lo = cuts[i - 1] + MIN_CHOP;
  const hi = (i + 1 < cuts.length ? cuts[i + 1] : end) - MIN_CHOP;
  if (hi < lo) return [...cuts];
  const next = [...cuts];
  next[i] = Math.max(lo, Math.min(hi, at));
  return next;
}

/** The cuts with a new one at `at` (unless there are 16 already, or it's too close to another or the ends). */
export function addChop(cuts: readonly number[], at: number, end: number): number[] {
  if (cuts.length >= MAX_CHOPS || !Number.isFinite(at) || at <= cuts[0] + MIN_CHOP || at >= end - MIN_CHOP) return [...cuts];
  if (cuts.some((c) => Math.abs(c - at) < MIN_CHOP)) return [...cuts];
  return [...cuts, at].sort((a, b) => a - b);
}

/** The cuts without marker `i` (the first stays: it is where the part starts). */
export function removeChop(cuts: readonly number[], i: number): number[] {
  return i <= 0 || i >= cuts.length ? [...cuts] : cuts.filter((_, j) => j !== i);
}

/** The end of chop `i`: the next cut, or the end of the part. */
export const chopEnd = (cuts: readonly number[], i: number, end: number) => (i + 1 < cuts.length ? cuts[i + 1] : end);

export interface ChopRackOptions {
  /** Fade at each chop's edges, seconds */
  fade?: number;
  /** One chop cuts the others off, as on a classic sampler (choke group 1 for every pad) */
  choke?: boolean;
}

/** A Drum Rack with chop i on pad i (C2 up), each playing its stretch of the sound; the pads left over stay empty. */
export function chopsToRack(sound: { id: string; name: string }, cuts: readonly number[], end: number, { fade = DEFAULT_CHOP_FADE, choke = true }: ChopRackOptions = {}): DrumRack {
  const pads: RackPad[] = Array.from({ length: RACK_PADS }, (_, i) => {
    if (i >= cuts.length || i >= MAX_CHOPS) return emptyPad(i);
    return {
      ...emptyPad(i),
      name: `Chop ${i + 1}`,
      soundId: sound.id,
      start: round(cuts[i]),
      end: round(chopEnd(cuts, i, end)),
      fade: Math.max(0, Math.min(RACK_FADE_MAX, fade)),
      choke: choke ? 1 : 0,
    };
  });
  return { pads };
}

const round = (s: number) => Math.round(s * 1e6) / 1e6;

// ---------- Chop and play ----------

/**
 * Rhythms for a bar of chops, in 16ths: the hits of a boom-bap flip, mostly on 8ths with a few
 * pushed a 16th, always one on the downbeat.
 */
const RHYTHMS: ReadonlyArray<readonly number[]> = [
  [0, 3, 6, 8, 11, 14],
  [0, 3, 7, 10, 12],
  [0, 2, 6, 8, 10, 13],
  [0, 4, 6, 9, 12, 14],
  [0, 3, 6, 10, 12, 15],
  [0, 6, 8, 11, 14],
  [0, 3, 6, 9, 12],
  [0, 2, 4, 8, 11, 14],
];

/** The seed of an idea: the sample's id and which idea it is, so "New idea" steps through the same list for the same sample. */
export const flipSeed = (soundId: string, idea: number) => hashSeed(`flip|${soundId}|${idea}`);

/**
 * A starting pattern for chops on pads (pad i plays chop i): `bars` bars of hits on the 16th grid
 * that play the chops in a new order. The first chop of the order comes back on every downbeat
 * as the anchor, a chop sometimes repeats straight away (a stutter), and each hit lasts until the
 * next (the choke group cuts it there anyway). The same seed always gives the same pattern.
 */
export function flipPattern(chops: number, seed: number, bars = 2): Array<Omit<NoteEvent, 'id'>> {
  const n = Math.max(1, Math.min(MAX_CHOPS, Math.floor(chops)));
  const random = seededRandom(seed);
  // A new order: shuffled, and not the plain one (that's the sample as it was)
  const order = Array.from({ length: n }, (_, i) => i);
  for (let tries = 0; tries < 4; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (n < 3 || order.some((v, i) => v !== i)) break;
  }
  const first = RHYTHMS[Math.floor(random() * RHYTHMS.length)];
  const second = random() < 0.5 ? first : RHYTHMS[Math.floor(random() * RHYTHMS.length)];
  const steps: number[] = [];
  for (let b = 0; b < bars; b++) for (const s of b % 2 === 0 ? first : second) steps.push(b * 16 + s);
  const pads: number[] = [];
  let next = 1 % n;
  steps.forEach((step, k) => {
    if (step % 16 === 0) {
      pads.push(order[0]);
      return;
    }
    const gap = step - steps[k - 1];
    // A stutter: the chop again, a 16th or two on
    if (gap <= 2 && random() < 0.3) {
      pads.push(pads[k - 1]);
      return;
    }
    pads.push(order[next]);
    next = (next + 1) % n;
    if (next === 0 && n > 1) next = 1;
  });
  return steps.map((step, k) => {
    const until = k + 1 < steps.length ? steps[k + 1] : bars * 16;
    const accent = step % 16 === 0 ? 1 : step % 4 === 0 ? 0.9 : 0.78;
    return {
      note: padNote(pads[k]),
      startOffset: step / 16,
      duration: barsToDuration((until - step) / 16),
      velocity: Math.round(Math.min(1, accent - 0.04 + random() * 0.08) * 100) / 100,
    };
  });
}

// ---------- Filter out the bass ----------

/**
 * Where "Filter out the bass" cuts: under this the sample's bass and kick go, so an 808 laid under
 * it has the low end to itself; the chords' body above it stays.
 */
export const BASS_CUT_HZ = 180;

/** Whether a track's Filter insert is the bass cut (a high-pass, on). */
export const hasBassCut = (fx: TrackFx) => fx.filter.on && fx.filter.type === 'highpass';

/** The Filter insert's settings with the bass cut on (a steep high-pass at BASS_CUT_HZ, no peak) or off. */
export function bassCutFilter(on: boolean): Partial<TrackFx['filter']> {
  return on ? { on: true, type: 'highpass', cutoff: BASS_CUT_HZ, resonance: Math.SQRT1_2, slope: 24 } : { on: false };
}
