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
 * `name` as a file or folder name: no path characters, not only dots (".." would be a step up a
 * folder), no dots or spaces at the end (Windows drops them, so "Drop." would be "Drop"), and not
 * a name Windows keeps for a device.
 */
export function kitFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return notReserved(/^\.+$/.test(clean) ? '-' : clean.replace(/[. ]+$/, '')) || 'Untitled';
}

/**
 * `names` made unique as files: each one's kitFileName told apart from the others' and `taken`'s
 * without regard to case (Windows and macOS keep "Drop.wav" and "drop.wav" as one file), the
 * second of a pair numbered: 'Boss/Fight' and 'Boss-Fight' are 'Boss/Fight' and 'Boss-Fight 2'.
 */
export function uniqueKitNames(names: readonly string[], taken: Iterable<string> = []): string[] {
  const used = new Set([...taken].map((n) => kitFileName(n).toLowerCase()));
  return names.map((original) => {
    let name = original;
    for (let n = 2; used.has(kitFileName(name).toLowerCase()); n++) name = `${original} ${n}`;
    used.add(kitFileName(name).toLowerCase());
    return name;
  });
}
