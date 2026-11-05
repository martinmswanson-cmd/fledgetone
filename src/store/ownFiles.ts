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
 * always "Sound" (its name is always its file's). A song saved since the mark carries `fileMarks`
 * and is judged by its marks alone. Songs saved before it are checked against the sounds' file
 * names and the app's folder names instead (the nameFromFile function), and get their marks and
 * `fileMarks` once every sound's file name is known (withFileMarks). A name the person typed
 * ("Kick") is kept. For a link, each sound's id (a hash of the file's bytes) is swapped for a plain one too.
 * Nothing else changes, and a song with none of these comes back as it was. No audio or store
 * here, so Node can unit-test it.
 */

/** What a sound loaded from a file is called instead of the file's name. */
export const SOUND_NAME = 'Sound';

/** The mark on a name the app made from a file's or folder's name. */
export interface FileMade {
  nameFromFile?: true;
}

/**
 * What a song saved since every name made from a file is marked says (a project's `fileMarks`):
 * its marks alone tell which names go. A song without it is from before, and is checked against
 * its sounds' file names and the app's folder names too.
 */
export const FILE_MARKS = 1;

/**
 * A sound's file name where it's known, or every name it's known by: the same bytes can come under
 * two (a song's file carries the name they had where it was made, this browser's library the one
 * they were loaded here as).
 */
export type FileNameOf = (soundId: string) => string | readonly string[] | undefined;

/** Every file name `fileNameOf` knows for the sound `id` (none when it knows none). */
export function fileNamesOf(fileNameOf: FileNameOf, id: string): string[] {
  const names = fileNameOf(id);
  return names === undefined ? [] : typeof names === 'string' ? [names] : [...names];
}

/**
 * Each sound's file names as a song going out knows them: `known`'s (the sound library's) and the
 * song's own embedded sounds' (a saved file carries them), every one of them, so a name made from
 * any is found. The one way opening a song, a share link, the web runtime kit and the game kit ask.
 */
export function songFileNames(sounds: ReadonlyArray<{ id: string; name: string }> | undefined, known?: FileNameOf): FileNameOf {
  const embedded = new Map<string, string[]>();
  for (const s of sounds ?? []) embedded.set(s.id, [...(embedded.get(s.id) ?? []), s.name]);
  return (id) => {
    const names = [...new Set([...(known ? fileNamesOf(known, id) : []), ...(embedded.get(id) ?? [])])];
    return names.length ? names : undefined;
  };
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
/** The app's own name for a recording from the mic (the studio's, Pocket's): not a file of the person's. */
const MIC_TAKE = /^(?:Mic|Vocal) take \d+\.wav$/;

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

/** Every sound a song's names may have come from: the Slicer's, the pads', the zones', the audio clips' (and the sounds they were edited from). */
function namingSounds(song: { tracks: Track[]; clips: Clip[] }): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => id !== undefined && ids.add(id);
  for (const t of song.tracks) {
    add(t.slicer?.soundId);
    t.rack?.pads.forEach((p) => add(p.soundId));
    t.multi?.zones.forEach((z) => add(z.soundId));
    t.slots?.forEach((s) => s.clip.audio && clipSounds(s.clip.audio).forEach(add));
  }
  for (const c of song.clips) if (c.audio) clipSounds(c.audio).forEach(add);
  return [...ids];
}

/**
 * `song` without its sounds' file names, or its files' and folders' names. Marked names are
 * replaced (a track's, a clip's, a pad's or zone's, a plugin's and its user table's, on every
 * track). A song with `fileMarks` is judged by those marks alone. For an unmarked one (a song
 * saved before the mark), `fileNameOf` gives a sound's file
 * name when it's known: a pad, zone, Slicer sound or audio clip still named after its file (or
 * the file its sound was edited from) is renamed, and so is a name made from one of those or
 * from a marked name ("X chops", "X stutter", "X 1 (variation)", "X harmony", "X (reversed)",
 * "X lead"...). A Drum Rack, Multi Sampler or Audio track named as the app names a folder's ("X
 * kit", "X one-shots", "X loops", or one whose sounds are all named after their files) is taken
 * for one, unless it's a name people type ("Drums", "My kit").
 */
export function withoutFileNames<T extends { tracks: Track[]; clips: Clip[]; fileMarks?: number }>(song: T, fileNameOf: FileNameOf = () => undefined): T {
  // (A song saved since the marks: its names are judged by them alone)
  const old = !song.fileMarks;
  // (Every name a sound's file is known by: a name made from any of them is one)
  const filesOf = (id: string | undefined) => (id === undefined || !old ? [] : fileNamesOf(fileNameOf, id));
  const madeFrom = (name: string, soundId: string | undefined) =>
    // (A recorded producer tag is the app's "Producer tag", kept as "Producer tag (tag).wav")
    filesOf(soundId).some((file) => nameFromFile(name, file) || (name !== 'Producer tag' && nameFromFile(name, sourceFile(file))));
  // Every file name the song's sounds have, for a name made from one ("X chops")
  const files = new Set<string>();
  for (const id of namingSounds(song)) filesOf(id).forEach((file) => files.add(file));
  // (In a song with the marks too, a name left unmarked that is just its own sound's file name: one
  // brought in from somewhere unmarked that slipped through, see soundWithFileMarks and withOldMarks)
  const sameAsFile = (name: string, soundId: string | undefined) => soundId !== undefined && fileNamesOf(fileNameOf, soundId).some((file) => nameFromFile(name, file));
  const own = (x: FileMade & { name: string; soundId?: string }) => !!x.nameFromFile || madeFrom(x.name, x.soundId) || sameAsFile(x.name, x.soundId);

  // A song from before the mark: a Drum Rack, Multi Sampler or Audio track the app named after a
  // folder ("X kit", "X one-shots", "X loops", or a set of sounds all named after their files),
  // unless it's a name people type ("Drums", "My kit"). A track whose sounds or clips carry a mark
  // was made since: its name has none because the person typed it. A kit named so needs sounds
  // from files on its pads, and a set of loops clips from files (not only takes from the mic).
  const markedClips = new Set(song.clips.filter((c) => c.nameFromFile).map((c) => c.trackId));
  const sinceMark = (t: Track) =>
    markedClips.has(t.id) || !!t.rack?.pads.some((p) => p.nameFromFile) || !!t.multi?.zones.some((z) => z.nameFromFile) || !!t.slots?.some((x) => x.clip.nameFromFile);
  // (A sound known by another name too, or by none, may be a file's)
  const fromAFile = (a: Clip['audio']) => {
    const names = a ? filesOf(a.soundId) : [];
    return !!a && (!names.length || names.some((n) => !MIC_TAKE.test(n)));
  };
  const fromFolder = (t: Track): boolean => {
    if (!old || t.nameFromFile || peopleType(t.name) || sinceMark(t)) return false;
    if (t.instrumentKey === 'drumRack') {
      const sounds = t.rack?.pads.filter((p) => p.soundId) ?? [];
      if (!sounds.length) return false;
      const m = FOLDER_KIT.exec(t.name);
      return (!!m && !peopleType(m[1])) || sounds.every(own);
    }
    if (t.instrumentKey === 'multiSampler') return !!t.multi?.zones.length && t.multi.zones.every(own);
    if (t.instrumentKey === 'audio') {
      const m = FOLDER_LOOPS.exec(t.name);
      return !!m && !peopleType(m[1]) && (song.clips.some((c) => c.trackId === t.id && fromAFile(c.audio)) || !!t.slots?.some((s) => fromAFile(s.clip.audio)));
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
  // (A song from before the marks: a name that is one of its sounds' file names, or the file a sound was made from)
  const namedAfterFile = (name: string) => [...files].some((f) => nameFromFile(name, f) || (name !== 'Producer tag' && nameFromFile(name, sourceFile(f))));
  const isMade = (name: string): boolean =>
    made.has(name) ||
    namedAfterFile(name) ||
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

  const clipFromFile = (c: Named) => !!c.nameFromFile || (!!c.audio && clipSounds(c.audio).some((id) => madeFrom(c.name, id) || sameAsFile(c.name, id))) || derived(c.name);
  const renamed = <C extends Named>(c: C): C => (clipFromFile(c) ? withName(c, neutralClipName(c)) : c);
  const slots = (list: LauncherSlot[]) => list.map((s) => (clipFromFile(s.clip) ? { ...s, clip: renamed(s.clip) } : s));
  // A plugin named as its track (renamed with it), or marked, or made from a file's name; its table
  const pluginOut = (p: Plugin, trackName: string, trackGoes: boolean, name: string): Plugin => {
    const table = tableOf(p);
    const goes = !!p.nameFromFile || (trackGoes && p.name === trackName) || pluginNamed(p.name);
    return neutralPlugin(p, goes, name, !!table && (!!table.nameFromFile || trackGoes || pluginNamed(table.name)));
  };
  const tracks = song.tracks.map((t): Track => {
    // (a track named after a file dropped on it, in a song from before the marks, too)
    const name = !!t.nameFromFile || folderTracks.has(t) || derived(t.name) || namedAfterFile(t.name);
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
 * Each track's name as a list of tracks that leaves the machine has it (the game kit's manifest,
 * an engine package's): as withoutFileNames names it, with the sounds' file names (`fileNameOf`,
 * as a share link asks) for a song from before the marks.
 */
export function sharedTrackNames(song: { tracks: Track[]; clips: Clip[]; fileMarks?: number }, fileNameOf: FileNameOf): (t: Track) => string {
  const names = new Map(withoutFileNames({ tracks: song.tracks, clips: song.clips, fileMarks: song.fileMarks }, fileNameOf).tracks.map((t) => [t.id, t.name]));
  return (t) => names.get(t.id) ?? sharedTrackName(t);
}

/**
 * `song` with a mark on each name withoutFileNames (the old-song check, with the file names
 * `fileNameOf` knows) would replace: the names stay as they are, now marked. With some file names
 * unknown it marks what it can find, which only ever hides more. A song with the marks comes back
 * as it was. For what comes into a song from one without the marks (clips copied from it).
 */
export function withOldMarks<T extends { tracks: Track[]; clips: Clip[]; fileMarks?: number }>(song: T, fileNameOf: FileNameOf): T {
  if (song.fileMarks) return song;
  const out = withoutFileNames(song, fileNameOf);
  const mark = <X extends FileMade & { name: string }>(was: X, now: { name: string } | undefined): X => (now && now.name !== was.name && !was.nameFromFile ? { ...was, nameFromFile: true } : was);
  const markPlugin = (p: Plugin, now: Plugin | undefined): Plugin => {
    const marked = mark(p, now);
    const table = tableOf(p);
    const newTable = now && tableOf(now);
    return table && newTable && newTable.name !== table.name && !table.nameFromFile ? { ...marked, state: { ...(p.state as object), table: { ...table, nameFromFile: true } } } : marked;
  };
  const tracks = song.tracks.map((t, i): Track => {
    const o = out.tracks[i];
    if (o === t) return t;
    return {
      ...mark(t, o),
      ...(t.plugin ? { plugin: markPlugin(t.plugin, o.plugin) } : {}),
      ...(t.pluginFx ? { pluginFx: t.pluginFx.map((p, j) => markPlugin(p, o.pluginFx?.[j])) } : {}),
      ...(t.slicer ? { slicer: mark(t.slicer, o.slicer) } : {}),
      ...(t.rack ? { rack: { ...t.rack, pads: t.rack.pads.map((p, j) => mark(p, o.rack?.pads[j])) } } : {}),
      ...(t.multi ? { multi: { ...t.multi, zones: t.multi.zones.map((z, j) => mark(z, o.multi?.zones[j])) } } : {}),
      ...(t.slots ? { slots: t.slots.map((s, j) => ({ ...s, clip: mark(s.clip, o.slots?.[j]?.clip) })) } : {}),
    };
  });
  const clips = out.clips === song.clips ? song.clips : song.clips.map((c, i) => mark(c, out.clips[i]));
  return { ...song, tracks, clips };
}

/**
 * `song` (saved before the marks, without `fileMarks`) with every name made from a file or folder
 * marked, as the old-song check above finds them, and `fileMarks` set: from then on its marks
 * alone say which names go, and a name the person types after ("My drum kit") is theirs. Only
 * when every sound's file name is known (`fileNameOf`, or the song's embedded sounds): until
 * then it's left as it is, still an old song, still checked the old way. A song with the marks
 * already, or none to check, comes back as it was (or with `fileMarks`).
 */
export function withFileMarks<T extends { tracks: Track[]; clips: Clip[]; fileMarks?: number; sounds?: ReadonlyArray<{ id: string; name: string }> }>(song: T, fileNameOf?: FileNameOf): T {
  if (song.fileMarks) return song;
  const nameOf = songFileNames(song.sounds, fileNameOf);
  if (namingSounds(song).some((id) => !fileNamesOf(nameOf, id).length)) return song;
  return { ...withOldMarks(song, nameOf), fileMarks: FILE_MARKS };
}

/** A saved sound (My sounds, a sound file) as soundWithFileMarks reads it. */
export interface MarkedSound<S> extends FileMade {
  name: string;
  /** FILE_MARKS on a sound saved from a song with the marks: its own name's mark is to be trusted */
  fileMarks?: number;
  settings: S;
}

/**
 * A saved sound (My sounds, a sound file) with a mark on each name made from a file or folder, for
 * putting on a track: one saved before the marks has none, and one saved from a song without them
 * may lack some. Its pads', zones', Slicer sound's and plugins' names are checked as an old song's
 * are, against the sounds' file names (`fileNameOf`); a name the check finds is marked, one it
 * can't (a file name unknown) is left. Its own name (the track's when it goes on one) keeps its
 * mark, and one saved without `fileMarks` is checked as an old song's track name too ("X kit").
 */
export function soundWithFileMarks<S extends object, T extends MarkedSound<S>>(sound: T, fileNameOf: FileNameOf = () => undefined): T {
  const track = { ...sound.settings, id: 'sound', name: sound.name, ...fileMade(sound.nameFromFile) } as unknown as Track;
  const [marked] = withOldMarks({ tracks: [track], clips: [] }, fileNameOf).tracks;
  if (marked === track) return sound;
  const settings = Object.fromEntries(Object.keys(sound.settings).map((k) => [k, (marked as unknown as Record<string, unknown>)[k]])) as S;
  const named = !!sound.nameFromFile || (!sound.fileMarks && !!marked.nameFromFile);
  const out: T = { ...sound, settings };
  if (named) out.nameFromFile = true;
  return out;
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
