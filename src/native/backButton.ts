/**
 * The phone's Back button (Android): what it closes. Whatever is open over the screen registers
 * how to close itself while it's open (a sheet, a dialog); the screens underneath register how to
 * go back from where they are (Pocket's starters screen, the full piano roll). Back runs the
 * newest that has something to do. With nothing left, the app goes to the background
 * (appLifecycle.ts), as Home would, rather than closing and losing its place.
 */

/** Goes back one step; false when there's nothing to go back from (then the next one is asked). */
export type BackStep = () => boolean;

const steps: BackStep[] = [];

/** Register a way back (newest first). Returns the way to remove it. */
export function onBack(step: BackStep): () => void {
  steps.push(step);
  return () => {
    const i = steps.lastIndexOf(step);
    if (i >= 0) steps.splice(i, 1);
  };
}

/** Go back one step: the newest way back that does something. False if none did. */
export function goBack(): boolean {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]()) return true;
  return false;
}

/**
 * A dialog of the studio's that's open (they close on Escape): Back sends it an Escape. True if
 * there was one.
 */
export function escapeOpenDialog(doc: Document = document): boolean {
  const open = doc.querySelectorAll('[role="dialog"], [aria-modal="true"]');
  if (!open.length) return false;
  // (From the newest dialog itself: its own handler, the page's and the window's all hear it)
  open[open.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return true;
}
