/**
 * "Does it hit?": measurements of a rendered mix (a drop, a loop) of the kind that tell a modern
 * electronic track from a thin one, to be held against targets measured from finished songs
 * (hitTargets.ts). Loudness and crest; how the energy splits across six bands and how wide each
 * is; whether there's a sustained bed under the hits (no gaps between them); whether the bass
 * changes its tone from 16th to 16th (moving) or only sweeps at one steady rate (a wobble); and,
 * given where the kicks and snares are, how much the mids dip after a kick (sidechain), how much
 * the sub ducks under a snare, and how far the drums poke out of the mix.
 *
 * Pure maths on samples (no Web Audio), so it runs in Node tests, in the scripts and in a Worker
 * (hitCheckWorker.ts). Its numbers follow the analysis the targets came from: 4th-order
 * Butterworth bands run forwards and backwards, 10 ms envelopes, a 2048-point spectrum every
 * 256 samples for the bass's tone, and the BS.1770 loudness of loudness.ts.
 */
import { createLoudnessAnalyser, kWeightingFilters, truePeakOf } from './loudness';

export interface HitCheckInput {
  /** One or two channels (one is read as both). */
  channels: readonly Float32Array[];
  sampleRate: number;
  bpm: number;
  /** The stretch to measure, seconds (default: all of it). */
  start?: number;
  end?: number;
  /** A time on the 16th-note grid (a downbeat), seconds; found from the onsets when not given. */
  gridStart?: number;
  /** Where the kicks and the snares (claps) hit, seconds: the drum measures need them. */
  kicks?: readonly number[];
  snares?: readonly number[];
  /**
   * The same stretch with only the bass parts playing (same rate and length), when they can be
   * rendered apart: the bass movement is then read from them, not from the mix, where drums and
   * chords in 100 Hz-4 kHz can hide a plain wobble.
   */
  bassChannels?: readonly Float32Array[];
}

export type BandId = 'sub' | 'low' | 'lowMid' | 'mid' | 'presence' | 'air';

/** The bands the balance and width are read in, Hz. */
export const HIT_BANDS: ReadonlyArray<{
  id: BandId;
  lo: number;
  hi: number;
  name: string;
}> = [
  { id: 'sub', lo: 20, hi: 60, name: 'Sub (under 60 Hz)' },
  { id: 'low', lo: 60, hi: 250, name: 'Low (60-250 Hz)' },
  { id: 'lowMid', lo: 250, hi: 1000, name: 'Low mids (250 Hz-1 kHz)' },
  { id: 'mid', lo: 1000, hi: 4000, name: 'Mids (1-4 kHz)' },
  { id: 'presence', lo: 4000, hi: 8000, name: 'Presence (4-8 kHz)' },
  { id: 'air', lo: 8000, hi: 20000, name: 'Air (over 8 kHz)' },
];

/** How the bass's tone moves: hardly at all, at one steady rate (a classic wobble), or from step to step. */
export type MovementKind = 'still' | 'wobble' | 'moving' | 'some';

export interface HitReport {
  /** Seconds measured. */
  seconds: number;
  bpm: number;
  /** Where the 16th grid was taken to start, seconds from the start of the stretch. */
  gridStart: number;
  loudness: {
    /** Integrated loudness of the stretch, LUFS. */
    integrated: number;
    /** Short-term (3 s) loudness, mean and loudest, LUFS. */
    shortTermMean: number;
    shortTermMax: number;
    truePeak: number;
    samplePeak: number;
    /** Sample peak over RMS, dB: how much the hits stand over the body of the sound. */
    crest: number;
  };
  bands: Array<{
    id: BandId;
    /** Its energy against the whole mix's, dB. */
    db: number;
    /** Sides over middle, dB (very negative: in the middle). */
    sideToMid: number;
    /** Left-right correlation (1: mono). */
    corr: number;
  }>;
  sustain: {
    /** Share of 10 ms frames more than 6 / 12 / 20 dB under the stretch's RMS, %. */
    below6: number;
    below12: number;
    below20: number;
    /** Median loudest-minus-quietest 10 ms frame within each 16th / each beat, dB. */
    swing16: number;
    swingBeat: number;
    /** Median of each beat's quietest 10% against that beat's mean, dB. */
    quietFloor: number;
    /** With drums given: the level more than 60 ms after any kick or snare against the mean, dB. */
    afterHits?: number;
  };
  /** The pump: the mids' (250 Hz-4 kHz) level through a beat, the median over every beat. */
  pump: {
    /** Its deepest point under its loudest, dB (negative). */
    depth: number;
    /**
     * Its deepest point under the loudest of the beat's second half, dB (negative): how far the
     * mids dip and come back, the pump you hear (a kick's click towering over a thin bed counts
     * in depth, not here).
     */
    dip: number;
    /** Where in the beat that is, ms. */
    atMs: number;
    /** Sixteen points through the beat, dB under the loudest. */
    profile: number[];
  };
  /** What the bass movement was read from: the bass parts alone, or the whole mix. */
  movementOf: 'bass' | 'mix';
  /** With the bass parts given, the mix's own movement too (as the targets' songs were measured). */
  mixMovement?: HitReport['movement'];
  movement: {
    /** Median spectral centroid of 100 Hz-4 kHz, Hz. */
    centroidHz: number;
    /** Median jump of the centroid from one 16th to the next, octaves. */
    jump: number;
    /** Share of 16ths whose centroid moves over a quarter / half an octave, %. */
    over025: number;
    over05: number;
    /** Share of the centroid's modulation (0.3-30 Hz) at its single strongest rate, %. */
    topRateShare: number;
    /** That rate, in cycles per beat (2: an 1/8-note wobble). */
    topRateCyclesPerBeat: number;
    /** Autocorrelation of the centroid at a 16th, an 8th, a beat, half a bar, a bar and two bars. */
    ac16: number;
    ac8: number;
    acBeat: number;
    acHalfBar: number;
    acBar: number;
    ac2Bar: number;
    kind: MovementKind;
  };
  drums?: {
    kicks: number;
    snares: number;
    /** Median K-weighted 10 ms peak after each kick / snare, dB. */
    kickPeak: number;
    snarePeak: number;
    /** The same against the K-weighted mean of the whole stretch, dB: how far the hits poke out. */
    kickOverMix: number;
    snareOverMix: number;
    /** The deepest median dip of the mids (250 Hz-1 kHz or 1-4 kHz) 20-200 ms after a kick, dB (negative), and when. */
    sidechain: number;
    sidechainAtMs: number;
    /** The deepest median dip of the sub (30-60 Hz) 0-150 ms after a snare, dB. */
    subDuck: number;
    /** Median envelopes after the hits at fixed offsets (ms), dB against just before the hit (for comparing analyses). */
    curves: Record<string, number[]>;
  };
}

/** The offsets (ms) the curves in HitReport.drums are read at. */
export const CURVE_OFFSETS_MS = [-20, 0, 25, 50, 75, 100, 150, 200, 300, 400];

// ---------- FFT ----------

/** A radix-2 complex FFT of size n (a power of two, at least 4), in place, with its tables made once. */
export function createFft(n: number): (re: Float64Array, im: Float64Array) => void {
  const levels = Math.round(Math.log2(n));
  if (1 << levels !== n || n < 4) throw new Error('FFT size must be a power of two, at least 4');
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  // Each stage's twiddles side by side: the stage joining halves of `half` reads [half, 2 * half)
  const twr = new Float64Array(n);
  const twi = new Float64Array(n);
  for (let half = 1; half < n; half <<= 1) {
    for (let k = 0; k < half; k++) {
      twr[half + k] = Math.cos((Math.PI * k) / half);
      twi[half + k] = -Math.sin((Math.PI * k) / half);
    }
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    // The first two stages need no multiplies
    for (let i = 0; i < n; i += 4) {
      const r0 = re[i] + re[i + 1];
      const i0 = im[i] + im[i + 1];
      const r1 = re[i] - re[i + 1];
      const i1 = im[i] - im[i + 1];
      const r2 = re[i + 2] + re[i + 3];
      const i2 = im[i + 2] + im[i + 3];
      const r3 = re[i + 2] - re[i + 3];
      const i3 = im[i + 2] - im[i + 3];
      re[i] = r0 + r2;
      im[i] = i0 + i2;
      re[i + 2] = r0 - r2;
      im[i + 2] = i0 - i2;
      // (r3 + i i3) times -i
      re[i + 1] = r1 + i3;
      im[i + 1] = i1 - r3;
      re[i + 3] = r1 - i3;
      im[i + 3] = i1 + r3;
    }
    for (let half = 4; half < n; half <<= 1) {
      const size = half << 1;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const a = i + k;
          const b = a + half;
          const wr = twr[half + k];
          const wi = twi[half + k];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  };
}

/** A periodic Hann window (as scipy's stft uses). */
function hann(n: number, symmetric = false): Float64Array {
  const w = new Float64Array(n);
  const d = symmetric ? n - 1 : n;
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
  return w;
}

/**
 * Short-time power spectra of two real signals at once (or two frames of one): `each` gets the
 * frame's index and the power (and, with `cross`, the real cross-spectrum) of bins 0..n/2.
 * The magnitudes are scaled by the window's sum, as scipy's stft scales them.
 */
function stft(a: Float32Array | Float64Array, nfft: number, hop: number, each: (frame: number, power: Float64Array) => void): number {
  const frames = a.length >= nfft ? Math.floor((a.length - nfft) / hop) + 1 : 0;
  const fft = createFft(nfft);
  const w = hann(nfft);
  let wsum = 0;
  for (let i = 0; i < nfft; i++) wsum += w[i];
  const scale = 1 / (wsum * wsum);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const pa = new Float64Array(nfft / 2 + 1);
  const pb = new Float64Array(nfft / 2 + 1);
  for (let f = 0; f < frames; f += 2) {
    const oa = f * hop;
    const ob = (f + 1) * hop;
    const second = f + 1 < frames;
    for (let i = 0; i < nfft; i++) {
      re[i] = a[oa + i] * w[i];
      im[i] = second ? a[ob + i] * w[i] : 0;
    }
    fft(re, im);
    splitPair(re, im, pa, pb, scale);
    each(f, pa);
    if (second) each(f + 1, pb);
  }
  return frames;
}

/** Separate the spectra of two real signals FFT'd together as re + i*im, as powers (times `scale`). */
function splitPair(re: Float64Array, im: Float64Array, pa: Float64Array, pb: Float64Array, scale: number, cross?: Float64Array): void {
  const n = re.length;
  for (let k = 0; k <= n / 2; k++) {
    const j = (n - k) & (n - 1);
    // A = (Z[k] + conj Z[n-k]) / 2, B = (Z[k] - conj Z[n-k]) / 2i
    const ar = (re[k] + re[j]) / 2;
    const ai = (im[k] - im[j]) / 2;
    const br = (im[k] + im[j]) / 2;
    const bi = (re[j] - re[k]) / 2;
    pa[k] = (ar * ar + ai * ai) * scale;
    pb[k] = (br * br + bi * bi) * scale;
    if (cross) cross[k] = (ar * br + ai * bi) * scale;
  }
}

// ---------- Filters ----------

type Biquad = number[];

/** RBJ low- or high-pass biquad (the bilinear transform, prewarped at f0). */
function pass(kind: 'low' | 'high', f0: number, q: number, sr: number): Biquad {
  const w = (2 * Math.PI * f0) / sr;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b = kind === 'low' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

/** The two sections of a 4th-order Butterworth low- or high-pass. */
const BUTTER_Q = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))];

function runBiquad(x: Float64Array, q: Biquad, reverse: boolean): void {
  const [b0, b1, b2, a1, a2] = q;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const n = x.length;
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k;
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/**
 * A 4th-order Butterworth band-pass lo..hi Hz as four biquads: the analog prototype's poles moved
 * to the band (s -> (s^2 + w0^2) / (s bw), edges prewarped), then the bilinear transform, as
 * scipy's butter(4, [lo, hi], 'bandpass') makes it. Each section has a zero at DC and at Nyquist;
 * the gain is 1 at the band's centre.
 */
function butterBand(lo: number, hi: number, sr: number): Biquad[] {
  const fs2 = 2 * sr;
  const w1 = fs2 * Math.tan((Math.PI * lo) / sr);
  const w2 = fs2 * Math.tan((Math.PI * hi) / sr);
  const w0sq = w1 * w2;
  const bw = w2 - w1;
  const out: Biquad[] = [];
  for (const k of [1, 2]) {
    // The prototype's poles in the upper half plane: exp(i pi (2k + 3) / 8)
    const ang = (Math.PI * (2 * k + 3)) / 8;
    const pr = Math.cos(ang) * bw;
    const pi = Math.sin(ang) * bw;
    // Roots of s^2 - p s + w0^2: (p +- sqrt(p^2 - 4 w0^2)) / 2
    const dr = pr * pr - pi * pi - 4 * w0sq;
    const di = 2 * pr * pi;
    const mag = Math.sqrt(Math.hypot(dr, di));
    const arg = Math.atan2(di, dr) / 2;
    const sqr = mag * Math.cos(arg);
    const sqi = mag * Math.sin(arg);
    for (const sign of [1, -1]) {
      const sr_ = (pr + sign * sqr) / 2;
      const si = (pi + sign * sqi) / 2;
      // z = (1 + s / 2fs) / (1 - s / 2fs)
      const nr = 1 + sr_ / fs2;
      const ni = si / fs2;
      const qr = 1 - sr_ / fs2;
      const qi = -si / fs2;
      const den = qr * qr + qi * qi;
      const zr = (nr * qr + ni * qi) / den;
      const zi = (ni * qr - nr * qi) / den;
      out.push([1, 0, -1, -2 * zr, zr * zr + zi * zi]);
    }
  }
  // Unit gain at the centre
  const gain = gainOf(out, 2 * Math.atan(Math.sqrt(w0sq) / fs2));
  const g = 1 / gain;
  out[0] = [out[0][0] * g, out[0][1] * g, out[0][2] * g, out[0][3], out[0][4]];
  return out;
}

/** The magnitude of biquads in series at `w` radians per sample. */
function gainOf(sections: readonly Biquad[], w: number): number {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let gain = 1;
  for (const [b0, b1, b2, a1, a2] of sections) gain *= Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2) / Math.hypot(1 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
  return gain;
}

/** `x` band-passed lo..hi Hz (either may be absent): 4th-order Butterworth, run forwards and backwards (no phase shift). */
export function bandpass(x: Float32Array | Float64Array, sr: number, lo: number | null, hi: number | null): Float64Array {
  const y = Float64Array.from(x);
  const top = hi && hi < sr / 2 ? hi : null;
  const sections: Biquad[] = [];
  if (lo && top) sections.push(...butterBand(lo, top, sr));
  else if (lo) for (const q of BUTTER_Q) sections.push(pass('high', lo, q, sr));
  else if (top) for (const q of BUTTER_Q) sections.push(pass('low', top, q, sr));
  for (const s of sections) runBiquad(y, s, false);
  for (const s of sections) runBiquad(y, s, true);
  return y;
}

// ---------- Small helpers ----------

const db10 = (p: number) => 10 * Math.log10(p + 1e-12);

function median(v: ArrayLike<number>): number {
  const a = Array.from(v)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** numpy's percentile (linear interpolation) of a sorted copy. */
function percentile(v: ArrayLike<number>, p: number): number {
  const a = Array.from(v).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const r = (p / 100) * (a.length - 1);
  const i = Math.floor(r);
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * (r - i) : a[i];
}

/** Index of the first of the sorted `t` at or after `x`. */
function searchSorted(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** A level envelope: mean square over `winMs` windows every `hopMs`, dB, with the windows' centre times. */
export function envelopeDb(x: Float32Array | Float64Array, sr: number, winMs: number, hopMs: number): { t: Float64Array; e: Float64Array } {
  const n = Math.max(1, Math.floor((winMs * sr) / 1000));
  const h = Math.max(1, Math.floor((hopMs * sr) / 1000));
  const count = x.length >= n ? Math.floor((x.length - n) / h) + 1 : 0;
  const c = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) c[i + 1] = c[i] + x[i] * x[i];
  const t = new Float64Array(count);
  const e = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const s = k * h;
    t[k] = (s + n / 2) / sr;
    e[k] = db10(Math.max(0, c[s + n] - c[s]) / n);
  }
  return { t, e };
}

function interp(x: number, t: Float64Array, e: Float64Array): number {
  const i = searchSorted(t, x);
  if (i <= 0) return e[0];
  if (i >= t.length) return e[t.length - 1];
  const f = (x - t[i - 1]) / (t[i] - t[i - 1]);
  return e[i - 1] + (e[i] - e[i - 1]) * f;
}

// ---------- The parts ----------

function measureLoudness(left: Float32Array, right: Float32Array, sr: number): HitReport['loudness'] {
  const meter = createLoudnessAnalyser(sr, undefined, undefined, false);
  const chunk = Math.round(sr / 2);
  const st: number[] = [];
  let peak = 0;
  let sq = 0;
  for (let i = 0; i < left.length; i += chunk) {
    const l = left.subarray(i, i + chunk);
    const r = right.subarray(i, i + chunk);
    meter.feed(l, r, l.length);
    if ((i + l.length) / sr >= 3 - 1e-9) st.push(meter.read().shortTerm);
  }
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    sq += a * a + b * b;
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
  }
  const reading = meter.read();
  const fin = st.filter(Number.isFinite);
  const samplePeak = 20 * Math.log10(peak + 1e-12);
  const rms = db10(sq / (2 * Math.max(1, left.length)));
  return {
    integrated: reading.integrated,
    shortTermMean: fin.length ? fin.reduce((a, b) => a + b, 0) / fin.length : reading.shortTerm,
    shortTermMax: fin.length ? Math.max(...fin) : reading.shortTerm,
    truePeak: 20 * Math.log10(truePeakOf([left, right]) + 1e-12),
    samplePeak,
    crest: samplePeak - rms,
  };
}

/** The most spectra the band balance averages. */
const BAND_FRAMES = 600;

/** Band balance and width from the long-term spectra of left and right (summed cross-spectra stand in for filtered signals). */
function measureBands(left: Float32Array, right: Float32Array, sr: number): HitReport['bands'] {
  // Long windows (2.7 Hz bins at 44.1 kHz), so a loud low band doesn't spill into a quiet sub
  const nfft = 2 ** Math.round(Math.log2(sr * 0.37));
  // Windows half overlapping, at most BAND_FRAMES of them spread evenly (a long song's balance needn't read every one)
  const count = left.length >= nfft ? Math.floor((left.length - nfft) / (nfft / 2)) + 1 : 0;
  const hop = count > BAND_FRAMES ? (left.length - nfft) / (BAND_FRAMES - 1) : nfft / 2;
  const fft = createFft(nfft);
  const w = hann(nfft);
  const half = nfft / 2;
  const ll = new Float64Array(half + 1);
  const rr = new Float64Array(half + 1);
  const lr = new Float64Array(half + 1);
  const pl = new Float64Array(half + 1);
  const pr = new Float64Array(half + 1);
  const cx = new Float64Array(half + 1);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let f = 0; f < Math.min(count, BAND_FRAMES); f++) {
    const o = Math.round(f * hop);
    for (let i = 0; i < nfft; i++) {
      re[i] = left[o + i] * w[i];
      im[i] = right[o + i] * w[i];
    }
    fft(re, im);
    splitPair(re, im, pl, pr, 1, cx);
    for (let k = 0; k <= half; k++) {
      ll[k] += pl[k];
      rr[k] += pr[k];
      lr[k] += cx[k];
    }
  }
  let total = 0;
  for (let k = 1; k < half; k++) total += (ll[k] + rr[k] + 2 * lr[k]) / 4;
  return HIT_BANDS.map((b) => {
    // Each bin weighted by the band's Butterworth filter run both ways (|H|^4), as if the band were filtered out
    const hi = Math.min(b.hi, sr / 2 - 100);
    const sections = butterBand(b.lo, hi, sr);
    let l = 0;
    let r = 0;
    let c = 0;
    for (let k = 1; k < half; k++) {
      const g = gainOf(sections, (Math.PI * 2 * k) / nfft) ** 4;
      l += ll[k] * g;
      r += rr[k] * g;
      c += lr[k] * g;
    }
    const mid = (l + r + 2 * c) / 4;
    const side = (l + r - 2 * c) / 4;
    return {
      id: b.id,
      db: db10(mid / (total || 1)),
      sideToMid: db10(Math.max(0, side) / (mid || 1e-12)),
      corr: l > 0 && r > 0 ? c / Math.sqrt(l * r) : 1,
    };
  });
}

/** The phase of the 16th grid (seconds from the start) where full-band onsets line up best. */
function findGrid(mono: Float32Array, sr: number, six: number): number {
  const nfft = 1024;
  const hop = 128;
  // (At most a minute: plenty to find a phase)
  const part = mono.subarray(0, Math.min(mono.length, sr * 60));
  const n = part.length >= nfft ? Math.floor((part.length - nfft) / hop) + 1 : 0;
  if (n < 4) return 0;
  const half = nfft / 2;
  const prev = new Float64Array(half + 1);
  const cur = new Float64Array(half + 1);
  const flux = new Float64Array(n);
  stft(part, nfft, hop, (f, p) => {
    let s = 0;
    for (let k = 0; k <= half; k++) {
      cur[k] = Math.log1p(100 * Math.sqrt(p[k]));
      if (f > 0) s += Math.max(0, cur[k] - prev[k]);
    }
    flux[f] = s;
    prev.set(cur);
  });
  const t = new Float64Array(n);
  for (let f = 0; f < n; f++) t[f] = (f * hop + nfft / 2) / sr;
  let best = -1;
  let phase = 0;
  for (let i = 0; i < 60; i++) {
    const ph = (i * six) / 60;
    let sum = 0;
    let count = 0;
    for (let g = ph; g < t[n - 1] - 0.05; g += six) {
      sum += flux[Math.min(n - 1, searchSorted(t, g))];
      count++;
    }
    const v = count ? sum / count : 0;
    if (v > best) {
      best = v;
      phase = ph;
    }
  }
  return phase;
}

function measureSustain(mono: Float32Array, sr: number, grid: number[], beat: number, hits: number[]): HitReport['sustain'] {
  const { t, e } = envelopeDb(mono, sr, 10, 5);
  let sq = 0;
  for (let i = 0; i < mono.length; i++) sq += mono[i] * mono[i];
  const ref = db10(sq / Math.max(1, mono.length));
  const share = (d: number) => {
    let c = 0;
    for (let i = 0; i < e.length; i++) if (e[i] < ref - d) c++;
    return (100 * c) / Math.max(1, e.length);
  };
  const six = beat / 4;
  const swing16: number[] = [];
  for (const g of grid) {
    const i0 = searchSorted(t, g);
    const i1 = searchSorted(t, g + six);
    if (i1 - i0 > 2) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i < i1; i++) {
        lo = Math.min(lo, e[i]);
        hi = Math.max(hi, e[i]);
      }
      swing16.push(hi - lo);
    }
  }
  const swingBeat: number[] = [];
  const floors: number[] = [];
  if (grid.length) {
    for (let b = grid[0]; b < grid[grid.length - 1]; b += beat) {
      const i0 = searchSorted(t, b);
      const i1 = searchSorted(t, b + beat);
      if (i1 - i0 > 4) {
        const seg = e.subarray(i0, i1);
        let lo = Infinity;
        let hi = -Infinity;
        let sum = 0;
        for (const v of seg) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
          sum += v;
        }
        swingBeat.push(hi - lo);
        floors.push(percentile(seg, 10) - sum / seg.length);
      }
    }
  }
  const out: HitReport['sustain'] = {
    below6: share(6),
    below12: share(12),
    below20: share(20),
    swing16: median(swing16),
    swingBeat: median(swingBeat),
    quietFloor: median(floors),
  };
  if (hits.length) {
    // Frames more than 60 ms after every hit before them
    const sorted = [...hits].sort((x, y) => x - y);
    let far = 0;
    let farCount = 0;
    let all = 0;
    for (let i = 0, j = 0; i < e.length; i++) {
      const p = 10 ** (e[i] / 10);
      all += p;
      while (j < sorted.length && sorted[j] + 0.06 <= t[i]) j++;
      if (j < sorted.length && sorted[j] <= t[i]) continue;
      far += p;
      farCount++;
    }
    out.afterHits = db10(far / Math.max(1, farCount) / (all / Math.max(1, e.length)));
  }
  return out;
}

function measurePump(mono: Float32Array, sr: number, grid: number[], beat: number): HitReport['pump'] {
  const { t, e } = envelopeDb(bandpass(mono, sr, 250, 4000), sr, 10, 2);
  const rows: number[][] = [];
  if (grid.length && t.length) for (let b = grid[0]; b < grid[grid.length - 1] - beat; b += beat) rows.push(Array.from({ length: 16 }, (_, i) => interp(b + (i * beat) / 16, t, e)));
  if (!rows.length) return { depth: NaN, dip: NaN, atMs: NaN, profile: [] };
  const profile = Array.from({ length: 16 }, (_, i) => median(rows.map((r) => r[i])));
  const top = Math.max(...profile);
  const rel = profile.map((v) => v - top);
  const at = rel.indexOf(Math.min(...rel));
  return {
    depth: rel[at],
    dip: rel[at] - Math.max(...rel.slice(8)),
    atMs: Math.round((at * beat * 1000) / 16),
    profile: rel,
  };
}

function classify(m: Omit<HitReport['movement'], 'kind'>): MovementKind {
  if (!Number.isFinite(m.jump) || m.jump < 0.08) return 'still';
  if (m.topRateShare > 45 || (m.ac8 > 0.7 && m.over025 < 45)) return 'wobble';
  if (m.over025 >= 45 && m.topRateShare <= 40) return 'moving';
  return 'some';
}

function measureMovement(mono: Float32Array, sr: number, grid: number[], beat: number): HitReport['movement'] {
  // A 2048-point spectrum every 256 samples at 44.1 kHz (46 ms windows, 21.5 Hz bins, every 5.8 ms),
  // read from the band taken down to a quarter of the rate (it holds nothing over 4 kHz worth the name)
  const down = sr >= 32000 ? 4 : sr >= 16000 ? 2 : 1;
  const band = bandpass(mono, sr, 100, 4000);
  const low = new Float64Array(Math.floor(band.length / down));
  for (let i = 0; i < low.length; i++) low[i] = band[i * down];
  const rate = sr / down;
  const nfft = 2 ** Math.round(Math.log2(0.0464 * rate));
  const hop = nfft / 8;
  const k0 = Math.ceil((100 * nfft) / rate);
  const k1 = Math.floor((4000 * nfft) / rate);
  const cen: number[] = [];
  stft(low, nfft, hop, (_f, p) => {
    let s = 0;
    let sf = 0;
    for (let k = k0; k <= k1; k++) {
      s += p[k];
      sf += p[k] * ((k * rate) / nfft);
    }
    cen.push(Math.max(100, sf / (s + 1e-12)));
  });
  const n = cen.length;
  const t = new Float64Array(n);
  for (let f = 0; f < n; f++) t[f] = (f * hop + nfft / 2) / rate;
  const six = beat / 4;
  // The centroid of each 16th (geometric mean of its frames)
  const cs: number[] = [];
  if (n && grid.length) {
    for (let a = grid[0]; a < t[n - 1] - six; a += six) {
      const i0 = searchSorted(t, a + 0.01);
      const i1 = searchSorted(t, a + six - 0.005);
      if (i1 <= i0) continue;
      let s = 0;
      for (let i = i0; i < i1; i++) s += Math.log(cen[i]);
      cs.push(Math.exp(s / (i1 - i0)));
    }
  }
  const dc: number[] = [];
  for (let i = 1; i < cs.length; i++) dc.push(Math.abs(Math.log2(cs[i] / cs[i - 1])));
  const pct = (th: number) => (100 * dc.filter((d) => d > th).length) / Math.max(1, dc.length);
  // The centroid's modulation spectrum (log2, detrended, Hann-windowed)
  const lc = new Float64Array(n);
  for (let i = 0; i < n; i++) lc[i] = Math.log2(cen[i]);
  if (n > 1) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += i;
      sy += lc[i];
      sxx += i * i;
      sxy += i * lc[i];
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    const icpt = (sy - slope * sx) / n;
    for (let i = 0; i < n; i++) lc[i] -= icpt + slope * i;
  }
  const fps = rate / hop;
  let topShare = NaN;
  let topRate = NaN;
  if (n >= 16) {
    let size = 1;
    while (size < n) size <<= 1;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const w = hann(n, true);
    for (let i = 0; i < n; i++) re[i] = lc[i] * w[i];
    createFft(size)(re, im);
    const spec = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) spec[k] = re[k] * re[k] + im[k] * im[k];
    const fr = (k: number) => (k * fps) / size;
    let tot = 0;
    let best = -1;
    for (let k = 0; k <= size / 2; k++) {
      const f = fr(k);
      if (f <= 0.3 || f >= 30) continue;
      tot += spec[k];
      if (best < 0 || spec[k] > spec[best]) best = k;
    }
    if (best >= 0 && tot > 0) {
      const f0 = fr(best);
      let near = 0;
      for (let k = 0; k <= size / 2; k++) if (fr(k) > f0 * 0.97 && fr(k) < f0 * 1.03) near += spec[k];
      topShare = (100 * near) / tot;
      topRate = f0 * beat;
    }
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += lc[i];
  mean /= Math.max(1, n);
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (lc[i] - mean) ** 2;
  sd = Math.sqrt(sd / Math.max(1, n)) + 1e-9;
  const ac = (lag: number) => {
    const l = Math.round(lag * fps);
    if (l <= 0 || l >= n) return NaN;
    let s = 0;
    for (let i = l; i < n; i++) s += ((lc[i] - mean) / sd) * ((lc[i - l] - mean) / sd);
    return s / (n - l);
  };
  const m = {
    centroidHz: median(cen),
    jump: median(dc),
    over025: pct(0.25),
    over05: pct(0.5),
    topRateShare: topShare,
    topRateCyclesPerBeat: topRate,
    ac16: ac(six),
    ac8: ac(2 * six),
    acBeat: ac(beat),
    acHalfBar: ac(2 * beat),
    acBar: ac(4 * beat),
    ac2Bar: ac(8 * beat),
  };
  return { ...m, kind: classify(m) };
}

/** Median envelope of `band` after each of `hits` against just before it, at each of `offsets` (s). */
function triggered(band: Float64Array, sr: number, hits: readonly number[], offsets: readonly number[]): number[] | null {
  const { t, e } = envelopeDb(band, sr, 10, 2);
  if (!t.length) return null;
  const last = t[t.length - 1];
  const curves: number[][] = [];
  for (const k of hits) {
    if (k - 0.05 < 0 || k + 0.45 > last) continue;
    const i0 = searchSorted(t, k - 0.05);
    const i1 = searchSorted(t, k - 0.01);
    if (i1 <= i0) continue;
    let base = 0;
    for (let i = i0; i < i1; i++) base += e[i];
    base /= i1 - i0;
    curves.push(offsets.map((o) => interp(k + o, t, e) - base));
  }
  if (curves.length < 4) return null;
  return offsets.map((_, j) => median(curves.map((c) => c[j])));
}

function measureDrums(mono: Float32Array, sr: number, kicks: number[], snares: number[]): HitReport['drums'] {
  // K-weighted peaks: the most of a 10 ms mean square within 60 ms of each hit
  const kw = Float64Array.from(mono);
  for (const q of kWeightingFilters(sr)) runBiquad(kw, q, false);
  const { t: tk, e: ek } = envelopeDb(kw, sr, 10, 1);
  const peakOf = (hits: number[]) =>
    median(
      hits
        .map((h) => {
          const i0 = searchSorted(tk, h);
          let m = -Infinity;
          for (let i = i0; i < Math.min(ek.length, i0 + 60); i++) m = Math.max(m, ek[i]);
          return m;
        })
        .filter(Number.isFinite),
    );
  let sq = 0;
  for (let i = 0; i < kw.length; i++) sq += kw[i] * kw[i];
  const mixK = db10(sq / Math.max(1, kw.length));
  const kickPeak = peakOf(kicks);
  const snarePeak = peakOf(snares);
  const offs = CURVE_OFFSETS_MS.map((ms) => ms / 1000);
  const fine = Array.from({ length: 61 }, (_, i) => i * 0.005);
  const curves: Record<string, number[]> = {};
  let sidechain = NaN;
  let sidechainAtMs = NaN;
  for (const [name, lo, hi] of [
    ['kick 250-1k', 250, 1000],
    ['kick 1-4k', 1000, 4000],
  ] as const) {
    if (kicks.length < 4) break;
    const band = bandpass(mono, sr, lo, hi);
    const c = triggered(band, sr, kicks, offs);
    if (c) curves[name] = c;
    const f = triggered(band, sr, kicks, fine);
    if (!f) continue;
    for (let i = 0; i < fine.length; i++) {
      if (fine[i] < 0.02 || fine[i] > 0.2 || !(Number.isNaN(sidechain) || f[i] < sidechain)) continue;
      sidechain = f[i];
      sidechainAtMs = Math.round(fine[i] * 1000);
    }
  }
  let subDuck = NaN;
  if (snares.length >= 4) {
    const band = bandpass(mono, sr, 30, 60);
    const c = triggered(band, sr, snares, offs);
    if (c) curves['snare sub 30-60'] = c;
    const f = triggered(band, sr, snares, fine);
    if (f) for (let i = 0; i < fine.length; i++) if (fine[i] <= 0.15 && (Number.isNaN(subDuck) || f[i] < subDuck)) subDuck = f[i];
  }
  return {
    kicks: kicks.length,
    snares: snares.length,
    kickPeak,
    snarePeak,
    kickOverMix: kickPeak - mixK,
    snareOverMix: snarePeak - mixK,
    sidechain,
    sidechainAtMs,
    subDuck,
    curves,
  };
}

/**
 * Measure a stretch of a mix. `onProgress` (0 to 1) is told between the steps. A three-minute
 * song takes a few seconds; a drop of 16 bars well under one.
 */
export function hitCheck(input: HitCheckInput, onProgress?: (fraction: number) => void): HitReport {
  const sr = input.sampleRate;
  const left0 = input.channels[0];
  const right0 = input.channels[1] ?? left0;
  const s0 = Math.max(0, Math.round((input.start ?? 0) * sr));
  const s1 = Math.min(left0.length, Math.round((input.end ?? left0.length / sr) * sr));
  const left = left0.subarray(s0, Math.max(s0, s1));
  const right = right0.subarray(s0, Math.max(s0, s1));
  const offset = s0 / sr;
  const seconds = left.length / sr;
  const beat = 60 / input.bpm;
  const six = beat / 4;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
  const step = (f: number) => onProgress?.(f);

  const loudness = measureLoudness(left, right, sr);
  step(0.25);
  const bands = measureBands(left, right, sr);
  step(0.35);
  let gridStart = input.gridStart !== undefined ? input.gridStart - offset : findGrid(mono, sr, six);
  if (gridStart < 0) gridStart += Math.ceil(-gridStart / six) * six;
  const grid: number[] = [];
  for (let g = gridStart; g + six <= seconds; g += six) grid.push(g);
  const rel = (v: readonly number[] | undefined) => (v ?? []).map((x) => x - offset).filter((x) => x >= 0 && x < seconds);
  const kicks = rel(input.kicks);
  const snares = rel(input.snares);
  const sustain = measureSustain(mono, sr, grid, beat, [...kicks, ...snares]);
  step(0.45);
  const pump = measurePump(mono, sr, grid, beat);
  step(0.55);
  const mixMovement = measureMovement(mono, sr, grid, beat);
  let movement = mixMovement;
  const bassL = input.bassChannels?.[0];
  if (bassL) {
    const bassR = input.bassChannels?.[1] ?? bassL;
    const bass = new Float32Array(left.length);
    for (let i = 0; i < bass.length && s0 + i < bassL.length; i++) bass[i] = (bassL[s0 + i] + bassR[s0 + i]) / 2;
    movement = measureMovement(bass, sr, grid, beat);
  }
  step(0.8);
  const report: HitReport = {
    seconds,
    bpm: input.bpm,
    gridStart,
    loudness,
    bands,
    sustain,
    pump,
    movementOf: bassL ? 'bass' : 'mix',
    ...(bassL ? { mixMovement } : {}),
    movement,
  };
  if (kicks.length || snares.length) report.drums = measureDrums(mono, sr, kicks, snares);
  step(1);
  return report;
}
