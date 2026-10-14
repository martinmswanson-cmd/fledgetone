/** A built-in plugin family: one WebAssembly module holding many plugins (see scripts/plugins/). */
export interface PluginFamily {
  family: string;
  /** Who made them, as credited */
  label: string;
  licence: string;
  /** GPL-licensed: only in builds made with VITE_GPL_PLUGINS (see pluginCatalog's users) */
  gpl: boolean;
  /** Its WebAssembly, in fledgetone-plugins/ next to the page */
  file: string;
  bytes: number;
  /** Changes with the file, so a kept copy is downloaded afresh */
  hash: string;
  plugins: BuiltinPluginInfo[];
}

export interface BuiltinPluginInfo {
  name: string;
  category: string;
  /** One line on what it does */
  about: string;
  /** Plays notes (a new track's instrument) rather than processing a track's sound */
  instrument?: boolean;
  /** The family's own groupings ("Recommended", "Basic", "Latest") */
  tags?: string[];
  /** Presets that are files beside the plugin (Surge's patches), fetched when chosen: `dir/name ext` */
  presetFiles?: { dir: string; ext: string; names: string[] };
}
