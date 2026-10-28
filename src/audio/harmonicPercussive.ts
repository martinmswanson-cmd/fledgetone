/**
 * A sound split into its harmonic part (what holds a pitch: notes, chords, a voice's vowels) and
 * its percussive part (what doesn't: hits, clicks, the noise of a snare or an S), the way the
 * time-stretch treats each with the window that suits it (timeStretch.ts). Harmonic-percussive
 * separation by median filtering: in the spectrogram a held note is a line along time and a hit a
 * line up the frequencies, so a median along time keeps the notes and one along frequency keeps
 * the hits; each bin goes to the two parts by how much of each it is (a soft mask). The parts add
 * back up to the sound exactly. The spectrogram is worked through in chunks, so a long recording
 * takes little memory. Plain arrays, so Node can unit-test it.
 */
import { fftInPlace } from './fft';

/** The split's FFT size for `sampleRate`: about 46 ms. */
const splitSize = (sampleRate: number) => (sampleRate > 64000 ? 4096 : sampleRate > 32000 ? 2048 : 1024);
/** The medians' lengths: about 200 ms along time, 500 Hz along frequency. */
const TIME_SECONDS = 0.2;
const SPAN_HZ = 500;
/** Frames worked on at a time. */
const CHUNK = 256;
/** Around a hit, what counts as its percussive part: from just before it to a little after (seconds, with a fade either side). */
const HIT_BEFORE = 0.03;
const HIT_AFTER = 0.15;
const HIT_FADE = 0.03;

/** Median of each run of `width` values (centred; past the ends the end value is held) along a strided line of `count`, for positions `from` to `to`, into `dst`. */
function slidingMedian(src: Float32Array, count: number, stride: number, offset: number, width: number, dst: Float32Array, dstOffset: number, dstStride: number, from: number, to: number, sorted: Float64Array): void {
  const half = width >> 1;
  const at = (i: number) => src[offset + (i < 0 ? 0 : i >= count ? count - 1 : i) * stride];
  // The window, kept sorted: each step takes the oldest value out and puts the newest in
  for (let i = 0; i < width; i++) sorted[i] = at(from + i - half);
  sorted.subarray(0, width).sort();
  for (let i = from; i < to; i++) {
    dst[dstOffset + (i - from) * dstStride] = sorted[half];
    const out = at(i - half);
    const add = at(i + half + 1);
    if (out === add) continue;
    let lo = 0;
    let hi = width - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < out) lo = mid + 1;
      else hi = mid;
    }
    let j = lo;
    if (add > out) {
      while (j + 1 < width && sorted[j + 1] < add) {
        sorted[j] = sorted[j + 1];
        j++;
      }
    } else {
      while (j > 0 && sorted[j - 1] > add) {
        sorted[j] = sorted[j - 1];
        j--;
      }
    }
    sorted[j] = add;
  }
}

export interface HarmonicPercussive {
  /** How much of the sound's energy is percussive, 0 to 1 */
  percussiveShare: number;
  /** The same above 200 Hz (where a drum's tone, a kick's boom, no longer counts) */
  percussiveHighShare: number;
  /**
   * The two parts, one array per channel each (split on the channels' mix, so they share one
   * stereo image). With hits given to the analysis, only what's around them is percussive.
   */
  parts(): { harmonic: Float32Array[]; percussive: Float32Array[] };
}

/** Hann window of `n`. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let j = 0; j < n; j++) w[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
  return w;
}

/**
 * Hear `input` (one array per channel) as harmonic and percussive. `hits` (input samples,
 * ascending) narrows the percussive part to around them, so held sound between hits stays whole.
 */
export function harmonicPercussive(input: readonly Float32Array[], sampleRate: number, hits?: readonly number[]): HarmonicPercussive {
  const length = input[0]?.length ?? 0;
  const n = splitSize(sampleRate);
  const hop = n / 4;
  const half = n / 2;
  const bins = half + 1;
  // (From a window starting before the sound, so every sample has its full four windows)
  const frames = Math.ceil((length + half) / hop) + 2;
  const frameStart = (f: number) => (f - 1) * hop - half;
  const win = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  // How much each frame counts as near a hit (1 everywhere without hits)
  const near = new Float32Array(frames).fill(1);
  if (hits) {
    near.fill(0);
    const before = HIT_BEFORE * sampleRate;
    const after = HIT_AFTER * sampleRate;
    const fade = HIT_FADE * sampleRate;
    let first = 0;
    for (let f = 0; f < frames; f++) {
      const t = frameStart(f) + half;
      while (first < hits.length && hits[first] + after + fade < t) first++;
      for (let q = first; q < hits.length && hits[q] - before - fade <= t; q++) {
        const h = hits[q];
        const d = t < h - before ? (h - before - t) / fade : t > h + after ? (t - h - after) / fade : 0;
        if (d < 1) near[f] = Math.max(near[f], d <= 0 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * d));
      }
    }
  }

  const timeWidth = 2 * Math.round((TIME_SECONDS * sampleRate) / hop / 2) + 1;
  const freqWidth = 2 * Math.round((SPAN_HZ * n) / sampleRate / 2) + 1;
  const margin = timeWidth >> 1;
  const scratch = new Float64Array(Math.max(timeWidth, freqWidth));
  // The percussive share of each bin of the frames near hits, kept (0 to 255) for parts()
  const kept = new Map<number, Uint8Array>();
  let total = 0;
  let percussive = 0;
  let totalHigh = 0;
  let percussiveHigh = 0;
  const highBin = Math.ceil((200 * n) / sampleRate);

  for (let c0 = 0; c0 < frames; c0 += CHUNK) {
    const c1 = Math.min(frames, c0 + CHUNK);
    // The mix's spectrogram over the chunk and its margins
    const m0 = Math.max(0, c0 - margin);
    const m1 = Math.min(frames, c1 + margin);
    const count = m1 - m0;
    const mags = new Float32Array(count * bins);
    for (let f = m0; f < m1; f++) {
      const s0 = frameStart(f);
      for (let j = 0; j < n; j++) {
        const s = s0 + j;
        let v = 0;
        if (s >= 0 && s < length) for (const ch of input) v += ch[s];
        re[j] = v * win[j];
        im[j] = 0;
      }
      fftInPlace(re, im);
      const row = (f - m0) * bins;
      for (let k = 0; k < bins; k++) mags[row + k] = Math.hypot(re[k], im[k]);
    }
    // Medians along time (the notes) and along frequency (the hits), for the chunk's frames
    const rows = c1 - c0;
    const alongTime = new Float32Array(rows * bins);
    const alongFreq = new Float32Array(rows * bins);
    for (let k = 0; k < bins; k++) slidingMedian(mags, count, bins, k, timeWidth, alongTime, k, bins, c0 - m0, c1 - m0, scratch);
    for (let f = c0; f < c1; f++) slidingMedian(mags, bins, 1, (f - m0) * bins, freqWidth, alongFreq, (f - c0) * bins, 1, 0, bins, scratch);
    for (let f = c0; f < c1; f++) {
      const row = (f - c0) * bins;
      const mrow = (f - m0) * bins;
      const keep = near[f] > 0 ? new Uint8Array(bins) : null;
      for (let k = 0; k < bins; k++) {
        const h = alongTime[row + k] * alongTime[row + k];
        const p = alongFreq[row + k] * alongFreq[row + k];
        const m = h + p > 1e-24 ? p / (h + p) : 0;
        const e = mags[mrow + k] * mags[mrow + k];
        total += e;
        percussive += e * m;
        if (k >= highBin) {
          totalHigh += e;
          percussiveHigh += e * m;
        }
        if (keep) keep[k] = Math.round(m * near[f] * 255);
      }
      if (keep) kept.set(f, keep);
    }
  }

  const parts = () => {
    // Each channel's percussive part: its spectrogram cut by the kept shares, back to sound (Hann
    // both ways at a quarter-window hop, whose squares add to 1.5); the harmonic part is the rest
    const harmonic = input.map((ch) => ch.slice());
    const perc = input.map(() => new Float32Array(length));
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const pOut = perc[c];
      for (const [f, keep] of kept) {
        const s0 = frameStart(f);
        for (let j = 0; j < n; j++) {
          const s = s0 + j;
          re[j] = s >= 0 && s < length ? src[s] * win[j] : 0;
          im[j] = 0;
        }
        fftInPlace(re, im);
        for (let k = 0; k < bins; k++) {
          const g = keep[k] / 255;
          re[k] *= g;
          im[k] *= g;
          if (k > 0 && k < half) {
            re[n - k] = re[k];
            im[n - k] = -im[k];
          }
        }
        fftInPlace(re, im, true);
        for (let j = 0; j < n; j++) {
          const s = s0 + j;
          if (s >= 0 && s < length) pOut[s] += (re[j] * win[j]) / 1.5;
        }
      }
      const hOut = harmonic[c];
      for (let i = 0; i < length; i++) hOut[i] -= pOut[i];
    }
    return { harmonic, percussive: perc };
  };

  return { percussiveShare: total > 0 ? percussive / total : 0, percussiveHighShare: totalHigh > 0 ? percussiveHigh / totalHigh : 0, parts };
}
