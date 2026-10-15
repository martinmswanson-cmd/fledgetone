import * as Tone from 'tone';
import type { PlayableNote } from './instruments';
import { notLate } from './presets/monotonic';
import { createBus, createOsc, createVoiceSet, noteFrequency } from './presets/native';
import type { NativeBus, NativeVoice } from './presets/native';
import { HELD_NOTE } from './presets/edmSynths';
import type { SubLayer } from '../store/bassTools';
import { subFrequency } from '../store/bassTools';

/**
 * The Sub enhancer (Track.subLayer): a clean sine played under a track's own notes, an octave down
 * or on the note itself, so a thin bass gets a solid, mono floor. It follows the notes rather than
 * the sound (there's no reliable way to find an octave below a sound without an audio worklet,
 * which would slow every export), so it's exact: in tune, in time, the same live and exported.
 * One sine at a time (the lowest note of a chord), sliding between overlapping notes.
 *
 * Its nodes exist only while it's on, and per note only while that note sounds.
 */

/** Seconds a note's sub takes to rise: no click, still tight. */
const ATTACK = 0.006;
/** Seconds its end takes to fall 40 dB. */
const RELEASE = 0.06;
/** The sine's peak at level 1 and full velocity. */
const PEAK = 0.55;
/** Slide time when the track has no glide of its own. */
const DEFAULT_GLIDE = 0.06;

const lowest = (notes: PlayableNote[]) => notes.reduce((a, b) => (noteFrequency(b.note) < noteFrequency(a.note) ? b : a));

interface SubVoice extends NativeVoice {
  osc: OscillatorNode;
  end: number;
}

export function createSubLayer(output: Tone.InputNode, initial: SubLayer | undefined) {
  let settings = initial;
  let nb: NativeBus | null = null;
  let voices: ReturnType<typeof createVoiceSet> | null = null;
  let current: SubVoice | null = null;
  /**
   * Its bus, made while it's on. Made when the instrument is built or the setting changes, never
   * at a note: notes of an export play while Tone's current context may be the live one again, and
   * a bus made then would be in the wrong context.
   */
  const ready = () => {
    if (!nb) {
      nb = createBus(output);
      voices = createVoiceSet(nb.raw);
    }
    return { ...nb, voices: voices! };
  };
  if (initial) ready();

  const playNote = (n: PlayableNote, time: number, glide: number): SubVoice | undefined => {
    const s = settings;
    if (!s || s.level <= 0 || !nb || !voices) return;
    const { bus, raw, input } = nb;
    const set = voices;
    const freq = subFrequency(noteFrequency(n.note), s.mode);
    const length = bus.toSeconds(n.duration);
    if (!Number.isFinite(length) || !(freq > 0)) return;
    const start = notLate(bus.context, time);
    const end = start + Math.max(0.01, length);
    const peak = PEAK * s.level * (0.4 + 0.6 * n.velocity);
    const releaseTc = RELEASE / Math.log(100);

    const v = current;
    if (v && v.end > start + 0.001 && v.stopAt > start) {
      // Legato: slide on, at this note's level
      v.osc.frequency.cancelAndHoldAtTime(start);
      v.osc.frequency.exponentialRampToValueAtTime(freq, start + Math.max(0.005, glide));
      const g = v.amp.gain;
      g.cancelAndHoldAtTime(start);
      g.setTargetAtTime(s.decay > 0 ? 0 : peak, start, s.decay > 0 ? s.decay / Math.log(1000) : 0.01);
      g.setTargetAtTime(0, end, releaseTc);
      set.extend(v, end + RELEASE * 1.5);
      v.end = end;
      return v;
    }
    if (current && current.stopAt > start) set.release(current, start, 0.015);
    const osc = createOsc(raw, 'sine', freq, start);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + ATTACK);
    if (s.decay > 0) amp.gain.setTargetAtTime(0, start + ATTACK, s.decay / Math.log(1000));
    amp.gain.setTargetAtTime(0, end, releaseTc);
    osc.connect(amp);
    amp.connect(input);
    const stopAt = s.decay > 0 ? Math.min(end + RELEASE * 1.5, start + ATTACK + s.decay * 1.05) : end + RELEASE * 1.5;
    const voice: SubVoice = { start, stopAt, sources: [osc], nodes: [osc, amp], amp, osc, end };
    set.add(voice);
    current = voice;
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number, glide = DEFAULT_GLIDE) => {
      if (!settings || !notes.length) return;
      try {
        playNote(lowest(notes), time, glide);
      } catch (err) {
        console.warn('Skipped a sub note:', err);
      }
    },
    /** A held key: its sub, and what lets it go. */
    hold: (note: PlayableNote, time: number, glide = DEFAULT_GLIDE) => {
      const voice = settings ? playNote({ ...note, duration: HELD_NOTE }, time, glide) : undefined;
      return (at: number) => {
        if (!voice || !voices || current !== voice || !nb) return;
        const t = notLate(nb.bus.context, at);
        voices.release(voice, t, RELEASE);
        voice.end = t;
      };
    },
    /** Its settings as they change (from the next note); undefined switches it off and lets its nodes go. */
    set: (next: SubLayer | undefined) => {
      settings = next;
      if (next) ready();
      if (!next && nb) {
        const old = { nb, voices };
        nb = null;
        voices = null;
        current = null;
        old.voices?.releaseAll(old.nb.raw.currentTime, 0.03);
        // Once the fade has played
        setTimeout(() => {
          old.voices?.stopAll();
          old.nb.bus.dispose();
        }, 500);
      }
    },
    releaseAll: () => {
      if (voices && nb) voices.releaseAll(nb.raw.currentTime, 0.03);
      current = null;
    },
    dispose: () => {
      voices?.stopAll();
      nb?.bus.dispose();
      nb = null;
      voices = null;
      current = null;
    },
  };
}
