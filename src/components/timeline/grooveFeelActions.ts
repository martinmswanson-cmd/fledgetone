/**
 * The groove feel pickers' actions (GrooveFeelPicker.tsx): the feels to offer, and taking a
 * groove from an audio clip of the song (grooveFromAudio.ts, loaded only when it's used).
 */
import { useTimelineStore } from '../../store/timelineStore';
import { GROOVE_FEELS, userFeelsIn, type GrooveFeel } from '../../store/grooveFeels';
import type { Clip } from '../../store/timelineTypes';

/** The feels to pick from: the measured ones, then those taken from audio in this song. */
export function feelChoices(clips: readonly Clip[]): GrooveFeel[] {
  return [...GROOVE_FEELS, ...userFeelsIn(clips)];
}

/** Measure an audio clip's groove and put it with `put`. Returns the feel's name, or null. */
export async function takeGrooveFromAudio(audioClipId: string, put: (feel: GrooveFeel) => void, onProgress?: (f: number) => void): Promise<string | null> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === audioClipId && c.audio);
  if (!clip) return null;
  const { grooveFromAudioClip } = await import('../../audio/grooveFromAudio');
  const n = userFeelsIn(s.clips).length + 1;
  const feel = await grooveFromAudioClip(clip, s.bpm, `From audio ${n}: ${clip.name}`.slice(0, 60), onProgress);
  if (!feel) return null;
  put(feel);
  return feel.name;
}

