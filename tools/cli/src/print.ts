/**
 * What the command line prints, made safe for a terminal: every line to stdout and stderr goes
 * through here (printOut, printErr), the errors too. A song or suggestion file is anyone's, and
 * its names (or an agent's title) could hold terminal escapes (ESC, CSI and the other C0 and C1
 * controls: colours, a cleared screen, a changed window title, a link) or invisible format
 * characters (direction overrides that show text backwards, zero-width and tag characters):
 * they're taken out, as the studio takes them out of the musician's messages to the agent
 * (plainUserText: every default-ignorable character too, variation selectors, fillers, blank
 * braille on its own), keeping what writing needs: an emoji's joiners and presentation selector, the
 * flags of England, Scotland and Wales, a direction mark next to text. Tabs and line breaks stay
 * (line and paragraph separators become line breaks; a carriage return goes).
 */
import { plainUserText } from '../../../src/agent/protocol';

/** Anything plainUserText might take out (most lines have none, and are printed as they are). */
// eslint-disable-next-line no-control-regex
const SUSPECT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u2800\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** `text` without controls (but tab and line feed), format or other invisible characters. */
export function safeText(text: string): string {
  if (!SUSPECT.test(text)) return text;
  return plainUserText(text.replace(/\r/g, ''), Infinity);
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
