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
/** ...and a gentle damping of the highs: the lush reverb's (each room style has its own: RoomDesign.damp). */
export const REVERB_DAMP_HZ = 5500;
/** The damping in front of a recorded room (its own walls already soak up its highs). */
export const RECORDED_ROOM_DAMP_HZ = 10000;
/** Their Q (Tone.Filter's default, which Web Audio reads in dB for these types). */
export const REVERB_FILTER_Q = 1;
/** The lush reverb's pre-delay (seconds). */
export const LUSH_PRE_DELAY = 0.01;

/**
 * The gain after a damping at `hz` that keeps the reverb as loud as it was through REVERB_DAMP_HZ
 * (once every style's damping): what a send of music brings through the low cut and the damping,
 * heard as loudness is measured, against what it brought through the old one. Music isn't pink
 * noise: its highs fall away fast above a couple of kHz, so a brighter damping lets next to
 * nothing more through, and the old damping's gentle peak (its Q) a little under 5.5 kHz made it
 * a hair louder there. So the makeup is a small lift (0.1 dB at 11 kHz), not a cut: worked out
 * with pink noise, it took half a dB off a plate on real songs.
 */
export function dampingMakeup(hz: number): number {
  const q = 10 ** (REVERB_FILTER_Q / 20);
  const power = (damp: number) => {
    let sum = 0;
    // Equal steps of log frequency, 20 Hz to 20 kHz: pink noise (the same power in every octave)
    // falling a further 6 dB an octave above 2 kHz, as a mix's highs do, through the loudness
    // weighting's lift of the highs (BS.1770's shelf: about +4 dB above 1.7 kHz)
    for (let i = 0; i <= 600; i++) {
      const f = 20 * 1000 ** (i / 600);
      const lo = f / damp;
      const hi = REVERB_LOW_CUT_HZ / f;
      const music = 1 / (1 + (f / 2000) ** 2);
      const shelf = (f / 1700) ** 2;
      const weight = (1 + 10 ** 0.4 * shelf) / (1 + shelf);
      sum += (music * weight) / ((1 - lo * lo) ** 2 + (lo / q) ** 2) / ((1 - hi * hi) ** 2 + (hi / q) ** 2);
    }
    return sum;
  };
  return Math.sqrt(power(REVERB_DAMP_HZ) / power(hz));
}

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
