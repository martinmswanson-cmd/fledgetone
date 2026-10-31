/**
 * Looking a key up in a plain object when the key comes from outside: a file, a share link, a
 * saved sound, an agent, or typed text. Every object has "toString", "constructor", "valueOf",
 * "__proto__" and the like on its prototype, so `key in table` and `table[key]` find something
 * nobody put there (a function, the prototype itself). These look only at the object's own keys.
 */

/** True for a name every plain object already has ("toString", "constructor", "__proto__", ...). */
export const isPrototypeName = (key: string): boolean => key in Object.prototype;

/** `table[key]` if `table` has `key` itself, else undefined. */
export function own<T>(table: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The fields of a song that hold an id, looked up in tables by it. */
const ID_FIELDS = new Set(['id', 'trackId', 'clipId', 'soundId', 'stingerId', 'to', 'from', 'output', 'source', 'pattern', 'room', 'tunedFrom', 'reversedFrom', 'shiftedFrom']);
/** Tables by a name the musician typed (intensity curves by stem group): kept as typed, and read with `own`. */
const BY_NAME = new Set(['curves']);

/** An id that is a prototype name, as the song keeps it instead: the same everywhere it's used, so links between parts hold. */
const safeId = (id: string): string => (isPrototypeName(id) ? `${id}_` : id);

/**
 * A song's raw data (parsed JSON, changed in place) with no id a lookup could mistake: an id that
 * is a prototype name ("toString", "__proto__") becomes another (`toString_`) everywhere it's used:
 * in id fields, as the key of a table by id (costume swaps, state options), in "from>to" transition
 * keys and in "send:<id>" settings. Names the musician typed stay as they are (BY_NAME), and so
 * does a plugin's own state. The app never makes such ids, so its own songs come back unchanged.
 */
export function withSafeIds(raw: unknown, depth = 0, byName = false): void {
  if (depth > 16 || typeof raw !== 'object' || raw === null) return;
  if (Array.isArray(raw)) {
    for (const v of raw) withSafeIds(v, depth + 1);
    return;
  }
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    let v = o[key];
    if (typeof v === 'string') {
      const id = ID_FIELDS.has(key) ? safeId(v) : key === 'param' && v.startsWith('send:') ? `send:${safeId(v.slice(5))}` : v;
      if (id !== v) o[key] = v = id;
    }
    const renamed = byName ? key : key.includes('>') ? key.split('>').map(safeId).join('>') : safeId(key);
    if (renamed !== key) {
      delete o[key];
      if (!Object.hasOwn(o, renamed)) Object.defineProperty(o, renamed, { value: v, enumerable: true, writable: true, configurable: true });
    }
    if (key !== 'state' && typeof v === 'object') withSafeIds(v, depth + 1, BY_NAME.has(key));
  }
}
