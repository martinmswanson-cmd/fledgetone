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
