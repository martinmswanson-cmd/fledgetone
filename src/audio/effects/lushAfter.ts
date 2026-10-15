/**
 * The lush reverb run in plain JavaScript over an export's reverb sends, after the render: the
 * shared reverb's input filters (the low cut and the damping that busEffects.ts puts before every
 * room) and the lush kernel (lushReverb.ts), as the live graph runs them.
 *
 * Why not in the render: the lush reverb is an AudioWorklet live, and Chromium never frees an
 * OfflineAudioContext an AudioWorklet module was added to, so every export with the lush room kept
 * its whole render in memory for good (each stem's too). The parts of a mix already send what
 * they'd feed it on channels of their own (renderInParts in exportWav.ts); the reverb is played over
 * their sum here, and its sound added to the mix where the reverb's return would add it.
 * No Web Audio here, so Node can test it.
 */
import { createLushKernel } from './lushReverb';
import { ROOM_STYLES } from './roomIR';
import { biquad, webAudioHighpass, webAudioLowpass } from './masterAfter';

/** The shared reverb's input filters (busEffects.ts): a low cut, so the bass doesn't boom in the wash... */
export const REVERB_LOW_CUT_HZ = 180;
/** ...and a gentle damping of the highs. */
export const REVERB_DAMP_HZ = 5500;
/** Their Q (Tone.Filter's default, which Web Audio reads in dB for these types). */
export const REVERB_FILTER_Q = 1;
/** The lush reverb's pre-delay (seconds). */
export const LUSH_PRE_DELAY = 0.01;

/** The lush reverb's decay for the master reverb's decay setting (seconds). */
export const lushDecay = (decay: number) => Math.max(0.8, Math.min(12, decay));

/** Web Audio's render quantum: the worklet hears its input in blocks of this many frames. */
const BLOCK = 128;

/**
 * The lush reverb's sound for these sends (the stereo sound reaching the shared reverb's input),
 * at reverb decay `decay`: the input filters, then the kernel, in blocks as the worklet runs it
 * with its params held (k-rate, single precision).
 */
export function lushReverbOf(sendL: Float32Array, sendR: Float32Array, sampleRate: number, decay: number): [Float32Array, Float32Array] {
  const n = sendL.length;
  const left = Float32Array.from(sendL);
  const right = Float32Array.from(sendR);
  const lowCut = webAudioHighpass(REVERB_LOW_CUT_HZ, REVERB_FILTER_Q, sampleRate);
  const damp = webAudioLowpass(REVERB_DAMP_HZ, REVERB_FILTER_Q, sampleRate);
  for (const ch of [left, right]) {
    biquad(ch, lowCut);
    biquad(ch, damp);
  }
  const design = ROOM_STYLES.lush;
  const kernel = createLushKernel(sampleRate, { low: design.low, preDelay: LUSH_PRE_DELAY });
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const d = Math.fround(lushDecay(decay));
  const high = Math.fround(design.high);
  // The last block padded to a whole one, as the worklet always gets
  const padL = new Float32Array(BLOCK);
  const padR = new Float32Array(BLOCK);
  const padOutL = new Float32Array(BLOCK);
  const padOutR = new Float32Array(BLOCK);
  for (let i = 0; i < n; i += BLOCK) {
    if (i + BLOCK <= n) {
      kernel.process(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK), outL.subarray(i, i + BLOCK), outR.subarray(i, i + BLOCK), BLOCK, d, high, 1, 0);
    } else {
      padL.fill(0).set(left.subarray(i));
      padR.fill(0).set(right.subarray(i));
      kernel.process(padL, padR, padOutL, padOutR, BLOCK, d, high, 1, 0);
      outL.set(padOutL.subarray(0, n - i), i);
      outR.set(padOutR.subarray(0, n - i), i);
    }
  }
  return [outL, outR];
}
