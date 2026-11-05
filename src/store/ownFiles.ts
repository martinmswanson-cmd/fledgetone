import { clipNameFromFile } from './audioClips';
import type { Clip, InstrumentKey, LauncherSlot, Track } from './timelineTypes';

/**
 * A song as it leaves the person's machine (a share link, the web runtime kit) without the names
 * of their own files and folders. Each name the app makes from a file's or a folder's name (a
 * dropped sound, a sample pack, and anything named after one of those: "X chops", "X double",
 * "X stutter"...) is marked `nameFromFile` where it's made, and the mark goes when the person
 * types a name of their own. A marked name gets a plain one: an audio clip "Audio", a clip of
 * notes "Pattern", a Drum Rack pad "Pad 1"..., a Multi Sampler zone "Sound 1"..., the Slicer's
 * sound "Sound", a track by its instrument ("Kit", "Slices", "Audio"...). The Sampler's sound is
 * always "Sound" (its name is always its file's). Songs saved before the mark existed are checked
 * against the sounds' file names instead (the nameFromFile function). A name the person typed ("Kick") is
 * kept. For a link, each sound's id (a hash of the file's bytes) is swapped for a plain one too.
 * Nothing else changes, and a song with none of these comes back as it was. No audio or store
 * here, so Node can unit-test it.
 */

/** What a sound loaded from a file is called instead of the file's name. */
export const SOUND_NAME = 'Sound';

/** The mark on a name the app made from a file's or folder's name. */
export interface FileMade {
  nameFromFile?: true;
}

/** The mark for a name made from a file or folder (`made`), or none: spread it into the item. */
export const fileMade = (made: boolean | undefined): FileMade => (made ? { nameFromFile: true } : {});

/** `item` named `name`, marked as made from a file or not (`made`): the old mark never stays by itself. */
export function withName<T extends FileMade & { name: string }>(item: T, name: string, made = false): T {
  // (In its place among the item's fields, as before, so a file or link keeps its order)
  const out: T = { ...item, name };
  if (made) out.nameFromFile = true;
  else delete out.nameFromFile;
  return out;
}

/** `item` as the person named it (`name` typed by them): kept as it is wherever the song goes. */
export const typedName = <T extends FileMade & { name: string }>(item: T, name: string): T => withName(item, name, false);

/** A track's name in place of one made from a file or folder, by what it plays. */
const TRACK_NAMES: Partial<Record<InstrumentKey, string>> = { audio: 'Audio', drumRack: 'Kit', multiSampler: 'Sounds', slicer: 'Slices', sampler: 'Sampler' };
export const neutralTrackName = (t: Pick<Track, 'instrumentKey'>): string => TRACK_NAMES[t.instrumentKey] ?? 'Track';

/** A clip's name in place of one made from a file: "Audio" for a sound, "Pattern" for notes. */
const neutralClipName = (c: { audio?: unknown }): string => (c.audio ? 'Audio' : 'Pattern');

/** A track's name as it goes into something that leaves the machine (a game kit's list of tracks). */
export const sharedTrackName = (t: Pick<Track, 'name' | 'instrumentKey'> & FileMade): string => (t.nameFromFile ? neutralTrackName(t) : t.name);

type Named = FileMade & { name: string; audio?: Clip['audio'] };

/**
 * A track's instrument plugin when the track's name was made from a file: a resample made into a
 * wavetable synth names the plugin as the track, and its table after the sound ("User table" in
 * its place, as a table with no name is called).
 */
function neutralPlugin(p: NonNullable<Track['plugin']>, trackName: string, name: string): NonNullable<Track['plugin']> {
  const state = p.state as { table?: { name?: unknown } } | undefined;
  const table = state?.table && typeof state.table === 'object' && typeof state.table.name === 'string' ? state.table : undefined;
  if (p.name !== trackName && !table) return p;
  return {
    ...p,
    ...(p.name === trackName ? { name } : {}),
    ...(table ? { state: { ...(p.state as object), table: { ...table, name: 'User table' } } } : {}),
  };
}

/**
 * Whether `name` is what the app calls a sound loaded from `file` (or a cut of it): the file name
 * itself (the Slicer, a sample pack's sounds), without its extension (a pad or a zone a sound was
 * dropped on, an audio clip), trimmed, cut to a pad's 40 or a zone's 80 characters.
 */
export function nameFromFile(name: string, file: string): boolean {
  const made = [file, file.replace(/\.[A-Za-z0-9]{1,5}$/, ''), clipNameFromFile(file)];
  return made.some((m) => [m, m.trim()].some((v) => name === v || name === v.slice(0, 40) || name === v.slice(0, 80)));
}

/** A sound the app made from another (reversed, moved, mangled, tuned, doubled, kept as the producer tag) is named after it: "X (reversed).wav" is X's. */
const EDITED = / \((?:reversed|mangled|tuned|double|tag|[+-]?\d+(?:\.\d+)? st)\)$/;
function sourceFile(file: string): string {
  let base = file.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  while (EDITED.test(base)) base = base.replace(EDITED, '');
  return base;
}

/** What the app adds to a name it makes from another: "X chops", "X flip", "X double", "X stutter", "X (bounce)", "X print", and a number after. */
const DERIVED = /^(.+?) (?:chops|flip|double|stutter|shuffle|print|\(bounce\))(?: \d+)?$/;

/** The sounds a clip played before it was edited: each is one its name may have come from. */
const clipSounds = (a: NonNullable<Clip['audio']>): string[] =>
  [a.soundId, a.reversedFrom, a.shiftedFrom, a.tunedFrom, a.mangled?.from, a.mangled?.was?.soundId].filter((id): id is string => !!id);

/**
 * `song` without its sounds' file names, or its files' and folders' names. Marked names are
 * replaced. For an unmarked one (a song saved before the mark), `fileNameOf` gives a sound's file
 * name when it's known: a pad, zone, Slicer sound or audio clip still named after its file (or
 * the file its sound was edited from) is renamed, and so is a name made from one of those ("X
 * chops", "X stutter"...).
 */
export function withoutFileNames<T extends { tracks: Track[]; clips: Clip[] }>(song: T, fileNameOf: (soundId: string) => string | undefined = () => undefined): T {
  const fileOf = (id: string | undefined) => (id === undefined ? undefined : fileNameOf(id));
  const madeFrom = (name: string, soundId: string | undefined) => {
    const file = fileOf(soundId);
    // (A recorded producer tag is the app's "Producer tag", kept as "Producer tag (tag).wav")
    return file !== undefined && (nameFromFile(name, file) || (name !== 'Producer tag' && nameFromFile(name, sourceFile(file))));
  };
  // Every file name the song's sounds have, for a name made from one ("X chops")
  const files = new Set<string>();
  const addFile = (id: string | undefined) => {
    const file = fileOf(id);
    if (file !== undefined) files.add(file);
  };
  for (const t of song.tracks) {
    addFile(t.slicer?.soundId);
    t.rack?.pads.forEach((p) => addFile(p.soundId));
    t.multi?.zones.forEach((z) => addFile(z.soundId));
    t.slots?.forEach((s) => s.clip.audio && clipSounds(s.clip.audio).forEach(addFile));
  }
  for (const c of song.clips) if (c.audio) clipSounds(c.audio).forEach(addFile);
  const fromAnyFile = (name: string, depth = 0): boolean => {
    if ([...files].some((f) => nameFromFile(name, f) || (name !== 'Producer tag' && nameFromFile(name, sourceFile(f))))) return true;
    const m = depth < 4 ? DERIVED.exec(name) : null;
    return !!m && fromAnyFile(m[1], depth + 1);
  };
  const derived = (name: string) => files.size > 0 && DERIVED.test(name) && fromAnyFile(name);

  const clipFromFile = (c: Named) => !!c.nameFromFile || (!!c.audio && clipSounds(c.audio).some((id) => madeFrom(c.name, id))) || derived(c.name);
  const renamed = <C extends Named>(c: C): C => (clipFromFile(c) ? withName(c, neutralClipName(c)) : c);
  const slots = (list: LauncherSlot[]) => list.map((s) => (clipFromFile(s.clip) ? { ...s, clip: renamed(s.clip) } : s));
  const own = (x: FileMade & { name: string; soundId?: string }) => !!x.nameFromFile || madeFrom(x.name, x.soundId);
  const tracks = song.tracks.map((t): Track => {
    const name = !!t.nameFromFile || derived(t.name);
    const slicer = !!t.slicer && own(t.slicer);
    const pads = !!t.rack?.pads.some(own);
    const zones = !!t.multi?.zones.some(own);
    if (!name && !t.sample && !slicer && !pads && !zones && !t.slots?.some((s) => clipFromFile(s.clip))) return t;
    return {
      ...(name ? withName(t, neutralTrackName(t)) : t),
      ...(name && t.plugin ? { plugin: neutralPlugin(t.plugin, t.name, neutralTrackName(t)) } : {}),
      ...(t.sample ? { sample: { ...t.sample, name: SOUND_NAME } } : {}),
      ...(slicer ? { slicer: withName(t.slicer!, SOUND_NAME) } : {}),
      ...(pads ? { rack: { ...t.rack!, pads: t.rack!.pads.map((p, i) => (own(p) ? withName(p, `Pad ${i + 1}`) : p)) } } : {}),
      ...(zones ? { multi: { ...t.multi!, zones: t.multi!.zones.map((z, i) => (own(z) ? withName(z, `${SOUND_NAME} ${i + 1}`) : z)) } } : {}),
      ...(t.slots ? { slots: slots(t.slots) } : {}),
    };
  });
  return { ...song, tracks, clips: song.clips.some(clipFromFile) ? song.clips.map(renamed) : song.clips };
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
