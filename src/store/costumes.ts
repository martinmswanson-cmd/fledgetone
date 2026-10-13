import type { Clip, InstrumentKey, Track } from './timelineTypes';
import { uid } from './timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { midiOf, nameOf } from './noteTools';

/**
 * Costumes and state options: the game music's second tier.
 *
 * A costume is the same song played another way: each track on another instrument, or silent,
 * and optionally faster or slower. The game kit renders every state in every costume, all lined up
 * so a game can swap costumes mid-loop (the 8-bit version for a retro room, a music box for a
 * dream, the night version, a hurry-up at +20% when time runs low). Kept as a list of swaps, so a
 * costume follows the song as it changes.
 *
 * State options say how a state plays in the game: as written on a loop, or its sections of a few
 * bars shuffled, and with silences between plays (music that comes and goes).
 *
 * No audio or store here, so Node can unit-test it.
 */

export interface CostumeTrack {
  /** Play the track on this instrument instead */
  instrument?: InstrumentKey;
  /** Leave the track out */
  mute?: boolean;
}

export interface Costume {
  id: string;
  /** Its name in the game: what setCostume() takes ("8-bit") */
  name: string;
  /** Tempo, as a multiple of the song's (1.2 for a hurry-up) */
  tempo: number;
  /** Swaps by track id; a track not listed plays as it is */
  tracks: Record<string, CostumeTrack>;
}

export type CostumePreset = 'eightBit' | 'musicBox' | 'piano' | 'night' | 'hurry' | 'empty';
export const COSTUME_PRESETS: ReadonlyArray<{ id: CostumePreset; name: string; detail: string }> = [
  { id: 'eightBit', name: '8-bit', detail: 'Every part on the chip sounds: a retro room, a flashback, a minigame' },
  { id: 'musicBox', name: 'Music box', detail: 'The tune and chords on a music box, no drums: dreams, memories, a lullaby' },
  { id: 'piano', name: 'Solo piano', detail: 'Everything on one piano, no drums: a quiet room, a sad moment' },
  { id: 'night', name: 'Night', detail: 'No drums, brass on soft strings, 10% slower: the same place after dark' },
  { id: 'hurry', name: 'Hurry up', detail: 'The same music 20% faster (same pitch): time is running out' },
  { id: 'empty', name: 'Your own', detail: 'Nothing changed yet: pick each track\'s instrument yourself' },
];

export const MAX_COSTUMES = 8;
export const MIN_COSTUME_TEMPO = 0.5;
export const MAX_COSTUME_TEMPO = 2;

type Role = 'drums' | 'bass' | 'pad' | 'fx' | 'brass' | 'melodic' | 'mix';

/** What a track does, from its instrument (for the presets). */
function roleOf(t: Track): Role {
  if (t.instrumentKey === 'bus' || t.instrumentKey === 'return') return 'mix';
  const def = INSTRUMENTS[t.instrumentKey];
  if (!def) return 'melodic';
  if (def.kind === 'drums' || def.category === 'Drums & Percussion') return 'drums';
  if (def.category === 'Sound Effects' || def.category === 'FX' || t.instrumentKey === 'audio') return 'fx';
  if (def.category === 'Bass' || /bass/i.test(t.instrumentKey) || t.instrumentKey === 'contrabass') return 'bass';
  if (def.category === 'Pads & Atmospheres' || def.category === 'Choir & Voices') return 'pad';
  if (/horn|trumpet|trombone|tuba|brass/i.test(t.instrumentKey)) return 'brass';
  return 'melodic';
}

/** A costume from a preset, for these tracks. */
export function costumeFromPreset(preset: CostumePreset, tracks: readonly Track[], taken: readonly Pick<Costume, 'name'>[] = []): Costume {
  const swaps: Record<string, CostumeTrack> = {};
  for (const t of tracks) {
    const role = roleOf(t);
    if (role === 'mix') continue;
    let swap: CostumeTrack | null = null;
    if (preset === 'eightBit') {
      swap = role === 'drums' ? { instrument: 'chipDrums' } : role === 'bass' ? { instrument: 'chipBass' } : role === 'pad' || role === 'fx' ? { mute: true } : { instrument: 'chipLead' };
    } else if (preset === 'musicBox') {
      swap = role === 'drums' || role === 'fx' || role === 'pad' ? { mute: true } : { instrument: 'musicBox' };
    } else if (preset === 'piano') {
      swap = role === 'drums' || role === 'fx' ? { mute: true } : { instrument: 'realGrandPiano' };
    } else if (preset === 'night') {
      swap = role === 'drums' ? { mute: true } : role === 'brass' ? { instrument: 'slowStrings' } : null;
    }
    if (swap) swaps[t.id] = swap;
  }
  const base = COSTUME_PRESETS.find((p) => p.id === preset)!.name;
  return { id: uid('costume'), name: freeCostumeName(base, taken), tempo: preset === 'hurry' ? 1.2 : preset === 'night' ? 0.9 : 1, tracks: swaps };
}

/** A name not taken yet: "8-bit", then "8-bit 2"... */
export function freeCostumeName(name: string, taken: readonly Pick<Costume, 'name'>[]): string {
  const base = name.trim().slice(0, 40) || 'Costume';
  const names = new Set(taken.map((c) => c.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A clip's notes moved by octaves into an instrument's range (the part first, then stragglers). */
function fitClip(c: Clip, key: InstrumentKey): Clip {
  const def = INSTRUMENTS[key];
  if (!def?.range || def.kind === 'drums' || !c.notes.length) return c;
  const [lo, hi] = def.range;
  const midis = c.notes.map((n) => midiOf(n.note));
  let best = 0;
  let bestFit = -1;
  for (const k of [0, 12, -12, 24, -24, 36, -36]) {
    const fit = midis.filter((m) => m + k >= lo && m + k <= hi).length;
    if (fit > bestFit) {
      best = k;
      bestFit = fit;
    }
  }
  if (best === 0 && bestFit === midis.length) return c;
  return {
    ...c,
    notes: c.notes.map((n, i) => {
      if (!Number.isFinite(midis[i])) return n;
      let m = midis[i] + best;
      while (m > hi && m - 12 >= lo) m -= 12;
      while (m < lo && m + 12 <= hi) m += 12;
      return { ...n, note: nameOf(m) };
    }),
  };
}

/**
 * The song's tracks and clips in a costume: swapped tracks on their new instrument (their notes
 * moved into its range), muted ones silent. Drum parts only move to another drum kit.
 */
export function applyCostume(tracks: readonly Track[], clips: readonly Clip[], costume: Costume): { tracks: Track[]; clips: Clip[] } {
  const swapped = new Map<string, InstrumentKey>();
  const outTracks = tracks.map((t) => {
    const swap = costume.tracks[t.id];
    if (!swap) return t;
    if (swap.mute) return { ...t, isMuted: true };
    const to = swap.instrument;
    if (!to || to === t.instrumentKey || !INSTRUMENTS[to]) return t;
    // A drum part's notes are drum names: it can only go to another kit, and a melody can't go to a kit
    const fromDrums = INSTRUMENTS[t.instrumentKey]?.kind === 'drums';
    if (fromDrums !== (INSTRUMENTS[to].kind === 'drums')) return t;
    swapped.set(t.id, to);
    return { ...t, instrumentKey: to };
  });
  const outClips = clips.map((c) => {
    const to = swapped.get(c.trackId);
    return to && !c.audio ? fitClip(c, to) : c;
  });
  return { tracks: outTracks, clips: outClips };
}

/** Costumes from a project file, keeping the readable ones (swaps only for tracks it has). */
export function parseCostumes(raw: unknown, trackIds: ReadonlySet<string>, isInstrument: (k: unknown) => k is InstrumentKey): Costume[] {
  if (!Array.isArray(raw)) return [];
  const out: Costume[] = [];
  for (const v of raw.slice(0, MAX_COSTUMES)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    const tracks: Record<string, CostumeTrack> = {};
    if (o.tracks && typeof o.tracks === 'object') {
      for (const [id, s] of Object.entries(o.tracks as Record<string, unknown>)) {
        if (!trackIds.has(id) || !s || typeof s !== 'object') continue;
        const sw = s as Record<string, unknown>;
        if (sw.mute === true) tracks[id] = { mute: true };
        else if (isInstrument(sw.instrument)) tracks[id] = { instrument: sw.instrument };
      }
    }
    const tempo = typeof o.tempo === 'number' && Number.isFinite(o.tempo) ? Math.max(MIN_COSTUME_TEMPO, Math.min(MAX_COSTUME_TEMPO, o.tempo)) : 1;
    out.push({ id: typeof o.id === 'string' && o.id ? o.id : uid('costume'), name: freeCostumeName(o.name, out), tempo, tracks });
  }
  return out;
}

// ---------- State options ----------

export interface StateOptions {
  /** Play the state's pieces of this many bars in a shuffled order (no piece twice in a row); absent: as written */
  shuffleBars?: number;
  /** Silence between plays, in seconds, picked at random from min to max (absent: it loops straight on) */
  gap?: { min: number; max: number };
}

export const SHUFFLE_BARS = [2, 4, 8] as const;
/** Silences between plays, as a game might offer them (min to max seconds). */
export const GAP_PRESETS: ReadonlyArray<{ id: string; name: string; gap: { min: number; max: number } | null }> = [
  { id: 'none', name: 'none: loops straight on', gap: null },
  { id: 'short', name: 'short: 4 to 12 s', gap: { min: 4, max: 12 } },
  { id: 'medium', name: 'medium: 15 to 45 s', gap: { min: 15, max: 45 } },
  { id: 'long', name: 'long: 1 to 3 min', gap: { min: 60, max: 180 } },
];

/** State options from a project file, by section marker id. */
export function parseStateOptions(raw: unknown, markerIds: ReadonlySet<string>): Record<string, StateOptions> {
  const out: Record<string, StateOptions> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!markerIds.has(id) || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const opts: StateOptions = {};
    if (typeof o.shuffleBars === 'number' && (SHUFFLE_BARS as readonly number[]).includes(o.shuffleBars)) opts.shuffleBars = o.shuffleBars;
    if (o.gap && typeof o.gap === 'object') {
      const g = o.gap as Record<string, unknown>;
      if (typeof g.min === 'number' && typeof g.max === 'number' && Number.isFinite(g.min) && Number.isFinite(g.max)) {
        const min = Math.max(0, Math.min(600, g.min));
        opts.gap = { min, max: Math.max(min, Math.min(600, g.max)) };
      }
    }
    if (opts.shuffleBars || opts.gap) out[id] = opts;
  }
  return out;
}
