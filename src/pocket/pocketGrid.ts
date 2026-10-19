/**
 * Pocket's note maths, as plain functions: how many 16th steps a bar has, how many steps a note
 * covers, note names to MIDI numbers and back, and the notes of the song's key over an
 * instrument's range (the rows of the pads and the piano roll).
 */
import type { NoteEvent } from '../store/timelineTypes';
import { durationToBars } from '../store/timelineTypes';
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
