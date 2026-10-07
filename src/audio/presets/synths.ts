import * as Tone from 'tone';
import { monotonicTime } from './monotonic';
import { createVoicePool } from './poly';

/**
 * Phase 3 synthesized instruments. Like the other presets, each factory builds its nodes in
 * the current Tone context (live or the export render) and connects them to `output`.
 */

/**
 * Wavetable-style pad: a custom harmonic waveform swept by a slow auto-filter, so the tone
 * keeps moving like a scanned wavetable.
 */
export function createWavetable(output: Tone.InputNode) {
  const sweep = new Tone.AutoFilter({ frequency: 0.18, baseFrequency: 280, octaves: 4.5, depth: 0.85, wet: 1 }).start();
  sweep.filter.Q.value = 3;
  const synth = createVoicePool(
    (context) =>
      new Tone.Synth({
        context,
        volume: -9,
        oscillator: { type: 'custom', partials: [1, 0.62, 0.45, 0.3, 0.42, 0.2, 0.28, 0.12, 0.18, 0.08] },
        envelope: { attack: 0.05, decay: 0.4, sustain: 0.7, release: 1.2 },
      }),
    12,
    sweep
  );
  sweep.connect(output);
  return {
    trigger: (notes: string[], duration: Tone.Unit.Time, time: number, velocity: number) => synth.trigger(notes, duration, time, velocity),
    releaseAll: synth.releaseAll,
    dispose: () => {
      synth.dispose();
      sweep.dispose();
    },
  };
}

/** Clean, deep sine sub-bass (monophonic). */
export function createSubBass(output: Tone.InputNode) {
  const synth = new Tone.MonoSynth({
    volume: 0,
    oscillator: { type: 'sine' },
    filter: { type: 'lowpass', frequency: 220, rolloff: -24, Q: 0.5 },
    filterEnvelope: { baseFrequency: 180, octaves: 0.5, attack: 0.01, decay: 0.2, sustain: 1, release: 0.3 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.85, release: 0.25 },
  }).connect(output);
  const safeTime = monotonicTime(synth.context);
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) =>
      synth.triggerAttackRelease(note, duration, safeTime(time), velocity),
    releaseAll: () => synth.triggerRelease(),
    dispose: () => synth.dispose(),
  };
}

/** 808 bass: a long sine boom with a quick downward pitch drop, lightly saturated. */
export function create808(output: Tone.InputNode) {
  const drive = new Tone.Distortion({ distortion: 0.22, oversample: '2x', wet: 0.6 });
  const synth = new Tone.MembraneSynth({
    volume: -2,
    pitchDecay: 0.06,
    octaves: 1.6,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 1.4, sustain: 0.35, release: 0.9 },
  });
  synth.chain(drive, output);
  const safeTime = monotonicTime(synth.context);
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) =>
      synth.triggerAttackRelease(note, duration, safeTime(time), velocity),
    releaseAll: () => synth.triggerRelease(),
    dispose: () => {
      synth.dispose();
      drive.dispose();
    },
  };
}

/** Analog-style lead: detuned saws, filter envelope and a short glide between notes. */
export function createLead(output: Tone.InputNode) {
  const synth = new Tone.MonoSynth({
    volume: -8,
    portamento: 0.035,
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 } as Partial<Tone.OmniOscillatorOptions>,
    filter: { type: 'lowpass', rolloff: -24, Q: 3 },
    filterEnvelope: { baseFrequency: 400, octaves: 3.5, attack: 0.01, decay: 0.25, sustain: 0.45, release: 0.3 },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.25 },
  }).connect(output);
  const safeTime = monotonicTime(synth.context);
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) =>
      synth.triggerAttackRelease(note, duration, safeTime(time), velocity),
    releaseAll: () => synth.triggerRelease(),
    dispose: () => synth.dispose(),
  };
}

/**
 * Drum machine in the 808 style: long boomy kick, snappy noise snare, crisp hats and the
 * classic two-tone cowbell. Same hits (and note map) as the analog Drums kit.
 */
export function createDrumMachine(output: Tone.InputNode) {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.09,
    octaves: 5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.75, sustain: 0, release: 0.4 },
    volume: 1,
  }).connect(output);

  const snareTone = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }, volume: -8 }).connect(output);
  const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: 2500, Q: 0.8 }).connect(output);
  const snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -2 }).connect(snareFilter);

  const hatFilter = new Tone.Filter({ type: 'highpass', frequency: 7000 }).connect(output);
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 }, volume: -10 }).connect(hatFilter);

  // 808 cowbell: two square waves (540 + 800 Hz) through a bandpass
  const bellFilter = new Tone.Filter({ type: 'bandpass', frequency: 700, Q: 2 }).connect(output);
  const bellEnv = { attack: 0.001, decay: 0.12, sustain: 0.05, release: 0.15 };
  const bellLow = new Tone.Synth({ oscillator: { type: 'square' }, envelope: bellEnv, volume: -12 }).connect(bellFilter);
  const bellHigh = new Tone.Synth({ oscillator: { type: 'square' }, envelope: bellEnv, volume: -12 }).connect(bellFilter);

  const kickTime = monotonicTime(kick.context);
  const snareTime = monotonicTime(snareNoise.context);
  const hatTime = monotonicTime(hat.context);
  const bellTime = monotonicTime(bellLow.context);

  return {
    kick: (time: number, velocity: number) => kick.triggerAttackRelease('A0', '8n', kickTime(time), velocity),
    snare: (time: number, velocity: number) => {
      const t = snareTime(time);
      snareNoise.triggerAttackRelease('16n', t, velocity);
      snareTone.triggerAttackRelease(185, '32n', t, velocity * 0.8);
    },
    hat: (open: boolean, time: number, velocity: number) => {
      hat.envelope.decay = open ? 0.32 : 0.04;
      hat.envelope.release = open ? 0.25 : 0.03;
      hat.triggerAttackRelease(open ? '8n' : '32n', hatTime(time), velocity);
    },
    cowbell: (time: number, velocity: number) => {
      const t = bellTime(time);
      bellLow.triggerAttackRelease(540, '16n', t, velocity);
      bellHigh.triggerAttackRelease(800, '16n', t, velocity);
    },
    dispose: () => {
      [kick, snareTone, snareFilter, snareNoise, hatFilter, hat, bellFilter, bellLow, bellHigh].forEach((n) => n.dispose());
    },
  };
}
