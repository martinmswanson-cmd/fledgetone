/**
 * Distortion curves for the heavy bass tools (the 808 designer and the Bass Drive insert): warm
 * tube saturation, hard clipping, wave folding and bit crushing, each as a WaveShaper curve with
 * the drive built in. Pure maths (no Web Audio), so Node tests check their shape and level.
 *
 * Every curve maps -1..1 to -1..1, passes 0 to 0 (silence stays silent, and a voice faded to 0
 * through it is silent) and is odd (no DC offset, which would thump as notes start and stop).
 * `driveMakeup` says how much to turn the result down so a harder setting isn't simply louder.
 */

/** The four ways to distort: smooth (tube), flat-topped (hard), folding back (fold), stepped (crush). */
export const DRIVE_CHARACTERS = ['tube', 'hard', 'fold', 'crush'] as const;
export type DriveCharacter = (typeof DRIVE_CHARACTERS)[number];

/** Names for the menus. */
export const DRIVE_CHARACTER_LABELS: Record<DriveCharacter, string> = { tube: 'Warm tube', hard: 'Hard clip', fold: 'Fold', crush: 'Bitcrush' };

/** Points in a curve: fine enough that the steps between them are far below hearing. */
const POINTS = 4097;

/** How hard a drive of 0..1 pushes into the curve (1 = clean, about 24 dB at 1). */
export const driveGain = (drive: number): number => 1 + 15 * Math.max(0, Math.min(1, drive)) ** 1.5;

/** Bits a crush of drive 0..1 leaves: 12 (just grainy) down to 4 (broken). */
export const crushBits = (drive: number): number => Math.round(12 - 8 * Math.max(0, Math.min(1, drive)));

/** One input value (-1..1) through `character` at `drive` (0..1). */
export function shape(x: number, character: DriveCharacter, drive: number): number {
  const g = driveGain(drive);
  const v = x * g;
  switch (character) {
    case 'tube':
      // tanh, normalized so a full-scale input still reaches 1
      return Math.tanh(v) / Math.tanh(g);
    case 'hard': {
      // Straight up to a knee at 0.9, then a quick round-off to 1: a flat top without the sharp
      // corner that would add the most fold-back (aliasing)
      const a = Math.abs(v);
      const y = a <= 0.9 ? a : 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
      return Math.sign(v) * Math.min(1, y);
    }
    case 'fold':
      // A sine folder: below 1 it bends gently, above it the wave folds back on itself
      return Math.sin((Math.PI / 2) * v * 0.8);
    case 'crush': {
      const levels = 2 ** (crushBits(drive) - 1);
      // Saturated a little first, so louder notes don't just clip on the top step
      const s = Math.tanh(x * (1 + 2 * drive)) / Math.tanh(1 + 2 * drive);
      return Math.round(s * levels) / levels;
    }
  }
}

/** A WaveShaper curve for `character` at `drive`, scaled by `post`. */
export function driveCurveFor(character: DriveCharacter, drive: number, post = 1): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i++) curve[i] = post * shape((i / (POINTS - 1)) * 2 - 1, character, drive);
  return curve;
}

/**
 * The gain that brings a sine of amplitude `level` back to the loudness (RMS) it had before the
 * curve: so turning the drive up adds harmonics, not level. Never boosts by more than 2x (a
 * crushed quiet sine rounds to nearly nothing; it shouldn't be pushed back up).
 */
export function driveMakeup(character: DriveCharacter, drive: number, level = 0.5): number {
  const n = 512;
  let inSq = 0;
  let outSq = 0;
  for (let i = 0; i < n; i++) {
    const x = level * Math.sin((2 * Math.PI * (i + 0.5)) / n);
    const y = shape(x, character, drive);
    inSq += x * x;
    outSq += y * y;
  }
  return outSq > 0 ? Math.min(2, Math.sqrt(inSq / outSq)) : 1;
}
