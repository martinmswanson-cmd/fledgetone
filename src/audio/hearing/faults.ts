/**
 * Faults in a sound, for the hearing report: clicks, clipping at full scale, a DC offset, mains hum,
 * digital silence inside the sound and a missing or much quieter channel, each placed in time where
 * it has a place. Built so healthy sound (distorted and clipped basses, wobbles, dense drums, noise,
 * loud masters) reads no fault. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { midOf } from './frames';
import type { Fault } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
/** An amplitude as dBFS, floored at -120. */
const dbfs = (amplitude: number) => (amplitude > 0 ? Math.max(-120, 20 * Math.log10(amplitude)) : -120);
const sideName = (c: number): 'left' | 'right' => (c === 0 ? 'left' : 'right');

/** The median of the first `count` values of `a`, which it reorders (the upper middle of an even count); 0 for none. */
function medianInPlace(a: Float64Array, count: number): number {
  if (count <= 0) return 0;
  const k = count >> 1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

// ---- Clicks

/** A candidate's |second difference| must reach this many times the local scale, and this much at least. */
const CLICK_OVER_SCALE = 7;
const CLICK_FLOOR = 0.003;
/** The jump in the wave must be this many times the steepest step just around it (a corner that only bends is no click). */
const JUMP_OVER_SLOPE = 3;
/** The click must stand this many times over everything else within 2 ms (a noise burst or a busy wave does not). */
const ISOLATION = 3;
/** Corners are compared over this many samples either side. */
const SHAPE_HALF = 24;
/** Two corners whose waves correlate this well are alike. */
const LIKE = 0.8;
/** Faults listed one by one before the rest are only counted. */
const LISTED = 20;

/** A click found in one channel: its sample, its jump in the wave (linear) and its |second difference|. */
interface Click {
  at: number;
  jump: number;
  size: number;
}

/** The largest |x[k+1] - x[k]| for k from `from` to `to`, inside the signal. */
function steepest(x: Float32Array, from: number, to: number): number {
  let best = 0;
  for (let k = Math.max(0, from); k <= Math.min(x.length - 2, to); k++) best = Math.max(best, Math.abs(x[k + 1] - x[k]));
  return best;
}

/** The median of |d| from `from` to `to`, inside the signal; `scratch` is reused. */
function medianAbs(d: Float32Array, from: number, to: number, scratch: Float64Array): number {
  let n = 0;
  for (let k = Math.max(1, from); k <= Math.min(d.length - 2, to); k++) scratch[n++] = Math.abs(d[k]);
  return medianInPlace(scratch, n);
}

/** Orthonormal constant, linear and quadratic shapes over 2 * half + 1 samples. */
function trendBasis(half: number): Float64Array[] {
  const n = 2 * half + 1;
  const basis: Float64Array[] = [];
  for (let power = 0; power <= 2; power++) {
    const v = new Float64Array(n);
    for (let k = 0; k < n; k++) v[k] = ((k - half) / half) ** power;
    for (const q of basis) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += v[k] * q[k];
      for (let k = 0; k < n; k++) v[k] -= dot * q[k];
    }
    let norm = 0;
    for (let k = 0; k < n; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm);
    for (let k = 0; k < n; k++) v[k] /= norm;
    basis.push(v);
  }
  return basis;
}

/** `out` = x from `at - half` to `at + half` with its best-fitting quadratic taken off; false if that reaches outside x. */
function detrended(x: Float32Array, at: number, basis: Float64Array[], out: Float64Array): boolean {
  const half = (out.length - 1) / 2;
  if (at - half < 0 || at + half >= x.length) return false;
  for (let k = 0; k < out.length; k++) out[k] = x[at - half + k];
  for (const q of basis) {
    let dot = 0;
    for (let k = 0; k < out.length; k++) dot += out[k] * q[k];
    for (let k = 0; k < out.length; k++) out[k] -= dot * q[k];
  }
  return true;
}

/**
 * How alike the wave is around a and around b, `half` samples either side, once each stretch has its
 * best-fitting quadratic taken off (so an offset or a slower wave beneath, a kick or a snare's tone
 * under a bass, drops out): their correlation, at the best of a few small shifts, so a clipped wave's
 * corners match cycle after cycle wherever they fall between samples.
 */
function sameShape(x: Float32Array, a: number, b: number, basis: Float64Array[], u: Float64Array, v: Float64Array): number {
  if (!detrended(x, a, basis, u)) return -1;
  let uu = 0;
  for (const value of u) uu += value * value;
  let best = -1;
  for (let shift = -2; shift <= 2; shift++) {
    if (!detrended(x, b + shift, basis, v)) continue;
    let vv = 0;
    let uv = 0;
    for (let k = 0; k < v.length; k++) {
      vv += v[k] * v[k];
      uv += u[k] * v[k];
    }
    if (uu > 0 && vv > 0) best = Math.max(best, uv / Math.sqrt(uu * vv));
  }
  return best;
}

/** Whether x is exactly zero all the way from `from` to `to` (both inside the signal). */
function zeroFrom(x: Float32Array, from: number, to: number): boolean {
  if (from < 0 || to >= x.length) return false;
  for (let i = from; i <= to; i++) if (x[i] !== 0) return false;
  return true;
}

/**
 * The clicks in one channel, read on its second difference d (zero on any straight stretch, large where
 * the wave jumps). A candidate stands far over the level of d on both sides of it, the larger side
 * setting the bar, so the start of a hit (whose own sound sets the level after it) is none. It is kept
 * only if the wave itself jumps there (not merely bends, as at a clean cut on a zero crossing), it stands
 * alone within 2 ms (not a noise burst or a busy wave), and no like corner at least a quarter its size
 * lies within 150 ms: a clipped or distorted wave repeats its corners each cycle, at sizes that vary
 * with where the cycle falls between samples, and a gate or tremolo can leave one corner in each burst.
 * The like corners are looked for among every peak of d that size, candidates or not: under noise near
 * the level where the wave's corners stop standing over the scale, only some of them are candidates,
 * and one left without a candidate beside it would read as a click.
 * A jump right beside digital silence (a dropout's edge) is a click whatever repeats near it, as a
 * wave's corners never border exact zeros. Every test is centred on the candidate's peak, and nothing
 * is read within 2 ms of either end of the sound: the file's own edges are no click.
 */
function clicksIn(x: Float32Array, sampleRate: number): Click[] {
  const n = x.length;
  if (n < 8) return [];
  const d = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) d[i] = x[i + 1] - 2 * x[i] + x[i - 1];

  // The local scale: the median of |d| in 1 ms blocks, and per block the larger of the medians of the
  // ten blocks before it and the ten after (so the start of a loud sound sets the scale for the sound itself)
  const block = Math.max(8, Math.round(sampleRate / 1000));
  const blocks = Math.ceil(n / block);
  const scratch = new Float64Array(Math.max(block, 64));
  const blockMedian = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) blockMedian[b] = medianAbs(d, b * block, Math.min(n, (b + 1) * block) - 1, scratch);
  const side = 10;
  const sides = new Float64Array(side);
  const threshold = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let count = 0;
    for (let c = Math.max(0, b - side); c < b; c++) sides[count++] = blockMedian[c];
    const before = medianInPlace(sides, count);
    count = 0;
    for (let c = b + 1; c <= Math.min(blocks - 1, b + side); c++) sides[count++] = blockMedian[c];
    const after = medianInPlace(sides, count);
    threshold[b] = Math.max(CLICK_FLOOR, CLICK_OVER_SCALE * 1.4826 * Math.max(before, after));
  }

  // Candidates, those within 3 samples of each other gathered into one: [start, end, peak]
  const groups: Array<[number, number, number]> = [];
  for (let i = 1; i < n - 1; i++) {
    const v = Math.abs(d[i]);
    if (v < threshold[Math.floor(i / block)]) continue;
    const last = groups[groups.length - 1];
    if (last && i - last[1] <= 3) {
      last[1] = i;
      if (v > Math.abs(d[last[2]])) last[2] = i;
    } else groups.push([i, i, i]);
  }

  const near = Math.round(sampleRate * 0.002);
  const repeat = Math.round(sampleRate * 0.15);
  const basis = trendBasis(SHAPE_HALF);
  const u = new Float64Array(2 * SHAPE_HALF + 1);
  const v = new Float64Array(2 * SHAPE_HALF + 1);
  const out: Click[] = [];
  let first = 0; // the first group within `repeat` before the one at hand
  groups.forEach(([, , peak], g) => {
    if (peak < near || peak >= n - near) return;
    const size = Math.abs(d[peak]);
    // The wave jumps here, by more than its steepest step just around
    const jump = steepest(x, peak - 2, peak + 1);
    const slope = Math.max(steepest(x, peak - 11, peak - 3), steepest(x, peak + 2, peak + 10));
    if (jump < JUMP_OVER_SLOPE * slope) return;
    // It stands alone within 2 ms
    let around = 0;
    for (let k = Math.max(1, peak - near); k <= peak - 4; k++) around = Math.max(around, Math.abs(d[k]));
    for (let k = peak + 4; k <= Math.min(n - 2, peak + near); k++) around = Math.max(around, Math.abs(d[k]));
    if (size < ISOLATION * around) return;
    // It is not one of a row of like corners, unless it borders digital silence (a dropout's edge)
    if (!zeroFrom(x, peak + 2, peak + 1 + block) && !zeroFrom(x, peak - 1 - block, peak - 2)) {
      while (groups[first][2] < peak - repeat) first++;
      for (let h = first; h < groups.length && groups[h][2] <= peak + repeat; h++) {
        if (h === g) continue;
        const other = groups[h][2];
        if (Math.abs(d[other]) >= size / 4 && sameShape(x, peak, other, basis, u, v) >= LIKE) return;
      }
      // (the candidates first, which is quick for a clean wave; then every other peak of d that size)
      const quarter = size / 4;
      for (let k = Math.max(1, peak - repeat); k <= Math.min(n - 2, peak + repeat); k++) {
        if (Math.abs(k - peak) <= 3) continue;
        const w = Math.abs(d[k]);
        if (w < quarter || w < Math.abs(d[k - 1]) || w < Math.abs(d[k + 1])) continue;
        if (sameShape(x, peak, k, basis, u, v) >= LIKE) return;
      }
    }
    out.push({ at: peak, jump, size });
  });
  return out;
}

/** The clicks of all channels: one fault each for the first twenty, a count of the rest. */
function clickFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  const found = channels.flatMap((x, c) => clicksIn(x, sampleRate).map((k) => ({ ...k, channel: c })));
  found.sort((a, b) => a.at - b.at);
  const merged: Array<{ at: number; jump: number; channels: Set<number> }> = [];
  for (const k of found) {
    const last = merged[merged.length - 1];
    if (last && k.at - last.at <= 3 && !last.channels.has(k.channel)) {
      last.channels.add(k.channel);
      last.jump = Math.max(last.jump, k.jump);
    } else merged.push({ at: k.at, jump: k.jump, channels: new Set([k.channel]) });
  }
  const faults: Fault[] = merged.slice(0, LISTED).map((k) => {
    const value = round1(dbfs(k.jump));
    const fault: Fault = { kind: 'click', seconds: round3(k.at / sampleRate), value, detail: '' };
    if (channels.length === 2 && k.channels.size === 1) {
      const [c] = k.channels;
      fault.channel = sideName(c);
    }
    fault.detail = `A click${fault.channel ? ` in the ${fault.channel} channel` : ''}, a jump of ${value.toFixed(1)} dBFS`;
    return fault;
  });
  const left = merged.length - LISTED;
  if (left > 0) faults.push({ kind: 'click', seconds: null, count: left, detail: `${left} more ${left === 1 ? 'click' : 'clicks'}` });
  return faults;
}

// ---- Clipping

/** Runs of 3 or more samples of one sign at or above 0.99 of full scale, in all channels, as one fault. */
function clippingFault(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  let runs = 0;
  let firstAt = Infinity;
  let peak = 0;
  for (const x of channels) {
    let i = 0;
    while (i < x.length) {
      if (!(Math.abs(x[i]) >= 0.99)) {
        i++; // NaN too
        continue;
      }
      const sign = Math.sign(x[i]);
      let j = i;
      let top = 0;
      while (j < x.length && Math.abs(x[j]) >= 0.99 && Math.sign(x[j]) === sign) top = Math.max(top, Math.abs(x[j++]));
      if (j - i >= 3) {
        runs++;
        firstAt = Math.min(firstAt, i);
        peak = Math.max(peak, top);
      }
      i = j;
    }
  }
  if (runs === 0) return [];
  const value = round1(dbfs(peak));
  return [
    {
      kind: 'clipping',
      seconds: round3(firstAt / sampleRate),
      count: runs,
      value,
      detail: `Clipping at full scale (peaks of ${value.toFixed(1)} dBFS) in ${runs} ${runs === 1 ? 'place' : 'places'}`,
    },
  ];
}

// ---- DC

/** A moving average of `x` over `n` values (each value the mean of itself and the n - 1 before it). */
function movingAverage(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= n) sum -= x[i - n];
    out[i] = sum / Math.min(i + 1, n);
  }
  return out;
}

/**
 * A channel's offset, or null. Its trend (the wave smoothed by two 50 ms averages, read every 1 ms) is
 * off zero by more than -50 dBFS: as a median over time, and at its quietest moments (the fifth of the
 * time with the least power about the trend), and it keeps that sign at least 90% of the time; its mean
 * is off zero too, on the same side. A kick that starts on the rise leans one way as it starts, so a kick
 * loop has a mean off zero; but its lean comes and goes with the hits, gone when they are quiet and back
 * to zero between them, while an offset stays through everything. The value is the trend's median.
 */
function offsetOf(x: Float32Array, sampleRate: number): number | null {
  const limit = 0.00316;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / Math.max(1, x.length);
  if (!(Math.abs(mean) > limit)) return null;
  const step = Math.max(1, Math.round(sampleRate / 1000));
  const span = 50;
  const count = Math.floor(x.length / step);
  if (count < 4 * span) return null;
  const level = new Float64Array(count);
  const power = new Float64Array(count);
  for (let b = 0; b < count; b++) {
    let s1 = 0;
    let s2 = 0;
    for (let i = b * step; i < (b + 1) * step; i++) {
      s1 += x[i];
      s2 += x[i] * x[i];
    }
    level[b] = s1 / step;
    power[b] = s2 / step;
  }
  const trend = movingAverage(movingAverage(level, span), span).subarray(2 * span);
  const square = movingAverage(movingAverage(power, span), span).subarray(2 * span);
  const n = trend.length;
  const sorted = Float64Array.from(trend);
  const typical = medianInPlace(sorted, n);
  if (!(Math.abs(typical) > limit) || Math.sign(typical) !== Math.sign(mean)) return null;
  let same = 0;
  for (let i = 0; i < n; i++) if (Math.sign(trend[i]) === Math.sign(typical)) same++;
  if (same < 0.9 * n) return null;
  // The trend at the quietest fifth of the time
  const about = Float64Array.from(square, (p, i) => p - trend[i] * trend[i]);
  const bar = Float64Array.from(about).sort()[Math.floor(n / 5)];
  const quiet = new Float64Array(n);
  let q = 0;
  for (let i = 0; i < n; i++) if (about[i] <= bar) quiet[q++] = trend[i];
  const atQuiet = medianInPlace(quiet, q);
  return Math.abs(atQuiet) > limit && Math.sign(atQuiet) === Math.sign(typical) ? typical : null;
}

/** A DC offset (see offsetOf) in any channel, as one fault. */
function dcFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  const offsets = channels.map((x) => offsetOf(x, sampleRate));
  const found = offsets.flatMap((v, c) => (v === null ? [] : [{ v, c }]));
  if (found.length === 0) return [];
  let largest = found[0];
  for (const f of found) if (Math.abs(f.v) > Math.abs(largest.v)) largest = f;
  const value = round1(dbfs(Math.abs(largest.v)));
  const fault: Fault = { kind: 'dc', seconds: null, value, detail: `A DC offset of ${value.toFixed(1)} dBFS` };
  if (channels.length === 2 && found.length === 1) {
    fault.channel = sideName(largest.c);
    fault.detail += ` in the ${fault.channel} channel`;
  }
  return [fault];
}

// ---- Hum

/** The power at `hz` of a Hann-windowed frame (Goertzel), scaled so a sine of amplitude A on the bin reads A squared. */
function binPower(frame: Float64Array, hz: number, sampleRate: number): number {
  const c = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const n = frame.length;
  return ((s1 * s1 + s2 * s2 - c * s1 * s2) * 16) / (n * n);
}

/**
 * The middle, smoothed and kept every `step` samples (`step` divides the sample rate, so a second is a
 * whole number of them, and the rate stays near 3 kHz, far above the 185 Hz the hum bins reach). The
 * smoothing is two moving averages of `step`, whose nulls fall on the frequencies that would fold down.
 */
function slowMid(channels: readonly Float32Array[], sampleRate: number): { x: Float64Array; rate: number } {
  let step = Math.max(1, Math.floor(sampleRate / 3000));
  while (step > 1 && sampleRate % step !== 0) step--;
  const mid = midOf(channels);
  const once = movingAverage(Float64Array.from(mid), step);
  const twice = movingAverage(once, step);
  const x = new Float64Array(Math.floor(mid.length / step));
  for (let i = 0; i < x.length; i++) x[i] = twice[i * step + step - 1];
  return { x, rate: sampleRate / step };
}

/** The mean power at each needed bin and the power in each frame, of the middle in Hann-windowed 1-second frames (1 Hz bins). */
function humBins(channels: readonly Float32Array[], sampleRate: number, needed: Iterable<number>) {
  const { x: mid, rate } = slowMid(channels, sampleRate);
  const size = Math.round(rate);
  const frames = Math.floor(mid.length / size);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const perFrame = new Map<number, Float64Array>();
  for (const hz of needed) perFrame.set(hz, new Float64Array(frames));
  const frame = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) frame[i] = mid[f * size + i] * window[i];
    for (const [hz, power] of perFrame) power[f] = binPower(frame, (hz * rate) / size, rate);
  }
  const mean = new Map<number, number>();
  for (const [hz, power] of perFrame) {
    let sum = 0;
    for (const p of power) sum += p;
    mean.set(hz, frames > 0 ? sum / frames : 0);
  }
  return { frames, perFrame, mean };
}

/** The bins 2 to 5 Hz either side of `hz` (the window spreads a steady tone into the bins 1 Hz either side, so those are left out). */
const NEIGHBOURS = [-5, -4, -3, -2, 2, 3, 4, 5];
/** The widest comb spacing looked for, Hz (a pattern repeating a whole number of times a second puts a comb of lines at that spacing across the mains line). */
const COMB = 20;

/**
 * Mains hum at 50 or 60 Hz, read in 1-second frames (1 Hz bins). On the spectrum averaged over the
 * frames, the bin is a peak at least 12 dB over the median of its neighbours, and its second or third
 * harmonic a peak at least 6 dB over theirs. In each frame it stands at least 6 dB over its neighbours
 * in 90% of the frames, and its level there spans less than 3 dB (the middle 80% of frames). And it is not
 * in a comb (see comb): a kick or a note repeated a whole number of times a second (5, 6, 10, 12) makes
 * lines at that spacing which land on 50 or 60 Hz, while hum is one line with its harmonics, and a held
 * bass note beside it is one more line, not a comb. A note or a wobble comes and goes, or peaks off the
 * mains frequency; hum stays on it.
 */
function humFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  if (Math.floor((channels[0]?.length ?? 0) / Math.round(sampleRate)) < 4) return [];
  const needed = new Set<number>();
  for (const base of [50, 60]) {
    for (const h of [2, 3]) for (let k = -5; k <= 5; k++) needed.add(base * h + k);
    for (let k = -2 * COMB - 5; k <= 2 * COMB + 5; k++) needed.add(base + k);
  }
  const { frames, perFrame, mean } = humBins(channels, sampleRate, needed);
  const scratch = new Float64Array(NEIGHBOURS.length);
  /** The median of the neighbours of `hz` in `power` (the mean of the middle two). */
  const floorOf = (hz: number, power: (hz: number) => number): number => {
    NEIGHBOURS.forEach((k, i) => (scratch[i] = power(hz + k)));
    scratch.sort();
    return (scratch[3] + scratch[4]) / 2;
  };
  /** Whether `hz` is a peak `overDb` over its neighbours in the averaged spectrum. */
  const peak = (hz: number, overDb: number): boolean => {
    const p = mean.get(hz)!;
    return p > 1e-10 && p >= mean.get(hz - 1)! && p >= mean.get(hz + 1)! && p >= 10 ** (overDb / 10) * floorOf(hz, (f) => mean.get(f)!);
  };
  /** Whether `f` is a line: a local peak within 20 dB of `level`, standing 6 dB over its own neighbours. */
  const line = (f: number, level: number): boolean => {
    const p = mean.get(f)!;
    return p >= level / 100 && p >= mean.get(f - 1)! && p >= mean.get(f + 1)! && p >= 4 * floorOf(f, (g) => mean.get(g)!);
  };
  /**
   * Whether `hz` sits in a comb: for some spacing s of hz / m (m whole, s from 2 to 20 Hz: the rate of a
   * pattern repeated so many times a second that hz is one of its lines), there are lines at the bin
   * nearest hz - s or hz + s and at one more of hz - 2s, hz - s, hz + s, hz + 2s. One line beside it (a
   * held bass note) is no comb.
   */
  const comb = (hz: number): boolean => {
    const level = mean.get(hz)!;
    for (let m = Math.ceil(hz / COMB); hz / m >= 2; m++) {
      const spacing = hz / m;
      const at = (k: number) => line(Math.round(hz + k * spacing), level);
      const near = [-1, 1].filter(at).length;
      const far = [-2, 2].filter(at).length;
      if (near >= 1 && near + far >= 2) return true;
    }
    return false;
  };
  /** Whether `hz` stands 6 dB over its neighbours in 90% of the frames, steady within 3 dB there. */
  const steady = (hz: number): boolean => {
    const levels: number[] = [];
    for (let f = 0; f < frames; f++) {
      const p = perFrame.get(hz)![f];
      if (p > 1e-10 && p >= 4 * floorOf(hz, (h) => perFrame.get(h)![f])) levels.push(10 * Math.log10(p));
    }
    if (levels.length < 0.9 * frames) return false;
    levels.sort((a, b) => a - b);
    const cut = Math.floor(levels.length / 10);
    return levels[levels.length - 1 - cut] - levels[cut] < 3;
  };
  return [50, 60]
    .filter((base) => peak(base, 12) && !comb(base) && steady(base) && (peak(2 * base, 6) || peak(3 * base, 6)))
    .map((base): Fault => ({ kind: 'hum', seconds: null, value: base, detail: `Hum at ${base} Hz` }));
}

// ---- Silence

/** Runs of at least 50 ms of exact zeros in every channel, with sound before and after. */
function silenceFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  const n = channels.length > 0 ? channels[0].length : 0;
  const shortest = Math.round(sampleRate * 0.05);
  const zero = (i: number) => channels.every((x) => x[i] === 0);
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < n && zero(i)) i++; // silence before the sound starts is not a gap
  while (i < n) {
    if (!zero(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && zero(j)) j++;
    if (j < n && j - i >= shortest) runs.push([i, j]);
    i = j;
  }
  const faults: Fault[] = runs.slice(0, LISTED).map(([from, to]) => ({
    kind: 'silence',
    seconds: round3(from / sampleRate),
    endSeconds: round3(to / sampleRate),
    detail: 'Digital silence',
  }));
  const left = runs.length - LISTED;
  if (left > 0) faults.push({ kind: 'silence', seconds: null, count: left, detail: `${left} more stretches of digital silence` });
  return faults;
}

// ---- Channel

/** In a stereo pair: one side exactly silent while the other is not, or more than 10 dB under it. */
function channelFaults(channels: readonly Float32Array[]): Fault[] {
  if (channels.length !== 2) return [];
  const power = channels.map((x) => {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    return x.length > 0 ? sum / x.length : 0;
  });
  const quiet = power[0] <= power[1] ? 0 : 1;
  const loud = 1 - quiet;
  if (!(power[loud] > 0)) return [];
  const name = sideName(quiet);
  const other = sideName(loud);
  const capital = name === 'left' ? 'The left' : 'The right';
  if (power[quiet] === 0) return [{ kind: 'channel', seconds: null, channel: name, detail: `${capital} channel is silent` }];
  const under = 10 * Math.log10(power[loud] / power[quiet]);
  if (under <= 10) return [];
  return [{ kind: 'channel', seconds: null, channel: name, value: round1(under), detail: `${capital} channel is ${round1(under).toFixed(1)} dB under the ${other}` }];
}

/**
 * The faults in some sound, ordered by time, those without a time last. Each detail is one plain
 * sentence without its place or its full stop, which the report's words add, and says what its
 * `value` is and in what unit: a click's is the size of its jump from one sample to the next and
 * clipping's its highest peak, both dBFS; a DC offset's is the offset, dBFS; hum's is its frequency,
 * Hz; a quieter channel's is how far it is under the other, dB.
 */
export function faultsOf(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  if (channels.length === 0 || channels[0].length === 0) return [];
  const faults = [
    ...clickFaults(channels, sampleRate),
    ...clippingFault(channels, sampleRate),
    ...dcFaults(channels, sampleRate),
    ...humFaults(channels, sampleRate),
    ...silenceFaults(channels, sampleRate),
    ...channelFaults(channels),
  ];
  const key = (f: Fault) => (f.seconds === null ? Infinity : f.seconds);
  return faults.map((f, i) => ({ f, i })).sort((a, b) => key(a.f) - key(b.f) || a.i - b.i).map(({ f }) => f);
}
