import * as Tone from 'tone';
import { notLate } from './monotonic';
import { createBus, createFilter, createNoise, createOsc, createVoiceSet } from './native';

/**
 * The drum rows past the original five (clap, three toms, crash, ride), synthesized from plain
 * Web Audio nodes so every kit has them: the synthesized kits use all of them, the recorded kits
 * the ones their library has no recording of.
 */
export type TomPitch = 'low' | 'mid' | 'high';

const TOM_HZ: Record<TomPitch, number> = { low: 90, mid: 125, high: 170 };

export function createKitExtras(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  // Noise-fed voices linger before disconnecting (see createVoiceSet)
  const voices = createVoiceSet(raw, 0.5);
  const add = (start: number, seconds: number, sources: AudioScheduledSourceNode[], nodes: AudioNode[], amp: GainNode) =>
    voices.add({ start, stopAt: start + seconds, sources, nodes, amp });

  /** A noise burst through a filter, with an exponential tail. */
  const noiseHit = (t: number, type: BiquadFilterType, hz: number, q: number, level: number, tail: number, seconds: number) => {
    const noise = createNoise(raw, t);
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
      // Three quick slaps, then the room
      for (const [i, offset] of [0, 0.011, 0.023].entries()) noiseHit(t + offset, 'bandpass', 1300 * ratio, 1.2, (0.55 - i * 0.08) * velocity, 0.006, 0.05);
      noiseHit(t + 0.03, 'bandpass', 1100 * ratio, 0.9, 0.38 * velocity, 0.07, 0.45);
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
      noiseHit(t, 'bandpass', hz * 8, 0.8, 0.12 * velocity, 0.015, 0.1);
    },
    crash: (time: number, velocity: number, ratio = 1) => {
      const t = notLate(bus.context, time);
      noiseHit(t, 'highpass', 4500 * ratio, 0.5, 0.32 * velocity, 0.55, 2.8);
      noiseHit(t, 'bandpass', 7500 * ratio, 2, 0.18 * velocity, 0.25, 1.4);
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
      noiseHit(t, 'highpass', 6000, 0.6, 0.12 * velocity, 0.35, 1.8);
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
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
export type KitExtras = ReturnType<typeof createKitExtras>;
