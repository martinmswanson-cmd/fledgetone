/**
 * OTT: the "over the top" multiband compressor of modern bass music. The sound is split into
 * three bands (below 120 Hz, 120 Hz to 2.5 kHz, above), and each band is compressed both ways:
 * loud parts are turned down (downward compression) and quiet parts turned up (upward
 * compression), so every band sits at a steady level however the mix moves. That flattens a
 * mix, brings up reverb tails and detail, and makes basses and supersaws dense and bright.
 *
 * It runs as an AudioWorklet (OTT_WORKLET_SOURCE), on the master between the compressor and the
 * limiter. The maths is in createOttKernel, which is written to be self-contained (it uses nothing
 * from this module's scope) so that its source text can be pasted into the worklet, and so that
 * Node can unit-test the same code the worklet runs.
 *
 * Controls (OttSettings, see timelineTypes.ts): Depth scales how much each band is pushed up or
 * down (0 leaves the sound alone, apart from the crossover's phase); Time scales how fast the
 * bands react; In and Out gain are plain gains before and after.
 */

/** Where the bands split, in Hz. */
export const OTT_SPLITS = [120, 2500] as const;

/** The kernel's per-block settings: gains are linear, not dB. */
export interface OttParams {
  depth: number;
  time: number;
  inGain: number;
  outGain: number;
}

export interface OttKernel {
  /** Process `frames` samples of a stereo block in place or into separate output arrays. */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, params: OttParams) => void;
  /** The attack and release of each band (seconds) at a Time setting, for display and tests. */
  times: (time: number) => Array<{ attack: number; release: number }>;
  /** The gain each band last applied, in dB (for tests and meters). */
  bandGainsDb: () => number[];
}

/**
 * The OTT maths at one sample rate. SELF-CONTAINED: everything it needs is defined inside, since
 * its source is also the worklet's (see OTT_WORKLET_SOURCE).
 *
 * Crossovers are Linkwitz-Riley 4th order (two Butterworth biquads in series), which sum back
 * to a flat response. Each band's level is followed by a peak detector with the band's attack
 * and release, linked across the two channels, and turned into a gain: above the downward
 * threshold the band is reduced at 4:1; below the upward threshold it is raised at 4:1, by at
 * most 24 dB (so silence stays silent and the noise floor isn't lifted without end). Depth scales
 * that gain in dB. The low band reacts slower than the mid and the high faster, as the classic
 * presets do, so the sub doesn't pump on every cycle while the highs stay snappy.
 */
export function createOttKernel(sampleRate: number): OttKernel {
  const LOW_SPLIT = 120;
  const HIGH_SPLIT = 2500;
  const DOWN_THRESHOLD_DB = -18;
  const DOWN_RATIO = 4;
  const UP_THRESHOLD_DB = -30;
  const UP_RATIO = 4;
  const MAX_UP_DB = 24;
  /** Attack from 1 to 50 ms and release from 10 to 500 ms as Time goes 0 to 1, times each band's factor. */
  const BAND_TIME = [1.6, 1, 0.6];
  const DOWN_SLOPE = 1 - 1 / DOWN_RATIO;
  const UP_SLOPE = 1 - 1 / UP_RATIO;
  const DB_PER_NEPER = 20 / Math.LN10;
  const NEPER_PER_DB = Math.LN10 / 20;

  /** Normalized Butterworth biquad coefficients [b0, b1, b2, a1, a2] (Q = 1/sqrt2). */
  const butterworth = (type: 'lowpass' | 'highpass', hz: number): Float64Array => {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    const c = new Float64Array(5);
    if (type === 'lowpass') {
      c[0] = (1 - cosw) / 2 / a0;
      c[1] = (1 - cosw) / a0;
      c[2] = c[0];
    } else {
      c[0] = (1 + cosw) / 2 / a0;
      c[1] = -(1 + cosw) / a0;
      c[2] = c[0];
    }
    c[3] = (-2 * cosw) / a0;
    c[4] = (1 - alpha) / a0;
    return c;
  };
  // Eight stages per channel: low = LP1 LP1; rest = HP1 HP1; mid = LP2 LP2 of rest; high = HP2 HP2 of rest
  const stages = [
    butterworth('lowpass', LOW_SPLIT),
    butterworth('lowpass', LOW_SPLIT),
    butterworth('highpass', LOW_SPLIT),
    butterworth('highpass', LOW_SPLIT),
    butterworth('lowpass', HIGH_SPLIT),
    butterworth('lowpass', HIGH_SPLIT),
    butterworth('highpass', HIGH_SPLIT),
    butterworth('highpass', HIGH_SPLIT),
  ];
  /** Filter memory: per channel, per stage, [x1, x2, y1, y2]. */
  const memory = [new Float64Array(32), new Float64Array(32)];
  /** Each band's followed level (linear) and the gain it last applied (dB). */
  const envelope = new Float64Array(3);
  const gainsDb = new Float64Array(3);

  const times = (time: number) => {
    const t = Math.max(0, Math.min(1, time));
    return BAND_TIME.map((factor) => ({ attack: ((1 + 49 * t) / 1000) * factor, release: ((10 + 490 * t) / 1000) * factor }));
  };
  /** One-pole coefficient that gets most of the way in `seconds`. */
  const coefficient = (seconds: number) => Math.exp(-1 / (Math.max(1e-4, seconds) * sampleRate));

  /** Run one biquad stage over one sample. */
  const stage = (m: Float64Array, at: number, c: Float64Array, x: number): number => {
    const y = c[0] * x + c[1] * m[at] + c[2] * m[at + 1] - c[3] * m[at + 2] - c[4] * m[at + 3];
    m[at + 1] = m[at];
    m[at] = x;
    m[at + 3] = m[at + 2];
    m[at + 2] = y;
    return y;
  };

  const bands = new Float64Array(6);

  const process: OttKernel['process'] = (inL, inR, outL, outR, frames, params) => {
    const depth = Math.max(0, Math.min(1, params.depth));
    const inGain = params.inGain;
    const outGain = params.outGain;
    const bandTimes = times(params.time);
    const attack = bandTimes.map((b) => coefficient(b.attack));
    const release = bandTimes.map((b) => coefficient(b.release));
    for (let i = 0; i < frames; i++) {
      // Split each channel into its three bands
      for (let ch = 0; ch < 2; ch++) {
        const m = memory[ch];
        const x = (ch === 0 ? inL[i] : inR[i]) * inGain;
        const low = stage(m, 4, stages[1], stage(m, 0, stages[0], x));
        const rest = stage(m, 12, stages[3], stage(m, 8, stages[2], x));
        const mid = stage(m, 20, stages[5], stage(m, 16, stages[4], rest));
        const high = stage(m, 28, stages[7], stage(m, 24, stages[6], rest));
        bands[ch * 3] = low;
        bands[ch * 3 + 1] = mid;
        bands[ch * 3 + 2] = high;
      }
      let l = 0;
      let r = 0;
      for (let b = 0; b < 3; b++) {
        const left = bands[b];
        const right = bands[b + 3];
        // Linked peak detector: the louder side drives both
        const peak = Math.max(Math.abs(left), Math.abs(right));
        const env = envelope[b];
        const next = peak > env ? attack[b] * env + (1 - attack[b]) * peak : release[b] * env + (1 - release[b]) * peak;
        envelope[b] = next;
        const levelDb = Math.log(next + 1e-12) * DB_PER_NEPER;
        let gainDb = 0;
        if (levelDb > DOWN_THRESHOLD_DB) gainDb = -(levelDb - DOWN_THRESHOLD_DB) * DOWN_SLOPE;
        else if (levelDb < UP_THRESHOLD_DB) gainDb = Math.min(MAX_UP_DB, (UP_THRESHOLD_DB - levelDb) * UP_SLOPE);
        gainDb *= depth;
        gainsDb[b] = gainDb;
        const gain = Math.exp(gainDb * NEPER_PER_DB);
        l += left * gain;
        r += right * gain;
      }
      outL[i] = l * outGain;
      outR[i] = r * outGain;
    }
  };

  return { process, times, bandGainsDb: () => Array.from(gainsDb) };
}

/** The worklet processor's name. */
export const OTT_PROCESSOR = 'bbx-ott';

/**
 * The AudioWorklet module: the kernel above, driven by k-rate AudioParams (so settings ramp on
 * the audio clock, live and in the export). A 'dispose' message stops it for good; a disconnected
 * worklet that keeps returning true would otherwise be processed forever.
 */
export const OTT_WORKLET_SOURCE = `
const createOttKernel = ${createOttKernel.toString()};
class OttProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'time', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'inGain', defaultValue: 1, minValue: 0, maxValue: 16, automationRate: 'k-rate' },
      { name: 'outGain', defaultValue: 1, minValue: 0, maxValue: 16, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.kernel = createOttKernel(sampleRate);
    this.alive = true;
    this.silence = new Float32Array(128);
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
    this.kernel.process(inL, inR, outL, outR, frames, {
      depth: parameters.depth[0],
      time: parameters.time[0],
      inGain: parameters.inGain[0],
      outGain: parameters.outGain[0],
    });
    return this.alive;
  }
}
registerProcessor('${OTT_PROCESSOR}', OttProcessor);
`;
