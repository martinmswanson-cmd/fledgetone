/**
 * The Slicer instrument (vocal chops): a sound cut into slices, one per key from C3 up, each note
 * playing its slice from a buffer with a short fade at either end.
 */
import * as Tone from 'tone';
import type { PlayableNote, TrackInstrument } from '../instruments';
import type { SlicerSettings } from '../../store/timelineTypes';
import { SLICE_KEY_BASE } from '../../store/timelineTypes';
import { midiOf, sliceEnd } from '../slicing';
import { decodedSound, ensureSound } from '../soundLibrary';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';
import { copySetFor } from '../samplers/samplerManager';
import type { TrackPlan } from '../samplers/songSamples';

/** Fade at either end of a slice, so cuts mid-vocal don't click. */
const SLICE_FADE = 0.003;

/** Each decoded sound played backwards, made once when a reversed slice first plays (live or in an export). */
const backwards = new WeakMap<AudioBuffer, AudioBuffer>();
function reversedOf(buffer: AudioBuffer): AudioBuffer {
  let r = backwards.get(buffer);
  if (!r) {
    r = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: buffer.length, sampleRate: buffer.sampleRate });
    for (let c = 0; c < buffer.numberOfChannels; c++) r.copyToChannel(buffer.getChannelData(c).slice().reverse(), c);
    backwards.set(buffer, r);
  }
  return r;
}

/**
 * The Slicer: a sound (often a vocal) cut into slices, one per key from C3 up. A note plays its
 * slice from the slice's start for the note's length or the slice's, whichever is shorter. In Pitch
 * mode every key plays the focused slice instead, transposed from that slice's own key. Each note
 * is a plain AudioBufferSourceNode and a GainNode (see native.ts), so nothing runs between notes;
 * the sound is decoded once per context and shared (see soundLibrary.ts). The slices and modes are
 * read as each note plays, so the track's settings follow without rebuilding the instrument. In
 * Pitch mode a key away from the slice's own plays a copy of the slice made at that pitch
 * (pitchedCopies.ts), at a rate of exactly 1, where it's made: live, from the second time that key
 * plays that slice; in a render, always (see prepare).
 */
export function createSlicer(output: Tone.InputNode, initial: SlicerSettings | undefined): TrackInstrument {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw, 0.05);
  let settings = initial;
  if (settings) ensureSound(settings.soundId);
  const copies = copySetFor(raw);

  /**
   * What Pitch mode plays `midi` from: the focused slice of `buffer`, as a copy at the key's pitch
   * (its stretch of the sound, forwards or backwards, from its first frame), with that copy's wish.
   */
  const sliceWish = (s: SlicerSettings, buffer: AudioBuffer, midi: number) => {
    const index = Math.max(0, Math.min(s.slices.length - 1, s.focus));
    const rate = Math.pow(2, (midi - (SLICE_KEY_BASE + index)) / 12);
    const from = s.slices[index];
    const to = Math.min(sliceEnd(s.slices, index, s.end), buffer.duration);
    const back = !!s.reversed?.includes(index);
    const offset = Math.round((back ? buffer.duration - to : from) * buffer.sampleRate) / buffer.sampleRate;
    return { index, rate, back, wish: { ratio: rate, playRate: raw.sampleRate, region: [offset, offset + (to - from)] as [number, number] } };
  };

  const play = (notes: PlayableNote[], time: number) => {
    const s = settings;
    const buffer = s && decodedSound(s.soundId, raw.sampleRate);
    if (!s || !buffer) return; // no sound yet, or still decoding: silent rather than late
    const start = notLate(bus.context, time);
    for (const n of notes) {
      const midi = midiOf(n.note);
      const length = bus.toSeconds(n.duration);
      if (!Number.isFinite(midi) || !Number.isFinite(length)) continue;
      let index: number;
      let rate = 1;
      if (s.pitch) {
        index = Math.max(0, Math.min(s.slices.length - 1, s.focus));
        rate = Math.pow(2, (midi - (SLICE_KEY_BASE + index)) / 12);
      } else {
        index = midi - SLICE_KEY_BASE;
        if (index < 0 || index >= s.slices.length) continue; // a key with no slice
      }
      const from = s.slices[index];
      const to = Math.min(sliceEnd(s.slices, index, s.end), buffer.duration);
      // How long it sounds: the note, or the slice (which takes to / rate seconds at this rate)
      const seconds = Math.min(Math.max(0.005, length), (to - from) / rate);
      if (!(seconds > 0) || from >= buffer.duration) continue;
      // A reversed slice: its end comes first, from the backwards copy
      const back = !!s.reversed?.includes(index);
      const played = back ? reversedOf(buffer) : buffer;
      // Pitch mode, away from the slice's key: its copy at that pitch, from the slice's first frame
      const copy = s.pitch && rate !== 1 ? copies.find(played, sliceWish(s, buffer, midi).wish) : undefined;
      const source = raw.createBufferSource();
      source.buffer = copy?.buffer ?? played;
      source.playbackRate.value = copy ? 1 : rate;
      const amp = raw.createGain();
      // Fades at the cuts; a slice at the very start of the sound keeps the recording's own attack
      const fade = Math.min(SLICE_FADE, seconds / 2);
      const level = Math.max(0, Math.min(1, n.velocity));
      // On whole frames: a source started or read between two frames is interpolated, which blurs its top end
      const at = Math.round(start * raw.sampleRate) / raw.sampleRate;
      const offset = Math.round((back ? buffer.duration - to : from) * buffer.sampleRate) / buffer.sampleRate;
      // (A backwards slice always fades in: it starts where a cut is, the sound's end at the latest)
      const attack = !back && offset <= 0;
      amp.gain.setValueAtTime(attack ? level : 0, at);
      if (!attack) amp.gain.linearRampToValueAtTime(level, at + fade);
      amp.gain.setValueAtTime(level, at + seconds - fade);
      amp.gain.linearRampToValueAtTime(0, at + seconds);
      source.connect(amp);
      amp.connect(input);
      source.start(at, copy ? 0 : offset);
      voices.add({ start: at, stopAt: at + seconds, sources: [source], nodes: [source, amp], amp });
    }
  };

  return {
    play,
    releaseAll: () => voices.releaseAll(bus.now()),
    ready: Promise.resolve(),
    prepare: async (plan: TrackPlan) => {
      const s = settings;
      const buffer = s?.pitch ? decodedSound(s.soundId, raw.sampleRate) : undefined;
      if (!s || !buffer || !s.slices.length) return;
      const jobs: Promise<void>[] = [];
      for (const n of plan.notes) {
        const midi = midiOf(n.note);
        if (!Number.isFinite(midi)) continue;
        const { rate, back, wish } = sliceWish(s, buffer, midi);
        if (rate !== 1) jobs.push(copies.prepare(back ? reversedOf(buffer) : buffer, wish));
      }
      await Promise.all(jobs);
    },
    dispose: () => {
      voices.stopAll();
      copies.dispose();
      bus.dispose();
    },
    setSlicer: (next) => {
      settings = next;
      if (next) ensureSound(next.soundId);
    },
  };
}
