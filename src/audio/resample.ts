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

/** Zero crossings of the short kernel each side (sincAt). */
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

/** `x` at the fractional sample `t` (a 16-tap windowed sinc, full band; silence outside `x`). */
export function sincAt(x: Float32Array, t: number): number {
  const h = shortKernel();
  const i = Math.floor(t);
  const f = t - i;
  if (f === 0) return i >= 0 && i < x.length ? x[i] : 0;
  let sum = 0;
  const lo = Math.max(0, i - SHORT_ZEROS + 1);
  const hi = Math.min(x.length - 1, i + SHORT_ZEROS);
  for (let j = lo; j <= hi; j++) {
    const d = Math.abs(t - j) * RES;
    const k = d | 0;
    sum += x[j] * (h[k] + (d - k) * (h[k + 1] - h[k]));
  }
  return sum;
}
