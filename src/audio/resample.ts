/**
 * Band-limited resampling: a sound read at another speed (or at a changing one) through a
 * windowed-sinc filter (Kaiser window, 12 zero crossings a side), so reading it faster doesn't fold
 * what's above the new Nyquist back down as harsh, out-of-tune aliasing, and reading between
 * samples doesn't add the hiss a cubic read leaves on the highs. The pitch shifter (pitchShift.ts)
 * and the tuner's high band (vocalTune.ts) read their stretched sound back with it. Plain arrays,
 * so Node can unit-test it.
 */

/** Zero crossings of the sinc each side. */
const ZEROS = 12;
/** Table points per zero crossing (linear between). */
const RES = 256;
/** How much of the band (to Nyquist, or to the new Nyquist reading faster) is kept. */
const CUTOFF = 0.94;
const BETA = 8;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

let table: Float64Array | null = null;
/** sinc(t) times the Kaiser window, for t = 0 .. ZEROS in steps of 1 / RES (plus a guard point). */
function kernel(): Float64Array {
  if (table) return table;
  table = new Float64Array(ZEROS * RES + 2);
  const norm = besselI0(BETA);
  for (let i = 0; i < table.length; i++) {
    const t = i / RES;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = t / ZEROS;
    table[i] = r >= 1 ? 0 : (sinc * besselI0(BETA * Math.sqrt(1 - r * r))) / norm;
  }
  return table;
}

/**
 * `x` read at positions `at(i)` (fractional input samples) for i = 0 .. outLength - 1, the
 * reading `speed(i)` input samples per output sample there (above 1 the band is narrowed to the
 * new Nyquist). Silence outside `x`.
 */
export function resampleAt(x: Float32Array, outLength: number, at: (i: number) => number, speed: (i: number) => number): Float32Array {
  const h = kernel();
  const out = new Float32Array(outLength);
  const n = x.length;
  for (let i = 0; i < outLength; i++) {
    const t = at(i);
    const fc = CUTOFF * Math.min(1, 1 / Math.max(1e-6, speed(i)));
    const reach = ZEROS / fc;
    const lo = Math.max(0, Math.ceil(t - reach));
    const hi = Math.min(n - 1, Math.floor(t + reach));
    const scale = fc * RES;
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const d = Math.abs(t - j) * scale;
      const k = d | 0;
      if (k >= ZEROS * RES) continue;
      const f = d - k;
      sum += x[j] * (h[k] + f * (h[k + 1] - h[k]));
    }
    out[i] = sum * fc;
  }
  return out;
}

/** `x` read `speed` times as fast from `start` (input samples), `outLength` samples of it. */
export function resample(x: Float32Array, speed: number, outLength: number, start = 0): Float32Array {
  return resampleAt(x, outLength, (i) => start + i * speed, () => speed);
}

/** Zero crossings of the short kernel each side (sincTaps). */
const SHORT_ZEROS = 8;
let shortTable: Float64Array | null = null;
function shortKernel(): Float64Array {
  if (shortTable) return shortTable;
  shortTable = new Float64Array(SHORT_ZEROS * RES + 2);
  const norm = besselI0(BETA);
  for (let i = 0; i < shortTable.length; i++) {
    const t = i / RES;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = t / SHORT_ZEROS;
    shortTable[i] = r >= 1 ? 0 : (sinc * besselI0(BETA * Math.sqrt(1 - r * r))) / norm;
  }
  return shortTable;
}

/** Taps either side of the short kernel (sincTaps). */
export const SINC_HALF = SHORT_ZEROS;

/**
 * The short kernel's 16 taps for reading between samples `frac` (0 to 1) past a sample i: tap k
 * weighs sample i - SINC_HALF + 1 + k. Worked out once, they read any number of samples that
 * same fraction off (a grain laid down between samples).
 */
export function sincTaps(frac: number, taps: Float64Array): Float64Array {
  const h = shortKernel();
  for (let k = 0; k < 2 * SHORT_ZEROS; k++) {
    const d = Math.abs(frac - (k - SHORT_ZEROS + 1)) * RES;
    const i = d | 0;
    taps[k] = i + 1 < h.length ? h[i] + (d - i) * (h[i + 1] - h[i]) : 0;
  }
  return taps;
}
