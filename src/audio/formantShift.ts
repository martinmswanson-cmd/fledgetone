/**
 * Formant shift: a sound's resonances (a voice's size: its vowels' formants) moved up or down while
 * its pitch and length stay exactly as they were. In the spectrum of each short window the fine
 * detail (the harmonics, which set the pitch) rides on a smooth outline (the spectral envelope,
 * which is the formants): the outline is found (cepstral smoothing, refined so it rides on the
 * harmonics' peaks rather than between them), and each bin is turned up or down by how the outline
 * moved there. Only levels change, never phases, so every harmonic stays where it was and nothing
 * new comes in between them. The channels share one outline (their mix's), so the stereo image
 * stays put. Plain arrays, so Node can unit-test it.
 */
import { fftInPlace } from "./fft";
import { vocoderSize } from "./phaseVocoder";

/** Smoothing passes that lift the outline onto the harmonics' peaks ("true envelope"). */
const PASSES = 3;
/** The furthest a bin is turned up or down, dB. */
const MAX_DB = 30;

/**
 * `input` (one array per channel) with its formants moved `semitones` (up: a smaller voice), at
 * the same pitch and length. `period` is the sound's pitch period in samples where known: the
 * outline is kept smoother than the harmonics' spacing.
 */
export function formantShiftChannels(input: readonly Float32Array[], semitones: number, sampleRate: number, period?: number | null): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || Math.abs(semitones) < 1e-3) return input.map((ch) => ch.slice());
  const ratio = 2 ** (semitones / 12);
  const n = vocoderSize(sampleRate) / 2;
  const hop = n / 4;
  const half = n / 2;
  const bins = half + 1;
  // The outline keeps detail only well under the harmonics' spacing (about 650 Hz where unpitched)
  const cut = Math.max(0.0005 * sampleRate, Math.min(0.0025 * sampleRate, period ? 0.5 * period : 0.0015 * sampleRate));
  /** The lowest harmonic's bin (the pitch's, or about 150 Hz) */
  const floorBin = ((period ? sampleRate / period : 150) * n) / sampleRate;
  const lifter = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    const d = Math.min(q, n - q);
    lifter[q] = d < cut ? 1 : d < 1.5 * cut ? 0.5 + 0.5 * Math.cos((Math.PI * (d - cut)) / (0.5 * cut)) : 0;
  }
  const win = new Float64Array(n);
  for (let j = 0; j < n; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  const logMag = new Float64Array(bins);
  /** The last three windows' outlines (log level), and whether each had any sound */
  const outlines = [new Float64Array(bins), new Float64Array(bins), new Float64Array(bins)];
  const sounding = [false, false, false];
  const gain = new Float64Array(bins);
  const output = input.map(() => new Float32Array(length));
  const frames = Math.ceil((length + half) / hop) + 2;
  const startOf = (f: number) => (f - 1) * hop - half;

  /** Window f's outline, into outlines[f % 3]. */
  const outline = (f: number) => {
    const slot = f % 3;
    const s0 = startOf(f);
    for (let j = 0; j < n; j++) {
      const s = s0 + j;
      let v = 0;
      if (s >= 0 && s < length) for (const ch of input) v += ch[s];
      re[j] = v * win[j];
      im[j] = 0;
    }
    fftInPlace(re, im);
    let loud = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      loud = Math.max(loud, m);
      logMag[k] = Math.log(m + 1e-9);
    }
    sounding[slot] = loud > 1e-7;
    if (!sounding[slot]) return;
    // True envelope: smooth the log spectrum (keep its low quefrencies), lift it to wherever the
    // spectrum pokes out above, and smooth again
    const env = outlines[slot];
    env.set(logMag);
    for (let pass = 0; pass < PASSES; pass++) {
      for (let k = 0; k < bins; k++) {
        cr[k] = env[k];
        ci[k] = 0;
        if (k > 0 && k < half) {
          cr[n - k] = env[k];
          ci[n - k] = 0;
        }
      }
      fftInPlace(cr, ci, true);
      for (let q = 0; q < n; q++) {
        cr[q] *= lifter[q];
        ci[q] = 0;
      }
      fftInPlace(cr, ci);
      for (let k = 0; k < bins; k++) env[k] = pass < PASSES - 1 ? Math.max(cr[k], logMag[k]) : cr[k];
    }
  };

  outline(0);
  for (let f = 0; f < frames; f++) {
    if (f + 1 < frames) outline(f + 1);
    // The outline here: this window's with a quarter of each neighbour's (steadier from window to window)
    const mid = outlines[f % 3];
    const prev = f > 0 && sounding[(f + 2) % 3] ? outlines[(f + 2) % 3] : mid;
    const next = f + 1 < frames && sounding[(f + 1) % 3] ? outlines[(f + 1) % 3] : mid;
    if (!sounding[f % 3]) gain.fill(1);
    else {
      // Each bin turned by how the outline moved there: the new outline at k is the old one at k / ratio
      const at = (k: number) => 0.5 * mid[k] + 0.25 * (prev[k] + next[k]);
      for (let k = 0; k < bins; k++) {
        // (Nothing is read from below the lowest harmonic, where the outline is only a guess)
        const from = k < floorBin ? k : Math.min(half, Math.max(floorBin, k / ratio));
        const i = Math.floor(from);
        const t = from - i;
        const moved = i < half ? at(i) + t * (at(i + 1) - at(i)) : at(half);
        const db = ((moved - at(k)) * 20) / Math.LN10;
        gain[k] = 10 ** (Math.max(-MAX_DB, Math.min(MAX_DB, db)) / 20);
      }
    }
    // Each channel's window, turned bin by bin, back to sound (Hann both ways: squares add to 1.5)
    const s0 = startOf(f);
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      for (let j = 0; j < n; j++) {
        const s = s0 + j;
        re[j] = s >= 0 && s < length ? src[s] * win[j] : 0;
        im[j] = 0;
      }
      fftInPlace(re, im);
      for (let k = 0; k < bins; k++) {
        re[k] *= gain[k];
        im[k] *= gain[k];
        if (k > 0 && k < half) {
          re[n - k] = re[k];
          im[n - k] = -im[k];
        }
      }
      fftInPlace(re, im, true);
      const dst = output[c];
      for (let j = 0; j < n; j++) {
        const s = s0 + j;
        if (s >= 0 && s < length) dst[s] += (re[j] * win[j]) / 1.5;
      }
    }
  }
  return output;
}
