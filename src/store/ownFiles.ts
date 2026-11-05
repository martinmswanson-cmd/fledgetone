import { clipNameFromFile } from './audioClips';
import type { Clip, LauncherSlot, Track } from './timelineTypes';

/**
 * A song as it leaves the person's machine (a share link, the web runtime kit) without the names
 * of their own files: the Sampler's and the Slicer's sound are "Sound", a Drum Rack pad with a
 * sound is "Pad 1"..., a Multi Sampler zone "Sound 1"..., and an audio clip still named after its
 * file is "Audio". For a link, each sound's id (a hash of the file's bytes) is swapped for a plain
 * one too. Nothing else changes, and a song with none of these comes back as it was. No audio or
 * store here, so Node can unit-test it.
 */

/** What a sound loaded from a file is called instead of the file's name. */
export const SOUND_NAME = 'Sound';

type Named = { name: string; audio?: { soundId: string } };

/**
 * `song` without its sounds' file names. `fileNameOf` gives a sound's file name, when it's known,
 * so an audio clip that still carries it ("Voice memo" from "Voice memo.m4a") is renamed too.
 */
export function withoutFileNames<T extends { tracks: Track[]; clips: Clip[] }>(song: T, fileNameOf: (soundId: string) => string | undefined = () => undefined): T {
  const fromFile = (c: Named) => {
    const file = c.audio && fileNameOf(c.audio.soundId);
    return file !== undefined && c.name === clipNameFromFile(file);
  };
  const renamed = <C extends Named>(c: C): C => (fromFile(c) ? { ...c, name: 'Audio' } : c);
  const slots = (list: LauncherSlot[]) => list.map((s) => (fromFile(s.clip) ? { ...s, clip: renamed(s.clip) } : s));
  const tracks = song.tracks.map((t): Track => {
    if (!t.sample && !t.slicer && !t.rack?.pads.some((p) => p.soundId) && !t.multi?.zones.length && !t.slots?.some((s) => fromFile(s.clip))) return t;
    return {
      ...t,
      ...(t.sample ? { sample: { ...t.sample, name: SOUND_NAME } } : {}),
      ...(t.slicer ? { slicer: { ...t.slicer, name: SOUND_NAME } } : {}),
      ...(t.rack ? { rack: { ...t.rack, pads: t.rack.pads.map((p, i) => (p.soundId ? { ...p, name: `Pad ${i + 1}` } : p)) } } : {}),
      ...(t.multi ? { multi: { ...t.multi, zones: t.multi.zones.map((z, i) => ({ ...z, name: `${SOUND_NAME} ${i + 1}` })) } } : {}),
      ...(t.slots ? { slots: slots(t.slots) } : {}),
    };
  });
  return { ...song, tracks, clips: song.clips.some(fromFile) ? song.clips.map(renamed) : song.clips };
}

/**
 * `data` (a song as a file has it) with each of `soundIds` (a hash of a sound file's bytes, which
 * someone with the same file could match) swapped wherever it appears for one that says nothing
 * of the file: "sound-1", "sound-2"... A receiver without the sound sees it as missing either way.
 */
export function withNeutralSoundIds<T>(data: T, soundIds: readonly string[]): T {
  if (!soundIds.length) return data;
  const to = new Map(soundIds.map((id, i) => [id, `sound-${i + 1}`]));
  return JSON.parse(JSON.stringify(data), (_key, v: unknown) => (typeof v === 'string' && to.has(v) ? to.get(v) : v)) as T;
}
