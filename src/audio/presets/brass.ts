import * as Tone from 'tone';
import { auditionInput } from '../engine';
import { notLate } from './monotonic';
import { createVoicePool } from './poly';

/**
 * Funk Brass Stabs (Polyphonic)
 * Punchy 70s/80s horn section stabs with filter swell.
 * Built by a factory so offline (WAV export) rendering can recreate it in its own context.
 */
export function createBrassVoice(output: Tone.InputNode) {
  const filter = new Tone.BiquadFilter({
    frequency: 2200,
    type: 'lowpass',
    Q: 2,
  });

  const synth = createVoicePool(
    (context) =>
      new Tone.Synth({
        context,
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
      }),
    8,
    filter
  );

  // Route: voices -> filter -> output (brass channel -> masterBus)
  filter.connect(output);

  // Mimic brass swell on filter
  const swell = (t: number) => {
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(2600, t + 0.03);
    filter.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
  };

  return {
    releaseAll: synth.releaseAll,
    dispose: () => {
      synth.dispose();
      filter.dispose();
    },
    trigger: (notes: string[], duration: Tone.Unit.Time = '8n', time?: Tone.Unit.Time, velocity: number = 0.85) => {
      const t = notLate(filter.context, time);
      swell(t);
      synth.trigger(notes, duration, t, velocity);
    },
    // A key held on a MIDI keyboard
    attack: (note: string, time: number, velocity: number) => {
      const t = notLate(filter.context, time);
      swell(t);
      return synth.attack(note, t, velocity);
    },
    bend: synth.bend,
  };
}

/** The sound deck's brass, built on first use: even a silent synth costs CPU. */
let liveBrass: ReturnType<typeof createBrassVoice> | undefined;
const deckBrass = () => (liveBrass ??= createBrassVoice(auditionInput));

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
  deckBrass().trigger(notes, duration, time, velocity);
}
