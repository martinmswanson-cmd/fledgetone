/**
 * Adding the built-in plugins (audio/plugins/builtinHost.ts) to the song, and the favourites and
 * recently used ones the plugin browser (PluginBrowser.tsx) and the Plugins menu show.
 */
import { useTimelineStore } from './timelineStore';
import { useUiStore } from './uiStore';
import { builtinUrl, pluginFamilies } from '../audio/plugins/builtinHost';
import type { BuiltinPluginInfo, PluginFamily } from '../audio/plugins/pluginTypes';

export interface BuiltinEntry {
  family: PluginFamily;
  info: BuiltinPluginInfo;
  /** family/name: as stored in favourites and recents */
  key: string;
}

export const FAVOURITES_KEY = 'bosBeatbox.favouritePlugins';
export const RECENT_KEY = 'bosBeatbox.recentBuiltinPlugins';
export const readList = (key: string): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
export const writeList = (key: string, list: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage blocked: for this visit only
  }
};

/** Every built-in plugin in this build. */
export function allBuiltinPlugins(): BuiltinEntry[] {
  return pluginFamilies().flatMap((family) => family.plugins.map((info) => ({ family, info, key: `${family.family}/${info.name}` })));
}

/** Put a built-in plugin on a track (an effect) or on a new track (an instrument); opens its window. */
export function addBuiltinPlugin(entry: Pick<BuiltinEntry, 'family' | 'info'>, trackId: string | null): string | null {
  const s = useTimelineStore.getState();
  const url = builtinUrl(entry.family.family, entry.info.name);
  writeList(RECENT_KEY, [`${entry.family.family}/${entry.info.name}`, ...readList(RECENT_KEY).filter((k) => k !== `${entry.family.family}/${entry.info.name}`)].slice(0, 12));
  if (entry.info.instrument) {
    const id = s.addPluginTrack(url, entry.info.name);
    const plugin = useTimelineStore.getState().tracks.find((t) => t.id === id)?.plugin;
    if (plugin) useUiStore.getState().setPluginWindow({ trackId: id, pluginId: plugin.id });
    return id;
  }
  if (!trackId) return null;
  const id = s.addTrackPluginFx(trackId, url, entry.info.name);
  if (id) useUiStore.getState().setPluginWindow({ trackId, pluginId: id });
  return id;
}
