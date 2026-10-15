/**
 * The master section after the master compressor, run in plain JavaScript over an export's
 * finished render: the OTT, the stereo width, the Level, then the look-ahead limiter, in the order
 * the live graph has them (engine.ts, masterChain.ts). The master compressor (the glue, a native
 * DynamicsCompressorNode) stays in the render; the render stops after it.
 *
 * Why not in the render: the OTT and the limiter are AudioWorklets live, and Chromium never frees
 * an OfflineAudioContext an AudioWorklet module was added to, so every export with the OTT on kept
 * its whole render in memory for good. Here the same kernels run over the samples instead (ott.ts,
 * limiter.ts), and the width does in plain maths what its nodes do, with the mono bass's high-pass
 * computed exactly as Web Audio's BiquadFilterNode computes it, so an export sounds as it did.
 * No Web Audio here, so Node can test it.
 */
import { createOttKernel } from './ott';
import { limitChannels } from './limiter';
import type { MasterSettings } from '../../store/timelineTypes';

/** Below this the Stereo width's "mono bass" keeps the sound in the middle. */
export const MONO_BASS_HZ = 120;
/** The mono bass's high-pass Q, as its BiquadFilterNodes are set (Web Audio reads it in dB for this type). */
export const MONO_BASS_Q = Math.SQRT1_2;

const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * A BiquadFilterNode's high-pass coefficients [b0, b1, b2, a1, a2] (normalized), as the Web Audio
 * spec and Chromium work them out: Q in dB (alpha = sin(w) / (2 * 10^(Q/20))), from the params'
 * single-precision values.
 */
export function webAudioHighpass(hz: number, q: number, sampleRate: number): Float64Array {
  const f = Math.min(Math.fround(hz), sampleRate / 2);
  const w = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * 10 ** (Math.fround(q) / 20));
  const a0 = 1 + alpha;
  const beta = (1 + cosw) / 2;
  return Float64Array.of(beta / a0, (-2 * beta) / a0, beta / a0, (-2 * cosw) / a0, (1 - alpha) / a0);
}

/** Run a biquad over `x` in place, its state in double precision and its output in single, as Chromium's. */
function biquad(x: Float32Array, c: Float64Array): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** The OTT over the sound, in place, with its settings as its AudioParams would hold them (single precision). */
export function ottChannels(left: Float32Array, right: Float32Array, sampleRate: number, ott: MasterSettings['ott']): void {
  const kernel = createOttKernel(sampleRate);
  const params = { depth: Math.fround(ott.depth), time: Math.fround(ott.time), inGain: Math.fround(dbToGain(ott.inGain)), outGain: Math.fround(dbToGain(ott.outGain)) };
  kernel.process(left, right, left, right, left.length, params);
}

/**
 * The Stereo width over the sound, in place: M = (L + R) / 2, S = (L - R) / 2, out M +/- amount * S,
 * with S through two high-passes at MONO_BASS_HZ first when the bass stays in the middle (see
 * createWidth in masterChain.ts, which does the same with nodes).
 */
export function widthChannels(left: Float32Array, right: Float32Array, sampleRate: number, width: MasterSettings['width']): void {
  const n = left.length;
  const amount = Math.fround(width.amount);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) side[i] = left[i] * 0.5 + right[i] * -0.5;
  if (width.monoBass) {
    const c = webAudioHighpass(MONO_BASS_HZ, MONO_BASS_Q, sampleRate);
    biquad(side, c);
    biquad(side, c);
  }
  for (let i = 0; i < n; i++) {
    const mid = Math.fround(left[i] * 0.5 + right[i] * 0.5);
    const s = Math.fround(side[i] * amount);
    left[i] = mid + s;
    right[i] = mid - s;
  }
}

/**
 * The master section after the compressor, over a render's two channels in place: the OTT and
 * the width (where on), the Level, the limiter, then the master volume (`volumeDb`, which comes
 * after the limiter, as the live destination's volume does).
 */
export function masterAfter(left: Float32Array, right: Float32Array, sampleRate: number, master: MasterSettings, volumeDb = 0): void {
  if (master.ott.on) ottChannels(left, right, sampleRate, master.ott);
  if (master.width.on) widthChannels(left, right, sampleRate, master.width);
  scaleChannels(left, right, Math.fround(dbToGain(master.level)));
  limitChannels(left, right, sampleRate);
  scaleChannels(left, right, dbToGain(volumeDb));
}

function scaleChannels(left: Float32Array, right: Float32Array, gain: number): void {
  if (gain === 1) return;
  for (let i = 0; i < left.length; i++) left[i] *= gain;
  if (right !== left) for (let i = 0; i < right.length; i++) right[i] *= gain;
}
