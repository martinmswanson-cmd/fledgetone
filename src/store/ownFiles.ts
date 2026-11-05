import { clipNameFromFile } from './audioClips';
import type { Clip, LauncherSlot, Track } from './timelineTypes';

/**
 * A song as it leaves the person's machine (a share link, the web runtime kit) without the names
 * of their own files. A name the app made from a sound's file name gets a plain one: the
 * Sampler's sound is "Sound" (its name is always its file's), the Slicer's is "Sound", a Drum
 * Rack pad "Pad 1"..., a Multi Sampler zone "Sound 1"..., an audio clip "Audio". A name the
 * person typed ("Kick") is kept. For a link, each sound's id (a hash of the file's bytes) is
 * swapped for a plain one too. Nothing else changes, and a song with none of these comes back
 * as it was. No audio or store here, so Node can unit-test it.
 */

/** What a sound loaded from a file is called instead of the file's name. */
export const SOUND_NAME = 'Sound';

type Named = { name: string; audio?: { soundId: string } };

/**
 * Whether `name` is what the app calls a sound loaded from `file` (or a cut of it): the file name
 * itself (the Slicer, a sample pack's sounds), without its extension (a pad or a zone a sound was
 * dropped on, an audio clip), trimmed, cut to a pad's 40 or a zone's 80 characters.
 */
export function nameFromFile(name: string, file: string): boolean {
  const made = [file, file.replace(/\.[A-Za-z0-9]{1,5}$/, ''), clipNameFromFile(file)];
  return made.some((m) => [m, m.trim()].some((v) => name === v || name === v.slice(0, 40) || name === v.slice(0, 80)));
}

/**
 * `song` without its sounds' file names. `fileNameOf` gives a sound's file name, when it's known:
 * a pad, zone, Slicer sound or audio clip is renamed only when its name was made from it.
 */
export function withoutFileNames<T extends { tracks: Track[]; clips: Clip[] }>(song: T, fileNameOf: (soundId: string) => string | undefined = () => undefined): T {
  const madeFrom = (name: string, soundId: string | undefined) => {
    const file = soundId === undefined ? undefined : fileNameOf(soundId);
    return file !== undefined && nameFromFile(name, file);
  };
  const fromFile = (c: Named) => !!c.audio && madeFrom(c.name, c.audio.soundId);
  const renamed = <C extends Named>(c: C): C => (fromFile(c) ? { ...c, name: 'Audio' } : c);
  const slots = (list: LauncherSlot[]) => list.map((s) => (fromFile(s.clip) ? { ...s, clip: renamed(s.clip) } : s));
  const tracks = song.tracks.map((t): Track => {
    const slicer = !!t.slicer && madeFrom(t.slicer.name, t.slicer.soundId);
    const pads = !!t.rack?.pads.some((p) => madeFrom(p.name, p.soundId));
    const zones = !!t.multi?.zones.some((z) => madeFrom(z.name, z.soundId));
    if (!t.sample && !slicer && !pads && !zones && !t.slots?.some((s) => fromFile(s.clip))) return t;
    return {
      ...t,
      ...(t.sample ? { sample: { ...t.sample, name: SOUND_NAME } } : {}),
      ...(slicer ? { slicer: { ...t.slicer!, name: SOUND_NAME } } : {}),
      ...(pads ? { rack: { ...t.rack!, pads: t.rack!.pads.map((p, i) => (madeFrom(p.name, p.soundId) ? { ...p, name: `Pad ${i + 1}` } : p)) } } : {}),
      ...(zones ? { multi: { ...t.multi!, zones: t.multi!.zones.map((z, i) => (madeFrom(z.name, z.soundId) ? { ...z, name: `${SOUND_NAME} ${i + 1}` } : z)) } } : {}),
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
