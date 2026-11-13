/**
 * Glide Pad: a soft, wide, dark pad made for gliding between chords (see chordGlide.ts). Each note
 * is a warm tone (a sine with a little of its 2nd, 3rd and 4th harmonics) played three times, a
 * few cents apart (-7, 0, +7) and spread left, centre and right, held still (no chorus wobble);
 * a low note (under E3) plays once, plainer (the sine alone) and in the centre, so the bottom
 * stays solid. A slow eased attack (about a quarter second), a soft release, a 24 dB/octave
 * low-pass at 1.8 kHz, a touch of saturation and its own long, dark room (3.5 s, its tail dulled
 * towards 2.5 kHz). Built on voice pools (poly.ts), one per copy, so every voice glides on its own,
 * live and in the export the same.
 */
import * as Tone from 'tone';
import { createVoicePool, type GlidingVoice, type HeldVoice, type VoicePool } from './poly';
import { notLate } from './monotonic';
import { strikeWhole } from '../soundLead';
import type { VoiceControl } from '../instruments';
import { darkRoomChannels } from './glidePadRoom';

/** The three copies of an upper note: detune (cents) and place (-1 left to 1 right) */
const COPIES: ReadonlyArray<{ cents: number; pan: number; partials: number[] }> = [
  { cents: -7, pan: -0.75, partials: [1, 0.35, 0.15, 0.06] },
  { cents: 0, pan: 0, partials: [1, 0.35, 0.15, 0.06] },
  { cents: 7, pan: 0.75, partials: [1, 0.35, 0.15, 0.06] },
];
/** Notes under this (MIDI: E3) play once, the sine alone, in the centre */
export const GLIDE_PAD_LOW = 52;
/** Each copy's level (dB): three copies together about as loud as one plainer low note */
const COPY_DB = -17;
const LOW_DB = -11;
/** The attack's shape: x² over its length */
const EASE_IN = Array.from({ length: 65 }, (_, i) => (i / 64) ** 2);
/** Voices per copy: chords of six notes a couple of seconds apart, each ringing out about two seconds */
const VOICES = 14;

/** The pad's own room (see glidePadRoom.ts), as an AudioBuffer of the context's rate. */
function darkRoom(context: Tone.BaseContext): AudioBuffer {
  const channels = darkRoomChannels(context.sampleRate);
  const buffer = context.createBuffer(2, channels[0].length, context.sampleRate);
  channels.forEach((x, c) => buffer.copyToChannel(x, c));
  return buffer;
}

/** `note` `cents` away, as the pools take a pitch (Hz). */
const detunedNote = (note: string, cents: number) => (cents ? `${Tone.Frequency(note).toFrequency() * 2 ** (cents / 1200)}hz` : note);

/** `room: false`: without its room (for checks that follow its pitch, which the room's tail hides) */
export function createGlidePad(output: Tone.InputNode, opts: { room?: boolean } = {}) {
  // Out: dry and the dark room together, a touch of saturation before them
  const out = new Tone.Gain(1).connect(output);
  const dry = new Tone.Gain(0.8).connect(out);
  const reverb = new Tone.Convolver({ normalize: false });
  reverb.buffer = new Tone.ToneAudioBuffer(darkRoom(out.context));
  const dark = new Tone.Filter({ type: 'lowpass', frequency: 2500, rolloff: -12, Q: 0.5 });
  const wet = new Tone.Gain(opts.room === false ? 0 : 0.45).connect(out);
  reverb.chain(dark, wet);
  const warmth = new Tone.WaveShaper((x) => Math.tanh(x * 1.2) / 1.2, 1024);
  // (Not oversampled: what it shapes is low-passed at 1.4 kHz before it and the curve is gentle, so nothing it adds folds back
  // down; and an oversampled shaper is late by a different time at each rate, see shaperLag.ts)
  warmth.fan(dry, reverb);
  const lowpass = new Tone.Filter({ type: 'lowpass', frequency: 1400, rolloff: -24, Q: 0.5 }).connect(warmth);

  // (eased in, slow at first: a quarter second rising along x², no click and no sudden start; Tone's own curves rise fastest at first)
  const envelope = { attack: 0.25, attackCurve: EASE_IN, decay: 0.01, sustain: 1, release: 2, releaseCurve: 'exponential' as const };
  const panners: Tone.Panner[] = [];
  const pool = (pan: number, partials: number[], volume: number): VoicePool => {
    const p = new Tone.Panner(pan).connect(lowpass);
    panners.push(p);
    return createVoicePool((context) => new Tone.Synth({ context, volume, oscillator: { type: 'custom', partials }, envelope }), VOICES, p);
  };
  const copies = COPIES.map((c) => ({ cents: c.cents, pool: pool(c.pan, c.partials, COPY_DB) }));
  const low = pool(0, [1], LOW_DB);
  const isLow = (note: string) => Tone.Frequency(note).toMidi() < GLIDE_PAD_LOW;
  /** Each pool and the note it plays for `note` */
  const parts = (note: string): Array<[VoicePool, string]> => (isLow(note) ? [[low, note]] : copies.map((c) => [c.pool, detunedNote(note, c.cents)]));
  const all = [...copies.map((c) => c.pool), low];

  return {
    ready: Promise.resolve(),
    /** A chord, every copy of every note struck as one (live: see soundLead.ts strikeWhole) */
    trigger: (notes: string[], duration: Tone.Unit.Time, time: number, velocity: number) =>
      strikeWhole(out.context, notLate(out.context, time), (t) => {
        const lows = notes.filter(isLow);
        const highs = notes.filter((n) => !isLow(n));
        if (lows.length) low.trigger(lows, duration, t, velocity);
        if (highs.length) for (const c of copies) c.pool.trigger(highs.map((n) => detunedNote(n, c.cents)), duration, t, velocity);
      }),
    /** A key held on a MIDI keyboard: each copy held, let go together */
    attack: (note: string, time: number, velocity: number): HeldVoice => {
      const held = strikeWhole(out.context, notLate(out.context, time), (t) => parts(note).map(([p, n]) => p.attack(n, t, velocity)));
      return { release: (at) => held.forEach((h) => h.release(at)) };
    },
    /** A voice gliding between chords: each copy glides alike */
    glide: (note: string, time: number, velocity: number): VoiceControl | null => {
      const voices = strikeWhole(out.context, notLate(out.context, time), (t) => parts(note).map(([p, n]) => p.glide(n, t, velocity))).filter((v): v is GlidingVoice => !!v);
      if (!voices.length) return null;
      return {
        bend: (cents, at) => voices.forEach((v) => v.bend(cents, at)),
        pressure: (value, at) => voices.forEach((v) => v.pressure(value, at)),
        off: (at) => voices.forEach((v) => v.off(at)),
        cut: (at) => voices.forEach((v) => v.cut(at)),
      };
    },
    bend: (cents: number, time: number, live?: boolean, cut?: boolean) => all.forEach((p) => p.bend(cents, time, live, cut)),
    releaseAll: () => all.forEach((p) => p.releaseAll()),
    dispose: () => {
      all.forEach((p) => p.dispose());
      panners.forEach((p) => p.dispose());
      lowpass.dispose();
      warmth.dispose();
      reverb.dispose();
      dark.dispose();
      wet.dispose();
      dry.dispose();
      out.dispose();
    },
  };
}
