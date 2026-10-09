import * as Tone from 'tone';
import { createLightChorus } from '../effects/lightFx';
import { auditionInput } from '../engine';
import { createVoicePool } from './poly';

/**
 * Space Clav / Electric Keys (Polyphonic)
 * Lush vintage FM keys / funk clavinet with stereo chorus and silky room reverb.
 * Built by a factory so offline (WAV export) rendering can recreate it in its own context.
 * `ready` resolves once the reverb impulse response has been generated.
 */
export function createKeysVoice(output: Tone.InputNode) {
  // Tone.Chorus's sound (spread 180, no feedback) without its idle CPU cost
  const chorus = createLightChorus({ rate: 1.2, delayMs: 3.5, depth: 0.6, spread: 180, wet: 0.45 });

  const reverb = new Tone.Reverb({
    decay: 1.8,
    wet: 0.25,
  });

  // Route: voices -> chorus -> reverb -> output (keys channel -> masterBus)
  chorus.output.chain(reverb, output);

  // 5-note chords repeated while earlier ones are still releasing need headroom
  const synth = createVoicePool(
    (context) =>
      new Tone.FMSynth({
        context,
        volume: -4,
        harmonicity: 1.5,
        modulationIndex: 1.8,
        modulation: {
          type: 'triangle',
        },
        oscillator: {
          type: 'triangle',
        },
        envelope: {
          attack: 0.005,
          decay: 0.35,
          sustain: 0.25,
          release: 0.4,
        },
        modulationEnvelope: {
          attack: 0.005,
          decay: 0.25,
          sustain: 0.15,
          release: 0.25,
        },
      }),
    16,
    chorus.input
  );

  return {
    ready: reverb.ready,
    attack: synth.attack,
    bend: synth.bend,
    releaseAll: synth.releaseAll,
    dispose: () => {
      synth.dispose();
      chorus.dispose();
      reverb.dispose();
    },
    trigger: (notes: string[], duration: Tone.Unit.Time = '8n', time?: Tone.Unit.Time, velocity: number = 0.8) => {
      synth.trigger(notes, duration, time, velocity);
    },
  };
}

/** The sound deck's keys, built on first use: even a silent synth costs CPU. */
let liveKeys: ReturnType<typeof createKeysVoice> | undefined;
const deckKeys = () => (liveKeys ??= createKeysVoice(auditionInput));

/**
 * Trigger polyphonic clavinet / electric keys chord
 * @param notes Array of notes (e.g. ["D3", "F3", "A3", "C4", "E4"])
 * @param duration Note duration (e.g. "8n", "16n")
 * @param time Transport or audio context trigger time
 * @param velocity Velocity (0 to 1)
 */
export function triggerKeys(
  notes: string[],
  duration: Tone.Unit.Time = '8n',
  time?: Tone.Unit.Time,
  velocity: number = 0.8
): void {
  deckKeys().trigger(notes, duration, time, velocity);
}
