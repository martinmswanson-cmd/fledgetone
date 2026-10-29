/**
 * The song's revision for the agent: a count that goes up whenever an undo step's worth of the
 * song changes (any field undo restores, see songParts in timelineStore.ts), so a suggestion made
 * at one revision can tell whether the song has moved on, and the agent hears of every edit. Each
 * part is compared by reference (edits replace objects rather than change them), the shared
 * reverb and delay settings by value (they're rebuilt on every read). Plain logic.
 */

/** The song's parts as undo sees them: the fields of songParts(s). */
export type Parts = Record<string, unknown>;

/** Whether two readings of the song's parts differ. */
export function partsChanged(a: Parts, b: Parts): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'masterFx' ? JSON.stringify(a[k]) !== JSON.stringify(b[k]) : a[k] !== b[k]) return true;
  }
  return false;
}

/** Counts changes of the song's parts: update() with each new reading gives the revision now. */
export class RevisionCounter {
  private last: Parts | null = null;
  revision = 0;
  /** The revision after this reading (one more than before if anything changed). */
  update(parts: Parts): number {
    if (this.last && partsChanged(this.last, parts)) this.revision++;
    this.last = parts;
    return this.revision;
  }
}
