/**
 * Audio clips with work under way on their sound (a mangle, a tune, a move into a key, a double or
 * a voice chop, each of which reads the clip's sound and writes a new one back when it's done), so
 * nothing else swaps that sound meanwhile: soundUpgrade.ts leaves a held clip alone until it's let
 * go. No audio or store here, so Node can unit-test it.
 */

const held = new Map<string, number>();

/** Hold clip `clipId` while work on its sound is under way; call what's returned when it's done. */
export function holdClip(clipId: string): () => void {
  held.set(clipId, (held.get(clipId) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (held.get(clipId) ?? 1) - 1;
    if (left > 0) held.set(clipId, left);
    else held.delete(clipId);
  };
}

/** Whether work on clip `clipId`'s sound is under way. */
export const clipHeld = (clipId: string): boolean => held.has(clipId);

/** `work` with clip `clipId` held while it runs. */
export async function withClipHeld<T>(clipId: string, work: () => Promise<T>): Promise<T> {
  const release = holdClip(clipId);
  try {
    return await work();
  } finally {
    release();
  }
}
