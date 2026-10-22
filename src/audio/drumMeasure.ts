/**
 * Measures of a single drum hit (a rendered Drum Designer sound, see drumSynth.ts) against the
 * targets the layered kick and snare are made to: how quickly the kick's low end falls, how loud
 * its click is against its low end, how strong its body's harmonics are, how quickly a snare's
 * transient falls, where its noise sits, how long its room rings and how loud it peaks as heard
 * (K-weighted) next to a kick. Plain maths, no Web Audio: the unit tests and the dev scripts use it.
 */
import { kWeightingFilters } from './loudness';

/** [b0, b1, b2, a1, a2] */
type Biquad = [number, number, number, number, number];

function biquad(type: 'low' | 'high', hz: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b = type === 'low' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

function run(x: Float64Array, [b0, b1, b2, a1, a2]: readonly number[]): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** `x` band-passed to [lo, hi] Hz (fourth-order slopes each side; lo 0: low-passed only). */
export function band(x: Float32Array, sampleRate: number, lo: number, hi: number): Float64Array {
  const y = Float64Array.from(x);
  for (let k = 0; k < 2; k++) {
    if (lo > 0) run(y, biquad('high', lo, sampleRate));
    if (hi < sampleRate / 2) run(y, biquad('low', hi, sampleRate));
  }
  return y;
}

/** RMS per `frameMs` frame, dB. */
export function frameDb(y: ArrayLike<number>, sampleRate: number, frameMs = 1): number[] {
  const w = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const out: number[] = [];
  for (let i = 0; i + w <= y.length; i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += y[j] * y[j];
    out.push(10 * Math.log10(s / w + 1e-20));
  }
  return out;
}

/** Milliseconds from the loudest frame until the level first falls `db` under it, or the length. */
export function firstFallMs(env: readonly number[], db: number, frameMs = 1): number {
  let top = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[top]) top = i;
  for (let i = top; i < env.length; i++) if (env[i] <= env[top] - db) return (i - top) * frameMs;
  return (env.length - top) * frameMs;
}

/** Milliseconds from the loudest frame until the level is `db` under it (and stays under), or the length. */
export function fallMs(env: readonly number[], db: number, frameMs = 1): number {
  let top = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[top]) top = i;
  let last = top;
  for (let i = top; i < env.length; i++) if (env[i] > env[top] - db) last = i;
  return (last + 1 - top) * frameMs;
}

/** The power of `x` (from `from` for `n` samples) at `hz`, by Goertzel with a Hann window. */
function powerAt(x: ArrayLike<number>, from: number, n: number, hz: number, sampleRate: number): number {
  const k = (2 * Math.cos((2 * Math.PI * hz) / sampleRate));
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s = (x[from + i] ?? 0) * w + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

/** The loudest 10 ms (K-weighted mean square) in the first 60 ms of the hit, dB: how loud it hits, as heard. */
export function kPeakDb(x: Float32Array, sampleRate: number): number {
  const y = Float64Array.from(x);
  for (const q of kWeightingFilters(sampleRate)) run(y, q);
  const w = Math.round(0.01 * sampleRate);
  const end = Math.min(y.length, Math.round(0.07 * sampleRate));
  let best = 0;
  let sum = 0;
  for (let i = 0; i < end; i++) {
    sum += y[i] * y[i];
    if (i >= w) sum -= y[i - w] * y[i - w];
    best = Math.max(best, sum / w);
  }
  return 10 * Math.log10(best + 1e-20);
}

export interface KickMeasure {
  /** How long 30-150 Hz takes to fall 20 dB from its loudest, ms (an EDM kick: 100-180) */
  lowFall20Ms: number;
  /** 1-5 kHz against 30-150 Hz in the first 12 ms, dB (a click: -1.5 to -15) */
  clickDb: number;
  /** The body's 2nd to 8th harmonics against its fundamental (40-120 ms in, at the tail pitch), dB (driven: up to +7) */
  harmonicsDb: number;
  /** The pitch 3-8 ms in and 60-120 ms in, Hz (zero crossings of the low end) */
  startHz: number;
  endHz: number;
  /** The share of the hit's energy under 60 Hz (the sub a bass would want) */
  subShare: number;
}

function crossingsHz(y: ArrayLike<number>, sampleRate: number, from: number, to: number): number {
  const a = Math.round(from * sampleRate);
  const b = Math.min(y.length, Math.round(to * sampleRate));
  let n = 0;
  let first = -1;
  let last = -1;
  for (let i = a + 1; i < b; i++) {
    if ((y[i - 1] < 0) !== (y[i] < 0)) {
      if (first < 0) first = i;
      last = i;
      n++;
    }
  }
  // (Every crossing, up and down: two a cycle)
  return n > 1 ? ((n - 1) * sampleRate) / (last - first) / 2 : 0;
}

/** A kick hit's measures (`tailHz`: its tail pitch, for the harmonics). */
export function measureKick(x: Float32Array, sampleRate: number, tailHz: number): KickMeasure {
  const low = band(x, sampleRate, 30, 150);
  const lowFall20Ms = fallMs(frameDb(low, sampleRate, 1), 20, 1);
  const n12 = Math.round(0.012 * sampleRate);
  const hi = band(x, sampleRate, 1000, 5000);
  let eh = 0;
  let el = 0;
  for (let i = 0; i < n12 && i < x.length; i++) {
    eh += hi[i] * hi[i];
    el += low[i] * low[i];
  }
  const from = Math.round(0.04 * sampleRate);
  const n = Math.round(0.08 * sampleRate);
  const p1 = powerAt(x, from, n, tailHz, sampleRate);
  let ph = 0;
  for (let k = 2; k <= 8; k++) ph += powerAt(x, from, n, tailHz * k, sampleRate);
  const smooth = band(x, sampleRate, 0, 400);
  const sub = band(x, sampleRate, 0, 60);
  let es = 0;
  let et = 0;
  for (let i = 0; i < x.length; i++) {
    es += sub[i] * sub[i];
    et += x[i] * x[i];
  }
  return {
    lowFall20Ms,
    clickDb: 10 * Math.log10((eh + 1e-20) / (el + 1e-20)),
    harmonicsDb: 10 * Math.log10((ph + 1e-20) / (p1 + 1e-20)),
    startHz: crossingsHz(smooth, sampleRate, 0.003, 0.012),
    endHz: crossingsHz(smooth, sampleRate, 0.06, 0.12),
    subShare: es / (et + 1e-20),
  };
}

export interface SnareMeasure {
  /** How long the hit's front takes to first fall 12 dB from its loudest, ms (a transient: 7-25) */
  transientFall12Ms: number;
  /** The body's pitch: the strongest of 100-250 Hz, 10-60 ms in */
  bodyHz: number;
  /** The spectral centroid over 1-16 kHz, 10-80 ms in (the noise: 3.5-6 kHz) */
  noiseCentroidHz: number;
  /** How long 1-10 kHz takes to fall 20 dB from its loudest, ms (a room: 300-700) */
  roomFall20Ms: number;
}

/** A snare hit's measures. */
export function measureSnare(x: Float32Array, sampleRate: number): SnareMeasure {
  const transientFall12Ms = firstFallMs(frameDb(x, sampleRate, 1), 12, 1);
  const from = Math.round(0.01 * sampleRate);
  const n = Math.round(0.05 * sampleRate);
  let bodyHz = 100;
  let best = -1;
  for (let hz = 100; hz <= 250; hz += 1) {
    const p = powerAt(x, from, n, hz, sampleRate);
    if (p > best) {
      best = p;
      bodyHz = hz;
    }
  }
  const hf = band(x, sampleRate, 1000, 16000);
  const nf = Math.round(0.07 * sampleRate);
  let num = 0;
  let den = 0;
  for (let hz = 1000; hz <= 16000; hz += 250) {
    const p = powerAt(hf, from, nf, hz, sampleRate);
    num += p * hz;
    den += p;
  }
  const room = band(x, sampleRate, 1000, 10000);
  return { transientFall12Ms, bodyHz, noiseCentroidHz: num / (den + 1e-20), roomFall20Ms: fallMs(frameDb(room, sampleRate, 5), 20, 5) };
}
