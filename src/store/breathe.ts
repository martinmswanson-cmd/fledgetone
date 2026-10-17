import { measureAt, measureStart, sortedPoints, tempoAt } from '../audio/tempoMap';
import type { MeterMap, Tempo, TempoPoint } from '../audio/tempoMap';

/**
 * Let the music breathe: the tempo eases back into the end of every phrase and picks up again
 * where the next one starts, as a pianist playing rubato does, written as tempo glides so the
 * live song and every export follow it. The last phrase slows further, a small ritardando, and
 * takes two measures to do it.
 *
 * Phrases are counted in measures from `from` (so 3/4 and changes of meter phrase correctly).
 * Each phrase end gets three points: the tempo held where the last measure starts, a glide to the
 * slower tempo arriving a 16th before the end, and the old tempo back on the next downbeat.
 */

export interface BreatheOptions {
  /** Where to start and stop (bars, on measure lines) */
  from: number;
  to: number;
  /** Measures in a phrase (4 or 8) */
  phrase: number;
  /** How much slower at a phrase's end (0.1: 10% slower) */
  amount: number;
}

const EPS = 1e-6;

/** The tempo points with breathing written in, or why it can't: a glide already in the range. */
export function breathe(points: readonly TempoPoint[], tempo: Tempo, meter: MeterMap, opts: BreatheOptions, newId: () => string): TempoPoint[] | string {
  const { from, to, phrase, amount } = opts;
  if (to - from < EPS) return 'Pick a stretch to breathe over: set the loop around it (I and O).';
  if (sortedPoints(points).some((p) => p.ramp && p.bar > from + EPS && p.bar < to + EPS)) {
    return 'There is a tempo glide in there already: remove it first (right-click its flag), or pick a stretch without one.';
  }
  const first = measureAt(from + EPS, meter).measure;
  const ends: number[] = [];
  for (let m = first + phrase; ; m += phrase) {
    const bar = measureStart(m, meter);
    if (bar > to + EPS) break;
    ends.push(bar);
  }
  // A last, shorter phrase still ends on `to`
  if (!ends.length || ends[ends.length - 1] < to - EPS) ends.push(to);

  const added: TempoPoint[] = [];
  ends.forEach((end, i) => {
    const last = i === ends.length - 1 && ends.length > 1;
    // Where the ease starts: the last measure of the phrase (the last two for the final one)
    const back = measureAt(end - EPS, meter);
    // (Never back past the phrase before: a short last phrase would tangle with its ease)
    const start = Math.max(from, i > 0 ? ends[i - 1] : from, last ? measureAt(back.start - EPS, meter).start : back.start);
    if (end - 1 / 16 - start < EPS) return;
    const held = tempoAt(start, tempo);
    const slow = held * (1 - (last ? Math.min(0.4, amount * 2) : amount));
    const after = tempoAt(end + EPS, tempo);
    if (start > 1 + EPS && !added.some((p) => Math.abs(p.bar - start) < EPS)) added.push({ id: newId(), bar: start, bpm: held, ramp: false });
    added.push({ id: newId(), bar: end - 1 / 16, bpm: slow, ramp: true });
    added.push({ id: newId(), bar: end, bpm: after, ramp: false });
  });
  // The new points win where they land on an old one
  const kept = points.filter((p) => !added.some((a) => Math.abs(a.bar - p.bar) < EPS));
  return sortedPoints([...kept, ...added]).map((p) => ({ ...p, bpm: Math.round(p.bpm * 100) / 100 }));
}
