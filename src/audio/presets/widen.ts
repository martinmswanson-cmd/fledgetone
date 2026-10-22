/**
 * A gentle stereo widener for the instruments that would otherwise play in mono (the pads and
 * leads): a copy of the sound a few milliseconds late, its lows cut, is added to the left and taken
 * from the right. Each side then rings at slightly different frequencies, which the ear hears as
 * width, while left plus right is exactly the sound as it was, so nothing is lost or hollowed out
 * when the song is played in mono (a phone speaker, a club's mono sub). Plain Web Audio nodes with
 * fixed settings: they cost next to nothing while the instrument is quiet.
 */

import * as Tone from 'tone';
import { nativeOutputOf } from '../nativeNodes';
import { createBus } from './native';

/** How late the copy is, seconds: long enough to spread the mids, short enough not to be heard as an echo. */
const WIDEN_DELAY = 0.012;
/** Below this the copy is cut, so the low end stays in the middle. */
const WIDEN_LOW_CUT = 260;

/**
 * The gain for both paths so a widened sound is as loud as before: each side adds the copy's power
 * (amount squared) to the sound's, which this takes back off.
 */
export const widenTrim = (amount: number): number => 1 / Math.sqrt(1 + amount * amount);

export interface Widener {
  input: AudioNode;
  output: AudioNode;
  disconnect: () => void;
}

/**
 * Widen whatever reaches `input` by `amount` (the side's level against the sound: 0.3 is gentle,
 * 0.5 wide) into `output`. A stereo sound stays stereo: the copy is made from both sides together.
 */
export function createWidener(raw: BaseAudioContext, amount: number, output: AudioNode): Widener {
  const trim = widenTrim(amount);
  const input = raw.createGain();
  input.gain.value = trim;
  // The copy, from both sides folded together
  const mono = raw.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  const delay = raw.createDelay(0.05);
  delay.delayTime.value = WIDEN_DELAY;
  const lowCut = raw.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = WIDEN_LOW_CUT;
  lowCut.Q.value = 0.5;
  const left = raw.createGain();
  left.gain.value = amount;
  const right = raw.createGain();
  right.gain.value = -amount;
  const merger = raw.createChannelMerger(2);
  input.connect(output);
  input.connect(mono);
  mono.connect(delay);
  delay.connect(lowCut);
  lowCut.connect(left);
  lowCut.connect(right);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  merger.connect(output);
  const nodes = [input, mono, delay, lowCut, left, right, merger];
  return { input, output, disconnect: () => nodes.forEach((n) => n.disconnect()) };
}

/**
 * A widener playing into a Tone node (an instrument's output): `input` is a Tone node the
 * instrument's own Tone nodes play into, made in the current context (live, or an export's). The
 * widener itself is plain nodes on the browser's context (see nativeNodes.ts).
 */
export function createWideOutput(output: Tone.InputNode, amount: number): { input: Tone.Gain; dispose: () => void } {
  const { bus, raw, input } = createBus(output);
  const widener = createWidener(raw, amount, input);
  const entry = new Tone.Gain(1);
  const into = nativeOutputOf(entry);
  into.connect(widener.input);
  return {
    input: entry,
    dispose: () => {
      into.disconnect();
      entry.dispose();
      widener.disconnect();
      bus.dispose();
    },
  };
}

/** Below this a stereo instrument's own spread (the Supersaw's saws) is folded to the middle. */
export const MONO_LOWS_HZ = 180;

/**
 * Keep the lows of a stereo sound in the middle: the side (left minus right) loses what's under
 * `hz` through a 24 dB/octave high-pass, the middle is left as it is. A chord whose low notes
 * fall under 250 Hz stays wide above them, not in the low end (where a wide pad would smear the
 * kick and the bass, and cancel out on a mono speaker).
 */
export function createMonoLows(raw: BaseAudioContext, output: AudioNode, hz = MONO_LOWS_HZ): { input: AudioNode; disconnect: () => void } {
  const input = raw.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const split = raw.createChannelSplitter(2);
  const half = (g: number) => {
    const n = raw.createGain();
    n.gain.value = g;
    n.channelCount = 1;
    n.channelCountMode = 'explicit';
    return n;
  };
  // Middle (L + R) / 2 and side (L − R) / 2
  const midL = half(0.5), midR = half(0.5), sideL = half(0.5), sideR = half(-0.5);
  const mid = half(1), side = half(1), sideNeg = half(-1);
  const hp = [0, 1].map(() => {
    const f = raw.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hz;
    // (Web Audio reads a high-pass's Q in dB: −3 dB is a quality of 1/√2, Butterworth, no bump)
    f.Q.value = -3.0103;
    f.channelCount = 1;
    f.channelCountMode = 'explicit';
    return f;
  });
  const merger = raw.createChannelMerger(2);
  input.connect(split);
  split.connect(midL, 0);
  split.connect(sideL, 0);
  split.connect(midR, 1);
  split.connect(sideR, 1);
  midL.connect(mid);
  midR.connect(mid);
  sideL.connect(side);
  sideR.connect(side);
  side.connect(hp[0]);
  hp[0].connect(hp[1]);
  hp[1].connect(sideNeg);
  // Left = middle + side, right = middle − side
  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  hp[1].connect(merger, 0, 0);
  sideNeg.connect(merger, 0, 1);
  merger.connect(output);
  const nodes: AudioNode[] = [input, split, midL, midR, sideL, sideR, mid, side, sideNeg, ...hp, merger];
  return { input, disconnect: () => nodes.forEach((n) => n.disconnect()) };
}
