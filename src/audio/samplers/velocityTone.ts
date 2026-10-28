/**
 * How bright a recorded instrument's note is for its velocity when it plays expressively: the
 * cutoff of the low-pass each note goes through (samplerManager.ts). Pure, so Node can test it.
 *
 * - From velocity FULL_TONE up, no darkening at all: the recording as it was made (the filter is
 *   left out).
 * - Below it the cutoff falls smoothly from 20 kHz, `depth` octaves lower at the softest, so a
 *   soft note is darker, not just quieter, as with SFZ's fil_veltrack.
 * - Never under FLOOR Hz, so a low note keeps its pick, hammer and string definition (the curve
 *   used to start from the note's 48th harmonic at full velocity, which put an E1 bass under 2 kHz
 *   however hard it was played, and fell from there). A floor at the 48th harmonic would leave a
 *   middle C's softest notes over 12 kHz, hardly darker at all; at 7 kHz every note still darkens.
 */

/** The velocity from which a note plays as recorded (no low-pass). */
export const FULL_TONE = 0.9;
/** The cutoff at and above FULL_TONE, Hz: open (the filter is left out). */
export const OPEN_CUTOFF = 20000;
/** The lowest cutoff, Hz (see the top). */
export const FLOOR = 7000;

/** A note's low-pass cutoff (Hz) for `velocity` (0..1), `depth` octaves of darkening, at `noteHz`. */
export function expressiveCutoff(velocity: number, depth: number, noteHz: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  if (v >= FULL_TONE) return OPEN_CUTOFF;
  // (and never under the note's own 3rd harmonic, for the highest notes)
  return Math.max(FLOOR, 3 * noteHz, OPEN_CUTOFF * 2 ** (-depth * ((FULL_TONE - v) / FULL_TONE)));
}
