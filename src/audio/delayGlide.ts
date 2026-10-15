/**
 * How a delay-compensation delay changes length while the music plays: it glides, slowly enough
 * that the pitch bend can't be heard, rather than crossfading to the new length (see delayLink.ts,
 * which plays it). Pure maths, so the tests can check the rate and that a new glide starts where the
 * last one is.
 */

/**
 * How fast a delay glides to a new length, in seconds of delay per second: 0.5%, a pitch bend of
 * 8.6 cents while it moves, too little to hear on a held note. A compressor's 6 ms takes 1.2 s.
 */
export const GLIDE_RATE = 0.005;
/** The shortest and longest a glide takes (a longer change glides faster, to be done in time). */
export const GLIDE_MIN = 0.05;
export const GLIDE_MAX = 2;

/** A delay's glide: from `from` seconds at `start` to `to` at `end` (audio clock), in a straight line. */
export interface Glide {
  from: number;
  to: number;
  start: number;
  end: number;
}

/** The glide from `from` to `to` seconds of delay, starting at `start` (see GLIDE_RATE). */
export function planGlide(from: number, to: number, start: number): Glide {
  const length = Math.min(GLIDE_MAX, Math.max(GLIDE_MIN, Math.abs(to - from) / GLIDE_RATE));
  return { from, to, start, end: start + length };
}

/** Where a glide has the delay at `time`. */
export function glideAt(glide: Glide, time: number): number {
  if (time <= glide.start) return glide.from;
  if (time >= glide.end) return glide.to;
  return glide.from + ((glide.to - glide.from) * (time - glide.start)) / (glide.end - glide.start);
}
