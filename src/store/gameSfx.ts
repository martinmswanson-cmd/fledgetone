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

/**
 * A name not taken yet in `list`: "sword_hit", then "sword_hit_2"... Nor one that would be the same
 * file as another sound's variation: next to "hit" with 2 variations (hit_01, hit_02), "hit 01" is
 * "hit_01_2". (`variations`: how many this one will have, for the same check the other way round.)
 */
export function freeSfxName(name: string, list: readonly (Pick<GameSfx, 'name'> & Partial<Pick<GameSfx, 'variations'>>)[], variations = 1): string {
  const files = (n: string, count: number) => (count > 1 ? Array.from({ length: count }, (_, i) => sfxFileName(n, i + 1)) : [n]);
  const taken = new Set(list.flatMap((s) => files(s.name, Math.max(1, s.variations ?? 1))).map((f) => f.toLowerCase()));
  const names = new Set(list.map((s) => s.name.toLowerCase()));
  const free = (n: string) => !names.has(n) && files(n, variations).every((f) => !taken.has(f));
  const base = sfxFileName(name);
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}_${n}`)) return `${base}_${n}`;
}

/** A new game sound from the maker's sound, named for the game. */
export function createGameSfx(name: string, sound: SfxSound, list: readonly GameSfx[], variations = 1, spread = 1): GameSfx {
  const count = clampVariations(variations);
  return { id: uid('sfx'), name: freeSfxName(name, list, count), sound, variations: count, spread: clampSpread(spread) };
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
    const variations = clampVariations(typeof o.variations === 'number' ? o.variations : 1);
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : uid('sfx'),
      name: freeSfxName(o.name, out, variations),
      sound,
      variations,
      spread: clampSpread(typeof o.spread === 'number' ? o.spread : 1),
    });
  }
  return out;
}
