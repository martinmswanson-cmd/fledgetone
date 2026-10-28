/**
 * The built-in plugins a song plays (its tracks' instruments and effects), for the web runtime
 * kit to carry their WebAssembly: the runtime finds it next to bos-player.js (pluginSources.ts),
 * so a game plays them without reaching fledgetone.com. Pure, so Node can test it.
 */
import type { PluginFamily } from './plugins/pluginTypes';
import type { Track } from '../store/timelineTypes';

/** The families `tracks` use, of `families` (what the runtime offers), and the plugins it hasn't (a GPL plugin: the runtime is built without them). */
export function songPlugins(tracks: readonly Pick<Track, 'plugin' | 'pluginFx'>[], families: readonly PluginFamily[]): { families: PluginFamily[]; missing: string[] } {
  const used = new Map<string, PluginFamily>();
  const missing = new Set<string>();
  for (const t of tracks)
    for (const p of [t.plugin, ...(t.pluginFx ?? [])]) {
      if (!p?.url.startsWith('builtin:')) continue;
      const [name, ...rest] = p.url.slice('builtin:'.length).split('/');
      const family = families.find((f) => f.family === name);
      if (family && family.plugins.some((x) => x.name === rest.join('/'))) used.set(family.family, family);
      else missing.add(p.name || p.url);
    }
  return { families: [...used.values()], missing: [...missing] };
}
