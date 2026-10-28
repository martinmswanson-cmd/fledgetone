/**
 * Time-stretching: play a recording faster or slower without changing its pitch, so an audio clip
 * can follow the song's tempo (and the pitch shifter, pitchShift.ts, can stretch before it
 * resamples). Each sound is first heard for what it is, and stretched the way that suits it:
 *
 * - Drums and other percussive sound (most of the energy above the kick's boom in hits and
 *   noise): WSOLA (waveform-similarity overlap-add), as it always was. The output is built from
 *   short overlapping windows of the input, each taken from about where it should be, nudged to
 *   where its waveform best continues the window before; hits are put exactly on time with the
 *   windows over them carried straight on, so each keeps its punch.
 * - Everything tonal (chords, pads, keys, voices, mixes): the phase vocoder (phaseVocoder.ts),
 *   with a window as long as the sound allows: long (about 370 ms) for held chords, so their
 *   close partials come apart and stay clean, shorter for a voice's vibrato and slides, which a
 *   long window would blur. Around each hit (an attack, a drum in a mix, a consonant) the
 *   percussive part (harmonicPercussive.ts) is split off and goes through a short window, so the
 *   hits stay sharp; everywhere else the sound stays whole. Partials a hit starts are placed
 *   exactly where the hit belongs, so nothing is smeared ahead of it.
 *
 * Either way the lengths are exact (Math.round(length / ratio), or each warp piece to its own)
 * and the hits land on time.
 *
 * Plain arrays, so Node can unit-test it.
 */
import { glideRate, vocode, vocoderSize, type TimeMap } from './phaseVocoder';
import { harmonicPercussive, type HarmonicPercussive } from './harmonicPercussive';

/**
 * Which stretch this is: part of the key of every stretched copy kept (soundLibrary.ts) and of a
 * frozen track's fingerprint, so a sound stretched by an older version is made again.
 */
export const STRETCH_VERSION = 2;

export type StretchEngine = 'wsola' | 'vocoder';

export interface StretchAnalysis {
  engine: StretchEngine;
  /** The phase vocoder's window for the harmonic part (samples) */
  size: number;
  /** The share of the energy above 200 Hz that is percussive, 0 to 1 */
  percussive: number;
  /** How fast the partials glide, cents per second (see glideRate) */
  glide: number;
  /** The hits (input samples) and the harmonic-percussive split around them, for the stretch to use */
  hits: number[];
  split: HarmonicPercussive;
}

/** A sound this percussive above 200 Hz (hits and noise, with only a kick's boom held) is drums: WSOLA. */
export const PERCUSSIVE_SHARE = 0.7;

/** The phase vocoder's window for a sound whose partials glide `glide` cents a second. */
export function vocoderSizeFor(glide: number, sampleRate: number): number {
  const base = vocoderSize(sampleRate);
  // Held notes and chords: 4x (about 370 ms), so close partials come apart; a voice's vibrato
  // (hundreds of cents a second) 1x or 1/2x, which follows it
  if (glide < 150) return base * 4;
  if (glide < 300) return base * 2;
  if (glide < 500) return base;
  return base / 2;
}

/** Windows per window length: 8 for the short windows (cheap, and a little cleaner), 4 for the long. */
const overlapFor = (size: number, sampleRate: number) => (size <= vocoderSize(sampleRate) ? 8 : 4);

/** What `input` is, for the stretch: drums (WSOLA) or tonal (the phase vocoder), and its window. */
export function analyseForStretch(input: readonly Float32Array[], sampleRate: number): StretchAnalysis {
  const mono = mixOf(input);
  const hits = hitsOf(mono, sampleRate);
  const split = harmonicPercussive(input, sampleRate, hits);
  const percussive = split.percussiveHighShare;
  const engine: StretchEngine = percussive >= PERCUSSIVE_SHARE ? 'wsola' : 'vocoder';
  // (How fast the partials glide only matters to the vocoder)
  const glide = engine === 'vocoder' ? glideRate(mono, sampleRate) : 0;
  return { engine, size: vocoderSizeFor(glide, sampleRate), percussive, glide, hits, split };
}

function mixOf(input: readonly Float32Array[]): Float32Array {
  if (input.length === 1) return input[0];
  const length = input[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const ch of input) for (let i = 0; i < length; i++) mono[i] += ch[i] / input.length;
  return mono;
}

/** The hits the phase vocoder keeps in place: the sound's start, and its onsets. */
function hitsOf(mono: Float32Array, sampleRate: number): number[] {
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  let first = 0;
  while (first < mono.length && Math.abs(mono[first]) <= peak * 1e-3) first++;
  return [first, ...onsets(mono, sampleRate).filter((o) => o > first + 0.02 * sampleRate)];
}

/** A stretch of one piece of a sound: input samples `from` to `to` become output samples `outFrom` to `outTo`. */
export interface StretchPiece {
  from: number;
  to: number;
  outFrom: number;
  outTo: number;
}

/** `ch` cut or padded with silence to `length`. */
function fitLength(ch: Float32Array, length: number): Float32Array {
  if (ch.length === length) return ch;
  if (ch.length > length) return ch.slice(0, length);
  const out = new Float32Array(length);
  out.set(ch);
  return out;
}

/** WSOLA piece by piece, end to end (each piece to its exact length). */
function wsolaPieces(input: readonly Float32Array[], pieces: readonly StretchPiece[], sampleRate: number): Float32Array[] {
  const length = pieces.reduce((n, p) => n + (p.outTo - p.outFrom), 0);
  const out = input.map(() => new Float32Array(length));
  let at = 0;
  for (const p of pieces) {
    const len = p.outTo - p.outFrom;
    const part = wsolaChannels(input.map((ch) => ch.subarray(p.from, p.to)), (p.to - p.from) / len, sampleRate);
    part.forEach((ch, c) => out[c].set(fitLength(ch, len), at));
    at += len;
  }
  return out;
}

/**
 * `input` (one array per channel) stretched piece by piece (a warp: each stretch between markers
 * to its own length), end to end. Pieces follow on from each other in the input and the output.
 * The sound is heard whole (analyseForStretch): drums are stretched piece by piece with WSOLA; a
 * tonal sound in one phase vocoder pass along all the pieces, so it runs on unbroken across them.
 */
export function warpChannels(input: readonly Float32Array[], pieces: readonly StretchPiece[], sampleRate: number, analysis = analyseForStretch(input, sampleRate)): Float32Array[] {
  const real = pieces.filter((p) => p.to > p.from && p.outTo > p.outFrom);
  if (!real.length || !input.length) return input.map(() => new Float32Array(0));
  if (analysis.engine === 'wsola') return wsolaPieces(input, real, sampleRate);
  // The map: every piece's ends, the output counted from the first piece's start
  const out: number[] = [];
  const inp: number[] = [];
  let at = 0;
  for (const p of real) {
    if (!out.length || out[out.length - 1] !== at) {
      out.push(at);
      inp.push(p.from);
    }
    at += p.outTo - p.outFrom;
    out.push(at);
    inp.push(p.to);
  }
  const length = at;
  const map: TimeMap = { out, in: inp };
  // The hits (each partial a hit starts lands exactly where the hit belongs), and the
  // percussive part around them
  const { hits } = analysis;
  const { harmonic, percussive } = analysis.split.parts();
  const tonal = vocode(harmonic, length, map, sampleRate, { size: analysis.size, overlap: overlapFor(analysis.size, sampleRate), onsets: hits });
  // The percussive part through a short window, which keeps the hits sharp (and, being the same
  // kind of stretch, in step with the harmonic part: the two add back up cleanly)
  const short = vocoderSize(sampleRate);
  const hitsPart = vocode(percussive, length, map, sampleRate, { size: short, overlap: overlapFor(short, sampleRate), onsets: hits });
  for (let c = 0; c < tonal.length; c++) {
    const t = tonal[c];
    const h = hitsPart[c];
    for (let i = 0; i < length; i++) t[i] += h[i];
  }
  return tonal;
}

/**
 * `input` (one array per channel) played `ratio` times as fast, at the same pitch: ratio 2 is half
 * as long, 0.5 twice as long (Math.round(length / ratio) samples). The channels are stretched
 * together, so a stereo image stays put.
 */
export function stretchChannels(input: readonly Float32Array[], ratio: number, sampleRate: number, analysis?: StretchAnalysis): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || !(ratio > 0)) return input.map((ch) => ch.slice());
  if (Math.abs(ratio - 1) < 1e-6) return input.map((ch) => ch.slice());
  const plan = analysis ?? analyseForStretch(input, sampleRate);
  if (plan.engine === 'wsola') return wsolaChannels(input, ratio, sampleRate);
  const outLength = Math.max(1, Math.round(length / ratio));
  return warpChannels(input, [{ from: 0, to: length, outFrom: 0, outTo: outLength }], sampleRate, plan);
}

/** Window length, in seconds: long enough for low notes, short enough to keep hits tight. */
const WINDOW_SECONDS = 0.04;
/** How far a window may move to find the best join, either way, in seconds. */
const SEARCH_SECONDS = 0.012;
/** The first, coarse search works on the input averaged over this many samples. */
const DECIMATE = 8;

/**
 * WSOLA: `input` (one array per channel) played `ratio` times as fast, at the same pitch: ratio 2
 * is half as long, 0.5 twice as long. The channels are stretched together (one set of joins,
 * chosen on their mix), so a stereo image stays put.
 */
export function wsolaChannels(input: readonly Float32Array[], ratio: number, sampleRate: number): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || !(ratio > 0)) return input.map((ch) => ch.slice());
  if (Math.abs(ratio - 1) < 1e-6) return input.map((ch) => ch.slice());
  const outLength = Math.max(1, Math.round(length / ratio));
  const n = Math.max(64, 2 * Math.round((WINDOW_SECONDS * sampleRate) / 2));
  const hop = n / 2;
  const search = Math.max(DECIMATE, Math.round(SEARCH_SECONDS * sampleRate));
  // Periodic Hann: two of them half a window apart add up to exactly 1
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  // The mix, and a coarse copy of it for the first search
  const mono = new Float32Array(length);
  for (const ch of input) for (let i = 0; i < length; i++) mono[i] += ch[i];
  const coarseLength = Math.ceil(length / DECIMATE);
  const coarse = new Float32Array(coarseLength);
  for (let j = 0; j < coarseLength; j++) {
    let sum = 0;
    const end = Math.min(length, (j + 1) * DECIMATE);
    for (let i = j * DECIMATE; i < end; i++) sum += mono[i];
    coarse[j] = sum;
  }
  const at = (a: Float32Array, i: number) => (i >= 0 && i < a.length ? a[i] : 0);
  // Hits (drum strikes, plucks) are placed exactly where they belong in the output and the windows
  // over them carry straight on, so each keeps its punch and its timing
  const hits = onsets(mono, sampleRate);
  let nextHit = 0;
  /** The hit being carried through, in input samples (-1: none) */
  let locked = -1;

  /** How alike the input is at `a` and at `b`, over `len` samples of `signal` (every `step`th). */
  const similarity = (signal: Float32Array, a: number, b: number, len: number) => {
    let sum = 0;
    if (a < 0 || b < 0 || a + len > signal.length || b + len > signal.length) {
      for (let i = 0; i < len; i++) sum += at(signal, a + i) * at(signal, b + i);
      return sum;
    }
    for (let i = 0; i < len; i++) sum += signal[a + i] * signal[b + i];
    return sum;
  };

  const output = input.map(() => new Float32Array(outLength + n));
  let prev = 0;
  const frames = Math.ceil(outLength / hop) + 1;
  for (let k = 0; k < frames; k++) {
    const outPos = k * hop;
    const nominal = Math.round(outPos * ratio);
    let start = nominal;
    const target = prev + hop;
    let placed = false;
    if (k > 0 && locked >= target && locked < target + n) {
      // Still over the hit: carry on, so its windows add up seamlessly
      start = target;
      placed = true;
    } else {
      locked = -1;
      while (nextHit < hits.length && hits[nextHit] / ratio < outPos) nextHit++;
      if (nextHit < hits.length && hits[nextHit] / ratio < outPos + n) {
        // A hit comes into this window: put it exactly on time (it enters past the window's
        // middle, so the next window, carrying on, covers it too)
        const h = hits[nextHit++];
        const at = Math.round(h - h / ratio + outPos);
        if (Math.abs(at - nominal) <= 2 * search) {
          start = at;
          locked = h;
          placed = true;
        }
      }
    }
    if (k > 0 && !placed) {
      // Where the last window would have carried on: find the start near `nominal` most like it
      const len = Math.round(n / 4);
      let best = -Infinity;
      let bestCoarse = 0;
      const lo = Math.round((nominal - search) / DECIMATE);
      const hi = Math.round((nominal + search) / DECIMATE);
      const t = Math.round(target / DECIMATE);
      for (let c = lo; c <= hi; c++) {
        const score = similarity(coarse, c, t, Math.ceil(len / DECIMATE));
        if (score > best) {
          best = score;
          bestCoarse = c;
        }
      }
      best = -Infinity;
      for (let d = bestCoarse * DECIMATE - DECIMATE; d <= bestCoarse * DECIMATE + DECIMATE; d++) {
        if (Math.abs(d - nominal) > search) continue;
        const score = similarity(mono, d, target, len);
        if (score > best) {
          best = score;
          start = d;
        }
      }
    }
    prev = start;
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const dst = output[c];
      for (let i = 0; i < n; i++) {
        const s = start + i;
        if (s >= 0 && s < length) dst[outPos + i] += src[s] * window[i];
      }
    }
  }
  // The first half window only had one window over it: bring it up to full level
  for (const dst of output) for (let i = 0; i < hop && i < outLength; i++) dst[i] /= Math.max(window[i], 1e-3);
  return output.map((ch) => ch.slice(0, outLength));
}

/** Where the hits (sudden rises in loudness) are in `x`, in samples, in order. */
export function onsets(x: Float32Array, sampleRate: number): number[] {
  const block = 128;
  const blocks = Math.floor(x.length / block);
  const energy = new Float32Array(blocks);
  let peak = 0;
  for (let b = 0; b < blocks; b++) {
    let e = 0;
    for (let i = b * block; i < (b + 1) * block; i++) e += x[i] * x[i];
    energy[b] = e;
    peak = Math.max(peak, e);
  }
  const floor = peak * 1e-4;
  const minGap = Math.round((0.05 * sampleRate) / block);
  const found: number[] = [];
  let last = -minGap;
  for (let b = 8; b < blocks; b++) {
    let before = 0;
    for (let j = b - 8; j < b; j++) before += energy[j];
    before /= 8;
    if (energy[b] > floor && energy[b] > 4 * before + 1e-12 && b - last >= minGap) {
      found.push(b * block);
      last = b;
    }
  }
  return found;
}
