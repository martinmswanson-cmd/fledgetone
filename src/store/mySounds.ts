/**
 * The player's own picks, kept in this browser for every project: favourite instruments (starred
 * in the instrument lists, listed first) and "my sounds" (a track's whole sound saved under a
 * name: its instrument with its settings, synth patch, 808 or drum design, plugin and its knobs,
 * inserts, EQ, sends, ring...). Picking a saved sound puts all of that on a track at once, so a
 * sound set up once never has to be set up again. The level and pan stay the track's own (they're
 * the mix, not the sound). Sampled sounds (Sampler, Slicer, Drum Rack, Multi Sampler) keep their
 * recordings in the sound library; freeing unused sounds leaves those be (see mySoundIds).
 */
import { create } from 'zustand';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { currentInstrumentKey, INSTRUMENTS, isAudioKind } from '../audio/instrumentCatalog';
import { parseEmbeddedSounds, referencedSoundIds } from './audioClips';
import { isMixTrack } from './buses';
import { parseTrack } from './project';
import { withSafeIds } from './ownKey';
import type { EmbeddedSound, Track, WamPlugin } from './timelineTypes';
import { uid } from './timelineTypes';

export const FAVOURITE_INSTRUMENTS_KEY = 'fledgetone.favouriteInstruments';
export const MY_SOUNDS_KEY = 'fledgetone.mySounds';
/** A sound bigger than this (a plugin with a huge state) isn't kept: browser storage is small */
const MAX_SOUND_CHARS = 1_500_000;
/** The most saved sounds kept: past it, a new one waits until one is deleted (none is let go on its own). */
export const MAX_SOUNDS = 200;

/** The parts of a track that make its sound. */
const SOUND_FIELDS = [
  'instrumentKey',
  'color',
  'eq',
  'fx',
  'distance',
  'reverbSend',
  'delaySend',
  'sample',
  'slicer',
  'synth',
  'rack',
  'multi',
  'drumDesign',
  'expressive',
  'plugin',
  'pluginFx',
  'bass808',
  'glide',
  'ring',
  'breathe',
  'subLayer',
] as const satisfies ReadonlyArray<keyof Track>;

export type SoundSettings = Pick<Track, 'instrumentKey' | 'color' | 'eq' | 'fx' | 'reverbSend' | 'delaySend'> &
  Partial<Pick<Track, (typeof SOUND_FIELDS)[number]>>;

export interface MySound {
  id: string;
  name: string;
  settings: SoundSettings;
}

/** A track's sound, without its notes, mix level, routing or anything else that's the song's. */
export function soundOf(track: Track): SoundSettings {
  const out: Record<string, unknown> = {};
  for (const f of SOUND_FIELDS) if (track[f] !== undefined) out[f] = structuredClone(track[f]);
  return out as SoundSettings;
}

/**
 * `track` playing a saved sound: its sound fields replaced (ones the sound doesn't have are
 * cleared), its plugins given new ids (each is a new plugin, built from its saved knobs).
 */
export function withSound(track: Track, settings: SoundSettings): Track {
  const next: Record<string, unknown> = { ...track };
  for (const f of SOUND_FIELDS) delete next[f];
  const fresh = (p: WamPlugin): WamPlugin => ({ ...structuredClone(p), id: uid('plugin') });
  const copy = structuredClone(settings);
  return {
    ...(next as unknown as Track),
    ...copy,
    ...(copy.plugin ? { plugin: fresh(copy.plugin) } : {}),
    ...(copy.pluginFx ? { pluginFx: copy.pluginFx.map(fresh) } : {}),
  };
}

/** A stored sound read back, checked as a track's fields are when a project opens; null if unreadable. */
export function parseSound(raw: unknown): MySound | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, settings } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) return null;
  try {
    if (typeof settings !== 'object' || settings === null) return null;
    // (no id inside a lookup could mistake for one of every object's own names, as a project's)
    withSafeIds(settings);
    const track = parseTrack({ ...settings, id: 'sound', name });
    // Instruments only: a bus, a return or an Audio track has no sound of its own to keep
    if (isMixTrack(track) || isAudioKind(track.instrumentKey)) return null;
    if (track.instrumentKey === 'plugin' && !track.plugin) return null;
    return { id, name: name.slice(0, 60), settings: soundOf(track) };
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** False when the browser wouldn't keep it (full, or blocked in a private window). */
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readFavourites(): InstrumentKey[] {
  const raw = readJson(FAVOURITE_INSTRUMENTS_KEY);
  return Array.isArray(raw) ? [...new Set(raw.map(currentInstrumentKey).filter((k): k is InstrumentKey => typeof k === 'string' && Object.hasOwn(INSTRUMENTS, k)))] : [];
}

function readSounds(): MySound[] {
  const raw = readJson(MY_SOUNDS_KEY);
  return Array.isArray(raw) ? raw.map(parseSound).filter((s): s is MySound => !!s) : [];
}

/** 'full': My sounds already holds MAX_SOUNDS (nothing was saved). */
export type SaveResult = 'saved' | 'replaced' | 'too-big' | 'not-kept' | 'full';

/** What a My sounds file holds (mySoundsFile.ts saves and opens it). */
export const MY_SOUNDS_FORMAT = 'fledgetone-my-sounds';

export interface MySoundsFile {
  format: typeof MY_SOUNDS_FORMAT;
  version: 1;
  favourites: InstrumentKey[];
  sounds: MySound[];
  /** The recordings the sounds play (a Sampler's, a Drum Rack's...), as a project file carries them */
  recordings: EmbeddedSound[];
}

/** A My sounds file's contents, checked as the browser's own are; throws if it isn't one. */
export function parseMySoundsFile(raw: unknown): Omit<MySoundsFile, 'format' | 'version'> {
  const v = raw as Partial<MySoundsFile> | null;
  if (typeof v !== 'object' || v === null || v.format !== MY_SOUNDS_FORMAT) throw new Error('it is not a My sounds file');
  // (the sounds and the recordings they play renamed alike, so they still find each other)
  withSafeIds(v);
  return {
    favourites: Array.isArray(v.favourites) ? [...new Set(v.favourites.map(currentInstrumentKey).filter((k): k is InstrumentKey => typeof k === 'string' && Object.hasOwn(INSTRUMENTS, k)))] : [],
    sounds: Array.isArray(v.sounds) ? v.sounds.map(parseSound).filter((x): x is MySound => !!x) : [],
    recordings: parseEmbeddedSounds(v.recordings),
  };
}

/**
 * One sound as a file of its own, to send to someone or keep (a My sounds file holding just it,
 * with no stars): it opens wherever a My sounds file does.
 */
export function soundFile(sound: MySound, recordings: EmbeddedSound[]): MySoundsFile {
  return { format: MY_SOUNDS_FORMAT, version: 1, favourites: [], sounds: [sound], recordings };
}

/** A sound file's name: the sound's, with only the characters every system takes ("Wobble bass.fledgetone-sound.json"). */
export function soundFileName(name: string): string {
  const plain = [...name].map((c) => (c < ' ' || '\\/:*?"<>|'.includes(c) ? ' ' : c)).join('');
  const safe = plain.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60).trim();
  return `${safe || 'sound'}.fledgetone-sound.json`;
}

/** The recordings a sound plays (a Sampler's, a Drum Rack's...), by their library ids. */
export const soundRecordingIds = (sound: MySound): string[] => referencedSoundIds({ clips: [], tracks: [sound.settings] });

/**
 * `sounds` added to `mine`: one of the same name (any case) is replaced, as saving it again
 * would; the rest are added after, while there's room (MAX_SOUNDS). Returns the list and how
 * many were added, replaced and left out for want of room.
 */
export function mergeSounds(mine: readonly MySound[], sounds: readonly MySound[]): { sounds: MySound[]; added: number; replaced: number; full: number } {
  const out = [...mine];
  let added = 0;
  let replaced = 0;
  let full = 0;
  for (const s of sounds) {
    const i = out.findIndex((m) => m.name.toLowerCase() === s.name.toLowerCase());
    if (i >= 0) {
      out[i] = { ...s, id: out[i].id };
      replaced++;
    } else if (out.length >= MAX_SOUNDS) {
      full++;
    } else {
      out.push({ ...s, id: uid('sound') });
      added++;
    }
  }
  return { sounds: out, added, replaced, full };
}

interface MySoundsState {
  favourites: InstrumentKey[];
  sounds: MySound[];
  toggleFavourite: (key: InstrumentKey) => void;
  /** Keep `track`'s sound as `name` (replacing a saved sound of that name). */
  saveSound: (name: string, track: Track) => SaveResult;
  removeSound: (id: string) => void;
  renameSound: (id: string, name: string) => void;
  /** Add a file's sounds and stars to this browser's (see mergeSounds); false if the browser wouldn't keep them. */
  importSounds: (sounds: readonly MySound[], favourites: readonly InstrumentKey[]) => { added: number; replaced: number; full: number } | false;
}

export const useMySounds = create<MySoundsState>((set, get) => ({
  favourites: readFavourites(),
  sounds: readSounds(),
  toggleFavourite: (key) => {
    const has = get().favourites.includes(key);
    const favourites = has ? get().favourites.filter((k) => k !== key) : [...get().favourites, key];
    writeJson(FAVOURITE_INSTRUMENTS_KEY, favourites);
    set({ favourites });
  },
  saveSound: (rawName, track) => {
    const name = rawName.trim().slice(0, 60) || INSTRUMENTS[track.instrumentKey].name;
    const settings = soundOf(track);
    if (JSON.stringify(settings).length > MAX_SOUND_CHARS) return 'too-big';
    const same = get().sounds.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!same && get().sounds.length >= MAX_SOUNDS) return 'full';
    const sound: MySound = { id: same?.id ?? uid('sound'), name, settings };
    const sounds = same
      ? get().sounds.map((s) => (s.id === same.id ? sound : s))
      : [...get().sounds, sound];
    if (!writeJson(MY_SOUNDS_KEY, sounds)) return 'not-kept';
    set({ sounds });
    return same ? 'replaced' : 'saved';
  },
  removeSound: (id) => {
    const sounds = get().sounds.filter((s) => s.id !== id);
    writeJson(MY_SOUNDS_KEY, sounds);
    set({ sounds });
  },
  importSounds: (incoming, stars) => {
    const merged = mergeSounds(get().sounds, incoming);
    const favourites = [...get().favourites, ...stars.filter((k) => !get().favourites.includes(k))];
    if (!writeJson(MY_SOUNDS_KEY, merged.sounds)) return false;
    writeJson(FAVOURITE_INSTRUMENTS_KEY, favourites);
    set({ sounds: merged.sounds, favourites });
    return { added: merged.added, replaced: merged.replaced, full: merged.full };
  },
  renameSound: (id, rawName) => {
    const name = rawName.trim().slice(0, 60);
    if (!name) return;
    const sounds = get().sounds.map((s) => (s.id === id ? { ...s, name } : s));
    writeJson(MY_SOUNDS_KEY, sounds);
    set({ sounds });
  },
}));

// Another tab starring an instrument or saving a sound: this one shows it too
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === FAVOURITE_INSTRUMENTS_KEY) useMySounds.setState({ favourites: readFavourites() });
    if (e.key === MY_SOUNDS_KEY) useMySounds.setState({ sounds: readSounds() });
  });
}

/** The library sounds the saved sounds play (for freeing unused sounds to leave alone). */
export function mySoundIds(): string[] {
  return referencedSoundIds({ clips: [], tracks: useMySounds.getState().sounds.map((s) => s.settings) });
}
