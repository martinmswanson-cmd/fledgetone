/**
 * The parameter names of each built-in plugin (by its address), as its instances report them when
 * they start, live or in an export. Step lanes (store/stepLanes.ts) name a plugin's parameter
 * ("Macro 1") rather than its number, which can change between versions of a plugin; this is how
 * the store finds the number for the track's own setting of it. No audio here, so Node can test
 * what uses it.
 */

const byUrl = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
let version = 0;

/** Remember the names a plugin at `url` reports (in parameter order). */
export function rememberParamNames(url: string, names: readonly string[]): void {
  const known = byUrl.get(url);
  if (known && known.length === names.length && known.every((n, i) => n === names[i])) return;
  byUrl.set(url, names.slice());
  version++;
  listeners.forEach((l) => l());
}

/** The names of the plugin at `url`'s parameters, once an instance of it has started. */
export const paramNamesOf = (url: string | undefined): readonly string[] | undefined => (url ? byUrl.get(url) : undefined);

/** Changes each time a plugin reports names not known before. */
export const paramNamesVersion = (): number => version;

/** Hear of names not known before (returns a function that stops it). */
export function onParamNames(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A parameter id that names the parameter (`#Macro 1`): a built-in plugin finds its number itself. */
export const NAMED_PARAM = '#';
export const isNamedParam = (id: string): boolean => id.startsWith(NAMED_PARAM);
