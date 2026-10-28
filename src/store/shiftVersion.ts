/**
 * Which re-pitch made an audio clip's key-moved sound (Move to key: flipActions.ts shiftClip), so
 * songs keep up as it gets better. SHIFT_VERSION 2 is the phase vocoder (pitchShift.ts), which keeps
 * a chord a clean chord; a clip moved before it (no version kept) plays a copy made the old way,
 * and staleShifts finds those, for soundUpgrade.ts to make again from their original. No audio or
 * store here, so Node can unit-test it.
 */
import type { Clip, ClipAudio } from './timelineTypes';

export const SHIFT_VERSION = 2;

/** Whether `audio` plays a key-moved copy made by an older re-pitch. */
export const shiftIsStale = (audio: ClipAudio | undefined): boolean =>
  !!audio?.shiftedFrom && typeof audio.shift === 'number' && Math.abs(audio.shift) >= 0.01 && (audio.shiftVersion ?? 1) < SHIFT_VERSION;

/** The clips (by id) whose key-moved sound an older re-pitch made, with what to make again: the original and the shift. */
export function staleShifts(clips: readonly Pick<Clip, 'id' | 'audio'>[]): Array<{ clipId: string; soundId: string; from: string; shift: number }> {
  return clips.filter((c) => shiftIsStale(c.audio)).map((c) => ({ clipId: c.id, soundId: c.audio!.soundId, from: c.audio!.shiftedFrom!, shift: c.audio!.shift! }));
}
