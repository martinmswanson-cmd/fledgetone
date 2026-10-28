// Measuring how cleanly a sound was processed, on synthesised material with known partials (the
// time-stretch, pitch shift, formant shift and tune tests use it):
// - inharmonic(x, sr, f0s): the energy that isn't at a harmonic of any of `f0s`, in dB under the
//   energy that is, over the middle half of `x` (a Blackman-Harris window over 2^16 samples, so
//   partials a few Hz apart are told apart), overall and in the 4-8 kHz and 8-16 kHz bands;
// - saw(f0s, seconds, sr): band-limited sawtooths (an A major chord: AMAJ), with short fades.
import { fftInPlace } from '../../src/audio/fft.ts';

export const AMAJ = [220, 220 * 2 ** (4 / 12), 220 * 2 ** (7 / 12)];

export function saw(f0s, seconds, sr = 44100, amp = 0.25, hzAt = null) {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (const f0 of f0s) {
    const K = Math.floor((0.45 * sr) / f0);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (2 * Math.PI * (hzAt ? hzAt(i / sr, f0) : f0)) / sr;
      let v = 0;
      for (let k = 1; k <= K; k++) v += Math.sin(k * ph) / k;
      x[i] += amp * 0.6 * v;
    }
  }
  const fade = Math.round(0.02 * sr);
  for (let i = 0; i < fade; i++) {
    x[i] *= i / fade;
    x[n - 1 - i] *= i / fade;
  }
  return x;
}

export function inharmonic(x, sr, f0s) {
  const N = 65536;
  const start = Math.max(0, Math.floor(x.length / 2 - N / 2));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / (N - 1);
    const w = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
    re[i] = (x[start + i] ?? 0) * w;
  }
  fftInPlace(re, im);
  const df = sr / N;
  const tol = Math.max(6, 5 * df);
  let harm = 0;
  let noise = 0;
  const bands = { '4-8k': [0, 0], '8-16k': [0, 0] };
  for (let k = 1; k <= N / 2; k++) {
    const f = k * df;
    if (f < 20) continue;
    const p = re[k] * re[k] + im[k] * im[k];
    const isHarm = f0s.some((f0) => Math.abs(f - Math.round(f / f0) * f0) < tol && Math.round(f / f0) >= 1);
    if (isHarm) harm += p;
    else noise += p;
    const band = f >= 4000 && f < 8000 ? bands['4-8k'] : f >= 8000 && f < 16000 ? bands['8-16k'] : null;
    if (band) band[isHarm ? 0 : 1] += p;
  }
  const db = (v) => 10 * Math.log10(Math.max(v, 1e-30) / harm);
  return { all: db(noise), harm48: db(bands['4-8k'][0]), noise48: db(bands['4-8k'][1]), harm816: db(bands['8-16k'][0]), noise816: db(bands['8-16k'][1]) };
}
