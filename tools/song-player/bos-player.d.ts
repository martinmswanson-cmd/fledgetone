// Types for bos-player.js, Fledgetone's song player. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later.
import { AdaptiveMusic } from './adaptive-music';

export { AdaptiveMusic };

export interface LoadOptions {
  /** The game's AudioContext (one is made if not given) */
  context?: AudioContext;
  /** Where the music plays into (the context's destination if not given) */
  destination?: AudioNode;
  /** Hears 0 to 1 as the music is made, and what's being made */
  onProgress?: (fraction: number, detail: string) => void;
}

/**
 * Load a song saved from Fledgetone (a URL to its .json, or the parsed JSON itself), make its
 * music in the browser, and return a player ready to play it.
 */
export function loadSong(source: string | object, opts?: LoadOptions): Promise<AdaptiveMusic>;
