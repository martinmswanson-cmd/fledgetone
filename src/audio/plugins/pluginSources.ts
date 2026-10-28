import { PLUGIN_FAMILIES } from './pluginCatalog';
import { GPL_PLUGIN_FAMILIES } from './pluginCatalogGpl';
import type { PluginFamily } from './pluginTypes';

/** Builds that include the GPL-licensed plugins (see builtinHost.ts): VITE_GPL_PLUGINS=1. */
export const GPL_PLUGINS = import.meta.env.VITE_GPL_PLUGINS === '1';

// (In other builds the GPL catalog is left out of the bundle altogether)
const families: PluginFamily[] = GPL_PLUGINS ? [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES] : PLUGIN_FAMILIES;

/** The plugin families this build offers. */
export const pluginFamilies = (): PluginFamily[] => families;

/**
 * The web games runtime (bos-player.js, vite.runtime.config.ts) finds the plugins next to itself,
 * where its kit puts them (runtimeKit.ts), wherever the game's page is.
 */
const RUNTIME = import.meta.env.VITE_BOS_RUNTIME === '1';

/** Where a family's files (its WebAssembly, preset files) are downloaded from: next to the page (the runtime: next to it), else the site's copy. */
export const pluginSource = (family: PluginFamily) => ({
  baseUrl: RUNTIME ? new URL('fledgetone-plugins/', import.meta.url).href : 'fledgetone-plugins/',
  fallbackUrl: 'https://fledgetone.com/app/fledgetone-plugins/',
  version: family.hash,
});
