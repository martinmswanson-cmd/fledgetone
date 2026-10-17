import type { Clip } from './timelineTypes';

/**
 * Linked clips ("patterns"): clips that share `pattern` play the same notes. Edit one and the
 * others follow, wherever they sit on the timeline, as a pattern does in a pattern-based DAW. Each
 * keeps its own place, length and track. What's shared: the notes, the controller lanes, the
 * groove and the wobble rate. Plain logic, so Node can unit-test it; the store runs syncPatterns
 * after every change (see timelineStore.ts).
 */

/** What linked clips share. */
const SHARED = ['notes', 'expression', 'groove', 'wobble'] as const;

/** A clip that can be linked: a note clip (an audio clip or a take folder plays its own material). */
export const canLink = (c: Clip): boolean => !c.audio && !c.takes?.length;

const sameContent = (a: Clip, b: Clip) => SHARED.every((k) => a[k] === b[k]);

/**
 * After a change from `prev` to `next`: the linked clips whose content one of their group changed,
 * given that content. Null when nothing needs to follow.
 *
 * - A member edited on its own (its notes, lanes, groove…) passes its content to the rest of its
 *   pattern.
 * - A member whose content changed together with its start or length (a trim of its start, which
 *   moves its notes to keep them in place, or the halves of a split) is an edit of that clip's
 *   frame, not of the pattern: it leaves the pattern instead, and the rest stay as they were.
 * - When every member changed at once (an undo, a redo, a project opened), they're left as they are.
 * - A new clip carrying a pattern but not its content (the right half of a split, a copy with
 *   fresh notes) is its own clip: it leaves the pattern. "Duplicate linked" copies share the content.
 */
export function syncPatterns(prev: readonly Clip[], next: readonly Clip[]): Clip[] | null {
  if (prev === next || !next.some((c) => c.pattern)) return null;
  const before = new Map(prev.map((c) => [c.id, c]));
  const groups = new Map<string, Clip[]>();
  for (const c of next) if (c.pattern) groups.set(c.pattern, [...(groups.get(c.pattern) ?? []), c]);
  const replace = new Map<string, Clip>();
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    // (Compared with a member this change didn't touch, where there is one)
    const old = members.find((c) => before.has(c.id) && sameContent(before.get(c.id)!, c)) ?? members.find((c) => before.has(c.id));
    if (old) for (const c of members) if (!before.has(c.id) && !sameContent(c, old)) replace.set(c.id, unlinked(c));
    const changed = members.filter((c) => {
      const old = before.get(c.id);
      return old !== undefined && old.pattern === c.pattern && !sameContent(old, c);
    });
    const kept = members.filter((c) => !replace.has(c.id));
    if (!changed.length || changed.length === kept.length) continue;
    // Edits of a clip's frame take it out of the pattern
    const framed = changed.filter((c) => {
      const old = before.get(c.id)!;
      return Math.abs(old.startBar - c.startBar) > 1e-9 || Math.abs(old.lengthBars - c.lengthBars) > 1e-9;
    });
    for (const c of framed) replace.set(c.id, unlinked(c));
    const source = changed.find((c) => !framed.includes(c));
    if (!source) continue;
    for (const c of kept) {
      if (c === source || framed.includes(c) || sameContent(c, source)) continue;
      replace.set(c.id, withContent(c, source));
    }
  }
  return replace.size ? next.map((c) => replace.get(c.id) ?? c) : null;
}

/** `clip` with `from`'s shared content (the same arrays: nothing is copied until one is edited). */
export function withContent(clip: Clip, from: Clip): Clip {
  const out: Clip = { ...clip };
  for (const k of SHARED) {
    if (from[k] === undefined) delete (out as Partial<Clip>)[k];
    else (out as unknown as Record<string, unknown>)[k] = from[k];
  }
  return out;
}

/** The clip on its own again: its own copy of what it played, linked to nothing. */
export function unlinked(clip: Clip): Clip {
  const { pattern: _pattern, ...rest } = clip;
  return rest;
}

/** How many clips play pattern `id` (a clip whose pattern no other clip plays is as good as unlinked). */
export const patternSize = (clips: readonly Clip[], id: string | undefined): number => (id ? clips.filter((c) => c.pattern === id).length : 0);

/**
 * A short name for each pattern with two or more clips, for the badge on its clips: "P1", "P2"…
 * in the order the patterns first appear on the timeline (left to right).
 */
export function patternLabels(clips: readonly Clip[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of clips) if (c.pattern) counts.set(c.pattern, (counts.get(c.pattern) ?? 0) + 1);
  const order = [...clips].filter((c) => c.pattern && counts.get(c.pattern)! > 1).sort((a, b) => a.startBar - b.startBar);
  const out = new Map<string, string>();
  for (const c of order) if (!out.has(c.pattern!)) out.set(c.pattern!, `P${out.size + 1}`);
  return out;
}

let labelMemo: { clips: readonly Clip[]; labels: Map<string, string> } | null = null;
/** A pattern's label (see patternLabels), worked out once per change of the clips; null for a clip that plays alone. */
export function patternLabelOf(clips: readonly Clip[], id: string | undefined): string | null {
  if (!id) return null;
  if (labelMemo?.clips !== clips) labelMemo = { clips, labels: patternLabels(clips) };
  return labelMemo.labels.get(id) ?? null;
}
