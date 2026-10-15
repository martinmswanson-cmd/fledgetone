/**
 * The master clipper: the mix driven into a soft or hard clipper just before the limiter, the way
 * loud rap and electronic masters shave their tallest drum peaks off so the limiter has less to do
 * (it squashes the whole mix where a clipper only touches the peaks). It is oversampled four times,
 * so the corners clipping puts on a wave don't fold back down as harsh, out-of-tune aliasing.
 *
 * How: the driven sound is upsampled (a 97-tap windowed-sinc low-pass, in four phases), each
 * oversampled point is bent by the clip curve, and only the difference the curve made (the
 * "residual") is filtered back down and added to the driven sound, delayed to line up. Where
 * nothing reaches the knee the residual is zero, so the sound passes untouched, sample for sample,
 * and the filters aren't even run (most of a song): its cost is only where it clips.
 *
 * The kernel is plain JavaScript (no imports, no closures over module state) so the worklet
 * module can embed it with Function.prototype.toString, the export can run the very same code over
 * a render (masterAfter.ts), and the unit test can run it directly: live and export are the same
 * maths. It delays the sound by CLIPPER_LATENCY samples; the export takes that delay back off.
 */

/** Settings of the master clipper (MasterSettings.clipper). */
export interface ClipperSettings {
  on: boolean;
  /** dB of gain into the clipper, 0 to CLIPPER_DRIVE_MAX: more drive, more of the peaks shaved */
  drive: number;
  /** 0 (hard: a flat top at the ceiling) to 1 (soft: bends from 6 dB under the ceiling) */
  softness: number;
  /** Where it clips, dBFS, CLIPPER_CEILING_MIN to 0 */
  ceiling: number;
}

export const CLIPPER_DRIVE_MAX = 18;
export const CLIPPER_CEILING_MIN = -12;
/** How far under the ceiling a fully soft clipper starts to bend, dB. */
export const CLIPPER_KNEE_DB = 6;

/** A clipper as it's first switched on: a few dB of drive into a mostly hard clip just under full scale. */
export function defaultClipper(): ClipperSettings {
  return { on: false, drive: 3, softness: 0.3, ceiling: -1 };
}

/** Fill in any missing / out-of-range clipper settings (hand-edited files). */
export function normalizeClipper(raw: unknown): ClipperSettings {
  const d = defaultClipper();
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
  return {
    on: r.on === true,
    drive: num(r.drive, d.drive, 0, CLIPPER_DRIVE_MAX),
    softness: num(r.softness, d.softness, 0, 1),
    ceiling: num(r.ceiling, d.ceiling, CLIPPER_CEILING_MIN, 0),
  };
}

/** The kernel's linear parameters from settings, rounded as k-rate AudioParams hold them (single precision). */
export function clipperParams(s: ClipperSettings): { drive: number; ceiling: number; softness: number } {
  return { drive: Math.fround(10 ** (s.drive / 20)), ceiling: Math.fround(10 ** (s.ceiling / 20)), softness: Math.fround(s.softness) };
}

/** What the clipper did over a stretch of sound. */
export interface ClipperReading {
  /** The most it took off any peak, dB (0: it never clipped). */
  peakDb: number;
  /** The share of samples it touched, 0 to 1. */
  share: number;
}

export interface ClipperKernel {
  /** Clip `frames` samples of each channel (in and out may be the same arrays). Params are linear. */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, drive: number, ceiling: number, softness: number) => void;
  /** Samples of delay. */
  latency: number;
  /** What it did since the last read, and start counting again. */
  read: () => ClipperReading;
}

export function createClipperKernel(_sampleRate: number): ClipperKernel {
  const FACTOR = 4;
  const LENGTH = 97;
  // The low-pass at the oversampled rate: a Kaiser-windowed sinc (beta 8, about 80 dB down),
  // centred a little under the original Nyquist, so what clipping makes above it is gone before
  // the sound is taken back down (and folds, if at all, above about 19 kHz)
  const cutoff = 0.46 / FACTOR;
  const bessel0 = (x: number) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 40; k++) {
      term *= (x / (2 * k)) * (x / (2 * k));
      sum += term;
    }
    return sum;
  };
  const beta = 8;
  const h = new Float64Array(LENGTH);
  const mid = (LENGTH - 1) / 2;
  let dc = 0;
  for (let j = 0; j < LENGTH; j++) {
    const t = j - mid;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const w = bessel0(beta * Math.sqrt(1 - (t / mid) * (t / mid))) / bessel0(beta);
    h[j] = sinc * w;
    dc += h[j];
  }
  for (let j = 0; j < LENGTH; j++) h[j] /= dc;
  // Upsampling by zero-stuffing then filtering is four filters (phases) over the input: phase p
  // takes taps p, p + 4, p + 8... times 4 (the zeros' lost energy)
  const phaseTaps = Math.ceil(LENGTH / FACTOR);
  const phases = new Float64Array(FACTOR * phaseTaps);
  let reach = 0;
  for (let p = 0; p < FACTOR; p++) {
    let sum = 0;
    for (let k = 0; k < phaseTaps; k++) {
      const j = p + FACTOR * k;
      const v = j < LENGTH ? FACTOR * h[j] : 0;
      phases[p * phaseTaps + k] = v;
      sum += Math.abs(v);
    }
    if (sum > reach) reach = sum;
  }
  // Through both filters the sound is (LENGTH - 1) oversampled points late: a whole number of samples
  const latency = (LENGTH - 1) / FACTOR;

  // Per channel: the last phaseTaps driven input samples (a ring written twice over, so the
  // newest always lie in one run), the residual at the oversampled rate (likewise), and the
  // driven input delayed by `latency`
  const makeChannel = () => ({
    hist: new Float64Array(2 * phaseTaps),
    res: new Float64Array(2 * LENGTH),
    delay: new Float64Array(latency + 1),
  });
  const chans = [makeChannel(), makeChannel()];
  let histAt = 0;
  let resAt = 0;
  let delayAt = 0;
  let n = 0;
  // When a sample last came near the knee, and when the residual was last non-zero (os points)
  let lastLoud = -1e9;
  let lastResidual = -1e9;
  let osIndex = 0;
  let peakReduction = 1;
  let touched = 0;
  let counted = 0;

  /** The clip curve at |v| (v >= 0): straight to the knee, then a tanh bend that never passes the ceiling. */
  const bend = (v: number, knee: number, ceiling: number) => {
    if (v <= knee) return v;
    const room = ceiling - knee;
    if (room <= 0) return ceiling;
    return knee + room * Math.tanh((v - knee) / room);
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, drive: number, ceiling: number, softness: number) => {
    const knee = ceiling * Math.pow(10, (-6 * Math.max(0, Math.min(1, softness))) / 20);
    // Below this, no oversampled point can reach the knee
    const quiet = knee / reach;
    const L = chans[0];
    const R = chans[1];
    for (let i = 0; i < frames; i++) {
      // (NaN or infinity counts as silence)
      const l = inL[i] - inL[i] === 0 ? inL[i] * drive : 0;
      const r = inR[i] - inR[i] === 0 ? inR[i] * drive : 0;
      histAt = histAt + 1 === phaseTaps ? 0 : histAt + 1;
      L.hist[histAt] = L.hist[histAt + phaseTaps] = l;
      R.hist[histAt] = R.hist[histAt + phaseTaps] = r;
      if (l > quiet || l < -quiet || r > quiet || r < -quiet) lastLoud = n;
      let clippedHere = false;
      // Four oversampled points per sample, each through the curve: the residual is what it took off
      for (let p = 0; p < FACTOR; p++) {
        resAt = resAt + 1 === LENGTH ? 0 : resAt + 1;
        let rl = 0;
        let rr = 0;
        if (n - lastLoud < phaseTaps) {
          const newest = histAt + phaseTaps;
          const base = p * phaseTaps;
          let ul = 0;
          let ur = 0;
          for (let k = 0; k < phaseTaps; k++) {
            const c = phases[base + k];
            ul += c * L.hist[newest - k];
            ur += c * R.hist[newest - k];
          }
          const al = ul < 0 ? -ul : ul;
          const ar = ur < 0 ? -ur : ur;
          if (al > knee) {
            const b = bend(al, knee, ceiling);
            rl = (ul < 0 ? -b : b) - ul;
            if (b / al < peakReduction) peakReduction = b / al;
            clippedHere = true;
          }
          if (ar > knee) {
            const b = bend(ar, knee, ceiling);
            rr = (ur < 0 ? -b : b) - ur;
            if (b / ar < peakReduction) peakReduction = b / ar;
            clippedHere = true;
          }
        }
        L.res[resAt] = L.res[resAt + LENGTH] = rl;
        R.res[resAt] = R.res[resAt + LENGTH] = rr;
        if (rl !== 0 || rr !== 0) lastResidual = osIndex;
        osIndex++;
      }
      if (clippedHere) touched++;
      counted++;
      // The residual filtered back down (only near where there is one), at this sample's phase
      let dl = 0;
      let dr = 0;
      if (osIndex - 1 - lastResidual < LENGTH) {
        const newest = resAt + LENGTH;
        for (let j = 0; j < LENGTH; j++) {
          const c = h[j];
          dl += c * L.res[newest - j];
          dr += c * R.res[newest - j];
        }
      }
      // The driven sound from `latency` samples ago, plus what the curve did to it
      const read = delayAt + 1 === latency + 1 ? 0 : delayAt + 1;
      outL[i] = L.delay[read] + dl;
      outR[i] = R.delay[read] + dr;
      L.delay[delayAt] = l;
      R.delay[delayAt] = r;
      delayAt = read;
      n++;
    }
  };

  const read = (): ClipperReading => {
    const reading = { peakDb: peakReduction < 1 ? -20 * Math.log10(peakReduction) : 0, share: counted ? touched / counted : 0 };
    peakReduction = 1;
    touched = 0;
    counted = 0;
    return reading;
  };

  return { process, latency, read };
}

/**
 * The clipper over whole channels in place, lined up with the input (its delay taken back off:
 * the last `latency` samples come from running it on over silence). What an export's master
 * section does (masterAfter.ts); returns what it did.
 */
export function clipChannels(left: Float32Array, right: Float32Array, sampleRate: number, settings: ClipperSettings): ClipperReading {
  const kernel = createClipperKernel(sampleRate);
  const { drive, ceiling, softness } = clipperParams(settings);
  const n = left.length;
  const lat = kernel.latency;
  const block = 4096;
  const outL = new Float32Array(block);
  const outR = new Float32Array(block);
  // Output sample i + lat is input sample i: write each block's output `lat` back
  const total = n + lat;
  const zeros = new Float32Array(block);
  for (let start = 0; start < total; start += block) {
    const end = Math.min(total, start + block);
    const frames = end - start;
    const inEnd = Math.min(n, end);
    const l = start < n ? left.subarray(start, inEnd) : zeros;
    const r = start < n ? right.subarray(start, inEnd) : zeros;
    let inL = l;
    let inR = r;
    if (l.length < frames) {
      inL = new Float32Array(frames);
      inL.set(l);
      inR = new Float32Array(frames);
      inR.set(r);
    }
    kernel.process(inL, inR, outL, outR, frames, drive, ceiling, softness);
    // (Input up to `end` has been read: writing back before index `end - lat` never overwrites unread input)
    for (let k = 0; k < frames; k++) {
      const at = start + k - lat;
      if (at >= 0 && at < n) {
        left[at] = outL[k];
        if (right !== left) right[at] = outR[k];
      }
    }
  }
  return kernel.read();
}

/** The worklet processor's name. */
export const CLIPPER_PROCESSOR = 'bbx-clipper';

/** How often the worklet tells the page what it's doing (for the meter), per second. */
const READINGS_PER_SECOND = 15;

/**
 * The AudioWorklet module: the kernel above with k-rate `drive`, `ceiling` (linear) and
 * `softness` params. It posts a ClipperReading a few times a second; a 'dispose' message stops it.
 */
export const CLIPPER_WORKLET_SOURCE = `
const createClipperKernel = ${createClipperKernel.toString()};
class ClipperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: 1, minValue: 0.001, maxValue: 1, automationRate: 'k-rate' },
      { name: 'softness', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.kernel = createClipperKernel(sampleRate);
    this.alive = true;
    this.silence = new Float32Array(128);
    this.frames = 0;
    this.every = Math.round(sampleRate / ${READINGS_PER_SECOND});
    this.port.onmessage = (e) => {
      if (e.data === 'dispose') this.alive = false;
    };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = input.length > 0 ? input[0] : this.silence;
    const inR = input.length > 1 ? input[1] : inL;
    this.kernel.process(inL, inR, outL, outR, frames, parameters.drive[0], parameters.ceiling[0], parameters.softness[0]);
    this.frames += frames;
    if (this.frames >= this.every) {
      this.frames = 0;
      this.port.postMessage(this.kernel.read());
    }
    return this.alive;
  }
}
registerProcessor('${CLIPPER_PROCESSOR}', ClipperProcessor);
`;
