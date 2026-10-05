import * as Tone from 'tone';
import { trackChannels } from '../engine';

/**
 * Space Clav / Electric Keys (Polyphonic)
 * Lush vintage FM keys / funk clavinet with stereo chorus and silky room reverb.
 * Built by a factory so offline (WAV export) rendering can recreate it in its own context.
 * `ready` resolves once the reverb impulse response has been generated.
 */
export function createKeysVoice(output: Tone.InputNode) {
  const chorus = new Tone.Chorus({
    depth: 0.6,
    delayTime: 3.5,
    frequency: 1.2,
    wet: 0.45,
  }).start();

  const reverb = new Tone.Reverb({
    decay: 1.8,
    wet: 0.25,
  });

  const synth = new Tone.PolySynth(Tone.FMSynth, {
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
  });
  // 5-note chords repeated while earlier ones are still releasing need headroom
  synth.maxPolyphony = 16;

  // Route: synth -> chorus -> reverb -> output (keys channel -> masterBus)
  synth.chain(chorus, reverb, output);

  return {
    synth,
    ready: reverb.ready,
    trigger: (notes: string[], duration: Tone.Unit.Time = '8n', time?: Tone.Unit.Time, velocity: number = 0.8) => {
      synth.triggerAttackRelease(notes, duration, time, velocity);
    },
  };
}

const liveKeys = createKeysVoice(trackChannels.keys);
export const keysSynth = liveKeys.synth;

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
  liveKeys.trigger(notes, duration, time, velocity);
}
