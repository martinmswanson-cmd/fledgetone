/**
 * The tempo and key of a recording (a sample, a loop, an audio clip), heard from its sound, with
 * how sure each guess is. Tempo: the onsets' spectral flux, autocorrelated, a comb over each
 * candidate tempo's beat and bar, a gentle preference for the tempos beats are made at, then
 * refined with the tempo finder (tempoFinder.ts) on the onsets and snapped to a whole number of
 * bars when the sound is a loop. Key: a chroma profile (how strongly each of the 12 pitch classes
 * sounds, from the spectrum's peaks, after measuring how far the recording sits from A440) matched
 * against the major and minor key templates (songKey.ts). Plain arrays, so Node can unit-test it.
 */
import { findTempos } from '../store/tempoFinder';
import { loopTempos } from '../store/audioClips';
import { KK_PROFILES, keyOf, rankKeys, type KeyProfiles, type SongKey } from '../store/songKey';

/** The rate analysis works at: plenty for onsets and for the pitches that say the key. */
export const ANALYSIS_RATE = 22050;

/** A detected tempo. */
export interface TempoGuess {
  bpm: number;
  /** 0 (a guess) to 1 (sure) */
  confidence: number;
  /** Half and double tempo are both plausible readings of most beats: the other one worth offering */
  alternative: number;
  /** The sound lasts a whole number of bars at this tempo (a loop) */
  loop: boolean;
}

/** A detected key. */
export interface KeyGuess {
  key: SongKey;
  /** 0 to 1 */
  confidence: number;
  /** The next likeliest key (often the relative major or minor) */
  runnerUp: SongKey;
  /** How far the recording sits from concert pitch (A440), in cents (-50 to +50) */
  cents: number;
  /** Strength of each pitch class, C first, normalized to the strongest */
  chroma: number[];
}

export interface SampleAnalysis {
  tempo: TempoGuess | null;
  key: KeyGuess | null;
  seconds: number;
}

// ---------- FFT ----------

/** In-place radix-2 FFT of (re, im); the length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude spectra of `x`, `size`-sample Hann frames every `hop` samples (bins 0 to size/2). */
function spectra(x: Float32Array, size: number, hop: number, each: (mag: Float64Array, frame: number) => void): number {
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2 + 1);
  const frames = x.length < size ? 1 : Math.floor((x.length - size) / hop) + 1;
  for (let f = 0; f < frames; f++) {
    const at = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = (at + i < x.length ? x[at + i] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    each(mag, f);
  }
  return frames;
}

// ---------- Tempo ----------

const FLUX_SIZE = 1024;
const FLUX_HOP = 256;
/** Tempos considered, BPM */
const BPM_MIN = 55;
const BPM_MAX = 210;
/** Tempos beats are usually made at: a preference (in octaves, a log-normal) centred here */
const PREFERRED_BPM = 105;
const PREFERENCE_OCTAVES = 0.9;
/**
 * The comb: [multiple of the beat, weight]. A beat repeats at two beats and a bar too; its 8ths
 * and 16ths count a little. Over 4 kHz, the flux is left out: dense hi-hats (a 16th roll) pulled
 * the tempo to a 5:4 or 3:2 of the real one in the tests, and the kick and snare say the beat.
 */
const COMB: ReadonlyArray<readonly [number, number]> = [[1, 1], [2, 0.75], [4, 0.75], [0.5, 0.5], [0.25, 0.25]];
const FLUX_TOP_HZ = 4000;
/**
 * Peakiness (see onsetStrength) of a sound with no hits at all: steady noise and a held tone
 * measured 5.2 to 5.5. Under MIN_PEAKINESS there's no beat to find; it takes SURE_PEAKINESS more
 * to be sure of one (the drum loops in the tests measured 9 to 15, chords with no drums 6.2).
 */
const MIN_PEAKINESS = 6;
const SURE_PEAKINESS = 6;

/**
 * Onset strength per frame (FLUX_HOP samples): how much the log spectrum rose since the frame
 * before, summed over the bins up to FLUX_TOP_HZ, less its local average (so a held chord doesn't
 * count). `peakiness` is its 98th percentile over its mean: high when it is a few sharp hits over
 * quiet, low when it is the even ripple of noise or a steady tone.
 */
export function onsetStrength(x: Float32Array, sampleRate: number): { strength: Float64Array; peakiness: number } {
  const top = Math.min(FLUX_SIZE / 2, Math.round((FLUX_TOP_HZ / sampleRate) * FLUX_SIZE));
  let prev: Float64Array | null = null;
  const flux: number[] = [];
  spectra(x, FLUX_SIZE, FLUX_HOP, (mag) => {
    const log = new Float64Array(top);
    for (let k = 1; k < top; k++) log[k] = Math.log1p(1000 * mag[k]);
    let sum = 0;
    if (prev) for (let k = 1; k < top; k++) sum += Math.max(0, log[k] - prev[k]);
    flux.push(sum);
    prev = log;
  });
  const out = new Float64Array(flux.length);
  const half = Math.max(1, Math.round((0.25 * sampleRate) / FLUX_HOP));
  let acc = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < flux.length; i++) {
    while (hi < Math.min(flux.length - 1, i + half)) acc += flux[++hi];
    while (lo < i - half) acc -= flux[lo++];
    out[i] = Math.max(0, flux[i] - acc / (hi - lo + 1));
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  let mean = 0;
  for (const v of out) mean += v / out.length;
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(0.98 * sorted.length))] ?? 0;
  return { strength: out, peakiness: mean > 0 ? p98 / mean : 0 };
}

/** Autocorrelation of `o` at a fractional lag (linear between the whole lags either side). */
function acfAt(acf: Float64Array, lag: number): number {
  const i = Math.floor(lag);
  if (i + 1 >= acf.length) return 0;
  const t = lag - i;
  return acf[i] * (1 - t) + acf[i + 1] * t;
}

/** Onset times in seconds: local peaks of the onset strength above a share of its loudest. */
export function onsetTimes(o: Float64Array, sampleRate: number): number[] {
  let peak = 0;
  for (const v of o) peak = Math.max(peak, v);
  const floor = peak * 0.12;
  const gap = Math.max(1, Math.round((0.06 * sampleRate) / FLUX_HOP));
  const out: number[] = [];
  let last = -gap;
  for (let i = 1; i < o.length - 1; i++) {
    if (o[i] <= floor || o[i] < o[i - 1] || o[i] < o[i + 1] || i - last < gap) continue;
    out.push(((i + 0.5) * FLUX_HOP + FLUX_SIZE / 2) / sampleRate);
    last = i;
  }
  return out;
}

/**
 * The tempo of a recording (mono, at `sampleRate`), or null when it has no clear pulse. The
 * comb scores a tempo by its beat and its multiples (two beats, a bar): a beat repeats at all of
 * them. Half and double the tempo score alike on most beats, so a mild preference for the tempos
 * beats are made at decides, and the other is offered as `alternative`.
 */
export function detectTempo(x: Float32Array, sampleRate: number): TempoGuess | null {
  const seconds = x.length / sampleRate;
  if (seconds < 1.5) return null;
  const { strength: o, peakiness } = onsetStrength(x, sampleRate);
  if (peakiness < MIN_PEAKINESS) return null;
  const n = o.length;
  const fps = sampleRate / FLUX_HOP;
  const maxLag = Math.min(n - 1, Math.ceil((fps * 60 * 4) / BPM_MIN) + 2);
  let mean = 0;
  for (const v of o) mean += v;
  mean /= n;
  let energy = 0;
  for (const v of o) energy += (v - mean) ** 2;
  if (!(energy > 1e-12)) return null;
  const acf = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean);
    // Unbiased: fewer overlapping frames at long lags
    acf[lag] = s / (energy * ((n - lag) / n));
  }
  const comb = (bpm: number) => {
    const beat = (fps * 60) / bpm;
    let s = 0;
    let w = 0;
    for (const [k, weight] of COMB) {
      const lag = beat * k;
      if (lag < 1 || lag >= maxLag) continue;
      s += weight * Math.max(0, acfAt(acf, lag));
      w += weight;
    }
    return w ? s / w : 0;
  };
  const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PREFERRED_BPM) / PREFERENCE_OCTAVES) ** 2);
  const scores: Array<{ bpm: number; raw: number; score: number }> = [];
  for (let b = BPM_MIN; b <= BPM_MAX; b += 0.25) {
    const raw = comb(b);
    scores.push({ bpm: b, raw, score: raw * prior(b) });
  }
  let best = scores[0];
  for (const s of scores) if (s.score > best.score) best = s;
  if (!(best.raw > 0.02)) return null;
  // How far the winner stands above the field, and how strong the pulse is at all
  const sorted = scores.map((s) => s.raw).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const salience = (best.raw - median) / (best.raw + 1e-9);
  let bpm = best.bpm;

  const hits = onsetTimes(o, sampleRate);
  // A held sound, a pad or a drone: a hit or two is no pulse
  if (hits.length < 4) return null;
  // Refine to 0.01 BPM with the tempo finder, on the onsets lined up with the beat's phase (it
  // counts its grid from 0)
  {
    const step = 60 / bpm / 2;
    let phase = hits[0];
    let most = -1;
    for (const h of hits.slice(0, 12)) {
      let on = 0;
      for (const t of hits) {
        const d = (((t - h) / step) % 1 + 1) % 1;
        if (Math.min(d, 1 - d) * step < 0.02) on++;
      }
      if (on > most) {
        most = on;
        phase = h;
      }
    }
    const shifted = hits.map((t) => t - phase + 60 / bpm).filter((t) => t > 0);
    const [fit] = findTempos(shifted, { grid: '8th', min: bpm * 0.985, max: bpm * 1.015, tolerance: 0.012, near: bpm, count: 1 });
    if (fit && fit.onGrid >= shifted.length * 0.5) bpm = fit.bpm;
  }

  // A loop: if it lasts a whole number of bars at a tempo this close, that's the tempo exactly
  let loop = false;
  for (const t of loopTempos(seconds, bpm)) {
    for (const k of [0.5, 1, 2]) {
      if (Math.abs(t * k - bpm) / bpm < 0.012) {
        bpm = t * k;
        loop = true;
        break;
      }
    }
    if (loop) break;
  }
  bpm = Math.round(bpm * 100) / 100;
  const alternative = Math.round((bpm < PREFERRED_BPM ? bpm * 2 : bpm / 2) * 100) / 100;
  const pulse = Math.min(1, best.raw / 0.35);
  // A pulse that stands out (salience), is strong (pulse) and is made of real hits (peakiness)
  const hitty = Math.sqrt(Math.min(1, (peakiness - MIN_PEAKINESS) / SURE_PEAKINESS));
  const confidence = Math.max(0, Math.min(1, salience * Math.sqrt(pulse) * hitty));
  return { bpm, confidence: Math.round(confidence * 100) / 100, alternative, loop };
}

// ---------- Key ----------

const CHROMA_SIZE = 8192;
const CHROMA_HOP = 4096;
/** Pitches heard for the key, Hz: from the bass up through the chords' harmonics */
const CHROMA_LO = 55;
const CHROMA_HI = 2000;
/** The opening of a sample (this share of it) and how much more it counts for the key */
const OPENING_SHARE = 0.2;

/** How the key is heard (the defaults are what the tests measured best). */
export interface KeyOptions {
  profiles?: KeyProfiles;
  /** How much more the opening counts (1: no more) */
  opening?: number;
  /** How much more the bass (under G3) counts */
  bass?: number;
}
const KEY_DEFAULTS: Required<KeyOptions> = { profiles: KK_PROFILES, opening: 2, bass: 2.5 };

interface Peak {
  /** Fractional MIDI note */
  midi: number;
  weight: number;
}

/** The spectral peaks of every frame, as fractional MIDI notes with a weight. */
function pitchPeaks(x: Float32Array, sampleRate: number, opening: number, bass: number): Peak[] {
  const peaks: Peak[] = [];
  const binHz = sampleRate / CHROMA_SIZE;
  const k0 = Math.max(2, Math.floor(CHROMA_LO / binHz));
  const k1 = Math.min(CHROMA_SIZE / 2 - 2, Math.ceil(CHROMA_HI / binHz));
  const frames = x.length < CHROMA_SIZE ? 1 : Math.floor((x.length - CHROMA_SIZE) / CHROMA_HOP) + 1;
  spectra(x, CHROMA_SIZE, CHROMA_HOP, (mag, frame) => {
    // A sample or loop usually starts on its home chord: its opening counts for more
    const lead = frame < Math.max(1, frames * OPENING_SHARE) ? opening : 1;
    let top = 0;
    for (let k = k0; k <= k1; k++) top = Math.max(top, mag[k]);
    if (top < 1e-6) return;
    const floor = top * 0.03;
    for (let k = k0; k <= k1; k++) {
      const m = mag[k];
      if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue;
      // Parabolic interpolation on the log magnitude for the peak's true frequency
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const d = a - 2 * b + c;
      const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
      const hz = (k + shift) * binHz;
      const midi = 69 + 12 * Math.log2(hz / 440);
      // Lower notes say more about the key (the bass, the chords' roots); the top is mostly harmonics
      const register = midi < 55 ? bass : midi > 84 ? 0.5 : 1;
      peaks.push({ midi, weight: Math.sqrt(m / top) * register * lead });
    }
  });
  return peaks;
}

/** How far the peaks sit from equal temperament at A440, in cents (a circular mean over the semitone). */
export function tuningCents(peaks: ReadonlyArray<Peak>): number {
  let s = 0;
  let c = 0;
  for (const p of peaks) {
    const a = 2 * Math.PI * (p.midi - Math.round(p.midi));
    s += p.weight * Math.sin(a);
    c += p.weight * Math.cos(a);
  }
  if (!s && !c) return 0;
  return Math.round((Math.atan2(s, c) / (2 * Math.PI)) * 100);
}

/** The chroma of a recording: each pitch class's weight, C first, after allowing for its tuning. */
export function chromaOf(x: Float32Array, sampleRate: number, options: KeyOptions = {}): { chroma: number[]; cents: number } {
  const o = { ...KEY_DEFAULTS, ...options };
  const peaks = pitchPeaks(x, sampleRate, o.opening, o.bass);
  const cents = tuningCents(peaks);
  const chroma = new Array(12).fill(0);
  for (const p of peaks) {
    const m = p.midi - cents / 100;
    const off = Math.abs(m - Math.round(m));
    // A peak between two semitones says little about either
    const w = p.weight * Math.max(0, 1 - 2.5 * off);
    chroma[((Math.round(m) % 12) + 12) % 12] += w;
  }
  const top = Math.max(...chroma);
  return { chroma: top > 0 ? chroma.map((v) => v / top) : chroma, cents };
}

/** The key of a recording (mono, at `sampleRate`), or null when it has no clear pitch. */
export function detectAudioKey(x: Float32Array, sampleRate: number, options: KeyOptions = {}): KeyGuess | null {
  const { chroma, cents } = chromaOf(x, sampleRate, options);
  if (!chroma.some((v) => v > 0)) return null;
  const ranked = rankKeys(chroma, options.profiles ?? KEY_DEFAULTS.profiles);
  const [first, second] = ranked;
  // Sure when it matches its template well and stands clear of the next key
  const margin = first.score - second.score;
  const confidence = Math.max(0, Math.min(1, first.score * 0.6 + margin * 4));
  return { key: first.key, confidence: Math.round(confidence * 100) / 100, runnerUp: second.key, cents, chroma: chroma.map((v) => Math.round(v * 1000) / 1000) };
}

/** Both at once. `x` is mono. */
export function analyzeSample(x: Float32Array, sampleRate: number): SampleAnalysis {
  return { tempo: detectTempo(x, sampleRate), key: detectAudioKey(x, sampleRate), seconds: x.length / sampleRate };
}

/** The longest stretch of a sound analysis reads, seconds (from its start): a loop or a sample, not a song. */
export const ANALYSIS_SECONDS = 60;

/**
 * The channels of a sound (at `sampleRate`) as analysis reads them: mixed to one, at
 * ANALYSIS_RATE (averaged over each step first, so the top doesn't fold down), at most
 * ANALYSIS_SECONDS long.
 */
export function forAnalysis(channels: ReadonlyArray<Float32Array>, sampleRate: number): Float32Array {
  const length = Math.min(channels[0]?.length ?? 0, Math.round(ANALYSIS_SECONDS * sampleRate));
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  if (sampleRate === ANALYSIS_RATE) return mono;
  const step = sampleRate / ANALYSIS_RATE;
  const out = new Float32Array(Math.floor(length / step));
  const reach = Math.max(1, Math.round(step));
  for (let j = 0; j < out.length; j++) {
    const at = Math.floor(j * step);
    let sum = 0;
    let n = 0;
    for (let i = at; i < Math.min(length, at + reach); i++, n++) sum += mono[i];
    out[j] = n ? sum / n : 0;
  }
  return out;
}

/** A key's short name: "A min", "C# maj". */
export const shortKey = (k: SongKey) => `${k.name.split(' ')[0]} ${k.mode === 'major' ? 'maj' : 'min'}`;

/**
 * The semitones (-6 to +5) that move a sample in `from` into `to`, with a minor sample going to
 * the relative minor of a major song (and the other way), so its chords fit the song's notes.
 * `cents` (the sample's own tuning) is taken off too: the shift lands it in tune.
 */
export function keyShift(from: SongKey, to: SongKey, cents = 0): number {
  const root = from.mode === to.mode ? from.root : from.mode === 'minor' ? (from.root + 3) % 12 : (from.root + 9) % 12;
  let d = (((to.root - root) % 12) + 12) % 12;
  if (d > 5) d -= 12;
  return Math.round((d - cents / 100) * 100) / 100;
}

export { keyOf };
