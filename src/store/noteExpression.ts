import type { ExprPoint, NoteExpression } from './timelineTypes';
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

export function normalizeNoteExpression(raw: unknown): NoteExpression | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: NoteExpression = {};
  for (const { lane } of NOTE_LANES) {
    const v = (raw as Record<string, unknown>)[lane];
    if (!Array.isArray(v)) continue;
    const pts = tidyNoteLane(
      v.filter((p): p is ExprPoint => typeof p === 'object' && p !== null && typeof p.at === 'number' && typeof p.value === 'number'),
      lane
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
 * cents and its pressure, only where either changes. The first is at 0.
 */
export function noteSteps(expr: NoteExpression, length: number, step = 1 / 64): Array<{ at: number; cents: number; pressure: number }> {
  const out: Array<{ at: number; cents: number; pressure: number }> = [];
  for (let at = 0; at < length - 1e-9; at += step) {
    const cents = noteValueAt(expr.bend, at, 'bend') * 100;
    const pressure = noteValueAt(expr.pressure, at, 'pressure');
    const last = out[out.length - 1];
    if (last && Math.abs(last.cents - cents) < 0.5 && Math.abs(last.pressure - pressure) < 0.005) continue;
    out.push({ at, cents, pressure });
  }
  return out;
}
