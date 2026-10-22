import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import {
  attackDecay,
  builtinWave,
  createBus,
  createFilter,
  createOsc,
  createVoiceSet,
  noteFrequency,
  phasedSaws,
  releaseConstant,
  releaseTail,
} from './native';
import { createMonoLows } from './widen';

/**
 * The EDM poly synths: Supersaw and Pluck. Every note is its own handful of plain Web Audio
 * nodes (see native.ts), so there's no voice limit to drop notes at and nothing runs between notes.
 */

/**
 * How long a key held on a MIDI keyboard sounds at most: these synths schedule a note's whole
 * envelope when it starts, so a held note is a long one let go early (see hold).
 */
export const HELD_NOTE = '60s';

/** Supersaw voices: detune in cents and side (-1 left, 0 both, 1 right), alternating across the field. */
const SUPERSAW: ReadonlyArray<[cents: number, side: -1 | 0 | 1]> = [
  [-37, -1],
  [-21, 1],
  [-11, -1],
  [0, 0],
  [11, 1],
  [21, -1],
  [37, 1],
];
/**
 * Where in its cycle each saw starts (fixed, uneven), so they don't sweep against each other at
 * every note's start. How loud a side is for the first few hundred milliseconds of a note depends
 * on how its saws' phases line up (later the detune spreads them), so the right side mirrors the
 * left: each right saw has a left saw's detune negated and its phase reflected about the middle
 * saw's, which gives both sides the same phase differences, note for note. (Unmirrored, a short
 * low note came out up to 5 dB louder on one side.)
 */
const SUPERSAW_PHASES = [0, 0.78, 0.57, 0.12, 0.67, 0.46, 0.24];
/**
 * The Supersaw was voiced through a track strip that folded stereo to mono: its seven unrelated
 * saws came out at 2.5 saws' worth of power on each side. The strip keeps both sides now, where
 * each has four (three of its own and the middle one), so this leaves each side as loud as it
 * was voiced, only wide.
 */
const SUPERSAW_LEVEL = Math.sqrt(2.5 / 4);
/**
 * A Supersaw note's peak at velocity 1 (before SUPERSAW_LEVEL). It played some 10 dB under the
 * other pads and chords as heard; at this (with no correction in the catalog) a chord of it is as
 * loud as theirs.
 */
const SUPERSAW_PEAK = 0.185;

/**
 * Supersaw: seven detuned saws per note, spread left and right, with a soft attack and a release
 * that carries one chord into the next (1.5 s to fade 40 dB), through a fixed low-pass (and a
 * high-pass that leaves the low end to the bass), its lows kept in the middle (widen.ts).
 */
export function createSupersaw(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  // Shared and fixed: a filter whose settings don't change costs nothing while no note plays
  const highpass = createFilter(raw, 'highpass', 140, 0);
  const lowpass = createFilter(raw, 'lowpass', 7000, 0);
  // (Its saws spread left and right: a chord's low notes are kept in the middle)
  const monoLows = createMonoLows(raw, input);
  highpass.connect(lowpass);
  lowpass.connect(monoLows.input);
  const release = 1.5;

  const playNote = (n: PlayableNote, start: number) => {
    const length = bus.toSeconds(n.duration);
    const freq = noteFrequency(n.note);
    if (!Number.isFinite(length) || !(freq > 0)) return; // garbled by hand-editing: skip it
    const end = start + Math.max(0.005, length);
    const waves = phasedSaws(raw, SUPERSAW_PHASES);
    const merger = raw.createChannelMerger(2);
    const sources = SUPERSAW.map(([cents, side], i) => {
      const osc = createOsc(raw, waves[i], freq, start, cents);
      if (side <= 0) osc.connect(merger, 0, 0);
      if (side >= 0) osc.connect(merger, 0, 1);
      return osc;
    });
    const amp = raw.createGain();
    attackDecay(amp.gain, start, SUPERSAW_PEAK * SUPERSAW_LEVEL * n.velocity, 0.035, 0.4, 0.8);
    amp.gain.setTargetAtTime(0, end, releaseConstant(release));
    merger.connect(amp);
    amp.connect(highpass);
    const voice = { start, stopAt: end + releaseTail(release), sources, nodes: [...sources, merger, amp], amp };
    voices.add(voice);
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    // A key held on a MIDI keyboard: a long note, let go early with the synth's own release
    hold: (note: PlayableNote, time: number) => {
      const voice = playNote({ ...note, duration: HELD_NOTE }, notLate(bus.context, time));
      return (at: number) => {
        if (voice) voices.release(voice, notLate(bus.context, at), release);
      };
    },
    releaseAll: () => voices.releaseAll(raw.currentTime, 0.08),
    dispose: () => {
      voices.stopAll();
      highpass.disconnect();
      lowpass.disconnect();
      monoLows.disconnect();
      bus.dispose();
    },
  };
}

/** Pluck: a saw and a detuned square through a low-pass that snaps shut, with a short decay. */
export function createPluck(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  /** Seconds to fade 95% of the way out on its own. */
  const decay = 0.5;
  const release = 0.08;

  const playNote = (n: PlayableNote, start: number) => {
    const length = bus.toSeconds(n.duration);
    const freq = noteFrequency(n.note);
    if (!Number.isFinite(length) || !(freq > 0)) return; // garbled by hand-editing: skip it
    const end = start + Math.max(0.005, length);
    // At half level each, built into their waves (no mixing gain node)
    const saw = createOsc(raw, builtinWave(raw, 'sawtooth', 0.5), freq, start);
    const square = createOsc(raw, builtinWave(raw, 'square', 0.5), freq, start, 8);
    const filter = createFilter(raw, 'lowpass', freq, 4);
    // Bright on the attack (more so when played harder), closing within about a tenth of a second
    filter.frequency.setValueAtTime(Math.min(16000, freq * 16 + 3000 * n.velocity), start);
    filter.frequency.setTargetAtTime(Math.min(8000, freq * 2 + 200), start + 0.002, 0.07);
    const amp = raw.createGain();
    attackDecay(amp.gain, start, 0.45 * n.velocity, 0.003, decay, 0);
    // A note let go before the pluck has died away stops sooner
    amp.gain.setTargetAtTime(0, end, releaseConstant(release));
    saw.connect(filter);
    square.connect(filter);
    filter.connect(amp);
    amp.connect(input);
    // Down 50 dB by twice the decay time
    const stopAt = Math.min(start + 0.003 + 2 * decay, end + releaseTail(release));
    const voice = { start, stopAt, sources: [saw, square], nodes: [saw, square, filter, amp], amp };
    voices.add(voice);
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    // A key held on a MIDI keyboard: the pluck dies away on its own, or sooner when let go
    hold: (note: PlayableNote, time: number) => {
      const voice = playNote({ ...note, duration: HELD_NOTE }, notLate(bus.context, time));
      return (at: number) => {
        if (voice) voices.release(voice, notLate(bus.context, at), release);
      };
    },
    releaseAll: () => voices.releaseAll(raw.currentTime),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
