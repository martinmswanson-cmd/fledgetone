/**
 * Fingerprints of plain data, for telling whether something changed: stableJson writes a value as
 * JSON with every object's keys in order (so two equal objects built in a different order read the
 * same), and fingerprint hashes that text to a short string. Not for security (a suggestion's
 * fingerprints only notice edits made in the meantime); plain logic, no Web Crypto, so it's
 * synchronous in the browser and in Node.
 */

/** JSON with sorted object keys; undefined fields left out, as JSON.stringify does. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = sortKeys(v);
  }
  return out;
}

/** A 64-bit FNV-1a hash of the value's stable JSON, as 16 hex digits. */
export function fingerprint(value: unknown): string {
  const text = stableJson(value);
  // Two 32-bit FNV-1a lanes with different offsets (BigInt-free, fast enough for a whole song)
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where two plain values first differ, as "path: a → b" (empty when they're the same). */
export const firstDifference = (a: unknown, b: unknown, path = ''): string => firstDifferencePath(a, b, path, true);

/**
 * Where two plain values first differ, as a path ("fx.filter.cutoff", "notes[3].velocity"; "value"
 * for the values themselves; empty when they're the same). With `values`, the two values follow
 * ("path: a → b").
 */
export function firstDifferencePath(a: unknown, b: unknown, path = '', values = false): string {
  if (stableJson(a) === stableJson(b)) return '';
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifferencePath(a[k], b[k], path ? `${path}.${k}` : k, values);
      if (d) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      const d = firstDifferencePath(a[i], b[i], `${path}[${i}]`, values);
      if (d) return d;
    }
  }
  if (!values) return path || 'value';
  const show = (v: unknown) => (v === undefined ? 'none' : JSON.stringify(v).slice(0, 40));
  return `${path || 'value'}: ${show(a)} → ${show(b)}`;
}
