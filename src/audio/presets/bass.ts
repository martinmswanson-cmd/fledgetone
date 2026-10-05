import * as Tone from 'tone';
import { masterBus } from '../engine';

/**
 * Funk Slap Bass (Monophonic)
 * Tight slap/squelch bass with fast transient attack and resonant filter sweep.
 */
export const bassDistortion = new Tone.Distortion(0.06);

export const bassSynth = new Tone.MonoSynth({
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

// Route: bassSynth -> bassDistortion -> masterBus
bassSynth.chain(bassDistortion, masterBus);

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
  if (time !== undefined) {
    bassSynth.triggerAttackRelease(note, duration, time, velocity);
  } else {
    bassSynth.triggerAttackRelease(note, duration, undefined, velocity);
  }
}
