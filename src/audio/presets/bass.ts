import * as Tone from 'tone';
import { auditionInput } from '../engine';
import { monotonicTime } from './monotonic';
import type { GlideRef } from '../instruments';
import { legatoGlide } from './synths';

/**
 * Funk Slap Bass (Monophonic)
 * Tight slap/squelch bass with fast transient attack and resonant filter sweep.
 * Built by a factory so offline (WAV export) rendering can recreate it in its own context.
 */
export function createBassVoice(output: Tone.InputNode, glide?: GlideRef) {
  const distortion = new Tone.Distortion(0.06);

  const synth = new Tone.MonoSynth({
    volume: -2,
    oscillator: {
      type: 'sawtooth',
    },
    filter: {
      type: 'lowpass',
      rolloff: -24,
      Q: 5,
    },
    filterEnvelope: {
      baseFrequency: 70,
      octaves: 4.5,
      attack: 0.002,
      decay: 0.16,
      sustain: 0.08,
      release: 0.1,
    },
    envelope: {
      attack: 0.002,
      decay: 0.22,
      sustain: 0.2,
      release: 0.15,
    },
  });

  // Route: synth -> distortion -> output (bass channel -> masterBus)
  synth.chain(distortion, output);

  // Monophonic: overlapping bass clips could land two notes on one instant
  const safeTime = monotonicTime(synth.context);
  const glideFor = legatoGlide(synth, glide);

  return {
    synth,
    dispose: () => {
      synth.dispose();
      distortion.dispose();
    },
    trigger: (note: string, duration: Tone.Unit.Time = '16n', time?: Tone.Unit.Time, velocity: number = 0.9) => {
      const start = safeTime(time);
      glideFor(start, start + synth.toSeconds(duration));
      synth.triggerAttackRelease(note, duration, start, velocity);
    },
    // A key held on a MIDI keyboard: sounds until released
    attack: (note: string, time: number, velocity: number) => synth.triggerAttack(note, safeTime(time), velocity),
    release: (time: number) => synth.triggerRelease(time),
    bend: (cents: number, time: number) => synth.detune.setTargetAtTime(cents, time, 0.005),
  };
}

/** The sound deck's bass, built on first use: even a silent synth costs CPU. */
let liveBass: ReturnType<typeof createBassVoice> | undefined;
const deckBass = () => (liveBass ??= createBassVoice(auditionInput));

/**
 * Trigger a funk bass note
 * @param note Note name (e.g. "D1", "F1", "G1", "A1")
 * @param duration Note duration (e.g. "16n", "8n")
 * @param time Transport or audio context trigger time
 * @param velocity Velocity (0 to 1)
 */
export function triggerBass(
  note: string,
  duration: Tone.Unit.Time = '16n',
  time?: Tone.Unit.Time,
  velocity: number = 0.9
): void {
  deckBass().trigger(note, duration, time, velocity);
}
