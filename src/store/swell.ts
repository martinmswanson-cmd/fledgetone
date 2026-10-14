import { durationToBars } from './timelineTypes';
import type { ExprPoint, NoteEvent } from './timelineTypes';

/**
 * Swells: the mod wheel (dynamics, see expression.ts) drawn over notes as a player shapes a held
 * line, so a phrase grows and fades instead of sitting at one loudness. Notes that touch or overlap
 * make one phrase; each phrase gets its own shape, and the wheel elsewhere in the clip is kept.
 */

export type SwellShape = 'swell' | 'crescendo' | 'diminuendo';

export const SWELL_SHAPES: ReadonlyArray<{ id: SwellShape; label: string }> = [
  { id: 'swell', label: 'Swell (mod wheel: grow, then fade)' },
  { id: 'crescendo', label: 'Crescendo (mod wheel: grow)' },
  { id: 'diminuendo', label: 'Diminuendo (mod wheel: fade)' },
];

/** Notes closer than this (bars) are one phrase. */
const JOIN = 1 / 16;
const EPS = 1e-9;

/** The phrases `notes` make: spans of bars where notes touch or overlap. */
export function phrases(notes: readonly Pick<NoteEvent, 'startOffset' | 'duration'>[]): Array<[from: number, to: number]> {
  const spans = notes.map((n) => [n.startOffset, n.startOffset + durationToBars(n.duration)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + JOIN) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** One phrase's wheel, from `a` to `b` bars. */
function shapeOf(shape: SwellShape, a: number, b: number): ExprPoint[] {
  const len = b - a;
  switch (shape) {
    case 'swell':
      return [{ at: a, value: 0.35 }, { at: a + len * 0.55, value: 0.95 }, { at: b, value: 0.4 }];
    case 'crescendo':
      return [{ at: a, value: 0.3 }, { at: a + len * 0.85, value: 1 }, { at: b, value: 1 }];
    case 'diminuendo':
      return [{ at: a, value: 1 }, { at: a + len * 0.15, value: 0.95 }, { at: b, value: 0.25 }];
  }
}

/**
 * The mod wheel lane with `shape` drawn over the phrases of `notes`: the lane's points inside each
 * phrase are replaced, the rest kept. (Values in the lane's 0..1, points in order.)
 */
export function swellLane(lane: readonly ExprPoint[] | undefined, notes: readonly Pick<NoteEvent, 'startOffset' | 'duration'>[], shape: SwellShape): ExprPoint[] {
  const spans = phrases(notes);
  const kept = (lane ?? []).filter((p) => !spans.some(([a, b]) => p.at >= a - EPS && p.at <= b + EPS));
  return [...kept, ...spans.flatMap(([a, b]) => shapeOf(shape, Math.max(0, a), b))].sort((x, y) => x.at - y.at);
}
