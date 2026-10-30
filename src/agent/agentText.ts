/**
 * Text from a song (or anything else the agent hasn't written) made plain before an agent reads
 * it: the names in a song file, its ids, the words built from them. A song file can hold hidden
 * text (tag characters, zero-width and other format characters, controls, direction overrides)
 * that the musician never sees but an agent would read as words; it all goes, by the strict rule
 * the musician's own messages are kept to (plainUserText in protocol.ts). Used where the agent's
 * view of a song is built (agentSong.ts, studioReads.ts, the studio's handlers) and once more by
 * the helper on every tool answer (tools/cli mcpServer.ts). Ids are cleaned the same way, and the
 * ops find a thing by its cleaned id too (sameAgentId), so an agent can still name it.
 */
import { plainUserText } from './protocol';

/** `text` as an agent may read it: plainUserText's strict rule, no length limit (line breaks and tabs kept). */
export function agentText(text: string): string {
  return plainUserText(text, Infinity);
}

/** A name from a song as an agent reads it: agentText on one line, trimmed, at most `max` characters. */
export function agentLine(text: unknown, max = 200): string {
  return typeof text === 'string' ? agentText(text).replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Whether `given` (from an agent) names the thing whose id is `id`: the id itself, or the id as the agent read it. */
export const sameAgentId = (id: string, given: string): boolean => id === given || (typeof id === 'string' && agentText(id) === given);

/** The one in `list` an agent names by `id`: its id exactly, else the only one whose id reads as `id` made plain. */
export function byAgentId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  const exact = list.find((x) => x.id === id);
  if (exact) return exact;
  const read = list.filter((x) => sameAgentId(x.id, id));
  return read.length === 1 ? read[0] : undefined;
}

/**
 * Every string in `value` (object keys too) cleaned with agentText, for an answer to an agent.
 * Plain data in, the same shape out (a string that needs no cleaning is kept as it is).
 */
export function cleanForAgent<T>(value: T): T {
  return clean(value, 0) as T;
}

function clean(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return agentText(v);
  if (!v || typeof v !== 'object' || depth > 64) return v;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  // (only plain objects: anything else is left to JSON)
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[agentText(k)] = clean(x, depth + 1);
  return out;
}
