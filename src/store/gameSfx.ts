import { parseSfx, sfxFileName, type SfxSound } from '../audio/sfx/sfxSynth';
import { uid } from './timelineTypes';

/**
 * The song's game sound effects: sounds from the sound effects maker kept with the project, so
 * the game kit carries them next to the music (files with their variations, and a play call in
 * every player). Kept as their settings, not audio, so a project stays small and a sound can be
 * changed later. No audio or store here, so Node can unit-test it.
 */

export interface GameSfx {
  id: string;
  /** Its name in the game: the file name and what the players' playSfx() takes ("sword_hit") */
  name: string;
  sound: SfxSound;
  /** How many versions the kit makes (a game picks one at random each time), 1 to 8 */
  variations: number;
  /** How far the versions move in pitch, semitones each way */
  spread: number;
}

export const MAX_GAME_SFX = 200;

/** A name not taken yet in `list`: "sword_hit", then "sword_hit_2"... */
export function freeSfxName(name: string, list: readonly Pick<GameSfx, 'name'>[]): string {
  const base = sfxFileName(name);
  const taken = new Set(list.map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A new game sound from the maker's sound, named for the game. */
export function createGameSfx(name: string, sound: SfxSound, list: readonly GameSfx[], variations = 1, spread = 1): GameSfx {
  return { id: uid('sfx'), name: freeSfxName(name, list), sound, variations: clampVariations(variations), spread: clampSpread(spread) };
}

const clampVariations = (v: number) => (Number.isFinite(v) ? Math.max(1, Math.min(8, Math.round(v))) : 1);
const clampSpread = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 1);

/** Game sounds from a project file, keeping only readable ones, each name used once. */
export function parseGameSfx(raw: unknown): GameSfx[] {
  if (!Array.isArray(raw)) return [];
  const out: GameSfx[] = [];
  for (const v of raw.slice(0, MAX_GAME_SFX)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const sound = parseSfx(o.sound);
    if (!sound || typeof o.name !== 'string') continue;
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : uid('sfx'),
      name: freeSfxName(o.name, out),
      sound,
      variations: clampVariations(typeof o.variations === 'number' ? o.variations : 1),
      spread: clampSpread(typeof o.spread === 'number' ? o.spread : 1),
    });
  }
  return out;
}
