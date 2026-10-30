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
 * own, the same in every answer, never one another id already reads as).
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
 * same in every answer (get_song, get_notes, get_view...) and always leads back to it. `length`:
 * how many of the fingerprint's characters (more when the short one is taken: see agentIds).
 */
export const hiddenIdAlias = (id: string, length = 6): string => `${agentText(id)}~${fingerprint(id).slice(0, length)}`;

/**
 * The ids of `ids` (things of one kind: tracks, clips, the notes of a clip...) as an agent reads
 * them, each naming one thing only. A plain id is itself (and taken). One with hidden text in it
 * reads made plain, if no other id reads so (plain or hidden); else as hiddenIdAlias, its
 * fingerprint lengthened while that's taken too (an id crafted to equal another's alias), and a
 * counter after it as a last resort. The hidden ones are named in the order of their ids, so the
 * names don't depend on the order of the list: the same song always reads the same.
 */
export function agentIds(ids: Iterable<string>): Map<string, string> {
  const list = [...new Set(ids)];
  const named = new Map<string, string>();
  const taken = new Set<string>();
  const hidden: string[] = [];
  for (const id of list) {
    if (agentText(id) === id) {
      named.set(id, id);
      taken.add(id);
    } else hidden.push(id);
  }
  if (!hidden.length) return named;
  hidden.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // (a plain reading only for one that no other id reads as)
  const reads = new Map<string, number>();
  for (const id of hidden) {
    const plain = agentText(id);
    reads.set(plain, (reads.get(plain) ?? 0) + 1);
  }
  const later: string[] = [];
  for (const id of hidden) {
    const plain = agentText(id);
    if (plain && !taken.has(plain) && reads.get(plain) === 1) {
      named.set(id, plain);
      taken.add(plain);
    } else later.push(id);
  }
  for (const id of later) {
    let name = '';
    for (const length of [6, 8, 10, 12, 16]) {
      name = hiddenIdAlias(id, length);
      if (!taken.has(name)) break;
    }
    for (let n = 2; taken.has(name); n++) name = `${hiddenIdAlias(id, 16)}-${n}`;
    named.set(id, name);
    taken.add(name);
  }
  // (in the list's order)
  return new Map(list.map((id) => [id, named.get(id)!]));
}

/** A function giving each id of `list` as the agent reads it (agentIds); an id not in it made plain. */
export function agentIdOf(list: Iterable<{ id: string }>): (id: string) => string {
  const map = agentIds([...list].map((x) => x.id));
  return (id) => map.get(id) ?? agentText(id);
}

/** Each list's things by the ids the agent reads (agentIds), worked out once per list (lists are replaced, never changed, on an edit). */
const readBack = new WeakMap<readonly { id: string }[], Map<string, { id: string }>>();

/**
 * The one in `list` an agent names by `id`: the thing whose id agentIds gives as `id`, looked up
 * the way the agent was given it (never an id matched as it is first: a plain id that equals a
 * hidden one's reading would then name two things). Undefined when none does.
 */
export function byAgentId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  if (typeof id !== 'string') return undefined;
  let back = readBack.get(list);
  if (!back) {
    back = new Map();
    const names = agentIds(list.map((x) => x.id));
    for (const x of list) {
      const name = names.get(x.id)!;
      if (!back.has(name)) back.set(name, x);
    }
    readBack.set(list, back);
  }
  return back.get(id) as T | undefined;
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

/** How much of a value an agent gave an error quotes back to it, characters. */
export const GIVEN_MAX = 40;

/**
 * A value an agent gave (an id, a key, a pitch...), as an error may quote it back to it: made
 * plain (agentLine), at most GIVEN_MAX characters (an ellipsis if cut), in JSON quotes. Never put
 * on the musician's screen: what's shown there names the field, not what the agent wrote in it.
 */
export function givenText(value: unknown, max = GIVEN_MAX): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const chars = [...agentLine(text, Infinity)];
  return JSON.stringify(chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join(''));
}

/** A key an agent gave, for a path in an error: as it is when it's a plain name, else givenText in brackets. */
export const givenKey = (key: string): string => (/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) ? key : `[${givenText(key)}]`);

/**
 * A value as the musician may read it in the app's own words (what changes, a caution): only a
 * plain word or number the app itself knows of (letters, digits, spaces and - _ . # + /, at most 24
 * characters, nothing hidden); null for anything else, which the words then leave out.
 */
export function plainToken(value: unknown, max = 24): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string' || value.length > max || agentText(value) !== value) return null;
  return /^[A-Za-z0-9][A-Za-z0-9 _.#+/-]*$/.test(value) ? value : null;
}
