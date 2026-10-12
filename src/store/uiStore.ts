import { create } from 'zustand';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The search palette's shortcut, as this computer writes it. */
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

/**
 * Which dialogs and panels are open: kept here rather than in the components that show them, so
 * the search palette can open any of them.
 */
export type AppDialog = 'new' | 'export' | 'share' | 'mixer' | 'game' | 'report' | 'learn' | 'cut';

interface UiState {
  dialog: AppDialog | null;
  /** The guide's open section (its id), '' for the first, null when the guide is closed */
  guide: string | null;
  paletteOpen: boolean;
  inspectorTab: 'track' | 'master';
  setDialog: (dialog: AppDialog | null) => void;
  openGuide: (section?: string) => void;
  closeGuide: () => void;
  setPaletteOpen: (open: boolean) => void;
  setInspectorTab: (tab: 'track' | 'master') => void;
}

export const useUiStore = create<UiState>((set) => ({
  dialog: null,
  guide: null,
  paletteOpen: false,
  inspectorTab: 'track',
  setDialog: (dialog) => set({ dialog }),
  openGuide: (section = '') => set({ guide: section }),
  closeGuide: () => set({ guide: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
}));
