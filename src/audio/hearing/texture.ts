/**
 * Tonal against noisy, smooth against rough, for the hearing report: how flat the spectrum is, how
 * much each octave's level beats at 20 to 150 Hz, how much of the sound is percussive, and whether
 * the waveform has flat tops (a sign of clipping). Plain maths on samples, no Web Audio, so Node can test it.
 */
import { fftInPlace } from '../fft';
import { harmonicPercussive } from '../harmonicPercussive';
import { db, framesOf, midOf } from './frames';
import type { Texture } from './types';

const round2 = (x: number) => Math.round(x * 100) / 100;
const finite = (x: number) => (Number.isFinite(x) ? x : 0);

/** A frame whose power from 100 Hz to 10 kHz is this far under its whole power has nothing there to be flat or peaked (a steady offset alone). */
const IN_BAND_FLOOR = 1e-8;

/**
 * Geometric over arithmetic mean of the power from 100 Hz to 10 kHz, averaged over frames louder than
 * -60 dB that have sound in that range; 0 (all in one place) to 1 (as flat as white noise).
 */
function flatnessOf(mid: Float32Array, sampleRate: number): number {
  const size = 4096;
  const { power } = framesOf(mid, sampleRate, size, size / 2);
  const binHz = sampleRate / size;
  let sum = 0;
  let used = 0;
  for (const frame of power) {
    let total = 0;
    let logs = 0;
    let arith = 0;
    let n = 0;
    for (let k = 0; k < frame.length; k++) {
      total += frame[k];
      const f = k * binHz;
      if (f < 100 || f > 10000) continue;
      logs += Math.log(Math.max(frame[k], 1e-30));
      arith += frame[k];
      n++;
    }
    if (db(total) <= -60 || n === 0 || arith <= 0 || arith <= total * IN_BAND_FLOOR) continue;
    sum += Math.exp(logs / n) / (arith / n);
    used++;
  }
  return used > 0 ? Math.max(0, Math.min(1, sum / used)) : 0;
}

/** Roughness is measured over stretches of this many samples, which bounds the memory the transforms take. */
const SEGMENT = 1 << 20;
/** The octave bands' centres, Hz. */
const CENTRES = [125, 250, 500, 1000, 2000, 4000, 8000];
/** The size of the pieces the bands are cut from; they overlap by half. */
const FRAME = 1 << 16;
/** Each band's envelope is sampled at least this often, Hz: four times and more the 150 Hz top of the beating read. */
const ENVELOPE_RATE = 1200;
/**
 * Bands centred this low are rectified, as a real signal, rather than read as a magnitude: there the
 * rectified band's beating holds difference tones of its doubled frequencies that the magnitude lacks.
 * The rectified band is sampled at least this many times its top edge, so that rectifying's overtones
 * fold back into the 20 to 150 Hz range only faintly.
 */
const RECTIFY_UP_TO = 250;
const RECTIFY_RATE = 16;

/** A Hann window of `n` samples. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** One octave band's envelope (the rectified band, or its magnitude), `rate` samples a second, and the band's mean power. */
interface Envelope {
  envelope: Float64Array;
  rate: number;
  power: number;
}

/**
 * The envelopes of the seven octave bands of `x`. Each band is cut out of the spectrum in
 * Hann-windowed overlapping pieces that add back up to the band's own signal (the windows keep a
 * strong tone from leaking into the bands beside it). The band's bins are moved down (by its lowest
 * bin rounded down to an even one, so the half-overlapping pieces line up in phase) into a transform
 * just big enough for it, so the band comes back shifted down to nothing and sampled only as often as
 * it needs. Two pieces share each forward transform (one real, one imaginary). A band whose lower edge
 * is past half the sample rate comes back null.
 */
function octaveBands(x: Float32Array, sampleRate: number): Array<Envelope | null> {
  const size = FRAME;
  const hop = size / 2;
  const window = hann(size);
  const binHz = sampleRate / size;
  const plans = CENTRES.map((centre) => {
    const lo = centre / Math.SQRT2;
    const hi = centre * Math.SQRT2;
    if (!(lo < sampleRate / 2)) return null;
    let from = Math.max(1, Math.floor(lo / binHz) - 1);
    while (from * binHz < lo) from++;
    let to = from;
    while (to <= size / 2 && to * binHz < hi) to++; // bins from..to-1 are the band's
    const first = from - (from % 2);
    const rectify = centre <= RECTIFY_UP_TO;
    const atLeast = rectify ? RECTIFY_RATE * hi : ENVELOPE_RATE;
    let small = 2;
    while (small < size && (small < 2 * (to - first) || (small * sampleRate) / size < atLeast)) small *= 2;
    const step = size / small;
    const length = Math.ceil(x.length / step);
    return {
      from, to, first, small, step, rectify,
      re: new Float64Array(small), im: new Float64Array(small),
      bandRe: new Float64Array(length), bandIm: new Float64Array(length),
    };
  });
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = -hop; start < x.length; start += 2 * hop) {
    // The piece at `start` goes in as the real part, the next as the imaginary part
    for (let i = 0; i < size; i++) {
      const at = start + i;
      re[i] = at >= 0 && at < x.length ? x[at] * window[i] : 0;
      im[i] = at + hop >= 0 && at + hop < x.length ? x[at + hop] * window[i] : 0;
    }
    fftInPlace(re, im);
    for (const plan of plans) {
      if (!plan) continue;
      for (const second of [false, true]) {
        const pieceStart = second ? start + hop : start;
        if (pieceStart >= x.length) break;
        const { from, to, first, small, step } = plan;
        plan.re.fill(0);
        plan.im.fill(0);
        for (let k = from; k < to; k++) {
          // One piece's bin from the shared transform: the even and odd parts about k and -k
          const zr = re[k];
          const zi = im[k];
          const mr = re[(size - k) % size];
          const mi = im[(size - k) % size];
          // Twice the positive half gives the band's analytic signal; the bin at half the sample rate has no mirror, so counts once
          const g = k === size / 2 ? 0.5 : 1;
          plan.re[k - first] = g * (second ? zi + mi : zr + mr);
          plan.im[k - first] = g * (second ? mr - zr : zi - mi);
        }
        fftInPlace(plan.re, plan.im, true);
        const scale = small / size; // the small inverse divides by its own size, not the piece's
        const offset = pieceStart / step;
        for (let m = 0; m < small; m++) {
          const j = offset + m;
          if (j < 0 || j >= plan.bandRe.length) continue;
          plan.bandRe[j] += plan.re[m] * scale;
          plan.bandIm[j] += plan.im[m] * scale;
        }
      }
    }
  }
  return plans.map((plan) => {
    if (!plan) return null;
    const { bandRe, bandIm, first, small, step, rectify } = plan;
    const n = bandRe.length;
    const envelope = new Float64Array(n);
    let power = 0;
    for (let i = 0; i < n; i++) {
      if (rectify) {
        // Back up to the band's own frequencies, as a real signal
        const phase = (2 * Math.PI * ((first * i) % small)) / small;
        const v = bandRe[i] * Math.cos(phase) - bandIm[i] * Math.sin(phase);
        power += v * v;
        envelope[i] = Math.abs(v);
      } else {
        const p = bandRe[i] * bandRe[i] + bandIm[i] * bandIm[i];
        power += p / 2; // a real signal has half its analytic signal's power
        envelope[i] = Math.sqrt(p);
      }
    }
    return { envelope, rate: sampleRate / step, power: n > 0 ? power / n : 0 };
  });
}

/**
 * The power-weighted mean, over seven octave bands, of how strongly each band's envelope beats at 20 to 150 Hz.
 * Exported so the tests can read it alone, without the rest of textureOf.
 */
export function roughnessOf(mid: Float32Array, sampleRate: number): number {
  let weighted = 0;
  let weights = 0;
  for (let from = 0; from < mid.length; from += SEGMENT) {
    const piece = mid.subarray(from, Math.min(mid.length, from + SEGMENT));
    if (piece.length < 4096 && from > 0) continue;
    for (const band of octaveBands(piece, sampleRate)) {
      if (!band) continue;
      const { envelope, rate, power } = band;
      if (db(power) < -70) continue;
      const n = envelope.length;
      if (n < 2) continue; // one sample has no beating to read (and a one-sample window has no power)
      let mean = 0;
      for (let i = 0; i < n; i++) mean += envelope[i];
      mean /= n;
      if (!(mean > 0)) continue;
      let size = 2;
      while (size < n) size *= 2;
      const binHz = rate / size;
      const window = hann(n);
      let windowPower = 0;
      for (const w of window) windowPower += w * w;
      if (!(windowPower > 0)) continue;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let i = 0; i < n; i++) re[i] = (envelope[i] - mean) * window[i];
      fftInPlace(re, im);
      let beat = 0;
      for (let k = 1; k < size / 2; k++) {
        const hz = k * binHz;
        if (hz < 20 || hz > 150) continue;
        beat += 2 * (re[k] * re[k] + im[k] * im[k]); // the mirrored half folded in
      }
      const rms = Math.sqrt(beat / size / windowPower);
      weighted += power * (rms / mean);
      weights += power;
    }
  }
  return weights > 0 ? weighted / weights : 0;
}

/**
 * Whether the run of equal samples x[i..j) is longer than a smooth peak would be. The curvature is
 * measured just outside the run (a drop from its level over the square of the distance from its
 * centre, on the side that falls away faster); a parabola of that curvature stays within `tol` of its
 * top for a half-width we can predict. A flat top is at least twice that, plus one sample. A clean sine
 * predicts its own run, a clipped wave leaves a plateau on a slope, so the measured curvature is large
 * and the plateau far longer than predicted.
 */
function longerThanSmooth(x: Float32Array, i: number, j: number, tol: number): boolean {
  const v = x[i];
  const half = (j - i) / 2;
  const centre = (i + j - 1) / 2;
  const reach = Math.max(3, Math.ceil(half)); // samples beyond the run's end; further out, the drop stands clear of rounding
  let curvature = 0;
  for (const p of [j - 1 + reach, i - reach]) {
    if (p < 0 || p >= x.length) continue;
    const d = p - centre;
    curvature = Math.max(curvature, Math.abs(v - x[p]) / (d * d));
  }
  if (!(curvature > 0)) return false;
  const smoothHalf = Math.sqrt(tol / curvature);
  return half >= 2 * smoothHalf + 1;
}

/** The share of samples in flat tops (see longerThanSmooth) at a local extreme of at least a quarter of the peak, and the commonest such level. */
function flatTopsOf(channels: readonly Float32Array[]): Texture['flatTops'] {
  const tol = 1e-4;
  let peak = 0;
  let total = 0;
  for (const x of channels) {
    total += x.length;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  }
  if (peak <= 0 || total === 0) return null;
  let flat = 0;
  const counts = new Map<number, number>();
  for (const x of channels) {
    let i = 0;
    while (i < x.length) {
      let j = i + 1;
      while (j < x.length && Math.abs(x[j] - x[i]) <= tol) j++;
      const v = x[i];
      if (j - i >= 3 && Math.abs(v) >= peak / 4) {
        const before = i > 0 ? x[i - 1] : null;
        const after = j < x.length ? x[j] : null;
        const top = before !== null && after !== null && ((before < v - tol && after < v - tol) || (before > v + tol && after > v + tol));
        if (top && longerThanSmooth(x, i, j, tol)) {
          flat += j - i;
          const key = Math.round(db(v * v) * 10); // steps of 0.1 dB
          counts.set(key, (counts.get(key) ?? 0) + (j - i));
        }
      }
      i = j;
    }
  }
  const share = flat / total;
  if (share < 0.001) return null;
  let best = 0;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return { share: Math.round(share * 1000) / 1000, levelDb: best / 10 };
}

/** Tonal against noisy and smooth against rough, for some sound. */
export function textureOf(channels: readonly Float32Array[], sampleRate: number): Texture {
  const mid = midOf(channels);
  let loud = false;
  for (let i = 0; i < mid.length; i++) {
    if (mid[i] !== 0) {
      loud = true;
      break;
    }
  }
  return {
    flatness: round2(finite(flatnessOf(mid, sampleRate))),
    roughness: round2(finite(loud ? roughnessOf(mid, sampleRate) : 0)),
    percussiveShare: loud ? round2(finite(harmonicPercussive([mid], sampleRate).percussiveShare)) : 0,
    flatTops: flatTopsOf(channels),
  };
}
