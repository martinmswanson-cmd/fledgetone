/**
 * The Pump's duck shapes: how the volume dips and comes back over one trigger, as a curve drawn
 * over the duck's length (the Pump's Release). Smooth is the Pump's original shape (a quick dip,
 * then a raised-cosine swell back) and is worked out by its own formula, exactly as before, so a
 * song made before there were shapes sounds the same; the others are point lists, and Drawn is
 * the person's own. A point is [x, y]: x is 0 (the trigger) to 1 (the end of the duck), y is how
 * far down, 0 (full volume) to 1 (the Pump's Depth). Between points the gain moves in straight
 * lines.
 *
 * planShapedDuck works out the automation one trigger schedules: where a duck is still coming
 * back when the next one starts, the gain follows whichever of the two is lower at each moment,
 * so nothing jumps up. Plain maths with no Web Audio, so Node tests the shapes' timing and depth,
 * and the live Pump and the export's (lightFx.ts, the same node in both) schedule the very same
 * values.
 */

export const PUMP_SHAPES = ['smooth', 'hard', 'tick', 'swell', 'hole', 'drawn'] as const;
export type PumpShape = (typeof PUMP_SHAPES)[number];
export type DuckPoint = [x: number, y: number];

/** The shapes in words, for menus. */
export const PUMP_SHAPE_INFO: Record<PumpShape, { label: string; about: string }> = {
  smooth: { label: 'Smooth', about: 'Dips at once and swells back smoothly over the release: the classic sidechain pump.' },
  hard: { label: 'Hard cut', about: 'Cut right down, held, then straight back up: a gated, chopped pump.' },
  tick: { label: 'Short tick', about: 'A quick dip that is back almost at once: just enough room for the kick’s click.' },
  swell: { label: 'Long swell', about: 'Dips at once, then creeps back slowly over the whole release: a big breathing pump.' },
  hole: { label: 'Hole for drums', about: 'Down within about 20 ms, held while the drum hits, then back: a hole in the bass for each kick and snare.' },
  drawn: { label: 'Drawn', about: 'Your own shape: drag the points.' },
};

/** The preset shapes as points (Smooth has its own formula, Drawn the track's points). */
export const SHAPE_POINTS: Record<Exclude<PumpShape, 'smooth' | 'drawn'>, readonly DuckPoint[]> = {
  hard: [[0, 0], [0.02, 1], [0.6, 1], [0.68, 0], [1, 0]],
  tick: [[0, 0], [0.03, 1], [0.12, 0.85], [0.3, 0.15], [0.45, 0], [1, 0]],
  swell: [[0, 0], [0.01, 1], [0.15, 0.92], [0.4, 0.66], [0.7, 0.3], [1, 0]],
  // With the bass's 150 ms: down by 18 ms, held to 93 ms, back by 150 ms
  hole: [[0, 0], [0.12, 1], [0.62, 1], [0.82, 0.3], [1, 0]],
};

/** The most points a drawn shape keeps. */
export const MAX_DUCK_POINTS = 12;

/**
 * A drawn shape made safe to play: points in order of x (each x from 0 to 1, y from 0 to 1, at
 * most MAX_DUCK_POINTS), starting at [0, 0] and ending at [1, 0], so a duck always starts from
 * and returns to full volume without a jump. Undefined when there's nothing usable.
 */
export function normalizeDuckPoints(raw: unknown): DuckPoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const pts = raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([x, y]) => [clamp(x), clamp(y)] as DuckPoint)
    .filter(([x]) => x > 0 && x < 1)
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_DUCK_POINTS - 2);
  if (!pts.length) return undefined;
  return [[0, 0], ...pts, [1, 0]];
}

/** A shape's points (null: Smooth, which has its own formula). A Drawn shape without points plays as Smooth. */
export function shapePoints(shape: PumpShape | undefined, points?: readonly DuckPoint[]): readonly DuckPoint[] | null {
  if (!shape || shape === 'smooth') return null;
  if (shape === 'drawn') return points && points.length >= 2 ? points : null;
  return SHAPE_POINTS[shape];
}

/** The curve's y at x (0 to 1) by straight lines between the points; 0 outside them. */
export function curveAt(points: readonly DuckPoint[], x: number): number {
  if (x <= points[0][0]) return x < 0 ? 0 : points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return 0;
}

/** A duck as scheduled: the gain's straight-line vertices [time, gain], absolute times, gain 1 after the last. */
export interface ShapedDuck {
  at: number;
  vertices: Array<[number, number]>;
}

/** The gain a vertex list gives at `time` (1 after its end; before its start its first value). */
export function verticesGain(vertices: ReadonlyArray<readonly [number, number]>, time: number): number {
  if (!vertices.length) return 1;
  if (time <= vertices[0][0]) return vertices[0][1];
  for (let i = 1; i < vertices.length; i++) {
    const [t1, g1] = vertices[i];
    if (time <= t1) {
      const [t0, g0] = vertices[i - 1];
      return t1 > t0 ? g0 + ((g1 - g0) * (time - t0)) / (t1 - t0) : g1;
    }
  }
  return 1;
}

/** The longest straight piece a shaped duck is drawn with where it meets an earlier one (seconds). */
const MERGE_STEP = 0.006;

/**
 * The automation of a shaped duck starting at `at`: `points` over `length` seconds, `depth` (0 to
 * 1) deep. `before` is the gain the earlier ducks give from `at` on and `beforeTimes` their
 * vertices then (empty: none still sounding); the result follows whichever is lower, the earlier
 * duck carrying on past this one's end if it lasts longer. The first vertex is at `at`, the gain
 * there (no jump), the last one back at full volume.
 */
export function planShapedDuck(
  at: number,
  points: readonly DuckPoint[],
  depth: number,
  length: number,
  before: (time: number) => number = () => 1,
  beforeTimes: readonly number[] = []
): ShapedDuck {
  const d = Math.max(0, Math.min(1, depth));
  const len = Math.max(0.005, length);
  // (Rounding left a hair under full volume where a shape ends: that's full volume)
  const own = (t: number) => {
    const g = 1 - d * curveAt(points, (t - at) / len);
    return g > 1 - 1e-9 ? 1 : g;
  };
  const times = new Set<number>([at, ...points.map(([x]) => at + x * len)]);
  const later = beforeTimes.filter((t) => t > at);
  const end = Math.max(at + len, ...later);
  if (later.length) {
    for (const t of later) times.add(t);
    // Where the two cross, finer steps follow the lower of them closely
    for (let t = at + MERGE_STEP; t < at + len; t += MERGE_STEP) times.add(t);
  }
  const sorted = [...times].filter((t) => t >= at && t <= end).sort((a, b) => a - b);
  const vertices: Array<[number, number]> = [];
  for (const t of sorted) {
    const g = Math.min(before(t), t <= at + len ? own(t) : 1);
    const last = vertices[vertices.length - 1];
    if (last && Math.abs(last[0] - t) < 1e-9) last[1] = Math.min(last[1], g);
    else vertices.push([t, g]);
  }
  // Back to full volume at the end
  if (vertices[vertices.length - 1][1] < 1) vertices.push([end + 0.002, 1]);
  return { at, vertices };
}

/** dB of a Pump depth (0 to 1): how far its lowest point is under full volume. */
export const depthDb = (depth: number): number => (depth >= 1 ? -Infinity : 20 * Math.log10(1 - Math.max(0, depth)));
/** The Pump depth (0 to 1) that dips `db` dB (negative). */
export const depthOfDb = (db: number): number => 1 - 10 ** (Math.min(0, db) / 20);
