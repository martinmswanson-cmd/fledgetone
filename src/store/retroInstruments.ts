/**
 * Whether the instrument lists show the retro instruments (the 1990s General MIDI soundfonts, see
 * instrumentCatalogRetro.ts). Off unless turned on, and remembered in this browser. Songs that use
 * a retro instrument play it either way, and a track's own instrument is always listed.
 */
import { create } from 'zustand';

export const RETRO_STORAGE_KEY = 'fledgetone.showRetro';

const read = () => {
  try {
    return localStorage.getItem(RETRO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

interface RetroState {
  shown: boolean;
  setShown: (shown: boolean) => void;
}

export const useRetroInstruments = create<RetroState>((set) => ({
  shown: read(),
  setShown: (shown) => {
    try {
      localStorage.setItem(RETRO_STORAGE_KEY, shown ? '1' : '0');
    } catch {
      // (Private windows: it's just not remembered)
    }
    set({ shown });
  },
}));
