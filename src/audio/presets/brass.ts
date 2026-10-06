import * as Tone from 'tone';
import { auditionInput } from '../engine';

/**
 * Funk Brass Stabs (Polyphonic)
 * Punchy 70s/80s horn section stabs with filter swell.
 * Built by a factory so offline (WAV export) rendering can recreate it in its own context.
 */
export function createBrassVoice(output: Tone.InputNode) {
  const filter = new Tone.Filter({
    frequency: 2200,
    type: 'lowpass',
    rolloff: -12,
    Q: 2,
  });

  const synth = new Tone.PolySynth(Tone.Synth, {
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
  synth.maxPolyphony = 6;

  // Route: synth -> filter -> output (brass channel -> masterBus)
  synth.connect(filter);
  filter.connect(output);

  return {
    synth,
    dispose: () => {
      synth.dispose();
      filter.dispose();
    },
    trigger: (notes: string[], duration: Tone.Unit.Time = '8n', time?: Tone.Unit.Time, velocity: number = 0.85) => {
      // Mimic brass swell on filter
      const targetTime = time !== undefined ? time : Tone.now();
      const t = Tone.Time(targetTime).toSeconds();
      filter.frequency.cancelScheduledValues(targetTime);
      filter.frequency.setValueAtTime(800, targetTime);
      filter.frequency.exponentialRampToValueAtTime(2600, t + 0.03);
      filter.frequency.exponentialRampToValueAtTime(1400, t + 0.22);

      synth.triggerAttackRelease(notes, duration, time, velocity);
    },
  };
}

const liveBrass = createBrassVoice(auditionInput);
export const brassSynth = liveBrass.synth;

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
  liveBrass.trigger(notes, duration, time, velocity);
}
