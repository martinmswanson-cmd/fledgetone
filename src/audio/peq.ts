import type { PeqBand, PeqType } from '../store/timelineTypes';

/**
 * The parametric EQ's maths: each band is one Web Audio biquad, and this works out the same
 * filter the browser runs (the Web Audio spec's formulas, from the Audio EQ Cookbook), so the curve
 * drawn is the curve heard. No audio here, so Node can unit-test it.
 */

/** The BiquadFilterNode type for a band shape. */
export const BIQUAD_TYPE: Record<PeqType, BiquadFilterType> = {
  lowcut: 'highpass',
  lowshelf: 'lowshelf',
  bell: 'peaking',
  notch: 'notch',
  highshelf: 'highshelf',
  highcut: 'lowpass',
};

/** What a band's Q param should be set to: Web Audio reads a low- or high-pass Q in dB, the others as a ratio. */
export function biquadQ(band: Pick<PeqBand, 'type' | 'q'>): number {
  return band.type === 'lowcut' || band.type === 'highcut' ? 20 * Math.log10(band.q) : band.q;
}

/** Shapes whose gain matters (cuts and notches have none). */
export const hasGain = (type: PeqType): boolean => type === 'bell' || type === 'lowshelf' || type === 'highshelf';
/** Shapes whose width (Q) matters (Web Audio's shelves have a fixed slope). */
export const hasQ = (type: PeqType): boolean => type !== 'lowshelf' && type !== 'highshelf';

type Coefficients = [b0: number, b1: number, b2: number, a0: number, a1: number, a2: number];

/** A band's biquad coefficients at `sampleRate`. */
export function coefficients(band: PeqBand, sampleRate: number): Coefficients {
  const f = Math.min(band.freq, sampleRate / 2 - 1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const q = Math.max(1e-4, band.q);
  const A = 10 ** (band.gain / 40);
  switch (band.type) {
    case 'lowcut': {
      const alpha = sin / (2 * q);
      return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    }
    case 'highcut': {
      const alpha = sin / (2 * q);
      return [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    }
    case 'bell': {
      const alpha = sin / (2 * q);
      return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
    }
    case 'notch': {
      const alpha = sin / (2 * q);
      return [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha];
    }
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * ((sin / 2) * Math.SQRT2);
      return [
        A * (A + 1 - (A - 1) * cos + s),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - s),
        A + 1 + (A - 1) * cos + s,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - s,
      ];
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * ((sin / 2) * Math.SQRT2);
      return [
        A * (A + 1 + (A - 1) * cos + s),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - s),
        A + 1 - (A - 1) * cos + s,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - s,
      ];
    }
  }
}

/** How much a band changes the level at `hz`, in dB. */
export function bandDb(band: PeqBand, hz: number, sampleRate = 48000): number {
  if (!band.on) return 0;
  const [b0, b1, b2, a0, a1, a2] = coefficients(band, sampleRate);
  const w = (2 * Math.PI * Math.min(hz, sampleRate / 2)) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = b0 + b1 * c1 + b2 * c2;
  const numIm = -(b1 * s1 + b2 * s2);
  const denRe = a0 + a1 * c1 + a2 * c2;
  const denIm = -(a1 * s1 + a2 * s2);
  const mag2 = (numRe * numRe + numIm * numIm) / Math.max(1e-30, denRe * denRe + denIm * denIm);
  return 10 * Math.log10(Math.max(1e-30, mag2));
}

/** The whole EQ's change of level at `hz`, in dB (the bands in series add up in dB). */
export function peqDb(bands: readonly PeqBand[], hz: number, sampleRate = 48000): number {
  let db = 0;
  for (const b of bands) db += bandDb(b, hz, sampleRate);
  return db;
}

/** The frequencies a curve is drawn at: `count` steps, evenly spaced on a log scale from 20 Hz to 20 kHz. */
export function logFrequencies(count: number, lo = 20, hi = 20000): number[] {
  return Array.from({ length: count }, (_, i) => lo * (hi / lo) ** (i / (count - 1)));
}
