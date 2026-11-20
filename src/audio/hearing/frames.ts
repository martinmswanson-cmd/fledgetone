/**
 * The groundwork of the hearing measurements: decibels that never go infinite, the middle and sides
 * of a stereo pair, a signal cut into Hann-windowed power spectra, and the fractional-octave bands
 * those spectra are gathered into. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { fftInPlace } from '../fft';

/** The quietest level reported, dB: what silence reads as. */
export const FLOOR_DB = -120;

/** Power as dB (10 log10), floored at FLOOR_DB; zero, negative and NaN power read as the floor. */
export const db = (power: number): number => (power > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(power)) : FLOOR_DB);

/** The middle, (L + R) / 2; a copy of the channel when there is only one. */
export function midOf(channels: readonly Float32Array[]): Float32Array {
  if (channels.length < 2) return Float32Array.from(channels[0] ?? []);
  const [l, r] = channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < out.length; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}

/** The sides, (L - R) / 2; null when there is only one channel. */
export function sideOf(channels: readonly Float32Array[]): Float32Array | null {
  if (channels.length < 2) return null;
  const [l, r] = channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < out.length; i++) out[i] = (l[i] - r[i]) / 2;
  return out;
}

/** A signal's short-time power spectra. */
export interface Frames {
  size: number;
  hop: number;
  sampleRate: number;
  /** Per frame, size / 2 + 1 bins; the bins of a frame sum to the mean square of the signal in it. */
  power: Float32Array[];
}

/**
 * Hann-windowed power spectra, one per `hop` samples. The scale makes the bins of a frame sum to the
 * signal's mean square there (a full-scale sine sums to 0.5). A signal shorter than `size` gives one
 * zero-padded frame; an empty one gives none.
 */
export function framesOf(x: Float32Array, sampleRate: number, size: number, hop: number): Frames {
  const power: Float32Array[] = [];
  if (x.length > 0) {
    const window = new Float64Array(size);
    let windowPower = 0;
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      windowPower += window[i] * window[i];
    }
    // Parseval: the bins of the whole spectrum sum to size * sum(w^2) times the mean square
    const scale = 1 / (size * windowPower);
    const count = x.length <= size ? 1 : Math.floor((x.length - size) / hop) + 1;
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const half = size / 2;
    for (let f = 0; f < count; f++) {
      const start = f * hop;
      for (let i = 0; i < size; i++) {
        re[i] = start + i < x.length ? x[start + i] * window[i] : 0;
        im[i] = 0;
      }
      fftInPlace(re, im);
      const bins = new Float32Array(half + 1);
      for (let k = 0; k <= half; k++) {
        // The mirrored half folds in, except at DC and Nyquist
        bins[k] = (re[k] * re[k] + im[k] * im[k]) * scale * (k === 0 || k === half ? 1 : 2);
      }
      power.push(bins);
    }
  }
  return { size, hop, sampleRate, power };
}

/** Band edges and centres, `perOctave` bands per octave from `lo` up; no band reaches past `hi` or half the sample rate. */
export function bandEdges(perOctave: number, sampleRate: number, lo = 20, hi = 20000): { centres: number[]; edges: number[] } {
  const limit = Math.min(hi, sampleRate / 2) * 1.0001;
  const step = 2 ** (1 / perOctave);
  const edges = [lo];
  const centres: number[] = [];
  for (let upper = lo * step; upper <= limit; upper *= step) {
    centres.push(Math.sqrt(edges[edges.length - 1] * upper));
    edges.push(upper);
  }
  return { centres, edges };
}

/** One spectrum's linear power per band; a bin is shared between bands in proportion to their overlap with it. */
export function toBands(power: ArrayLike<number>, sampleRate: number, size: number, edges: readonly number[]): Float64Array {
  const out = new Float64Array(Math.max(0, edges.length - 1));
  const binHz = sampleRate / size;
  for (let b = 0; b < out.length; b++) {
    const lo = edges[b];
    const hi = edges[b + 1];
    const first = Math.max(0, Math.floor(lo / binHz - 0.5));
    const last = Math.min(power.length - 1, Math.ceil(hi / binHz + 0.5));
    let sum = 0;
    for (let k = first; k <= last; k++) {
      const overlap = Math.min(hi, (k + 0.5) * binHz) - Math.max(lo, (k - 0.5) * binHz);
      if (overlap > 0) sum += power[k] * (overlap / binHz);
    }
    out[b] = sum;
  }
  return out;
}
