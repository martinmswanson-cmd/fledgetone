import { nearestMeasureStart, sortedPoints } from '../audio/tempoMap';
import type { Meter, MeterPoint, TempoPoint } from '../audio/tempoMap';
import { TOTAL_BARS } from './timelineTypes';

/**
 * Where tempo and time signature changes go when they're moved or scaled. The store's actions and
 * the tempo row's drags both go by these, so a drag knows before taking its undo step whether a
 * move will change anything (a click that wobbles a little leaves the history alone).
 */

/**
 * Where moving tempo change `id` toward `bar` puts it: past bar 1 and inside the song, and not
 * onto another change's bar (one of the two would be lost), where it stays put.
 */
export function tempoChangeMoveTo(points: readonly TempoPoint[], id: string, bar: number): number {
  const self = points.find((p) => p.id === id);
  const to = Math.max(1 + 1 / 16, Math.min(TOTAL_BARS, bar));
  const taken = points.some((o) => o.id !== id && Math.abs(o.bar - to) < 1e-6);
  return taken ? (self?.bar ?? to) : to;
}

/**
 * Where moving time signature change `id` toward `bar` puts it: the nearest measure start, and only
 * between its neighbours (passing one would swallow it); otherwise it stays put.
 */
export function meterChangeMoveTo(meter: Meter, points: readonly MeterPoint[], id: string, bar: number): number {
  const self = points.find((p) => p.id === id);
  if (!self) return 1;
  const sorted = sortedPoints(points);
  const i = sorted.findIndex((p) => p.id === id);
  const lo = sorted[i - 1]?.bar ?? 1;
  const hi = sorted[i + 1]?.bar ?? Infinity;
  const next = nearestMeasureStart(bar, { base: meter, points: points.filter((p) => p.id !== id) });
  return next > lo + 1e-6 && next < hi - 1e-6 ? next : self.bar;
}

/**
 * Every tempo (the song's and its changes) times `factor`, to hundredths of a BPM. A message if one
 * would leave 40 to 240 BPM; null if no tempo changes (a factor of 1, or one too small to move any
 * tempo a hundredth).
 */
export function scaledTempos(bpm: number, points: readonly TempoPoint[], factor: number): { bpm: number; tempoPoints: TempoPoint[] } | string | null {
  const all = [bpm, ...points.map((p) => p.bpm)].map((b) => Math.round(b * factor * 100) / 100);
  if (all.some((b) => b < 40 || b > 240)) return 'That would take a tempo outside 40 to 240 BPM.';
  if (all[0] === bpm && points.every((p, i) => p.bpm === all[i + 1])) return null;
  return { bpm: all[0], tempoPoints: points.map((p, i) => ({ ...p, bpm: all[i + 1] })) };
}
