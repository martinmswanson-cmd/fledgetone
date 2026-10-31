/**
 * Math.max and Math.min over numbers and lists of numbers, without spreading the lists into a
 * call's arguments: `Math.max(...list)` overflows the call stack once a list runs to a hundred
 * thousand or so (a clip's notes, a lane's points, a sound's samples), and the studio would stop
 * showing. Same answers as Math.max / Math.min: -Infinity / Infinity for nothing at all, NaN if
 * any value is NaN.
 */

type Values = number | Iterable<number>;

/** The largest of the numbers given, lists included: `maxOf(1, notes.map(f))` is `Math.max(1, ...notes.map(f))`. */
export function maxOf(...items: Values[]): number {
  let best = -Infinity;
  for (const item of items) {
    if (typeof item === 'number') best = Math.max(best, item);
    else for (const v of item) best = Math.max(best, v);
  }
  return best;
}

/** The smallest of the numbers given, lists included: `minOf(notes.map(f), 127)` is `Math.min(...notes.map(f), 127)`. */
export function minOf(...items: Values[]): number {
  let best = Infinity;
  for (const item of items) {
    if (typeof item === 'number') best = Math.min(best, item);
    else for (const v of item) best = Math.min(best, v);
  }
  return best;
}
