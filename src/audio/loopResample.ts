/**
 * One turn of a looped sound at another sample rate: the same sound, band-limited (a Kaiser-windowed
 * sinc), kept to within 0.002 dB below 20 kHz; from 44.1 kHz up, nothing is added above 24 kHz but
 * traces 70 dB down. The copy loops as seamlessly as the original and lasts as long. The Tone noise
 * is made this way at every rate but 44.1 kHz (toneNoiseLoop in seededNoise.ts). resampleOnce does
 * the same to a sound that doesn't loop (silence before and after it): the designed rooms
 * (roomIR.ts roomAtRate). No audio engine here, so Node can unit-test it.
 *
 * (The browser plays a buffer made at another rate than its context's by reading between its
 * samples, a lowpass that took 1.7 dB off the Groove Drum Kit's snare noise at 48 kHz; and noise
 * made sample by sample at the new rate is another noise, which at 96 kHz spreads its level up to
 * 48 kHz, leaving 3.4 dB less of it below 20 kHz.)
 */

/** Zero crossings of the sinc each side, and the Kaiser window's beta: flat to 20 kHz from 44.1 kHz up, 70 dB down from 24.1 kHz. */
const HALF = 24;
const BETA = 7;
/** Most kernels kept (one per place between two samples a new sample can fall); past that, the nearest of this many. */
const MAX_PHASES = 4096;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 64; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * The kernels for new samples falling `phases` evenly spaced places between two old ones (each
 * `taps` long, the first old sample `reach - 1` before the new one), cutting at the lower rate's top:
 * `rho` is the new rate over the old, at most 1. `half`: the sinc's zero crossings each side.
 */
function kernelsFor(rho: number, phases: number, half = HALF): { kernels: Float64Array; reach: number; taps: number } {
  const reach = Math.ceil(half / rho);
  const taps = 2 * reach;
  const kernels = new Float64Array((phases + 1) * taps);
  const window0 = besselI0(BETA);
  for (let p = 0; p <= phases; p++) {
    const phase = p / phases;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const u = (j - reach + 1 - phase) * rho;
      const x = u / half;
      const w = Math.abs(x) >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - x * x)) / window0;
      const sinc = u === 0 ? 1 : Number.isInteger(u) ? 0 : Math.sin(Math.PI * u) / (Math.PI * u);
      kernels[p * taps + j] = sinc * w;
      sum += sinc * w;
    }
    // (Each kernel passes a steady level exactly)
    for (let j = 0; j < taps; j++) kernels[p * taps + j] /= sum;
  }
  return { kernels, reach, taps };
}

/**
 * New samples `i0` to `i1` of `out` from `ring` (the old samples, `reach - 1` of them before the
 * first), new sample i falling at i * step / exact old samples (see resampleLoop).
 */
function resampleInto(out: Float32Array, i0: number, i1: number, ring: Float64Array, step: number, exact: number, phases: number, kernels: Float64Array, taps: number): void {
  for (let i = i0; i < i1; i++) {
    const at = i * step;
    let k = Math.floor(at / exact);
    let p = at - k * exact;
    if (phases !== exact) {
      p = Math.round((p * phases) / exact);
      if (p === phases) {
        k += 1;
        p = 0;
      }
    }
    const base = p * taps;
    let acc = 0;
    for (let j = 0; j < taps; j++) acc += kernels[base + j] * ring[k + j];
    out[i] = acc;
  }
}

/** `data`, one turn of a loop at `from` Hz, at `to` Hz. At the same rate, a copy. */
export function resampleLoop(data: Float32Array, from: number, to: number): Float32Array<ArrayBuffer> {
  const size = data.length;
  const length = Math.max(1, Math.round((size * to) / from));
  if (length === size || size === 0) return Float32Array.from(data);
  // New sample i falls at i * size / length samples of the old: k whole ones and a phase in [0, 1)
  const common = gcd(size, length);
  const step = size / common;
  const exact = length / common;
  const phases = Math.min(exact, MAX_PHASES);
  // Below the old rate, cut at the new rate's top instead (a wider kernel)
  const { kernels, reach, taps } = kernelsFor(Math.min(1, length / size), phases);
  // The loop, with the samples either side of its seam from its other end
  const ring = new Float64Array(size + taps);
  for (let m = 0; m < ring.length; m++) ring[m] = data[(((m - reach + 1) % size) + size) % size];
  const out = new Float32Array(length);
  resampleInto(out, 0, length, ring, step, exact, phases, kernels, taps);
  return out;
}

/**
 * `data`, a sound at `from` Hz with silence before and after it (not a loop), at `to` Hz:
 * `length` samples (by default as long as it lasts, rounded), the same sound band-limited as
 * resampleLoop's. New sample i is at exactly i * from / to old samples. At the same rate, a copy.
 * `half`: the sinc's zero crossings each side; fewer is less work and less of the top kept (12:
 * half the work, within 0.003 dB to 18 kHz from 44.1 kHz, 0.8 dB down at 20 kHz).
 */
export function resampleOnce(data: Float32Array, from: number, to: number, length?: number, half = HALF): Float32Array<ArrayBuffer> {
  const steps = resampleOnceSteps(data, from, to, length, Infinity, half);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * resampleOnce in pieces, for long sounds made while the page plays: each step works out `piece`
 * more samples; the last gives the copy (the same, sample for sample).
 */
export function* resampleOnceSteps(data: Float32Array, from: number, to: number, length = Math.max(1, Math.round((data.length * to) / from)), piece = 8192, half = HALF): Generator<void, Float32Array<ArrayBuffer>> {
  const size = data.length;
  const out = new Float32Array(length);
  if (from === to || size === 0) {
    out.set(data.subarray(0, length));
    return out;
  }
  // (Whole numbers of hertz, as every rate is)
  const common = gcd(Math.round(from), Math.round(to));
  const step = Math.round(from) / common;
  const exact = Math.round(to) / common;
  const phases = Math.min(exact, MAX_PHASES);
  const { kernels, reach, taps } = kernelsFor(Math.min(1, to / from), phases, half);
  // Silence either side; the last new sample reaches at most taps past where it falls
  const last = Math.floor(((length - 1) * step) / exact) + 1;
  const ring = new Float64Array(Math.max(size, last) + taps);
  for (let m = 0; m < size; m++) ring[m + reach - 1] = data[m];
  for (let i = 0; i < length; i += piece) {
    resampleInto(out, i, Math.min(length, i + piece), ring, step, exact, phases, kernels, taps);
    if (i + piece < length) yield;
  }
  return out;
}
