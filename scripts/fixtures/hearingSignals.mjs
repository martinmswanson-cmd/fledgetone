// Made test signals for the hearing tests (scripts/hearing*.test.mjs): tones, noise, modulated and
// gated sounds, bursts, drum hits and beats, shaped and struck notes, melodies, and the little tools to place, mix, clip, filter, reverberate and
// echo them. Every function returns a Float32Array; noise comes from a seeded generator so a test
// repeats exactly.
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

/**
 * A wobble bass: a saw of `hz` through a 12 dB-per-octave low-pass (a two-pole state-variable filter, Q 0.707) whose
 * cutoff swings between `loHz` and `hiHz` on a log scale with a sine LFO of `rateHz`, starting half way; peak `peakDb`.
 */
export function wobble(hz, loHz, hiHz, rateHz, seconds, peakDb, sr = SR) {
  const x = saw(hz, seconds, 0, sr);
  const out = new Float64Array(x.length);
  const mid = Math.log(loHz * hiHz) / 2;
  const half = Math.log(hiHz / loHz) / 2;
  const k = Math.SQRT2;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = Math.exp(mid + half * Math.sin((2 * Math.PI * rateHz * i) / sr));
    const g = Math.tan((Math.PI * Math.min(fc, sr * 0.45)) / sr);
    // (Zavalishin's trapezoidal state-variable filter, stable while the cutoff moves)
    const hp = (x[i] - (g + k) * s1 - s2) / (1 + g * (g + k));
    const bp = g * hp + s1;
    const lp = g * bp + s2;
    s1 = g * hp + bp;
    s2 = g * bp + lp;
    out[i] = lp;
  }
  return toPeak(out, peakDb);
}

/** `x` with its level swung by a sine LFO of `rateHz`: each sample times (1 + depth sin) / (1 + depth). */
export function tremolo(x, rateHz, depth, sr = SR) {
  return Float32Array.from(x, (v, i) => (v * (1 + depth * Math.sin((2 * Math.PI * rateHz * i) / sr))) / (1 + depth));
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

/**
 * A drum beat, `seconds` long: `rate` hits a second, in turn a kick (a 55 Hz sine 0.4 s long, fading with
 * time constant `kickMs`, peak -3 dB) and a snare (a noise burst `snareSeconds` long, fading with `snareMs`,
 * peak -6 dB, each from its own seed); with `hat`, a short noise hat (40 ms, time constant 8 ms, peak -14 dB)
 * twice as often as the hits, the first with the first hit.
 */
export function beat(kickMs, snareMs, snareSeconds, rate, hat, seconds, sr = SR) {
  const hits = every(rate, seconds, (i) => (i % 2 === 0 ? decay(sine(55, 0.4, -3, sr), kickMs, sr) : burst(snareSeconds, snareMs, 1, -6, i + 1, sr)), sr);
  return hat ? mix(hits, every(rate * 2, seconds, (i) => burst(0.04, 8, 0.5, -14, 200 + i, sr), sr)) : hits;
}

/** `x` through a one-pole high-pass at `hz`. */
function highPass(x, hz, sr) {
  const a = Math.exp((-2 * Math.PI * hz) / sr);
  const out = new Float32Array(x.length);
  let px = 0;
  let py = 0;
  for (let i = 0; i < x.length; i++) {
    py = a * (py + x[i] - px);
    px = x[i];
    out[i] = py;
  }
  return out;
}

/** An electronic kick: a sine swept from 150 to 50 Hz (time constant 30 ms) fading with `decayMs`, 0.5 s, with a 1 ms attack; peak `peakDb`. */
export function sweptKick(decayMs = 150, peakDb = -3, sr = SR) {
  const x = new Float64Array(count(0.5, sr));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / sr;
    x[i] = Math.sin(phase) * Math.exp(-t / (decayMs / 1000)) * Math.min(1, i / (0.001 * sr));
  }
  return toPeak(x, peakDb);
}

/** A snare with a body: noise over 400 Hz fading with `decayMs`, and a 190 Hz tone fading in 40 ms; 0.35 s, peak `peakDb`. */
export function tonedSnare(seed, decayMs = 70, peakDb = -6, sr = SR) {
  const noise = highPass(gaussian(count(0.35, sr), seed), 400, sr);
  return toPeak(Float64Array.from(noise, (v, i) => (v / 3) * Math.exp(-i / sr / (decayMs / 1000)) + 0.6 * Math.sin((2 * Math.PI * 190 * i) / sr) * Math.exp(-i / sr / 0.04)), peakDb);
}

/** A hat with nothing low in it: noise twice through a 7 kHz high-pass, fading with `decayMs`, `seconds` long, with a 0.5 ms attack; peak `peakDb`. */
export function highHat(seed, decayMs = 10, seconds = 0.05, peakDb = -14, sr = SR) {
  const noise = highPass(highPass(gaussian(count(seconds, sr), seed), 7000, sr), 7000, sr);
  return toPeak(Float64Array.from(noise, (v, i) => v * Math.exp(-i / sr / (decayMs / 1000)) * Math.min(1, i / (0.0005 * sr))), peakDb);
}

/** A tom: a sine that starts 30% over `hz` and settles to it (time constant 50 ms), fading with `decayMs`; 0.6 s, with a 1 ms attack, peak `peakDb`. One partial: its reverb tail swells and sags. */
export function tom(hz, decayMs = 180, peakDb = -5, sr = SR) {
  const x = new Float64Array(count(0.6, sr));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * hz * (1 + 0.3 * Math.exp(-t / 0.05))) / sr;
    x[i] = Math.sin(phase) * Math.exp(-t / (decayMs / 1000)) * Math.min(1, i / (0.001 * sr));
  }
  return toPeak(x, peakDb);
}

/**
 * A 120 bpm beat, `seconds` long: a swept kick on every beat, a toned snare on every second one, and
 * hats on the 16ths, the off ones `offDb` under the others (-14 dB).
 */
export function accentedBeat(seconds, offDb = -4, sr = SR) {
  const pieces = [];
  for (let q = 0; q * 0.5 < seconds; q++) {
    pieces.push([q * 0.5, sweptKick(150, -3, sr)]);
    if (q % 2 === 1) pieces.push([q * 0.5, tonedSnare(q + 3, 70, -6, sr)]);
  }
  for (let h = 0; h * 0.125 < seconds; h++) pieces.push([h * 0.125, highHat(300 + h, 10, 0.05, h % 2 ? -14 + offDb : -14, sr)]);
  return at(seconds, pieces, sr);
}

/** `x` in the middle with `repeats` echoes of itself thrown from side to side (right first), `delaySeconds` apart, each `feedback` times the one before: `[left, right]`. */
export function pingPong(x, delaySeconds, feedback, repeats, sr = SR) {
  const sides = [Float32Array.from(x, (v) => v * Math.SQRT1_2), Float32Array.from(x, (v) => v * Math.SQRT1_2)];
  for (let k = 1; k <= repeats; k++) {
    const shift = count(k * delaySeconds, sr);
    const g = feedback ** k;
    const side = sides[k % 2];
    for (let i = shift; i < x.length; i++) side[i] += g * x[i - shift];
  }
  return sides;
}

/**
 * A saw note with a drawn envelope, all in straight lines of gain: up over `attack` seconds, down over
 * `fall` seconds to `sustainDb`, held until `seconds`, and down to nothing over `release` seconds. Peak -6 dB.
 */
export function shapedNote(hz, seconds, attack, fall, sustainDb, release, sr = SR) {
  const x = saw(hz, seconds + release, -6, sr);
  const held = lin(sustainDb);
  return Float32Array.from(x, (v, i) => {
    const t = i / sr;
    if (t < attack) return (v * t) / attack;
    if (t < attack + fall) return v * (1 - ((1 - held) * (t - attack)) / fall);
    return t < seconds ? v * held : v * held * Math.max(0, 1 - (t - seconds) / release);
  });
}

/**
 * A struck-string note: 12 partials (a little sharp of whole multiples, as a stiff string's), the k-th
 * at 1/k and fading with time constant `ring` / (1 + 0.35 k) seconds, held `seconds` and let go over 80 ms.
 */
export function struck(hz, seconds, ring = 1.6, sr = SR) {
  const out = new Float32Array(count(seconds, sr));
  for (let k = 1; k <= 12; k++) {
    const partial = hz * k * Math.sqrt(1 + 0.0004 * k * k);
    if (partial > 12000) break;
    const tau = (ring / (1 + 0.35 * k)) * sr;
    for (let i = 0; i < out.length; i++) out[i] += (Math.sin((2 * Math.PI * partial * i) / sr + 0.2 * Math.PI * k) / k) * Math.exp(-i / tau);
  }
  const off = 0.08 * sr;
  for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, i / (0.001 * sr), (out.length - 1 - i) / off);
  return out;
}

/**
 * A melody: each `[hz, startSeconds, seconds]` note a band-limited saw that fades from its start (falling
 * to 1/e, about 9 dB, over its own length, as a plucked note) with 5 ms raised-cosine edges either side;
 * the whole `seconds` long and peaking at `peakDb`. Overlapping notes add.
 */
export function melody(notes, seconds, peakDb, sr = SR) {
  const edge = Math.max(1, Math.round(0.005 * sr));
  const pieces = notes.map(([hz, start, length]) => {
    const x = saw(hz, length, 0, sr);
    const tau = length * sr;
    for (let i = 0; i < x.length; i++) {
      const fromEnd = x.length - 1 - i;
      const fade = i < edge ? 0.5 - 0.5 * Math.cos((Math.PI * i) / edge) : fromEnd < edge ? 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / edge) : 1;
      x[i] *= Math.exp(-i / tau) * fade;
    }
    return [start, x];
  });
  return toPeak(at(seconds, pieces, sr), peakDb);
}

/** The reverbs already worked out, by sound and then by length, seed and rate: a sweep of wet mixes convolves once. */
const convolved = new WeakMap();
/** The spectra of the sounds reverberated, by sound and then by size: a sweep of reverbs of one sound transforms it once. */
const spectra = new WeakMap();

/**
 * `x` through a made reverb: convolved with exponentially decaying noise (from the seeded generator)
 * that falls 60 dB in `rtSeconds` (its RT60) and holds unit energy, then mixed `wet` (0 to 1) with
 * the dry sound: (1 - wet) x + wet (x * noise). As long as `x`; done in the FFT.
 */
export function reverb(x, rtSeconds, wet, seed = 1, sr = SR) {
  const key = `${rtSeconds}/${seed}/${sr}`;
  if (!convolved.has(x)) convolved.set(x, new Map());
  const done = convolved.get(x);
  if (!done.has(key)) {
    const length = count(rtSeconds, sr);
    const noise = gaussian(length, seed);
    const h = new Float64Array(length);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      h[i] = noise[i] * Math.exp((-Math.log(1000) * i) / (rtSeconds * sr));
      energy += h[i] * h[i];
    }
    let size = 2;
    while (size < x.length + length) size *= 2;
    if (!spectra.has(x)) spectra.set(x, new Map());
    if (!spectra.get(x).has(size)) {
      const [re, im] = [new Float64Array(size), new Float64Array(size)];
      re.set(x);
      fftInPlace(re, im);
      spectra.get(x).set(size, [re, im]);
    }
    const [are, aim] = spectra.get(x).get(size).map((part) => Float64Array.from(part));
    const [bre, bim] = [new Float64Array(size), new Float64Array(size)];
    bre.set(h);
    fftInPlace(bre, bim);
    for (let k = 0; k < size; k++) {
      const re = are[k] * bre[k] - aim[k] * bim[k];
      aim[k] = are[k] * bim[k] + aim[k] * bre[k];
      are[k] = re;
    }
    fftInPlace(are, aim, true);
    const g = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    done.set(key, Float64Array.from(are.subarray(0, x.length), (v) => v * g));
  }
  const wetPart = done.get(key);
  // (a plain loop: a sweep of mixes makes many of these)
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (1 - wet) * x[i] + wet * wetPart[i];
  return out;
}

/** `x` with `repeats` echoes of itself, `delaySeconds` apart, each `feedback` times the one before (the first `feedback` times `x`). As long as `x`. */
export function delay(x, delaySeconds, feedback, repeats, sr = SR) {
  const out = Float32Array.from(x);
  for (let k = 1; k <= repeats; k++) {
    const shift = count(k * delaySeconds, sr);
    const g = feedback ** k;
    for (let i = shift; i < x.length; i++) out[i] += g * x[i - shift];
  }
  return out;
}
