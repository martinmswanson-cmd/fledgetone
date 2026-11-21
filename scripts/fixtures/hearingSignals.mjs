// Made test signals for the hearing tests (scripts/hearing*.test.mjs): tones, noise, modulated and
// gated sounds, bursts and the little tools to place, mix, clip and filter them. Every function
// returns a Float32Array; noise comes from a seeded generator so a test repeats exactly.
import { fftInPlace } from '../../src/audio/fft.ts';

export const SR = 48000;

const lin = (db) => 10 ** (db / 20);
const count = (seconds, sr) => Math.round(seconds * sr);

/** A repeatable uniform generator (mulberry32), 0 to 1. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal noise from the seeded generator. */
function gaussian(n, seed) {
  const rnd = random(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  return out;
}

/** `x` scaled so its peak is `peakDb` full scale. */
function toPeak(x, peakDb) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? lin(peakDb) / peak : 0;
  return Float32Array.from(x, (v) => v * g);
}

/** `x` scaled so its RMS is `rmsDb` full scale. */
function toRms(x, rmsDb) {
  let sum = 0;
  for (const v of x) sum += v * v;
  const g = sum > 0 ? lin(rmsDb) / Math.sqrt(sum / x.length) : 0;
  return Float32Array.from(x, (v) => v * g);
}

/** A sine of `hz`, peaking at `peakDb`. */
export function sine(hz, seconds, peakDb, sr = SR) {
  const a = lin(peakDb);
  const out = new Float32Array(count(seconds, sr));
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

/** A band-limited sawtooth (harmonics up to the Nyquist, falling as 1/k), peaking at `peakDb`. */
export function saw(hz, seconds, peakDb, sr = SR) {
  const n = count(seconds, sr);
  const x = new Float64Array(n);
  for (let k = 1; k * hz < sr / 2; k++) {
    const w = (2 * Math.PI * k * hz) / sr;
    for (let i = 0; i < n; i++) x[i] += Math.sin(w * i) / k;
  }
  return toPeak(x, peakDb);
}

/** White noise at `rmsDb` RMS. */
export function white(seconds, rmsDb, seed = 1, sr = SR) {
  return toRms(gaussian(count(seconds, sr), seed), rmsDb);
}

/** Pink noise (power falling 3 dB per octave) at `rmsDb` RMS. */
export function pink(seconds, rmsDb, seed = 1, sr = SR) {
  const w = gaussian(count(seconds, sr), seed);
  const out = new Float64Array(w.length);
  // Paul Kellet's economy filter
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < w.length; i++) {
    const v = w[i];
    b0 = 0.99886 * b0 + v * 0.0555179;
    b1 = 0.99332 * b1 + v * 0.0750759;
    b2 = 0.969 * b2 + v * 0.153852;
    b3 = 0.8665 * b3 + v * 0.3104856;
    b4 = 0.55 * b4 + v * 0.5329522;
    b5 = -0.7616 * b5 - v * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362;
    b6 = v * 0.115926;
  }
  return toRms(out, rmsDb);
}

/** A sine carrier whose level wobbles `rateHz` times a second by `depth` (0 to 1); the peak is `peakDb`. */
export function am(carrierHz, rateHz, depth, seconds, peakDb, sr = SR) {
  const n = count(seconds, sr);
  const a = lin(peakDb) / (1 + depth);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = a * (1 + depth * Math.sin(2 * Math.PI * rateHz * t)) * Math.sin(2 * Math.PI * carrierHz * t);
  }
  return out;
}

/**
 * `x` gated by a square at `rateHz`: 50% duty, 0 dB while open and `lowDb` while shut. Each edge is
 * smoothed over 5 ms (a raised cosine), as a hard edge would itself be a click.
 */
export function gate(x, rateHz, lowDb, sr = SR) {
  const period = 1 / rateHz;
  const edge = 0.005;
  const low = lin(lowDb);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const u = (i / sr) % period;
    const rise = u > period / 2 ? u - period : u; // time since the opening edge
    const fall = u - period / 2; // time since the closing edge
    let g;
    if (Math.abs(rise) < edge / 2) g = low + (1 - low) * (0.5 - 0.5 * Math.cos((Math.PI * (rise + edge / 2)) / edge));
    else if (Math.abs(fall) < edge / 2) g = 1 - (1 - low) * (0.5 - 0.5 * Math.cos((Math.PI * (fall + edge / 2)) / edge));
    else g = u < period / 2 ? 1 : low;
    out[i] = x[i] * g;
  }
  return out;
}

/** A burst of white noise with a linear attack over `rampMs` and an exponential decay of time constant `decayMs`; peak `peakDb`. */
export function burst(seconds, decayMs, rampMs, peakDb, seed = 1, sr = SR) {
  const n = count(seconds, sr);
  const noise = gaussian(n, seed);
  const ramp = (rampMs / 1000) * sr;
  const tau = (decayMs / 1000) * sr;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = noise[i] * Math.min(1, ramp > 0 ? i / ramp : 1) * Math.exp(-i / tau);
  return toPeak(x, peakDb);
}

/** Silence of `seconds` with each `[startSeconds, array]` piece placed at its start; pieces past the end are cut, overlapping ones add. */
export function at(seconds, pieces, sr = SR) {
  const length = count(seconds, sr);
  const out = new Float32Array(length);
  for (const [start, piece] of pieces) {
    const from = count(start, sr);
    for (let i = 0; i < piece.length && from + i < length; i++) out[from + i] += piece[i];
  }
  return out;
}

/** `x` fading from its start: each sample times e^(-t / decayMs), so a sine or saw becomes a plucked or struck note. */
export function decay(x, decayMs, sr = SR) {
  const tau = (decayMs / 1000) * sr;
  return Float32Array.from(x, (v, i) => v * Math.exp(-i / tau));
}

/** `rate` evenly spaced pieces a second over `seconds`, the first at 0 s; `make(i)` gives the i-th. */
export function every(rate, seconds, make, sr = SR) {
  return at(seconds, Array.from({ length: Math.round(rate * seconds) }, (_, i) => [i / rate, make(i)]), sr);
}

/** The sum of the arrays, as long as the longest. */
export function mix(...arrays) {
  const out = new Float32Array(Math.max(0, ...arrays.map((a) => a.length)));
  for (const a of arrays) for (let i = 0; i < a.length; i++) out[i] += a[i];
  return out;
}

/** `x` louder by `db`. */
export function gain(x, db) {
  const g = lin(db);
  return Float32Array.from(x, (v) => v * g);
}

/** `x` hard-clipped at plus and minus `ceiling` (linear). */
export function clip(x, ceiling) {
  return Float32Array.from(x, (v) => Math.max(-ceiling, Math.min(ceiling, v)));
}

/** `x` through a brick-wall band-pass, `loHz` to `hiHz`, done in the FFT. */
export function band(x, loHz, hiHz, sr = SR) {
  let size = 2;
  while (size < x.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fftInPlace(re, im);
  for (let k = 0; k <= size / 2; k++) {
    const hz = (k * sr) / size;
    if (hz < loHz || hz > hiHz) {
      re[k] = im[k] = 0;
      if (k > 0 && k < size / 2) re[size - k] = im[size - k] = 0;
    }
  }
  fftInPlace(re, im, true);
  return Float32Array.from(re.subarray(0, x.length));
}
