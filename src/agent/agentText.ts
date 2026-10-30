/**
 * Text from a song (or anything else the agent hasn't written) made plain before an agent reads
 * it: the names in a song file, its ids, the words built from them. A song file can hold hidden
 * text (tag characters, zero-width and other format characters, controls, direction overrides)
 * that the musician never sees but an agent would read as words; it all goes, by the strict rule
 * the musician's own messages are kept to (plainUserText in protocol.ts). Used where the agent's
 * view of a song is built (agentSong.ts, studioReads.ts, the studio's handlers) and once more by
 * the helper on every tool answer (tools/cli mcpServer.ts). Ids are cleaned the same way, and the
 * ops find a thing by its cleaned id too (byAgentId), so an agent can still name it; two ids that
 * would read the same once cleaned are told apart (agentIds gives the hidden one an alias of its
 * own, the same in every answer).
 */
import { plainUserText } from './protocol';
import { fingerprint } from './fingerprint';

/** `text` as an agent may read it: plainUserText's strict rule, no length limit (line breaks and tabs kept). */
export function agentText(text: string): string {
  return plainUserText(text, Infinity);
}

/** A name from a song as an agent reads it: agentText on one line, trimmed, at most `max` characters. */
export function agentLine(text: unknown, max = 200): string {
  return typeof text === 'string' ? agentText(text).replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * The name an agent reads for an id with hidden text in it that, made plain, would read as
 * another's (or as nothing): the plain id and a short fingerprint of the id itself, so it's the
 * same in every answer (get_song, get_notes, get_view...) and always leads back to it.
 */
export const hiddenIdAlias = (id: string): string => `${agentText(id)}~${fingerprint(id).slice(0, 6)}`;

/**
 * The ids of `ids` (things of one kind: tracks, clips, the notes of a clip...) as an agent reads
 * them: an id as it is when it's plain; one with hidden text in it made plain, unless that would
 * read as another of them (or as nothing): then hiddenIdAlias, so no two read the same.
 */
export function agentIds(ids: Iterable<string>): Map<string, string> {
  const list = [...ids];
  const count = new Map<string, number>();
  for (const id of list) {
    const plain = agentText(id);
    count.set(plain, (count.get(plain) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const id of list) {
    const plain = agentText(id);
    out.set(id, plain === id ? id : plain && count.get(plain) === 1 ? plain : hiddenIdAlias(id));
  }
  return out;
}

/** A function giving each id of `list` as the agent reads it (agentIds); an id not in it made plain. */
export function agentIdOf(list: Iterable<{ id: string }>): (id: string) => string {
  const map = agentIds([...list].map((x) => x.id));
  return (id) => map.get(id) ?? agentText(id);
}

/** Whether `given` (from an agent) names the thing whose id is `id`: the id itself, the id made plain, or its hiddenIdAlias. */
export const sameAgentId = (id: string, given: string): boolean => id === given || (typeof id === 'string' && (agentText(id) === given || (id !== agentText(id) && hiddenIdAlias(id) === given)));

/**
 * The one in `list` an agent names by `id`: its id exactly; else the one whose hiddenIdAlias it
 * is; else the only one whose id reads as `id` made plain (as agentIds shows ids). Undefined when
 * none, or several, do.
 */
export function byAgentId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  if (typeof id !== 'string') return undefined;
  const exact = list.find((x) => x.id === id);
  if (exact) return exact;
  const hidden = list.filter((x) => x.id !== agentText(x.id));
  const alias = hidden.find((x) => hiddenIdAlias(x.id) === id);
  if (alias) return alias;
  const read = hidden.filter((x) => agentText(x.id) === id);
  return read.length === 1 ? read[0] : undefined;
}

/** How deep cleanForAgent goes into nested lists and objects: anything deeper is left out. */
export const CLEAN_DEPTH = 64;

/**
 * Every string in `value` (object keys too) cleaned with agentText, for an answer to an agent.
 * Plain data in, the same shape out (a string that needs no cleaning is kept as it is). Nothing
 * goes uncleaned: lists and objects nested deeper than CLEAN_DEPTH are left out (null), and so is
 * anything that isn't plain data and has no JSON of its own (a function, a class instance
 * without toJSON).
 */
export function cleanForAgent<T>(value: T): T {
  return clean(value, 0) as T;
}

function clean(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return agentText(v);
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
  // (a function, a symbol, a bigint: nothing JSON would show, or could)
  if (typeof v !== 'object' || depth >= CLEAN_DEPTH) return null;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  // (only plain objects: anything else as its JSON, if it has one, else left out: it could hold text this can't see)
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    return typeof toJSON === 'function' ? clean(toJSON.call(v), depth + 1) : null;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[agentText(k)] = clean(x, depth + 1);
  return out;
}
