import { create } from 'zustand';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The search palette's shortcut, as this computer writes it. */
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';
/** The Ctrl key as this computer writes it in shortcuts ("⌘" or "Ctrl+"). */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl+';

/**
 * The panels of the dock under the timeline. The Mixer, Game and Sound effects used to be
 * dialogs: asking for one of those as a dialog opens its dock tab instead.
 */
export type DockTab = 'mixer' | 'eq' | 'instruments' | 'game' | 'video' | 'sfx';
export const DOCK_TABS: readonly DockTab[] = ['mixer', 'eq', 'instruments', 'game', 'video', 'sfx'];
const isDockTab = (d: string | null): d is DockTab => d !== null && (DOCK_TABS as readonly string[]).includes(d);

/**
 * Which dialogs and panels are open: kept here rather than in the components that show them, so
 * the search palette and the menus can open any of them.
 */
export type AppDialog = 'new' | 'export' | 'share' | 'mixer' | 'game' | 'report' | 'learn' | 'cut' | 'sfx' | 'engines';

export const DOCK_MIN = 160;
export const DOCK_MAX = 900;
const DOCK_KEY = 'bosBeatbox.dock';

interface DockPrefs {
  tab: DockTab;
  open: boolean;
  height: number;
}

function loadDock(): DockPrefs {
  const fallback: DockPrefs = { tab: 'mixer', open: true, height: 400 };
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null') as Partial<DockPrefs> | null;
    if (!raw) return fallback;
    return {
      tab: isDockTab(raw.tab ?? null) ? (raw.tab as DockTab) : fallback.tab,
      open: typeof raw.open === 'boolean' ? raw.open : fallback.open,
      height: typeof raw.height === 'number' ? Math.max(DOCK_MIN, Math.min(DOCK_MAX, raw.height)) : fallback.height,
    };
  } catch {
    return fallback;
  }
}

function saveDock(p: DockPrefs): void {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the dock just forgets its layout
  }
}

interface UiState {
  dialog: AppDialog | null;
  /** The guide's open section (its id), '' for the first, null when the guide is closed */
  guide: string | null;
  paletteOpen: boolean;
  inspectorTab: 'track' | 'master';
  dockTab: DockTab;
  dockOpen: boolean;
  dockHeight: number;
  /** The clip whose Generate variations dialog is open */
  variationsClipId: string | null;
  setVariationsClip: (clipId: string | null) => void;
  setDialog: (dialog: AppDialog | null) => void;
  openGuide: (section?: string) => void;
  closeGuide: () => void;
  setPaletteOpen: (open: boolean) => void;
  setInspectorTab: (tab: 'track' | 'master') => void;
  /** Show a dock tab (opening the dock), and bring it into view. */
  openDock: (tab: DockTab) => void;
  setDockOpen: (open: boolean) => void;
  setDockHeight: (height: number) => void;
}

const dock = loadDock();

export const useUiStore = create<UiState>((set, get) => ({
  dialog: null,
  guide: null,
  paletteOpen: false,
  inspectorTab: 'track',
  dockTab: dock.tab,
  dockOpen: dock.open,
  dockHeight: dock.height,
  variationsClipId: null,
  setVariationsClip: (variationsClipId) => set({ variationsClipId }),
  setDialog: (dialog) => {
    if (isDockTab(dialog)) get().openDock(dialog);
    else set({ dialog });
  },
  openGuide: (section = '') => set({ guide: section }),
  closeGuide: () => set({ guide: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  openDock: (dockTab) => {
    set({ dockTab, dockOpen: true });
    const s = get();
    saveDock({ tab: s.dockTab, open: s.dockOpen, height: s.dockHeight });
    // Scroll the dock into view once it has rendered
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => document.querySelector('[data-dock]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  },
  setDockOpen: (dockOpen) => {
    set({ dockOpen });
    const s = get();
    saveDock({ tab: s.dockTab, open: s.dockOpen, height: s.dockHeight });
  },
  setDockHeight: (height) => {
    set({ dockHeight: Math.round(Math.max(DOCK_MIN, Math.min(DOCK_MAX, height))) });
    const s = get();
    saveDock({ tab: s.dockTab, open: s.dockOpen, height: s.dockHeight });
  },
}));
