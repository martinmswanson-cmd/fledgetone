/**
 * The built-in plugins a song plays (its tracks' instruments and effects), for the web runtime
 * kit to carry their files: the runtime finds them next to bos-player.js (pluginSources.ts), so a
 * game plays them without reaching fledgetone.com. GPL-licensed ones are listed apart, for the
 * kit's notice (gplCredits.ts). Pure, so Node can test it.
 */
import type { BuiltinPluginInfo, PluginFamily } from './plugins/pluginTypes';
import type { Track } from '../store/timelineTypes';

export interface SongPlugins {
  /** The families the song uses, of those offered */
  families: PluginFamily[];
  /** The GPL-licensed ones among them */
  gpl: PluginFamily[];
  /** Plugins not in `families` at all (by name) */
  missing: string[];
  /** Every file to carry: each family's WebAssembly and the preset files the song starts on (Surge's patches), as named in fledgetone-plugins/, and as asked for there (`url`, escaped) */
  files: Array<{ family: PluginFamily; path: string; url: string }>;
}

/**
 * Where preset `name`'s file is, in fledgetone-plugins/: its `path` there, and the `url` to ask for
 * it by (escaped). Its file name has only letters, digits, spaces, dots and dashes: "Bass+Drums"
 * is the file "Bass and Drums", as a + or & in a path can reach a web server as something else.
 */
export function presetFilePath(files: NonNullable<BuiltinPluginInfo['presetFiles']>, name: string): { path: string; url: string } {
  const file = files.files?.[name] ?? name;
  return { path: `${files.dir}/${file}${files.ext}`, url: `${files.dir}/${file.split('/').map(encodeURIComponent).join('/')}${files.ext}` };
}

/** The plugins `tracks` play, of `families` (what the runtime offers). */
export function songPlugins(tracks: readonly Pick<Track, 'plugin' | 'pluginFx'>[], families: readonly PluginFamily[]): SongPlugins {
  const used = new Map<string, PluginFamily>();
  const missing = new Set<string>();
  const files = new Map<string, SongPlugins['files'][number]>();
  for (const t of tracks)
    for (const p of [t.plugin, ...(t.pluginFx ?? [])]) {
      if (!p?.url.startsWith('builtin:')) continue;
      const [name, ...rest] = p.url.slice('builtin:'.length).split('/');
      const family = families.find((f) => f.family === name);
      const info = family?.plugins.find((x) => x.name === rest.join('/'));
      if (!family || !info) {
        missing.add(p.name || p.url);
        continue;
      }
      used.set(family.family, family);
      files.set(family.file, { family, path: family.file, url: family.file });
      // A patch it starts on is a file of its own (fetched as builtinHost.ts presetBytes asks for it)
      const preset = (p.state as { preset?: unknown } | undefined)?.preset;
      const pf = info.presetFiles;
      if (pf && typeof preset === 'string' && pf.names.includes(preset)) {
        const { path, url } = presetFilePath(pf, preset);
        files.set(path, { family, path, url });
      }
    }
  const all = [...used.values()];
  return { families: all, gpl: all.filter((f) => f.gpl), missing: [...missing], files: [...files.values()] };
}
