/**
 * How hard a sound starts, for the hearing report: onsets per second, the typical time the level
 * takes to climb from 10% to 90% of an onset's peak, and for a single short hit its rise, its fall
 * to 20 dB under the peak and how loud it hits. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { fallMs, frameDb, kPeakDb } from '../drumMeasure';
import { onsetStrength } from '../sampleAnalysis';
import { maxOf } from '../../support/minMax';
import { midOf } from './frames';
import type { Attack } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The frame size and hop of `onsetStrength` (not exported there), samples. */
const FLUX_SIZE = 1024;
const FLUX_HOP = 256;
/** At most this many of the strongest onsets are measured for the rise. */
const MAX_ONSETS = 32;
/** How far before an onset's time the climb may begin, and how long after it the peak may come, ms. */
const LOOK_BACK_MS = 100;
const LOOK_AHEAD_MS = 300;
/** A window ends this long before the next onset's time, which is stamped at the end of its frame, ms. */
const END_GAP_MS = 5;
/**
 * The least onset strength a hit has. Measured on made signals: steady white and pink noise from -18 to -60 dB peak at
 * most 19.2; a tone, a chord and a tremolo at most 8; hits (down to -60 dB, in silence, on a tone or on pink noise
 * at -30 dB, 2 to 16 a second) at least 26 (at -70 dB hits fall to 17).
 */
const MIN_STRENGTH = 22;
/** Onsets closer than this are one hit, ms. */
const MIN_GAP_MS = 30;
/** The span of the smoothed level, ms (longer than the period of a 55 Hz tone, 18 ms). */
const SMOOTH_MS = 20;
/** The span of the level the climb is followed on, ms: short enough to keep a sharp attack sharp, long enough that noise in a slow climb does not cut it short. */
const WALK_MS = 2;

/** The 1 ms level `env` (dB) as a mean of power over `width` frames up to each one, dB: a low tone's ripple in the 1 ms level is smoothed out. */
function smoothed(env: readonly number[], width: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < env.length; i++) {
    sum += 10 ** (env[i] / 10);
    if (i >= width) sum -= 10 ** (env[i - width] / 10);
    // (the running sum can drift a hair under zero after silence)
    out.push(10 * Math.log10(Math.max(0, sum) / Math.min(width, i + 1) + 1e-20));
  }
  return out;
}

/**
 * The rise of the peak in the level `env` (dB, from 1 ms frames) between frames `from` and `to`, ms: the time from
 * 10% to 90% of the way (in amplitude) from the quietest level before the peak up to the peak. Null
 * when the peak is at the start of the window or stands less than 6 dB over that quietest level
 * (both judged on `slow`, the smoothed level, so a steady low tone's ripple is not a climb), since no
 * climb was seen.
 */
function riseOf(env: readonly number[], slow: readonly number[], from: number, to: number): number | null {
  if (to <= from) return null;
  let top = from;
  for (let i = from; i < to; i++) if (env[i] > env[top]) top = i;
  let slowTop = from;
  for (let i = from; i < to; i++) if (slow[i] > slow[slowTop]) slowTop = i;
  if (slowTop === from) return null;
  let low = from;
  for (let i = from; i <= slowTop; i++) if (slow[i] < slow[low]) low = i;
  if (slow[slowTop] - slow[low] < 6) return null;
  const peak = 10 ** (env[top] / 20);
  const base = 10 ** (slow[low] / 20);
  const at = (share: number) => base + share * (peak - base);
  let at90 = top;
  while (at90 > low && 10 ** (env[at90] / 20) > at(0.9)) at90--;
  let at10 = at90;
  while (at10 > low && 10 ** (env[at10] / 20) > at(0.1)) at10--;
  return at90 - at10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How `channels` start; silent and empty input give no onsets and nulls. */
export function attackOf(channels: readonly Float32Array[], sampleRate: number): Attack {
  const none: Attack = { onsetsPerSecond: 0, riseMs: null, single: null };
  if (channels.length === 0 || channels[0].length === 0) return none;
  const mono = midOf(channels);
  const seconds = mono.length / sampleRate;
  const { strength } = onsetStrength(mono, sampleRate);
  // Onsets: local peaks of the strength over the floor, the strongest first, none within the gap of a stronger one
  const gap = Math.max(1, Math.round((MIN_GAP_MS / 1000) * sampleRate / FLUX_HOP));
  const peaks: number[] = [];
  for (let i = 1; i < strength.length - 1; i++) {
    if (strength[i] >= MIN_STRENGTH && strength[i] >= strength[i - 1] && strength[i] > strength[i + 1]) peaks.push(i);
  }
  const kept: number[] = [];
  for (const i of [...peaks].sort((a, b) => strength[b] - strength[a])) if (kept.every((j) => Math.abs(i - j) >= gap)) kept.push(i);
  kept.sort((a, b) => a - b);
  // (stamped at the middle of the frame's span, as onsetTimes does)
  const times = kept.map((i) => ((i + 0.5) * FLUX_HOP + FLUX_SIZE / 2) / sampleRate);
  if (times.length === 0) return none;

  const env = frameDb(mono, sampleRate, 1);
  // The climb is followed on the sound with its low end taken down (each sample less the one before), so a hit's noise
  // stands out of a bass or pad under it instead of adding a hair to its level
  const sharp = new Float32Array(mono.length);
  for (let i = 1; i < mono.length; i++) sharp[i] = mono[i] - mono[i - 1];
  const sharpEnv = frameDb(sharp, sampleRate, 1);
  const slow = smoothed(sharpEnv, SMOOTH_MS);
  const fine = smoothed(sharpEnv, WALK_MS);
  const ms = (t: number) => Math.round(t * 1000);
  // Only onsets where the level also climbs count: a held saw has strong flux from its own wave shape but no hit
  const rises: Array<{ strength: number; rise: number }> = [];
  times.forEach((t, k) => {
    // Back from the onset's time to half way to the one before, on to the next one or a while after
    const from = Math.max(0, k > 0 ? ms((times[k - 1] + t) / 2) : ms(t) - LOOK_BACK_MS, ms(t) - LOOK_BACK_MS);
    const to = Math.min(env.length, k + 1 < times.length ? ms(times[k + 1]) - END_GAP_MS : env.length, ms(t) + LOOK_AHEAD_MS);
    const rise = riseOf(fine, slow, from, to);
    if (rise !== null) rises.push({ strength: strength[kept[k]], rise });
  });
  const strongest = rises.sort((a, b) => b.strength - a.strength).slice(0, MAX_ONSETS).map((r) => r.rise);
  const riseMs = strongest.length > 0 ? round1(median(strongest)) : null;
  let single: Attack['single'] = null;
  if (rises.length === 1 && seconds < 2 && riseMs !== null) {
    // kPeakDb reads the first 70 ms, so it starts where the hit does: the first frame within 40 dB of the loudest
    const top = maxOf(env);
    const start = env.findIndex((v) => v > top - 40);
    const hit = mono.subarray(Math.max(0, Math.round((start / 1000) * sampleRate)));
    single = { riseMs, fall20Ms: round1(fallMs(env, 20)), peakDb: round1(kPeakDb(hit, sampleRate)) };
  }
  return { onsetsPerSecond: round1(rises.length / seconds), riseMs, single };
}
