/**
 * Pocket's note maths, as plain functions: how many 16th steps a bar has, how many steps a note
 * covers, note names to MIDI numbers and back, and the notes of the song's key over an
 * instrument's range (the rows of the pads and the piano roll); and the piano roll's notes in
 * 16ths, and back.
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

/** A note as the piano roll sees it: its row's pitch, its 16th and its length in 16ths. */
export interface RollNote {
  id: string;
  midi: number;
  step: number;
  len: number;
  velocity: number;
  /** The note as it was (its name is kept when its pitch doesn't change) */
  from?: NoteEvent;
}

const rollOf = (n: NoteEvent): Omit<RollNote, 'id' | 'from'> => ({
  midi: noteToMidi(n.note) ?? 60,
  step: Math.round(n.startOffset * STEPS_PER_WHOLE),
  len: Math.max(1, Math.round(durationToBars(n.duration) * STEPS_PER_WHOLE)),
  velocity: n.velocity,
});

/** Notes as the roll draws them: on the nearest 16th, at least a 16th long. */
export const toRoll = (notes: readonly NoteEvent[]): RollNote[] => notes.map((n) => ({ id: n.id, ...rollOf(n), from: n }));

/**
 * The roll's notes as notes again. One the roll hasn't moved, stretched or re-pitched is kept
 * exactly as it was (off the grid, a triplet, a 32nd), so drawing a note doesn't snap the rest.
 */
export const fromRoll = (notes: readonly RollNote[]): NoteEvent[] =>
  notes.map((r) => {
    const was = r.from && rollOf(r.from);
    if (r.from && was && was.midi === r.midi && was.step === r.step && was.len === r.len && was.velocity === r.velocity) return { ...r.from, id: r.id };
    return {
      ...(r.from ?? {}),
      id: r.id,
      note: r.from && noteToMidi(r.from.note) === r.midi ? r.from.note : midiToNote(r.midi),
      startOffset: r.step / STEPS_PER_WHOLE,
      duration: barsToDuration(r.len / STEPS_PER_WHOLE),
      velocity: r.velocity,
    };
  });
