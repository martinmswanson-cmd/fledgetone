/**
 * The phase vocoder: time-stretching for tonal sound (chords, pads, voices, keys), where WSOLA's
 * joins (timeStretch.ts) beat and buzz. The sound is cut into long overlapping windows, each
 * turned into its spectrum (fft.ts); each window is then put back further apart (or closer) with
 * the phase of every partial moved on by exactly what its frequency says it would have moved in
 * the new time, so every partial keeps its pitch and runs on unbroken from window to window.
 *
 * - Frequencies are measured, not guessed: each bin's own frequency comes from the spectrum of the
 *   window's derivative (reassignment), so a partial is advanced at its true frequency.
 * - Phase locking (identity phase locking): the bins around each spectral peak turn with it, so a
 *   partial stays one clean partial instead of a smear of bins that drift apart (the "phasey",
 *   reverberant sound of a plain phase vocoder).
 * - Transients: a partial that starts (its bins jump in level) starts with its own phase, as
 *   recorded, so attacks stay sharp; and around each hit the caller can hold the speed at 1
 *   (timeStretch.ts lays the time map out so), where the windows put the hit back exactly as it
 *   was, with no echo before it.
 * - Stereo: the phases are worked out once, on the channels' mix, and every channel is turned by
 *   the same amount, so the stereo image stays exactly where it was.
 *
 * The time map says where in the input each moment of the output comes from (anchors, linear
 * between them), so a constant stretch, a warp along markers and the pitch shifter's changing
 * speeds are all the same pass. Plain arrays, so Node can unit-test it.
 */
import { fftInPlace } from './fft';

/** A time map: output sample `out[i]` plays input sample `in[i]`, linear between (and beyond, at the end slopes). */
export interface TimeMap {
  out: readonly number[];
  in: readonly number[];
}

export interface VocoderOptions {
  /** FFT size (a power of two); default about 90 ms at the sample rate */
  size?: number;
  /** Windows per window length (the hop is size / overlap); default 4 */
  overlap?: number;
}

/** The FFT size for `sampleRate`: about 85 to 95 ms, long enough to tell a chord's partials apart. */
export function vocoderSize(sampleRate: number): number {
  return sampleRate > 64000 ? 8192 : sampleRate > 32000 ? 4096 : 2048;
}

/** Where in the input output sample `o` comes from. */
export function mapAt(map: TimeMap, o: number): number {
  const { out, in: inp } = map;
  const last = out.length - 1;
  if (o <= out[0]) {
    const slope = last > 0 ? (inp[1] - inp[0]) / Math.max(1e-9, out[1] - out[0]) : 1;
    return inp[0] + (o - out[0]) * slope;
  }
  if (o >= out[last]) {
    const slope = last > 0 ? (inp[last] - inp[last - 1]) / Math.max(1e-9, out[last] - out[last - 1]) : 1;
    return inp[last] + (o - out[last]) * slope;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (out[mid] <= o) lo = mid;
    else hi = mid;
  }
  const span = out[hi] - out[lo];
  return span > 0 ? inp[lo] + ((o - out[lo]) / span) * (inp[hi] - inp[lo]) : inp[lo];
}

/** How much louder (power) a partial must be than before a hit to count as the hit's own. */
const ONSET_RISE = 4;

export interface StretchOptions extends VocoderOptions {
  /** Hits in the input (samples, ascending): partials they start are placed exactly where the map puts the hit */
  onsets?: readonly number[];
}

/**
 * `input` (one array per channel) laid along `map` into `outLength` samples: output sample o
 * sounds like input sample mapAt(map, o), at the input's pitch.
 */
export function vocode(input: readonly Float32Array[], outLength: number, map: TimeMap, sampleRate: number, options: StretchOptions = {}): Float32Array[] {
  const channels = input.length;
  const length = input[0]?.length ?? 0;
  const n = options.size ?? vocoderSize(sampleRate);
  const hop = Math.round(n / (options.overlap ?? 4));
  const half = n / 2;
  const bins = half + 1;
  const output = input.map(() => new Float32Array(outLength));
  if (!length || outLength <= 0) return output;
  const inverse: TimeMap = { out: map.in, in: map.out };
  const onsets = options.onsets ?? [];

  // Hann window, and its derivative (per sample) for the bins' true frequencies
  const win = new Float64Array(n);
  const dwin = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
    dwin[j] = (Math.PI / n) * Math.sin((2 * Math.PI * j) / n);
  }
  // The mix the phases are worked out on
  let mono: Float32Array;
  if (channels === 1) mono = input[0];
  else {
    mono = new Float32Array(length);
    for (const ch of input) for (let i = 0; i < length; i++) mono[i] += ch[i];
  }

  // Which stretches of the input have any sound (in blocks), so silent windows cost nothing
  const BLOCK = 256;
  const blocks = Math.ceil(length / BLOCK);
  const sounding = new Int32Array(blocks + 1);
  for (let b = 0; b < blocks; b++) {
    let any = 0;
    for (let i = b * BLOCK, end = Math.min(length, i + BLOCK); i < end; i++) {
      if (mono[i] !== 0) {
        any = 1;
        break;
      }
    }
    sounding[b + 1] = sounding[b] + any;
  }
  const silent = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from / BLOCK));
    const b = Math.min(blocks, Math.ceil(to / BLOCK));
    return b <= a || sounding[b] === sounding[a];
  };

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const re2 = new Float64Array(n);
  const im2 = new Float64Array(n);
  // This window's mix spectrum and its bins' frequencies (radians per sample), and the last window's
  const xr = new Float64Array(bins);
  const xi = new Float64Array(bins);
  const mag = new Float64Array(bins);
  const freq = new Float64Array(bins);
  const prevXr = new Float64Array(bins);
  const prevXi = new Float64Array(bins);
  const prevFreq = new Float64Array(bins);
  /** The level of each bin in the last window, and in the last window before the hit now in the window */
  const prevMag = new Float64Array(bins);
  const before = new Float64Array(bins);
  /** Each bin's turn (synthesis phase less analysis phase), last window's and this one's */
  const prevTurn = new Float64Array(bins);
  const turn = new Float64Array(bins);
  const turnCos = new Float64Array(bins);
  const turnSin = new Float64Array(bins);
  const peaks = new Int32Array(bins);
  const norm = new Float64Array(outLength);

  /** Window centred on input sample `c` (zero outside the sound), turned so its centre is index 0. */
  const load = (src: Float32Array, c: number, dst: Float64Array) => {
    for (let j = 0; j < n; j++) {
      const s = c - half + j;
      dst[(j + half) & (n - 1)] = s >= 0 && s < length ? src[s] * win[j] : 0;
    }
  };

  const firstFrame = -Math.ceil(half / hop);
  const lastFrame = Math.ceil((outLength + half) / hop);
  let started = false;
  let prevC = 0;
  let nextOnset = 0;
  let lastHit = -1;
  for (let f = firstFrame; f <= lastFrame; f++) {
    const o = f * hop;
    const c = Math.round(mapAt(map, o));
    const inHop = c - prevC;
    prevC = c;
    if (c + half <= 0 || c - half >= length || silent(c - half, c + half)) {
      // Wholly outside the sound: nothing to add, and the next window starts afresh
      started = false;
      prevMag.fill(0);
      continue;
    }
    // The mix's spectrum (window) and its derivative-window spectrum, in one complex FFT
    for (let j = 0; j < n; j++) {
      const s = c - half + j;
      const v = s >= 0 && s < length ? mono[s] : 0;
      const k = (j + half) & (n - 1);
      re[k] = v * win[j];
      im[k] = v * dwin[j];
    }
    fftInPlace(re, im);
    let peak = 0;
    for (let k = 0; k < bins; k++) {
      const m = (n - k) & (n - 1);
      // X = (Z[k] + conj Z[N-k]) / 2, D = (Z[k] - conj Z[N-k]) / 2i
      const ar = 0.5 * (re[k] + re[m]);
      const ai = 0.5 * (im[k] - im[m]);
      const dr = 0.5 * (im[k] + im[m]);
      const di = -0.5 * (re[k] - re[m]);
      xr[k] = ar;
      xi[k] = ai;
      const p = ar * ar + ai * ai;
      mag[k] = p;
      if (p > peak) peak = p;
      // The bin's true frequency: its centre less Im(D conj X) / |X|^2
      const omega = (2 * Math.PI * k) / n;
      freq[k] = p > 1e-30 ? omega - (di * ar - dr * ai) / p : omega;
    }
    // The hit in this window, if any (the one nearest its centre), and where the map puts it
    while (nextOnset < onsets.length && onsets[nextOnset] < c - half) nextOnset++;
    let hit = -1;
    for (let q = nextOnset; q < onsets.length && onsets[q] < c + half; q++) if (hit < 0 || Math.abs(onsets[q] - c) < Math.abs(hit - c)) hit = onsets[q];
    /** For a partial the hit starts: its phase is turned by its frequency times this, which puts the hit exactly where the map says */
    const place = hit >= 0 ? o - c - (mapAt(inverse, hit) - hit) : 0;
    if (hit >= 0 && hit !== lastHit) before.set(prevMag);
    lastHit = hit;
    // Peaks (a bin louder than the two either side), each ruling the bins down to the valleys either side
    const floor = peak * 1e-12;
    let count = 0;
    for (let k = 0; k < bins; k++) {
      const p = mag[k];
      if (p <= floor) continue;
      if (k > 0 && p <= mag[k - 1]) continue;
      if (k > 1 && p <= mag[k - 2]) continue;
      if (k + 1 < bins && p < mag[k + 1]) continue;
      if (k + 2 < bins && p < mag[k + 2]) continue;
      peaks[count++] = k;
    }
    let lo = 0;
    for (let q = 0; q < count || lo < bins; q++) {
      // The region the peak rules: to the lowest bin between it and the next peak (or all of it, with none)
      const p = q < count ? peaks[q] : -1;
      let hi = bins;
      if (q + 1 < count) {
        const next = peaks[q + 1];
        let low = p;
        for (let k = p + 1; k < next; k++) if (mag[k] < mag[low]) low = k;
        hi = low === p ? p + 1 : low + 1;
      }
      let t = 0;
      if (p >= 0) {
        if (hit >= 0 && mag[p] > ONSET_RISE * before[p]) {
          // A partial the hit starts: delay it so the hit lands where it belongs (each bin by its
          // own frequency, a pure delay, so the hit's shape is kept)
          for (let k = lo; k < hi; k++) {
            const tk = ((2 * Math.PI * k) / n) * place;
            turn[k] = tk;
            turnCos[k] = Math.cos(tk);
            turnSin[k] = Math.sin(tk);
          }
          lo = hi;
          if (q >= count) break;
          continue;
        } else if (started) {
          // The partial's phase moved on over the output hop at its frequency: the mean of the two
          // windows' measures when they agree (which follows a glide), refined by how far its phase
          // really moved over the input hop (so at a speed of 1 the input comes back exactly)
          const f0 = freq[p];
          const f1 = prevFreq[p];
          const guess = Math.abs(f0 - f1) < (4 * Math.PI) / n ? 0.5 * (f0 + f1) : f0;
          let w = guess;
          if (inHop > 0) {
            let err = Math.atan2(xi[p], xr[p]) - Math.atan2(prevXi[p], prevXr[p]) - guess * inHop;
            err -= 2 * Math.PI * Math.round(err / (2 * Math.PI));
            w = guess + err / inHop;
          }
          t = prevTurn[p] + w * (hop - inHop);
          t -= 2 * Math.PI * Math.round(t / (2 * Math.PI));
        }
      }
      const cs = Math.cos(t);
      const sn = Math.sin(t);
      for (let k = lo; k < hi; k++) {
        turn[k] = t;
        turnCos[k] = cs;
        turnSin[k] = sn;
      }
      lo = hi;
      if (q >= count) break;
    }
    // Each channel's spectrum turned by the mix's turns, back to sound, overlap-added
    for (let ch = 0; ch < channels; ch += 2) {
      const two = ch + 1 < channels;
      if (channels === 1) {
        // The mix is the channel: its spectrum is xr, xi
        for (let k = 0; k < bins; k++) {
          re2[k] = xr[k] * turnCos[k] - xi[k] * turnSin[k];
          im2[k] = xr[k] * turnSin[k] + xi[k] * turnCos[k];
        }
        for (let k = 1; k < half; k++) {
          re2[n - k] = re2[k];
          im2[n - k] = -im2[k];
        }
        im2[0] = 0;
        im2[half] = 0;
      } else {
        // Two channels in one FFT: re = left, im = right
        load(input[ch], c, re);
        if (two) load(input[ch + 1], c, im);
        else im.fill(0);
        fftInPlace(re, im);
        // Separate, turn each, and pack again: Y = A' + i B'
        for (let k = 0; k < bins; k++) {
          const m = (n - k) & (n - 1);
          const ar = 0.5 * (re[k] + re[m]);
          const ai = 0.5 * (im[k] - im[m]);
          const br = 0.5 * (im[k] + im[m]);
          const bi = -0.5 * (re[k] - re[m]);
          const cs = turnCos[k];
          const sn = turnSin[k];
          const tar = ar * cs - ai * sn;
          const tai = ar * sn + ai * cs;
          const tbr = br * cs - bi * sn;
          const tbi = br * sn + bi * cs;
          // A' (Hermitian) + i B' (Hermitian), at k and N-k
          if (k === 0 || k === half) {
            re2[k] = tar - tbi;
            im2[k] = tai + tbr;
          } else {
            re2[k] = tar - tbi;
            im2[k] = tai + tbr;
            re2[m] = tar + tbi;
            im2[m] = -tai + tbr;
          }
        }
      }
      fftInPlace(re2, im2, true);
      const a = output[ch];
      const b = two ? output[ch + 1] : null;
      for (let j = 0; j < n; j++) {
        const at = o - half + j;
        if (at < 0 || at >= outLength) continue;
        const k = (j + half) & (n - 1);
        a[at] += re2[k] * win[j];
        if (b) b[at] += im2[k] * win[j];
      }
    }
    for (let j = 0; j < n; j++) {
      const at = o - half + j;
      if (at >= 0 && at < outLength) norm[at] += win[j] * win[j];
    }
    prevXr.set(xr);
    prevXi.set(xi);
    prevFreq.set(freq);
    prevTurn.set(turn);
    prevMag.set(mag);
    started = true;
  }
  for (const ch of output) for (let i = 0; i < outLength; i++) ch[i] = norm[i] > 1e-6 ? ch[i] / norm[i] : 0;
  return output;
}

/**
 * How fast the sound's partials glide, in cents per second (the louder partials count more): about
 * 0 for held notes and chords, hundreds for a voice's vibrato and slides. A gliding partial blurs
 * in a long window, a held chord's close partials only come apart in one, so this picks the
 * window (see vocoderSizeFor).
 */
export function glideRate(mono: Float32Array, sampleRate: number): number {
  const n = vocoderSize(sampleRate);
  const hop = n / 4;
  const half = n / 2;
  const bins = half + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = new Float64Array(n);
  const dwin = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
    dwin[j] = (Math.PI / n) * Math.sin((2 * Math.PI * j) / n);
  }
  const mag = new Float64Array(bins);
  let prev: Array<[number, number]> = [];
  let sum = 0;
  let weight = 0;
  const lowBin = Math.ceil((60 * n) / sampleRate);
  const highBin = Math.floor((5000 * n) / sampleRate);
  for (let c = half; c + half <= mono.length; c += hop) {
    for (let j = 0; j < n; j++) {
      const v = mono[c - half + j];
      re[j] = v * win[j];
      im[j] = v * dwin[j];
    }
    fftInPlace(re, im);
    let peak = 0;
    const hz = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const m = (n - k) & (n - 1);
      const ar = 0.5 * (re[k] + re[m]);
      const ai = 0.5 * (im[k] - im[m]);
      const dr = 0.5 * (im[k] + im[m]);
      const di = -0.5 * (re[k] - re[m]);
      const p = ar * ar + ai * ai;
      mag[k] = p;
      if (p > peak) peak = p;
      hz[k] = ((p > 1e-30 ? (2 * Math.PI * k) / n - (di * ar - dr * ai) / p : (2 * Math.PI * k) / n) * sampleRate) / (2 * Math.PI);
    }
    const now: Array<[number, number]> = [];
    for (let k = Math.max(2, lowBin); k < Math.min(bins - 2, highBin); k++) {
      const p = mag[k];
      if (p > peak * 1e-4 && p > mag[k - 1] && p > mag[k - 2] && p >= mag[k + 1] && p >= mag[k + 2] && hz[k] > 0) now.push([hz[k], p]);
    }
    // Each peak against the nearest one in the last window (within a semitone)
    let j = 0;
    for (const [f, p] of now) {
      while (j + 1 < prev.length && Math.abs(prev[j + 1][0] - f) < Math.abs(prev[j][0] - f)) j++;
      const q = prev[j];
      if (!q) continue;
      const cents = 1200 * Math.abs(Math.log2(f / q[0]));
      if (cents > 100) continue;
      const w = Math.min(p, q[1]);
      sum += w * cents;
      weight += w;
    }
    prev = now;
  }
  return weight > 0 ? (sum / weight) * (sampleRate / hop) : 0;
}
