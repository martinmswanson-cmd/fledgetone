/**
 * The master limiter: a look-ahead, true-peak brickwall. The sound is delayed a little (its
 * `latency`, about 5 ms); meanwhile each incoming sample's peak, including the peaks between
 * samples that a DAC or an MP3 encoder will reconstruct, sets the gain it needs to stay under the
 * ceiling. The peaks between samples are found with the same interpolation filter the true-peak
 * meter uses (8x, truePeakFilter.ts, as loudness.ts measures exports): a simpler estimate (cubic
 * interpolation, then BS.1770's own 4x example filter) missed up to half a dB on bright, dense
 * mixes, so they passed the ceiling. The filter's points are worked out only where one could
 * pass the ceiling (truePeakFilter's peak finder bounds them from the signal's bend first, exactly,
 * so the gain is the same as working out every point, at about the cost the 4x filter had). The
 * gain is the lowest needed over the look-ahead window, eased back up afterwards (the release) and
 * smoothed with a moving average as long as the window, so it has always come down by the time the
 * peak plays, without a click. Both channels share one gain, so the stereo image doesn't shift.
 *
 * The kernel (limiterKernel) is plain JavaScript (no imports, no closures over module state) so the worklet module
 * can embed it with Function.prototype.toString, and the unit test can run it directly.
 */

import { createPeakFinder, TRUE_PEAK_PLAN, type PeakFinder, type TruePeakPlan } from '../truePeakFilter';

/** The ceiling it holds the true peak under, in dBTP: room for MP3 / AAC encoding to overshoot a little. */
export const LIMITER_CEILING_DBTP = -1;
/**
 * Where the limiter aims, a hair under the ceiling: the meter's true peak (loudness.ts) reads a
 * render's every sample afresh, and an export aimed exactly at -1 dBTP read -0.99 now and then.
 */
export const LIMITER_AIM_DBTP = LIMITER_CEILING_DBTP - 0.05;
/**
 * The ceiling for compressed stems, in dBTP. Encoding overshoots the peaks it was given (a dense,
 * clipped drop's MP3 decoded 0.5 to 1.2 dB over it). A mixdown's MP3 or Ogg is limited at -1 like
 * a WAV and turned down afterwards by what its decoded file overshot (decodedPeak.ts); stems can't
 * each be turned down on their own without changing how they add up, so they keep this room.
 */
export const STEM_LOSSY_CEILING_DBTP = -2;
/**
 * The true-peak ceiling (dBTP) a render for an export in `format` ('wav', 'mp3', 'ogg', 'mp4') is
 * limited under: -1 for every format (a compressed file is then held under it once decoded, see
 * decodedPeak.ts), and STEM_LOSSY_CEILING_DBTP for compressed `stems`. (MP3, Ogg and video once
 * aimed 1 dB lower, 2 with Crunch, which cost them that much loudness and more limiting than the WAV.)
 */
export const exportCeilingDbtp = (format: string, stems = false): number => (stems && format !== 'wav' ? STEM_LOSSY_CEILING_DBTP : LIMITER_CEILING_DBTP);
/** Where the limiter aims for `ceilingDbtp`: a hair under it, as LIMITER_AIM_DBTP is under -1. */
export const limiterAimDbtp = (ceilingDbtp: number): number => ceilingDbtp + (LIMITER_AIM_DBTP - LIMITER_CEILING_DBTP);
/** How quickly the gain recovers after a peak (seconds) */
export const LIMITER_RELEASE = 0.06;

export interface LimiterKernel {
  /** Limit `frames` samples of each channel (in and out may be the same arrays). */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, ceiling: number, release: number) => void;
  /** Samples of delay. */
  latency: number;
  /** The gain applied to the last sample (1 = untouched), for meters. */
  gain: () => number;
}

/**
 * The kernel with the interpolation filter's plan and peak finder handed in (truePeakFilter.ts;
 * the worklet passes its own copies of them).
 */
export function limiterKernel(sampleRate: number, plan: TruePeakPlan, createFinder: (plan: TruePeakPlan) => PeakFinder): LimiterKernel {
  // The interpolation filter (truePeakFilter.ts, as loudness.ts): its points fall between the
  // samples taps / 2 and taps / 2 - 1 back. The finders work a sample's points out only where one
  // could pass the ceiling (exactly then: below it, nothing needs turning down anyway)
  const taps = plan.taps;
  const findL = createFinder(plan);
  const findR = createFinder(plan);
  // The gain is smoothed over `box` samples; a sample's peaks are all known taps / 2 samples after
  // it arrives (the filter's points on its far side need the samples after it), so the sound is
  // delayed box + taps / 2 samples and the lowest gain is taken over at least that many, which
  // keeps every gain in the box under the need
  const see = taps / 2;
  const box = Math.max(1, Math.round(sampleRate * 0.005));
  const delay = box + see;
  const size = delay + 1;
  // The lowest gain is held a little longer than the window (a bass note's next peak is up to
  // 25 ms away), so the gain doesn't swell between the peaks of one low note and distort it
  const hold = delay + Math.round(sampleRate * 0.025);
  const delayL = new Float32Array(size);
  const delayR = new Float32Array(size);
  // Sliding minimum of the needed gains over the window: a monotonic queue of (index, gain)
  const qIndex = new Float64Array(hold + 1);
  const qGain = new Float32Array(hold + 1);
  let qHead = 0;
  let qLen = 0;
  // Moving average of the released gain over the window
  const avg = new Float64Array(box);
  let avgSum = box;
  avg.fill(1);
  let avgAt = 0;
  let write = 0;
  let n = 0;
  let released = 1;
  let last = 1;

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, ceiling: number, release: number) => {
    // Release: the gain recovers by this fraction of the way back each sample
    const rel = 1 - Math.exp(-1 / Math.max(1, release * sampleRate));
    // The running numbers in locals for the loop (a number in a closure's variable is boxed
    // afresh at every write)
    let eased = released;
    let sum = avgSum;
    let gain = last;
    const q = hold + 1;
    for (let i = 0; i < frames; i++) {
      // (NaN or infinity counts as silence: one bad sample shouldn't reach the speakers, or hold
      // the gain down)
      const l = inL[i] - inL[i] === 0 ? inL[i] : 0;
      const r = inR[i] - inR[i] === 0 ? inR[i] : 0;
      findL.push(l);
      findR.push(r);
      const pl = findL.peak(ceiling);
      const pr = findR.peak(ceiling);
      const peak = pl > pr ? pl : pr;
      const need = peak > ceiling ? ceiling / peak : 1;
      // Into the sliding minimum (a ring of q: qHead + qLen < 2q)
      let tail = qHead + qLen - 1;
      while (qLen > 0 && qGain[tail >= q ? tail - q : tail] >= need) {
        qLen--;
        tail--;
      }
      const into = qHead + qLen >= q ? qHead + qLen - q : qHead + qLen;
      qIndex[into] = n;
      qGain[into] = need;
      qLen++;
      while (qIndex[qHead] <= n - hold) {
        qHead = qHead + 1 === q ? 0 : qHead + 1;
        qLen--;
      }
      const lowest = qGain[qHead];
      // Down at once, up at the release rate
      eased = lowest < eased ? lowest : eased + (lowest - eased) * rel;
      // Smoothed over the window, so a drop is a ramp that has finished as the peak plays
      sum += eased - avg[avgAt];
      avg[avgAt] = eased;
      avgAt = avgAt + 1 === box ? 0 : avgAt + 1;
      gain = Math.min(1, sum / box);
      // Out comes the sample from `delay` samples ago
      const read = write + 1 === size ? 0 : write + 1;
      let ol = delayL[read] * gain;
      let or = delayR[read] * gain;
      delayL[write] = l;
      delayR[write] = r;
      write = read;
      n++;
      // Anything the estimate missed (it can't see past the window's edge) is clipped
      if (ol > ceiling) ol = ceiling;
      else if (ol < -ceiling) ol = -ceiling;
      if (or > ceiling) or = ceiling;
      else if (or < -ceiling) or = -ceiling;
      outL[i] = ol;
      outR[i] = or;
    }
    released = eased;
    avgSum = sum;
    last = gain;
    // Keep the running sum from drifting
    if (n % 65536 < frames) {
      let s = 0;
      for (let k = 0; k < box; k++) s += avg[k];
      avgSum = s;
    }
  };

  return { process, latency: delay, gain: () => last };
}

/** The limiter kernel at `sampleRate`, with the true-peak filter of truePeakFilter.ts. */
export const createLimiterKernel = (sampleRate: number): LimiterKernel => limiterKernel(sampleRate, TRUE_PEAK_PLAN, createPeakFinder);

/**
 * The limiter run over whole rendered channels (stereo, changed in place), as the worklet would
 * have played them: delayed by its latency, the last `latency` samples of sound left in the
 * kernel. An export's master section limits this way after the render, as an AudioWorklet module
 * added to an OfflineAudioContext keeps Chromium from ever freeing it (a whole render kept per
 * export); the export plans for the latency, so the file lines up exactly as it did.
 * `ceilingDbtp` is the export's ceiling (see exportCeilingDbtp).
 */
export function limitChannels(left: Float32Array, right: Float32Array, sampleRate: number, ceilingDbtp = LIMITER_CEILING_DBTP): void {
  const kernel = createLimiterKernel(sampleRate);
  const ceiling = Math.pow(10, limiterAimDbtp(ceilingDbtp) / 20);
  const block = 4096;
  for (let start = 0; start < left.length; start += block) {
    const end = Math.min(left.length, start + block);
    const l = left.subarray(start, end);
    const r = right.subarray(start, end);
    kernel.process(l, r, l, r, end - start, ceiling, LIMITER_RELEASE);
  }
}

/**
 * The limiter over finished channels (changed in place), lined up as they were: limitChannels
 * delays the sound, so this runs it over a copy with room at the end and takes the delay off.
 * Under the ceiling nothing changes. For sound mixed after the master, as a video's own sound is.
 */
export function limitInPlace(channels: Float32Array[], sampleRate: number, ceilingDbtp = LIMITER_CEILING_DBTP): void {
  const latency = createLimiterKernel(sampleRate).latency;
  const padded = channels.map((c) => {
    const x = new Float32Array(c.length + latency);
    x.set(c);
    return x;
  });
  limitChannels(padded[0], padded[1] ?? new Float32Array(padded[0]), sampleRate, ceilingDbtp);
  channels.forEach((c, i) => c.set(padded[i].subarray(latency, latency + c.length)));
}

/** The worklet processor's name. */
export const LIMITER_PROCESSOR = 'bbx-limiter';

/**
 * The AudioWorklet module: the kernel above with k-rate `ceiling` (linear) and `release`
 * (seconds) params. A 'dispose' message stops it for good.
 */
export const LIMITER_WORKLET_SOURCE = `
const limiterKernel = ${limiterKernel.toString()};
const createPeakFinder = ${createPeakFinder.toString()};
const PLAN = ${JSON.stringify(TRUE_PEAK_PLAN)};
const createLimiterKernel = (sr) => limiterKernel(sr, PLAN, createPeakFinder);
class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: ${Math.pow(10, LIMITER_AIM_DBTP / 20)}, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: ${LIMITER_RELEASE}, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.kernel = createLimiterKernel(sampleRate);
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
    this.kernel.process(inL, inR, outL, outR, frames, parameters.ceiling[0], parameters.release[0]);
    return this.alive;
  }
}
registerProcessor('${LIMITER_PROCESSOR}', LimiterProcessor);
`;
