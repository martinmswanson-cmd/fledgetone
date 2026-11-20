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

/** Geometric over arithmetic mean of the power from 100 Hz to 10 kHz, averaged over frames louder than -60 dB. */
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
    if (db(total) <= -60 || n === 0 || arith <= 0) continue;
    sum += Math.exp(logs / n) / (arith / n);
    used++;
  }
  return used > 0 ? sum / used : 0;
}

/** Roughness is measured over stretches of this many samples, which bounds the memory the transforms take. */
const SEGMENT = 1 << 20;
/** The octave bands' centres, Hz. */
const CENTRES = [125, 250, 500, 1000, 2000, 4000, 8000];

/** A Hann window of `n` samples. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * The seven octave bands of `x`, each cut out of the spectrum in Hann-windowed overlapping pieces
 * that add back up to the band's own signal (the windows keep a strong tone from leaking into the
 * bands beside it). A band that reaches past half the sample rate comes back null.
 */
function octaveBands(x: Float32Array, sampleRate: number): Array<Float64Array | null> {
  const size = 1 << 16;
  const hop = size / 2;
  const window = hann(size);
  const binHz = sampleRate / size;
  const out = CENTRES.map((c) => (c / Math.SQRT2 < sampleRate / 2 ? new Float64Array(x.length) : null));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bandRe = new Float64Array(size);
  const bandIm = new Float64Array(size);
  for (let start = -hop; start < x.length; start += hop) {
    for (let i = 0; i < size; i++) {
      const at = start + i;
      re[i] = at >= 0 && at < x.length ? x[at] * window[i] : 0;
      im[i] = 0;
    }
    fftInPlace(re, im);
    CENTRES.forEach((centre, b) => {
      const band = out[b];
      if (!band) return;
      const lo = centre / Math.SQRT2;
      const hi = centre * Math.SQRT2;
      bandRe.fill(0);
      bandIm.fill(0);
      for (let k = 0; k <= size / 2; k++) {
        const hz = k * binHz;
        if (hz < lo || hz >= hi) continue;
        bandRe[k] = re[k];
        bandIm[k] = im[k];
        if (k > 0 && k < size / 2) {
          bandRe[size - k] = re[size - k];
          bandIm[size - k] = im[size - k];
        }
      }
      fftInPlace(bandRe, bandIm, true);
      for (let i = 0; i < size; i++) {
        const at = start + i;
        if (at >= 0 && at < x.length) band[at] += bandRe[i];
      }
    });
  }
  return out;
}

/** The power-weighted mean, over seven octave bands, of how strongly each band's envelope beats at 20 to 150 Hz. */
function roughnessOf(mid: Float32Array, sampleRate: number): number {
  let weighted = 0;
  let weights = 0;
  for (let from = 0; from < mid.length; from += SEGMENT) {
    const piece = mid.subarray(from, Math.min(mid.length, from + SEGMENT));
    if (piece.length < 4096 && from > 0) continue;
    const bands = octaveBands(piece, sampleRate);
    let size = 2;
    while (size < piece.length) size *= 2;
    const binHz = sampleRate / size;
    const window = hann(piece.length);
    let windowPower = 0;
    for (const w of window) windowPower += w * w;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (const band of bands) {
      if (!band) continue;
      let power = 0;
      for (let i = 0; i < band.length; i++) power += band[i] * band[i];
      power /= band.length;
      if (db(power) < -70) continue;
      // The envelope is the rectified band; it is smoothed below 300 Hz, which leaves its 20 to 150 Hz part as read here
      let mean = 0;
      for (let i = 0; i < band.length; i++) mean += Math.abs(band[i]);
      mean /= band.length;
      if (!(mean > 0)) continue;
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < band.length; i++) re[i] = (Math.abs(band[i]) - mean) * window[i];
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
