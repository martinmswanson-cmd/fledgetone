/**
 * How a guitarist's hand plays a chord written as one block (all its notes at the same moment):
 * the pick crosses the strings one after another, so the notes start a few milliseconds apart, low
 * to high on a downstroke and high to low on an upstroke. A strum that follows another closely is
 * the hand coming back up (strumming hands move down and up without stopping); one after a pause
 * starts down again. A harder strum crosses the strings faster, a short chord is strummed quicker
 * so it isn't smeared, and the strings the pick reaches last sound a little softer (an upstroke
 * mostly catches the top strings, so its lowest are softer still). Every strum differs a little
 * from the last (seeded from the chord and its time, so an export comes out the same every time).
 *
 * Pure numbers: samplerManager.ts plays the plan. Chords already spread in the notes (the Strum
 * tool, the starters' strummed parts, the Human insert) arrive one note at a time and aren't
 * touched.
 */

/** The instruments strummed this way: the guitars, and the banjos and mandolin, which are strummed too. */
export const STRUMMED: ReadonlySet<string> = new Set([
  'guitar', 'nylonGuitar', 'steelGuitar', 'electricGuitar', 'cleanGuitar', 'jazzGuitar', 'distortionGuitar', 'overdriveGuitar', 'mutedGuitar',
  'realGuitar', 'realCrunchGuitar', 'realLeadGuitar', 'realHollowGuitar', 'realFlatwoundGuitar', 'realNylonGuitar',
  'banjo', 'realBanjo', 'mandolin',
]);

/** One string of a strum: when it sounds after the chord's time (seconds) and its gain (1 = as played). */
export interface StrummedNote {
  index: number;
  delay: number;
  gain: number;
}

/** The last strum a voice played (for the next one's direction). */
export interface LastStrum {
  at: number;
  down: boolean;
}

/** Seconds between strings at full velocity and at the softest (a hard strum is quicker) */
export const STRING_GAP_LOUD = 0.006;
export const STRING_GAP_SOFT = 0.015;
/** An upstroke crosses the strings this much quicker (the hand's wrist flick) */
const UP_QUICKER = 0.8;
/** A strum lasts at most this long (seconds), and at most this share of the chord's length */
export const STRUM_MOST = 0.045;
const STRUM_SHARE = 0.25;
/** A strum within this many seconds after a downstroke is the hand coming back up */
export const UPSTROKE_WITHIN: readonly [number, number] = [0.08, 0.42];
/** dB the last string of a downstroke sounds under the first */
const DOWN_TILT_DB = 2;
/** On an upstroke, the strings past the first three it reaches sound this many dB softer */
const UP_LOW_DB = 4;
/** How much each string's timing (a share of the gap) and each strum's level (dB) vary */
const TIMING_WOBBLE = 0.25;
const LEVEL_WOBBLE_DB = 0.8;

/** A number from -1 to 1 from a seed and a salt (repeatable). */
function wobble(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * The strum of a chord of `midis` (any order) starting at `at` (seconds), `length` seconds long, at
 * `velocity` (0..1), after the voice's `last` strum: each note's delay and gain, and the strum to
 * remember. A single note plays as written. `seed` makes each strum's small differences (hash the
 * chord and its time).
 */
export function strumPlan(midis: readonly number[], at: number, length: number, velocity: number, last: LastStrum | null, seed: number): { notes: StrummedNote[]; strum: LastStrum | null } {
  if (midis.length < 2) return { notes: midis.map((_, index) => ({ index, delay: 0, gain: 1 })), strum: null };
  const since = last ? at - last.at : Infinity;
  const down = !(last?.down && since >= UPSTROKE_WITHIN[0] && since <= UPSTROKE_WITHIN[1]);
  const v = Math.max(0, Math.min(1, velocity));
  let gap = STRING_GAP_SOFT + (STRING_GAP_LOUD - STRING_GAP_SOFT) * v;
  if (!down) gap *= UP_QUICKER;
  const n = midis.length;
  // The whole strum fits the chord: at most STRUM_MOST, and a quarter of a short chord
  gap = Math.min(gap, Math.min(STRUM_MOST, STRUM_SHARE * Math.max(0, length)) / (n - 1));
  // Low to high on a downstroke, high to low on an upstroke
  const order = midis.map((m, index) => ({ m, index })).sort((a, b) => (down ? a.m - b.m : b.m - a.m) || a.index - b.index);
  const level = 10 ** ((LEVEL_WOBBLE_DB * wobble(seed, 7)) / 20);
  let delay = 0;
  const notes = order.map(({ index }, k) => {
    if (k > 0) delay += gap * (1 + TIMING_WOBBLE * wobble(seed, 11 + k));
    const tilt = down ? (-DOWN_TILT_DB * k) / (n - 1) : k >= 3 ? -UP_LOW_DB : 0;
    return { index, delay: Math.max(0, delay), gain: level * 10 ** (tilt / 20) };
  });
  return { notes: notes.sort((a, b) => a.index - b.index), strum: { at, down } };
}
