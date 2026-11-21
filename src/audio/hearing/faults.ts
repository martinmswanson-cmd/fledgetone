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

/**
 * How alike the wave is around a and around b, `half` samples either side: their correlation (an
 * offset or a slow wave beneath, such as a kick under a bass, barely counts), at the best of a few
 * small shifts, so a clipped wave's corners match cycle after cycle wherever they fall between samples.
 */
function sameShape(x: Float32Array, a: number, b: number, half: number): number {
  let best = -1;
  for (let shift = -2; shift <= 2; shift++) {
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    let n = 0;
    for (let k = -half; k <= half; k++) {
      const i = a + k;
      const j = b + k + shift;
      if (i < 0 || j < 0 || i >= x.length || j >= x.length) continue;
      const u = x[i];
      const v = x[j];
      sa += u;
      sb += v;
      saa += u * u;
      sbb += v * v;
      sab += u * v;
      n++;
    }
    if (n < 4) continue;
    const cov = sab - (sa * sb) / n;
    const va = saa - (sa * sa) / n;
    const vb = sbb - (sb * sb) / n;
    if (va > 0 && vb > 0) best = Math.max(best, cov / Math.sqrt(va * vb));
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
        if (Math.abs(d[other]) >= size / 4 && sameShape(x, peak, other, 24) >= LIKE) return;
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
    const fault: Fault = { kind: 'click', seconds: round3(k.at / sampleRate), value: round1(dbfs(k.jump)), detail: 'A click' };
    if (channels.length === 2 && k.channels.size === 1) {
      const [c] = k.channels;
      fault.channel = sideName(c);
    }
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
      if (Math.abs(x[i]) < 0.99) {
        i++;
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
  return [
    {
      kind: 'clipping',
      seconds: round3(firstAt / sampleRate),
      count: runs,
      value: round1(dbfs(peak)),
      detail: `Clipping at full scale, ${runs} ${runs === 1 ? 'run' : 'runs'}`,
    },
  ];
}

// ---- DC

/** A channel's mean above -50 dBFS, also in the median of its 50 ms means (so a row of kicks, each with a lean, is no offset). */
function dcFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  const limit = 0.00316;
  const offsets: Array<number | null> = channels.map((x) => {
    if (x.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i];
    const mean = sum / x.length;
    if (Math.abs(mean) <= limit) return null;
    const block = Math.max(1, Math.round(sampleRate * 0.05));
    const means = new Float64Array(Math.ceil(x.length / block));
    for (let b = 0; b < means.length; b++) {
      let s = 0;
      const to = Math.min(x.length, (b + 1) * block);
      for (let i = b * block; i < to; i++) s += x[i];
      means[b] = s / (to - b * block);
    }
    const typical = medianInPlace(means, means.length);
    return Math.abs(typical) > limit && Math.sign(typical) === Math.sign(mean) ? mean : null;
  });
  const found = offsets.flatMap((v, c) => (v === null ? [] : [{ v, c }]));
  if (found.length === 0) return [];
  let largest = found[0];
  for (const f of found) if (Math.abs(f.v) > Math.abs(largest.v)) largest = f;
  const fault: Fault = { kind: 'dc', seconds: null, value: round1(dbfs(Math.abs(largest.v))), detail: 'A DC offset' };
  if (channels.length === 2 && found.length === 1) fault.channel = sideName(largest.c);
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

/** The mean power at each needed bin and the power in each frame, of the middle in Hann-windowed 1-second frames (1 Hz bins). */
function humBins(channels: readonly Float32Array[], sampleRate: number, needed: Iterable<number>) {
  const size = Math.round(sampleRate);
  const mid = midOf(channels);
  const frames = Math.floor(mid.length / size);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const perFrame = new Map<number, Float64Array>();
  for (const hz of needed) perFrame.set(hz, new Float64Array(frames));
  const frame = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) frame[i] = mid[f * size + i] * window[i];
    for (const [hz, power] of perFrame) power[f] = binPower(frame, (hz * sampleRate) / size, sampleRate);
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

/**
 * Mains hum at 50 or 60 Hz, read in 1-second frames (1 Hz bins). On the spectrum averaged over the
 * frames, the bin is a peak at least 12 dB over the median of its neighbours, and its second or third
 * harmonic a peak at least 6 dB over theirs. In each frame it stands at least 6 dB over its neighbours
 * in 90% of the frames, and its level there spans less than 3 dB (the middle 80% of frames). A note or a
 * wobble comes and goes, or peaks off the mains frequency; hum stays on it.
 */
function humFaults(channels: readonly Float32Array[], sampleRate: number): Fault[] {
  if (Math.floor((channels[0]?.length ?? 0) / Math.round(sampleRate)) < 4) return [];
  const needed = new Set<number>();
  for (const base of [50, 60]) for (const h of [1, 2, 3]) for (let k = -5; k <= 5; k++) needed.add(base * h + k);
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
    .filter((base) => peak(base, 12) && steady(base) && (peak(2 * base, 6) || peak(3 * base, 6)))
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
  return [{ kind: 'channel', seconds: null, channel: name, value: round1(under), detail: `${capital} channel is ${round1(under)} dB under the ${other}` }];
}

/**
 * The faults in some sound, ordered by time, those without a time last. Each detail is one plain
 * sentence without the place, which the report adds.
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
