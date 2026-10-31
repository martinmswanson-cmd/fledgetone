import * as Tone from 'tone';
import { notLate } from './monotonic';
import { createBus, createFilter, createNoise, createOsc, createVoiceSet } from './native';
import { noiseKey } from '../seededNoise';

/**
 * The drum rows past the original five (clap, three toms, crash, ride), synthesized from plain
 * Web Audio nodes so every kit has them: the synthesized kits use all of them, the recorded kits
 * the ones their library has no recording of.
 */
export type TomPitch = 'low' | 'mid' | 'high';

const TOM_HZ: Record<TomPitch, number> = { low: 90, mid: 125, high: 170 };

/**
 * How much the clap is raised, in dB: it was some 15 to 20 dB under the kits' kicks as heard, where
 * a clap on the backbeat of dance music sits a few dB under the kick. A recorded kit whose level is
 * raised in the catalog (InstrumentDef.gain) raises its extras with it, so it takes that much less
 * (see createKitExtras).
 */
export const CLAP_DB = 14;

/**
 * `seed`: the track's (see trackSeed), which with the row and the time picks each hit's noise.
 * `clapDb`: how much the clap is raised (CLAP_DB, less a recorded kit's own raise).
 */
export function createKitExtras(output: Tone.InputNode, seed = 0, clapDb = CLAP_DB) {
  const clapGain = 10 ** (Math.max(0, clapDb) / 20);
  const { bus, raw, input } = createBus(output);
  // Noise-fed voices linger before disconnecting (see createVoiceSet)
  const voices = createVoiceSet(raw, 0.5);
  const add = (start: number, seconds: number, sources: AudioScheduledSourceNode[], nodes: AudioNode[], amp: GainNode) =>
    voices.add({ start, stopAt: start + seconds, sources, nodes, amp });

  /** A noise burst through a filter, with an exponential tail (`what`: which, for its noise). */
  const noiseHit = (what: string, t: number, type: BiquadFilterType, hz: number, q: number, level: number, tail: number, seconds: number) => {
    const noise = createNoise(raw, t, noiseKey(seed, what));
    const filter = createFilter(raw, type, hz, q);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(level, t);
    amp.gain.setTargetAtTime(0, t + 0.002, tail);
    noise.connect(filter);
    filter.connect(amp);
    amp.connect(input);
    add(t, seconds, [noise], [noise, filter, amp], amp);
  };

  return {
    // (`ratio`: a hair of detune, so repeated hits aren't identical; see playDrums)
    clap: (time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      // Three quick slaps, then the room; clapGain puts it a few dB under the kit's kick, as heard
      for (const [i, offset] of [0, 0.011, 0.023].entries()) noiseHit(`clap${i}`, t + offset, 'bandpass', 1300 * ratio, 1.2, clapGain * (0.55 - i * 0.08) * velocity, 0.006, 0.05);
      noiseHit('clapRoom', t + 0.03, 'bandpass', 1100 * ratio, 0.9, clapGain * 0.38 * velocity, 0.07, 0.45);
    },
    tom: (pitch: TomPitch, time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      const hz = TOM_HZ[pitch] * ratio;
      const osc = createOsc(raw, 'sine', hz * 1.6, t);
      osc.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
      const amp = raw.createGain();
      amp.gain.setValueAtTime(0.8 * velocity, t);
      amp.gain.setTargetAtTime(0, t + 0.01, 0.12);
      osc.connect(amp);
      amp.connect(input);
      add(t, 0.8, [osc], [osc, amp], amp);
      noiseHit(`tom-${pitch}`, t, 'bandpass', hz * 8, 0.8, 0.12 * velocity, 0.015, 0.1);
    },
    crash: (time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      noiseHit('crash', t, 'highpass', 4500 * ratio, 0.5, 0.32 * velocity, 0.55, 2.8);
      noiseHit('crash2', t, 'bandpass', 7500 * ratio, 2, 0.18 * velocity, 0.25, 1.4);
    },
    ride: (time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      // A bell ping over a soft wash
      const bell = createOsc(raw, 'triangle', 3150 * ratio, t);
      const bell2 = createOsc(raw, 'square', 4780 * ratio, t);
      const amp = raw.createGain();
      amp.gain.setValueAtTime(0.05 * velocity, t);
      amp.gain.setTargetAtTime(0, t + 0.004, 0.12);
      const hp = createFilter(raw, 'highpass', 2500, 0.7);
      bell.connect(hp);
      bell2.connect(hp);
      hp.connect(amp);
      amp.connect(input);
      add(t, 0.8, [bell, bell2], [bell, bell2, hp, amp], amp);
      noiseHit('ride', t, 'highpass', 6000, 0.6, 0.12 * velocity, 0.35, 1.8);
    },
    cowbell: (time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      const a = createOsc(raw, 'square', 800 * ratio, t);
      const b = createOsc(raw, 'square', 540 * ratio, t);
      const bp = createFilter(raw, 'bandpass', 900, 2);
      const amp = raw.createGain();
      amp.gain.setValueAtTime(0.22 * velocity, t);
      amp.gain.setTargetAtTime(0, t + 0.01, 0.07);
      a.connect(bp);
      b.connect(bp);
      bp.connect(amp);
      amp.connect(input);
      add(t, 0.5, [a, b], [a, b, bp, amp], amp);
    },
    /** Stop: the hits still to come never sound (the ones ringing ring out) */
    releaseAll: () => voices.callOffComing(raw.currentTime),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
export type KitExtras = ReturnType<typeof createKitExtras>;
