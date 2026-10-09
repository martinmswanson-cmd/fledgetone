import * as Tone from 'tone';
import type { PlayableNote, TrackInstrument } from '../instruments';
import type { SlicerSettings } from '../../store/timelineTypes';
import { SLICE_KEY_BASE } from '../../store/timelineTypes';
import { midiOf, sliceEnd } from '../slicing';
import { decodedSound, ensureSound } from '../soundLibrary';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';

/** Fade at either end of a slice, so cuts mid-vocal don't click. */
const SLICE_FADE = 0.003;

/**
 * The Slicer: a sound (often a vocal) cut into slices, one per key from C3 up. A note plays its
 * slice from the slice's start for the note's length or the slice's, whichever is shorter. In Pitch
 * mode every key plays the focused slice instead, transposed from that slice's own key. Each note
 * is a plain AudioBufferSourceNode and a GainNode (see native.ts), so nothing runs between notes;
 * the sound is decoded once per context and shared (see soundLibrary.ts). The slices and modes are
 * read as each note plays, so the track's settings follow without rebuilding the instrument.
 */
export function createSlicer(output: Tone.InputNode, initial: SlicerSettings | undefined): TrackInstrument {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw, 0.05);
  let settings = initial;
  if (settings) ensureSound(settings.soundId);

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
      const source = raw.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const amp = raw.createGain();
      // Fades at the cuts; a slice at the very start of the sound keeps the recording's own attack
      const fade = Math.min(SLICE_FADE, seconds / 2);
      const level = Math.max(0, Math.min(1, n.velocity));
      // On whole frames: a source started or read between two frames is interpolated, which blurs its top end
      const at = Math.round(start * raw.sampleRate) / raw.sampleRate;
      const offset = Math.round(from * buffer.sampleRate) / buffer.sampleRate;
      amp.gain.setValueAtTime(offset > 0 ? 0 : level, at);
      if (offset > 0) amp.gain.linearRampToValueAtTime(level, at + fade);
      amp.gain.setValueAtTime(level, at + seconds - fade);
      amp.gain.linearRampToValueAtTime(0, at + seconds);
      source.connect(amp);
      amp.connect(input);
      source.start(at, offset);
      voices.add({ start: at, stopAt: at + seconds, sources: [source], nodes: [source, amp], amp });
    }
  };

  return {
    play,
    releaseAll: () => voices.releaseAll(bus.now()),
    ready: Promise.resolve(),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
    setSlicer: (next) => {
      settings = next;
      if (next) ensureSound(next.soundId);
    },
  };
}
