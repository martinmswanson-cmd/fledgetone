/**
 * Studio-grade re-pitching of a recording: a copy of it read `ratio` times as fast, made with a
 * windowed-sinc (Kaiser) polyphase filter, so a note between two of an instrument's recordings
 * plays its copy at a playback rate of exactly 1 instead of the browser's buffer source stretching
 * it with linear interpolation (images 11 to 36 dB under the note, the top octave up to 5 dB down).
 * Images and aliases here are at least 80 dB down and the response is flat to 20 kHz at 44.1 and
 * 48 kHz. A copy that loops is made a hair faster or slower (a few hundredths of a cent) so its
 * loop is a whole number of frames long and starts on a frame: the buffer source then reads it on
 * whole frames for ever, never between two. Pure (channels in, channels out), so a Worker
 * (resampleWorker.ts) and Node can run it; pitchedCopies.ts makes and keeps the copies.
 */

/** A polyphase interpolation kernel: `taps` coefficients for each of `phases` + 1 fractional positions, and each row's difference to the next. */
export interface Kernel {
  taps: number;
  phases: number;
  coefs: Float32Array;
  diffs: Float32Array;
}

/** How far down a kernel's stopband is designed (dB): 10 dB past the 80 promised, for its passband ripple and the float maths. */
export const KERNEL_DB = 90;
/** Fractional positions in a kernel's table (linearly interpolated between: far finer than the 80 dB needs). */
const PHASES = 512;

/** The zeroth-order modified Bessel function (the Kaiser window's), by its series. */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/** The Kaiser window's beta for a stopband `db` down. */
const kaiserBeta = (db: number) => (db > 50 ? 0.1102 * (db - 8.7) : db >= 21 ? 0.5842 * (db - 21) ** 0.4 + 0.07886 * (db - 21) : 0);

/** Taps a Kaiser-windowed sinc needs for a transition `width` wide (cycles a sample) and `db` down: an even number, at least 8. */
export function tapsFor(width: number, db = KERNEL_DB): number {
  const n = Math.ceil((db - 7.95) / (14.36 * Math.max(1e-4, width)));
  return Math.max(8, n + (n & 1));
}

/** Kernels made, least recently used first (a Map keeps the order things were put in), and the bytes they take. */
const kernels = new Map<string, Kernel>();
let kernelBytes = 0;
/** How many bytes of kernels are kept (a Worker's): past it the least recently used go (made again if asked for: the same every time). */
export const KERNEL_CACHE_BYTES = 32e6;

/** How many kernels are kept, and their bytes (for the checks). */
export const kernelCache = () => ({ count: kernels.size, bytes: kernelBytes });

/** Let go of every kept kernel. */
export function clearKernels(): void {
  kernels.clear();
  kernelBytes = 0;
}

/**
 * A low-pass interpolation kernel: `cutoff` and `width` in cycles per input sample (the -6 dB
 * point, and the transition from pass to stop around it), `db` its stopband's depth. Kept by its
 * exact shape: a kernel is only ever reused for exactly the shape it was made for, so a copy is
 * the same whatever was made before it (two shapes a millionth apart once shared the first one's
 * kernel, and an export came out a little different from one session to the next).
 */
export function designKernel(cutoff: number, width: number, db = KERNEL_DB): Kernel {
  const taps = tapsFor(width, db);
  const key = `${taps}|${cutoff}|${width}|${db}`;
  const have = kernels.get(key);
  if (have) {
    kernels.delete(key);
    kernels.set(key, have);
    return have;
  }
  const beta = kaiserBeta(db);
  const norm = bessel0(beta);
  const half = taps / 2;
  const coefs = new Float32Array((PHASES + 1) * taps);
  const row = new Float64Array(taps);
  for (let p = 0; p <= PHASES; p++) {
    // Tap j reads the input `half - 1 - j + p / PHASES` samples before the position wanted
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const t = p / PHASES + half - 1 - j;
      const x = t / half;
      const w = Math.abs(x) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - x * x)) / norm;
      const arg = 2 * cutoff * t;
      const sinc = Math.abs(arg) < 1e-12 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      row[j] = 2 * cutoff * sinc * w;
      sum += row[j];
    }
    // (each row passes DC at exactly 1, so a steady level never ripples with the fraction)
    for (let j = 0; j < taps; j++) coefs[p * taps + j] = row[j] / sum;
  }
  const diffs = new Float32Array(PHASES * taps);
  for (let i = 0; i < diffs.length; i++) diffs[i] = coefs[i + taps] - coefs[i];
  const kernel = { taps, phases: PHASES, coefs, diffs };
  kernels.set(key, kernel);
  kernelBytes += coefs.byteLength + diffs.byteLength;
  for (const [k, old] of kernels) {
    if (kernelBytes <= KERNEL_CACHE_BYTES || old === kernel) break;
    kernels.delete(k);
    kernelBytes -= old.coefs.byteLength + old.diffs.byteLength;
  }
  return kernel;
}

/** Where a copy reads its source: output frame n is the source at `start + n * step` frames, for `length` frames. */
export interface ReadPlan {
  start: number;
  step: number;
  length: number;
}

/**
 * Frames `from` to `to` of a copy of `input` read as `plan` says, through `kernel`, into `out`
 * (one array per channel, each `plan.length` long). Positions outside the source read silence.
 * In pieces (from, to) so a caller can pause between them.
 */
export function resampleInto(input: Float32Array[], plan: ReadPlan, kernel: Kernel, out: Float32Array[], from = 0, to = plan.length): void {
  const { taps, phases, coefs, diffs } = kernel;
  const half = taps / 2;
  const len = input[0]?.length ?? 0;
  const chans = Math.min(input.length, out.length);
  const x0 = input[0];
  const x1 = chans > 1 ? input[1] : input[0];
  const y0 = out[0];
  const y1 = chans > 1 ? out[1] : out[0];
  for (let n = from; n < to; n++) {
    const pos = plan.start + n * plan.step;
    const i0 = Math.floor(pos);
    const pf = (pos - i0) * phases;
    let p = Math.floor(pf);
    let t = pf - p;
    if (p >= phases) {
      p = phases - 1;
      t = 1;
    }
    const row = p * taps;
    const k0 = i0 - half + 1;
    let a0 = 0;
    let a1 = 0;
    if (k0 >= 0 && k0 + taps <= len) {
      if (chans > 1) {
        for (let j = 0; j < taps; j++) {
          const c = coefs[row + j] + t * diffs[row + j];
          a0 += c * x0[k0 + j];
          a1 += c * x1[k0 + j];
        }
      } else {
        for (let j = 0; j < taps; j++) a0 += (coefs[row + j] + t * diffs[row + j]) * x0[k0 + j];
      }
    } else {
      // Near either end: what lies outside the source is silence
      const jFrom = Math.max(0, -k0);
      const jTo = Math.min(taps, len - k0);
      for (let j = jFrom; j < jTo; j++) {
        const c = coefs[row + j] + t * diffs[row + j];
        a0 += c * x0[k0 + j];
        if (chans > 1) a1 += c * x1[k0 + j];
      }
    }
    y0[n] = a0;
    if (chans > 1) y1[n] = a1;
  }
  // (more than two channels: the rest one at a time, through the same path)
  for (let c = 2; c < chans; c++) resampleInto([input[c]], plan, kernel, [out[c]], from, to);
}

/** A copy of `input` read as `plan` says (see resampleInto). */
export function resample(input: Float32Array[], plan: ReadPlan, kernel: Kernel): Float32Array[] {
  const out = input.map(() => new Float32Array(plan.length));
  resampleInto(input, plan, kernel, out);
  return out;
}

/**
 * The kernel for a copy `ratio` times as fast (pitched up by that ratio), from a source at
 * `inRate` into one at `outRate`, played in a context at `playRate` (an oversampled copy is read
 * every other frame there, with no filter of the browser's, so it has to be clean to the
 * context's Nyquist), from a source with nothing above `band` Hz (a recording decoded at twice its
 * rate holds only what its file did). Flat to 0.4535 of the context's rate (20 kHz at 44.1 kHz,
 * 21.8 kHz at 48), and everything that would fold back below that is KERNEL_DB down.
 */
export function copyKernel(ratio: number, inRate: number, outRate: number, playRate: number, band = inRate / 2): Kernel {
  const pass = 0.4535 * Math.min(playRate, outRate);
  const stop = Math.min(playRate, outRate) - pass;
  // In the source's own frequencies: the output's divided by the ratio, within what the source holds
  const top = Math.min(band, 0.49 * inRate);
  const p = Math.min(pass / ratio, top) / inRate;
  const s = Math.max(p + 1e-3, Math.min(stop / ratio, inRate - top) / inRate);
  // On a grid (KERNEL_GRID of a cycle a sample, about 12 Hz at 96 kHz), the pass edge rounded up
  // and the stop edge down, so ratios a hair apart (a loop's nudge, a pad's tuning) share one
  // kernel, the same one whichever comes first, and none is any worse than asked for
  const pi = Math.ceil(p * KERNEL_GRID - 1e-9);
  const si = Math.max(pi + 8, Math.floor(s * KERNEL_GRID + 1e-9));
  return designKernel((pi + si) / 2 / KERNEL_GRID, (si - pi) / KERNEL_GRID);
}

/** The grid copyKernel's band edges are on, in steps of a cycle a sample. */
const KERNEL_GRID = 8192;

/** What a copy is to be (planCopy): how it reads its source, its loop, and the ratio it really plays at. */
export interface CopyPlan extends ReadPlan {
  /** Its loop in seconds of the copy, on whole frames (the source's loop moved with it) */
  loop?: [number, number];
  /** The ratio it plays at: `ratio`, or a few hundredths of a cent off it so its loop is whole frames */
  ratio: number;
}

/**
 * How a copy `ratio` times as fast of a source `inLength` frames long at `inRate` is read, into a
 * copy at `outRate`: from the start (or `region`, seconds of the source, for a Slicer's slice) to
 * the end, and with the source's `loop` (seconds) moved with it. A loop's length becomes a whole
 * number of the copy's frames (the ratio moves by under a cent: half a frame in the loop's length)
 * and its start lands on a frame (the copy starts that fraction of a frame early), so a note that
 * loops stays on whole frames.
 */
export function planCopy(ratio: number, inRate: number, outRate: number, inLength: number, loop?: readonly [number, number], region?: readonly [number, number]): CopyPlan {
  const step0 = (ratio * inRate) / outRate;
  const end = region ? Math.min(inLength, region[1] * inRate) : inLength;
  if (loop && !region && loop[1] > loop[0]) {
    const span = (loop[1] - loop[0]) * inRate;
    const frames = Math.max(1, Math.round(span / step0));
    const step = span / frames;
    const k0 = Math.ceil((loop[0] * inRate) / step - 1e-9);
    const start = loop[0] * inRate - k0 * step;
    return { start, step, length: Math.max(1, Math.ceil((end - start) / step)), loop: [k0 / outRate, (k0 + frames) / outRate], ratio: (step * outRate) / inRate };
  }
  const start = region ? region[0] * inRate : 0;
  return { start, step: step0, length: Math.max(1, Math.ceil((end - start) / step0)), ratio };
}

/** A level outline (recordingMaths.ts: one value per OUTLINE_STEP seconds) for a copy `ratio` times as fast. */
export function stretchOutline(outline: Float32Array, ratio: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(outline.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(outline.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    // (the loudest of the stretch it covers, so a note is never judged quieter than it is)
    let m = 0;
    for (let k = a; k < b; k++) if (outline[k] > m) m = outline[k];
    out[i] = m;
  }
  return out;
}
