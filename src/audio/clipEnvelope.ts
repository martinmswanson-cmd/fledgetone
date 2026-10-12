/**
 * The loudness envelope of an audio clip: its gain and its fade in and fade out. Plain maths, so
 * the player can pick the envelope up from any position (a seek into the middle of a clip) and
 * Node can unit-test it. The player adds a short fade (DECLICK_SECONDS) wherever a clip is cut
 * into its sound (a trimmed edge, a razor cut) and where playback starts or stops inside one, so
 * cuts don't click; a clip that plays its sound from the very start, or to its end, is left as
 * recorded, transients and all.
 */

/** The shortest fade a cut gets. */
export const DECLICK_SECONDS = 0.002;

export interface EnvelopeShape {
  /** Linear gain at full level */
  level: number;
  /** How long the clip plays, in seconds */
  seconds: number;
  /** The fades, in seconds, never longer than half the clip; 0 is a hard edge */
  fadeIn: number;
  fadeOut: number;
  /** Equal-power fades (a crossfade with the clip before / after), which hold the level through the overlap */
  curveIn?: boolean;
  curveOut?: boolean;
}

/** Steps an equal-power fade is drawn in (the gain ramps in straight lines between them). */
const CURVE_STEPS = 16;

/** The gain a fade has reached `r` (0 to 1) of the way through: a straight line, or a quarter sine. */
const faded = (r: number, curved?: boolean): number => (curved ? Math.sin((Math.max(0, Math.min(1, r)) * Math.PI) / 2) : Math.max(0, Math.min(1, r)));

/** A point of the envelope: `at` seconds into the clip, the gain there. The gain runs in straight lines between points. */
export type EnvelopePoint = [at: number, gain: number];

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** The envelope of a clip `seconds` long at `gainDb` with these fades (seconds). */
export function envelopeShape(gainDb: number, seconds: number, fadeIn: number, fadeOut: number, curves?: { in?: boolean; out?: boolean }): EnvelopeShape {
  const length = Math.max(0, seconds);
  const fade = (f: number) => Math.min(Math.max(f, 0), length / 2);
  const shape: EnvelopeShape = { level: dbToGain(gainDb), seconds: length, fadeIn: fade(fadeIn), fadeOut: fade(fadeOut) };
  if (curves?.in && shape.fadeIn > 0) shape.curveIn = true;
  if (curves?.out && shape.fadeOut > 0) shape.curveOut = true;
  return shape;
}

/** The envelope's gain `at` seconds into the clip (0 outside it; full level at a hard start). */
export function envelopeAt(shape: EnvelopeShape, at: number): number {
  if (at < 0 || at >= shape.seconds) return 0;
  const rising = shape.fadeIn > 0 ? faded(at / shape.fadeIn, shape.curveIn) : 1;
  const falling = shape.fadeOut > 0 ? faded((shape.seconds - at) / shape.fadeOut, shape.curveOut) : 1;
  return shape.level * Math.max(0, Math.min(1, rising, falling));
}

/**
 * The envelope from `from` seconds into the clip to the clip's end, as points to ramp between, the
 * first at `from`. Starting inside the clip (`declick`, which starting past its beginning means),
 * the first DECLICK_SECONDS rise from silence, so a seek into the middle of a clip doesn't click.
 * Empty once the clip is over.
 */
export function envelopeFrom(shape: EnvelopeShape, from: number, declick = from > 0): EnvelopePoint[] {
  if (from >= shape.seconds) return [];
  const start = Math.max(0, from);
  const points: EnvelopePoint[] = [];
  let after = start;
  if (declick) {
    const rise = Math.min(DECLICK_SECONDS, shape.seconds - start);
    points.push([start, 0], [start + rise, envelopeAt(shape, start + rise)]);
    after = start + rise;
  } else {
    points.push([start, envelopeAt(shape, start)]);
  }
  // The corners still ahead: the end of the fade in, then the start of the fade out and the end,
  // or (with no fade out) full level held to the end, where the source simply stops
  // (an equal-power fade as a run of short straight lines along its curve)
  const corners: EnvelopePoint[] = [];
  if (shape.fadeIn > 0) {
    if (shape.curveIn) for (let k = 1; k < CURVE_STEPS; k++) corners.push([(shape.fadeIn * k) / CURVE_STEPS, 0]);
    corners.push([shape.fadeIn, shape.level]);
  }
  if (shape.fadeOut > 0) {
    corners.push([shape.seconds - shape.fadeOut, shape.level]);
    if (shape.curveOut) for (let k = 1; k < CURVE_STEPS; k++) corners.push([shape.seconds - shape.fadeOut + (shape.fadeOut * k) / CURVE_STEPS, 0]);
    corners.push([shape.seconds, 0]);
  } else corners.push([shape.seconds, shape.level]);
  // The curve's inner points take their gain from the envelope (where the fades meet, the lower one)
  for (const c of corners) if (c[0] < shape.seconds) c[1] = envelopeAt(shape, c[0]);
  for (const corner of corners) if (corner[0] > after + 1e-9) points.push(corner);
  return points;
}
