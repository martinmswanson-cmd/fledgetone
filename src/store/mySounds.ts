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
import { INSTRUMENTS, isAudioKind } from '../audio/instrumentCatalog';
import { referencedSoundIds } from './audioClips';
import { isMixTrack } from './buses';
import { parseTrack } from './project';
import type { Track, WamPlugin } from './timelineTypes';
import { uid } from './timelineTypes';

export const FAVOURITE_INSTRUMENTS_KEY = 'fledgetone.favouriteInstruments';
export const MY_SOUNDS_KEY = 'fledgetone.mySounds';
/** A sound bigger than this (a plugin with a huge state) isn't kept: browser storage is small */
const MAX_SOUND_CHARS = 1_500_000;
const MAX_SOUNDS = 200;

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
    const track = parseTrack({ ...(settings as object), id: 'sound', name });
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
  return Array.isArray(raw) ? raw.filter((k): k is InstrumentKey => typeof k === 'string' && k in INSTRUMENTS) : [];
}

function readSounds(): MySound[] {
  const raw = readJson(MY_SOUNDS_KEY);
  return Array.isArray(raw) ? raw.map(parseSound).filter((s): s is MySound => !!s) : [];
}

export type SaveResult = 'saved' | 'replaced' | 'too-big' | 'not-kept';

interface MySoundsState {
  favourites: InstrumentKey[];
  sounds: MySound[];
  toggleFavourite: (key: InstrumentKey) => void;
  /** Keep `track`'s sound as `name` (replacing a saved sound of that name). */
  saveSound: (name: string, track: Track) => SaveResult;
  removeSound: (id: string) => void;
  renameSound: (id: string, name: string) => void;
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
    const sound: MySound = { id: same?.id ?? uid('sound'), name, settings };
    const sounds = same
      ? get().sounds.map((s) => (s.id === same.id ? sound : s))
      : [...get().sounds, sound].slice(-MAX_SOUNDS);
    if (!writeJson(MY_SOUNDS_KEY, sounds)) return 'not-kept';
    set({ sounds });
    return same ? 'replaced' : 'saved';
  },
  removeSound: (id) => {
    const sounds = get().sounds.filter((s) => s.id !== id);
    writeJson(MY_SOUNDS_KEY, sounds);
    set({ sounds });
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
