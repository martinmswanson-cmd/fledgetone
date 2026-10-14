/**
 * The master limiter: a look-ahead, true-peak brickwall. The sound is delayed by LOOKAHEAD
 * seconds; meanwhile each incoming sample's peak (including the peaks between samples that a
 * DAC or an MP3 encoder will reconstruct, estimated by cubic interpolation at three points
 * between each pair of samples) sets the gain it needs to stay under the ceiling. The gain is the
 * lowest needed over the look-ahead window, eased back up afterwards (the release) and smoothed
 * with a moving average as long as the window, so it has always come down by the time the peak
 * plays, without a click. Both channels share one gain, so the stereo image doesn't shift.
 *
 * The kernel is plain JavaScript (no imports, no closures over module state) so the worklet module
 * can embed it with Function.prototype.toString, and the unit test can run it directly.
 */

/** How far ahead the limiter looks (and so how late the sound comes out), in seconds. */
export const LIMITER_LOOKAHEAD = 0.005;

/** The ceiling it holds the true peak under, in dBTP: room for MP3 / AAC encoding to overshoot a little. */
export const LIMITER_CEILING_DBTP = -1;

export interface LimiterKernel {
  /** Limit `frames` samples of each channel (in and out may be the same arrays). */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, ceiling: number, release: number) => void;
  /** Samples of delay. */
  latency: number;
  /** The gain applied to the last sample (1 = untouched), for meters. */
  gain: () => number;
}

export function createLimiterKernel(sampleRate: number): LimiterKernel {
  // The gain is smoothed over `box` samples; a sample's needed gain is known two samples after it
  // arrives (the peak estimate needs the next sample), so the sound is delayed box + 2 samples and
  // the lowest gain is taken over that many, which keeps every gain in the box under the need
  const box = Math.max(1, Math.round(sampleRate * 0.005));
  const delay = box + 2;
  const size = delay + 1;
  // The lowest gain is held a little longer than the window (a bass note's next peak is up to
  // 25 ms away), so the gain doesn't swell between the peaks of one low note and distort it
  const hold = delay + Math.round(sampleRate * 0.025);
  const delayL = new Float32Array(size);
  const delayR = new Float32Array(size);
  // The last four samples (the peak between the middle two needs one either side), per channel
  const histL = new Float32Array(4);
  const histR = new Float32Array(4);
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

  // The highest |value| on the curve through a, b, c, d between b and c (and at c), cubic
  // (Catmull-Rom) at a quarter, half and three quarters of the way
  const peakBetween = (a: number, b: number, c: number, d: number) => {
    let p = Math.abs(c);
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      const t2 = t * t;
      const t3 = t2 * t;
      const v = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      const m = Math.abs(v);
      if (m > p) p = m;
    }
    return p;
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, ceiling: number, release: number) => {
    // Release: the gain recovers by this fraction of the way back each sample
    const rel = 1 - Math.exp(-1 / Math.max(1, release * sampleRate));
    for (let i = 0; i < frames; i++) {
      const l = inL[i];
      const r = inR[i];
      histL[0] = histL[1];
      histL[1] = histL[2];
      histL[2] = histL[3];
      histL[3] = l;
      histR[0] = histR[1];
      histR[1] = histR[2];
      histR[2] = histR[3];
      histR[3] = r;
      // The peak around the previous sample (this one is the curve's last point)
      const peak = Math.max(peakBetween(histL[0], histL[1], histL[2], histL[3]), peakBetween(histR[0], histR[1], histR[2], histR[3]), Math.abs(histL[1]), Math.abs(histR[1]));
      const need = peak > ceiling ? ceiling / peak : 1;
      // Into the sliding minimum
      const q = hold + 1;
      while (qLen > 0 && qGain[(qHead + qLen - 1) % q] >= need) qLen--;
      qIndex[(qHead + qLen) % q] = n;
      qGain[(qHead + qLen) % q] = need;
      qLen++;
      while (qIndex[qHead] <= n - hold) {
        qHead = (qHead + 1) % q;
        qLen--;
      }
      const lowest = qGain[qHead];
      // Down at once, up at the release rate
      released = lowest < released ? lowest : released + (lowest - released) * rel;
      // Smoothed over the window, so a drop is a ramp that has finished as the peak plays
      avgSum += released - avg[avgAt];
      avg[avgAt] = released;
      avgAt = (avgAt + 1) % box;
      const gain = Math.min(1, avgSum / box);
      // Out comes the sample from `delay` samples ago
      const read = (write + 1) % size;
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
      last = gain;
    }
    // Keep the running sum from drifting
    if (n % 65536 < frames) {
      let s = 0;
      for (let k = 0; k < box; k++) s += avg[k];
      avgSum = s;
    }
  };

  return { process, latency: delay, gain: () => last };
}

/** The worklet processor's name. */
export const LIMITER_PROCESSOR = 'bbx-limiter';

/**
 * The AudioWorklet module: the kernel above with k-rate `ceiling` (linear) and `release`
 * (seconds) params. A 'dispose' message stops it for good.
 */
export const LIMITER_WORKLET_SOURCE = `
const createLimiterKernel = ${createLimiterKernel.toString()};
class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: ${Math.pow(10, LIMITER_CEILING_DBTP / 20)}, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.06, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
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
