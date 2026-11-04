/**
 * How long a new note is drawn, in both piano rolls (the studio's and Pocket's): the length last
 * drawn, stretched or resized for that kind of part in this session, else the length its kind is
 * usually drawn with (a 16th for drums, a quarter for pads and chords, an eighth for other notes,
 * a bar for the FX instrument's risers). Kept for the session only, as the rolls' other choices are.
 */
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { partKind } from './partKind';
import type { InstrumentKey } from './timelineTypes';
import { addMeasures, type MeterMap } from '../audio/tempoMap';

export type PenGroup = 'drums' | 'fx' | 'pad' | 'notes';

/** Which pen a track's instrument draws with: the drum rows, the FX instrument, pads and chords, or other notes. */
export function penGroup(key: InstrumentKey): PenGroup {
  const kind = INSTRUMENTS[key]?.kind;
  if (kind === 'fx') return 'fx';
  if (kind === 'drums' || kind === 'rack' || kind === 'drop') return 'drums';
  return partKind(key) === 'pad' ? 'pad' : 'notes';
}

/** Each pen's length until one is drawn, in bars. */
export const DEFAULT_PEN_BARS: Record<PenGroup, number> = { drums: 1 / 16, fx: 1, pad: 1 / 4, notes: 1 / 8 };

const remembered = new Map<PenGroup, number>();

/** The length a new note on a track of `key` is drawn, in bars. */
export function penBars(key: InstrumentKey): number {
  const group = penGroup(key);
  return remembered.get(group) ?? DEFAULT_PEN_BARS[group];
}

/** A note of `bars` was drawn, stretched or resized on a track of `key`: the next one starts at that length. */
export function rememberPen(key: InstrumentKey, bars: number): void {
  if (Number.isFinite(bars) && bars > 0) remembered.set(penGroup(key), bars);
}

/** Forget every remembered length (for tests). */
export function forgetPens(): void {
  remembered.clear();
}

/**
 * The rolls' choices of a new note's length (in bars, whole notes): `fixed` (1/16, 1/8, ...) and
 * `counts` of the song's bars from `at`, where the clip or section starts, so "1 bar" is three
 * quarters in 3/4 and seven eighths in 7/8. A fixed length the same as one of the bars is left out
 * (a 1/2 in 2/4). Shortest first. In 4/4 the bars are 1, 2, 4.
 */
export function penLengths<T extends { bars: number; label: string }>(fixed: readonly T[], counts: readonly number[], at: number, map: MeterMap): Array<{ bars: number; label: string }> {
  const bars = counts.map((n) => ({ bars: Math.round((addMeasures(at, n, map) - at) * 1e9) / 1e9, label: n === 1 ? '1 bar' : `${n} bars` }));
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return [...fixed.filter((f) => !bars.some((b) => same(b.bars, f.bars))), ...bars].sort((a, b) => a.bars - b.bars);
}
