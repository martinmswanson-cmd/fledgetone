import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import {
  attackDecay,
  createBus,
  createFilter,
  createOsc,
  createVoiceSet,
  noteFrequency,
  phasedSaws,
  releaseConstant,
  releaseTail,
} from './native';

/**
 * The EDM poly synths: Supersaw and Pluck. Every note is its own handful of plain Web Audio
 * nodes (see native.ts), so there's no voice limit to drop notes at and nothing runs between notes.
 */

/** Supersaw voices: detune in cents and side (-1 left, 0 both, 1 right), alternating across the field. */
const SUPERSAW: ReadonlyArray<[cents: number, side: -1 | 0 | 1]> = [
  [-37, -1],
  [-23, 1],
  [-11, -1],
  [0, 0],
  [9, 1],
  [21, -1],
  [34, 1],
];
/** Where in its cycle each saw starts (fixed, uneven), so they don't sweep against each other at every note's start. */
const SUPERSAW_PHASES = [0, 0.31, 0.57, 0.12, 0.83, 0.46, 0.69];

/**
 * Supersaw: seven detuned saws per note, spread left and right, with a soft attack and a medium
 * release, through a fixed low-pass (and a high-pass that leaves the low end to the bass).
 */
export function createSupersaw(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  // Shared and fixed: a filter whose settings don't change costs nothing while no note plays
  const highpass = createFilter(raw, 'highpass', 140, 0);
  const lowpass = createFilter(raw, 'lowpass', 7000, 0);
  highpass.connect(lowpass);
  lowpass.connect(input);
  const release = 0.45;

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
    attackDecay(amp.gain, start, 0.11 * n.velocity, 0.035, 0.4, 0.8);
    amp.gain.setTargetAtTime(0, end, releaseConstant(release));
    merger.connect(amp);
    amp.connect(highpass);
    voices.add({ start, stopAt: end + releaseTail(release), sources, nodes: [...sources, merger, amp], amp });
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    releaseAll: () => voices.releaseAll(raw.currentTime, 0.08),
    dispose: () => {
      voices.stopAll();
      highpass.disconnect();
      lowpass.disconnect();
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
    const saw = createOsc(raw, 'sawtooth', freq, start);
    const square = createOsc(raw, 'square', freq, start, 8);
    const mix = raw.createGain();
    mix.gain.value = 0.5;
    const filter = createFilter(raw, 'lowpass', freq, 4);
    // Bright on the attack (more so when played harder), closing within about a tenth of a second
    filter.frequency.setValueAtTime(Math.min(16000, freq * 16 + 3000 * n.velocity), start);
    filter.frequency.setTargetAtTime(Math.min(8000, freq * 2 + 200), start + 0.002, 0.07);
    const amp = raw.createGain();
    attackDecay(amp.gain, start, 0.45 * n.velocity, 0.003, decay, 0);
    // A note let go before the pluck has died away stops sooner
    amp.gain.setTargetAtTime(0, end, releaseConstant(release));
    saw.connect(mix);
    square.connect(mix);
    mix.connect(filter);
    filter.connect(amp);
    amp.connect(input);
    // Down 50 dB by twice the decay time
    const stopAt = Math.min(start + 0.003 + 2 * decay, end + releaseTail(release));
    voices.add({ start, stopAt, sources: [saw, square], nodes: [saw, square, mix, filter, amp], amp });
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    releaseAll: () => voices.releaseAll(raw.currentTime),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
