import type { ExprPoint, NoteExpression } from './timelineTypes';
import { TOTAL_BARS } from './timelineTypes';
import { exprValueAt } from './expression';

/**
 * Per-note expression (the way an MPE keyboard plays each key on its own): a note can bend away
 * from its pitch and swell or fade with key pressure over its length. Pure maths, unit tested.
 */

export type NoteLane = keyof NoteExpression;
export const NOTE_LANES: ReadonlyArray<{ lane: NoteLane; label: string; min: number; max: number; rest: number }> = [
  { lane: 'bend', label: 'Note bend', min: -24, max: 24, rest: 0 },
  { lane: 'pressure', label: 'Note pressure', min: 0, max: 1, rest: 1 },
];
export const noteLaneSpec = (lane: NoteLane) => NOTE_LANES.find((l) => l.lane === lane)!;

/** A note curve's value `at` bars into the note: resting (no bend, full pressure) with no points, held before the first. */
export function noteValueAt(points: readonly ExprPoint[] | undefined, at: number, lane: NoteLane): number {
  if (!points?.length) return noteLaneSpec(lane).rest;
  if (at <= points[0].at) return points[0].value;
  return exprValueAt(points, at);
}

/** Points in order, inside the lane's range and the note (0 to `length` bars), one per place. */
export function tidyNoteLane(points: readonly ExprPoint[], lane: NoteLane, length = Infinity): ExprPoint[] {
  const { min, max } = noteLaneSpec(lane);
  const sorted = points
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.value))
    .map((p) => ({ at: Math.max(0, Math.min(length, p.at)), value: Math.max(min, Math.min(max, p.value)) }))
    .sort((a, b) => a.at - b.at);
  return sorted.filter((p, i) => i === sorted.length - 1 || sorted[i + 1].at - p.at > 1e-6).slice(0, 256);
}

/**
 * Tidy points (see tidyNoteLane) ending at the note's end (`length` bars): the curve plays as it
 * did over the note, the points past its end replaced by one at its end, where the curve was.
 */
export function cutNoteLane(points: readonly ExprPoint[], lane: NoteLane, length: number): ExprPoint[] {
  if (!(length >= 0) || !points.length || points[points.length - 1].at <= length) return [...points];
  const kept = points.filter((p) => p.at <= length);
  if (!kept.length || kept[kept.length - 1].at < length - 1e-6) kept.push({ at: length, value: noteValueAt(points, length, lane) });
  return kept;
}

/** A note's expression as a file gives it: tidy, and ending at the note's end (`length` bars). */
export function normalizeNoteExpression(raw: unknown, length = Infinity): NoteExpression | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: NoteExpression = {};
  for (const { lane } of NOTE_LANES) {
    const v = (raw as Record<string, unknown>)[lane];
    if (!Array.isArray(v)) continue;
    const pts = cutNoteLane(
      tidyNoteLane(
        v.filter((p): p is ExprPoint => typeof p === 'object' && p !== null && typeof p.at === 'number' && typeof p.value === 'number'),
        lane
      ),
      lane,
      length
    );
    if (pts.length) out[lane] = pts;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The note moves anything (a bend away from 0, a pressure below full). */
export const isExpressive = (expr: NoteExpression | undefined): boolean =>
  !!expr && (!!expr.bend?.some((p) => p.value !== 0) || !!expr.pressure?.some((p) => p.value !== 1));

/**
 * The note's expression as steps to play: every `step` bars over its `length` (bars), its bend in
 * cents and its pressure, only where either changes. The first is at 0. Past both curves' last
 * points nothing changes, so the steps stop there (a note many bars long costs no more than its
 * curves), and no note is stepped past the whole timeline (TOTAL_BARS).
 */
export function noteSteps(expr: NoteExpression, length: number, step = 1 / 64): Array<{ at: number; cents: number; pressure: number }> {
  const s = noteStepper(expr, length, step);
  s.upTo(Infinity);
  return s.steps;
}

/** A note's steps (see noteSteps) worked out as far as they're asked for: a long note's thousands at once held the page up. */
export interface NoteStepper {
  /** The steps worked out so far */
  readonly steps: Array<{ at: number; cents: number; pressure: number }>;
  /** Work out every step up to `bar` bars into the note (Infinity: all of them). */
  upTo: (bar: number) => void;
  /** Whether every step is worked out */
  readonly done: boolean;
}

/**
 * noteValueAt for `at` going only up, the same values: it walks on through the points instead of
 * looking each one up from the end (thousands of steps through a 256-point curve).
 */
function walker(points: readonly ExprPoint[] | undefined, lane: NoteLane): (at: number) => number {
  if (!points?.length) return () => noteLaneSpec(lane).rest;
  const EPS = 1e-9;
  let i = 0;
  return (at) => {
    if (at <= points[0].at) return points[0].value;
    // (as exprValueAt: the last point at or before it, then on to the next)
    while (i + 1 < points.length && points[i + 1].at <= at + EPS) i++;
    const p = points[i];
    const next = points[i + 1];
    if (!next) return p.value;
    const u = (at - p.at) / Math.max(EPS, next.at - p.at);
    return p.value + (next.value - p.value) * u;
  };
}

/** The steps of noteSteps, the same ones, worked out as they're asked for (see NoteStepper). */
export function noteStepper(expr: NoteExpression, length: number, step = 1 / 64): NoteStepper {
  const out: Array<{ at: number; cents: number; pressure: number }> = [];
  const end = Math.min(TOTAL_BARS, length);
  let still = 0;
  for (const p of expr.bend ?? []) still = Math.max(still, p.at);
  for (const p of expr.pressure ?? []) still = Math.max(still, p.at);
  const bend = walker(expr.bend, 'bend');
  const press = walker(expr.pressure, 'pressure');
  let at = 0;
  let done = false;
  return {
    steps: out,
    get done() {
      return done;
    },
    upTo: (bar) => {
      while (!done && at <= bar) {
        if (!(at < end - 1e-9)) {
          done = true;
          break;
        }
        const cents = bend(at) * 100;
        const pressure = press(at);
        const last = out[out.length - 1];
        const changed = !last || Math.abs(last.cents - cents) >= 0.5 || Math.abs(last.pressure - pressure) >= 0.005;
        if (changed) out.push({ at, cents, pressure });
        // (from here on every step has these values)
        if (at >= still) {
          done = true;
          break;
        }
        at += step;
      }
    },
  };
}
