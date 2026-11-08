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
  const once = onceResampler([data], from, to, length, half);
  once.run(0, once.length);
  return once.outs[0];
}

/** What onceResampler needs to take a sound from one rate to another (see placesFor). */
interface Places {
  /** Old samples a period of new ones reads, and new samples in it */
  step: number;
  exact: number;
  kernels: Float64Array;
  reach: number;
  taps: number;
  /** Each place in a period: the first old sample its kernel reads (from the period's first) */
  firstOf: Int32Array;
  /** ...where its kernel starts */
  rowOf: Int32Array;
  /** ...and the one tap of a kernel that's a single tap (else -1) */
  onOf: Int32Array;
}

/** The kernels and places made lately (see placesFor), by rates, kernel and gain: a few thousand Bessel functions each. */
const placesMade = new Map<string, Places>();

/** onceResampler's kernels (scaled by `gain`) and places in a period, from `from` Hz to `to` Hz. */
function placesFor(from: number, to: number, half: number, gain: number): Places {
  const key = `${from} ${to} ${half} ${gain}`;
  const have = placesMade.get(key);
  if (have) return have;
  // (Whole numbers of hertz, as every rate is)
  const common = gcd(Math.round(from), Math.round(to));
  const step = Math.round(from) / common;
  const exact = Math.round(to) / common;
  const phases = Math.min(exact, MAX_PHASES);
  const { kernels, reach, taps } = kernelsFor(Math.min(1, to / from), phases, half);
  if (gain !== 1) for (let i = 0; i < kernels.length; i++) kernels[i] *= gain;
  const firstOf = new Int32Array(exact);
  const rowOf = new Int32Array(exact);
  const onOf = new Int32Array(exact);
  for (let j = 0; j < exact; j++) {
    const at = j * step;
    let k = Math.floor(at / exact);
    let p = at - k * exact;
    if (phases !== exact) {
      p = Math.round((p * phases) / exact);
      if (p === phases) {
        k += 1;
        p = 0;
      }
    }
    firstOf[j] = k;
    rowOf[j] = p * taps;
    let on = -1;
    let others = 0;
    for (let t = 0; t < taps; t++) {
      if (kernels[p * taps + t] === 0) continue;
      if (on < 0) on = t;
      else others++;
    }
    onOf[j] = others === 0 ? on : -1;
  }
  const places = { step, exact, kernels, reach, taps, firstOf, rowOf, onOf };
  if (placesMade.size >= 8) placesMade.delete(placesMade.keys().next().value!);
  placesMade.set(key, places);
  return places;
}

/** Old samples' periods (see onceResampler) worked out together, the old samples they read near at hand. */
const PERIODS = 32;

/**
 * resampleOnce for `channels` together (as long as each other), scaled by `gain`, worked out in
 * any pieces: `run(i0, i1)` fills in new samples i0 to i1 of every copy in `outs`, each the same
 * sample for sample however the work is split (a long room is made a few milliseconds at a time
 * while the page plays: roomIR.ts). `length` new samples each.
 *
 * The new samples come round in periods (`to` / gcd of them each, reading `from` / gcd old ones),
 * each place in a period with its own kernel, so they're worked out place by place, that kernel
 * held in hand across many periods, with 24 taps (a room's: from 44.1 kHz up, ROOM_KERNEL) written
 * out in full: two to three times as fast as looking each sample's place and kernel up. A new
 * sample falling on an old one (every other at 88.2 kHz) is that one, scaled.
 */
export function onceResampler(channels: readonly Float32Array[], from: number, to: number, length = Math.max(1, Math.round(((channels[0]?.length ?? 0) * to) / from)), half = HALF, gain = 1): { outs: Float32Array<ArrayBuffer>[]; length: number; run: (i0: number, i1: number) => void } {
  const outs = channels.map(() => new Float32Array(length));
  const size = channels[0]?.length ?? 0;
  if (from === to || size === 0) {
    const run = (i0: number, i1: number) => {
      channels.forEach((c, n) => {
        const out = outs[n];
        for (let i = i0; i < Math.min(i1, c.length); i++) out[i] = gain * c[i];
      });
    };
    return { outs, length, run };
  }
  const { step, exact, kernels, reach, taps, firstOf, rowOf, onOf } = placesFor(from, to, half, gain);
  // Silence either side; the last new sample reaches at most taps past where it falls
  const last = Math.floor(((length - 1) * step) / exact) + 1;
  const rings = channels.map((c) => {
    const ring = new Float64Array(Math.max(size, last) + taps);
    for (let m = 0; m < size; m++) ring[m + reach - 1] = c[m];
    return ring;
  });
  const run = (i0: number, i1: number) => {
    i1 = Math.min(i1, length);
    if (i0 >= i1) return;
    const q0 = Math.floor(i0 / exact);
    const q1 = Math.ceil(i1 / exact);
    for (let qb = q0; qb < q1; qb += PERIODS) {
      const qe = Math.min(q1, qb + PERIODS);
      for (let j = 0; j < exact; j++) {
        // This place's new samples in these periods, from i0 to i1
        let q = qb;
        let o = qb * exact + j;
        if (o < i0) {
          const skip = Math.ceil((i0 - o) / exact);
          q += skip;
          o += skip * exact;
        }
        const end = Math.min(qe, Math.ceil((i1 - j) / exact));
        if (q >= end) continue;
        const k0 = q * step + firstOf[j];
        for (let n = 0; n < rings.length; n++) placeRun(outs[n], rings[n], kernels, rowOf[j], onOf[j], taps, o, k0, end - q, exact, step);
      }
    }
  };
  return { outs, length, run };
}

/**
 * `count` new samples of one place in a period (see onceResampler): out[o], out[o + exact], ...
 * from ring[k], ring[k + step], ... through the kernel at `b` (`on`: its one tap, if it has one).
 */
function placeRun(out: Float32Array, r: Float64Array, kernels: Float64Array, b: number, on: number, taps: number, o: number, k: number, count: number, exact: number, step: number): void {
  if (on >= 0) {
    const c = kernels[b + on];
    for (let n = 0; n < count; n++, o += exact, k += step) out[o] = c * r[k + on];
    return;
  }
  if (taps === 24) {
    const c0 = kernels[b], c1 = kernels[b + 1], c2 = kernels[b + 2], c3 = kernels[b + 3], c4 = kernels[b + 4], c5 = kernels[b + 5];
    const c6 = kernels[b + 6], c7 = kernels[b + 7], c8 = kernels[b + 8], c9 = kernels[b + 9], c10 = kernels[b + 10], c11 = kernels[b + 11];
    const c12 = kernels[b + 12], c13 = kernels[b + 13], c14 = kernels[b + 14], c15 = kernels[b + 15], c16 = kernels[b + 16], c17 = kernels[b + 17];
    const c18 = kernels[b + 18], c19 = kernels[b + 19], c20 = kernels[b + 20], c21 = kernels[b + 21], c22 = kernels[b + 22], c23 = kernels[b + 23];
    for (let n = 0; n < count; n++, o += exact, k += step) {
      const a = c0 * r[k] + c1 * r[k + 1] + c2 * r[k + 2] + c3 * r[k + 3] + c4 * r[k + 4] + c5 * r[k + 5];
      const d = c6 * r[k + 6] + c7 * r[k + 7] + c8 * r[k + 8] + c9 * r[k + 9] + c10 * r[k + 10] + c11 * r[k + 11];
      const e = c12 * r[k + 12] + c13 * r[k + 13] + c14 * r[k + 14] + c15 * r[k + 15] + c16 * r[k + 16] + c17 * r[k + 17];
      const f = c18 * r[k + 18] + c19 * r[k + 19] + c20 * r[k + 20] + c21 * r[k + 21] + c22 * r[k + 22] + c23 * r[k + 23];
      out[o] = a + d + (e + f);
    }
    return;
  }
  for (let n = 0; n < count; n++, o += exact, k += step) {
    let acc = 0;
    for (let t = 0; t < taps; t++) acc += kernels[b + t] * r[k + t];
    out[o] = acc;
  }
}
