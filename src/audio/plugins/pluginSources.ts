import { PLUGIN_FAMILIES } from './pluginCatalog';
import type { PluginFamily } from './pluginTypes';

/** Builds that include the GPL-licensed plugins (see builtinHost.ts): VITE_GPL_PLUGINS=1. */
export const GPL_PLUGINS = import.meta.env.VITE_GPL_PLUGINS === '1';

/** The plugin families this build offers. */
export const pluginFamilies = (): PluginFamily[] => PLUGIN_FAMILIES.filter((f) => GPL_PLUGINS || !f.gpl);

/** Where a family's WebAssembly is downloaded from: next to the page, else the site's copy. */
export const pluginSource = (family: PluginFamily) => ({
  baseUrl: 'bos-beat-box-plugins/',
  fallbackUrl: 'https://twobirdsworkshop.com/bos-beat-box-plugins/',
  version: family.hash,
});
