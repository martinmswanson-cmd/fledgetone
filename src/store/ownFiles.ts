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
type Plugin = NonNullable<Track['plugin']>;

/** What a wavetable synth's user table is called in place of a name made from a file's (as a table with no name is). */
export const TABLE_NAME = 'User table';

/** A plugin's user table (Fledge Synth's, a sound made into a wavetable), if it has one with a name. */
function tableOf(p: Plugin): (FileMade & { name: string }) | undefined {
  const state = p.state as { table?: { name?: unknown } } | undefined;
  return state?.table && typeof state.table === 'object' && typeof state.table.name === 'string' ? (state.table as FileMade & { name: string }) : undefined;
}

/**
 * A plugin with a plain name in place of its own (`name`, when `renamed`), and "User table" for its
 * table's (when `table`). A resample made into a wavetable synth names the plugin as the track,
 * and its table after the sound; a table made from a clip in the synth is named after the clip.
 */
function neutralPlugin(p: Plugin, renamed: boolean, name: string, table: boolean): Plugin {
  if (!renamed && !table) return p;
  const t = tableOf(p);
  return {
    ...(renamed ? withName(p, name) : p),
    ...(table && t ? { state: { ...(p.state as object), table: withName(t, TABLE_NAME) } } : {}),
  };
}

/** What the app adds to the name of a folder's tracks (a sample pack's): "X kit", "X one-shots 2", "X loops". */
const FOLDER_KIT = /^(.+?) (?:kit|one-shots)(?: \d+)?$/i;
const FOLDER_LOOPS = /^(.+?) loops$/i;
/**
 * Names people type for a kit or a set of sounds ("Drums", "My kit", "808 kit", "Vocal loops"...),
 * and the app's own ("Drum Rack", "Bounces", "Sample pack kit"): never taken for a folder's name.
 */
const TYPED = new Set(
  [
    'my', 'the', 'a', 'new', 'old', 'main', 'basic', 'default', 'extra', 'other', 'second', 'third', 'more', 'own', 'your', 'our',
    'drum', 'drums', 'kit', 'kits', 'perc', 'percussion', 'beat', 'beats', 'groove', 'loop', 'loops', 'one-shots', 'one shots', 'pads', 'sounds', 'samples', 'sample', 'chops',
    'vocal', 'vocals', 'vox', 'voice', 'guitar', 'guitars', 'bass', 'piano', 'keys', 'synth', 'synths', 'strings', 'brass', 'horns', 'fx', 'sfx', 'foley', 'ambience',
    '808', '909', '707', 'trap', 'rock', 'pop', 'jazz', 'funk', 'soul', 'house', 'techno', 'lofi', 'lo-fi', 'hip hop', 'hip-hop', 'boom bap', 'drill', 'dnb', 'garage', 'dubstep', 'reggae', 'latin', 'ambient', 'acoustic', 'electronic', 'live',
    'drum rack', 'multi sampler', 'sample pack', 'bounces', 'your pads', 'instrument', 'sampler',
  ].map((w) => w.toLowerCase())
);
const peopleType = (name: string) => TYPED.has(name.replace(/ \d+$/, '').trim().toLowerCase());

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

/**
 * What the app adds to a name it makes from another: "X chops", "X flip", "X double", "X stutter",
 * "X print", "X harmony", "X variation", "X lead" (a wavetable synth), "X (bounce)", "X (reversed)",
 * "X (answer phrase)" and any other "X (...)", and a number after.
 */
const DERIVED = /^(.+?) (?:chops|flip|double|stutter|shuffle|print|harmony|variation|lead|bass|pad|\([^()]*\))(?: \d+)?$/;
/** A clip named after its track, numbered ("X 3"), or a name made from another numbered */
const NUMBERED = /^(.+) \d+$/;
/** A name the app cut to fit: a resample's (32), a pad's or a track's (40), a table's (60) */
const CUTS = [32, 40, 60];

/** The sounds a clip played before it was edited: each is one its name may have come from. */
const clipSounds = (a: NonNullable<Clip['audio']>): string[] =>
  [a.soundId, a.reversedFrom, a.shiftedFrom, a.tunedFrom, a.mangled?.from, a.mangled?.was?.soundId].filter((id): id is string => !!id);

/**
 * `song` without its sounds' file names, or its files' and folders' names. Marked names are
 * replaced (a track's, a clip's, a pad's or zone's, a plugin's and its user table's, on every
 * track). For an unmarked one (a song saved before the mark), `fileNameOf` gives a sound's file
 * name when it's known: a pad, zone, Slicer sound or audio clip still named after its file (or
 * the file its sound was edited from) is renamed, and so is a name made from one of those or
 * from a marked name ("X chops", "X stutter", "X 1 (variation)", "X harmony", "X (reversed)",
 * "X lead"...). A Drum Rack, Multi Sampler or Audio track named as the app names a folder's ("X
 * kit", "X one-shots", "X loops", or one whose sounds are all named after their files) is taken
 * for one, unless it's a name people type ("Drums", "My kit").
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
  const own = (x: FileMade & { name: string; soundId?: string }) => !!x.nameFromFile || madeFrom(x.name, x.soundId);

  // A song from before the mark: a Drum Rack, Multi Sampler or Audio track the app named after a
  // folder ("X kit", "X one-shots", "X loops", or a set of sounds all named after their files),
  // unless it's a name people type ("Drums", "My kit"). A track whose sounds or clips carry a mark
  // was made since: its name has none because the person typed it.
  const markedClips = new Set(song.clips.filter((c) => c.nameFromFile).map((c) => c.trackId));
  const sinceMark = (t: Track) =>
    markedClips.has(t.id) || !!t.rack?.pads.some((p) => p.nameFromFile) || !!t.multi?.zones.some((z) => z.nameFromFile) || !!t.slots?.some((x) => x.clip.nameFromFile);
  const fromFolder = (t: Track): boolean => {
    if (t.nameFromFile || peopleType(t.name) || sinceMark(t)) return false;
    if (t.instrumentKey === 'drumRack') {
      const m = FOLDER_KIT.exec(t.name);
      if (m && !peopleType(m[1])) return true;
      const sounds = t.rack?.pads.filter((p) => p.soundId) ?? [];
      return sounds.length > 0 && sounds.every(own);
    }
    if (t.instrumentKey === 'multiSampler') return !!t.multi?.zones.length && t.multi.zones.every(own);
    if (t.instrumentKey === 'audio') {
      const m = FOLDER_LOOPS.exec(t.name);
      return !!m && !peopleType(m[1]);
    }
    return false;
  };
  const folderTracks = new Set(song.tracks.filter(fromFolder));

  // Every name the song has that was made from a file or folder: one made from it is too ("X 1 (variation)")
  const made = new Set<string>();
  const addMade = (x: FileMade & { name: string }) => x.nameFromFile && made.add(x.name);
  for (const t of song.tracks) {
    if (t.nameFromFile || folderTracks.has(t)) made.add(t.name);
    if (t.slicer) addMade(t.slicer);
    t.rack?.pads.forEach(addMade);
    t.multi?.zones.forEach(addMade);
    t.slots?.forEach((s) => addMade(s.clip));
    for (const p of [t.plugin, ...(t.pluginFx ?? [])]) {
      if (!p) continue;
      addMade(p);
      const table = tableOf(p);
      if (table) addMade(table);
    }
  }
  song.clips.forEach(addMade);
  const isMade = (name: string): boolean =>
    made.has(name) ||
    [...files].some((f) => nameFromFile(name, f) || (name !== 'Producer tag' && nameFromFile(name, sourceFile(f)))) ||
    (CUTS.includes(name.length) && [...made, ...[...files].map(sourceFile)].some((m) => m.length > name.length && m.startsWith(name)));
  const fromAny = (name: string, depth = 0): boolean => {
    if (isMade(name)) return true;
    if (depth >= 6) return false;
    const base = DERIVED.exec(name)?.[1] ?? NUMBERED.exec(name)?.[1];
    return base !== undefined && fromAny(base, depth + 1);
  };
  const some = files.size > 0 || made.size > 0;
  const derived = (name: string) => some && (DERIVED.test(name) || NUMBERED.test(name)) && fromAny(name);
  // A plugin's or table's name is checked as it is too: a table made from a clip has the clip's name
  const pluginNamed = (name: string) => some && fromAny(name);

  const clipFromFile = (c: Named) => !!c.nameFromFile || (!!c.audio && clipSounds(c.audio).some((id) => madeFrom(c.name, id))) || derived(c.name);
  const renamed = <C extends Named>(c: C): C => (clipFromFile(c) ? withName(c, neutralClipName(c)) : c);
  const slots = (list: LauncherSlot[]) => list.map((s) => (clipFromFile(s.clip) ? { ...s, clip: renamed(s.clip) } : s));
  // A plugin named as its track (renamed with it), or marked, or made from a file's name; its table
  const pluginOut = (p: Plugin, trackName: string, trackGoes: boolean, name: string): Plugin => {
    const table = tableOf(p);
    const goes = !!p.nameFromFile || (trackGoes && p.name === trackName) || pluginNamed(p.name);
    return neutralPlugin(p, goes, name, !!table && (!!table.nameFromFile || trackGoes || pluginNamed(table.name)));
  };
  const tracks = song.tracks.map((t): Track => {
    const name = !!t.nameFromFile || folderTracks.has(t) || derived(t.name);
    const slicer = !!t.slicer && own(t.slicer);
    const pads = !!t.rack?.pads.some(own);
    const zones = !!t.multi?.zones.some(own);
    const plugin = t.plugin && pluginOut(t.plugin, t.name, name, neutralTrackName(t));
    const pluginFx = t.pluginFx?.map((p) => pluginOut(p, t.name, false, 'Plugin'));
    const plugins = plugin !== t.plugin || !!pluginFx?.some((p, i) => p !== t.pluginFx![i]);
    if (!name && !t.sample && !slicer && !pads && !zones && !plugins && !t.slots?.some((s) => clipFromFile(s.clip))) return t;
    return {
      ...(name ? withName(t, neutralTrackName(t)) : t),
      ...(plugin !== t.plugin ? { plugin } : {}),
      ...(pluginFx && plugins ? { pluginFx } : {}),
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
