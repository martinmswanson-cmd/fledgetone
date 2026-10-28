import { liveMix } from './engine';
import { decodedSound } from './soundLibrary';
import { ENVELOPE_HOP, envelopeOf, equalSlices, reversedAfterRecut, transientSlices } from './slicing';
import type { SlicerSettings, SoundMeta } from '../store/timelineTypes';

/**
 * Slicing a sound the browser has decoded: the Slicer's Auto mode and "Chop to Slicer" need the
 * sound's energy envelope, worked out once per decoded buffer and kept with it.
 */
const envelopes = new WeakMap<AudioBuffer, Float32Array>();

/** The sound's energy envelope (ENVELOPE_HOP frames), or undefined while it isn't decoded for live playback. */
export function soundEnvelope(soundId: string): Float32Array | undefined {
  const buffer = decodedSound(soundId, liveMix.bus.context.sampleRate);
  if (!buffer) return undefined;
  let env = envelopes.get(buffer);
  if (!env) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    envelopes.set(buffer, (env = envelopeOf(channels, buffer.sampleRate)));
  }
  return env;
}

/** Where these settings cut [start, end) of their sound: Auto at its transients (just the start while the sound isn't decoded), Equal into `count`. */
export function computeSlices(s: Pick<SlicerSettings, 'soundId' | 'mode' | 'count' | 'sensitivity' | 'start' | 'end'>): number[] {
  if (s.mode === 'equal') return equalSlices(s.start, s.end, s.count);
  const env = soundEnvelope(s.soundId);
  return env ? transientSlices(env, ENVELOPE_HOP, s.start, s.end, s.sensitivity) : [s.start];
}

/** Fresh Slicer settings for a sound just loaded: all of it, cut at its transients. */
export function slicerFor(sound: SoundMeta, part?: { start: number; end: number }): SlicerSettings {
  const start = part?.start ?? 0;
  const end = Math.max(start + 0.01, part?.end ?? sound.seconds);
  const base = { soundId: sound.id, name: sound.name, start, end, mode: 'auto' as const, count: 8 as const, sensitivity: 0.5 };
  return { ...base, slices: computeSlices(base), pitch: false, focus: 0 };
}

/** The settings with their slices cut again by their mode (after a change of mode, count or sensitivity); backwards slices follow by where they start. */
export function resliced(s: SlicerSettings): SlicerSettings {
  const slices = computeSlices(s);
  return reversedAfterRecut(s, { ...s, slices, focus: Math.min(s.focus, slices.length - 1) });
}
