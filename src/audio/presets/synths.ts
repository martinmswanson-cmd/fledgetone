/**
 * The Tone.js synth instruments: the Wavetable pad, Sub-Bass, the 808 (with slides between
 * overlapping notes, and the modern two-layer version for expressive tracks), the Analog Lead and
 * the Drum Machine kit.
 */
import * as Tone from 'tone';
import { monotonicTime } from './monotonic';
import { joinsNote } from '../legato';
import { createWideOutput } from './widen';
import { createVoicePool } from './poly';
import { noiseKey } from '../seededNoise';
import { seedToneNoise } from '../toneFixes';
import type { GlideRef } from '../instruments';

/**
 * A key held on a MIDI keyboard on a monophonic Tone synth: it sounds from `attack` until
 * `release`, and a pitch bend moves its detune.
 */
interface HeldSynth {
  triggerAttack: (note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
  detune: { setTargetAtTime: (value: number, time: Tone.Unit.Time, constant: number) => unknown };
}

function heldNote(synth: HeldSynth, safeTime: (time?: Tone.Unit.Time) => number) {
  return {
    attack: (note: string, time: number, velocity: number) => synth.triggerAttack(note, safeTime(time), velocity),
    release: (time: number) => synth.triggerRelease(time),
    bend: (cents: number, time: number) => synth.detune.setTargetAtTime(cents, time, 0.005),
  };
}

/** How wide the pads and leads that would play in mono are widened (see widen.ts). */
const PAD_WIDTH = 0.45;
const LEAD_WIDTH = 0.3;

/**
 * Phase 3 synthesized instruments. Like the other presets, each factory builds its nodes in
 * the current Tone context (live or the export render) and connects them to `output`.
 */

/**
 * Wavetable-style pad: a custom harmonic waveform swept by a slow auto-filter, so the tone
 * keeps moving like a scanned wavetable, widened to stereo, with a long release that fades one
 * chord into the next (about 1.5 s to fall 40 dB).
 */
export function createWavetable(output: Tone.InputNode) {
  const wide = createWideOutput(output, PAD_WIDTH);
  const sweep = new Tone.AutoFilter({ frequency: 0.18, baseFrequency: 280, octaves: 4.5, depth: 0.85, wet: 1 }).start();
  sweep.filter.Q.value = 3;
  const synth = createVoicePool(
    (context) =>
      new Tone.Synth({
        context,
        volume: -9,
        oscillator: { type: 'custom', partials: [1, 0.62, 0.45, 0.3, 0.42, 0.2, 0.28, 0.12, 0.18, 0.08] },
        envelope: { attack: 0.05, decay: 0.4, sustain: 0.7, release: 4 },
      }),
    12,
    sweep
  );
  sweep.connect(wide.input);
  return {
    trigger: (notes: string[], duration: Tone.Unit.Time, time: number, velocity: number) => synth.trigger(notes, duration, time, velocity),
    attack: synth.attack,
    bend: synth.bend,
    releaseAll: synth.releaseAll,
    dispose: () => {
      synth.dispose();
      sweep.dispose();
      wide.dispose();
    },
  };
}

/**
 * Legato glide on a Tone monophonic synth (Track.glide): before each note, its portamento is set to
 * the glide when the note joins the last one (starts before it ended, or right where it ended:
 * see joinsNote), and to `own` (the synth's usual portamento) otherwise. With no glide set it keeps
 * `own` throughout, as before. Returns the end of the note it joins, or null when it doesn't.
 */
export function legatoGlide(synth: { portamento: Tone.Unit.Time }, glide: GlideRef | undefined, own = 0) {
  let soundingUntil = -Infinity;
  return (start: number, end: number): number | null => {
    const joined = joinsNote(start, soundingUntil) ? soundingUntil : null;
    soundingUntil = end;
    const seconds = glide?.seconds;
    synth.portamento = seconds === undefined ? own : joined !== null ? seconds : own;
    return joined;
  };
}

/** How quickly a joined note's envelopes settle on its own sustain level, seconds (a time constant). */
const JOIN_SETTLE = 0.02;
/**
 * A joined note holds the envelopes this long before the last note's end: just ahead of the
 * release scheduled there, so the hold takes the release away rather than landing on it.
 */
const JOIN_HOLD = 0.0005;

/** An envelope's level signal (Tone keeps it to itself). */
const envelopeSignal = (env: Tone.Envelope) => (env as unknown as { _sig: Tone.Signal<'normalRange'> })._sig;

/**
 * Play a note on a Tone mono synth. One that joins the last note (`joinedEnd`: that note's end, see
 * legatoGlide) carries on from it with no new attack: the envelopes hold where they are and settle
 * on this note's sustain, the pitch moves (gliding by the synth's portamento; the same pitch is a
 * tie), and the release moves to this note's end. Otherwise (null) it's struck as usual.
 */
export function playMono(synth: Tone.MonoSynth, note: string, duration: Tone.Unit.Time, start: number, velocity: number, joinedEnd: number | null) {
  if (joinedEnd === null) {
    synth.triggerAttackRelease(note, duration, start, velocity);
    return;
  }
  const hold = Math.min(start, joinedEnd) - JOIN_HOLD;
  for (const [env, level] of [
    [synth.envelope, velocity * synth.envelope.sustain],
    [synth.filterEnvelope, synth.filterEnvelope.sustain],
  ] as const) {
    const sig = envelopeSignal(env);
    sig.cancelAndHoldAtTime(hold);
    sig.setTargetAtTime(level, start, JOIN_SETTLE);
  }
  // (Started again while it plays: the stop the last note's release set is called off)
  synth.oscillator.start(start);
  synth.setNote(note, start);
  synth.triggerRelease(start + synth.toSeconds(duration));
}

/** Clean, deep sine sub-bass (monophonic). */
export function createSubBass(output: Tone.InputNode, glide?: GlideRef) {
  const synth = new Tone.MonoSynth({
    volume: 0,
    oscillator: { type: 'sine' },
    filter: { type: 'lowpass', frequency: 220, rolloff: -24, Q: 0.5 },
    filterEnvelope: { baseFrequency: 180, octaves: 0.5, attack: 0.01, decay: 0.2, sustain: 1, release: 0.3 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.85, release: 0.25 },
  }).connect(output);
  const safeTime = monotonicTime(synth.context);
  const glideFor = legatoGlide(synth, glide, 0);
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) => {
      const start = safeTime(time);
      playMono(synth, note, duration, start, velocity, glideFor(start, start + synth.toSeconds(duration)));
    },
    ...heldNote(synth, safeTime),
    releaseAll: () => synth.triggerRelease(),
    dispose: () => synth.dispose(),
  };
}

/** 808 bass: a long sine boom with a quick downward pitch drop, lightly saturated. */
/** Seconds an 808 note takes to slide to the next one's pitch when they overlap. */
const SLIDE_808 = 0.08;

/**
 * The 808: a sine with a quick pitch drop, driven. A note that starts before the previous one has
 * ended doesn't hit again: the sounding note slides to the new pitch and carries on to the new
 * note's end (the trap and drill "808 slide"). Notes that only touch play separately.
 */
export function create808(output: Tone.InputNode, modern = false) {
  /**
   * `modern` (Expressive playing): the 808 as it's mixed now, and easier on the ears. A clean,
   * mono sub (low-passed at 120 Hz) carries the weight; a copy with its lows cut at 90 Hz goes
   * through the drive and a 3.5 kHz high cut, 8 dB down, so phones and small speakers hear the
   * 808 without the sub itself getting any louder or harsher. The attack is never sharper than
   * 6 ms and the pitch drop is gentler. Otherwise the original: the whole 808 through the drive.
   */
  const drive = new Tone.Distortion({ distortion: modern ? 0.45 : 0.22, oversample: '4x', wet: modern ? 1 : 0.6 });
  const synth = new Tone.MembraneSynth({
    // (The clean sub's peaks aren't clipped flat by the drive: a dB lower keeps them in line)
    volume: modern ? -3 : -2,
    pitchDecay: modern ? 0.04 : 0.06,
    octaves: modern ? 0.9 : 1.6,
    oscillator: { type: 'sine' },
    envelope: { attack: modern ? 0.006 : 0.002, decay: 1.4, sustain: 0.35, release: 0.9 },
  });
  const extra: Array<{ dispose: () => void }> = [];
  if (modern) {
    const clean = new Tone.Filter({ type: 'lowpass', frequency: 120, rolloff: -24 });
    const lowCut = new Tone.Filter({ type: 'highpass', frequency: 90, rolloff: -12 });
    const highCut = new Tone.Filter({ type: 'lowpass', frequency: 3500, rolloff: -12 });
    const grit = new Tone.Gain(Tone.dbToGain(-8));
    synth.connect(clean);
    clean.connect(output);
    synth.chain(lowCut, drive, highCut, grit, output);
    extra.push(clean, lowCut, highCut, grit);
  } else synth.chain(drive, output);
  const safeTime = monotonicTime(synth.context);
  const held = heldNote(synth, safeTime);
  /** When the sounding scheduled note ends, so a note starting before then slides instead. */
  let soundingUntil = -Infinity;
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) => {
      const start = safeTime(time);
      const length = synth.toSeconds(duration);
      const freq = Tone.Frequency(note).toFrequency();
      if (!Number.isFinite(length) || !(freq > 0)) return;
      const end = start + Math.max(0.005, length);
      if (soundingUntil > start + 0.001) {
        const f = synth.oscillator.frequency;
        f.cancelAndHoldAtTime(start);
        f.exponentialRampToValueAtTime(freq, start + SLIDE_808);
        // The old note's release and oscillator stop go; the envelope carries on and releases at
        // the new end
        synth.envelope.cancel(start);
        synth.oscillator.restart(start);
        synth.triggerRelease(end);
      } else {
        synth.triggerAttack(note, start, velocity);
        synth.triggerRelease(end);
      }
      soundingUntil = end;
    },
    attack: (note: string, time: number, velocity: number) => {
      soundingUntil = -Infinity;
      held.attack(note, time, velocity);
    },
    release: held.release,
    bend: held.bend,
    releaseAll: () => {
      soundingUntil = -Infinity;
      synth.triggerRelease();
    },
    dispose: () => {
      synth.dispose();
      drive.dispose();
      extra.forEach((n) => n.dispose());
    },
  };
}

/**
 * Analog-style lead: detuned saws, filter envelope and a short glide between notes, gently widened
 * to stereo, with a release that rings on for about 0.4 s (40 dB down) between phrases.
 */
export function createLead(output: Tone.InputNode, glide?: GlideRef) {
  const wide = createWideOutput(output, LEAD_WIDTH);
  const synth = new Tone.MonoSynth({
    volume: -8,
    portamento: 0.035,
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 } as Partial<Tone.OmniOscillatorOptions>,
    filter: { type: 'lowpass', rolloff: -24, Q: 3 },
    filterEnvelope: { baseFrequency: 400, octaves: 3.5, attack: 0.01, decay: 0.25, sustain: 0.45, release: 0.3 },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.6 },
  }).connect(wide.input);
  const safeTime = monotonicTime(synth.context);
  const glideFor = legatoGlide(synth, glide, 0.035);
  return {
    trigger: (note: string, duration: Tone.Unit.Time, time: number, velocity: number) => {
      const start = safeTime(time);
      playMono(synth, note, duration, start, velocity, glideFor(start, start + synth.toSeconds(duration)));
    },
    ...heldNote(synth, safeTime),
    releaseAll: () => synth.triggerRelease(),
    dispose: () => {
      synth.dispose();
      wide.dispose();
    },
  };
}

/**
 * Drum machine in the 808 style: long boomy kick, snappy noise snare, crisp hats and the
 * classic two-tone cowbell. Same hits (and note map) as the analog Drums kit. `seed` is the
 * track's (see trackSeed), which with the time picks each snare's and hat's noise.
 */
export function createDrumMachine(output: Tone.InputNode, seed = 0) {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.09,
    octaves: 5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.75, sustain: 0, release: 0.4 },
    volume: 1,
  }).connect(output);

  const snareTone = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }, volume: -8 }).connect(output);
  const snareFilter = new Tone.BiquadFilter({ type: 'bandpass', frequency: 2500, Q: 0.8 }).connect(output);
  const snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -2 }).connect(snareFilter);

  const hatFilter = new Tone.BiquadFilter({ type: 'highpass', frequency: 7000 }).connect(output);
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 }, volume: -10 }).connect(hatFilter);
  seedToneNoise(snareNoise.noise, noiseKey(seed, 'snare'));
  seedToneNoise(hat.noise, noiseKey(seed, 'hat'));

  // 808 cowbell: two square waves (540 + 800 Hz) through a bandpass
  const bellFilter = new Tone.BiquadFilter({ type: 'bandpass', frequency: 700, Q: 2 }).connect(output);
  const bellEnv = { attack: 0.001, decay: 0.12, sustain: 0.05, release: 0.15 };
  const bellLow = new Tone.Synth({ oscillator: { type: 'square' }, envelope: bellEnv, volume: -12 }).connect(bellFilter);
  const bellHigh = new Tone.Synth({ oscillator: { type: 'square' }, envelope: bellEnv, volume: -12 }).connect(bellFilter);

  const kickTime = monotonicTime(kick.context);
  const snareTime = monotonicTime(snareNoise.context);
  const hatTime = monotonicTime(hat.context);
  const bellTime = monotonicTime(bellLow.context);

  return {
    kick: (time: number, velocity: number, ratio = 1) => kick.triggerAttackRelease(27.5 * ratio, '8n', kickTime(time), velocity),
    snare: (time: number, velocity: number, ratio = 1) => {
      const t = snareTime(time);
      snareNoise.triggerAttackRelease('16n', t, velocity);
      snareTone.triggerAttackRelease(185 * ratio, '32n', t, velocity * 0.8);
    },
    hat: (open: boolean, time: number, velocity: number) => {
      hat.envelope.decay = open ? 0.32 : 0.04;
      hat.envelope.release = open ? 0.25 : 0.03;
      hat.triggerAttackRelease(open ? '8n' : '32n', hatTime(time), velocity);
    },
    cowbell: (time: number, velocity: number, ratio = 1) => {
      const t = bellTime(time);
      bellLow.triggerAttackRelease(540 * ratio, '16n', t, velocity);
      bellHigh.triggerAttackRelease(800 * ratio, '16n', t, velocity);
    },
    dispose: () => {
      [kick, snareTone, snareFilter, snareNoise, hatFilter, hat, bellFilter, bellLow, bellHigh].forEach((n) => n.dispose());
    },
  };
}
