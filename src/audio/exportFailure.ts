/**
 * What the Export dialog says when a render fails. The app's own errors are already in plain
 * words and are shown as they are; one from the browser itself (a file too long for the memory it
 * has, an audio or video encoder that gave up) is code talk, so it's put plainly instead.
 */
export const BROWSER_FAILED =
  "the browser couldn't make this file. It may be too long for the memory the browser has: try a shorter range, a lower sample rate, or WAV in place of a compressed format.";

/** The words for a failed export (after "Export failed: "). */
export function exportFailureWords(err: unknown): string {
  if (!(err instanceof Error)) return BROWSER_FAILED;
  // (the browser's own: DOMException and the built-in error kinds, not the app's Error or its own kinds)
  const builtIn = (typeof DOMException !== 'undefined' && err instanceof DOMException) || err instanceof RangeError || err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError || err instanceof EvalError || err instanceof URIError;
  return builtIn || !err.message.trim() ? BROWSER_FAILED : err.message;
}
