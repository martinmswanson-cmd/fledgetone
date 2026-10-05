import * as Tone from 'tone';
import { masterBus } from '../engine';

/**
 * Funk Brass Stabs (Polyphonic)
 * Punchy 70s/80s horn section stabs with filter swell.
 */
export const brassFilter = new Tone.Filter({
  frequency: 2200,
  type: 'lowpass',
  rolloff: -12,
  Q: 2,
});

export const brassSynth = new Tone.PolySynth(Tone.Synth, {
  volume: -3,
  oscillator: {
    type: 'sawtooth',
  },
  envelope: {
    attack: 0.015,
    decay: 0.25,
    sustain: 0.15,
    release: 0.2,
  },
});
brassSynth.maxPolyphony = 6;

// Route: brassSynth -> brassFilter -> masterBus
brassSynth.connect(brassFilter);
brassFilter.connect(masterBus);

/**
 * Trigger funk brass section stab
 * @param notes Array of notes (e.g. ["D4", "F4", "A4"])
 * @param duration Note duration (e.g. "8n", "16n")
 * @param time Transport or audio context trigger time
 * @param velocity Velocity (0 to 1)
 */
export function triggerBrass(
  notes: string[],
  duration: Tone.Unit.Time = '8n',
  time?: Tone.Unit.Time,
  velocity: number = 0.85
): void {
  // Mimic brass swell on filter
  const targetTime = time !== undefined ? time : Tone.now();
  brassFilter.frequency.cancelScheduledValues(targetTime);
  brassFilter.frequency.setValueAtTime(800, targetTime);
  brassFilter.frequency.exponentialRampToValueAtTime(2600, Tone.Time(targetTime).toSeconds() + 0.03);
  brassFilter.frequency.exponentialRampToValueAtTime(1400, Tone.Time(targetTime).toSeconds() + 0.22);

  if (time !== undefined) {
    brassSynth.triggerAttackRelease(notes, duration, time, velocity);
  } else {
    brassSynth.triggerAttackRelease(notes, duration, undefined, velocity);
  }
}
