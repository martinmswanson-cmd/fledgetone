/**
 * The master limiter: a look-ahead, true-peak brickwall. The sound is delayed a little (its
 * `latency`, about 5 ms); meanwhile each incoming sample's peak, including the peaks between
 * samples that a DAC or an MP3 encoder will reconstruct, sets the gain it needs to stay under the
 * ceiling. The peaks between samples are found with the same 4x interpolation filter a true-peak
 * meter uses (ITU-R BS.1770, as loudness.ts measures exports): a simpler estimate (cubic
 * interpolation) missed up to half a dB on bright, dense mixes, so they passed the ceiling. The
 * gain is the lowest needed over the look-ahead window, eased back up afterwards (the release) and
 * smoothed with a moving average as long as the window, so it has always come down by the time the
 * peak plays, without a click. Both channels share one gain, so the stereo image doesn't shift.
 *
 * The kernel is plain JavaScript (no imports, no closures over module state) so the worklet module
 * can embed it with Function.prototype.toString, and the unit test can run it directly.
 */

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
  // The 4x interpolation filter of BS.1770-4 Annex 2 (as loudness.ts): four phases of 12 taps over
  // the latest samples, whose points fall between the samples 6 and 5 back
  const phases = [
    [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125],
    [-0.0291748046875, 0.029296875, -0.0517578125, 0.0891113281250, -0.166503906250, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
    [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.166503906250, 0.0891113281250, -0.0517578125, 0.029296875, -0.0291748046875],
    [-0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
  ];
  const taps = 12;
  // A point between samples is at most this many times the loudest sample under the filter, so
  // where every sample under it is quieter than ceiling / most, nothing there needs turning down
  let most = 0;
  for (const p of phases) {
    let sum = 0;
    for (const t of p) sum += Math.abs(t);
    if (sum > most) most = sum;
  }
  // The gain is smoothed over `box` samples; a sample's peaks are all known six samples after it
  // arrives (the filter's points on its far side need the samples after it), so the sound is
  // delayed box + 6 samples and the lowest gain is taken over at least that many, which keeps
  // every gain in the box under the need
  const see = 6;
  const box = Math.max(1, Math.round(sampleRate * 0.005));
  const delay = box + see;
  const size = delay + 1;
  // The lowest gain is held a little longer than the window (a bass note's next peak is up to
  // 25 ms away), so the gain doesn't swell between the peaks of one low note and distort it
  const hold = delay + Math.round(sampleRate * 0.025);
  const delayL = new Float32Array(size);
  const delayR = new Float32Array(size);
  // The last `taps` samples, per channel: a ring written twice over (at `at` and `at + taps`), so
  // the newest `taps` always lie in one run, hist[at + 1 .. at + taps], oldest first
  const histL = new Float64Array(2 * taps);
  const histR = new Float64Array(2 * taps);
  let at = 0;
  // When a sample last came near the ceiling (only then is the filter worth running)
  let lastLoud = -taps;
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

  const coef = Float64Array.from(phases.flat());
  // The highest |value| the filter finds between the samples 6 and 5 back in `hist` (and those two)
  const peakOf = (hist: Float64Array) => {
    const newest = at + taps;
    let p = Math.max(Math.abs(hist[newest - 5]), Math.abs(hist[newest - 6]));
    for (let ph = 0; ph < 4; ph++) {
      const base = ph * taps;
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += coef[base + k] * hist[newest - k];
      const m = acc < 0 ? -acc : acc;
      if (m > p) p = m;
    }
    return p;
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, ceiling: number, release: number) => {
    // Release: the gain recovers by this fraction of the way back each sample
    const rel = 1 - Math.exp(-1 / Math.max(1, release * sampleRate));
    const quiet = ceiling / most;
    for (let i = 0; i < frames; i++) {
      // (NaN or infinity counts as silence: one bad sample shouldn't reach the speakers, or hold
      // the gain down)
      const l = inL[i] - inL[i] === 0 ? inL[i] : 0;
      const r = inR[i] - inR[i] === 0 ? inR[i] : 0;
      at = at + 1 === taps ? 0 : at + 1;
      histL[at] = histL[at + taps] = l;
      histR[at] = histR[at + taps] = r;
      if (l > quiet || l < -quiet || r > quiet || r < -quiet) lastLoud = n;
      const peak = n - lastLoud < taps ? Math.max(peakOf(histL), peakOf(histR)) : 0;
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
