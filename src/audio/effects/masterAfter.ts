/**
 * The master section after the master compressor, run in plain JavaScript over an export's
 * finished render: the OTT, the stereo width, the Level, the clipper, then the look-ahead limiter, in the order
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
import { LIMITER_CEILING_DBTP, limitChannels, limiterAimDbtp } from './limiter';
import { clipChannels, type ClipperReading } from './clipper';
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

/** A BiquadFilterNode's low-pass coefficients [b0, b1, b2, a1, a2], worked out as webAudioHighpass's. */
export function webAudioLowpass(hz: number, q: number, sampleRate: number): Float64Array {
  const f = Math.min(Math.fround(hz), sampleRate / 2);
  const w = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * 10 ** (Math.fround(q) / 20));
  const a0 = 1 + alpha;
  const beta = (1 - cosw) / 2;
  return Float64Array.of(beta / a0, (2 * beta) / a0, beta / a0, (-2 * cosw) / a0, (1 - alpha) / a0);
}

/** Run a biquad over `x` in place, its state in double precision and its output in single, as Chromium's. */
export function biquad(x: Float32Array, c: Float64Array): void {
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
 * What the master section did to a render, for the Mix check: how hot the sound reached it, how
 * hard the clipper and the limiter worked.
 */
export interface MasterStats {
  /** Sample peak arriving from the compressor, dBFS. */
  inPeakDb: number;
  /** Sample peak reaching the limiter (after the Level and the clipper), dBFS. */
  limiterInPeakDb: number;
  /** The most the limiter had to take off a peak, dB (about: the peak over its ceiling). */
  limiterPeakDb: number;
  /** The share of 50 ms blocks where the limiter had to take off more than 1 dB. */
  limiterBusyShare: number;
  /** The clipper's work (absent: it was off). */
  clipper?: ClipperReading;
}

/**
 * The master section after the compressor, over a render's two channels in place: the OTT and
 * the width (where on), the Level, the clipper (where on), the limiter, then the master volume
 * (`volumeDb`, which comes after the limiter, as the live destination's volume does). The limiter
 * holds the true peak under `ceilingDbtp` (the export's: see exportCeilingDbtp in limiter.ts).
 * Returns what the section did (see MasterStats).
 */
export function masterAfter(left: Float32Array, right: Float32Array, sampleRate: number, master: MasterSettings, volumeDb = 0, ceilingDbtp = LIMITER_CEILING_DBTP): MasterStats {
  const inPeak = peakOf(left, right);
  if (master.ott.on) ottChannels(left, right, sampleRate, master.ott);
  if (master.width.on) widthChannels(left, right, sampleRate, master.width);
  scaleChannels(left, right, Math.fround(dbToGain(master.level)));
  const clipper = master.clipper?.on ? clipChannels(left, right, sampleRate, master.clipper) : undefined;
  const busy = limiterLoad(left, right, sampleRate, dbToGain(limiterAimDbtp(ceilingDbtp)));
  limitChannels(left, right, sampleRate, ceilingDbtp);
  scaleChannels(left, right, dbToGain(volumeDb));
  const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return { inPeakDb: db(inPeak), limiterInPeakDb: db(busy.peak), limiterPeakDb: busy.peakDb, limiterBusyShare: busy.share, ...(clipper ? { clipper } : {}) };
}

function peakOf(left: Float32Array, right: Float32Array): number {
  let p = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i]);
    const b = Math.abs(right[i]);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  return p;
}

/** How hard the limiter will have to work on this sound: its peak, the most over `ceiling`, and how often. */
function limiterLoad(left: Float32Array, right: Float32Array, sampleRate: number, ceiling: number): { peak: number; peakDb: number; share: number } {
  const block = Math.max(1, Math.round(sampleRate * 0.05));
  let peak = 0;
  let blocks = 0;
  let busy = 0;
  for (let start = 0; start < left.length; start += block) {
    const end = Math.min(left.length, start + block);
    let p = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(left[i]);
      const b = Math.abs(right[i]);
      if (a > p) p = a;
      if (b > p) p = b;
    }
    if (p > peak) peak = p;
    blocks++;
    if (p > ceiling * 1.122) busy++;
  }
  return { peak, peakDb: peak > ceiling ? 20 * Math.log10(peak / ceiling) : 0, share: blocks ? busy / blocks : 0 };
}

function scaleChannels(left: Float32Array, right: Float32Array, gain: number): void {
  if (gain === 1) return;
  for (let i = 0; i < left.length; i++) left[i] *= gain;
  if (right !== left) for (let i = 0; i < right.length; i++) right[i] *= gain;
}
