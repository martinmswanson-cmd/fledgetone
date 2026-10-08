import * as Tone from 'tone';
import { auditionInput } from '../engine';
import { monotonicTime } from './monotonic';

/**
 * Fold the noise going through `filter` to mono (the average of its two sides). Tone's noise is
 * stereo, a separate random stream per side, but the kits were voiced hearing it folded to mono
 * (the track strip used to fold everything), so their snares and hats stay as they were.
 */
export function monoFilter<T extends Tone.ToneAudioNode>(filter: T): T {
  filter.channelCount = 1;
  filter.channelCountMode = 'explicit';
  return filter;
}

/**
 * Groove Drum Kit (Synthesized Analog Drums)
 * 1. Kick: Punchy 909-style sub-transient membrane
 * 2. Snare / Clap: Layered white noise with 800Hz highpass filter + 200Hz pitched snap
 * 3. Hi-Hat: Metallic FM percussion with closed (0.05s) and open (0.28s) decay
 * 4. Funk Cowbell: High-pitched punchy square wave at 800Hz
 *
 * createDrumKit builds the kit in whatever Tone context is current, so the same sound
 * design serves live playback and offline (WAV export) rendering.
 */
export function createDrumKit(output: Tone.InputNode) {
  // 1. Kick
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 6,
    oscillator: { type: 'sine' },
    envelope: {
      attack: 0.001,
      decay: 0.35,
      sustain: 0.01,
      release: 0.35,
    },
    volume: 0,
  }).connect(output);

  // 2. Snare / Clap
  const snareNoise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: {
      attack: 0.001,
      decay: 0.12,
      sustain: 0,
    },
    volume: -3,
  });
  const snareFilter = monoFilter(
    new Tone.BiquadFilter({
      frequency: 800,
      type: 'highpass',
    })
  );
  snareNoise.connect(snareFilter);
  snareFilter.connect(output);

  const snareSnap = new Tone.MembraneSynth({
    pitchDecay: 0.015,
    octaves: 2,
    oscillator: { type: 'triangle' },
    envelope: {
      attack: 0.001,
      decay: 0.09,
      sustain: 0,
    },
    volume: -5,
  }).connect(output);

  // 3. Hi-Hat (Closed & Open)
  const hat = new Tone.MetalSynth({
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    envelope: {
      attack: 0.001,
      decay: 0.05,
      release: 0.05,
    },
    volume: -8,
  }).connect(output);
  hat.frequency.value = 200;

  // 4. Funk Cowbell / Perc
  const cowbell = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: {
      attack: 0.001,
      decay: 0.08,
      sustain: 0.01,
      release: 0.08,
    },
    volume: -6,
  }).connect(output);

  // Every drum voice is monophonic: keep each one's trigger times strictly increasing
  const kickTime = monotonicTime(kick.context);
  const snareTime = monotonicTime(snareNoise.context);
  const hatTime = monotonicTime(hat.context);
  const cowbellTime = monotonicTime(cowbell.context);

  return {
    dispose: () => {
      [kick, snareNoise, snareFilter, snareSnap, hat, cowbell].forEach((n) => n.dispose());
    },
    kick: (time?: Tone.Unit.Time, velocity: number = 0.95) => {
      kick.triggerAttackRelease('C1', '8n', kickTime(time), velocity);
    },
    snare: (time?: Tone.Unit.Time, velocity: number = 0.85) => {
      const t = snareTime(time);
      snareNoise.triggerAttackRelease('16n', t, velocity);
      snareSnap.triggerAttackRelease(200, '16n', t, velocity * 0.9);
    },
    /** open: longer 0.28s decay; otherwise 0.05s tight closed hat */
    hat: (open: boolean = false, time?: Tone.Unit.Time, velocity: number = 0.75) => {
      hat.envelope.decay = open ? 0.28 : 0.05;
      hat.envelope.release = open ? 0.28 : 0.05;
      hat.triggerAttackRelease(200, open ? '8n' : '32n', hatTime(time), velocity);
    },
    cowbell: (time?: Tone.Unit.Time, velocity: number = 0.8) => {
      cowbell.triggerAttackRelease(800, '16n', cowbellTime(time), velocity);
    },
  };
}

export type DrumKit = ReturnType<typeof createDrumKit>;

/** The sound deck's kit, built on first use: even a silent kit costs CPU. */
let liveKit: DrumKit | undefined;
const deckKit = () => (liveKit ??= createDrumKit(auditionInput));

/** Trigger Kick Drum */
export function triggerKick(time?: Tone.Unit.Time, velocity: number = 0.95): void {
  deckKit().kick(time, velocity);
}

/** Trigger Snare / Clap */
export function triggerSnare(time?: Tone.Unit.Time, velocity: number = 0.85): void {
  deckKit().snare(time, velocity);
}

/**
 * Trigger Hi-Hat
 * @param open If true, triggers longer 0.28s open hat decay; otherwise 0.05s tight closed hat
 */
export function triggerHat(open: boolean = false, time?: Tone.Unit.Time, velocity: number = 0.75): void {
  deckKit().hat(open, time, velocity);
}

/** Trigger Funk Cowbell */
export function triggerCowbell(time?: Tone.Unit.Time, velocity: number = 0.8): void {
  deckKit().cowbell(time, velocity);
}
