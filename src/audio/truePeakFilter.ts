/**
 * The interpolation filter the true-peak meter (loudness.ts) and the master limiter
 * (effects/limiter.ts) find the peaks between samples with: 8x oversampling, a Kaiser-windowed
 * sinc of 32 taps a phase. BS.1770 asks for at least 4x; its own example filter (4 phases of 12
 * taps) has ripple of ±0.2-0.3 dB in the treble and its four points miss up to 0.3 dB of a peak
 * between them, so a limiter aiming by it left bright, loud, limited mixes 0.3 dB over the ceiling
 * (as ffmpeg's ebur128 reads them, whose resampler passes 97% of the band as this does). This
 * one reads sines within 0.07 dB of their true peak up to 20 kHz at 44.1 and 48 kHz, never over.
 *
 * Phase p (1 to 7) is the point p/8 of the way back from the sample TRUE_PEAK_TAPS / 2 - 1 back
 * to the one TRUE_PEAK_TAPS / 2 back; tap k multiplies the sample k back. The sample itself is
 * phase 0, read as it is. Plain maths, so the worklets embed the numbers as text.
 */

export const TRUE_PEAK_OVERSAMPLING = 8;
export const TRUE_PEAK_TAPS = 32;
const KAISER_BETA = 7;
/** The sinc's cutoff, a share of the Nyquist frequency (just under it: the window's transition sits above). */
const CUTOFF = 0.97;

function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / 2 / k) ** 2;
    sum += term;
  }
  return sum;
}

/** The filter's phases 1 to oversampling - 1, each `taps` taps, each summing to 1 (no gain at DC). */
export function designTruePeakPhases(oversampling = TRUE_PEAK_OVERSAMPLING, taps = TRUE_PEAK_TAPS, beta = KAISER_BETA, cutoff = CUTOFF): number[][] {
  const half = taps / 2;
  const phases: number[][] = [];
  for (let p = 1; p < oversampling; p++) {
    const frac = p / oversampling;
    const c: number[] = [];
    for (let k = 0; k < taps; k++) {
      const x = half - 1 - k + frac;
      const sinc = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
      const w = Math.abs(x) >= half ? 0 : bessel0(beta * Math.sqrt(1 - (x / half) ** 2)) / bessel0(beta);
      c.push(sinc * w);
    }
    const sum = c.reduce((a, b) => a + b, 0);
    phases.push(c.map((v) => v / sum));
  }
  return phases;
}

export const TRUE_PEAK_PHASES: readonly (readonly number[])[] = designTruePeakPhases();
