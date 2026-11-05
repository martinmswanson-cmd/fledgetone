/**
 * File names for what the game kit and the Game tab export: one cleaning rule for every name that
 * becomes a file or folder in a zip, so names that look different can't end up as the same file.
 * No audio or store here, so Node can unit-test it.
 */

/**
 * The names Windows keeps for devices ("CON", "nul.wav", "COM1.txt"), any case, with or without
 * an extension: a file can't be called that there.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\s*(\.|$))/i;

/** `name` with "_" added when Windows keeps it for a device ("NUL" is "NUL_", "con.txt" is "con_.txt"). */
export const notReserved = (name: string) => name.replace(RESERVED, '$1_');

/**
 * `name` with no control characters (a tab, an escape, NUL: Windows refuses them in a file name
 * and a zip reader stops a name at NUL) and no invisible marks that turn text round or hide in it.
 * Each control character is a "-"; the joiner inside emoji is kept.
 */
export const noControls = (name: string) => name.replace(/\p{Cc}+/gu, '-').replace(/(?!\u200D)\p{Cf}/gu, '');

/**
 * The most a file or folder name made from a name may take, in UTF-8 bytes. Most file systems
 * allow 255 per name: this leaves room for an extension and a few words added after it.
 */
export const MAX_NAME_BYTES = 200;

const encoder = new TextEncoder();
/** How many bytes `text` takes in UTF-8. */
export const utf8Bytes = (text: string) => encoder.encode(text).length;

// (Whole characters as people see them: a letter and its accents, an emoji and its modifiers)
const graphemes: { segment(text: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/**
 * `text` cut to at most `max` UTF-8 bytes, at a whole character: never half an emoji or a letter
 * without the accent written after it (one character longer than `max` on its own is cut between
 * its code points, which still leaves valid text).
 */
export function cutToBytes(text: string, max = MAX_NAME_BYTES): string {
  // (A UTF-16 unit is at most 3 bytes: most names need no counting)
  if (text.length * 3 <= max || utf8Bytes(text) <= max) return text;
  let out = '';
  let used = 0;
  for (const { segment } of graphemes ? graphemes.segment(text) : Array.from(text, (segment) => ({ segment }))) {
    const size = utf8Bytes(segment);
    if (used + size <= max) {
      out += segment;
      used += size;
      continue;
    }
    for (const point of out ? [] : segment) {
      const n = utf8Bytes(point);
      if (used + n > max) break;
      out += point;
      used += n;
    }
    break;
  }
  return out;
}

/**
 * `name` as a file or folder name: no path characters, not only dots (".." would be a step up a
 * folder), no dots or spaces at the end (Windows drops them, so "Drop." would be "Drop"), not
 * a name Windows keeps for a device, and at most MAX_NAME_BYTES long.
 */
export function kitFileName(name: string): string {
  const clean = noControls(name).replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (/^\.+$/.test(clean)) return '-';
  // (Cut after the device check, so the "_" it adds fits; and checked again, in case the cut left "con")
  return notReserved(cutToBytes(notReserved(clean)).replace(/[. ]+$/, '')) || 'Untitled';
}

/**
 * What two names that are the same file have in common: the file name without regard to case
 * (Windows and macOS keep "Drop.wav" and "drop.wav" as one file) or to how an accent is written.
 */
export const kitNameKey = (name: string) => kitFileName(name).normalize('NFC').toLowerCase();

/**
 * `names` made unique as files: each one's kitFileName told apart from the others' and `taken`'s
 * by kitNameKey, the second of a pair numbered: 'Boss/Fight' and 'Boss-Fight' are 'Boss/Fight'
 * and 'Boss-Fight 2'. `taken` gets the names chosen added when it's a Set of keys (so one Set can
 * keep a whole folder's names across calls). `join` goes before the number (" ", or "_" for sound
 * effects). A name cut for length is cut a little more before its number, so the number stays.
 */
export function uniqueKitNames(names: readonly string[], taken: Iterable<string> = [], join = ' '): string[] {
  const used = taken instanceof KeySet ? taken : new Set([...taken].map(kitNameKey));
  return names.map((original) => {
    let name = original;
    for (let n = 2; used.has(kitNameKey(name)); n++) {
      name = `${original}${join}${n}`;
      if (!kitFileName(name).endsWith(`${join}${n}`)) name = `${cutToBytes(original, MAX_NAME_BYTES - 12)}${join}${n}`;
    }
    used.add(kitNameKey(name));
    return name;
  });
}

/** A Set of kitNameKeys: what uniqueKitNames adds its choices to (see kitFiles). */
export class KeySet extends Set<string> {}

/**
 * The file names for one zip, chosen in one place: every file in a folder told apart from the
 * others there (by kitNameKey), whichever part of the kit it's for. `file(folder, name)` is the
 * name, cleaned and numbered if another file there has it already; `join` as uniqueKitNames.
 */
export function kitFiles() {
  const folders = new Map<string, KeySet>();
  return (folder: string, name: string, join = ' '): string => {
    const at = folder.toLowerCase();
    let taken = folders.get(at);
    if (!taken) folders.set(at, (taken = new KeySet()));
    return kitFileName(uniqueKitNames([name], taken, join)[0]);
  };
}

/** Characters that end a line or a paragraph, and tabs. */
const LINE_BREAKS = /[\r\n\t\v\f\u0085\u2028\u2029]+/g;
/** The marks that turn text round (a right-to-left override or isolate). */
const TURNS = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * A name read from a song file, on one line: line breaks, paragraph breaks and tabs each a space,
 * other control characters (an escape, NUL) and marks that turn the text round left out. A name
 * with none of those is returned as it is (spaces and all); one that had some is trimmed.
 */
export function oneLineName(name: string): string {
  const clean = name.replace(LINE_BREAKS, ' ').replace(/\p{Cc}+/gu, '').replace(TURNS, '');
  return clean === name ? name : clean.trim();
}

/** The longest a name may be in a README or another text the app writes (in characters). */
export const TEXT_NAME_MAX = 80;

/** `text` cut to at most `max` characters as people see them (never half an emoji). */
function cutToChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  let count = 0;
  for (const { segment } of graphemes ? graphemes.segment(text) : Array.from(text, (segment) => ({ segment }))) {
    if (count++ >= max) break;
    out += segment;
  }
  return out;
}

/**
 * A name as a README or another generated text writes it: no control characters (an escape
 * would run in a terminal that shows the file), line breaks and tabs a space (so a name can't
 * add lines of its own to the file), and at most TEXT_NAME_MAX characters.
 */
export const textName = (name: string, max = TEXT_NAME_MAX): string => cutToChars(noControls(name.replace(LINE_BREAKS, ' ')), max);

const WORD = /[\p{L}\p{N}]/u;

/**
 * A name as a Markdown file writes it: textName, then nothing in it that Markdown reads as
 * formatting: \ ` * _ [ ] < > # | escaped, and a "-", "+" or "1." at its start too (it would
 * start a list). A "_" inside a word stays as it is ("sword_hit"): Markdown never reads that one.
 */
export function markdownName(name: string, max = TEXT_NAME_MAX): string {
  return textName(name, max)
    .replace(/[\\`*[\]<>#|]/g, '\\$&')
    .replace(/_/g, (m, i: number, s: string) => (WORD.test(s[i - 1] ?? '') && WORD.test(s[i + 1] ?? '') ? m : '\\_'))
    .replace(/^(\s*)([-+])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

/**
 * A state's file name in a costume, "Boss (Night)": the state's part cut so the costume's still
 * fits, both already file names.
 */
export function costumeFileName(stateFile: string, costumeFile: string): string {
  const tail = ` (${costumeFile})`;
  return `${cutToBytes(stateFile, MAX_NAME_BYTES - utf8Bytes(tail))}${tail}`;
}
