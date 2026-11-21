/**
 * How hard a sound starts, for the hearing report: onsets per second, the typical time the level
 * takes to climb from 10% to 90% of an onset's peak, and for a single short hit its rise, its fall
 * to 20 dB under the peak and how loud it hits. Plain maths on samples, no Web Audio, so Node can test it.
 *
 * Onsets are found band by band. The sound is split into bands (two octaves from 20 Hz, then
 * octaves), and each band's level is read over a span that suits its width: long in the narrow low
 * bands, a few milliseconds in the wide high ones. An onset in a band is its level standing well over
 * the loudest it was in the 45 ms before the span: a held sound of any pitch from 25 Hz up repeats
 * itself within 40 ms, so its level now was already reached then, and it cannot stand over it,
 * whatever its level. How far is "well over" is set per band from how much steady noise wobbles in a
 * band of that width read over that span, so it is the same at any level. A band 40 dB or more under
 * the loudest band at the time is not listened to. The onsets of all the bands within about 25 ms of
 * each other are one hit. A hit's rise is measured on the sharpest band it stood out in.
 */
import { band, fallMs, frameDb, kPeakDb } from '../drumMeasure';
import { maxOf } from '../../support/minMax';
import { midOf } from './frames';
import type { Attack } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The bands' lower edges, Hz; each band runs to the next edge, the last to half the sample rate. */
const BAND_EDGES = [20, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
/**
 * A band's level is read over the span that holds this many cycles of its width (its time-bandwidth product), so steady
 * noise wobbles about as much in every band; at least MIN_SPAN_MS.
 */
const TIME_BANDWIDTH = 4;
const MIN_SPAN_MS = 2;
/** The level now is compared with the loudest it was over this long before the span, ms: longer than the 40 ms period of a 25 Hz tone. */
const HOLD_MS = 45;
/**
 * How far a band's level must stand over that, dB, band by band: half a dB or more over the most steady noise stood out
 * in that band, rounded up to the half dB (measured on 240 s of white and pink noise: 9.3, 6.7, 6.1, 4.5, 4.7, 3.6, 3.4,
 * 2.4 and 2.0 dB), and at least 4 dB. Change the bands, spans or hold and these must be measured again. Noise wobbles most in the narrow low bands, which hear the fewest cycles of it in a span and a hold.
 */
const STAND_DB = [10, 7.5, 7, 5, 5.5, 4.5, 4, 4, 4];
/** A band this far or more under the loudest band at the time is not listened to, dB. */
const UNDER_LOUDEST_DB = 40;
/** Levels this far under the loudest level of the whole sound read as silence, dB. */
const FLOOR_DB = 80;
/** A band's onsets within this of a sharper band's (plus half its own span) are the same hit, ms. */
const SAME_HIT_MS = 25;
/** At most this many of the strongest onsets are measured for the rise. */
const MAX_ONSETS = 32;
/** How far back from an onset the climb may begin, and how long after it the peak may come, ms. */
const LOOK_BACK_MS = 100;
const LOOK_AHEAD_MS = 300;
/** A rise window ends this long before the next onset, ms. */
const END_GAP_MS = 5;
/** The rise is followed on the band's level read over this span, ms, or over half a cycle of its lower edge if longer. */
const WALK_MS = 1;

/** One band of the sound: its edges, its span (ms), how far a climb must stand out in it (dB) and its 1 ms frame power. */
interface Band {
  lo: number;
  hi: number;
  span: number;
  stand: number;
  power: Float64Array;
}

/** An onset in one band: the 1 ms frame its climb began at, how far it stood over the level before (dB), and its band. */
interface Climb {
  at: number;
  over: number;
  band: number;
}

/** The mean power of each 1 ms frame of `y`, `w` samples a frame. */
function framePower(y: Float64Array, w: number): Float64Array {
  const out = new Float64Array(Math.floor(y.length / w));
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    for (let j = f * w; j < (f + 1) * w; j++) s += y[j] * y[j];
    out[f] = s / w;
  }
  return out;
}

/** The level of the `span` frames of `power` ending at each frame, dB, at least `floor` (and the floor until a span is full). */
function levels(power: Float64Array, span: number, floor: number): Float64Array {
  const out = new Float64Array(power.length).fill(floor);
  let sum = 0;
  for (let i = 0; i < power.length; i++) {
    sum += power[i];
    if (i >= span) sum -= power[i - span];
    // (the running sum can drift a hair under zero after silence)
    if (i >= span - 1) out[i] = Math.max(floor, 10 * Math.log10(Math.max(0, sum) / span + 1e-30));
  }
  return out;
}

/**
 * How far the level at each frame stands over the loudest it was in the HOLD_MS frames before the `span` frames leading
 * to it, dB (0 until that much has been heard). For a sound that repeats within HOLD_MS this is never over 0.
 */
function standing(level: Float64Array, span: number): Float64Array {
  const out = new Float64Array(level.length);
  const queue: number[] = []; // frames of the hold, their levels falling
  let head = 0;
  let next = 0;
  for (let f = 2 * span - 1 + HOLD_MS; f < level.length; f++) {
    for (; next <= f - span; next++) {
      while (queue.length > head && level[queue[queue.length - 1]] <= level[next]) queue.pop();
      queue.push(next);
    }
    while (queue[head] < f - span - HOLD_MS) head++;
    out[f] = level[f] - level[queue[head]];
  }
  return out;
}

/**
 * The rise of the peak in the level `env` (dB) between frames `from` and `to`, ms: the time from 10% to 90% of the way
 * (in amplitude) from the quietest level before the peak up to the peak; null when the peak is at the window's start.
 */
function riseOf(env: Float64Array, from: number, to: number): number | null {
  if (to <= from) return null;
  let top = from;
  for (let i = from; i < to; i++) if (env[i] > env[top]) top = i;
  if (top === from) return null;
  let low = from;
  for (let i = from; i <= top; i++) if (env[i] < env[low]) low = i;
  const peak = 10 ** (env[top] / 20);
  const base = 10 ** (env[low] / 20);
  const at = (share: number) => base + share * (peak - base);
  let at90 = low;
  while (at90 < top && 10 ** (env[at90] / 20) < at(0.9)) at90++;
  let at10 = at90;
  while (at10 > low && 10 ** (env[at10] / 20) > at(0.1)) at10--;
  return at90 - at10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The bands of `mono`, each with its span, how far a climb must stand out in it and its 1 ms frame power. */
function bandsOf(mono: Float32Array, sampleRate: number): Band[] {
  const w = Math.max(1, Math.round(sampleRate / 1000));
  const edges = BAND_EDGES.filter((lo) => lo < sampleRate * 0.45);
  return edges.map((lo, b) => {
    const hi = b + 1 < edges.length ? edges[b + 1] : sampleRate / 2;
    const span = Math.max(MIN_SPAN_MS, Math.round((1000 * TIME_BANDWIDTH) / (hi - lo)));
    return { lo, hi, span, stand: STAND_DB[b], power: framePower(band(mono, sampleRate, lo, hi), w) };
  });
}

/** The hits: each band's climbs that stand out enough, in a band not too far under the loudest, joined across bands. */
function hitsOf(bands: Band[]): Climb[][] {
  let loudest = 0;
  const frames = bands[0].power.length;
  for (const { power, span } of bands) {
    let sum = 0;
    for (let i = 0; i < frames; i++) {
      sum += power[i];
      if (i >= span) sum -= power[i - span];
      if (sum / span > loudest) loudest = sum / span;
    }
  }
  if (!(loudest > 0)) return [];
  const floor = 10 * Math.log10(loudest) - FLOOR_DB;
  const level = bands.map((b) => levels(b.power, b.span, floor));
  const top = new Float64Array(frames).fill(floor);
  for (const l of level) for (let i = 0; i < frames; i++) if (l[i] > top[i]) top[i] = l[i];

  const climbs: Climb[] = [];
  bands.forEach(({ span, stand }, b) => {
    const over = standing(level[b], span);
    const reach = Math.max(span, 10);
    for (let f = 0; f < frames; f++) {
      const v = over[f];
      if (v < stand || level[b][f] < top[f] - UNDER_LOUDEST_DB) continue;
      // (a peak: the highest within the reach, the first of equals)
      let peak = true;
      for (let k = Math.max(0, f - reach); k <= Math.min(frames - 1, f + reach) && peak; k++) peak = over[k] < v || (over[k] === v && k >= f);
      // (the level read spans the frames ending here, so the climb began a span back)
      if (peak) climbs.push({ at: f - span + 1, over: v, band: b });
    }
  });
  // One hit across the bands: the sharpest bands place a hit best, so they go first; a climb joins the nearest hit within
  // reach, else starts one (the hits are kept in time order, so the nearest is one of the two either side)
  climbs.sort((a, b) => bands[a.band].span - bands[b.band].span || b.over - a.over);
  const hits: Climb[][] = [];
  for (const c of climbs) {
    let after = 0;
    for (let step = hits.length; step > 0; step >>= 1) while (after + step <= hits.length && hits[after + step - 1][0].at < c.at) after += step;
    const gap = (i: number) => (i >= 0 && i < hits.length ? Math.abs(hits[i][0].at - c.at) : Infinity);
    const near = gap(after - 1) <= gap(after) ? after - 1 : after;
    if (gap(near) <= SAME_HIT_MS + bands[c.band].span / 2) hits[near].push(c);
    else hits.splice(after, 0, [c]);
  }
  return hits;
}

/** How `channels` start; silent and empty input give no onsets and nulls. */
export function attackOf(channels: readonly Float32Array[], sampleRate: number): Attack {
  const none: Attack = { onsetsPerSecond: 0, riseMs: null, single: null };
  if (channels.length === 0 || channels[0].length < sampleRate / 1000) return none;
  const mono = midOf(channels);
  const seconds = mono.length / sampleRate;
  const bands = bandsOf(mono, sampleRate);
  const hits = hitsOf(bands);
  if (hits.length === 0) return none;

  // The rise of each hit, on the sharpest band it stood out in
  const frames = bands[0].power.length;
  const floor = -300;
  const rises: Array<{ over: number; rise: number }> = [];
  hits.forEach((h, k) => {
    const at = h[0].at;
    const { power, lo } = bands[h[0].band];
    const from = Math.max(0, k > 0 ? Math.round((hits[k - 1][0].at + at) / 2) : 0, at - LOOK_BACK_MS);
    const to = Math.min(frames, k + 1 < hits.length ? hits[k + 1][0].at - END_GAP_MS : frames, at + LOOK_AHEAD_MS);
    const walk = Math.max(WALK_MS, Math.round(500 / lo));
    const start = Math.max(0, from - walk + 1);
    const rise = riseOf(levels(power.subarray(start, to), walk, floor), from - start, to - start);
    if (rise !== null) rises.push({ over: maxOf(h.map((c) => c.over - bands[c.band].stand)), rise });
  });
  const strongest = rises.sort((a, b) => b.over - a.over).slice(0, MAX_ONSETS).map((r) => r.rise);
  const riseMs = strongest.length > 0 ? round1(median(strongest)) : null;
  let single: Attack['single'] = null;
  if (hits.length === 1 && seconds < 2 && riseMs !== null) {
    const env = frameDb(mono, sampleRate, 1);
    // kPeakDb reads the first 70 ms, so it starts where the hit does: the first frame within 40 dB of the loudest
    const top = maxOf(env);
    const begin = env.findIndex((v) => v > top - 40);
    const hit = mono.subarray(Math.max(0, Math.round((begin / 1000) * sampleRate)));
    single = { riseMs, fall20Ms: round1(fallMs(env, 20)), peakDb: round1(kPeakDb(hit, sampleRate)) };
  }
  return { onsetsPerSecond: round1(hits.length / seconds), riseMs, single };
}
