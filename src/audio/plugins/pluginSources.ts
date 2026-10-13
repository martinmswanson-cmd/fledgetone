import { PLUGIN_FAMILIES } from './pluginCatalog';
import { GPL_PLUGIN_FAMILIES } from './pluginCatalogGpl';
import type { PluginFamily } from './pluginTypes';

/** Builds that include the GPL-licensed plugins (see builtinHost.ts): VITE_GPL_PLUGINS=1. */
export const GPL_PLUGINS = import.meta.env.VITE_GPL_PLUGINS === '1';

// (In other builds the GPL catalog is left out of the bundle altogether)
const families: PluginFamily[] = GPL_PLUGINS ? [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES] : PLUGIN_FAMILIES;

/** The plugin families this build offers. */
export const pluginFamilies = (): PluginFamily[] => families;

/** Where a family's files (its WebAssembly, preset files) are downloaded from: next to the page, else the site's copy. */
export const pluginSource = (family: PluginFamily) => ({
  baseUrl: 'bos-beat-box-plugins/',
  fallbackUrl: 'https://twobirdsworkshop.com/bos-beat-box-plugins/',
  version: family.hash,
});
