import * as Tone from 'tone';
import { auditionInput } from '../engine';
import { monotonicTime } from './monotonic';
import { noiseKey } from '../seededNoise';
import { seedToneNoise } from '../toneFixes';
import { createComingHits } from './toneStop';
import { attackAhead, strikeTogether } from './toneStart';

/**
 * Groove Drum Kit (Synthesized Analog Drums)
 * 1. Kick: Punchy 909-style sub-transient membrane
 * 2. Snare / Clap: Layered white noise with 800Hz highpass filter + 200Hz pitched snap
 * 3. Hi-Hat: Metallic FM percussion with closed (0.05s) and open (0.28s) decay
 * 4. Funk Cowbell: High-pitched punchy square wave at 800Hz
 *
 * createDrumKit builds the kit in whatever Tone context is current, so the same sound
 * design serves live playback and offline (WAV export) rendering. `seed` is the track's (see
 * trackSeed), which with the time picks each snare's noise.
 */
export function createDrumKit(output: Tone.InputNode, seed = 0) {
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
  const snareFilter = new Tone.BiquadFilter({
    frequency: 800,
    type: 'highpass',
  });
  snareNoise.connect(snareFilter);
  snareFilter.connect(output);
  seedToneNoise(snareNoise.noise, noiseKey(seed, 'snare'));

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
  // The hits handed out for later, which Stop calls off
  const coming = createComingHits(() => kick.context.currentTime);

  return {
    dispose: () => {
      [kick, snareNoise, snareFilter, snareSnap, hat, cowbell].forEach((n) => n.dispose());
    },
    // (`ratio`: a hair of detune, so repeated hits aren't identical; see playDrums)
    kick: (time?: Tone.Unit.Time, velocity: number = 0.95, ratio = 1) => {
      // (Its pitch, and its drop, start on time wherever the hit lands: see toneStart.ts)
      const at = attackAhead(kick, 32.703 * ratio, kickTime(time), (t) => kick.triggerAttackRelease(32.703 * ratio, '8n', t, velocity));
      kickTime.struck(at);
      coming.add(kick, at);
    },
    snare: (time?: Tone.Unit.Time, velocity: number = 0.85, ratio = 1) => {
      // (Its noise and its snap struck as one: see soundLead.ts strikeWhole)
      const [noiseAt, snapAt] = strikeTogether(snareNoise.context, snareTime(time), [[snareSnap, 200 * ratio]], (t, play) => {
        snareNoise.triggerAttackRelease('16n', t, velocity);
        return [t, play(0, (at) => snareSnap.triggerAttackRelease(200 * ratio, '16n', at, velocity * 0.9))];
      });
      snareTime.struck(snapAt);
      coming.add(snareNoise, noiseAt);
      coming.add(snareSnap, snapAt);
    },
    /** open: longer 0.28s decay; otherwise 0.05s tight closed hat */
    hat: (open: boolean = false, time?: Tone.Unit.Time, velocity: number = 0.75, ratio = 1) => {
      hat.envelope.decay = open ? 0.28 : 0.05;
      hat.envelope.release = open ? 0.28 : 0.05;
      const at = attackAhead(hat, 200 * ratio, hatTime(time), (t) => hat.triggerAttackRelease(200 * ratio, open ? '8n' : '32n', t, velocity));
      hatTime.struck(at);
      coming.add(hat, at);
    },
    cowbell: (time?: Tone.Unit.Time, velocity: number = 0.8, ratio = 1) => {
      const at = attackAhead(cowbell, 800 * ratio, cowbellTime(time), (t) => cowbell.triggerAttackRelease(800 * ratio, '16n', t, velocity));
      cowbellTime.struck(at);
      coming.add(cowbell, at);
    },
    /** Stop: the hits still to come never sound (the ones ringing ring out; on Pause, see createComingHits, not those not heard yet) */
    releaseAll: (heard?: number) => coming.callOff(kick.context.currentTime, heard),
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
