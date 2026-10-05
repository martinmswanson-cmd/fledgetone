import * as Tone from 'tone';
import { masterBus } from '../engine';

/**
 * Groove Drum Kit (Synthesized Analog Drums)
 * 1. Kick: Punchy 909-style sub-transient membrane
 * 2. Snare / Clap: Layered white noise with 800Hz highpass filter + 200Hz pitched snap
 * 3. Hi-Hat: Metallic FM percussion with closed (0.05s) and open (0.28s) decay
 * 4. Funk Cowbell: High-pitched punchy square wave at 800Hz
 */

// 1. Kick
export const kickSynth = new Tone.MembraneSynth({
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
});
kickSynth.connect(masterBus);

// 2. Snare / Clap
export const snareNoise = new Tone.NoiseSynth({
  noise: { type: 'white' },
  envelope: {
    attack: 0.001,
    decay: 0.12,
    sustain: 0,
  },
  volume: -3,
});

export const snareFilter = new Tone.Filter({
  frequency: 800,
  type: 'highpass',
  rolloff: -12,
});

snareNoise.connect(snareFilter);
snareFilter.connect(masterBus);

export const snareSnap = new Tone.MembraneSynth({
  pitchDecay: 0.015,
  octaves: 2,
  oscillator: { type: 'triangle' },
  envelope: {
    attack: 0.001,
    decay: 0.09,
    sustain: 0,
  },
  volume: -5,
});
snareSnap.connect(masterBus);

// 3. Hi-Hat (Closed & Open)
export const hatSynth = new Tone.MetalSynth({
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  envelope: {
    attack: 0.001,
    decay: 0.05,
    release: 0.05,
  },
  volume: -8,
});
hatSynth.frequency.value = 200;
hatSynth.connect(masterBus);

// 4. Funk Cowbell / Perc
export const cowbellSynth = new Tone.Synth({
  oscillator: { type: 'square' },
  envelope: {
    attack: 0.001,
    decay: 0.08,
    sustain: 0.01,
    release: 0.08,
  },
  volume: -6,
});
cowbellSynth.connect(masterBus);

/**
 * Trigger Kick Drum
 */
export function triggerKick(time?: Tone.Unit.Time, velocity: number = 0.95): void {
  if (time !== undefined) {
    kickSynth.triggerAttackRelease('C1', '8n', time, velocity);
  } else {
    kickSynth.triggerAttackRelease('C1', '8n', undefined, velocity);
  }
}

/**
 * Trigger Snare / Clap
 */
export function triggerSnare(time?: Tone.Unit.Time, velocity: number = 0.85): void {
  if (time !== undefined) {
    snareNoise.triggerAttackRelease('16n', time, velocity);
    snareSnap.triggerAttackRelease('G2', '16n', time, velocity * 0.9);
  } else {
    snareNoise.triggerAttackRelease('16n', undefined, velocity);
    snareSnap.triggerAttackRelease('G2', '16n', undefined, velocity * 0.9);
  }
}

/**
 * Trigger Hi-Hat
 * @param open If true, triggers longer 0.28s open hat decay; otherwise 0.05s tight closed hat
 */
export function triggerHat(open: boolean = false, time?: Tone.Unit.Time, velocity: number = 0.75): void {
  hatSynth.envelope.decay = open ? 0.28 : 0.05;
  hatSynth.envelope.release = open ? 0.28 : 0.05;
  if (time !== undefined) {
    hatSynth.triggerAttackRelease(200, open ? '8n' : '32n', time, velocity);
  } else {
    hatSynth.triggerAttackRelease(200, open ? '8n' : '32n', undefined, velocity);
  }
}

/**
 * Trigger Funk Cowbell
 */
export function triggerCowbell(time?: Tone.Unit.Time, velocity: number = 0.8): void {
  if (time !== undefined) {
    cowbellSynth.triggerAttackRelease('G#5', '16n', time, velocity);
  } else {
    cowbellSynth.triggerAttackRelease('G#5', '16n', undefined, velocity);
  }
}
