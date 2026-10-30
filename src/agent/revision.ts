/**
 * The song's revision for the agent: a count that goes up whenever an undo step's worth of the
 * song changes (any field undo restores, see songParts in timelineStore.ts), so a suggestion made
 * at one revision can tell whether the song has moved on, and the agent hears of every edit. Each
 * part is compared by reference (edits replace objects rather than change them), the shared
 * reverb and delay settings by value (they're rebuilt on every read), and the clips and tracks
 * one by one without what only the screen holds (VIEW_ONLY: a clip selected or not, a folder
 * folded or not), so selecting a clip isn't an edit (nor something an agent that may not see the
 * selection hears of). Plain logic.
 */

/** The song's parts as undo sees them: the fields of songParts(s). */
export type Parts = Record<string, unknown>;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null;

/** Two objects alike but for the fields in `skip` (each field by reference). */
function alikeBut(a: Obj, b: Obj, skip: readonly string[]): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!skip.includes(k) && a[k] !== b[k]) return false;
  return true;
}

/** What only the screen holds: a clip's selection, and a track's folder folded (which has no undo step). */
export const VIEW_ONLY = { clip: ['isSelected'], folder: ['collapsed'] } as const;

const sameClip = (a: unknown, b: unknown) => a === b || (isObj(a) && isObj(b) && alikeBut(a, b, VIEW_ONLY.clip));
const sameTrack = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b) || !alikeBut(a, b, ['folder'])) return false;
  return a.folder === b.folder || (isObj(a.folder) && isObj(b.folder) && alikeBut(a.folder, b.folder, VIEW_ONLY.folder));
};
const sameList = (a: unknown, b: unknown, same: (x: unknown, y: unknown) => boolean) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i])));

/** Whether two readings of the song's parts differ (in more than what only the screen holds). */
export function partsChanged(a: Parts, b: Parts): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const same = k === 'masterFx' ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : k === 'clips' ? sameList(a[k], b[k], sameClip) : k === 'tracks' ? sameList(a[k], b[k], sameTrack) : a[k] === b[k];
    if (!same) return true;
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
