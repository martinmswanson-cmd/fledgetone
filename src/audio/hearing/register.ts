/**
 * Where the pitched parts of a sound sit, for the hearing report: its register. The harmonic part of
 * the channels' mix (at 12 kHz, which keeps every overtone it looks at) is cut into frames; in each, the clear spectral peaks are gathered, and the parts
 * that sound are picked one at a time by harmonic sum (the note on a 1/12-octave grid whose peak and
 * overtones hold the most energy), each pick's overtones then taken out so an overtone doesn't read
 * as a part of its own. From the parts picked: the low, centre and high of the pitched energy, the
 * top line, and the share of it in each octave. Every level is relative to the sound itself, so
 * the reading doesn't depend on how loud it plays. Plain maths on samples, no Web Audio, so Node can
 * test it.
 */
import { analysisMix } from '../channelMix';
import { fftInPlace } from '../fft';
import { harmonicPercussive } from '../harmonicPercussive';
import { resampleOnce } from '../loopResample';
import type { Register } from './types';

/** The rate the register is measured at, Hz (a sound at a lower rate is measured at its own): enough for overtones to 5 kHz, and a quarter of the work of 48 kHz. */
const MEASURE_RATE = 12000;
/** The resampling's sinc reaches this many zero crossings each side: flat to 4.9 kHz at 12 kHz, 0.3 dB down at 5.1 kHz. */
const RESAMPLE_HALF = 12;
/** The range of a part's pitch, Hz (B0 to C8 on the grid). */
const LOWEST_HZ = 30;
const HIGHEST_HZ = 4200;
/** Overtones are looked for up to this frequency, Hz, and this many of them (the fundamental counted). */
const OVERTONES_UP_TO_HZ = 5000;
const MAX_HARMONICS = 20;
/** An overtone is the peak within this share of its expected frequency. */
const HARMONIC_TOLERANCE = 0.03;
/**
 * A peak stands this far over the floor of the spectrum about a quarter of an octave around it (at
 * least 6 bins either side), dB; the floor is the lower tenth of the bins there, what lies between
 * the peaks.
 */
const PEAK_DB = 25;
const LOW_QUANTILE = 0.1;
/** Peaks under this frequency are left out (what's under the lowest pitch is rumble), Hz. */
const PEAKS_FROM_HZ = 25;
/** The parts kept in a frame: within this of its strongest, dB; and at most this many. */
const KEEP_DB = 15;
const MAX_PARTS = 8;
/** The top line of a frame: its highest part within this of its strongest, dB. */
const TOP_DB = 10;
/** A part counts only within this of the loudest frame of the whole sound, dB. */
const FLOOR_DB = 40;
/** A part's fundamental holds at least this share of the power at its harmonics (a part is not read from a stray peak under another's). */
const ROOT_SHARE = 0.03;
/** A peak starts a part of its own only while this share of its power is not yet some lower part's overtone. */
const FRESH_SHARE = 0.25;
/** Under this share of its frames holding a part, a sound has no register. */
const MIN_PITCHED_SHARE = 0.05;
/** A frame holds parts only when they hold this share of its energy (noise has its peaks, but they hold little). */
const FRAME_SHARE = 0.25;
/** Notes up to this far apart, semitones, are read between (a whole tone, and a little for tuning). */
const WHOLE_TONE = 2.5;
/** C1, Hz: where the first of the eight octaves starts. */
const C1_HZ = 440 * 2 ** (-45 / 12);

/** Whole Hz from 100 Hz up, tenths under it. */
const roundHz = (hz: number) => (hz >= 100 ? Math.round(hz) : Math.round(hz * 10) / 10);

/** The frame size for `sampleRate`: 4096 at 48 kHz, the nearest power of two to the same length elsewhere. */
const frameSize = (sampleRate: number) => 2 ** Math.max(8, Math.round(Math.log2((4096 * sampleRate) / 48000)));

/** A part heard in a frame: its pitch, Hz, and the energy of its peak and overtones. */
interface Part {
  hz: number;
  energy: number;
}

/**
 * The energy-weighted percentile `p` (0 to 1) of the pitches of `notes` (sorted by pitch): each note
 * stands at the middle of its share of the energy. Between two notes up to a whole tone apart the
 * pitch is read on the line from one to the other (in octaves), so a percentile moves smoothly as
 * the energy shifts between neighbouring notes; across a wider gap it is the note whose share it
 * falls in, so a little energy far off does not pull it across the gap.
 */
function percentile(notes: readonly Part[], total: number, p: number): number {
  const target = p * total;
  let before = 0;
  for (let i = 0; i < notes.length; i++) {
    const at = before + notes[i].energy / 2;
    if (target <= at || i === notes.length - 1) return notes[i].hz;
    const next = notes[i + 1];
    const nextAt = before + notes[i].energy + next.energy / 2;
    if (target < nextAt) {
      const apart = 12 * Math.log2(next.hz / notes[i].hz);
      if (apart > WHOLE_TONE) return target < before + notes[i].energy ? notes[i].hz : next.hz;
      return notes[i].hz * (next.hz / notes[i].hz) ** ((target - at) / (nextAt - at));
    }
    before += notes[i].energy;
  }
  return notes[notes.length - 1].hz;
}

/** The `k`-th smallest (from 0) of the first `n` of `values`, which it reorders (Hoare's selection). */
function kthOf(values: Float64Array, n: number, k: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const t = values[i];
        values[i] = values[j];
        values[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}

/** The median of `values` (not empty). */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Shares (each 0 to 1) rounded to 2 places so that they still add to 1: each rounded down, then the
 * hundredths left over given to the largest remainders.
 */
function sharesOf(weights: readonly number[], total: number): number[] {
  const raw = weights.map((w) => (w / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - floors[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return floors.map((f) => f / 100);
}

/**
 * The parts heard in one frame's power spectrum (`power`, `size / 2 + 1` bins), strongest first. Peaks
 * are local maxima standing PEAK_DB over the spectrum around them (noise seldom does), placed by a
 * parabola through the log power. Then, while a part is left within KEEP_DB of the first: for each
 * semitone of the grid, its strongest peak as a fundamental, with the peaks at its overtones; the one
 * with the most power still unexplained is the next part. Its fundamental is taken out whole, each
 * overtone by as much as the overtones either side of it hold (the smooth series a note's overtones
 * make), so a louder note sitting on one of them keeps the rest.
 */
function partsOfFrame(power: Float64Array, sampleRate: number, size: number, energy: number): Part[] {
  const half = size / 2;
  const binHz = sampleRate / size;
  // The log power, floored 120 dB under the frame's energy
  const tiny = energy * 1e-12;
  const logs = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) logs[k] = Math.log(power[k] + tiny);
  const from = Math.max(2, Math.ceil(PEAKS_FROM_HZ / binHz));
  const to = Math.min(half - 1, Math.floor((OVERTONES_UP_TO_HZ * (1 + HARMONIC_TOLERANCE)) / binHz));
  const over = (PEAK_DB / 10) * Math.LN10;
  const freqs: number[] = [];
  const powers: number[] = [];
  const scratch = new Float64Array(half + 1);
  // The floor about bin k, read at every third of its reach and kept (it changes slowly along the bins)
  const floors = new Float64Array(half + 1).fill(NaN);
  const floorAt = (k: number): number => {
    const reach = Math.max(6, Math.round(k * 0.19));
    const at = k - (k % Math.max(1, Math.round(reach / 3)));
    if (Number.isNaN(floors[at])) {
      const lo = Math.max(1, at - reach);
      const hi = Math.min(half, at + reach);
      const n = hi - lo + 1;
      for (let i = 0; i < n; i++) scratch[i] = logs[lo + i];
      floors[at] = kthOf(scratch, n, Math.floor(LOW_QUANTILE * (n - 1)));
    }
    return floors[at];
  };
  for (let k = from; k <= to; k++) {
    if (!(logs[k] > logs[k - 1] && logs[k] >= logs[k + 1])) continue;
    if (logs[k] - floorAt(k) < over) continue;
    const a = logs[k - 1];
    const b = logs[k];
    const c = logs[k + 1];
    const bend = a - 2 * b + c;
    const offset = bend < 0 ? (0.5 * (a - c)) / bend : 0;
    freqs.push((k + offset) * binHz);
    powers.push(Math.exp(b - 0.25 * (a - c) * offset));
  }
  if (freqs.length === 0) return [];

  /** The index of the peak nearest `hz` within the tolerance, or -1. */
  const nearest = (hz: number): number => {
    let lo = 0;
    let hi = freqs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (freqs[mid] < hz) lo = mid + 1;
      else hi = mid;
    }
    let best = -1;
    let gap = hz * HARMONIC_TOLERANCE;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= freqs.length) continue;
      const d = Math.abs(freqs[i] - hz);
      if (d <= gap) {
        gap = d;
        best = i;
      }
    }
    return best;
  };

  // The candidates: per semitone of the grid, its strongest peak, and the peaks at its overtones
  const firstNote = Math.ceil(69 + 12 * Math.log2(LOWEST_HZ / 440));
  const lastNote = Math.floor(69 + 12 * Math.log2(HIGHEST_HZ / 440));
  const candidates: Array<{ harmonics: number[] }> = [];
  let p = 0;
  for (let note = firstNote; note <= lastNote; note++) {
    const bandLo = 440 * 2 ** ((note - 69.5) / 12);
    const bandHi = 440 * 2 ** ((note - 68.5) / 12);
    while (p < freqs.length && freqs[p] < bandLo) p++;
    let root = -1;
    for (let i = p; i < freqs.length && freqs[i] < bandHi; i++) if (root < 0 || powers[i] > powers[root]) root = i;
    if (root < 0) continue;
    // Each overtone looked for where the pitch read so far puts it (energy-weighted, from the peaks found)
    const harmonics = [root];
    let pitchSum = freqs[root] * powers[root];
    let weight = powers[root];
    for (let h = 2; h <= MAX_HARMONICS; h++) {
      const expected = (h * pitchSum) / weight;
      if (expected > OVERTONES_UP_TO_HZ) break;
      const i = nearest(expected);
      harmonics.push(i);
      if (i >= 0) {
        pitchSum += (freqs[i] / h) * powers[i];
        weight += powers[i];
      }
    }
    candidates.push({ harmonics });
  }

  const left = Float64Array.from(powers);
  const parts: Part[] = [];
  let held = 0;
  let strongest = 0;
  const keep = 10 ** (-KEEP_DB / 10);
  while (parts.length < MAX_PARTS) {
    let best = -1;
    let bestSum = 0;
    for (let c = 0; c < candidates.length; c++) {
      const { harmonics } = candidates[c];
      const root = harmonics[0];
      if (!(left[root] > FRESH_SHARE * powers[root])) continue;
      let sum = 0;
      for (const i of harmonics) if (i >= 0) sum += left[i];
      if (sum > bestSum && left[root] >= ROOT_SHARE * sum) {
        bestSum = sum;
        best = c;
      }
    }
    if (best < 0) break;
    const { harmonics } = candidates[best];
    // What it explains: its fundamental whole, and of each overtone the power the overtones either side
    // of it hold (the mean of their amplitudes, squared), as far as the overtone has it
    const amps = harmonics.map((i) => (i >= 0 ? Math.sqrt(left[i]) : 0));
    const explained = harmonics.map((i, h) => {
      if (i < 0) return 0;
      if (h === 0) return left[i];
      let below = -1;
      for (let j = h - 1; j >= 0 && below < 0; j--) if (harmonics[j] >= 0) below = j;
      let above = -1;
      for (let j = h + 1; j < harmonics.length && above < 0; j++) if (harmonics[j] >= 0) above = j;
      const sides = [below, above].filter((j) => j >= 0).map((j) => amps[j]);
      const expected = sides.reduce((a, b) => a + b, 0) / sides.length;
      return Math.min(left[i], expected * expected);
    });
    const partEnergy = explained.reduce((a, b) => a + b, 0);
    if (parts.length === 0) strongest = partEnergy;
    else if (partEnergy < strongest * keep) break;
    // Its pitch, from its peaks as they were heard
    let pitchSum = 0;
    let weight = 0;
    harmonics.forEach((i, h) => {
      if (i < 0) return;
      pitchSum += (freqs[i] / (h + 1)) * powers[i];
      weight += powers[i];
      left[i] -= explained[h];
    });
    parts.push({ hz: pitchSum / weight, energy: partEnergy });
    held += partEnergy;
  }
  return held >= FRAME_SHARE * energy ? parts : [];
}

/**
 * Where the pitched parts of `channels` sit; null when they hold no pitched content (fewer than one
 * frame in twenty has a part: drums, noise, silence).
 */
export function registerOf(channels: readonly Float32Array[], sampleRate: number): Register | null {
  if ((channels[0]?.length ?? 0) === 0) return null;
  const mix = analysisMix(channels);
  const rate = Math.min(sampleRate, MEASURE_RATE);
  const x = rate === sampleRate ? mix : resampleOnce(mix, sampleRate, rate, undefined, RESAMPLE_HALF);
  // (the split may work in a fresh array, not in the caller's own channel)
  const harmonic = harmonicPercussive([x], rate).parts([x], x !== channels[0]).harmonic[0];
  const length = harmonic.length;

  const size = frameSize(rate);
  const hop = size / 4;
  const half = size / 2;
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const power = new Float64Array(half + 1);
  const count = length <= size ? 1 : Math.floor((length - size) / hop) + 1;
  const frames: Part[][] = [];
  let loudest = 0;
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = start + i < length ? harmonic[start + i] * window[i] : 0;
      im[i] = 0;
    }
    fftInPlace(re, im);
    let energy = 0;
    for (let k = 0; k <= half; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      energy += power[k];
    }
    loudest = Math.max(loudest, energy);
    frames.push(energy > 0 && Number.isFinite(energy) ? partsOfFrame(power, rate, size, energy) : []);
  }

  // Only parts within FLOOR_DB of the loudest frame count
  const floor = loudest * 10 ** (-FLOOR_DB / 10);
  const heard = frames.map((parts) => parts.filter((part) => part.energy >= floor && Number.isFinite(part.hz)));
  const pitched = heard.filter((parts) => parts.length > 0);
  if (pitched.length < MIN_PITCHED_SHARE * count) return null;

  // The energy of each note heard, at the mean pitch it was heard at, low to high
  const notes = new Map<number, { hzSum: number; energy: number }>();
  let total = 0;
  for (const part of pitched.flat()) {
    const note = Math.round(12 * Math.log2(part.hz / 440));
    const sum = notes.get(note) ?? { hzSum: 0, energy: 0 };
    sum.hzSum += part.hz * part.energy;
    sum.energy += part.energy;
    notes.set(note, sum);
    total += part.energy;
  }
  if (!(total > 0)) return null;
  const all = [...notes.values()].map(({ hzSum, energy }) => ({ hz: hzSum / energy, energy })).sort((a, b) => a.hz - b.hz);
  const tops = pitched.flatMap((parts) => {
    let strongest = 0;
    for (const part of parts) strongest = Math.max(strongest, part.energy);
    let top = 0;
    for (const part of parts) if (part.energy >= strongest * 10 ** (-TOP_DB / 10)) top = Math.max(top, part.hz);
    return top > 0 ? [top] : [];
  });
  const octaves = new Array<number>(8).fill(0);
  for (const part of all) {
    const note = Math.round(12 * Math.log2(part.hz / C1_HZ));
    octaves[Math.min(7, Math.max(0, Math.floor(note / 12)))] += part.energy;
  }
  return {
    lowHz: roundHz(percentile(all, total, 0.1)),
    highHz: roundHz(percentile(all, total, 0.9)),
    centreHz: roundHz(percentile(all, total, 0.5)),
    topHz: tops.length ? roundHz(median(tops)) : null,
    octaves: sharesOf(octaves, total),
  };
}
