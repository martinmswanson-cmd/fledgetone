/**
 * What the command line prints, made safe for a terminal: every line to stdout and stderr goes
 * through here (printOut, printErr), the errors too. A song or suggestion file is anyone's, and
 * its names (or an agent's title) could hold terminal escapes (ESC, CSI and the other C0 and C1
 * controls: colours, a cleared screen, a changed window title, a link) or invisible format
 * characters (direction overrides that show text backwards, zero-width and tag characters):
 * they're taken out. Tabs and line breaks stay (line and paragraph separators become line breaks).
 */

// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu;

/** `text` without controls (but tab and line feed) or format characters. */
export function safeText(text: string): string {
  return text.replace(/[\u2028\u2029]/g, '\n').replace(UNSAFE, '');
}

const line = (text: string) => safeText(text.endsWith('\n') ? text : text + '\n');

/** A line (or lines) to stdout, made safe. */
export const printOut = (text: string): void => {
  process.stdout.write(line(text));
};

/** A line (or lines) to stderr, made safe. */
export const printErr = (text: string): void => {
  process.stderr.write(line(text));
};
