/**
 * Pocket's step grids, as plain functions over a clip's notes: how many steps a bar has, which
 * notes sit on a step, turning a step on or off, and the rows of the note grid (the song's scale
 * over two octaves). The screens in src/pocket/ call these, then hand the notes to the store
 * (setClipNotes / addNotes), so a song edited on a phone is the same song on a computer.
 */
import type { NoteEvent } from '../store/timelineTypes';
import { barsToDuration, durationToBars } from '../store/timelineTypes';
import { NOTE_NAMES, type SongKey } from '../store/songKey';

/**
 * Note offsets and clip lengths are in 4/4 bars (whole notes), so a 16th step is always 1/16 of
 * one, whatever the meter. Convert steps to and from offsets with this; stepsPerBar is only how
 * many steps one measure (one page of the grid) shows.
 */
export const STEPS_PER_WHOLE = 16;

/** Steps in a bar: 16ths (16 in 4/4, 12 in 6/8, 12 in 3/4). */
export const stepsPerBar = (meter: { num: number; den: number }): number => Math.max(1, Math.round((meter.num * 16) / meter.den));

/** Bars a step lasts. */
export const stepBars = (_meter: { num: number; den: number }): number => 1 / STEPS_PER_WHOLE;

/** A note's step in the clip (rounded to the nearest), from its offset in bars. */
export const stepOf = (startOffset: number, perBar: number): number => Math.round(startOffset * perBar);

/** The notes on `row` (a note name) that start on `step`. */
export function notesAt(notes: readonly NoteEvent[], row: string, step: number, perBar: number): NoteEvent[] {
  return notes.filter((n) => n.note === row && stepOf(n.startOffset, perBar) === step && Math.abs(n.startOffset * perBar - step) < 0.5);
}

/**
 * Turn a step on or off: removes the notes on `row` that start on `step`, or (when there are
 * none) adds one `length` steps long. Returns the clip's new notes (ids for new notes come from
 * `newId`).
 */
export function toggleStep(
  notes: readonly NoteEvent[],
  row: string,
  step: number,
  perBar: number,
  length: number,
  velocity: number,
  newId: () => string
): NoteEvent[] {
  const hit = notesAt(notes, row, step, perBar);
  if (hit.length > 0) {
    const gone = new Set(hit.map((n) => n.id));
    return notes.filter((n) => !gone.has(n.id));
  }
  return [...notes, { id: newId(), note: row, startOffset: step / perBar, duration: barsToDuration(length / perBar), velocity }];
}

/** How many steps a note covers (at least 1), for drawing held notes across the grid. */
export const noteSteps = (n: Pick<NoteEvent, 'duration'>, perBar: number): number => Math.max(1, Math.round(durationToBars(n.duration) * perBar));

/** MIDI number to a note name ("C4"). */
export const midiToNote = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** A note name ("C#4", "Db4") to its MIDI number, or null. */
export function noteToMidi(note: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return base + shift + (Number(m[3]) + 1) * 12;
}

/**
 * The note grid's rows, high to low: the key's scale notes from `low` up through `octaves`
 * octaves (and the top root), within the instrument's range.
 */
export function scaleRows(key: SongKey, range: readonly [number, number], centre: number, octaves = 2): string[] {
  const [lo, hi] = range;
  // Start on the root at or below the centre, an octave down, kept in range
  let start = centre - (((centre - key.root) % 12) + 12) % 12 - 12;
  while (start < lo) start += 12;
  const end = Math.min(hi, start + octaves * 12);
  const inKey = new Set(key.steps.map((s) => (key.root + s) % 12));
  const rows: string[] = [];
  for (let m = end; m >= start; m--) if (inKey.has(((m % 12) + 12) % 12)) rows.push(midiToNote(m));
  return rows;
}

/**
 * The note grid's tap: removes the note on `row` that sounds over `step` (one starting earlier and
 * held through it counts), or adds one `length` steps long starting there. Returns the new notes.
 */
export function toggleCovering(
  notes: readonly NoteEvent[],
  row: string,
  step: number,
  perBar: number,
  length: number,
  velocity: number,
  newId: () => string
): NoteEvent[] {
  // By pitch, so a note written "Bb3" elsewhere is the grid's "A#3"
  const midi = noteToMidi(row);
  const over = notes.find((n) => {
    if (n.note !== row && (midi === null || noteToMidi(n.note) !== midi)) return false;
    const from = n.startOffset * perBar;
    return step >= Math.round(from) && step < Math.round(from) + noteSteps(n, perBar);
  });
  if (over) return notes.filter((n) => n !== over);
  return [...notes, { id: newId(), note: row, startOffset: step / perBar, duration: barsToDuration(length / perBar), velocity }];
}
