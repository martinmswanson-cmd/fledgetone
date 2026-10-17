/**
 * Double a vocal take: two new performances of it, one for the left and one for the right, each
 * a little early or late and a few cents sharp or flat, as a rapper's doubles are when they're
 * sung again rather than copied (an exact copy only makes the take louder). Played under the lead,
 * lower, they thicken and widen it.
 *
 * - Timing: each phrase (a run of sound between pauses) of each side gets its own offset, 5 to
 *   22 ms early or late. The offset moves between phrases in the pauses, quickly where it's quiet
 *   and very slowly inside a phrase (a slow move bends the pitch, so it's kept under 3 cents).
 * - Pitch: each phrase of each side is moved a few cents (3 to 9) sharp or flat, the two sides
 *   opposite ways, by the tuner's resynthesis (vocalTune.ts: TD-PSOLA), which keeps the timing.
 * - Everything is drawn from a seed (the clip's), so the same take always doubles the same way and
 *   the double, a sound of its own, plays the same live and in every export.
 *
 * Plain arrays, so Node tests it (scripts/vocalDouble.test.mjs).
 */
import { detectPitch, psola, type PitchFrame } from './vocalTune';
import { seededRandom } from './seededNoise';
import { hashSeed } from './human';

/** How a double differs from the take. */
export interface DoubleSettings {
  /** The seed every difference is drawn from */
  seed: number;
  /** The most a phrase is early or late, ms */
  maxMs?: number;
  /** The least, ms (an offset under about 5 ms combs with the lead rather than doubling it) */
  minMs?: number;
  /** The most a phrase is sharp or flat, cents */
  maxCents?: number;
  /** The least, cents */
  minCents?: number;
}

export const DOUBLE_DEFAULTS = { maxMs: 22, minMs: 5, maxCents: 9, minCents: 3 } as const;

/** One side's plan: per phrase, the offset (ms, + is late) and the pitch (cents). */
export interface DoublePlan {
  phrases: Array<{ start: number; end: number; ms: number; cents: number }>;
}

/** A pause this long (seconds) between sounds ends a phrase. */
const GAP_SECONDS = 0.06;
const HOP = 0.01;

/** The phrases of a voice: runs of pitched or loud frames with pauses of at least GAP_SECONDS between them. Seconds. */
export function phrasesOf(frames: readonly PitchFrame[], loud: readonly boolean[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const gapFrames = Math.round(GAP_SECONDS / HOP);
  let start = -1;
  let quiet = 0;
  for (let i = 0; i < frames.length; i++) {
    const sounding = frames[i].hz > 0 || loud[i];
    if (sounding) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= gapFrames) {
      out.push({ start: frames[start].time - HOP / 2, end: frames[i - quiet].time + HOP / 2 });
      start = -1;
      quiet = 0;
    }
  }
  if (start >= 0) out.push({ start: frames[start].time - HOP / 2, end: frames[frames.length - 1].time + HOP / 2 });
  return out;
}

/** A side's offsets and pitches, drawn from the seed: `side` 0 is left, 1 right (their pitches go opposite ways). */
export function planDouble(phrases: Array<{ start: number; end: number }>, side: 0 | 1, settings: DoubleSettings): DoublePlan {
  const o = { ...DOUBLE_DEFAULTS, ...settings };
  const random = seededRandom(hashSeed(`${settings.seed >>> 0}|double|${side}`));
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  // One side mostly sharp, the other mostly flat (which one from the seed): two doubles a few cents apart sound wide
  const pitchSign = (hashSeed(`${settings.seed >>> 0}|sides`) & 1) === side ? 1 : -1;
  return {
    phrases: phrases.map((p) => ({
      ...p,
      ms: (random() < 0.5 ? -1 : 1) * between(o.minMs, o.maxMs),
      cents: (random() < 0.85 ? pitchSign : -pitchSign) * between(o.minCents, o.maxCents),
    })),
  };
}

/** The level of each 10 ms frame against the loudest: true where it's within 40 dB (consonants, breaths). */
function loudFrames(x: Float32Array, sampleRate: number, frames: readonly PitchFrame[]): boolean[] {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const floor = peak * 0.01;
  const half = Math.round((HOP * sampleRate) / 2);
  return frames.map((f) => {
    const c = Math.round(f.time * sampleRate);
    let m = 0;
    for (let i = Math.max(0, c - half); i < Math.min(x.length, c + half); i++) m = Math.max(m, Math.abs(x[i]));
    return m > floor;
  });
}

/**
 * The time offset at every sample (samples, + is late): each phrase's offset, moved towards in the
 * pauses quickly (it isn't heard there) and inside phrases slowly enough that the pitch bend it
 * makes stays under 3 cents.
 */
export function offsetCurve(length: number, sampleRate: number, plan: DoublePlan, sounding: (sample: number) => boolean): Float32Array {
  const out = new Float32Array(length);
  const SLOW = 0.0015; // samples per sample: 2.6 cents
  const FAST = 0.8; // in a pause: the reading speeds up or slows right down, but nothing sounds there
  let p = 0;
  let current = plan.phrases.length ? (plan.phrases[0].ms * sampleRate) / 1000 : 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // The phrase sounding now, or the next one to come (its offset is set up in the pause before it)
    while (p + 1 < plan.phrases.length && t >= plan.phrases[p].end) p++;
    const target = plan.phrases.length ? (plan.phrases[p].ms * sampleRate) / 1000 : 0;
    const step = sounding(i) ? SLOW : FAST;
    current += Math.max(-step, Math.min(step, target - current));
    out[i] = current;
  }
  return out;
}

/** `x` read `offset` samples late at each sample (linear interpolation; silence off the ends). */
export function shiftByCurve(x: Float32Array, offset: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const at = i - offset[i];
    const j = Math.floor(at);
    if (j < 0 || j + 1 >= x.length) continue;
    const f = at - j;
    out[i] = x[j] * (1 - f) + x[j + 1] * f;
  }
  return out;
}

/** The pitch change per frame (semitones) for a side's plan, eased between phrases over 50 ms. */
export function pitchCurve(frames: readonly PitchFrame[], plan: DoublePlan): number[] {
  const out: number[] = [];
  let p = 0;
  let current = plan.phrases[0]?.cents ?? 0;
  for (const f of frames) {
    while (p + 1 < plan.phrases.length && f.time >= plan.phrases[p].end) p++;
    const target = plan.phrases[p]?.cents ?? 0;
    current += (target - current) * 0.2;
    out.push(current / 100);
  }
  return out;
}

/**
 * Two doubles of a take (its channels mixed to mono first): [left, right], each as long as the
 * take, at the take's level. Also each side's plan, for checking.
 */
export function doubleTake(channels: readonly Float32Array[], sampleRate: number, settings: DoubleSettings): { channels: [Float32Array, Float32Array]; plans: [DoublePlan, DoublePlan] } {
  const mono = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
  const frames = detectPitch(mono, sampleRate);
  const loud = loudFrames(mono, sampleRate, frames);
  const phrases = phrasesOf(frames, loud);
  const frameAt = (sample: number) => Math.max(0, Math.min(frames.length - 1, Math.round((sample / sampleRate - (frames[0]?.time ?? 0)) / HOP)));
  const sounding = (sample: number) => {
    const i = frameAt(sample);
    return frames.length > 0 && (frames[i].hz > 0 || loud[i]);
  };
  const side = (s: 0 | 1): [Float32Array, DoublePlan] => {
    const plan = planDouble(phrases, s, settings);
    const pitched = psola(mono, sampleRate, frames, pitchCurve(frames, plan));
    return [shiftByCurve(pitched, offsetCurve(mono.length, sampleRate, plan, sounding)), plan];
  };
  const [left, planL] = side(0);
  const [right, planR] = side(1);
  return { channels: [left, right], plans: [planL, planR] };
}

/** The seed of a clip's double: from its id, so a take doubles the same way every time. */
export const doubleSeed = (clipId: string): number => hashSeed(`double|${clipId}`);
