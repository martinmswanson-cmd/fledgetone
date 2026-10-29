/**
 * Which dialogs, panels and dock tab are open, and the dock's height: kept in a store rather than
 * the components, so the search palette and menus can open any of them.
 */
import { create } from 'zustand';
import { scrollBehavior } from '../components/reducedMotion';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The search palette's shortcut, as this computer writes it. */
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';
/** The Ctrl key as this computer writes it in shortcuts ("⌘" or "Ctrl+"). */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl+';

/**
 * The panels of the dock under the timeline. The Mixer, Game and Sound effects used to be
 * dialogs: asking for one of those as a dialog opens its dock tab instead.
 */
export type DockTab = 'mixer' | 'launcher' | 'eq' | 'game' | 'video' | 'sfx';
export const DOCK_TABS: readonly DockTab[] = ['mixer', 'launcher', 'eq', 'game', 'video', 'sfx'];
const isDockTab = (d: string | null): d is DockTab => d !== null && (DOCK_TABS as readonly string[]).includes(d);

/**
 * Which dialogs and panels are open: kept here rather than in the components that show them, so
 * the search palette and the menus can open any of them.
 */
export type AppDialog = 'new' | 'export' | 'share' | 'mixer' | 'game' | 'report' | 'learn' | 'cut' | 'sfx' | 'engines' | 'tryOut' | 'changes' | 'terms' | 'beatStore' | 'channelKit' | 'versions';

export const DOCK_MIN = 160;
export const DOCK_MAX = 900;
const DOCK_KEY = 'bosBeatbox.dock';
/** The timeline's height in pixels: drag the bar under it to see more tracks at once. */
export const TIMELINE_MIN = 300;
export const TIMELINE_MAX = 4000;
export const TIMELINE_DEFAULT = 520;
const TIMELINE_KEY = 'bosBeatbox.timelineHeight';

function loadTimelineHeight(): number {
  try {
    const raw = Number(localStorage.getItem(TIMELINE_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, raw)) : TIMELINE_DEFAULT;
  } catch {
    return TIMELINE_DEFAULT;
  }
}

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
  /** How tall the timeline is (pixels; see TIMELINE_MIN/MAX), kept in this browser */
  timelineHeight: number;
  setTimelineHeight: (height: number) => void;
  /** The clip whose Generate variations dialog is open */
  variationsClipId: string | null;
  setVariationsClip: (clipId: string | null) => void;
  /** The audio clip whose Tune vocal dialog is open */
  tuneClipId: string | null;
  /** The Tune vocal dialog opened as Hard tune (instant, full strength) */
  tuneHard: boolean;
  setTuneClip: (clipId: string | null, hard?: boolean) => void;
  /** The take folder whose Takes dialog is open */
  takesClipId: string | null;
  setTakesClip: (clipId: string | null) => void;
  /** The plugin whose window is open */
  pluginWindow: { trackId: string; pluginId: string } | null;
  setPluginWindow: (target: { trackId: string; pluginId: string } | null) => void;
  /** The add-a-plugin dialog: for a new Plugin track (null) or an effect on a track */
  pluginDialog: { trackId: string | null } | null;
  setPluginDialog: (target: { trackId: string | null } | null) => void;
  /** The built-in plugin browser: effects go on `trackId` (else the selected track); opened on `category` */
  pluginBrowser: { trackId: string | null; category?: string } | null;
  setPluginBrowser: (target: { trackId: string | null; category?: string } | null) => void;
  setDialog: (dialog: AppDialog | null) => void;
  openGuide: (section?: string) => void;
  closeGuide: () => void;
  setPaletteOpen: (open: boolean) => void;
  setInspectorTab: (tab: 'track' | 'master') => void;
  /** Show a dock tab (opening the dock), and bring it into view. */
  openDock: (tab: DockTab) => void;
  setDockOpen: (open: boolean) => void;
  setDockHeight: (height: number) => void;
  /** The agent's Suggestions panel (see src/components/agent/), and the Let an agent connect dialog */
  agentPanelOpen: boolean;
  agentConnectOpen: boolean;
  /** The agent connection as the header shows it: off, connecting, connected (and the agent's name) */
  agentStatus: { state: 'off' | 'connecting' | 'connected'; agent?: string };
  setAgentPanelOpen: (open: boolean) => void;
  setAgentConnectOpen: (open: boolean) => void;
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
  timelineHeight: loadTimelineHeight(),
  setTimelineHeight: (height) => {
    const timelineHeight = Math.round(Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, height)));
    set({ timelineHeight });
    try {
      localStorage.setItem(TIMELINE_KEY, String(timelineHeight));
    } catch {
      // Storage blocked: the timeline keeps its height until the page reloads
    }
  },
  variationsClipId: null,
  setVariationsClip: (variationsClipId) => set({ variationsClipId }),
  tuneClipId: null,
  tuneHard: false,
  setTuneClip: (tuneClipId, hard = false) => set({ tuneClipId, tuneHard: hard }),
  takesClipId: null,
  setTakesClip: (takesClipId) => set({ takesClipId }),
  pluginWindow: null,
  setPluginWindow: (pluginWindow) => set({ pluginWindow }),
  pluginDialog: null,
  setPluginDialog: (pluginDialog) => set({ pluginDialog }),
  pluginBrowser: null,
  setPluginBrowser: (pluginBrowser) => set({ pluginBrowser }),
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
      requestAnimationFrame(() => document.querySelector('[data-dock]')?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }));
    }
  },
  setDockOpen: (dockOpen) => {
    set({ dockOpen });
    const s = get();
    saveDock({ tab: s.dockTab, open: s.dockOpen, height: s.dockHeight });
  },
  agentPanelOpen: false,
  agentConnectOpen: false,
  agentStatus: { state: 'off' },
  setAgentPanelOpen: (agentPanelOpen) => set({ agentPanelOpen }),
  setAgentConnectOpen: (agentConnectOpen) => set({ agentConnectOpen }),
  setDockHeight: (height) => {
    set({ dockHeight: Math.round(Math.max(DOCK_MIN, Math.min(DOCK_MAX, height))) });
    const s = get();
    saveDock({ tab: s.dockTab, open: s.dockOpen, height: s.dockHeight });
  },
}));
