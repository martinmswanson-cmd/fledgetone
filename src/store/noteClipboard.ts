/**
 * The piano roll's note clipboard: the notes copied or cut there (Ctrl+C, Ctrl+X), and where
 * copied notes land when pasted (Ctrl+V) or duplicated (Ctrl+D), keeping their timing and pitches.
 * It's kept while the app is open, so notes can go from one clip into another. Separate from the
 * timeline's clipboard of clips. Pure (no store), so Node can test it.
 */
import type { NoteEvent } from './timelineTypes';
import { durationToBars } from './timelineTypes';

export type CopiedNote = Omit<NoteEvent, 'id'>;

export interface NoteClip {
  /** The notes, each startOffset counted from the first one's start */
  notes: CopiedNote[];
  /** Where the first one started in its clip (bars) */
  from: number;
  /** From the first one's start to the last one's end (bars) */
  span: number;
}

const EPS = 1e-6;
/** (Sums of bar fractions drift by a hair: 0.1 + 0.2. Notes on the grid stay exactly on it) */
const tidy = (bars: number) => Math.round(bars * 1e9) / 1e9;

/** Notes as a clipboard holds them, or null for none. */
export function noteClip(notes: readonly NoteEvent[]): NoteClip | null {
  if (notes.length === 0) return null;
  const from = Math.min(...notes.map((n) => n.startOffset));
  const end = Math.max(...notes.map((n) => n.startOffset + durationToBars(n.duration)));
  return {
    // (Without their ids: each paste makes new notes)
    notes: notes.map(({ id: _id, ...n }) => ({ ...n, startOffset: tidy(n.startOffset - from) })),
    from,
    span: tidy(end - from),
  };
}

/**
 * The copied notes placed from `at` (bars from the start of a clip `length` bars long), leaving
 * out any that would start outside it.
 */
export function placeNotes(clip: NoteClip, at: number, length: number): CopiedNote[] {
  return clip.notes.map((n) => ({ ...n, startOffset: tidy(at + n.startOffset) })).filter((n) => n.startOffset >= -EPS && n.startOffset < length - EPS);
}

/** Where a duplicate goes: straight after the notes, moved on by whole grid steps (`step` bars) so it stays on the grid. */
export function duplicateAt(clip: NoteClip, step: number): number {
  return tidy(clip.from + Math.max(1, Math.ceil(clip.span / step - EPS)) * step);
}

let held: NoteClip | null = null;

/** What Ctrl+C or Ctrl+X in the piano roll took last (null: nothing yet). */
export const heldNotes = (): NoteClip | null => held;

/** Keep notes on the clipboard (Ctrl+C, Ctrl+X). */
export function holdNotes(clip: NoteClip | null): void {
  if (clip) held = clip;
}
