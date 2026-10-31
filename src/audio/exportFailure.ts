/**
 * What the Export dialog says when a render fails. The app's own errors are already in plain
 * words and are shown as they are; one from the browser itself (a file too long for the memory it
 * has, an audio or video encoder that gave up) is code talk, so it's put plainly instead.
 */
export const BROWSER_FAILED =
  "the browser couldn't make this file. It may be too long for the memory the browser has: try a shorter range, a lower sample rate, or WAV in place of a compressed format.";

/** Errors the app made from one the browser gave (sent on from a Worker, see dspRun.ts): its words are the browser's. */
const browsers = new WeakSet<Error>();

/** An Error with the browser's own `message` (one that came from elsewhere, e.g. a Worker, as text). */
export function browserError(message: string): Error {
  const err = new Error(message);
  browsers.add(err);
  return err;
}

/**
 * Whether `err` is the browser's own (its words are code talk): not an Error, a DOMException or a
 * built-in error kind, or one made from one (browserError); not the app's Error or its own kinds.
 */
export function isBrowserError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  return (typeof DOMException !== 'undefined' && err instanceof DOMException) || err instanceof RangeError || err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError || err instanceof EvalError || err instanceof URIError || browsers.has(err);
}

/** The words for a failed export (after "Export failed: "). */
export function exportFailureWords(err: unknown): string {
  return !(err instanceof Error) || isBrowserError(err) || !err.message.trim() ? BROWSER_FAILED : err.message;
}

/** `err`'s words to go on from the app's own sentence: its message if it's the app's, else the browser wording (capitalised). */
export function causeWords(err: unknown): string {
  const words = exportFailureWords(err);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
