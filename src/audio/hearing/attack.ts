/**
 * How hard a sound starts, for the hearing report: onsets per second, the typical time the level
 * takes to climb from 10% to 90% of an onset's peak, and for a single short hit its rise, its fall
 * to 20 dB under the peak and how loud it hits. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { fallMs, frameDb, kPeakDb } from '../drumMeasure';
import { onsetStrength, onsetTimes } from '../sampleAnalysis';
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

/** The 10% to 90% rise of the peak amplitude in the 1 ms level `env` (dB) between frames `from` and `to`, ms. */
function riseOf(env: readonly number[], from: number, to: number): number | null {
  if (to <= from) return null;
  let top = from;
  for (let i = from; i < to; i++) if (env[i] > env[top]) top = i;
  const peak = 10 ** (env[top] / 20);
  if (!(peak > 1e-9)) return null;
  let at90 = top;
  while (at90 > from && 10 ** (env[at90] / 20) > 0.9 * peak) at90--;
  let at10 = at90;
  while (at10 > from && 10 ** (env[at10] / 20) > 0.1 * peak) at10--;
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
  const times = onsetTimes(strength, sampleRate);
  if (times.length === 0) return none;

  const env = frameDb(mono, sampleRate, 1);
  const ms = (t: number) => Math.round(t * 1000);
  const rises: Array<{ strength: number; rise: number }> = [];
  times.forEach((t, k) => {
    // Back from the onset's time to half way to the one before, on to the next one or a while after
    const from = Math.max(0, k > 0 ? ms((times[k - 1] + t) / 2) : ms(t) - LOOK_BACK_MS, ms(t) - LOOK_BACK_MS);
    const to = Math.min(env.length, k + 1 < times.length ? ms(times[k + 1]) : env.length, ms(t) + LOOK_AHEAD_MS);
    const rise = riseOf(env, from, to);
    const frame = Math.round((t * sampleRate - FLUX_SIZE / 2) / FLUX_HOP - 0.5);
    if (rise !== null) rises.push({ strength: strength[frame] ?? 0, rise });
  });
  const strongest = rises.sort((a, b) => b.strength - a.strength).slice(0, MAX_ONSETS).map((r) => r.rise);
  const riseMs = strongest.length > 0 ? round1(median(strongest)) : null;
  let single: Attack['single'] = null;
  if (times.length === 1 && seconds < 2 && riseMs !== null) {
    // kPeakDb reads the first 70 ms, so it starts where the hit does: the first frame within 40 dB of the loudest
    const top = Math.max(...env);
    const start = env.findIndex((v) => v > top - 40);
    const hit = mono.subarray(Math.max(0, Math.round((start / 1000) * sampleRate)));
    single = { riseMs, fall20Ms: round1(fallMs(env, 20)), peakDb: round1(kPeakDb(hit, sampleRate)) };
  }
  return { onsetsPerSecond: round1(times.length / seconds), riseMs, single };
}
